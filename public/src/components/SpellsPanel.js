// ============================================================
// components/SpellsPanel.js, spells
// ------------------------------------------------------------
// • spell slots from multiclass rules (incl. Warlock pact slots)
// • library: all spells of the character's classes,
//   filtered by enabled rulesets, with search/filter
// • "cast": first a spell attack roll (if needed), then
//   automatic damage/healing; the saving throw DC is displayed
// • homebrew form for custom spells
// ============================================================
import { store }   from '../core/Store.js';
import { toggleExpand } from './InventoryPanel.js';
import { askRollMode } from './RollPrompt.js';
import { repo }    from '../core/DataRepository.js';
import { bus, EV } from '../core/EventBus.js';
import { t }       from '../core/i18n.js';
import {
  calcMod, calcProfBonus, fmtMod, calcSpellSlots, ABILITY_IDS, effectiveAbilities,
} from '../rules/calculations.js';
import { d20, parseAndRoll, describeParts } from '../rules/dice.js';

export function mountSpells() {
  render();
  bus.on(EV.CHAR_CHANGED, ({ changed }) => {
    const rel = ['classes','spells','spellSlotsUsed','pactSlotsUsed','arcanumUsed','items','wildshape',
                 'str','dex','con','int','wis','cha','*'];
    if (changed.some(c => rel.includes(c))) render();
  });
  bus.on(EV.LANG_CHANGED, render);
  bus.on(EV.SOURCES_CHANGED, render);
}

// == Spellcasting stats per class ===============================
// With multiclassing, each class has its own spellcasting ability.
// For rolls we use the ability of the class that knows the
// spell; the display at the top shows all spellcasting classes.
function spellStats(s) {
  const pb = calcProfBonus(store.totalLevel());
  const eff = effectiveAbilities(s).scores;
  return s.classes
    .map(c => ({ cls: c.name, data: repo.getClass(c.name) }))
    .filter(x => x.data?.spellAbility)
    .map(x => ({
      cls: x.cls,
      ability: x.data.spellAbility,
      mod: calcMod(eff[x.data.spellAbility]),
      dc: 8 + pb + calcMod(eff[x.data.spellAbility]),
      atk: pb + calcMod(eff[x.data.spellAbility]),
    }));
}

/** Best stats for a specific spell (class assignment) */
function statsForSpell(spellName, allStats) {
  const lib = repo.findSpell(spellName);
  if (lib && allStats.length > 1) {
    const match = allStats.find(st => (lib.classes ?? []).includes(st.cls));
    if (match) return match;
  }
  return allStats[0] ?? { mod: 0, dc: 8, atk: 0, cls: '-', ability: null };
}

// == Render =====================================================

function render() {
  const el = document.getElementById('tab-spells');
  const s  = store.get();
  const stats = spellStats(s);
  const { slots, pact } = calcSpellSlots(s.classes);
  const used = s.spellSlotsUsed ?? Array(9).fill(0);

  el.innerHTML = `
  <div id="castResult"></div>

  <div class="panel">
    <div class="panel__title">${t('spells.stats')}</div>
    ${stats.length === 0
      ? `<p class="panel__hint">${t('spells.noCaster')}</p>`
      : stats.map(st => `
        <div class="stat-row" style="margin-bottom:8px">
          <div class="stat-box"><span class="stat-box__val">${st.cls}</span>
            <span class="stat-box__lbl">${t('abilities.' + st.ability).slice(0,3).toUpperCase()}</span></div>
          <div class="stat-box"><span class="stat-box__val">${st.dc}</span>
            <span class="stat-box__lbl">${t('spells.saveDC')}</span></div>
          <div class="stat-box"><span class="stat-box__val">${fmtMod(st.atk)}</span>
            <span class="stat-box__lbl">${t('spells.atkBonus')}</span></div>
        </div>`).join('')}
  </div>

  ${(stats.length > 0) ? `
  <div class="panel">
    <div class="panel__title">${t('spells.slots')}
      <button class="btn btn--sm" id="spShortRest" title="${t('combat.shortRestHint')}">${t('combat.shortRest')}</button>
      <button class="btn btn--sm" id="spLongRest">${t('spells.longRest')}</button>
    </div>
    ${slots.map((total, i) => total > 0 ? slotRow(i, total, used[i] ?? 0) : '').join('')
      || (pact
        ? `<p class="panel__hint">${t('spells.pactOnly')}</p>`
        : `<p class="panel__hint">-</p>`)}
    ${pact ? pactRow(pact, s.pactSlotsUsed ?? 0, s.arcanumUsed ?? []) : ''}
  </div>` : ''}

  <div class="panel">
    <div class="panel__title">${t('spells.known')}
      <span>
        <button class="btn btn--sm" id="spHomebrew">${t('spells.homebrew')}</button>
        <button class="btn btn--sm btn--gold" id="spLibrary">${t('spells.library')}</button>
      </span>
    </div>
    ${knownList(s.spells, stats)}
  </div>

  <!-- library modal (shown via button) -->
  <div class="overlay" id="spLibOverlay" style="display:none">
    <div class="modal">
      <div class="modal__head">
        <b>${t('spells.library')}</b>
        <button class="btn-icon" id="spLibClose">×</button>
      </div>
      <div class="modal__filters">
        <select id="spLibLevel">
          <option value="">${t('app.all')}</option>
          <option value="0">${t('spells.cantrips')}</option>
          ${[1,2,3,4,5,6,7,8,9].map(n => `<option value="${n}">${n}${t('spells.grade')}</option>`).join('')}
        </select>
        <select id="spLibClass">
          <option value="">${t('app.all')}</option>
          ${s.classes.map(c => `<option>${c.name}</option>`).join('')}
        </select>
        <select id="spLibSchool" title="${t('spells.school')}">
          <option value="">${t('spells.school')}: ${t('app.all')}</option>
          ${[...new Set(repo.getSpells().map(sp => sp.school).filter(Boolean))]
            .map(code => [code, t('spells.school_' + code)])
            .sort((a, b) => a[1].localeCompare(b[1]))
            .map(([code, name]) => `<option value="${code}">${name}</option>`).join('')}
        </select>
        <input type="text" id="spLibSearch" placeholder="${t('app.search')}">
      </div>
      <div class="modal__body" id="spLibList"></div>
      <div class="lib-action-bar" id="spLibActionBar" style="display:none">
        <span><b id="spLibSelCount">0</b> ${t('spells.selected')}</span>
        <button class="btn btn--sm btn--primary" id="spLibLearnSel">+ ${t('spells.learnSelected')}</button>
      </div>
    </div>
  </div>

  <!-- homebrew modal -->
  <div class="overlay" id="spHbOverlay" style="display:none">
    <div class="modal" style="max-width:480px">
      <div class="modal__head"><b>${t('spells.homebrew')}</b>
        <button class="btn-icon" id="spHbClose">×</button></div>
      <div class="modal__body">
        <div style="display:grid;gap:8px">
          <input type="text" id="hbSpName" placeholder="${t('app.name')}…">
          <div style="display:flex;gap:8px">
            <select id="hbSpLevel" style="flex:1">
              <option value="0">${t('spells.cantrips')}</option>
              ${[1,2,3,4,5,6,7,8,9].map(n => `<option value="${n}">${n}${t('spells.grade')}</option>`).join('')}
            </select>
            <label style="display:flex;align-items:center;gap:5px;font-size:12px">
              <input type="checkbox" id="hbSpAtk"> ${t('spells.attackRoll')}
            </label>
          </div>
          <div style="display:flex;gap:8px">
            <input type="text" id="hbSpDamage" placeholder="${t('spells.damage')}: 2d6" style="flex:1">
            <input type="text" id="hbSpHealing" placeholder="${t('spells.healing')}: 1d8" style="flex:1">
          </div>
          <select id="hbSpSave">
            <option value="">Save</option>
            ${ABILITY_IDS.map(a => `<option value="${a}">${t('abilities.' + a)}</option>`).join('')}
          </select>
          <textarea id="hbSpDesc" placeholder="…" style="min-height:60px"></textarea>
          <button class="btn btn--primary" id="hbSpSave2">${t('app.add')}</button>
        </div>
      </div>
    </div>
  </div>`;

  bindEvents(el, s, stats);
  renderLibrary(s);
}

function slotRow(i, total, used) {
  return `
  <div class="slot-row">
    <span class="slot-level">${i + 1}${t('spells.grade')}</span>
    <div class="slot-bubbles">
      ${Array.from({ length: total }, (_, j) =>
        `<button class="slot-bubble ${j < used ? 'slot-bubble--used' : ''}" data-slot="${i}" data-idx="${j}"></button>`
      ).join('')}
    </div>
    <span class="row-dim">${Math.max(0, total - used)}/${total}</span>
  </div>`;
}

function pactRow(pact, used, arcanumUsed = []) {
  // All pact slots share the same (highest) level, but are usable
  // for EVERY spell level up to that. The label therefore names the
  // usable range, so no "missing" level rows are suspected. From
  // level 11, the Mystic Arcana (levels 6 to 9, 1x per long rest
  // each) are added as their own rows.
  const range = pact.level > 1
    ? `1. ${t('spells.gradeTo')} ${pact.level}${t('spells.grade')}`
    : `1${t('spells.grade')}`;
  const arcanumRows = (pact.arcanum ?? []).map(grade => `
  <div class="slot-row">
    <span class="slot-level" title="${t('spells.arcanumHint')}">${t('spells.arcanum')} ${grade}${t('spells.grade')}</span>
    <div class="slot-bubbles">
      <button class="slot-bubble ${arcanumUsed.includes(grade) ? 'slot-bubble--used' : ''}" data-arcanum="${grade}"></button>
    </div>
    <span class="row-dim">${arcanumUsed.includes(grade) ? 0 : 1}/1</span>
  </div>`).join('');
  return `
  <div class="slot-row" style="border-top:1px dashed var(--border2);padding-top:8px;margin-top:4px">
    <span class="slot-level" title="${t('spells.pactHint')}">${t('spells.pact')} (${range})</span>
    <div class="slot-bubbles">
      ${Array.from({ length: pact.count }, (_, j) =>
        `<button class="slot-bubble ${j < used ? 'slot-bubble--used' : ''}" data-pact-idx="${j}"></button>`
      ).join('')}
    </div>
    <span class="row-dim">${Math.max(0, pact.count - used)}/${pact.count}</span>
  </div>${arcanumRows}`;
}

function knownList(spells, stats) {
  if (!spells?.length) return `<p class="panel__hint">-</p>`;

  const byLevel = {};
  spells.forEach(sp => (byLevel[sp.level ?? 0] ??= []).push(sp));

  return Object.keys(byLevel).sort((a, b) => +a - +b).map(lv => `
    <div class="lib-group-head">${+lv === 0 ? t('spells.cantrips') : lv + t('spells.grade')}</div>
    ${byLevel[lv].map(sp => {
      const lib = repo.findSpell(sp.name);
      const st  = statsForSpell(sp.name, stats);
      const tags = [];
      if (lib?.attackRoll) tags.push(`<span class="tag tag--atk">ATK ${fmtMod(st.atk)}</span>`);
      if (lib?.saveType)   tags.push(`<span class="tag tag--save">${lib.saveType.toUpperCase()} DC ${st.dc}</span>`);
      if (lib?.damage)     tags.push(`<span class="tag tag--dmg">${lib.damage}${lib.damageType ? ' ' + lib.damageType : ''}</span>`);
      if (lib?.healing)    tags.push(`<span class="tag tag--heal">♥ ${lib.healing}</span>`);
      if (lib?.source)     tags.push(`<span class="tag tag--src">${lib.source}</span>`);
      const castable = lib && (lib.attackRoll || lib.saveType || lib.damage || lib.healing);
      return `
      <div class="list-row">
        <button class="prep-toggle ${sp.prepared ? 'prep-toggle--on' : ''}"
                data-sp-prep="${esc(sp.name)}"
                title="${sp.prepared ? t('spells.preparedOn') : t('spells.preparedOff')}">
          <span class="prep-toggle__dot"></span>
          <span class="prep-toggle__label">${sp.prepared ? t('spells.prep') : t('spells.notPrep')}</span>
        </button>
        <span class="row-grow">
          ${sp.name}${sp.fromSubclass ? ` <span class="tag tag--magic" title="${esc(sp.fromSubclass)}">◈</span>` : ''}
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:2px">${tags.join('')}</div>
        </span>
        ${castable ? `<button class="btn btn--sm btn--gold" data-sp-cast="${esc(sp.name)}">${t('spells.cast')}</button>` : ''}
        <button class="btn-icon" data-sp-remove="${esc(sp.name)}">×</button>
      </div>`;
    }).join('')}`).join('');
}

// == Library ====================================================

function renderLibrary(s) {
  const list = document.getElementById('spLibList');
  if (!list) return;

  const lvFilter  = document.getElementById('spLibLevel')?.value ?? '';
  const clsFilter = document.getElementById('spLibClass')?.value ?? '';
  const schFilter = document.getElementById('spLibSchool')?.value ?? '';
  const search    = (document.getElementById('spLibSearch')?.value ?? '').toLowerCase();

  // pass full class objects → exclusive subclass spells
  // (domains, patron lists) appear in the library too.
  const classArg = clsFilter
    ? s.classes.filter(c => c.name === clsFilter).length
      ? s.classes.filter(c => c.name === clsFilter)
      : [clsFilter]
    : s.classes;
  let entries = repo.getSpellsForClasses(classArg, s.feats);
  if (lvFilter !== '') entries = entries.filter(sp => sp.level === +lvFilter);
  if (schFilter)       entries = entries.filter(sp => sp.school === schFilter);
  if (search)          entries = entries.filter(sp => sp.name.toLowerCase().includes(search));

  const known = new Set(s.spells.map(sp => sp.name));
  const byLevel = {};
  entries.forEach(sp => (byLevel[sp.level] ??= []).push(sp));

  list.innerHTML = Object.keys(byLevel).sort((a, b) => +a - +b).map(lv => `
    <div class="lib-group-head">${+lv === 0 ? t('spells.cantrips') : lv + t('spells.grade')}</div>
    ${byLevel[lv].map(sp => {
      const isKnown = known.has(sp.name);
      const tags = [];
      if (sp.attackRoll) tags.push(`<span class="tag tag--atk">ATK</span>`);
      if (sp.saveType)   tags.push(`<span class="tag tag--save">${sp.saveType.toUpperCase()}</span>`);
      if (sp.damage)     tags.push(`<span class="tag tag--dmg">${sp.damage}</span>`);
      if (sp.healing)    tags.push(`<span class="tag tag--heal">♥ ${sp.healing}</span>`);
      tags.push(`<span class="tag tag--src">${sp.source}</span>`);
      return `
      <div class="lib-entry lib-entry--expandable ${isKnown ? 'lib-entry--known' : ''}" data-expand>
        <div class="lib-entry__top">
          ${isKnown ? '' : `<input type="checkbox" class="lib-select" data-lib-sp-sel="${esc(sp.name)}" data-lv="${sp.level}" title="${t('spells.select')}">`}
          <span class="lib-entry__name">${sp.name}</span>
          ${tags.join('')}
          ${isKnown
            ? `<button class="btn btn--sm btn--danger" data-lib-sp-rm="${esc(sp.name)}">${t('app.remove')}</button>`
            : `<button class="btn btn--sm" data-lib-sp-add="${esc(sp.name)}" data-lv="${sp.level}">+ ${t('spells.learn')}</button>`}
        </div>
        <div class="lib-entry__meta">${sp.school ? t('spells.school_' + sp.school) + ' · ' : ''}${sp.castTime} · ${sp.range} · ${sp.duration} · ${sp.components}</div>
        <div class="lib-entry__desc">${sp.description ?? ''}</div>
      </div>`;
    }).join('')}`).join('') || `<p class="panel__hint" style="padding:1rem">-</p>`;

  // action bar for multi-select (appears with ≥1 checkbox checked)
  const bar = document.getElementById('spLibActionBar');
  const updateBar = () => {
    const n = list.querySelectorAll('.lib-select:checked').length;
    if (bar) {
      bar.style.display = n ? 'flex' : 'none';
      const cnt = bar.querySelector('#spLibSelCount');
      if (cnt) cnt.textContent = n;
    }
  };
  updateBar();

  // click on an entry → expand/collapse the description (not on checkbox/button)
  list.onclick = e => {
    if (e.target.closest('.lib-select, button')) return;
    toggleExpand(e);
  };

  // multi-select checkboxes
  list.querySelectorAll('.lib-select').forEach(cb => {
    cb.onchange = e => { e.stopPropagation(); updateBar(); };
    cb.onclick  = e => e.stopPropagation();
  });
  // "learn selected"
  const learnBtn = bar?.querySelector('#spLibLearnSel');
  if (learnBtn) learnBtn.onclick = () => {
    const picks = [...list.querySelectorAll('.lib-select:checked')]
      .map(cb => ({ name: cb.dataset.libSpSel, level: +cb.dataset.lv }));
    if (!picks.length) return;
    const cur = store.field('spells');
    const have = new Set(cur.map(sp => sp.name));
    const added = picks.filter(p => !have.has(p.name))
      .map(p => ({ name: p.name, level: p.level, prepared: false }));
    store.update({ spells: [...cur, ...added] });
    bus.emit(EV.TOAST, { message: `✓ ${added.length}` });
  };

  // learn/remove buttons
  list.querySelectorAll('[data-lib-sp-add]').forEach(b => {
    b.onclick = () => {
      store.update({ spells: [...store.field('spells'),
        { name: b.dataset.libSpAdd, level: +b.dataset.lv, prepared: false }] });
      bus.emit(EV.TOAST, { message: `✓ ${b.dataset.libSpAdd}` });
    };
  });
  list.querySelectorAll('[data-lib-sp-rm]').forEach(b => {
    b.onclick = () => store.update({
      spells: store.field('spells').filter(sp => sp.name !== b.dataset.libSpRm) });
  });
}

// == Cast: attack roll → damage/healing automatically ==========

async function castSpell(name, stats) {
  const lib = repo.findSpell(name);
  const st  = statsForSpell(name, stats);
  const box = document.getElementById('castResult');
  if (!box) return;

  // if the spell requires an attack roll → prompt beforehand
  let mode = 'normal';
  if (lib?.attackRoll) {
    mode = await askRollMode(name);
    if (!mode) return; // cancelled → don't cast at all
  }

  const steps = [];
  let critical = false, fumbled = false;

  // 1) spell attack roll, if the spell requires one
  if (lib?.attackRoll) {
    const hit = d20(st.atk, mode);
    critical = hit.isCrit; fumbled = hit.isFumble;
    const dice = hit.second !== null
      ? `W20(${hit.first}|${hit.second})→${hit.raw}` : `W20(${hit.raw})`;
    steps.push({
      cls: critical ? 'crit' : fumbled ? 'fail' : 'atk',
      label: t('spells.attackRoll') + ` (${st.cls})` +
        (mode === 'adv' ? ', ' + t('dice.advantage') : mode === 'dis' ? ', ' + t('dice.disadvantage') : ''),
      detail: `${dice} ${fmtMod(st.atk)}${critical ? ', ' + t('spells.crit') : fumbled ? ', ' + t('spells.fumble') : ''}`,
      val: hit.total,
    });
  }

  // 2) saving throw hint (spells without an attack roll)
  if (lib?.saveType && !lib?.attackRoll) {
    steps.push({
      cls: 'save',
      label: t('spells.saveNeeded'),
      detail: `${t('abilities.' + lib.saveType)} vs DC ${st.dc}, ${t('spells.targetRolls')}`,
      val: st.dc,
    });
  }

  // 3) roll damage automatically (skipped on a fumble)
  if (lib?.damage && !fumbled) {
    let formula = lib.damage;
    if (critical) formula = formula.replace(/(\d+)d/g, (m, n) => (+n * 2) + 'd');
    const dmg = parseAndRoll(formula);
    if (dmg) steps.push({
      cls: critical ? 'crit' : 'dmg',
      label: t('spells.damage') + (lib.damageType ? ` (${lib.damageType})` : ''),
      detail: describeParts(dmg.parts),
      val: dmg.total,
    });
  }

  // 4) roll healing automatically (+ spellcasting modifier)
  if (lib?.healing) {
    const heal = parseAndRoll(lib.healing + (st.mod ? `+${st.mod}` : ''));
    if (heal) steps.push({
      cls: 'heal',
      label: t('spells.healing'),
      detail: describeParts(heal.parts),
      val: heal.total,
    });
  }

  if (!steps.length) steps.push({ cls: 'save', label: name, detail: lib?.description ?? '-', val: '✓' });

  box.innerHTML = `
    <div class="panel">
      <div class="panel__title">✨ ${name}</div>
      ${steps.map(stp => `
        <div class="cast-step cast-step--${stp.cls}">
          <span class="cast-step__label">${stp.label}</span>
          <span class="cast-step__detail">${stp.detail}</span>
          <span class="cast-step__val">${stp.val}</span>
        </div>`).join('')}
    </div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// == Events ===================================================

function bindEvents(el, s, stats) {
  // slot bubbles: click a free one → spend; a spent one → free it up
  el.querySelectorAll('[data-slot]').forEach(b => {
    b.onclick = () => {
      const lvl = +b.dataset.slot, idx = +b.dataset.idx;
      const used = [...store.field('spellSlotsUsed')];
      used[lvl] = used[lvl] > idx ? idx : idx + 1;
      store.update({ spellSlotsUsed: used });
    };
  });
  el.querySelectorAll('[data-pact-idx]').forEach(b => {
    b.onclick = () => {
      const idx = +b.dataset.pactIdx;
      const used = store.field('pactSlotsUsed') ?? 0;
      store.update({ pactSlotsUsed: used > idx ? idx : idx + 1 });
    };
  });

  // Mystic Arcanum: bubble toggles spent/available
  el.querySelectorAll('[data-arcanum]').forEach(b => {
    b.onclick = () => {
      const grade = +b.dataset.arcanum;
      const cur = store.field('arcanumUsed') ?? [];
      store.update({ arcanumUsed: cur.includes(grade)
        ? cur.filter(g => g !== grade)
        : [...cur, grade] });
    };
  });

  el.querySelector('#spShortRest')?.addEventListener('click', () => {
    store.shortRest(); // ruleset-dependent (pact slots, possibly wild shape)
    bus.emit(EV.TOAST, { message: t('combat.shortRestDone') });
  });
  el.querySelector('#spLongRest')?.addEventListener('click', () =>
    store.update({ spellSlotsUsed: Array(9).fill(0), pactSlotsUsed: 0 }));

  // known spells: cast / prepare / remove
  el.querySelectorAll('[data-sp-cast]').forEach(b => {
    b.onclick = () => castSpell(b.dataset.spCast, stats);
  });
  el.querySelectorAll('[data-sp-prep]').forEach(b => {
    b.onclick = () => store.update({
      spells: store.field('spells').map(sp =>
        sp.name === b.dataset.spPrep ? { ...sp, prepared: !sp.prepared } : sp) });
  });
  el.querySelectorAll('[data-sp-remove]').forEach(b => {
    b.onclick = () => store.update({
      spells: store.field('spells').filter(sp => sp.name !== b.dataset.spRemove) });
  });

  // open/close library + filters
  const overlay = el.querySelector('#spLibOverlay');
  el.querySelector('#spLibrary').onclick  = () => { overlay.style.display = 'flex'; renderLibrary(store.get()); };
  el.querySelector('#spLibClose').onclick = () => overlay.style.display = 'none';
  overlay.onclick = e => { if (e.target === overlay) overlay.style.display = 'none'; };
  ['spLibLevel','spLibClass','spLibSchool','spLibSearch'].forEach(id => {
    el.querySelector('#' + id).oninput = () => renderLibrary(store.get());
  });

  // homebrew form
  const hbOverlay = el.querySelector('#spHbOverlay');
  el.querySelector('#spHomebrew').onclick = () => hbOverlay.style.display = 'flex';
  el.querySelector('#spHbClose').onclick  = () => hbOverlay.style.display = 'none';
  hbOverlay.onclick = e => { if (e.target === hbOverlay) hbOverlay.style.display = 'none'; };

  el.querySelector('#hbSpSave2').onclick = () => {
    const name = el.querySelector('#hbSpName').value.trim();
    if (!name) return;
    const entry = {
      name,
      level: +el.querySelector('#hbSpLevel').value,
      classes: s.classes.map(c => c.name), // available for all of the character's own classes
      attackRoll: el.querySelector('#hbSpAtk').checked,
      damage:  el.querySelector('#hbSpDamage').value.trim() || null,
      healing: el.querySelector('#hbSpHealing').value.trim() || null,
      saveType: el.querySelector('#hbSpSave').value || null,
      description: el.querySelector('#hbSpDesc').value.trim(),
      castTime: '-', range: '-', components: '-', duration: '-',
    };
    repo.addHomebrew('spells', entry);
    store.update({ spells: [...store.field('spells'), { name, level: entry.level, prepared: false }] });
    hbOverlay.style.display = 'none';
    bus.emit(EV.TOAST, { message: `✓ ${name} (HB)` });
  };
}

function esc(str) {
  return String(str ?? '').replace(/"/g, '&quot;');
}
