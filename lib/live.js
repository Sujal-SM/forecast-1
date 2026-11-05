// Live "today" forecast: pulls recent Delhi CPCB station data from OpenAQ v3, computes the CPCB AQI per station,
// averages stations into a city series, rebuilds the live model's features and runs its ensemble (LR + RF + GBR).
"use strict";
const P6 = ["PM2.5", "PM10", "NO2", "SO2", "CO", "O3"];
const OAQ_PARAM = { pm25: "PM2.5", pm10: "PM10", no2: "NO2", so2: "SO2", co: "CO", o3: "O3" };
const DAY = 86400000;

// CPCB National AQI breakpoints [conc_lo, conc_hi, index_lo, index_hi]; PM/NO2/SO2/O3 in µg/m³, CO in mg/m³
const BP = {
  PM10: [[0, 50, 0, 50], [50, 100, 50, 100], [100, 250, 100, 200], [250, 350, 200, 300], [350, 430, 300, 400], [430, 510, 400, 500]],
  "PM2.5": [[0, 30, 0, 50], [30, 60, 50, 100], [60, 90, 100, 200], [90, 120, 200, 300], [120, 250, 300, 400], [250, 380, 400, 500]],
  NO2: [[0, 40, 0, 50], [40, 80, 50, 100], [80, 180, 100, 200], [180, 280, 200, 300], [280, 400, 300, 400], [400, 520, 400, 500]],
  O3: [[0, 50, 0, 50], [50, 100, 50, 100], [100, 168, 100, 200], [168, 208, 200, 300], [208, 748, 300, 400], [748, 868, 400, 500]],
  CO: [[0, 1, 0, 50], [1, 2, 50, 100], [2, 10, 100, 200], [10, 17, 200, 300], [17, 34, 300, 400], [34, 51, 400, 500]],
  SO2: [[0, 40, 0, 50], [40, 80, 50, 100], [80, 380, 100, 200], [380, 800, 200, 300], [800, 1600, 300, 400], [1600, 2400, 400, 500]],
};
function subIndex(p, c) {
  if (c === null || c === undefined || !Number.isFinite(c) || c < 0) return null;
  for (const [lo, hi, ilo, ihi] of BP[p]) if (c <= hi) return ilo + ((c - lo) * (ihi - ilo)) / (hi - lo);
  return 500;
}
function cpcbAQI(rec) {
  const subs = {};
  for (const p of P6) { const s = subIndex(p, rec[p]); if (s !== null) subs[p] = s; }
  const keys = Object.keys(subs);
  if (keys.length < 3 || !(("PM2.5" in subs) || ("PM10" in subs))) return null; // CPCB: >= 3 pollutants, one of them PM
  let best = keys[0];
  for (const k of keys) if (subs[k] > subs[best]) best = k;
  return { aqi: Math.min(500, subs[best]), driver: best };
}

// Convert an OpenAQ value to CPCB units (µg/m³; CO in mg/m³)
const MW = { NO2: 46.01, SO2: 64.07, O3: 48.0, CO: 28.01 };
function toCPCB(p, v, units) {
  if (v === null || v === undefined || !Number.isFinite(v) || v < 0) return null;
  const u = String(units || "").toLowerCase().replace("μ", "µ");
  let ugm3;
  if (u.includes("µg") || u.includes("ug")) ugm3 = v;
  else if (u.includes("mg")) ugm3 = v * 1000;
  else if (u.includes("ppm")) ugm3 = (v * MW[p] * 1000) / 24.45;
  else if (u.includes("ppb")) ugm3 = (v * MW[p]) / 24.45;
  else return null; // unknown unit: skip rather than guess
  return p === "CO" ? ugm3 / 1000 : ugm3;
}

// ---------- model inference (same exported format as the notebook models) ----------
function makePredictor(model) {
  const tree = (t, x) => { let n = 0; while (t.l[n] !== -1) n = x[t.f[n]] <= t.t[n] ? t.l[n] : t.r[n]; return t.v[n]; };
  const f32 = (x) => x.map((v) => Math.fround(v));
  return (x) => {
    const p = model.lr; let lr = p.intercept;
    for (let j = 0; j < x.length; j++) lr += ((x[j] - p.mean[j]) / p.scale[j]) * p.coef[j];
    const xf = f32(x);
    let rf = 0; for (const t of model.rf) rf += tree(t, xf); rf /= model.rf.length;
    let gb = model.gb.init; for (const t of model.gb.trees) gb += model.gb.lr * tree(t, xf);
    return { "Linear Regression": lr, "Random Forest": rf, "Gradient Boosting": gb, ensemble: (lr + rf + gb) / 3 };
  };
}

// series: consecutive daily rows [{date, "PM2.5", PM10, NO2, SO2, CO, O3, AQI}], already forward-filled.
// Features are built for the LAST row (the forecast origin), exactly as in training.
function buildFeatures(model, series) {
  const n = series.length, i = n - 1;
  if (n < 14) throw new Error("Need at least 14 days of history, got " + n + ".");
  const at = (k, col) => series[i - k][col];
  const f = {};
  for (const p of P6) f[p] = at(0, p);
  f.PM_ratio = f["PM2.5"] / f.PM10;
  for (const l of [0, 1, 2, 6]) f["AQI_lag" + l] = at(l, "AQI");
  const win = (w) => Array.from({ length: w }, (_, k) => at(k, "AQI"));
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  for (const w of [3, 7, 14]) f["AQI_roll" + w] = mean(win(w));
  const w7 = win(7), m7 = mean(w7);
  f.AQI_std7 = Math.sqrt(w7.reduce((s, v) => s + (v - m7) ** 2, 0) / 6);
  f.AQI_diff1 = at(0, "AQI") - at(1, "AQI");
  f.PM25_roll3 = mean([0, 1, 2].map((k) => at(k, "PM2.5")));
  const tom = new Date(Date.parse(series[i].date + "T00:00:00Z") + DAY);
  const doy = Math.round((tom - Date.UTC(tom.getUTCFullYear(), 0, 1)) / DAY) + 1;
  f.doy_sin = Math.sin((2 * Math.PI * doy) / 365.25);
  f.doy_cos = Math.cos((2 * Math.PI * doy) / 365.25);
  f.dow = (tom.getUTCDay() + 6) % 7;
  f.diwali_window = model.diwali.some((d) => Math.abs(Math.round((tom - Date.parse(d + "T00:00:00Z")) / DAY)) <= 2) ? 1 : 0;
  const x = model.features.map((k) => f[k]);
  if (x.some((v) => v === null || v === undefined || !Number.isFinite(v))) throw new Error("Some inputs are missing for " + series[i].date + ".");
  return { x, named: f, target: tom.toISOString().slice(0, 10) };
}

function forecastFromSeries(model, series) {
  const F = buildFeatures(model, series);
  const p = makePredictor(model)(F.x);
  return { origin: series[series.length - 1].date, target: F.target, forecast: p.ensemble,
           members: { "Linear Regression": p["Linear Regression"], "Random Forest": p["Random Forest"], "Gradient Boosting": p["Gradient Boosting"] },
           persistence: F.named.AQI_lag0, features: F.named };
}

// ---------- OpenAQ ----------
const DELHI = { lat: 28.6139, lon: 77.209 };
const istDate = (ms) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);
const addDays = (iso, k) => new Date(Date.parse(iso + "T00:00:00Z") + k * DAY).toISOString().slice(0, 10);

async function pool(items, limit, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const k = next++; out[k] = await fn(items[k]).catch((e) => ({ error: e.message })); }
  }));
  return out;
}

async function fetchDelhiDaily({ apiKey, fetchImpl = fetch, now = Date.now(), maxStations = 8, days = 18 }) {
  const get = async (path) => {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 9000);
    try {
      const r = await fetchImpl("https://api.openaq.org/v3" + path, { headers: { "X-API-Key": apiKey, Accept: "application/json" }, signal: ctl.signal });
      if (r.status === 401 || r.status === 403) throw Object.assign(new Error("OpenAQ rejected the API key. Check OPENAQ_API_KEY in Vercel settings."), { code: "auth" });
      if (r.status === 429) throw Object.assign(new Error("OpenAQ rate limit reached. Try again in a minute."), { code: "rate" });
      if (!r.ok) throw new Error("OpenAQ returned " + r.status + " for " + path.split("?")[0] + ".");
      return await r.json();
    } finally { clearTimeout(timer); }
  };

  const today = istDate(now), lastFull = addDays(today, -1), first = addDays(lastFull, -(days - 1));
  const locs = await get(`/locations?coordinates=${DELHI.lat},${DELHI.lon}&radius=25000&limit=100&monitor=true`);
  const fresh = (locs.results || []).map((l) => {
    const sensors = (l.sensors || []).filter((s) => OAQ_PARAM[s.parameter && s.parameter.name]);
    const last = l.datetimeLast && (l.datetimeLast.utc || l.datetimeLast);
    return { id: l.id, name: l.name, provider: l.provider && l.provider.name, sensors, last };
  }).filter((l) => l.sensors.some((s) => ["pm25", "pm10"].includes(s.parameter.name)) && l.last && now - Date.parse(l.last) < 3 * DAY)
    .sort((a, b) => b.sensors.length - a.sensors.length).slice(0, maxStations);
  if (!fresh.length) throw new Error("OpenAQ has no Delhi monitoring station that reported in the last 3 days.");

  const jobs = [];
  for (const l of fresh) for (const s of l.sensors) jobs.push({ loc: l, s, p: OAQ_PARAM[s.parameter.name], units: s.parameter.units });
  const res = await pool(jobs, 4, (j) => get(`/sensors/${j.s.id}/days?date_from=${first}&date_to=${today}&datetime_from=${first}T00:00:00Z&datetime_to=${today}T00:00:00Z&limit=60`));
  const authErr = res.find((r) => r && r.error && /API key/.test(r.error));
  if (authErr) throw new Error(authErr.error);

  // station -> date -> pollutant value (CPCB units)
  const st = {};
  res.forEach((r, k) => {
    if (!r || r.error) return;
    const j = jobs[k];
    for (const m of r.results || []) {
      const from = m.period && m.period.datetimeFrom; const date = String((from && (from.local || from.utc)) || "").slice(0, 10);
      if (!date || date < first || date > lastFull) continue;
      const cov = m.coverage && m.coverage.percentComplete;
      if (Number.isFinite(cov) && cov < 50) continue; // skip days with under half the hours reported
      const v = toCPCB(j.p, m.value, (m.parameter && m.parameter.units) || j.units);
      if (v === null) continue;
      ((st[j.loc.id] = st[j.loc.id] || {})[date] = st[j.loc.id][date] || {})[j.p] = v;
    }
  });

  // city series: per-day mean of station AQIs and of pollutant concentrations
  const raw = [];
  for (let date = first; date <= lastFull; date = addDays(date, 1)) {
    const rows = Object.values(st).map((byDate) => byDate[date]).filter(Boolean);
    const rec = { date, stations: 0 };
    const aqis = [];
    for (const r of rows) { const a = cpcbAQI(r); if (a) aqis.push(a.aqi); }
    for (const p of P6) { const vals = rows.map((r) => r[p]).filter((v) => v !== undefined); rec[p] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null; }
    rec.AQI = aqis.length ? aqis.reduce((s, v) => s + v, 0) / aqis.length : null;
    rec.stations = aqis.length;
    raw.push(rec);
  }
  // keep up to the last day that has a city AQI; forward-fill gaps like in training
  let end = raw.length - 1; while (end >= 0 && raw[end].AQI === null) end--;
  if (end < 0) throw new Error("OpenAQ returned no usable Delhi readings for the last " + days + " days.");
  const series = [], filled = [], prev = {};
  for (let k = 0; k <= end; k++) {
    const r = { ...raw[k] }; let wasFilled = false;
    for (const c of P6.concat(["AQI"])) { if (r[c] === null) { if (prev[c] !== undefined) { r[c] = prev[c]; wasFilled = true; } } else prev[c] = r[c]; }
    if (wasFilled) filled.push(r.date);
    series.push(r);
  }
  const start = series.findIndex((r) => P6.concat(["AQI"]).every((c) => r[c] !== null));
  const usable = start < 0 ? [] : series.slice(start);
  if (usable.length < 14) throw new Error("Only " + usable.length + " complete days of Delhi data are available. The model needs 14.");
  return { series: usable, filled: filled.filter((d) => d >= usable[0].date), stations: fresh.map((l) => ({ name: l.name, provider: l.provider, sensors: l.sensors.length })),
           lastFull, today };
}

function categoryOf(aqi) { return [[50, "Good"], [100, "Satisfactory"], [200, "Moderate"], [300, "Poor"], [400, "Very Poor"], [Infinity, "Severe"]].find((b) => aqi <= b[0])[1]; }

module.exports = { P6, subIndex, cpcbAQI, toCPCB, buildFeatures, forecastFromSeries, fetchDelhiDaily, categoryOf, istDate, addDays };
