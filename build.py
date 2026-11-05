"""Builds public/index.html (Vercel: API mode) and preview/index.html (single file, models run in the browser)."""
import json, os, shutil
R = os.path.dirname(os.path.abspath(__file__))
tpl = open(f"{R}/src/index.template.html").read()
shutil.copy(f"{R}/src/app.js", f"{R}/public/app.js"); shutil.copy(f"{R}/lib/engine.js", f"{R}/public/engine.js")
open(f"{R}/public/index.html", "w").write(tpl.replace("<!--SCRIPTS-->",
    '<script src="/vendor/chart.umd.js"></script>\n<script src="/app.js"></script>'))
safe = lambda s: s.replace("</", "<\\/")
embed = {k: json.load(open(f"{R}/data/{k}.json")) for k in ["model", "days", "meta"]}
scripts = ("<script>" + safe(open(f"{R}/public/vendor/chart.umd.js").read()) + "</script>\n"
           "<script>" + safe(open(f"{R}/lib/engine.js").read()) + "</script>\n"
           "<script>window.AQI_EMBED=" + safe(json.dumps(embed, separators=(",", ":"))) + ";</script>\n"
           "<script>" + safe(open(f"{R}/src/app.js").read()) + "</script>")
os.makedirs(f"{R}/preview", exist_ok=True)
open(f"{R}/preview/index.html", "w").write(tpl.replace("<!--SCRIPTS-->", scripts))
print("preview size MB", round(os.path.getsize(f"{R}/preview/index.html") / 1e6, 2))
