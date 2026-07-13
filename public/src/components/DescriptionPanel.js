// ============================================================
// components/DescriptionPanel.js, Charakterbeschreibung
// ------------------------------------------------------------
// • DropZone für ein Charakterbild: Bild hineinziehen ODER
//   anklicken zum Auswählen. Das Bild wird clientseitig auf
//   max. 640 px verkleinert (JPEG) und im Charakter gespeichert,
//   damit localStorage nicht überläuft.
// • Freitext-Blöcke: beliebig viele Blöcke mit eigenem Titel,
//   in denen der Spieler den Charakter beschreiben kann
//   (Standard: Aussehen, Persönlichkeit, Hintergrundgeschichte).
// ============================================================
import { store }   from '../core/Store.js';
import { bus, EV } from '../core/EventBus.js';
import { t }       from '../core/i18n.js';


// Standard-Auswahl für die Comboboxen (englische Spielbegriffe,
// konsistent zu Zauber-/Item-Namen und dem offiziellen PDF-Bogen).
// Die Felder bleiben freie Textfelder, die Auswahl HÄNGT nur AN.
const LANGUAGES = [
  'Common', 'Common Sign Language', 'Dwarvish', 'Elvish', 'Giant', 'Gnomish',
  'Goblin', 'Halfling', 'Orc', 'Abyssal', 'Celestial', 'Deep Speech',
  'Draconic', 'Infernal', 'Primordial', 'Sylvan', 'Undercommon', 'Thieves\' Cant', 'Druidic',
];
const PROFICIENCIES = [
  'Light armor', 'Medium armor', 'Heavy armor', 'Shields',
  'Simple weapons', 'Martial weapons',
  'Thieves\' tools', 'Herbalism kit', 'Disguise kit', 'Forgery kit', 'Poisoner\'s kit',
  'Alchemist\'s supplies', 'Brewer\'s supplies', 'Smith\'s tools', 'Tinker\'s tools',
  'Cook\'s utensils', 'Navigator\'s tools', 'Cartographer\'s tools',
  'Gaming set', 'Musical instrument', 'Vehicles (land)', 'Vehicles (water)',
];

export function mountDescription() {
  render();
  bus.on(EV.CHAR_CHANGED, ({ changed }) => {
    // Nur bei strukturellen Änderungen neu rendern; Texteingaben
    // werden "leise" gespeichert (Fokus bleibt erhalten).
    if (changed.includes('*') || changed.includes('portrait')) return render();
    if (changed.includes('descriptionBlocks') && structureChanged()) render();
  });
  bus.on(EV.LANG_CHANGED, render);
}

// Struktur-Erkennung: Anzahl/IDs der Blöcke vergleichen
let lastIds = '';
function structureChanged() {
  const ids = (store.field('descriptionBlocks') ?? []).map(b => b.id).join(',');
  const changed = ids !== lastIds;
  lastIds = ids;
  return changed;
}

function render() {
  const el = document.getElementById('tab-description');
  const s  = store.get();
  const blocks = s.descriptionBlocks ?? [];
  lastIds = blocks.map(b => b.id).join(',');

  el.innerHTML = `
  <div class="panel-row">
    <!-- Bild-DropZone -->
    <div class="panel">
      <div class="panel__title">${t('desc.portrait')}</div>
      <div class="dropzone ${s.portrait ? 'dropzone--filled' : ''}" id="descDrop" tabindex="0">
        ${s.portrait
          ? `<img class="dropzone__img" src="${s.portrait}" alt="${t('desc.portrait')}">`
          : `<div class="dropzone__hint">
               <div class="dropzone__icon">＋</div>
               <div>${t('desc.dropHint')}</div>
             </div>`}
      </div>
      <input type="file" id="descFile" accept="image/*" style="display:none">
      ${s.portrait ? `
      <div style="display:flex;gap:8px;margin-top:10px;justify-content:center">
        <button class="btn btn--sm" id="descReplace">${t('desc.replace')}</button>
        <button class="btn btn--sm btn--danger" id="descRemove">${t('app.remove')}</button>
      </div>` : ''}
    </div>

    <!-- Hinweis / Verwaltung -->
    <div class="panel">
      <div class="panel__title">${t('desc.title')}
        <button class="btn btn--sm btn--gold" id="descAddBlock">+ ${t('desc.addBlock')}</button>
      </div>
      <p class="panel__hint">${t('desc.hint')}</p>
    </div>
  </div>

  ${blocks.map(b => `
    <div class="panel section-card" data-desc="${b.id}">
      ${b.fixed
        ? `<div class="section-title-fixed">${t('desc.' + b.key)}</div>`
        : `<button class="btn-icon" data-desc-rm="${b.id}" title="${t('app.remove')}">×</button>
           <input class="section-title-input" type="text" value="${esc(b.title ?? '')}"
                  data-desc-title="${b.id}" placeholder="${t('desc.blockName')}">`}
      <textarea data-desc-content="${b.id}" placeholder="${t('desc.placeholder')}"
                style="margin-top:10px;min-height:110px">${esc(b.content)}</textarea>
    </div>`).join('')}

  <!-- Bogen-Details für den PDF-Export (Seite 1 & 2) -->
  <div class="panel">
    <div class="panel__title">${t('desc.sheetDetails')}</div>
    <p class="panel__hint" style="margin-bottom:10px">${t('desc.sheetDetailsHint')}</p>
    <label class="meta-field" style="display:block">
      <span>${t('desc.languages')}</span>
      <div class="combo-row">
        <input type="text" data-desc-field="languages" value="${esc(s.languages ?? '')}"
               placeholder="${t('desc.languagesPh')}">
        <select data-combo-add="languages" title="${t('desc.comboAdd')}">
          <option value="">+ ${t('desc.comboAdd')}</option>
          ${LANGUAGES.map(l => `<option>${l}</option>`).join('')}
        </select>
      </div>
    </label>
    <label class="meta-field" style="margin-top:10px;display:block">
      <span>${t('desc.otherProficiencies')}</span>
      <div class="combo-row">
        <input type="text" data-desc-field="otherProficiencies" value="${esc(s.otherProficiencies ?? '')}"
               placeholder="${t('desc.otherProfPh')}">
        <select data-combo-add="otherProficiencies" title="${t('desc.comboAdd')}">
          <option value="">+ ${t('desc.comboAdd')}</option>
          ${PROFICIENCIES.map(p => `<option>${p}</option>`).join('')}
        </select>
      </div>
    </label>
    <label class="meta-field" style="margin-top:10px;display:block">
      <span>${t('desc.allies')}</span>
      <textarea data-desc-field="allies" style="min-height:60px">${esc(s.allies ?? '')}</textarea>
    </label>
    <label class="meta-field" style="margin-top:10px;display:block">
      <span>${t('desc.treasure')}</span>
      <textarea data-desc-field="treasure" style="min-height:60px">${esc(s.treasure ?? '')}</textarea>
    </label>
  </div>`;

  bindEvents(el);
}

// == Events ===================================================

function bindEvents(el) {
  const drop = el.querySelector('#descDrop');
  const file = el.querySelector('#descFile');

  // DropZone: Klick öffnet Dateiauswahl
  drop.onclick = () => file.click();
  drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') file.click(); };

  // Drag & Drop
  drop.ondragover  = e => { e.preventDefault(); drop.classList.add('dropzone--over'); };
  drop.ondragleave = () => drop.classList.remove('dropzone--over');
  drop.ondrop = e => {
    e.preventDefault();
    drop.classList.remove('dropzone--over');
    handleImage(e.dataTransfer.files?.[0]);
  };
  file.onchange = () => { handleImage(file.files?.[0]); file.value = ''; };

  el.querySelector('#descReplace')?.addEventListener('click', () => file.click());
  el.querySelector('#descRemove')?.addEventListener('click', () =>
    store.update({ portrait: null }));

  // Blöcke verwalten
  el.querySelector('#descAddBlock').onclick = () => {
    const title = prompt(t('desc.blockName'));
    if (title?.trim()) store.addDescriptionBlock(title.trim());
  };
  el.querySelectorAll('[data-desc-rm]').forEach(b => {
    b.onclick = () => store.removeDescriptionBlock(b.dataset.descRm);
  });

  // Titel & Inhalt: leise speichern (kein Re-Render während des Tippens)
  el.querySelectorAll('[data-desc-title]').forEach(inp => {
    inp.oninput = () => store.updateDescriptionBlock(inp.dataset.descTitle, { title: inp.value });
  });
  el.querySelectorAll('[data-desc-content]').forEach(ta => {
    ta.oninput = () => store.updateDescriptionBlock(ta.dataset.descContent, { content: ta.value });
  });

  // Bogen-Details (Seite 2): leise speichern, damit der Fokus bleibt
  el.querySelectorAll('[data-desc-field]').forEach(inp => {
    inp.oninput = () => store.quietUpdate({ [inp.dataset.descField]: inp.value });
  });

  // Combobox: gewählten Standardeintrag ANHÄNGEN (Feld bleibt Freitext,
  // die PDF-Übergabe nutzt unverändert denselben String).
  el.querySelectorAll('[data-combo-add]').forEach(sel => {
    sel.onchange = () => {
      const val = sel.value;
      sel.value = '';
      if (!val) return;
      const field = sel.dataset.comboAdd;
      const inp = el.querySelector(`[data-desc-field="${field}"]`);
      const parts = (inp.value ?? '').split(',').map(x => x.trim()).filter(Boolean);
      if (!parts.some(p => p.toLowerCase() === val.toLowerCase())) parts.push(val);
      inp.value = parts.join(', ');
      store.quietUpdate({ [field]: inp.value });
    };
  });
}

// == Bild einlesen und verkleinern ============================

function handleImage(fileObj) {
  if (!fileObj || !fileObj.type.startsWith('image/')) {
    if (fileObj) bus.emit(EV.TOAST, { message: '✗ ' + t('desc.notAnImage') });
    return;
  }
  const img = new Image();
  const url = URL.createObjectURL(fileObj);
  img.onload = () => {
    // Auf max. 640 px Kantenlänge skalieren → kleine DataURL,
    // damit das Roster im localStorage (≈5 MB) Platz behält
    const MAX = 640;
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    store.update({ portrait: canvas.toDataURL('image/jpeg', 0.85) });
    bus.emit(EV.TOAST, { message: '✓ ' + t('desc.portrait') });
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    bus.emit(EV.TOAST, { message: '✗ ' + t('desc.notAnImage') });
  };
  img.src = url;
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}
