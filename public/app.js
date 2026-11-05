(() => {
  "use strict";
  // ---------- data access: Vercel API, or the same engine in the browser for the preview build ----------
  const EMBED = window.AQI_EMBED || null;
  let local = null, mode = "api", META = null;
  async function getJSON(u, opt) {
    const r = await fetch(u, opt);
    const j = await r.json().catch(() => ({ error: "The server sent an unreadable reply." }));
    if (!r.ok) throw Object.assign(new Error(j.error || "Request failed (" + r.status + ")."), { code: j.code, body: j });
    return j;
  }
  const api = {
    async meta() {
      if (EMBED) { mode = "local"; local = AQIEngine.create(EMBED.model, EMBED.days); return { ...EMBED.meta, range: local.range }; }
      return getJSON("/api/meta");
    },
    async forecast(date) {
      if (local) { const f = local.forecast(date); if (f.error) throw new Error(f.error); return { ...f, history: local.history(date), pollutants: local.pollutants(date) }; }
      return getJSON("/api/forecast?date=" + encodeURIComponent(date));
    },
    async today(refresh) {
      if (local) throw Object.assign(new Error("preview"), { code: "preview" });
      return getJSON("/api/today" + (refresh ? "?refresh=1" : ""));
    },
    async whatif(date, overrides) {
      if (local) { const f = local.forecast(date, overrides); if (f.error) throw new Error(f.error); return f; }
      return getJSON("/api/forecast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, overrides }) });
    },
  };

  // ---------- helpers ----------
  const $ = (s) => document.querySelector(s);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const CAT = [["Good", 50, "--good"], ["Satisfactory", 100, "--sat"], ["Moderate", 200, "--mod"], ["Poor", 300, "--poor"], ["Very Poor", 400, "--vpoor"], ["Severe", 500, "--severe"]];
  const catColor = (name) => css((CAT.find((c) => c[0] === name) || CAT[5])[2]);
  const TYPE_VAR = { "Winter smog": "--smog", "Dusty pre-monsoon": "--dust", "Clean monsoon": "--monsoon", "Moderate transition": "--dust" };
  const typeColor = (t) => css(TYPE_VAR[t] || "--muted");
  const TYPE_TEXT = {
    "Winter smog": "Heavy smoke and traffic gases trapped under cold, still air. October to February.",
    "Dusty pre-monsoon": "Coarse dust lifted by dry winds; a low PM2.5 to PM10 ratio. March to June.",
    "Clean monsoon": "Rain washes particles out of the air. July to September.",
  };
  const fmtDate = (iso, opt) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { timeZone: "UTC", ...(opt || { weekday: "short", day: "numeric", month: "short", year: "numeric" }) });
  const r0 = (v) => Math.round(v).toLocaleString("en-IN");
  const signed = (v) => (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(Math.round(v));
  const charts = {};
  function chart(id, cfg) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart(document.getElementById(id), cfg); return charts[id]; }
  function baseOpts() {
    const ink = css("--muted"), line = css("--line");
    Chart.defaults.font.family = css("--font"); Chart.defaults.color = ink; Chart.defaults.borderColor = line;
    return { responsive: true, maintainAspectRatio: false, animation: matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 500 },
      plugins: { legend: { display: false }, tooltip: { mode: "index", intersect: false } } };
  }
  const bandPlugin = {
    id: "bands",
    beforeDraw(c) {
      const { ctx, chartArea: a, scales } = c; const y = scales.y; if (!a || !y) return;
      let lo = 0;
      for (const [, hi, v] of CAT) {
        const top = y.getPixelForValue(Math.min(hi, y.max)), bot = y.getPixelForValue(Math.max(lo, y.min));
        if (bot > a.top && top < a.bottom) { ctx.save(); ctx.globalAlpha = 0.13; ctx.fillStyle = css(v); ctx.fillRect(a.left, Math.max(top, a.top), a.right - a.left, Math.min(bot, a.bottom) - Math.max(top, a.top)); ctx.restore(); }
        lo = hi;
      }
    },
  };

  // ---------- sky ----------
  const SKY = [[0, "#86BFE6", "#DCEFF8", "#FFFFFF", 0.0, 0.95], [100, "#A3C3D4", "#E6EDE6", "#F2F0E6", 0.05, 0.9], [200, "#BDBEA6", "#E4DBBA", "#D9CBA0", 0.18, 0.75],
               [300, "#B39C7B", "#D8C196", "#C2A779", 0.3, 0.55], [400, "#8C786A", "#B39F89", "#9D8A76", 0.42, 0.36], [520, "#6A5B54", "#8F8277", "#7C6E66", 0.52, 0.2]];
  const mix = (a, b, t) => { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join(""); };
  function paintSky(aqi, el = $("#sky")) {
    const v = Math.max(0, Math.min(aqi, 520)); let k = 0; while (k < SKY.length - 2 && v > SKY[k + 1][0]) k++;
    const a = SKY[k], b = SKY[k + 1], t = (v - a[0]) / (b[0] - a[0]);
    el.style.setProperty("--sky-top", mix(a[1], b[1], t)); el.style.setProperty("--sky-low", mix(a[2], b[2], t));
    el.style.setProperty("--haze-col", mix(a[3], b[3], t)); el.style.setProperty("--haze", (a[4] + (b[4] - a[4]) * t).toFixed(3));
    el.style.setProperty("--city", (a[5] + (b[5] - a[5]) * t).toFixed(3));
    el.classList.toggle("light-text", v > 330); el.classList.toggle("dark-text", v <= 330);
  }

  // ---------- forecast view ----------
  let current = null;
  async function showForecast(date) {
    let f;
    try { f = await api.forecast(date); }
    catch (e) {
      const note = $("#f-note"); note.className = "note warn";
      note.textContent = "No data for " + date + ". This dataset covers " + fmtDate(META.range.min) + " to " + fmtDate(META.range.max) + ". Showing the last valid date.";
      if (current) $("#date").value = current.origin;
      return;
    }
    current = f;
    $("#date").value = f.origin;
    paintSky(f.forecast);
    $("#f-when").textContent = "Forecast AQI for " + fmtDate(f.target, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    $("#f-num").textContent = r0(f.forecast);
    $("#f-cat i").style.background = catColor(f.category); $("#f-cat span").textContent = f.category;
    $("#f-sub").textContent = "Made with readings up to the end of " + fmtDate(f.origin) + ".";
    const note = $("#f-note");
    note.className = "note " + (f.in_training ? "warn" : "ok");
    note.textContent = f.in_training ? "This date is in the training period, so the forecast is in-sample. Pick a date from Jul 2019 for an honest test."
      : "Test period: the model never saw this day or anything after it.";
    if (f.actual === null || f.actual === undefined) { $("#f-actual").textContent = "Not recorded"; $("#f-actual-d").textContent = ""; }
    else {
      $("#f-actual").innerHTML = r0(f.actual) + "<small>" + f.actual_category + "</small>";
      const err = f.forecast - f.actual; $("#f-actual-d").textContent = Math.abs(err) < 1 ? "The forecast was spot on." : "The forecast was " + Math.round(Math.abs(err)) + " points too " + (err > 0 ? "high." : "low.");
    }
    $("#f-pers").textContent = r0(f.persistence);
    $("#f-pers-d").textContent = f.actual == null ? "" : Math.round(Math.abs(f.persistence - f.actual)) + " points off, " + (Math.abs(f.persistence - f.actual) > Math.abs(f.forecast - f.actual) ? "worse than the model." : "better than the model this time.");
    $("#f-type").innerHTML = '<span class="type-swatch" style="background:' + typeColor(f.day_type) + '"></span>' + f.day_type;
    $("#f-type-d").textContent = TYPE_TEXT[f.day_type] || "";
    renderMembers("#f-members", f);
    renderPollutants(f.pollutants);
    renderHistory(f);
  }
  function renderMembers(sel, f) {
    const rows = Object.entries(f.members).concat([["Forecast (average)", f.forecast]]);
    const max = Math.max(...rows.map((r) => r[1]), 1) * 1.08;
    $(sel).innerHTML = rows.map(([n, v], i) => '<div class="member' + (i === rows.length - 1 ? " ens" : "") + '"><span>' + n + '</span><div class="bar"><b style="width:' + (100 * v / max).toFixed(1) + "%" + (i === rows.length - 1 ? ";background:" + catColor(f.category) : "") + '"></b></div><span style="text-align:right">' + r0(v) + "</span></div>").join("");
  }
  function renderPollutants(list) {
    const mx = Math.max(...list.map((p) => p.today / p.median));
    $("#f-poll tbody").innerHTML = list.map((p) => {
      const ratio = p.today / p.median, w = Math.min(100, (100 * ratio) / Math.max(mx, 1));
      const col = ratio >= 1.5 ? css("--vpoor") : ratio >= 1 ? css("--poor") : css("--teal");
      return "<tr><td>" + p.name + "</td><td>" + p.today.toFixed(p.name === "CO" ? 2 : 1) + "</td><td>" + p.median.toFixed(p.name === "CO" ? 2 : 1) + "</td><td>" + ratio.toFixed(2) + '×</td><td><div class="bar"><b style="width:' + w.toFixed(1) + "%;background:" + col + '"></b></div></td></tr>';
    }).join("");
  }
  function renderHistory(f) {
    const labels = f.history.map((h) => h[0]);
    const obs = f.history.map((h) => (h[0] === f.target ? null : h[1]));
    const fc = labels.map((d) => (d === f.origin ? f.persistence : d === f.target ? f.forecast : null));
    const act = labels.map((d, i) => (d === f.target ? f.history[i][1] : null));
    const o = baseOpts();
    chart("c-hist", { type: "line", plugins: [bandPlugin],
      data: { labels, datasets: [
        { label: "Observed", data: obs, borderColor: css("--ink"), borderWidth: 2, pointRadius: 0, tension: 0.25, spanGaps: true },
        { label: "Forecast", data: fc, borderColor: css("--teal"), backgroundColor: css("--teal"), borderDash: [6, 4], borderWidth: 3, pointRadius: [0].concat(Array(labels.length).fill(7)), spanGaps: true },
        { label: "Actual next day", data: act, borderColor: css("--ink"), backgroundColor: css("--panel"), pointRadius: 6, pointBorderWidth: 2, showLine: false } ] },
      options: { ...o, plugins: { ...o.plugins, legend: { display: true, labels: { boxWidth: 12, usePointStyle: true } } },
        scales: { x: { ticks: { maxTicksLimit: 7, callback: (v, i) => fmtDate(labels[i], { day: "numeric", month: "short" }) }, grid: { display: false } },
                  y: { min: 0, suggestedMax: 300, title: { display: true, text: "AQI" } } } } });
  }

  // ---------- today (live) ----------
  const STD = { "PM2.5": 60, PM10: 100, NO2: 80, SO2: 80, CO: 2, O3: 100 };
  let todayLoaded = false;
  function liveAccuracy() {
    const R = META.live_results || [], e = R.find((r) => r.model === "Ensemble"), p = R.find((r) => r.model === "Persistence");
    if (!e || !p) return "";
    return "The live model uses only the six pollutants stations report live, plus AQI history. On the untouched 2019-20 test year it scored MAE " +
      e.mae.toFixed(1) + " and R² " + e.r2.toFixed(3) + ", against " + p.mae.toFixed(1) + " for the “today = yesterday” guess (" + e["skill_%"].toFixed(1) + "% lower error).";
  }
  function todayMessage(title, html) {
    $("#t-body").hidden = true;
    $("#t-error").innerHTML = '<div class="panel" style="margin-top:20px"><h2>' + title + '</h2><div class="prose">' + html + "</div></div>";
  }
  async function showToday(refresh) {
    $("#t-acc").textContent = liveAccuracy();
    $("#t-when").textContent = refresh ? "Refreshing…" : "Fetching today’s Delhi readings…";
    let t;
    try { t = await api.today(refresh); }
    catch (e) {
      paintSky(150, $("#sky-today")); $("#t-num").hidden = true; $("#t-cat").hidden = true;
      $("#t-refresh").hidden = e.code === "preview" || e.code === "no_key";
      if (e.code === "preview") {
        $("#t-when").textContent = "Today’s forecast runs on the deployed site";
        $("#t-sub").textContent = "This preview has no internet access to live station data.";
        todayMessage("Live mode needs the deployed app", "<p>Today’s forecast pulls live CPCB station readings through the OpenAQ API, so it only runs on the deployed Vercel site with an API key set. Everything else in this preview works with the real 2015 to 2020 data.</p><p><a href=\"#forecast\">Open the history forecast</a></p>");
      } else if (e.code === "no_key") {
        $("#t-when").textContent = "Live data is not set up yet";
        $("#t-sub").textContent = "";
        todayMessage("Connect live data in two minutes", "<ol><li>Create a free account at explore.openaq.org and copy your API key from Settings.</li><li>In Vercel, open the project, then Settings, then Environment Variables. Add <b>OPENAQ_API_KEY</b> with your key.</li><li>Redeploy the project, then reload this page.</li></ol>");
      } else {
        $("#t-when").textContent = "Couldn’t load today’s forecast";
        $("#t-sub").textContent = "";
        todayMessage("Live data is unavailable right now", "<p>" + e.message + "</p><p>The history forecast still works. <a href=\"#forecast\">Open it</a>, or try “Refresh now” in a minute.</p>");
      }
      return;
    }
    todayLoaded = true; $("#t-error").innerHTML = ""; $("#t-body").hidden = false;
    $("#t-num").hidden = false; $("#t-cat").hidden = false; $("#t-refresh").hidden = false;
    paintSky(t.forecast, $("#sky-today"));
    $("#t-when").textContent = (t.is_today ? "Today’s forecast AQI, " : "Latest forecast AQI, ") + fmtDate(t.target, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    $("#t-num").textContent = r0(t.forecast);
    $("#t-cat i").style.background = catColor(t.category); $("#t-cat span").textContent = t.category;
    $("#t-sub").textContent = "Made from station readings up to the end of " + fmtDate(t.origin) + "." + (t.is_today ? "" : " Newer data wasn’t available yet.");
    $("#t-meta").textContent = t.stations.length + " CPCB stations in Delhi, via OpenAQ.";
    $("#t-fresh").textContent = "Updated " + new Date(t.fetched_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", day: "numeric", month: "short" }) + " IST." + (t.filled_days.length ? " Filled from the day before: " + t.filled_days.map((d) => fmtDate(d, { day: "numeric", month: "short" })).join(", ") + "." : "");
    $("#t-yday").innerHTML = r0(t.persistence) + "<small>" + categoryName(t.persistence) + "</small>";
    $("#t-yday-d").textContent = "City average for " + fmtDate(t.origin) + ".";
    const ch = t.forecast - t.persistence;
    $("#t-change").textContent = signed(ch);
    $("#t-change-d").textContent = Math.abs(ch) < 5 ? "About the same as yesterday." : ch > 0 ? "The air is expected to get worse." : "The air is expected to improve.";
    $("#t-stn").textContent = t.stations.length;
    $("#t-stn-d").textContent = t.stations.slice(0, 4).map((s) => s.name).join(", ") + (t.stations.length > 4 ? " and " + (t.stations.length - 4) + " more" : "");
    renderMembers("#t-members", t);
    const mx = Math.max(...Object.entries(t.latest).map(([k, v]) => v / STD[k]));
    $("#t-poll tbody").innerHTML = Object.entries(t.latest).map(([k, v]) => {
      const ratio = v / STD[k], w = Math.min(100, (100 * ratio) / Math.max(mx, 1)), col = ratio >= 1.5 ? css("--vpoor") : ratio >= 1 ? css("--poor") : css("--teal");
      return "<tr><td>" + k + "</td><td>" + v.toFixed(k === "CO" ? 2 : 1) + (k === "CO" ? " mg/m³" : " µg/m³") + "</td><td>" + STD[k] + "</td><td>" + ratio.toFixed(2) + '×</td><td><div class="bar"><b style="width:' + w.toFixed(1) + "%;background:" + col + '"></b></div></td></tr>';
    }).join("");
    renderTodayChart(t);
  }
  function categoryName(v) { return (CAT.find((c) => v <= c[1]) || CAT[5])[0]; }
  function renderTodayChart(t) {
    const labels = t.history.map((h) => h.date).concat([t.target]);
    const obs = t.history.map((h) => h.aqi).concat([null]);
    const fc = labels.map((d) => (d === t.origin ? t.persistence : d === t.target ? t.forecast : null));
    const o = baseOpts();
    chart("c-today", { type: "line", plugins: [bandPlugin], data: { labels, datasets: [
      { label: "Live city AQI", data: obs, borderColor: css("--ink"), borderWidth: 2, pointRadius: 2.5, tension: 0.25 },
      { label: "Forecast", data: fc, borderColor: css("--teal"), backgroundColor: css("--teal"), borderDash: [6, 4], borderWidth: 3, pointRadius: labels.map((d) => (d === t.target ? 7 : 0)), spanGaps: true } ] },
      options: { ...o, plugins: { ...o.plugins, legend: { display: true, labels: { boxWidth: 12, usePointStyle: true } } },
        scales: { x: { ticks: { maxTicksLimit: 8, callback: (v, i) => fmtDate(labels[i], { day: "numeric", month: "short" }) }, grid: { display: false } },
                  y: { min: 0, suggestedMax: 250, title: { display: true, text: "AQI" } } } } });
  }

  // ---------- what-if ----------
  const SL = [["PM2.5", 0, 800, 1], ["PM10", 0, 1000, 1], ["NO2", 0, 250, 1], ["NO", 0, 300, 1], ["O3", 0, 200, 1], ["SO2", 0, 120, 1], ["CO", 0, 15, 0.05], ["NH3", 0, 150, 1], ["AQI", 0, 999, 1]];
  let wBase = null, wTimer = null;
  async function setupWhatIf(date) {
    let f; try { f = await api.forecast(date); } catch (e) { $("#w-err").innerHTML = '<div class="err">No data for ' + date + ". Pick a date from " + fmtDate(META.range.min) + " to " + fmtDate(META.range.max) + ".</div>"; if (wBase) $("#w-date").value = wBase.origin; return; }
    wBase = f; $("#w-date").value = f.origin; $("#w-err").innerHTML = "";
    $("#w-sliders").innerHTML = SL.map(([k, mn, mx, st]) => {
      const v = k === "AQI" ? f.features.AQI_lag0 : f.features[k];
      const id = "s-" + k.replace(".", "");
      return '<div class="sl"><label for="' + id + '">' + (k === "AQI" ? "Today’s AQI" : k) + ' <span id="' + id + '-v">' + (+v).toFixed(st < 1 ? 2 : 0) + '</span></label><input type="range" id="' + id + '" data-k="' + k + '" min="' + mn + '" max="' + Math.max(mx, Math.ceil(v)) + '" step="' + st + '" value="' + v + '"></div>';
    }).join("");
    $("#w-sliders").querySelectorAll("input").forEach((inp) => inp.addEventListener("input", () => {
      $("#" + inp.id + "-v").textContent = (+inp.value).toFixed(+inp.step < 1 ? 2 : 0); clearTimeout(wTimer); wTimer = setTimeout(runWhatIf, 180);
    }));
    $("#w-base").textContent = r0(f.forecast) + " (" + f.category + ")";
    runWhatIf();
  }
  async function runWhatIf() {
    const ov = {}; $("#w-sliders").querySelectorAll("input").forEach((i) => (ov[i.dataset.k] = +i.value));
    let f; try { f = await api.whatif(wBase.origin, ov); } catch (e) { $("#w-err").innerHTML = '<div class="err">' + e.message + "</div>"; return; }
    $("#w-err").innerHTML = "";
    $("#w-target").textContent = fmtDate(f.target);
    $("#w-num").textContent = r0(f.forecast);
    const pill = $("#w-cat"); pill.textContent = f.category; pill.style.background = catColor(f.category); pill.style.color = ["Very Poor", "Severe"].includes(f.category) ? "#fff" : "#1E262C";
    const d = f.forecast - wBase.forecast; $("#w-delta").textContent = Math.abs(d) < 0.5 ? "Same as the real forecast." : signed(d) + " AQI points compared with the real readings.";
    $("#w-type").innerHTML = '<span class="type-swatch" style="background:' + typeColor(f.day_type) + '"></span>' + f.day_type;
    renderMembers("#w-members", f);
  }

  // ---------- day types ----------
  function renderDayTypes() {
    const P = META.profiles;
    $("#types").innerHTML = META.type_order.map((t) => {
      const p = P.find((x) => x.type === t);
      return '<div class="panel type-card"><h3><span class="dot" style="background:' + typeColor(t) + '"></span>' + t + '</h3><p class="lbl" style="margin:4px 0 0">' + (TYPE_TEXT[t] || "") + "</p><dl>" +
        "<dt>Mean AQI</dt><dd>" + r0(p.AQI_lag0) + "</dd><dt>PM2.5 / PM10</dt><dd>" + r0(p["PM2.5"]) + " / " + r0(p.PM10) + "</dd><dt>PM2.5 to PM10 ratio</dt><dd>" + p.PM_ratio.toFixed(2) +
        "</dd><dt>NO2</dt><dd>" + r0(p.NO2) + "</dd><dt>Training days</dt><dd>" + p["Days (train)"] + "</dd><dt>Test days</dt><dd>" + p["Days (test)"] + "</dd></dl></div>";
    }).join("");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], o = baseOpts();
    chart("c-share", { type: "bar", data: { labels: months, datasets: META.type_order.map((t) => ({ label: t, data: META.month_share[t], backgroundColor: typeColor(t), borderWidth: 0 })) },
      options: { ...o, plugins: { ...o.plugins, legend: { display: true, position: "bottom", labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: (c) => c.dataset.label + ": " + c.raw.toFixed(0) + "%" } } },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, max: 100, ticks: { callback: (v) => v + "%" } } } } });
    $("#strip").innerHTML = META.test.type.map((t, i) => '<i title="' + fmtDate(META.test.dates[i]) + ": " + t + '" style="background:' + typeColor(t) + '"></i>').join("");
    $("#strip-legend").innerHTML = META.type_order.map((t) => '<span><span class="type-swatch" style="background:' + typeColor(t) + '"></span>' + t + "</span>").join("");
    const C = META.clusters;
    $("#t-clusters").innerHTML = "<thead><tr><th>Method</th><th>Clusters</th><th>Noise</th><th>Silhouette ↑</th><th>Davies-Bouldin ↓</th><th>Calinski-Harabasz ↑</th></tr></thead><tbody>" +
      C.map((c, i) => "<tr" + (i === 0 ? ' class="hl"' : "") + "><td>" + c.Method + "</td><td>" + c.Clusters + "</td><td>" + c["Noise %"].toFixed(1) + "%</td><td>" + c.Silhouette.toFixed(3) + "</td><td>" + c["Davies-Bouldin"].toFixed(3) + "</td><td>" + c["Calinski-Harabasz"].toFixed(0) + "</td></tr>").join("") + "</tbody>";
  }

  // ---------- model ----------
  function renderModel() {
    const R = META.results, sel = R.find((r) => r.Approach === META.selected), per = R.find((r) => r.Approach === "Persistence");
    $("#m-mae").innerHTML = sel["Test MAE"].toFixed(1) + "<small>AQI points</small>"; $("#m-mae-d").textContent = "Persistence: " + per["Test MAE"].toFixed(1) + ", so " + sel["MAE skill vs persistence %"].toFixed(1) + "% lower error.";
    $("#m-r2").textContent = sel["Test R2"].toFixed(3); $("#m-r2-d").textContent = "Persistence: " + per["Test R2"].toFixed(3) + ".";
    const o = baseOpts(), T = META.test;
    chart("c-test", { type: "line", plugins: [bandPlugin], data: { labels: T.dates, datasets: [
      { label: "Actual", data: T.actual, borderColor: css("--ink"), borderWidth: 1.3, pointRadius: 0 },
      { label: "Persistence", data: T.persistence, borderColor: css("--muted"), borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
      { label: "Forecast", data: T.selected, borderColor: css("--monsoon"), borderWidth: 2, pointRadius: 0 } ] },
      options: { ...o, plugins: { ...o.plugins, legend: { display: true, labels: { boxWidth: 12 } } },
        scales: { x: { ticks: { maxTicksLimit: 8, callback: (v, i) => fmtDate(T.dates[i], { month: "short", year: "2-digit" }) }, grid: { display: false } }, y: { min: 0, title: { display: true, text: "AQI" } } } } });
    const rs = [...R].sort((a, b) => a["Test MAE"] - b["Test MAE"]);
    const gcol = { Baseline: css("--muted"), Global: css("--ink"), "Global + day-type": css("--monsoon"), "Per-day-type": css("--dust") };
    chart("c-mae", { type: "bar", data: { labels: rs.map((r) => r.Approach), datasets: [{ data: rs.map((r) => r["Test MAE"]), backgroundColor: rs.map((r) => (r.Approach === META.selected ? css("--teal") : gcol[r.Group])), borderRadius: 4 }] },
      options: { ...o, indexAxis: "y", plugins: { ...o.plugins, tooltip: { callbacks: { label: (c) => "MAE " + c.raw.toFixed(2) } } }, scales: { x: { min: 0, title: { display: true, text: "Test MAE (lower is better)" } }, y: { grid: { display: false }, ticks: { font: { size: 11.5 } } } } } });
    const imp = Object.entries(META.importance).slice(0, 10);
    chart("c-imp", { type: "bar", data: { labels: imp.map((x) => x[0]), datasets: [{ data: imp.map((x) => x[1]), backgroundColor: css("--teal"), borderRadius: 4 }] },
      options: { ...o, indexAxis: "y", scales: { x: { min: 0, title: { display: true, text: "Rise in MAE when shuffled (AQI points)" } }, y: { grid: { display: false } } } } });
    $("#t-results").innerHTML = "<thead><tr><th>Approach</th><th>Strategy</th><th>CV MAE (train)</th><th>Test MAE</th><th>Test RMSE</th><th>Test R²</th><th>vs persistence</th></tr></thead><tbody>" +
      [...R].sort((a, b) => a["CV MAE (train)"] - b["CV MAE (train)"]).map((r) => "<tr" + (r.Approach === META.selected ? ' class="hl"' : "") + "><td>" + r.Approach + "</td><td>" + r.Group + "</td><td>" + r["CV MAE (train)"].toFixed(2) + "</td><td>" + r["Test MAE"].toFixed(2) + "</td><td>" + r["Test RMSE"].toFixed(2) + "</td><td>" + r["Test R2"].toFixed(3) + "</td><td>" + (r["MAE skill vs persistence %"] >= 0 ? "+" : "") + r["MAE skill vs persistence %"].toFixed(1) + "%</td></tr>").join("") + "</tbody>";
  }

  // ---------- routing ----------
  const VIEWS = ["today", "forecast", "whatif", "daytypes", "model"], rendered = {};
  function route() {
    const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : (mode === "local" ? "forecast" : "today");
    VIEWS.forEach((x) => { $("#v-" + x).hidden = x !== v; });
    document.querySelectorAll("nav.tabs a").forEach((a) => { if (a.getAttribute("href") === "#" + v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    if (!META) return;
    if (v === "whatif" && !rendered.whatif) { rendered.whatif = 1; setupWhatIf(current ? current.origin : "2019-11-02"); }
    // draw after the section is laid out, so charts measure their real width
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (v === "daytypes") renderDayTypes();
      if (v === "model") renderModel();
      if (v === "forecast" && current) renderHistory(current);
      if (v === "today") { if (!rendered.today) { rendered.today = 1; showToday(false); } else if (todayLoaded) showToday(false); }
    }));
  }

  async function init() {
    try { META = await api.meta(); }
    catch (e) { $("#status span").textContent = "Backend unreachable"; $("#f-when").textContent = "Could not reach the forecast API. Run it with `vercel dev` or `npm run dev`."; return; }
    const st = $("#status"); st.classList.toggle("local", mode === "local");
    st.querySelector("span").textContent = mode === "local" ? "Preview: models run in your browser" : "Live: models run on the server";
    for (const id of ["#date", "#w-date"]) { $(id).min = META.range.min; $(id).max = META.range.max; }
    $("#date").addEventListener("change", (e) => e.target.value && showForecast(e.target.value));
    $("#w-date").addEventListener("change", (e) => e.target.value && setupWhatIf(e.target.value));
    $("#w-reset").addEventListener("click", () => setupWhatIf(wBase ? wBase.origin : "2019-11-02"));
    $("#t-refresh").addEventListener("click", () => showToday(true));
    document.querySelectorAll(".chip[data-date]").forEach((b) => b.addEventListener("click", () => showForecast(b.dataset.date)));
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", route);
    window.addEventListener("hashchange", route);
    await showForecast("2019-11-02");
    route();
  }
  init();
})();
