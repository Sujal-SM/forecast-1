// AQI forecast engine: rebuilds the notebook's features and runs the exported ensemble
// (Linear Regression + Random Forest + Gradient Boosting) and the K-Means day-type model.
// Works in Node (Vercel functions) and in the browser (window.AQIEngine).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AQIEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const DAY = 86400000;
  const BANDS = [[50, "Good"], [100, "Satisfactory"], [200, "Moderate"], [300, "Poor"], [400, "Very Poor"], [Infinity, "Severe"]];
  const POLL = ["PM2.5", "PM10", "NO", "NO2", "NOx", "NH3", "CO", "SO2", "O3", "Benzene", "Toluene"];

  function create(model, days) {
    const start = Date.parse(days.start + "T00:00:00Z");
    const diwali = model.diwali.map((d) => Date.parse(d + "T00:00:00Z"));
    const idxOf = (iso) => Math.round((Date.parse(iso + "T00:00:00Z") - start) / DAY);
    const isoOf = (i) => new Date(start + i * DAY).toISOString().slice(0, 10);
    const lastIdx = days.n - 1;

    function series(col, i, ov) {
      // value of a forward-filled column at index i; overrides apply to the origin day only
      if (ov && i === ov._i && ov[col] !== undefined && ov[col] !== null && ov[col] !== "") return Number(ov[col]);
      return days.ff[col][i];
    }

    function features(iso, overrides) {
      const i = idxOf(iso);
      if (i < 13 || i > lastIdx) return { error: "Pick a date between " + isoOf(13) + " and " + isoOf(lastIdx) + "." };
      const ov = overrides ? Object.assign({ _i: i }, overrides) : null;
      const f = {};
      for (const c of POLL) f[c] = series(c, i, ov);
      f.PM_ratio = f["PM2.5"] / f.PM10;
      const aqi = (k) => series("AQI", i - k, ov);
      for (const l of [0, 1, 2, 6]) f["AQI_lag" + l] = aqi(l);
      const win = (w) => Array.from({ length: w }, (_, k) => aqi(k));
      const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
      for (const w of [3, 7, 14]) f["AQI_roll" + w] = mean(win(w));
      const w7 = win(7), m7 = mean(w7);
      f.AQI_std7 = Math.sqrt(w7.reduce((s, v) => s + (v - m7) ** 2, 0) / 6); // pandas std, ddof = 1
      f.AQI_diff1 = aqi(0) - aqi(1);
      f.PM25_roll3 = mean([0, 1, 2].map((k) => series("PM2.5", i - k, ov)));
      const tom = new Date(start + (i + 1) * DAY);
      const y0 = Date.UTC(tom.getUTCFullYear(), 0, 1);
      const doy = Math.round((tom - y0) / DAY) + 1;
      f.doy_sin = Math.sin((2 * Math.PI * doy) / 365.25);
      f.doy_cos = Math.cos((2 * Math.PI * doy) / 365.25);
      f.dow = (tom.getUTCDay() + 6) % 7; // pandas: Monday = 0
      f.diwali_window = diwali.some((d) => Math.abs(Math.round((tom - d) / DAY)) <= 2) ? 1 : 0;
      for (const k of model.features) if (f[k] === null || f[k] === undefined || Number.isNaN(f[k])) return { error: "Missing history for " + iso + "." };
      return { i, iso, x: model.features.map((k) => f[k]), named: f };
    }

    function tree(t, x) {
      let n = 0;
      while (t.l[n] !== -1) n = x[t.f[n]] <= t.t[n] ? t.l[n] : t.r[n];
      return t.v[n];
    }
    function predictLR(x) {
      const p = model.lr; let s = p.intercept;
      for (let j = 0; j < x.length; j++) s += ((x[j] - p.mean[j]) / p.scale[j]) * p.coef[j];
      return s;
    }
    const f32 = (x) => x.map((v) => Math.fround(v)); // sklearn trees compare float32 inputs
    function predictRF(x) { const xf = f32(x); let s = 0; for (const t of model.rf) s += tree(t, xf); return s / model.rf.length; }
    function predictGB(x) { const xf = f32(x); let s = model.gb.init; for (const t of model.gb.trees) s += model.gb.lr * tree(t, xf); return s; }

    function dayType(named) {
      const c = model.cluster;
      const raw = c.cl_feats.map((k) => (k === "PM_ratio" ? named.PM_ratio : Math.log1p(named[k])));
      const z = raw.map((v, j) => (v - c.mean[j]) / c.scale[j]);
      const pc = c.components.map((comp) => comp.reduce((s, w, j) => s + w * (z[j] - c.pca_mean[j]), 0));
      let best = 0, bd = Infinity;
      c.centroids.forEach((cen, k) => { const d = cen.reduce((s, v, j) => s + (v - pc[j]) ** 2, 0); if (d < bd) { bd = d; best = k; } });
      return c.names[String(best)];
    }

    function category(aqi) { return BANDS.find((b) => aqi <= b[0])[1]; }

    function forecast(iso, overrides) {
      const F = features(iso, overrides);
      if (F.error) return F;
      const lr = predictLR(F.x), rf = predictRF(F.x), gb = predictGB(F.x);
      const ens = (lr + rf + gb) / 3;
      const t = F.i + 1;
      const actual = t <= lastIdx ? days.aqi_raw[t] : null;
      return {
        origin: iso, target: isoOf(t), forecast: ens, category: category(ens),
        members: { "Linear Regression": lr, "Random Forest": rf, "Gradient Boosting": gb },
        persistence: F.named.AQI_lag0, actual, actual_category: actual === null ? null : category(actual),
        day_type: dayType(F.named), features: F.named,
        in_training: iso <= model.train_end, edited: !!overrides,
      };
    }

    function history(iso, back = 45) {
      const i = idxOf(iso), out = [];
      for (let k = Math.max(0, i - back); k <= Math.min(lastIdx, i + 1); k++) out.push([isoOf(k), days.aqi_raw[k]]);
      return out;
    }

    function pollutants(iso) {
      const i = idxOf(iso);
      return POLL.map((p) => ({ name: p, today: days.ff[p][i], median: days.train_median[p] }));
    }

    return { forecast, history, pollutants, features, category, range: { min: isoOf(13), max: isoOf(lastIdx) }, POLL };
  }
  return { create };
});
