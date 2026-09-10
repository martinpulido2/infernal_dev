// server.js
//
// Zero-dependency static server so StackBlitz's WebContainer has
// something to boot (`npm install` finds no dependencies to fetch, so
// this starts instantly — no registry round-trip to fail on). Sets
// Content-Type explicitly per extension, which matters more than it
// looks: browsers refuse to execute a <script type="module"> if the
// response's MIME type isn't a JS type, even if the bytes are fine — a
// generic static server that serves everything as
// application/octet-stream (or guesses wrong) will make every import in
// index.html silently fail with "Failed to load module script" in the
// console, which looks like a boot problem but is actually this.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  // Resolve + confine to ROOT so a crafted URL can't escape the project
  // directory (basic path-traversal guard -- harmless here, but cheap
  // and standard practice for anything that touches fs + a URL).
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${urlPath}`);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Serving ${ROOT} on port ${PORT}`);
});

// Replace server.listen(...) with an export check:
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Serving ${ROOT} on port ${PORT}`);
  });
}

// Export for Vercel's serverless environment
module.exports = server;
