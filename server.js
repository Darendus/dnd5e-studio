// ============================================================
// server.js, local web server + update API (no dependencies)
// Start:  npm start   →  http://localhost:8420
//
// Endpoints:
//   GET /api/update[?force=1] , starts the data update from the
//                                GitHub repo and streams progress
//                                line by line (for the update
//                                button in the app)
//   Everything else           , static files from public/
// ============================================================
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runUpdate } from './tools/updater.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const PORT = process.env.PORT || 8420;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.pdf': 'application/pdf', '.webp': 'image/webp',
};

let updateRunning = false;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // == Update-API ============================================
  if (url.pathname === '/api/update') {
    if (updateRunning) {
      res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Update läuft bereits.');
    }
    updateRunning = true;

    // stream progress line by line (chunked transfer)
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });

    // if the client disconnects mid-update, writing to the dead socket
    // would emit an unhandled 'error' (EPIPE) and could take the server
    // down — swallow it and guard each write.
    res.on('error', () => {});
    const write = line => { if (!res.writableEnded && !res.destroyed) res.write(line + '\n'); };

    try {
      const result = await runUpdate({
        force: url.searchParams.get('force') === '1',
        log: write,
      });
      write('RESULT ' + JSON.stringify(result));
    } catch (e) {
      write('✗ Schwerer Fehler: ' + e.message);
    } finally {
      updateRunning = false;
      res.end();
    }
    return;
  }

  // == Shutdown API ==========================================
  // When started invisibly (Start.vbs) there is no console
  // window to close, so the app shuts down the server itself.
  if (url.pathname === '/api/shutdown') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Server wird beendet.');
    console.log('Shutdown über die App angefordert.');
    setTimeout(() => process.exit(0), 300); // still deliver the response
    return;
  }

  // == Static files ==========================================
  try {
    let path = normalize(decodeURIComponent(url.pathname));
    if (path === '/' || path === '\\') path = '/index.html';
    const file = join(ROOT, path);
    // must stay inside ROOT: compare against ROOT + separator so a sibling
    // directory whose name merely starts with "public" can't slip through
    if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403); return res.end(); }

    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404, Nicht gefunden');
  }
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    // An instance is already active (e.g. double-click on Start.vbs):
    // exit quietly, the browser shows the running instance.
    console.log('Server läuft bereits auf Port ' + PORT + ', zweite Instanz beendet sich.');
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`\n  D&D 5e Studio läuft auf  →  http://localhost:${PORT}\n`);
});
