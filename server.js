// ============================================================
// server.js, Lokaler Webserver + Update-API (keine Dependencies)
// Start:  npm start   →  http://localhost:8420
//
// Endpunkte:
//   GET /api/update[?force=1] , startet das Daten-Update aus dem
//                                GitHub-Repo und streamt den Fort-
//                                schritt zeilenweise (für den
//                                Update-Knopf in der App)
//   Alles andere              , statische Dateien aus public/
// ============================================================
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runUpdate } from './tools/updater.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const PORT = process.env.PORT || 8420;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.pdf': 'application/pdf', '.webp': 'image/webp',
};

let updateRunning = false; // Doppelstart verhindern

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // == Update-API ============================================
  if (url.pathname === '/api/update') {
    if (updateRunning) {
      res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Update läuft bereits.');
    }
    updateRunning = true;

    // Fortschritt zeilenweise streamen (Chunked Transfer)
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });

    try {
      const result = await runUpdate({
        force: url.searchParams.get('force') === '1',
        log: line => res.write(line + '\n'),
      });
      res.write('RESULT ' + JSON.stringify(result) + '\n');
    } catch (e) {
      res.write('✗ Schwerer Fehler: ' + e.message + '\n');
    } finally {
      updateRunning = false;
      res.end();
    }
    return;
  }

  // == Shutdown-API ==========================================
  // Beim unsichtbaren Start (Start.vbs) gibt es kein Konsolen-
  // fenster zum Schliessen, die App beendet den Server selbst.
  if (url.pathname === '/api/shutdown') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Server wird beendet.');
    console.log('Shutdown über die App angefordert.');
    setTimeout(() => process.exit(0), 300); // Antwort noch ausliefern
    return;
  }

  // == Statische Dateien =====================================
  try {
    let path = normalize(decodeURIComponent(url.pathname));
    if (path === '/' || path === '\\') path = '/index.html';
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }

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
    // Bereits eine Instanz aktiv (z. B. Doppelklick auf Start.vbs):
    // still beenden, der Browser zeigt die laufende Instanz.
    console.log('Server läuft bereits auf Port ' + PORT + ', zweite Instanz beendet sich.');
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`\n  D&D 5e Studio läuft auf  →  http://localhost:${PORT}\n`);
});
