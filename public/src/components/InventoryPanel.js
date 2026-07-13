// ============================================================
// components/InventoryPanel.js, Inventar & Währung
// ------------------------------------------------------------
// • Zwei getrennte Bereiche: AUSRÜSTUNG (angelegt/equipped) und
//   GEGENSTÄNDE (Gepäck), das Häkchen verschiebt zwischen beiden
// • Bibliothek: großes Fenster, ALLE Items aus der Datenbank,
//   Filter für "Nur magische Items" und Seltenheitsstufen
// • Homebrew-Items per Formular
// • Gesamtgewicht wird gegen Traglast (STR × 15) geprüft
// ============================================================
import { store }   from '../core/Store.js';
import { repo }    from '../core/DataRepository.js';
import { bus, EV } from '../core/EventBus.js';
import { t }       from '../core/i18n.js';
import { calcAC }  from '../rules/calculations.js';

const CURRENCIES = ['cp', 'sp', 'ep', 'gp', 'pp'];

// Wechselkurs zu Kupfer (cp): 1 sp=10, 1 ep=50, 1 gp=100, 1 pp=1000
const COIN_IN_CP = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };

const ELECTRUM_KEY = 'dnd5e_show_electrum';
function showElectrum() {
  try { return localStorage.getItem(ELECTRUM_KEY) !== '0'; } catch { return true; }
}
function setElectrum(on) {
  try { localStorage.setItem(ELECTRUM_KEY, on ? '1' : '0'); } catch {}
}

/** Gesamtvermögen in Gold (gerundet auf 2 Nachkommastellen) */
function totalInGp(cur) {
  const cp = CURRENCIES.reduce((s, c) => s + (cur?.[c] ?? 0) * COIN_IN_CP[c], 0);
  return Math.round(cp / 100 * 100) / 100;
}

/** Betrag einer Münzsorte in Kupfer, vom Gesamtvermögen abziehen und
 *  optimal zurückwechseln (größte Münzen zuerst). Gibt neue Währung
 *  oder null (nicht genug Geld) zurück. */
function payFromPurse(cur, amount, coin) {
  const need = amount * COIN_IN_CP[coin];
  let have = CURRENCIES.reduce((s, c) => s + (cur?.[c] ?? 0) * COIN_IN_CP[c], 0);
  if (need > have) return null;
  have -= need;
  return distribute(have);
}
/** Kupfer-Gesamtbetrag optimal auf Münzsorten aufteilen (ohne EP,
 *  falls ausgeblendet, dann fließt der Wert in Silber/Gold). */
function distribute(cp) {
  const order = showElectrum() ? ['pp', 'gp', 'ep', 'sp', 'cp'] : ['pp', 'gp', 'sp', 'cp'];
  const out = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  for (const c of order) {
    out[c] = Math.floor(cp / COIN_IN_CP[c]);
    cp -= out[c] * COIN_IN_CP[c];
  }
  return out;
}

// Seltenheitsstufen in Datenbank-Reihenfolge (Werte wie im Repo)
const RARITIES = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies', 'none'];

export function mountInventory() {
  render();
  bus.on(EV.CHAR_CHANGED, ({ changed }) => {
    if (changed.some(c => ['items', 'currency', 'str', '*'].includes(c))) render();
  });
  bus.on(EV.LANG_CHANGED, render);
  bus.on(EV.SOURCES_CHANGED, render);
}

// == Helfer ===================================================

function totalWeight(items) {
  return items.reduce((sum, it) => sum + (it.weight ?? 0) * (it.qty ?? 1), 0);
}

/** Magie-Erkennung mit Fallback für alte Packs/Seed ohne magic-Feld */
function isMagic(it) {
  if (typeof it.magic === 'boolean') return it.magic;
  const r = it.rarity ?? 'none';
  return r !== 'none' && r !== 'unknown';
}

function rarityTag(it) {
  if (!it?.rarity || it.rarity === 'none' || it.rarity === 'unknown') return '';
  return `<span class="tag tag--rarity tag--rarity-${it.rarity.replace(/\s/g, '-')}">${t('inventory.rarity_' + it.rarity.replace(/\s/g, '_')) }</span>`;
}

/** Eine Item-Zeile (für beide Bereiche identisch, Index = Position im Gesamt-Array)
 *  Klick auf die Zeile klappt die vollständige Beschreibung auf/zu. */
function itemRow(it, i) {
  const lib = repo.findItem(it.name);
  const hasDesc = !!lib?.description;
  return `
  <div class="expandable ${hasDesc ? 'expandable--has' : ''}" data-expand>
    <div class="list-row ${hasDesc ? 'list-row--click' : ''}">
      <input type="checkbox" data-inv-eq="${i}" ${it.equipped ? 'checked' : ''}
             title="${it.equipped ? t('inventory.unequip') : t('inventory.equip')}">
      <span class="row-grow">${it.name}
        ${lib && isMagic(lib) ? `<span class="tag tag--magic">${t('inventory.magic')}</span>` : ''}
        ${rarityTag(lib)}
        ${lib?.dmg1 ? `<span class="tag tag--dmg">${lib.dmg1}</span>` : ''}
        ${lib?.ac ? `<span class="tag tag--save">AC ${lib.ac}</span>` : ''}
        ${it.source ? `<span class="tag tag--src">${it.source}</span>` : ''}
      </span>
      <input type="number" min="1" value="${it.qty ?? 1}" data-inv-qty="${i}" style="width:56px;text-align:center">
      <button class="btn-icon" data-inv-rm="${i}">×</button>
    </div>
    ${hasDesc ? `<div class="expandable__body">${lib.description}</div>` : ''}
  </div>`;
}

// == Render ===================================================

function render() {
  const el = document.getElementById('tab-inventory');
  const s  = store.get();
  const weight = totalWeight(s.items);
  const capacity = s.str * 15;

  // Trennung: Ausrüstung (angelegt) vs. Gegenstände (Gepäck).
  // Der Original-Index im items-Array bleibt für die Events erhalten.
  const equipped = [], carried = [];
  s.items.forEach((it, i) => (it.equipped ? equipped : carried).push([it, i]));

  el.innerHTML = `
  <div class="panel">
    <div class="panel__title">${t('inventory.currency')}
      <label style="float:right;font-size:12px;font-weight:400;color:var(--muted);cursor:pointer">
        <input type="checkbox" id="invElectrum" ${showElectrum() ? 'checked' : ''}> ${t('inventory.showElectrum')}
      </label>
    </div>
    <div class="stat-row" style="flex-wrap:wrap">
      ${CURRENCIES.filter(c => c !== 'ep' || showElectrum()).map(c => `
        <div class="stat-box" style="min-width:76px">
          <input type="number" min="0" value="${s.currency?.[c] ?? 0}" data-cur="${c}"
                 style="width:100%;min-width:52px;text-align:center;font-size:16px;font-weight:600;border:none;background:none;color:var(--ink)">
          <span class="stat-box__lbl">${c.toUpperCase()}</span>
        </div>`).join('')}
    </div>
    <!-- Gold-Rechner: bezahlt (−) oder nimmt ein (+) und rechnet über
         alle Münzsorten hinweg mit Wechselkurs zu Kupfer um -->
    <div style="display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap">
      <input type="number" id="invCalcAmt" min="0" placeholder="0" style="width:80px;text-align:center">
      <select id="invCalcCur">
        ${CURRENCIES.filter(c => c !== 'ep' || showElectrum()).map(c => `<option value="${c}">${c.toUpperCase()}</option>`).join('')}
      </select>
      <button class="btn btn--sm btn--danger" id="invPay">− ${t('inventory.pay')}</button>
      <button class="btn btn--sm" id="invGain">+ ${t('inventory.gain')}</button>
      <span class="panel__hint" style="flex:1;text-align:right">${t('inventory.totalGp')}: <b>${totalInGp(s.currency)}</b></span>
    </div>
  </div>

  <!-- AUSRÜSTUNG: angelegte Gegenstände -->
  <div class="panel">
    <div class="panel__title">${t('inventory.equipment')} <span class="row-dim">(${equipped.length})</span></div>
    ${equipped.map(([it, i]) => itemRow(it, i)).join('')
      || `<p class="panel__hint">${t('inventory.emptyEquipment')}</p>`}
  </div>

  <!-- GEGENSTÄNDE: Gepäck -->
  <div class="panel">
    <div class="panel__title">${t('inventory.items')} <span class="row-dim">(${carried.length})</span>
      <span>
        <span class="row-dim" style="margin-right:8px">
          ${t('inventory.weight')}: <b style="${weight > capacity ? 'color:var(--accent)' : ''}">${weight.toFixed(1)}</b> / ${capacity} lbs
        </span>
        <button class="btn btn--sm" id="invHomebrew">${t('inventory.homebrew')}</button>
        <button class="btn btn--sm btn--gold" id="invLibrary">${t('inventory.fromLibrary')}</button>
      </span>
    </div>
    ${carried.map(([it, i]) => itemRow(it, i)).join('') || `<p class="panel__hint">-</p>`}
    <div style="display:flex;gap:8px;margin-top:10px">
      <input type="text" id="invName" placeholder="${t('inventory.addItem')}" style="flex:1">
      <input type="number" id="invQty" value="1" min="1" style="width:60px">
      <button class="btn btn--sm" id="invAdd">+ ${t('app.add')}</button>
    </div>
  </div>

  <!-- Item-Bibliothek: großes Fenster mit Magie- und Seltenheits-Filter -->
  <div class="overlay" id="invLibOverlay" style="display:none">
    <div class="modal modal--wide">
      <div class="modal__head">
        <b>${t('inventory.items')}</b>
        <span class="row-dim" id="invLibCount"></span>
        <button class="btn-icon" id="invLibClose">×</button>
      </div>
      <div class="modal__filters">
        <input type="text" id="invLibSearch" placeholder="${t('app.search')}">
        <label class="filter-check" title="${t('inventory.magicOnly')}">
          <input type="checkbox" id="invLibMagic"> ${t('inventory.magicOnly')}
        </label>
        <select id="invLibRarity">
          <option value="">${t('inventory.allRarities')}</option>
          ${RARITIES.map(r => `<option value="${r}">${t('inventory.rarity_' + r.replace(/\s/g, '_'))}</option>`).join('')}
        </select>
      </div>
      <div class="modal__body" id="invLibList"></div>
    </div>
  </div>

  <!-- Homebrew-Item: detailliertes Formular (Waffe/Rüstung/Gegenstand) -->
  <div class="overlay" id="invHbOverlay" style="display:none">
    <div class="modal" style="max-width:480px">
      <div class="modal__head"><b>${t('inventory.homebrew')}</b>
        <button class="btn-icon" id="invHbClose">×</button></div>
      <div class="modal__body">
        <div style="display:grid;gap:10px">
          <label class="meta-field"><span>${t('app.name')}</span>
            <input type="text" id="hbItName" placeholder="${t('app.name')}…"></label>

          <label class="meta-field"><span>${t('inventory.hbType')}</span>
            <select id="hbItType">
              <option value="gear">${t('inventory.hbGear')}</option>
              <option value="weapon">${t('inventory.hbWeapon')}</option>
              <option value="armor">${t('inventory.hbArmor')}</option>
            </select>
          </label>

          <div style="display:flex;gap:8px">
            <label class="meta-field" style="flex:1"><span>${t('inventory.hbWeight')}</span>
              <input type="number" id="hbItWeight" placeholder="lbs" step="0.1"></label>
            <label class="meta-field" style="flex:1"><span>${t('inventory.hbValue')}</span>
              <input type="number" id="hbItValue" placeholder="gp" min="0"></label>
          </div>

          <!-- Waffen-Felder -->
          <div id="hbWeaponFields" style="display:none;gap:8px;grid-template-columns:1fr 1fr;">
            <label class="meta-field"><span>${t('inventory.hbDamage')}</span>
              <input type="text" id="hbItDmg" placeholder="1d8"></label>
            <label class="meta-field"><span>${t('inventory.hbDmgType')}</span>
              <select id="hbItDmgType">
                <option value="S">${t('inventory.dmgS')}</option>
                <option value="P">${t('inventory.dmgP')}</option>
                <option value="B">${t('inventory.dmgB')}</option>
              </select></label>
            <label class="meta-field"><span>${t('inventory.hbAtkBonus')}</span>
              <input type="number" id="hbItAtkBonus" placeholder="0" value="0"></label>
            <label class="meta-field"><span>${t('inventory.hbDmgBonus')}</span>
              <input type="number" id="hbItDmgBonus" placeholder="0" value="0"></label>
            <label class="meta-field" style="grid-column:1/3"><span>${t('inventory.hbProps')}</span>
              <input type="text" id="hbItProps" placeholder="${t('inventory.hbPropsPh')}"></label>
          </div>

          <!-- Rüstungs-Felder -->
          <div id="hbArmorFields" style="display:none;gap:8px;grid-template-columns:1fr 1fr;">
            <label class="meta-field"><span>${t('inventory.hbAcType')}</span>
              <select id="hbItAcType">
                <option value="LA">${t('inventory.acLight')}</option>
                <option value="MA">${t('inventory.acMedium')}</option>
                <option value="HA">${t('inventory.acHeavy')}</option>
                <option value="S">${t('inventory.acShield')}</option>
              </select></label>
            <label class="meta-field"><span>${t('inventory.hbAcValue')}</span>
              <input type="number" id="hbItAc" placeholder="14" min="0"></label>
          </div>

          <!-- Magische Boni (alle Typen) -->
          <details>
            <summary style="cursor:pointer;color:var(--gold);font-size:13px;font-weight:600">${t('inventory.hbMagic')}</summary>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
              <label class="meta-field"><span>${t('inventory.hbBonusSave')}</span>
                <input type="number" id="hbItBonusSave" placeholder="0"></label>
              <label class="meta-field"><span>${t('inventory.hbBonusAc')}</span>
                <input type="number" id="hbItBonusAc" placeholder="0"></label>
            </div>
          </details>

          <label class="meta-field"><span>${t('inventory.hbDesc')}</span>
            <textarea id="hbItDesc" placeholder="…" style="min-height:50px"></textarea></label>
          <button class="btn btn--primary" id="hbItSave">${t('app.add')}</button>
        </div>
      </div>
    </div>
  </div>`;

  bindEvents(el);
}

// == Bibliothek: alle Items, gefiltert nach Magie/Seltenheit ==

function renderLibrary() {
  const list = document.getElementById('invLibList');
  if (!list) return;

  const search    = (document.getElementById('invLibSearch')?.value ?? '').toLowerCase();
  const magicOnly = document.getElementById('invLibMagic')?.checked ?? false;
  const rarity    = document.getElementById('invLibRarity')?.value ?? '';

  // Ohne Filter: ALLE Items der Datenbank anzeigen (kein Anzeige-Limit)
  let items = repo.getItems();
  if (search)    items = items.filter(it => it.name.toLowerCase().includes(search));
  if (magicOnly) items = items.filter(isMagic);
  if (rarity)    items = items.filter(it => (it.rarity ?? 'none') === rarity);

  const countEl = document.getElementById('invLibCount');
  if (countEl) countEl.textContent = `${items.length} / ${repo.getItems().length}`;

  // Ein Durchlauf mit Array-Join, auch bei ~2700 Einträgen flott genug
  list.innerHTML = items.map(it => `
    <div class="lib-entry lib-entry--expandable" data-expand>
      <div class="lib-entry__top">
        <span class="lib-entry__name">${it.name}</span>
        ${isMagic(it) ? `<span class="tag tag--magic">${t('inventory.magic')}</span>` : ''}
        ${rarityTag(it)}
        ${it.dmg1 ? `<span class="tag tag--dmg">${it.dmg1}</span>` : ''}
        ${it.ac ? `<span class="tag tag--save">AC ${it.ac}</span>` : ''}
        ${it.reqAttune ? `<span class="tag tag--save">${t('inventory.attunement')}</span>` : ''}
        <span class="tag tag--src">${it.source}</span>
        <button class="btn btn--sm" data-lib-it="${it.name.replace(/"/g, '&quot;')}">+ ${t('app.add')}</button>
      </div>
      ${it.weight ? `<div class="lib-entry__meta">${it.weight} lbs</div>` : ''}
      <div class="lib-entry__desc">${it.description ?? ''}</div>
    </div>`).join('') || `<p class="panel__hint" style="padding:1rem">-</p>`;

  // Event-Delegation statt 2700 Einzel-Listener
  list.onclick = e => {
    const btn = e.target.closest('[data-lib-it]');
    if (btn) {
      const lib = repo.findItem(btn.dataset.libIt);
      if (!lib) return;
      store.update({ items: [...store.field('items'), {
        name: lib.name, qty: 1, equipped: false, weight: lib.weight ?? 0, source: lib.source,
      }]});
      bus.emit(EV.TOAST, { message: `✓ ${lib.name}` });
      autoAC();
      return;
    }
    // Klick auf den Eintrag (nicht auf Knöpfe/Inputs) → auf-/zuklappen
    toggleExpand(e);
  };
}

/** Klick auf einen aufklappbaren Eintrag (nicht auf Bedienelemente) → toggeln */
export function toggleExpand(e) {
  if (e.target.closest('button, input, select, a, textarea')) return;
  const box = e.target.closest('[data-expand]');
  if (box) box.classList.toggle('open');
}

/** RK automatisch aus getragener Rüstung neu berechnen.
 *  Übersprungen, wenn der Nutzer die RK manuell gesetzt hat
 *  (Flag acManual, wird beim Editieren des RK-Feldes gesetzt). */
function autoAC() {
  if (store.field('acManual')) return;
  const newAC = calcAC(store.get());
  if (newAC !== store.field('ac')) store.update({ ac: newAC });
}

// == Events ===================================================

function bindEvents(el) {
  // Aufklappen der Item-Zeilen (Ausrüstung & Gegenstände)
  el.querySelectorAll('.panel').forEach(p => p.addEventListener('click', toggleExpand));

  // Währung
  el.querySelectorAll('[data-cur]').forEach(inp => {
    inp.onchange = () => store.update({
      currency: { ...store.field('currency'), [inp.dataset.cur]: Math.max(0, +inp.value || 0) } });
  });

  // Electrum ein-/ausblenden
  const elec = el.querySelector('#invElectrum');
  if (elec) elec.onchange = () => { setElectrum(elec.checked); render(); };

  // Gold-Rechner: bezahlen (−) / einnehmen (+)
  const amtEl = el.querySelector('#invCalcAmt');
  const curEl = el.querySelector('#invCalcCur');
  el.querySelector('#invPay').onclick = () => {
    const amt = Math.max(0, +amtEl.value || 0);
    if (!amt) return;
    const next = payFromPurse(store.field('currency'), amt, curEl.value);
    if (!next) { bus.emit(EV.TOAST, { message: '✗ ' + t('inventory.notEnough') }); return; }
    store.update({ currency: next });
    bus.emit(EV.TOAST, { message: `− ${amt} ${curEl.value.toUpperCase()}` });
  };
  el.querySelector('#invGain').onclick = () => {
    const amt = Math.max(0, +amtEl.value || 0);
    if (!amt) return;
    const cur = { ...store.field('currency') };
    cur[curEl.value] = (cur[curEl.value] ?? 0) + amt;
    store.update({ currency: cur });
    bus.emit(EV.TOAST, { message: `+ ${amt} ${curEl.value.toUpperCase()}` });
  };

  // Item-Zeilen (Ausrüsten-Häkchen verschiebt zwischen den Bereichen)
  el.querySelectorAll('[data-inv-eq]').forEach(cb => {
    cb.onchange = () => {
      const items = store.field('items');
      items[+cb.dataset.invEq].equipped = cb.checked;
      store.update({ items });
      autoAC(); // RK folgt der getragenen Rüstung
    };
  });
  el.querySelectorAll('[data-inv-qty]').forEach(inp => {
    inp.onchange = () => {
      const items = store.field('items');
      items[+inp.dataset.invQty].qty = Math.max(1, +inp.value || 1);
      store.update({ items });
    };
  });
  el.querySelectorAll('[data-inv-rm]').forEach(b => {
    b.onclick = () => {
      const items = store.field('items');
      items.splice(+b.dataset.invRm, 1);
      store.update({ items });
      autoAC();
    };
  });

  // Manuell hinzufügen
  el.querySelector('#invAdd').onclick = () => {
    const name = el.querySelector('#invName').value.trim();
    if (!name) return;
    store.update({ items: [...store.field('items'), {
      name, qty: Math.max(1, +el.querySelector('#invQty').value || 1), equipped: false, weight: 0,
    }]});
  };

  // Bibliothek öffnen: sofort ALLE Items laden (Filter leer)
  const libOv = el.querySelector('#invLibOverlay');
  el.querySelector('#invLibrary').onclick  = () => { libOv.style.display = 'flex'; renderLibrary(); };
  el.querySelector('#invLibClose').onclick = () => libOv.style.display = 'none';
  libOv.onclick = e => { if (e.target === libOv) libOv.style.display = 'none'; };

  // Filter: Suche, Magie, Seltenheit
  ['invLibSearch', 'invLibMagic', 'invLibRarity'].forEach(id => {
    el.querySelector('#' + id).oninput = renderLibrary;
  });

  // Homebrew
  const hbOv = el.querySelector('#invHbOverlay');
  el.querySelector('#invHomebrew').onclick = () => hbOv.style.display = 'flex';
  el.querySelector('#invHbClose').onclick  = () => hbOv.style.display = 'none';
  hbOv.onclick = e => { if (e.target === hbOv) hbOv.style.display = 'none'; };

  // Typ-abhängige Felder ein-/ausblenden
  const hbType = el.querySelector('#hbItType');
  const wpnFields = el.querySelector('#hbWeaponFields');
  const armFields = el.querySelector('#hbArmorFields');
  const syncHbFields = () => {
    wpnFields.style.display = hbType.value === 'weapon' ? 'grid' : 'none';
    armFields.style.display = hbType.value === 'armor'  ? 'grid' : 'none';
  };
  hbType.onchange = syncHbFields;
  syncHbFields();

  el.querySelector('#hbItSave').onclick = () => {
    const name = el.querySelector('#hbItName').value.trim();
    if (!name) return;
    const kind = hbType.value;
    const num = id => { const v = +el.querySelector(id).value; return Number.isFinite(v) ? v : 0; };

    const entry = {
      name,
      weight: +el.querySelector('#hbItWeight').value || 0,
      value: (+el.querySelector('#hbItValue').value || 0) * 100, // gp → cp
      description: el.querySelector('#hbItDesc').value.trim(),
      source: 'HB', rarity: 'none', magic: false,
      // magische Boni (alle Typen)
      bonusSave: num('#hbItBonusSave') || null,
      bonusAc: num('#hbItBonusAc') || null,
    };
    if (kind === 'weapon') {
      entry.dmg1 = el.querySelector('#hbItDmg').value.trim() || null;
      entry.dmgType = el.querySelector('#hbItDmgType').value;
      entry.atkBonus = num('#hbItAtkBonus');   // fester Angriffsbonus
      entry.dmgBonus = num('#hbItDmgBonus');    // fester Schadensbonus
      entry.property = el.querySelector('#hbItProps').value.trim()
        .split(',').map(x => x.trim()).filter(Boolean);
      entry.type = 'M'; // Nahkampfwaffe (Standard)
      entry.weaponCategory = 'martial';
    } else if (kind === 'armor') {
      entry.type = el.querySelector('#hbItAcType').value; // LA/MA/HA/S
      entry.ac = +el.querySelector('#hbItAc').value || 10;
    } else {
      entry.type = 'G'; // Gegenstand
    }

    repo.addHomebrew('items', entry);
    store.update({ items: [...store.field('items'), {
      name, qty: 1, equipped: false, weight: entry.weight, source: 'HB',
    }]});
    hbOv.style.display = 'none';
    bus.emit(EV.TOAST, { message: `✓ ${name} (HB)` });
  };
}
