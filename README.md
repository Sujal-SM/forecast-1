# Delhi AQI Forecast (web app)

Working frontend and backend for the MLDA project "Delhi Air Quality: Day-Type Clustering and Next-Day AQI Forecasting".
The backend runs the **same trained models** as the notebook (LR + Random Forest + Gradient Boosting ensemble and the
K-Means day-type model), exported to JSON. On all 1,996 forecastable days its output matches scikit-learn to within
0.0000001 AQI points, and it reproduces the report's test MAE of 25.53.

## Live "Today" forecast

The **Today** tab forecasts today's Delhi AQI from live CPCB station data (via the OpenAQ API). It uses a separate
**live model** trained on the same 2015-2020 data but with only the six pollutants stations report live
(PM2.5, PM10, NO2, SO2, CO, O3) plus AQI history. Test year 2019-20: MAE 25.69, R² 0.910, 18.8% better than
persistence (the full model: 25.53). Live AQI is computed per station with the CPCB formula and averaged across
stations, so it can differ from the official CPCB bulletin.

Setup: create a free key at explore.openaq.org, add it in Vercel as the environment variable `OPENAQ_API_KEY`,
then redeploy. Without the key the Today tab shows these steps and the rest of the app works normally.

## Deploy to Vercel

1. Push this folder to a GitHub repo (or run `npx vercel` inside it).
2. Import the repo in Vercel. No framework, no build command, no environment variables needed.
3. `vercel.json` already sets `public/` as the site and `api/*.js` as serverless functions.

## Run locally

```bash
node dev-server.js          # http://localhost:3000, no installs needed
OPENAQ_API_KEY=your_key node dev-server.js   # with live data
# or, with the Vercel CLI:  vercel dev
```

## API

| Endpoint | What it does |
|---|---|
| `GET /api/forecast?date=2019-11-02` | Forecast for the day after `date`, plus actual AQI, persistence, model breakdown, day type, 45-day history and pollutant readings |
| `POST /api/forecast` with `{"date":"2019-11-02","overrides":{"PM2.5":80,"AQI":180}}` | What-if: edits that day's readings, rebuilds all features and re-runs the models |
| `GET /api/today` | Live forecast for today from the last complete day of Delhi station data (needs `OPENAQ_API_KEY`) |
| `GET /api/meta` | Model results, test-year predictions, day-type profiles, clustering comparison |

Valid dates: 2015-01-14 to 2020-07-01. Editable fields: PM2.5, PM10, NO, NO2, NOx, NH3, CO, SO2, O3, Benzene, Toluene, AQI (0 to 2000).

## Folders

| Path | Contents |
|---|---|
| `api/` | Vercel serverless functions |
| `lib/live.js` | Live mode: OpenAQ client, CPCB AQI formula, live model inference |
| `lib/engine.js` | Feature engineering + model inference (shared by server and preview build) |
| `data/` | `model.json` (exported models), `live_model.json` (live model), `days.json` (Delhi daily data), `meta.json` (results) |
| `public/` | The website (HTML, JS, Chart.js vendored, no CDN needed) |
| `src/` | Frontend source; `python3 build.py` regenerates `public/` and `preview/` |
| `preview/index.html` | Single-file version that runs the models in the browser (no server) |
| `tools/export_model.py` | Re-exports `data/` from the notebook's `artifacts/` after retraining |
