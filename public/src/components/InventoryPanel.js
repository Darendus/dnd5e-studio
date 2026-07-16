// ============================================================
// components/InventoryPanel.js, inventory & currency
// ------------------------------------------------------------
// • Two separate areas: EQUIPMENT (worn/equipped) and
//   ITEMS (backpack); the checkbox moves items between the two
// • Library: large window, ALL items from the database,
//   filter for "magic items only" and rarity tiers
// • Homebrew items via a form
// • Total weight is checked against carrying capacity (STR × 15)
// ============================================================
import { store }   from '../core/Store.js';
import { repo }    from '../core/DataRepository.js';
import { bus, EV } from '../core/EventBus.js';
import { t }       from '../core/i18n.js';
import { calcAC }  from '../rules/calculations.js';
import { escapeHtml } from '../utils/format.js';

const CURRENCIES = ['cp', 'sp', 'ep', 'gp', 'pp'];

// exchange rate to copper (cp): 1 sp=10, 1 ep=50, 1 gp=100, 1 pp=1000
const COIN_IN_CP = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };

const ELECTRUM_KEY = 'dnd5e_show_electrum';
function showElectrum() {
  try { return localStorage.getItem(ELECTRUM_KEY) !== '0'; } catch { return true; }
}
function setElectrum(on) {
  try { localStorage.setItem(ELECTRUM_KEY, on ? '1' : '0'); } catch {}
}

/** Total wealth in gold (rounded to 2 decimal places) */
function totalInGp(cur) {
  const cp = CURRENCIES.reduce((s, c) => s + (cur?.[c] ?? 0) * COIN_IN_CP[c], 0);
  return Math.round(cp / 100 * 100) / 100;
}

/** Deduct an amount of a coin type (in copper) from the total wealth
 *  and change it back optimally (largest coins first). Returns the
 *  new currency or null (not enough money). */
function payFromPurse(cur, amount, coin) {
  const need = amount * COIN_IN_CP[coin];
  let have = CURRENCIES.reduce((s, c) => s + (cur?.[c] ?? 0) * COIN_IN_CP[c], 0);
  if (need > have) return null;
  have -= need;
  return distribute(have);
}
/** Optimally split a total copper amount across coin types (without
 *  EP if hidden; the value then flows into silver/gold). */
function distribute(cp) {
  const order = showElectrum() ? ['pp', 'gp', 'ep', 'sp', 'cp'] : ['pp', 'gp', 'sp', 'cp'];
  const out = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  for (const c of order) {
    out[c] = Math.floor(cp / COIN_IN_CP[c]);
    cp -= out[c] * COIN_IN_CP[c];
  }
  return out;
}

// rarity tiers in database order (values as in the repo)
const RARITIES = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies', 'none'];

export function mountInventory() {
  render();
  bus.on(EV.CHAR_CHANGED, ({ changed }) => {
    if (changed.some(c => ['items', 'currency', 'str', '*'].includes(c))) render();
  });
  bus.on(EV.LANG_CHANGED, render);
  bus.on(EV.SOURCES_CHANGED, render);
}

// == Helpers ===================================================

function totalWeight(items) {
  return items.reduce((sum, it) => sum + (it.weight ?? 0) * (it.qty ?? 1), 0);
}

/** Magic detection with fallback for old packs/seed without a magic field */
function isMagic(it) {
  if (typeof it.magic === 'boolean') return it.magic;
  const r = it.rarity ?? 'none';
  return r !== 'none' && r !== 'unknown';
}

function rarityTag(it) {
  if (!it?.rarity || it.rarity === 'none' || it.rarity === 'unknown') return '';
  return `<span class="tag tag--rarity tag--rarity-${it.rarity.replace(/\s/g, '-')}">${t('inventory.rarity_' + it.rarity.replace(/\s/g, '_')) }</span>`;
}

/** A single item row (identical for both areas, index = position in the overall array)
 *  Clicking the row expands/collapses the full description. */
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

// == Render =====================================================

function render() {
  const el = document.getElementById('tab-inventory');
  const s  = store.get();
  const weight = totalWeight(s.items);
  const capacity = s.str * 15;

  // split: equipment (worn) vs. items (backpack).
  // The original index in the items array is preserved for events.
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
    <!-- gold calculator: pays (−) or receives (+), converting across
         all coin types via the exchange rate to copper -->
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

  <!-- EQUIPMENT: worn items -->
  <div class="panel">
    <div class="panel__title">${t('inventory.equipment')} <span class="row-dim">(${equipped.length})</span></div>
    ${equipped.map(([it, i]) => itemRow(it, i)).join('')
      || `<p class="panel__hint">${t('inventory.emptyEquipment')}</p>`}
  </div>

  <!-- ITEMS: backpack -->
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

  <!-- item library: large window with magic and rarity filters -->
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

  <!-- homebrew item: detailed form (weapon/armor/gear) -->
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

          <!-- weapon fields -->
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

          <!-- armor fields -->
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

          <!-- magic bonuses (all types) -->
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

// == Library: all items, filtered by magic/rarity ==============

function renderLibrary() {
  const list = document.getElementById('invLibList');
  if (!list) return;

  const search    = (document.getElementById('invLibSearch')?.value ?? '').toLowerCase();
  const magicOnly = document.getElementById('invLibMagic')?.checked ?? false;
  const rarity    = document.getElementById('invLibRarity')?.value ?? '';

  // without a filter: show ALL items of the database (no display limit)
  const allItems = repo.getItems();
  let items = allItems;
  if (search)    items = items.filter(it => it.name.toLowerCase().includes(search));
  if (magicOnly) items = items.filter(isMagic);
  if (rarity)    items = items.filter(it => (it.rarity ?? 'none') === rarity);

  const countEl = document.getElementById('invLibCount');
  if (countEl) countEl.textContent = `${items.length} / ${allItems.length}`;

  // a single pass with array join, fast enough even for ~2700 entries
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
        <button class="btn btn--sm" data-lib-it="${escapeHtml(it.name)}">+ ${t('app.add')}</button>
      </div>
      ${it.weight ? `<div class="lib-entry__meta">${it.weight} lbs</div>` : ''}
      <div class="lib-entry__desc">${it.description ?? ''}</div>
    </div>`).join('') || `<p class="panel__hint" style="padding:1rem">-</p>`;

  // event delegation instead of 2700 individual listeners
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
    // click on the entry (not on buttons/inputs) → expand/collapse
    toggleExpand(e);
  };
}

/** Click on an expandable entry (not on controls) → toggle */
export function toggleExpand(e) {
  if (e.target.closest('button, input, select, a, textarea')) return;
  const box = e.target.closest('[data-expand]');
  if (box) box.classList.toggle('open');
}

/** Automatically recompute AC from worn armor.
 *  Skipped if the user has manually set the AC
 *  (flag acManual, set when editing the AC field). */
function autoAC() {
  if (store.field('acManual')) return;
  const newAC = calcAC(store.get());
  if (newAC !== store.field('ac')) store.update({ ac: newAC });
}

// == Events ===================================================

function bindEvents(el) {
  // expanding item rows (equipment & items)
  el.querySelectorAll('.panel').forEach(p => p.addEventListener('click', toggleExpand));

  // currency
  el.querySelectorAll('[data-cur]').forEach(inp => {
    inp.onchange = () => store.update({
      currency: { ...store.field('currency'), [inp.dataset.cur]: Math.max(0, +inp.value || 0) } });
  });

  // show/hide electrum
  const elec = el.querySelector('#invElectrum');
  if (elec) elec.onchange = () => { setElectrum(elec.checked); render(); };

  // gold calculator: pay (−) / receive (+)
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

  // item rows (equip checkbox moves items between the areas)
  el.querySelectorAll('[data-inv-eq]').forEach(cb => {
    cb.onchange = () => {
      const items = store.field('items');
      items[+cb.dataset.invEq].equipped = cb.checked;
      store.update({ items });
      autoAC(); // AC follows the worn armor
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

  // add manually
  el.querySelector('#invAdd').onclick = () => {
    const name = el.querySelector('#invName').value.trim();
    if (!name) return;
    store.update({ items: [...store.field('items'), {
      name, qty: Math.max(1, +el.querySelector('#invQty').value || 1), equipped: false, weight: 0,
    }]});
  };

  // open library: immediately load ALL items (filter empty)
  const libOv = el.querySelector('#invLibOverlay');
  el.querySelector('#invLibrary').onclick  = () => { libOv.style.display = 'flex'; renderLibrary(); };
  el.querySelector('#invLibClose').onclick = () => libOv.style.display = 'none';
  libOv.onclick = e => { if (e.target === libOv) libOv.style.display = 'none'; };

  // filters: search, magic, rarity
  ['invLibSearch', 'invLibMagic', 'invLibRarity'].forEach(id => {
    el.querySelector('#' + id).oninput = renderLibrary;
  });

  // Homebrew
  const hbOv = el.querySelector('#invHbOverlay');
  el.querySelector('#invHomebrew').onclick = () => hbOv.style.display = 'flex';
  el.querySelector('#invHbClose').onclick  = () => hbOv.style.display = 'none';
  hbOv.onclick = e => { if (e.target === hbOv) hbOv.style.display = 'none'; };

  // show/hide type-dependent fields
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
      // magic bonuses (all types)
      bonusSave: num('#hbItBonusSave') || null,
      bonusAc: num('#hbItBonusAc') || null,
    };
    if (kind === 'weapon') {
      entry.dmg1 = el.querySelector('#hbItDmg').value.trim() || null;
      entry.dmgType = el.querySelector('#hbItDmgType').value;
      entry.atkBonus = num('#hbItAtkBonus');   // fixed attack bonus
      entry.dmgBonus = num('#hbItDmgBonus');    // fixed damage bonus
      entry.property = el.querySelector('#hbItProps').value.trim()
        .split(',').map(x => x.trim()).filter(Boolean);
      entry.type = 'M'; // melee weapon (default)
      entry.weaponCategory = 'martial';
    } else if (kind === 'armor') {
      entry.type = el.querySelector('#hbItAcType').value; // LA/MA/HA/S
      entry.ac = +el.querySelector('#hbItAc').value || 10;
    } else {
      entry.type = 'G'; // gear
    }

    repo.addHomebrew('items', entry);
    store.update({ items: [...store.field('items'), {
      name, qty: 1, equipped: false, weight: entry.weight, source: 'HB',
    }]});
    hbOv.style.display = 'none';
    bus.emit(EV.TOAST, { message: `✓ ${name} (HB)` });
  };
}
