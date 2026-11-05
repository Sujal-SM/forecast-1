// GET  /api/forecast?date=2019-11-01            -> next-day forecast for that origin date
// POST /api/forecast {date, overrides:{...}}     -> what-if forecast with edited readings for that day
const load = require("../lib/load.js");
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const EDITABLE = new Set(["PM2.5", "PM10", "NO", "NO2", "NOx", "NH3", "CO", "SO2", "O3", "Benzene", "Toluene", "AQI"]);

module.exports = (req, res) => {
  const { engine } = load();
  let date, overrides = null;
  if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    date = body.date;
    overrides = {};
    for (const [k, v] of Object.entries(body.overrides || {})) {
      const n = Number(v);
      if (!EDITABLE.has(k) || !Number.isFinite(n) || n < 0 || n > 2000) return res.status(400).json({ error: `Invalid value for ${k}. Use a number from 0 to 2000.` });
      overrides[k] = n;
    }
  } else if (req.method === "GET") {
    date = (req.query && req.query.date) || engine.range.max;
  } else return res.status(405).json({ error: "Use GET or POST." });

  if (!ISO.test(date || "")) return res.status(400).json({ error: "Send date as YYYY-MM-DD." });
  const out = engine.forecast(date, overrides);
  if (out.error) return res.status(400).json(out);
  res.setHeader("Cache-Control", req.method === "GET" ? "s-maxage=86400" : "no-store");
  res.status(200).json({ ...out, history: engine.history(date), pollutants: engine.pollutants(date) });
};
