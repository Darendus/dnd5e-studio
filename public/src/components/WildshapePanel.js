// ============================================================
// components/WildshapePanel.js, Wildgestalt (Druide)
// ------------------------------------------------------------
// Erscheint nur, wenn eine Druide-Klasse gewählt ist (auch als
// Multiclass). Zeigt alle regelkonform verfügbaren Tierformen
// als aufklappbare Statblocks inkl. Bild (5etools-img-Mirror).
// "Verwandeln" übernimmt STÄ/GES/KON, RK, TP und Angriffe der
// Form; die Grenzen (HG, Flug/Schwimmen, Mond-Zirkel) kommen aus
// rules/wildshape.js.
// ============================================================
import { store }   from '../core/Store.js';
import { repo }    from '../core/DataRepository.js';
import { bus, EV } from '../core/EventBus.js';
import { t }       from '../core/i18n.js';
import { fmtMod, calcMod, ABILITY_IDS } from '../rules/calculations.js';
import {
  wildshapeLimits, availableForms, crToNumber, formatSpeed, druidLevel, elementalUnlocked,
} from '../rules/wildshape.js';
import { toggleExpand } from './InventoryPanel.js';

// Bilder aus dem 5etools-Bild-Mirror (gleiche Organisation wie die Daten).
// Nicht vorhandene Bilder werden per onerror einfach ausgeblendet.
const IMG_BASE = 'https://raw.githubusercontent.com/5etools-mirror-3/5etools-img/main/bestiary';

export function mountWildshape() {
  render();
  bus.on(EV.CHAR_CHANGED, ({ changed }) => {
    if (changed.some(c => ['classes', 'wildshape', 'wildshapeUses', '*'].includes(c))) render();
  });
  bus.on(EV.LANG_CHANGED, render);
  bus.on(EV.SOURCES_CHANGED, render);
}

let search = '';            // Suchfeld über Re-Renders hinweg erhalten
let crFilter = '';          // CR-Filter ('' = alle)
const openCRs = new Set();  // aufgeklappte CR-Sektionen

// == Favoriten (QOL): häufig genutzte Formen schnell erreichbar ==
const FAV_KEY = 'dnd5e_wildshape_favs';
function loadFavs() {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveFavs(set) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...set])); } catch {}
}
let favs = loadFavs();
function toggleFav(name) {
  favs.has(name) ? favs.delete(name) : favs.add(name);
  saveFavs(favs);
}

function render() {
  const el = document.getElementById('tab-wildshape');
  if (!el) return;
  const s = store.get();
  const limits = wildshapeLimits(s.classes);

  // Kein Druide (Stufe 2+) → Tab-Inhalt mit Hinweis (Tab selbst ist ausgeblendet)
  if (!limits) {
    el.innerHTML = `<div class="panel"><p class="panel__hint">${t('wildshape.needDruid')}</p></div>`;
    return;
  }

  const maxUses = store.wildshapeMax();
  const uses  = s.wildshapeUses ?? maxUses;
  const allForms = availableForms(s.classes);
  // Alle vorkommenden CR-Stufen (für das Filter-Dropdown), aufsteigend
  const crValues = [...new Set(allForms.map(b => b.cr))]
    .sort((a, b) => crToNumber(a) - crToNumber(b));

  const forms = allForms
    .filter(b => !crFilter || b.cr === crFilter)
    .filter(b => !search || b.name.toLowerCase().includes(search))
    .sort((a, b) => crToNumber(a.cr) - crToNumber(b.cr) || a.name.localeCompare(b.name));

  // Nach CR gruppieren
  const byCR = {};
  forms.forEach(b => (byCR[b.cr] ??= []).push(b));
  // Bei aktiver Suche/Filterung Sektionen automatisch aufklappen
  const forceOpen = !!search || !!crFilter;

  el.innerHTML = `
  <!-- Status: Grenzen, Nutzungen, aktive Form -->
  <div class="panel">
    <div class="panel__title">${t('wildshape.title')}
      ${limits.moon ? `<span class="tag tag--magic">${t('wildshape.moonBadge')}</span>` : ''}
    </div>
    <div class="stat-row" style="margin-bottom:10px">
      <div class="stat-box"><span class="stat-box__val">${limits.level}</span>
        <span class="stat-box__lbl">${t('wildshape.druidLevel')}</span></div>
      <div class="stat-box"><span class="stat-box__val">${formatCR(limits.maxCR)}</span>
        <span class="stat-box__lbl">${t('wildshape.maxCR')}</span></div>
      <div class="stat-box"><span class="stat-box__val">${forms.length}</span>
        <span class="stat-box__lbl">${t('wildshape.formsAvailable')}</span></div>
      <div class="stat-box">
        <div style="display:flex;gap:5px;justify-content:center;padding:6px 0">
          ${Array.from({ length: maxUses }).map(i => `
            <button class="slot-bubble ${i < (maxUses - uses) ? 'slot-bubble--used' : ''}" data-ws-use="${i}"></button>`).join('')}
        </div>
        <span class="stat-box__lbl">${t('wildshape.uses')}</span>
      </div>
    </div>
    <p class="panel__hint">
      ${limits.noSwim ? t('wildshape.noSwim') + ' · ' : ''}${limits.noFly ? t('wildshape.noFly') + ' · ' : ''}${t('wildshape.rulesHint')}${elementalUnlocked(s.classes) ? ' · ' + t('wildshape.elementalHint') : ''}
    </p>
    <button class="btn btn--sm" id="wsRest" style="margin-top:8px">${t('wildshape.rest')}</button>
  </div>

  ${s.wildshape ? renderActiveForm(s) : ''}

  <!-- Formenliste: Suche + CR-Filter, Sektionen pro CR auf-/zuklappbar -->
  <div class="panel">
    <div class="panel__title">${t('wildshape.forms')}</div>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <input type="text" id="wsSearch" placeholder="${t('app.search')}" value="${esc(search)}" style="flex:1">
      <select id="wsCRFilter" title="${t('wildshape.filterCR')}">
        <option value="">${t('wildshape.allCRs')}</option>
        ${crValues.map(cr => `<option value="${cr}" ${crFilter === cr ? 'selected' : ''}>${t('wildshape.cr')} ${cr}</option>`).join('')}
      </select>
    </div>
    <div id="wsList">
      ${(() => {
        // Favoriten-Sektion (nur verfügbare Formen), immer oben und offen
        const favForms = forms.filter(b => favs.has(b.name));
        if (!favForms.length) return '';
        return `
        <div class="cr-section">
          <div class="cr-section__head" style="cursor:default">
            <span class="cr-section__chev">★</span>
            ${t('wildshape.favorites')}
            <span class="row-dim" style="margin-left:auto">${favForms.length}</span>
          </div>
          <div class="cr-section__body">${favForms.map(b => renderStatblock(b, s)).join('')}</div>
        </div>`;
      })()}
      ${Object.keys(byCR).sort((a, b) => crToNumber(a) - crToNumber(b)).map(cr => {
        const open = forceOpen || openCRs.has(cr);
        return `
        <div class="cr-section">
          <button class="cr-section__head" data-cr-toggle="${cr}">
            <span class="cr-section__chev">${open ? '▾' : '▸'}</span>
            ${t('wildshape.cr')} ${cr}
            <span class="row-dim" style="margin-left:auto">${byCR[cr].length}</span>
          </button>
          ${open ? `<div class="cr-section__body">${byCR[cr].map(b => renderStatblock(b, s)).join('')}</div>` : ''}
        </div>`;
      }).join('') || `<p class="panel__hint">${t('wildshape.noForms')}</p>`}
    </div>
  </div>`;

  bindEvents(el, s);
}

// == Aktive Form (Status + Zurückverwandeln) ==================

function renderActiveForm(s) {
  const beast = repo.findBeast(s.wildshape.form);
  if (!beast) return '';
  const hpPct = Math.max(0, Math.min(100, Math.round((s.wildshape.currHP / beast.hp) * 100)));
  return `
  <div class="panel" style="border-color:var(--boost)">
    <div class="panel__title" style="color:var(--boost)">
      ${t('wildshape.currentForm')}: ${beast.name}
      <button class="btn btn--sm btn--danger" id="wsRevert">↩ ${t('wildshape.revert')}</button>
    </div>
    <div class="stat-row" style="margin-bottom:8px">
      <div class="stat-box"><span class="stat-box__val">${beast.ac}</span>
        <span class="stat-box__lbl">${t('combat.ac')}</span></div>
      <div class="stat-box">
        <input type="number" id="wsHP" value="${s.wildshape.currHP}" min="0" max="${beast.hp}"
               style="width:64px;text-align:center;font-size:18px;font-weight:600;border:none;background:none;color:var(--ink)">
        <span class="stat-box__lbl">${t('wildshape.formHP')} / ${beast.hp}</span>
      </div>
      <div class="stat-box"><span class="stat-box__val" style="font-size:14px">${formatSpeed(beast.speed, speedLabels())}</span>
        <span class="stat-box__lbl">${t('abilities.speed')}</span></div>
    </div>
    <div class="hp-bar"><div class="hp-fill ${hpPct <= 25 ? 'hp-fill--low' : hpPct <= 50 ? 'hp-fill--mid' : ''}" style="width:${hpPct}%"></div></div>
    <p class="panel__hint" style="margin-top:8px">${t('wildshape.revertHint')}</p>
  </div>`;
}

// == Statblock eines Tiers (aufklappbar, mit Bild) ============

function renderStatblock(b, s) {
  const isActive = s.wildshape?.form === b.name;
  return `
  <div class="lib-entry lib-entry--expandable ws-block ${isActive ? 'lib-entry--known' : ''}" data-expand>
    <div class="lib-entry__top">
      <button class="ws-fav ${favs.has(b.name) ? 'ws-fav--on' : ''}" data-ws-fav="${esc(b.name)}"
              title="${t('wildshape.toggleFav')}">${favs.has(b.name) ? '★' : '☆'}</button>
      <span class="lib-entry__name">${b.name}</span>
      <span class="tag tag--src">${t('wildshape.cr')} ${b.cr}</span>
      <span class="tag tag--save">AC ${b.ac}</span>
      <span class="tag tag--heal">${b.hp} HP</span>
      <span class="tag tag--src">${b.source}</span>
      ${b.elemental ? `<span class="tag tag--magic">${t('wildshape.elemental')}</span>` : ''}
      ${isActive
        ? `<span class="tag tag--magic">${t('wildshape.active')}</span>`
        : `<button class="btn btn--sm btn--gold" data-ws-transform="${esc(b.name)}"
                   title="${b.elemental ? t('wildshape.elementalCost') : ''}">${t('wildshape.transform')}${b.elemental ? ' (2)' : ''}</button>`}
    </div>
    <div class="lib-entry__meta">${sizeName(b.size)} · ${formatSpeed(b.speed, speedLabels())}${b.senses ? ' · ' + b.senses : ''}</div>

    <div class="ws-details">
      <img class="ws-img" loading="lazy" alt=""
           src="${IMG_BASE}/${encodeURIComponent(b.source)}/${encodeURIComponent(b.name)}.webp"
           onerror="this.remove()">
      <div class="ws-stats-grid">
        ${ABILITY_IDS.map(a => `
          <div class="ws-stat">
            <div class="ws-stat__lbl">${t('abilities.' + a).slice(0, 3).toUpperCase()}</div>
            <div class="ws-stat__val">${b[a] ?? '-'} <span class="row-dim">(${fmtMod(calcMod(b[a] ?? 10))})</span></div>
          </div>`).join('')}
      </div>
      ${(b.traits ?? []).map(tr => `
        <div class="ws-trait"><b>${tr.name}.</b> ${tr.text}</div>`).join('')}
      ${(b.actions ?? []).map(a => `
        <div class="ws-action">
          <b>${a.name}.</b>
          ${a.attackBonus !== null ? `<span class="tag tag--atk">${fmtMod(a.attackBonus)}</span>` : ''}
          ${a.damage ? `<span class="tag tag--dmg">${a.damage}</span>` : ''}
          ${a.text}
        </div>`).join('')}
    </div>
  </div>`;
}

// == Events ===================================================

function bindEvents(el, s) {
  // Suche (Fokus erhalten: nur Liste neu bauen)
  const searchInput = el.querySelector('#wsSearch');
  searchInput.oninput = () => {
    search = searchInput.value.toLowerCase();
    const pos = searchInput.selectionStart;
    render();
    const again = document.getElementById('wsSearch');
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  };

  // CR-Filter
  el.querySelector('#wsCRFilter').onchange = e => {
    crFilter = e.target.value;
    render();
  };

  // CR-Sektionen auf-/zuklappen
  el.querySelectorAll('[data-cr-toggle]').forEach(btn => {
    btn.onclick = () => {
      const cr = btn.dataset.crToggle;
      openCRs.has(cr) ? openCRs.delete(cr) : openCRs.add(cr);
      render();
    };
  });

  // Verwandeln: Form aktivieren, TP-Pool des Tiers übernehmen, 1 Nutzung abziehen
  el.querySelectorAll('[data-ws-transform]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const beast = repo.findBeast(btn.dataset.wsTransform);
      if (!beast) return;
      const uses = store.field('wildshapeUses') ?? 2;
      const cost = beast.elemental ? 2 : 1; // Elemental Wild Shape kostet 2 Nutzungen
      if (uses < cost) {
        bus.emit(EV.TOAST, { message: '✗ ' + t('wildshape.notEnoughUses') });
        return;
      }
      store.update({
        wildshape: { form: beast.name, currHP: beast.hp },
        wildshapeUses: uses - cost,
      });
      bus.emit(EV.TOAST, { message: `✓ ${beast.name}` });
    };
  });

  // Zurückverwandeln
  el.querySelector('#wsRevert')?.addEventListener('click', () => {
    store.update({ wildshape: null });
  });

  // Form-TP anpassen (sinkt auf 0 → automatische Rückverwandlung, RAW)
  el.querySelector('#wsHP')?.addEventListener('change', e => {
    const val = Math.max(0, +e.target.value || 0);
    if (val === 0) {
      store.update({ wildshape: null });
      bus.emit(EV.TOAST, { message: t('wildshape.revertedAtZero') });
    } else {
      const ws = store.field('wildshape');
      store.update({ wildshape: { ...ws, currHP: val } });
    }
  });

  // Nutzungs-Blasen (Klick verbraucht/gibt frei) + Rast
  el.querySelectorAll('[data-ws-use]').forEach(b => {
    b.onclick = () => {
      const i = +b.dataset.wsUse;
      const max = store.wildshapeMax();
      const used = max - (store.field('wildshapeUses') ?? max);
      const newUsed = used > i ? i : i + 1;
      store.update({ wildshapeUses: max - newUsed });
    };
  });
  el.querySelector('#wsRest').onclick = () => store.update({ wildshapeUses: store.wildshapeMax() });

  // Favoriten-Stern (verhindert Aufklappen/Verwandeln)
  el.querySelectorAll('[data-ws-fav]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      toggleFav(btn.dataset.wsFav);
      render();
    };
  });

  // Statblöcke aufklappen (nicht bei Klick auf Buttons)
  el.querySelector('#wsList').onclick = e => {
    if (e.target.closest('button')) return;
    toggleExpand(e);
  };
}

// == Helfer ===================================================

function formatCR(n) {
  if (n === 0.25) return '1/4';
  if (n === 0.5)  return '1/2';
  if (n === 0.125) return '1/8';
  return String(n);
}

function sizeName(size) {
  return { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan' }[size] ?? size;
}

function speedLabels() {
  return { fly: t('wildshape.fly'), swim: t('wildshape.swim'),
           climb: t('wildshape.climb'), burrow: t('wildshape.burrow') };
}

function esc(str) {
  return String(str ?? '').replace(/"/g, '&quot;');
}
