// ============================================================
// components/CorePanel.js, abilities, saving throws, stats
// ============================================================
import { store }   from '../core/Store.js';
import { toggleExpand } from './InventoryPanel.js';
import { repo }    from '../core/DataRepository.js';
import { bus, EV } from '../core/EventBus.js';
import { t }       from '../core/i18n.js';
import { calcMod, calcProfBonus, fmtMod, ABILITY_IDS, effectiveAbilities, itemBonuses,
         effectiveInitiative, carryCapacity, featEffects, calcMaxHP } from '../rules/calculations.js';
import { ALIGNMENTS } from '../rules/progression.js';
import { pickFeatSpellClass } from './FeatSpellChoice.js';
import { getAutoHpMethod } from '../core/hpSettings.js';
import { escapeHtml, capitalize } from '../utils/format.js';



// Persisted across render() calls: any store.update() (e.g. adding a
// feat) re-renders this whole tab from scratch, which would otherwise
// reset the feat library overlay to its default closed/empty state.
let featLibOpen = false;
let featLibSearch = '';

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
  // effective abilities: base + equipped items (e.g. Belt of Giant Strength)
  const { scores: eff, sources } = effectiveAbilities(s);
  const saveBonus = itemBonuses(s).save; // flat save bonuses (Cloak/Ring of Protection)
  const featEff = featEffects(s);        // speed/initiative/… from feats

  el.innerHTML = `
  <div class="panel">
    <div class="panel__title">${t('core.details')}</div>
    <div class="meta-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
      <label class="meta-field"><span>${t('core.playerName')}</span>
        <input type="text" data-core-field="playerName" value="${escapeHtml(s.playerName ?? '')}"></label>
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
          <input type="text" data-core-field="${f}" value="${escapeHtml(s[f] ?? '')}"></label>`).join('')}
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
                 class="stat-box__input">
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

  <!-- Feats, selection from the source-filtered library -->
  <div class="panel">
    <div class="panel__title">${t('feats.title')}
      <button class="btn btn--sm btn--gold" id="featLib">${t('feats.library')}</button>
    </div>
    <div id="featSelList">
    ${(s.feats ?? []).map((name, i) => {
      const lib = repo.findFeat(name);
      const desc = lib?.description ?? '';
      const lvl = (s.featLevels ?? [])[i];
      const chosenClass = (s.featChoices ?? [])[i]?.class;
      return `
      <div class="lib-entry lib-entry--expandable" data-expand>
        <div class="lib-entry__top">
          <span class="lib-entry__name"><b>${name}</b></span>
          ${lvl ? `<span class="tag" title="${t('feats.takenAt')}">${t('app.level')} ${lvl}</span>` : ''}
          ${chosenClass ? `<span class="tag tag--magic">${capitalize(chosenClass)}</span>` : ''}
          ${lib?.source ? `<span class="tag tag--src">${lib.source}</span>` : ''}
          <button class="btn-icon" data-feat-rm="${i}">×</button>
        </div>
        ${desc ? `<div class="lib-entry__desc">${desc}</div>` : ''}
      </div>`;
    }).join('') || `<p class="panel__hint">-</p>`}
    </div>
  </div>

  <!-- Feat library -->
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
  // character details: save text fields "quietly" (focus stays),
  // the alignment selector normally (a select never loses focus).
  el.querySelectorAll('[data-core-field]').forEach(inp => {
    const key = inp.dataset.coreField;
    if (inp.tagName === 'SELECT') {
      inp.onchange = () => store.update({ [key]: inp.value });
    } else {
      inp.oninput = () => store.quietUpdate({ [key]: inp.value });
    }
  });

  // abilities: save "quietly" (no full re-render, so focus & cursor are
  // preserved while typing / using the spinner arrows). The score's own
  // modifier (and boosted-score display) is refreshed LIVE via a surgical
  // DOM update; the cross-panel re-derive (HP from CON, saves, skills, …)
  // happens once the field loses focus (blur).
  el.querySelectorAll('[data-attr]').forEach(inp => {
    const attr = inp.dataset.attr;
    inp.oninput = () => {
      const raw = inp.value.trim();
      if (raw === '') return;              // mid-edit empty: commit/restore on blur
      let val = Math.floor(+raw);
      if (!Number.isFinite(val)) return;
      // error handling: clamp out-of-range input (too high / negative)
      // straight in the field so it can never store an invalid score
      if (val > 30)     { val = 30; inp.value = '30'; }
      else if (val < 1) { val = 1;  inp.value = '1'; }
      store.quietUpdate({ [attr]: val });
      updateAbilityDisplay(inp, attr);     // live modifier + boosted score
    };
    inp.onblur = () => {
      // restore a valid value if the user left the field empty/invalid
      if (!Number.isFinite(+inp.value) || inp.value.trim() === '') inp.value = store.field(attr);
      bus.emit(EV.CHAR_CHANGED, { changed: [attr] });
    };
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

  // expand/collapse selected feats by click (full text)
  const featSel = el.querySelector('#featSelList');
  if (featSel) featSel.onclick = toggleExpand;

  // feats: remove + library (recompute feat bonuses)
  el.querySelectorAll('[data-feat-rm]').forEach(b => {
    b.onclick = () => {
      store.removeFeatAt(+b.dataset.featRm);
      resyncMaxHP();
    };
  });
  const ov = el.querySelector('#featOverlay');
  el.querySelector('#featLib').onclick   = () => { featLibOpen = true; ov.style.display = 'flex'; renderFeatLibrary(); };
  el.querySelector('#featClose').onclick = () => { featLibOpen = false; ov.style.display = 'none'; };
  ov.onclick = e => { if (e.target === ov) { featLibOpen = false; ov.style.display = 'none'; } };
  el.querySelector('#featSearch').oninput = e => { featLibSearch = e.target.value; renderFeatLibrary(); };

  // this render() may have been triggered by a feat add/remove while the
  // library was open (store.update -> CHAR_CHANGED -> full re-render);
  // restore its open state and search text
  if (featLibOpen) {
    ov.style.display = 'flex';
    el.querySelector('#featSearch').value = featLibSearch;
    renderFeatLibrary();
  }
}

/** Live-refresh one ability block's modifier (and boosted effective
 *  score) after its input changes, without a full panel re-render so the
 *  input keeps focus/cursor while typing or clicking the spinner arrows. */
function updateAbilityDisplay(inp, attr) {
  const { scores, sources } = effectiveAbilities(store.get());
  const block = inp.closest('.ability-block');
  if (!block) return;
  const modEl = block.querySelector('.ability-mod');
  if (modEl) modEl.textContent = fmtMod(calcMod(scores[attr]));
  const boostEl = block.querySelector('.ability-boost');
  if (boostEl && sources[attr]?.length) boostEl.textContent = `→ ${scores[attr]}`;
}

/** Adjust max HP after a feat change (Tough, Boon of Fortitude …).
 *  If the character was at full health, it stays that way. */
function resyncMaxHP() {
  const newMax = calcMaxHP(store.get(), getAutoHpMethod());
  if (newMax === store.field('maxHP')) return;
  const wasFull = store.field('currHP') >= store.field('maxHP');
  store.update({ maxHP: newMax, currHP: wasFull ? newMax : Math.min(store.field('currHP'), newMax) });
}

// == Feat library (source-filtered, searchable) ===============
function renderFeatLibrary() {
  const list = document.getElementById('featList');
  if (!list) return;
  const search = (document.getElementById('featSearch')?.value ?? '').toLowerCase();
  const myFeats = store.field('feats') ?? [];
  const known = new Set(myFeats);
  // how many of each feat the character already has (for repeatable feats
  // and the "+add"/"remove" toggle)
  const counts = myFeats.reduce((m, n) => (m[n] = (m[n] ?? 0) + 1, m), {});

  let feats = repo.getFeats();
  if (search) feats = feats.filter(f => f.name.toLowerCase().includes(search));
  feats = feats.slice(0, 150); // display limit

  list.innerHTML = feats.map(f => `
    <div class="lib-entry lib-entry--expandable ${known.has(f.name) && !f.repeatable ? 'lib-entry--known' : ''}" data-expand>
      <div class="lib-entry__top">
        <span class="lib-entry__name">${f.name}</span>
        <span class="tag tag--src">${f.source}</span>
        ${(() => {
          const count = counts[f.name] ?? 0;
          if (count && f.repeatable) return `
            <span class="tag tag--magic">×${count}</span>
            <button class="btn btn--sm" data-flib-add="${escapeHtml(f.name)}">+ ${t('feats.again')}</button>
            <button class="btn btn--sm btn--danger" data-flib-rm="${escapeHtml(f.name)}">${t('app.remove')}</button>`;
          if (count) return `<button class="btn btn--sm btn--danger" data-flib-rm="${escapeHtml(f.name)}">${t('app.remove')}</button>`;
          return `<button class="btn btn--sm" data-flib-add="${escapeHtml(f.name)}">+ ${t('app.add')}</button>`;
        })()}
      </div>
      ${f.prerequisite ? `<div class="lib-entry__meta">${t('feats.prerequisite')}: ${f.prerequisite}</div>` : ''}
      <div class="lib-entry__desc">${f.description ?? ''}</div>
    </div>`).join('') || `<p class="panel__hint" style="padding:1rem">-</p>`;

  list.onclick = toggleExpand;

  list.querySelectorAll('[data-flib-add]').forEach(b => {
    b.onclick = async () => {
      const name = b.dataset.flibAdd;
      // some feats (Magic Initiate, ...) grant spells from one of several
      // class lists; ask which one before adding, so the Spell Library
      // and casting stats can be scoped to it
      const feat = repo.findFeat(name);
      const options = repo.featSpellClassOptions(name);
      const picked = await pickFeatSpellClass(feat, options);
      if (picked === undefined) return; // cancelled

      store.addFeat(name, store.totalLevel(), picked ? { class: picked } : null);
      resyncMaxHP();
      renderFeatLibrary();
    };
  });
  list.querySelectorAll('[data-flib-rm]').forEach(b => {
    b.onclick = () => {
      // removes the LAST occurrence (for repeatable feats)
      const i = (store.field('feats') ?? []).lastIndexOf(b.dataset.flibRm);
      store.removeFeatAt(i);
      resyncMaxHP();
      renderFeatLibrary();
    };
  });
}

