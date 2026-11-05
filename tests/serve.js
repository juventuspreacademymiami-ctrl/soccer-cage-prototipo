// Servidor estático mínimo para probar docs/ en local.
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = require('path').join(__dirname, '..', 'docs');
const PORT = 8790;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(path.normalize(ROOT))) { res.writeHead(403); return res.end(); }
  fs.readFile(fp, (err, data) => {
    if (err) {
      // Como Cloudflare Pages: una ruta sin archivo (/camps, /panel) devuelve la página.
      if (!path.extname(p)) return fs.readFile(path.join(ROOT, 'index.html'), (e2, html) => {
        res.writeHead(200, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-store' });
        res.end(html);
      });
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(fp).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => console.log('listo en http://localhost:' + PORT));
