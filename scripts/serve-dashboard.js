/** Tiny static server for the dashboard (no dependencies).
 *  Usage: npm run dashboard   →   http://localhost:8080 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "dashboard");
const port = process.env.PORT || 8080;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

http
  .createServer((req, res) => {
    const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const file = path.join(root, path.normalize(urlPath));
    if (!file.startsWith(root) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`SettleMesh dashboard → http://localhost:${port}`));
