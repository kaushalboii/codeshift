/**
 * CodeShift — Production-Grade Zero-Dependency Development Server
 * "Think together. Code without limits."
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const BASE_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // Default to index.html
  if (pathname === '/' || pathname.startsWith('/room/')) {
    pathname = '/index.html';
  }

  let filePath = path.join(BASE_DIR, pathname);

  // Security check: prevent directory traversal
  if (!filePath.startsWith(BASE_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for client-side routing
      const indexPath = path.join(BASE_DIR, 'index.html');
      fs.readFile(indexPath, (readErr, content) => {
        if (readErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(content);
        }
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
        return;
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
        'X-Powered-By': 'CodeShift Server'
      });
      res.end(data);
    });
  });
});

server.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('  ⚡ CODESHIFT — Real-Time Collaborative Workspace');
  console.log('  "Think together. Code without limits."');
  console.log('='.repeat(60));
  console.log(`\n  🚀 Server active at: \x1b[36mhttp://localhost:${PORT}\x1b[0m`);
  console.log(`  📁 Workspace root:   \x1b[90m${BASE_DIR}\x1b[0m`);
  console.log(`  🎨 Brand Assets:     \x1b[90m${path.join(BASE_DIR, 'brand')}\x1b[0m\n`);
  console.log('  Press Ctrl+C to terminate server.\n');
});

