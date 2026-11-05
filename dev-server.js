// Local preview without the Vercel CLI: node dev-server.js  ->  http://localhost:3000
const http = require("http"), fs = require("fs"), path = require("path"), url = require("url");
const handlers = { "/api/forecast": require("./api/forecast.js"), "/api/meta": require("./api/meta.js"), "/api/today": require("./api/today.js") };
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  if (handlers[u.pathname]) {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", () => {
      req.query = u.query; req.body = body;
      res.status = (c) => { res.statusCode = c; return res; };
      res.json = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
      Promise.resolve(handlers[u.pathname](req, res)).catch((e) => { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); });
    });
    return;
  }
  const f = path.join(__dirname, "public", u.pathname === "/" ? "index.html" : u.pathname);
  fs.readFile(f, (e, d) => { if (e) { res.statusCode = 404; return res.end("Not found"); } res.setHeader("Content-Type", types[path.extname(f)] || "text/plain"); res.end(d); });
}).listen(process.env.PORT || 3000, () => console.log("http://localhost:" + (process.env.PORT || 3000)));
