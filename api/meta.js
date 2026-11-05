// GET /api/meta -> model results, test-year predictions, day-type profiles, date range
const load = require("../lib/load.js");
module.exports = (req, res) => {
  const { engine, meta } = load();
  res.setHeader("Cache-Control", "s-maxage=86400");
  res.status(200).json({ ...meta, range: engine.range });
};
