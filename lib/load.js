// Loads the engine once per serverless instance.
const { create } = require("./engine.js");
const model = require("../data/model.json");
const days = require("../data/days.json");
const meta = require("../data/meta.json");
let engine;
module.exports = () => { if (!engine) engine = create(model, days); return { engine, meta }; };
