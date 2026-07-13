// ============================================================
// tools/update.js - CLI wrapper for the update library
// Usage:  npm run update  [--force]
// (The app can also trigger the update via button → server.js)
// ============================================================
import { runUpdate } from './updater.js';

console.log('════════════════════════════════════════════');
console.log(' D&D 5e Studio - Update aus GitHub-Repository');
console.log(' Quelle: 5etools-mirror-3/5etools-src (data/)');
console.log('════════════════════════════════════════════');

const result = await runUpdate({
  force: process.argv.includes('--force'),
  log: line => console.log(line),
});

if (result.newBooks.length) {
  console.log('\nNeue Regelwerke:');
  result.newBooks.forEach(b => console.log('  + ' + b));
}
if (!result.ok) process.exitCode = 1;
