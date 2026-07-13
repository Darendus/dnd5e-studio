// ============================================================
// components/CorePanel.js, Attribute, Rettungswürfe, Kennwerte
// ============================================================
import { store }   from '../core/Store.js';
import { toggleExpand } from './InventoryPanel.js';
import { repo }    from '../core/DataRepository.js';
import { bus, EV } from '../core/EventBus.js';
import { t }       from '../core/i18n.js';
import { calcMod, calcProfBonus, fmtMod, ABILITY_IDS, effectiveAbilities, itemBonuses,
         effectiveInitiative, carryCapacity, featEffects, calcMaxHP } from '../rules/calculations.js';
import { featBonusFor } from '../rules/bonuses.js';
import { ALIGNMENTS } from '../rules/progression.js';



export function mountCore() {
  render();
  bus.on(EV.CHAR_CHANGED, ({ changed }) => {
    const rel = [...ABILITY_IDS, 'classes', 'saveProficiencies', 'speed', 'feats', 'items', 'wildshape',
                 'raceBonus', 'bgBonus', 'featBonus', 'raceChoice', 'bgChoice', '*'];
    if (changed.some(c => rel.includes(c))) render();
  });
  bus.on(EV.LANG_CHANGED, render);
  bus.on(EV.SOURCES_CHANGED, render);
}

function render() {
  const el = document.getElementById('tab-core');
  const s  = store.get();
  const pb = calcProfBonus(store.totalLevel());
  // Effektive Attribute: Basis + angelegte Items (z. B. Gürtel der Riesenstärke)
  const { scores: eff, sources } = effectiveAbilities(s);
  const saveBonus = itemBonuses(s).save; // flache Save-Boni (Cloak/Ring of Protection)
  const featEff = featEffects(s);        // Speed/Initiative/… aus Talenten

  el.innerHTML = `
  <div class="panel">
    <div class="panel__title">${t('core.details')}</div>
    <div class="meta-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
      <label class="meta-field"><span>${t('core.playerName')}</span>
        <input type="text" data-core-field="playerName" value="${esc(s.playerName ?? '')}"></label>
      <label class="meta-field"><span>${t('core.alignment')}</span>
        <select data-core-field="alignment">
          <option value="">-</option>
          ${ALIGNMENTS.map(a => `<option value="${a}" ${s.alignment === a ? 'selected' : ''}>${t('align.' + a)}</option>`).join('')}
        </select></label>
    </div>
    <div class="meta-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px">
      ${[['age','core.age'],['height','core.height'],['weight','core.weight'],
         ['eyes','core.eyes'],['skin','core.skin'],['hair','core.hair']].map(([f, key]) => `
        <label class="meta-field"><span>${t(key)}</span>
          <input type="text" data-core-field="${f}" value="${esc(s[f] ?? '')}"></label>`).join('')}
    </div>
  </div>

  <div class="panel">
    <div class="panel__title">${t('abilities.title')}</div>
    <div class="ability-grid">
      ${ABILITY_IDS.map(a => {
        const boosted = sources[a]?.length;
        return `
        <div class="ability-block ${boosted ? 'ability-block--boosted' : ''}"
             ${boosted ? `title="${sources[a].join(', ')}"` : ''}>
          <label>${t('abilities.' + a).slice(0, 3).toUpperCase()}</label><br>
          <input type="number" min="1" max="30" value="${s[a]}" data-attr="${a}">
          ${boosted ? `<div class="ability-boost">→ ${eff[a]}</div>` : ''}
          <div class="ability-mod ${boosted ? 'ability-mod--boosted' : ''}">${fmtMod(calcMod(eff[a]))}</div>
        </div>`;
      }).join('')}
    </div>
  </div>

  <div class="panel-row">
    <div class="panel">
      <div class="panel__title">${t('abilities.saves')}</div>
      ${ABILITY_IDS.map(a => {
        const prof = s.saveProficiencies.includes(a);
        const total = calcMod(eff[a]) + (prof ? pb : 0) + saveBonus;
        return `
        <div class="list-row">
          <input type="checkbox" data-save="${a}" ${prof ? 'checked' : ''}>
          <span class="row-mod">${fmtMod(total)}</span>
          <span class="row-grow">${t('abilities.' + a)}</span>
        </div>`;
      }).join('')}
    </div>

    <div class="panel">
      <div class="panel__title">Kennwerte</div>
      <div class="stat-row">
        <div class="stat-box">
          <input type="number" id="coreSpeed" value="${s.speed}" min="0"
                 style="width:70px;text-align:center;font-size:18px;font-weight:600;border:none;background:none;color:var(--ink)">
          <span class="stat-box__lbl">${t('abilities.speed')} (ft)${featEff.speed ? ` (+${featEff.speed})` : ''}</span>
        </div>
        <div class="stat-box">
          <span class="stat-box__val">${fmtMod(effectiveInitiative(s))}</span>
          <span class="stat-box__lbl">${t('abilities.initiative')}${(featEff.initiative || featEff.initiativeProf) ? ' ✦' : ''}</span>
        </div>
        <div class="stat-box">
          <span class="stat-box__val">${carryCapacity(s)}</span>
          <span class="stat-box__lbl">${t('abilities.carry')} (lbs)</span>
        </div>
        <div class="stat-box">
          <span class="stat-box__val">+${pb}</span>
          <span class="stat-box__lbl">${t('abilities.profBonus')}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Talente (Feats), Auswahl aus der quellen-gefilterten Bibliothek -->
  <div class="panel">
    <div class="panel__title">${t('feats.title')}
      <button class="btn btn--sm btn--gold" id="featLib">${t('feats.library')}</button>
    </div>
    <div id="featSelList">
    ${(s.feats ?? []).map((name, i) => {
      const lib = repo.findFeat(name);
      const desc = lib?.description ?? '';
      const lvl = (s.featLevels ?? [])[i];
      return `
      <div class="lib-entry lib-entry--expandable" data-expand>
        <div class="lib-entry__top">
          <span class="lib-entry__name"><b>${name}</b></span>
          ${lvl ? `<span class="tag" title="${t('feats.takenAt')}">${t('app.level')} ${lvl}</span>` : ''}
          ${lib?.source ? `<span class="tag tag--src">${lib.source}</span>` : ''}
          <button class="btn-icon" data-feat-rm="${i}">×</button>
        </div>
        ${desc ? `<div class="lib-entry__desc">${desc}</div>` : ''}
      </div>`;
    }).join('') || `<p class="panel__hint">-</p>`}
    </div>
  </div>

  <!-- Feat-Bibliothek -->
  <div class="overlay" id="featOverlay" style="display:none">
    <div class="modal">
      <div class="modal__head"><b>${t('feats.library')}</b>
        <button class="btn-icon" id="featClose">×</button></div>
      <div class="modal__filters">
        <input type="text" id="featSearch" placeholder="${t('app.search')}">
      </div>
      <div class="modal__body" id="featList"></div>
    </div>
  </div>`;

  // == Events ==
  // Charakterdetails: Textfelder "leise" speichern (Fokus bleibt),
  // die Gesinnungs-Auswahl normal (Select verliert keinen Fokus).
  el.querySelectorAll('[data-core-field]').forEach(inp => {
    const key = inp.dataset.coreField;
    if (inp.tagName === 'SELECT') {
      inp.onchange = () => store.update({ [key]: inp.value });
    } else {
      inp.oninput = () => store.quietUpdate({ [key]: inp.value });
    }
  });

  // Attribute: "leise" speichern (kein Re-Render, damit Fokus & Pfeil-
  // tasten erhalten bleiben). Ein manuelles Re-Render der abgeleiteten
  // Anzeigen passiert beim Verlassen des Feldes (blur).
  el.querySelectorAll('[data-attr]').forEach(inp => {
    inp.oninput = () => {
      const val = Math.max(1, Math.min(30, +inp.value || 10));
      store.quietUpdate({ [inp.dataset.attr]: val });
    };
    inp.onblur = () => bus.emit(EV.CHAR_CHANGED, { changed: [inp.dataset.attr] });
  });
  el.querySelectorAll('[data-save]').forEach(cb => {
    cb.onchange = () => {
      const cur = store.field('saveProficiencies');
      store.update({
        saveProficiencies: cb.checked
          ? [...cur, cb.dataset.save]
          : cur.filter(x => x !== cb.dataset.save),
      });
    };
  });
  const speed = el.querySelector('#coreSpeed');
  speed.oninput = () => store.quietUpdate({ speed: Math.max(0, +speed.value || 30) });
  speed.onblur  = () => bus.emit(EV.CHAR_CHANGED, { changed: ['speed'] });

  // Ausgewählte Talente per Klick auf-/zuklappen (voller Text)
  const featSel = el.querySelector('#featSelList');
  if (featSel) featSel.onclick = toggleExpand;

  // Feats: entfernen + Bibliothek (Feat-Boni neu berechnen)
  el.querySelectorAll('[data-feat-rm]').forEach(b => {
    b.onclick = () => {
      const i = +b.dataset.featRm;
      const feats = [...(store.field('feats') ?? [])];
      const featLevels = [...(store.field('featLevels') ?? [])];
      feats.splice(i, 1);
      featLevels.splice(i, 1);
      store.update({ feats, featLevels, featBonus: featBonusFor(feats) });
      resyncMaxHP();
    };
  });
  const ov = el.querySelector('#featOverlay');
  el.querySelector('#featLib').onclick   = () => { ov.style.display = 'flex'; renderFeatLibrary(); };
  el.querySelector('#featClose').onclick = () => ov.style.display = 'none';
  ov.onclick = e => { if (e.target === ov) ov.style.display = 'none'; };
  el.querySelector('#featSearch').oninput = renderFeatLibrary;
}

/** Max. TP nach Feat-Änderung anpassen (Tough, Boon of Fortitude …).
 *  War der Charakter auf voller Gesundheit, bleibt er es. */
function resyncMaxHP() {
  const newMax = calcMaxHP(store.get());
  if (newMax === store.field('maxHP')) return;
  const wasFull = store.field('currHP') >= store.field('maxHP');
  store.update({ maxHP: newMax, currHP: wasFull ? newMax : Math.min(store.field('currHP'), newMax) });
}

// == Feat-Bibliothek (quellen-gefiltert, durchsuchbar) ========
function renderFeatLibrary() {
  const list = document.getElementById('featList');
  if (!list) return;
  const search = (document.getElementById('featSearch')?.value ?? '').toLowerCase();
  const known = new Set(store.field('feats') ?? []);

  let feats = repo.getFeats();
  if (search) feats = feats.filter(f => f.name.toLowerCase().includes(search));
  feats = feats.slice(0, 150); // Anzeige-Limit

  list.innerHTML = feats.map(f => `
    <div class="lib-entry lib-entry--expandable ${known.has(f.name) && !f.repeatable ? 'lib-entry--known' : ''}" data-expand>
      <div class="lib-entry__top">
        <span class="lib-entry__name">${f.name}</span>
        <span class="tag tag--src">${f.source}</span>
        ${(() => {
          const count = (store.field('feats') ?? []).filter(n => n === f.name).length;
          if (count && f.repeatable) return `
            <span class="tag tag--magic">×${count}</span>
            <button class="btn btn--sm" data-flib-add="${esc(f.name)}">+ ${t('feats.again')}</button>
            <button class="btn btn--sm btn--danger" data-flib-rm="${esc(f.name)}">${t('app.remove')}</button>`;
          if (count) return `<button class="btn btn--sm btn--danger" data-flib-rm="${esc(f.name)}">${t('app.remove')}</button>`;
          return `<button class="btn btn--sm" data-flib-add="${esc(f.name)}">+ ${t('app.add')}</button>`;
        })()}
      </div>
      ${f.prerequisite ? `<div class="lib-entry__meta">${t('feats.prerequisite')}: ${f.prerequisite}</div>` : ''}
      <div class="lib-entry__desc">${f.description ?? ''}</div>
    </div>`).join('') || `<p class="panel__hint" style="padding:1rem">-</p>`;

  list.onclick = toggleExpand;

  list.querySelectorAll('[data-flib-add]').forEach(b => {
    b.onclick = () => {
      const feats = [...(store.field('feats') ?? []), b.dataset.flibAdd];
      const featLevels = [...(store.field('featLevels') ?? []), store.totalLevel()];
      store.update({ feats, featLevels, featBonus: featBonusFor(feats) });
      resyncMaxHP();
      renderFeatLibrary();
    };
  });
  list.querySelectorAll('[data-flib-rm]').forEach(b => {
    b.onclick = () => {
      // Entfernt das LETZTE Vorkommen (bei wiederholbaren Talenten)
      const feats = [...(store.field('feats') ?? [])];
      const featLevels = [...(store.field('featLevels') ?? [])];
      const i = feats.lastIndexOf(b.dataset.flibRm);
      if (i >= 0) { feats.splice(i, 1); featLevels.splice(i, 1); }
      store.update({ feats, featLevels, featBonus: featBonusFor(feats) });
      resyncMaxHP();
      renderFeatLibrary();
    };
  });
}

function esc(str) {
  return String(str ?? '').replace(/"/g, '&quot;');
}
