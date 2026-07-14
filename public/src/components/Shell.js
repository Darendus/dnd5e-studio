// ============================================================
// components/Shell.js, tab navigation + save/export/import
// ============================================================
import { bus, EV } from '../core/EventBus.js';
import { store }   from '../core/Store.js';
import { t }       from '../core/i18n.js';
import { showCharacterSelect } from './CharacterSelect.js';
import { druidLevel } from '../rules/wildshape.js';
import { exportToPdf } from '../utils/pdfExport.js';

const TAB_IDS = ['core','classes','combat','skills','spells','inventory','description','sections','dice','generator','settings'];

/** Active tab list:
 *  • wild shape only with a druid (level 2+), also in multiclassing
 *  • generator ONLY for a new, not-yet-saved character
 *    (opened via the "New" button) */
function visibleTabs() {
  let ids = [...TAB_IDS];
  if (druidLevel(store.field('classes')) >= 2) {
    ids.splice(ids.indexOf('combat') + 1, 0, 'wildshape');
  }
  if (!store.isNew()) ids = ids.filter(id => id !== 'generator');
  return ids;
}

export function mountShell() {
  renderTabs();
  renderToolbar();
  bus.on(EV.LANG_CHANGED, () => { renderTabs(); renderToolbar(); });
  // Tab visibility can change (druid added, character saved/loaded
  // → generator disappears). Compare a signature.
  let tabSig = visibleTabs().join(',');
  const refreshTabs = () => {
    const sig = visibleTabs().join(',');
    if (sig === tabSig) return;
    tabSig = sig;
    if (!sig.split(',').includes(activeTab)) {
      activeTab = 'core';
      document.querySelectorAll('.tab-panel').forEach(p =>
        p.classList.toggle('active', p.id === 'tab-core'));
    }
    renderTabs();
  };
  bus.on(EV.CHAR_CHANGED, refreshTabs);
  bus.on(EV.CHAR_LOADED, refreshTabs);
}

// == Tabs =====================================================
let activeTab = 'core';

function renderTabs() {
  const nav = document.getElementById('tabs');
  nav.innerHTML = visibleTabs().map(id =>
    `<button class="tab ${id === activeTab ? 'active' : ''}" data-tab="${id}">${t('tabs.' + id)}</button>`
  ).join('');

  nav.onclick = e => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    activeTab = btn.dataset.tab;
    nav.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach(p =>
      p.classList.toggle('active', p.id === 'tab-' + activeTab));
  };

  // activate the first tab
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('active', p.id === 'tab-' + activeTab));
}

// == IO bar ====================================================
function renderToolbar() {
  const bar = document.getElementById('toolbar-io');
  bar.innerHTML = `
    <button class="btn btn--sm btn--gold" id="ioChars">${t('select.switch')}</button>
    <button class="btn btn--sm" id="ioExport">⬇ ${t('app.export')}</button>
    <button class="btn btn--sm" id="ioPdf">${t('app.exportPdf')}</button>
    <label class="btn btn--sm" for="ioImportFile">⬆ ${t('app.import')}</label>
    <input type="file" id="ioImportFile" accept=".json" style="display:none">
    <button class="btn btn--sm" id="ioUndo" title="Undo">↶</button>
    <button class="btn btn--sm btn--danger" id="ioReset">↺ ${t('app.reset')}</button>`;

  bar.querySelector('#ioChars').onclick = () => showCharacterSelect();

  bar.querySelector('#ioPdf').onclick = async () => {
    try { await exportToPdf(store.get()); }
    catch (e) { bus.emit(EV.TOAST, { message: '✗ PDF: ' + e.message }); }
  };

  bar.querySelector('#ioExport').onclick = () => {
    const name = (store.field('name') || 'character').toLowerCase().replace(/\s+/g, '_');
    const blob = new Blob([store.exportJson()], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: `${name}_dnd5e.json`,
    });
    a.click(); URL.revokeObjectURL(a.href);
    bus.emit(EV.TOAST, { message: '✓ Export' });
  };

  bar.querySelector('#ioImportFile').onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const ok = store.importJson(ev.target.result);
      bus.emit(EV.TOAST, { message: ok ? '✓ Import' : '✗ Invalid file' });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  bar.querySelector('#ioUndo').onclick = () => store.undo();

  bar.querySelector('#ioReset').onclick = () => {
    if (confirm(t('app.confirm'))) store.reset();
  };
}
