// GET /api/today -> forecast for today (IST) from the last complete day of live Delhi CPCB data (OpenAQ v3).
// Needs the OPENAQ_API_KEY environment variable (free key from explore.openaq.org).
const live = require("../lib/live.js");
const model = require("../data/live_model.json");
let cache = null; // reused while the serverless instance is warm
const TTL = 30 * 60 * 1000;

module.exports = async (req, res) => {
  const apiKey = process.env.OPENAQ_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "Live data is not set up. Add OPENAQ_API_KEY in Vercel settings, then redeploy.", code: "no_key" });
  try {
    if (!cache || Date.now() - cache.at > TTL || (req.query && req.query.refresh === "1")) {
      const data = await live.fetchDelhiDaily({ apiKey });
      const f = live.forecastFromSeries(model, data.series);
      cache = { at: Date.now(), body: {
        ...f, category: live.categoryOf(f.forecast), today: data.today, last_full_day: data.lastFull,
        is_today: f.target === data.today, stations: data.stations, filled_days: data.filled,
        history: data.series.map((r) => ({ date: r.date, aqi: r.AQI, stations: r.stations })),
        latest: Object.fromEntries(live.P6.map((p) => [p, data.series[data.series.length - 1][p]])),
        model: { selected: model.selected, results: model.results }, fetched_at: new Date().toISOString(),
      } };
    }
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=600");
    res.status(200).json(cache.body);
  } catch (e) {
    res.status(502).json({ error: e.message, code: e.code || "upstream", model: { selected: model.selected, results: model.results } });
  }
};
