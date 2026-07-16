// ============================================================
// components/ClassesPanel.js, multiclass editor
// ------------------------------------------------------------
// Each row = one class with its own level + subclass.
// Example: Paladin 5 / Warlock 1. Spell slots, hit dice, and
// proficiency bonus are derived from this automatically.
// ============================================================
import { store }   from '../core/Store.js';
import { repo }    from '../core/DataRepository.js';
import { bus, EV } from '../core/EventBus.js';
import { t }       from '../core/i18n.js';
import { calcSpellSlots, hitDiceSummary, calcMaxHP, calcMod, fmtMod, effectiveAbilities,
         featEffects, ABILITY_IDS } from '../rules/calculations.js';
import { asiLevels, subclassEntryLevel } from '../rules/progression.js';
import { pickFeatSpellClass } from './FeatSpellChoice.js';
import { getAutoHpMethod } from '../core/hpSettings.js';
import { toggleExpand } from './InventoryPanel.js';
import { featEntries } from '../rules/featCasting.js';
import { escapeHtml } from '../utils/format.js';

export function mountClasses() {
  render();
  bus.on(EV.CHAR_CHANGED, ({ changed }) => {
    if (changed.includes('classes') || changed.includes('*')) render();
  });
  bus.on(EV.LANG_CHANGED, render);
  bus.on(EV.SOURCES_CHANGED, render);
}

// == Class/subclass features and per-level progression =======
// Combat abilities like Sneak Attack, Rage, Bardic Inspiration, etc.
// come straight from the ruleset's class feature text, plus any
// numeric/dice scaling table the class defines (e.g. Sneak Attack's
// die count by level), sourced by tools/updater.js from the same
// 5etools class file used for everything else about the class.

/** { label: display value } for a class's progression columns at `level` */
function progressionAt(classData, level) {
  const out = {};
  for (const [label, values] of Object.entries(classData?.progressionTable ?? {})) {
    const v = values[level - 1];
    if (v) out[label] = v;
  }
  return out;
}

/** All base-class + subclass features unlocked so far, across every
 *  class the character has, sorted by level then name. `clsDataByName`
 *  is the render()-level cache so each class is resolved only once. */
function unlockedFeatures(s, clsDataByName) {
  const rows = [];
  for (const c of s.classes ?? []) {
    const level = +c.level || 0;
    const data = clsDataByName.get(c.name);
    for (const f of data?.features ?? []) {
      if (f.level <= level) rows.push({ ...f, cls: c.name });
    }
    if (c.subclass) {
      const sub = data?.subclasses?.find(sc => sc.name === c.subclass);
      for (const f of sub?.features ?? []) {
        if (f.level <= level) rows.push({ ...f, cls: `${c.name} (${c.subclass})` });
      }
    }
  }
  return rows.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

function render() {
  const el = document.getElementById('tab-classes');
  const s  = store.get();
  const allClasses = repo.getClasses();
  const { casterLevel, pact } = calcSpellSlots(s.classes);

  // resolve each of the character's classes once and reuse below
  const clsDataByName = new Map(s.classes.map(c => [c.name, repo.getClass(c.name)]));

  const progressionRows = s.classes.flatMap(c => {
    const entries = Object.entries(progressionAt(clsDataByName.get(c.name), +c.level || 0));
    return entries.map(([label, val]) => ({ label, val, cls: c.name }));
  });
  const features = unlockedFeatures(s, clsDataByName);

  el.innerHTML = `
  <div class="panel">
    <div class="panel__title">
      ${t('classes.title')}
      <button class="btn btn--sm" id="clsAdd">+ ${t('classes.addClass')}</button>
    </div>
    <p class="panel__hint" style="margin-bottom:10px">${t('classes.multiHint')}</p>

    ${s.classes.map((c, i) => {
      const clsData = clsDataByName.get(c.name);
      const subs = clsData?.subclasses ?? [];
      return `
      <div class="class-row">
        <select data-cls-name="${i}">
          ${allClasses.map(cd => `<option ${cd.name === c.name ? 'selected' : ''}>${cd.name}</option>`).join('')}
          ${!allClasses.find(cd => cd.name === c.name) && c.name ? `<option selected>${c.name}</option>` : ''}
        </select>
        <input type="number" min="1" max="20" value="${c.level}" data-cls-level="${i}" title="${t('app.level')}">
        <select data-cls-sub="${i}">
          <option value="">${clsData?.subclassTitle ?? t('classes.subclass')}</option>
          ${subs.filter(sc => repo.isSourceEnabled(sc.source)).map(sc =>
            `<option ${sc.name === c.subclass ? 'selected' : ''}>${sc.name}</option>`).join('')}
          ${c.subclass && !subs.find(sc => sc.name === c.subclass) ? `<option selected>${c.subclass}</option>` : ''}
        </select>
        <button class="btn btn--sm btn--gold" data-cls-up="${i}" ${c.level >= 20 ? 'disabled' : ''}
                title="${t('levelup.title')}">▲ ${t('levelup.button')}</button>
        <button class="btn-icon" data-cls-remove="${i}" ${s.classes.length <= 1 ? 'disabled' : ''}>×</button>
      </div>`;
    }).join('')}
  </div>

  <div class="panel">
    <div class="panel__title">Abgeleitete Werte</div>
    <div class="stat-row">
      <div class="stat-box">
        <span class="stat-box__val">${store.totalLevel()}</span>
        <span class="stat-box__lbl">${t('classes.totalLevel')}</span>
      </div>
      <div class="stat-box">
        <span class="stat-box__val">${hitDiceSummary(s.classes)}</span>
        <span class="stat-box__lbl">${t('classes.hitDie')}</span>
      </div>
      <div class="stat-box">
        <span class="stat-box__val">${casterLevel}</span>
        <span class="stat-box__lbl">${t('classes.casterLevel')}</span>
      </div>
      ${pact ? `
      <div class="stat-box">
        <span class="stat-box__val">${pact.count}× Grad ${pact.level}</span>
        <span class="stat-box__lbl">Pact Slots (Warlock)</span>
      </div>` : ''}
    </div>
  </div>

  ${progressionRows.length ? `
  <div class="panel">
    <div class="panel__title">${t('classes.progression')}</div>
    <div class="stat-row">
      ${progressionRows.map(r => `
        <div class="stat-box">
          <span class="stat-box__val">${r.val}</span>
          <span class="stat-box__lbl">${r.label}${s.classes.length > 1 ? ` (${r.cls})` : ''}</span>
        </div>`).join('')}
    </div>
  </div>` : ''}

  <div class="panel">
    <div class="panel__title">${t('classes.features')}</div>
    <div id="clsFeatureList">
      ${features.map(f => `
        <div class="lib-entry lib-entry--expandable" data-expand>
          <div class="lib-entry__top">
            <span class="lib-entry__name"><b>${f.name}</b></span>
            <span class="tag" title="${t('feats.takenAt')}">${t('app.level')} ${f.level}</span>
            <span class="tag tag--src">${f.cls}</span>
          </div>
          <div class="lib-entry__desc">${f.text}</div>
        </div>`).join('') || `<p class="panel__hint">-</p>`}
    </div>
  </div>`;

  // == Events ==
  el.querySelector('#clsAdd').onclick = () => store.addClass(allClasses[0]?.name ?? 'Fighter');
  el.querySelector('#clsFeatureList')?.addEventListener('click', toggleExpand);

  el.querySelectorAll('[data-cls-name]').forEach(sel => {
    sel.onchange = () => {
      const idx = +sel.dataset.clsName;
      store.updateClass(idx, { name: sel.value, subclass: null });
      // adopt saving throw proficiencies from the FIRST class (5e rule:
      // only the first class grants save proficiencies; multiclassing does not).
      if (idx === 0) {
        const saves = repo.getClass(sel.value)?.saves;
        if (saves?.length) {
          store.update({ saveProficiencies: [...saves] });
          bus.emit(EV.TOAST, { message: t('classes.savesApplied') + ': ' + saves.map(a => a.toUpperCase()).join(', ') });
        }
      }
      // remove known spells that belonged only to the old class
      // (spells of other still-present classes are kept).
      const classesNow = store.field('classes');
      const remaining = classesNow.map(c => c.name);
      const spellsNow = store.field('spells') ?? [];
      const kept = spellsNow.filter(sp => {
        // subclass spells remain as long as the subclass exists
        if (sp.fromSubclass && classesNow.some(c => c.subclass === sp.fromSubclass)) return true;
        const lib = repo.findSpell(sp.name);
        if (!lib || sp.source === 'HB') return true;
        return (lib.classes ?? []).some(cn => remaining.includes(cn));
      });
      if (kept.length !== spellsNow.length) {
        store.update({ spells: kept });
        bus.emit(EV.TOAST, { message: t('spells.clearedForClass') });
      }
      syncHP();
    };
  });
  el.querySelectorAll('[data-cls-level]').forEach(inp => {
    inp.onchange = () => {
      store.updateClass(+inp.dataset.clsLevel,
        { level: Math.max(1, Math.min(20, +inp.value || 1)) });
      syncHP();
      syncSubclassSpells(); // possibly new domain spells from this level
    };
  });
  el.querySelectorAll('[data-cls-sub]').forEach(sel => {
    sel.onchange = () => {
      const idx = +sel.dataset.clsSub;
      const oldSub = store.field('classes')[idx]?.subclass;
      store.updateClass(idx, { subclass: sel.value || null });
      // remove auto spells of the OLD subclass, grant new ones
      if (oldSub) removeSubclassSpells(oldSub);
      syncSubclassSpells();
    };
  });
  el.querySelectorAll('[data-cls-up]').forEach(btn => {
    btn.onclick = () => showLevelUp(+btn.dataset.clsUp);
  });
  el.querySelectorAll('[data-cls-remove]').forEach(btn => {
    btn.onclick = () => {
      const oldSub = store.field('classes')[+btn.dataset.clsRemove]?.subclass;
      store.removeClass(+btn.dataset.clsRemove);
      if (oldSub) removeSubclassSpells(oldSub);
      syncHP();
    };
  });
}


// == Level-up dialog ===========================================
// Interactive leveling up: hit points (average or rolled), subclass
// choice if due, ASI levels (abilities OR feat), and spell selection
// for newly reachable levels. ASI levels are class-specific
// (Fighter additionally 6/14, Rogue additionally 10).

function showLevelUp(idx) {
  const s = store.get();
  const c = s.classes[idx];
  if (!c || c.level >= 20) return;
  const newLevel = (+c.level || 1) + 1;
  const cls = repo.getClass(c.name);
  const die = +(cls?.hitDie?.slice(1) ?? 8);
  const conMod = calcMod(effectiveAbilities(s).scores.con);
  const perLvl = featEffects(s).hpPerLevel;           // e.g. Tough: +2
  const avg = Math.floor(die / 2) + 1;

  // subclass due?
  const subLevel = subclassEntryLevel(c.name, s.ruleset);
  const needsSub = !c.subclass && newLevel >= subLevel && (cls?.subclasses?.length ?? 0) > 0;

  // ASI level? (class-specific)
  const isASI = asiLevels(c.name).includes(newLevel);

  // spells: which levels become reachable with the new level?
  const newClasses = s.classes.map((x, i) => i === idx ? { ...x, level: newLevel } : x);
  const maxLvOf = classes => {
    const { slots, pact } = calcSpellSlots(classes);
    let m = 0;
    slots.forEach((n, i) => { if (n > 0) m = i + 1; });
    if (pact) m = Math.max(m, pact.level);
    return m;
  };
  const oldMax = maxLvOf(s.classes), newMax = maxLvOf(newClasses);
  const isCaster = !!cls?.spellAbility;
  const known = new Set((s.spells ?? []).map(sp => sp.name.toLowerCase()));
  // Feat-granted spells (Magic Initiate etc.) aren't level/slot-based, so
  // they aren't offered here even for a caster; that's handled through the
  // Spells tab's Library once the feat's class choice is picked.
  const featSpellEntries = featEntries(s);
  const learnable = isCaster
    ? repo.getSpellsForClasses(newClasses, featSpellEntries)
        .filter(sp => sp.level > 0 && sp.level <= newMax && !known.has(sp.name.toLowerCase()))
        .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
    : [];

  const featPool = repo.getFeats()
    .filter(f => f.repeatable || !(s.feats ?? []).includes(f.name));

  const dlg = document.createElement('div');
  dlg.className = 'overlay';
  dlg.style.display = 'flex';
  dlg.style.zIndex = '10000';
  dlg.innerHTML = `
  <div class="modal" style="max-width:560px">
    <div class="modal__head"><b>${t('levelup.title')}: ${c.name} ${c.level} → ${newLevel}</b>
      <button class="btn-icon" id="luClose">×</button></div>
    <div class="modal__body" style="display:grid;gap:14px">

      <div>
        <b>${t('levelup.hp')}</b> <span class="row-dim">(W${die} ${fmtMod(conMod)} KON${perLvl ? ` +${perLvl} ${t('levelup.fromFeats')}` : ''})</span>
        <div style="display:flex;gap:10px;align-items:center;margin-top:6px;flex-wrap:wrap">
          <label><input type="radio" name="luHp" value="avg" checked> ${t('levelup.hpAvg')} (${Math.max(1, avg + conMod + perLvl)})</label>
          <label><input type="radio" name="luHp" value="max"> ${t('levelup.hpMax')} (${Math.max(1, die + conMod + perLvl)})</label>
          <label><input type="radio" name="luHp" value="roll"> ${t('levelup.hpRoll')}</label>
          <button class="btn btn--sm" id="luRollBtn" style="display:none">🎲 W${die}</button>
          <b id="luRollOut" style="color:var(--gold)"></b>
        </div>
      </div>

      ${needsSub ? `
      <div>
        <b>${cls?.subclassTitle ?? t('classes.subclass')}</b>
        <select id="luSub" style="margin-top:6px;width:100%">
          <option value="">${t('levelup.pick')}</option>
          ${cls.subclasses.filter(sc => repo.isSourceEnabled(sc.source))
            .map(sc => `<option>${sc.name}</option>`).join('')}
        </select>
      </div>` : ''}

      ${isASI ? `
      <div>
        <b>${t('levelup.asi')}</b>
        <div style="display:flex;gap:14px;margin:6px 0">
          <label><input type="radio" name="luAsi" value="attr" checked> ${t('levelup.asiAttr')}</label>
          <label><input type="radio" name="luAsi" value="feat"> ${t('levelup.asiFeat')}</label>
        </div>
        <div id="luAttrBox" style="display:flex;gap:10px;flex-wrap:wrap">
          <select id="luMode">
            <option value="2">+2</option>
            <option value="11">+1 / +1</option>
          </select>
          <select id="luA1">${ABILITY_IDS.map(a => `<option value="${a}">${t('abilities.' + a)}</option>`).join('')}</select>
          <select id="luA2" style="display:none">${ABILITY_IDS.map(a => `<option value="${a}">${t('abilities.' + a)}</option>`).join('')}</select>
        </div>
        <div id="luFeatBox" style="display:none">
          <input type="text" id="luFeatSearch" placeholder="${t('app.search')}…" style="width:100%;margin-bottom:6px">
          <select id="luFeat" size="6" style="width:100%">
            ${featPool.map(f => `<option>${f.name}</option>`).join('')}
          </select>
        </div>
      </div>` : ''}

      ${learnable.length && newMax >= oldMax ? `
      <div>
        <b>${t('levelup.spells')}</b>
        <span class="row-dim">${newMax > oldMax ? t('levelup.newGrade') + ': ' + newMax : ''}</span>
        <input type="text" id="luSpSearch" placeholder="${t('app.search')}…" style="width:100%;margin:6px 0">
        <div id="luSpList" style="max-height:200px;overflow:auto;border:1px solid var(--border);border-radius:6px;padding:6px">
          ${learnable.map(sp => `
            <label style="display:flex;gap:8px;align-items:center;padding:2px 4px" data-lu-sp="${sp.name.toLowerCase()}">
              <input type="checkbox" class="lib-select" value="${escapeHtml(sp.name)}" data-lv="${sp.level}">
              <span>${sp.name}</span>
              <span class="row-dim" style="margin-left:auto">${sp.level}${t('spells.grade')}${sp.school ? ' · ' + t('spells.school_' + sp.school) : ''}</span>
            </label>`).join('')}
        </div>
      </div>` : ''}

      <button class="btn btn--primary" id="luApply">✓ ${t('levelup.apply')}</button>
    </div>
  </div>`;
  document.body.appendChild(dlg);
  const q = sel => dlg.querySelector(sel);

  // HP: roll mode
  let rolled = null;
  dlg.querySelectorAll('input[name="luHp"]').forEach(r => r.onchange = () => {
    q('#luRollBtn').style.display = r.value === 'roll' && r.checked ? '' : 'none';
  });
  q('#luRollBtn').onclick = () => {
    rolled = 1 + Math.floor(Math.random() * die);
    q('#luRollOut').textContent = `${rolled} + ${conMod + perLvl} = ${Math.max(1, rolled + conMod + perLvl)}`;
  };

  // ASI: toggle ability/feat, +2 vs +1/+1, feat search
  if (isASI) {
    dlg.querySelectorAll('input[name="luAsi"]').forEach(r => r.onchange = () => {
      q('#luAttrBox').style.display = r.value === 'attr' && r.checked ? 'flex' : 'none';
      q('#luFeatBox').style.display = r.value === 'feat' && r.checked ? '' : 'none';
    });
    q('#luMode').onchange = () => {
      q('#luA2').style.display = q('#luMode').value === '11' ? '' : 'none';
    };
    q('#luFeatSearch').oninput = () => {
      const needle = q('#luFeatSearch').value.toLowerCase();
      [...q('#luFeat').options].forEach(o => o.hidden = !o.value.toLowerCase().includes(needle));
    };
  }

  // spell search
  const spSearch = q('#luSpSearch');
  if (spSearch) spSearch.oninput = () => {
    const needle = spSearch.value.toLowerCase();
    dlg.querySelectorAll('[data-lu-sp]').forEach(row =>
      row.style.display = row.dataset.luSp.includes(needle) ? '' : 'none');
  };

  q('#luClose').onclick = () => dlg.remove();
  dlg.onclick = e => { if (e.target === dlg) dlg.remove(); };

  // == Apply ==
  q('#luApply').onclick = async () => {
    // HP gain (min. 1)
    const hpMode = dlg.querySelector('input[name="luHp"]:checked')?.value;
    if (hpMode === 'roll' && rolled == null) { q('#luRollBtn').click(); }
    const hpBase = hpMode === 'roll' ? rolled : hpMode === 'max' ? die : avg;
    const gain = Math.max(1, hpBase + conMod + perLvl);

    // Resolve any async choice (a feat's spell-list class) BEFORE
    // committing the level/HP below: if the user cancels it, the whole
    // level-up is aborted instead of silently applying the level/HP
    // while dropping the ASI/feat the player picked.
    const asiMode = isASI ? dlg.querySelector('input[name="luAsi"]:checked')?.value : null;
    let asiFeatName = null, asiFeatPick = null;
    if (isASI && asiMode !== 'attr') {
      asiFeatName = q('#luFeat').value;
      if (asiFeatName) {
        // some feats (Magic Initiate, ...) grant spells from one of
        // several class lists; ask which one before adding
        const feat = repo.findFeat(asiFeatName);
        const options = repo.featSpellClassOptions(asiFeatName);
        asiFeatPick = await pickFeatSpellClass(feat, options);
        if (asiFeatPick === undefined) return; // cancelled -> abort the whole level-up
      }
    }

    // level (+ subclass if applicable)
    const patch = { level: newLevel };
    const pickedSub = q('#luSub')?.value || null;
    if (pickedSub) patch.subclass = pickedSub;
    store.updateClass(idx, patch);

    // apply HP (current HP grows along)
    store.update({
      maxHP: store.field('maxHP') + gain,
      currHP: store.field('currHP') + gain,
      hitDiceLeft: Math.min(store.totalLevel(), (store.field('hitDiceLeft') ?? 0) + 1),
    });

    const summary = [`+${gain} ${t('combat.maxHP')}`];

    // ASI: abilities or feat
    if (isASI) {
      if (asiMode === 'attr') {
        const bonusOf = a => (store.field('raceBonus')?.[a] ?? 0)
          + (store.field('bgBonus')?.[a] ?? 0) + (store.field('featBonus')?.[a] ?? 0);
        const bump = (a, n) => {
          const capped = Math.min(store.field(a) + n, 20 - bonusOf(a));
          if (capped > store.field(a)) store.update({ [a]: capped });
        };
        if (q('#luMode').value === '2') {
          bump(q('#luA1').value, 2);
          summary.push(`+2 ${t('abilities.' + q('#luA1').value)}`);
        } else {
          bump(q('#luA1').value, 1);
          const a2 = q('#luA2').value === q('#luA1').value
            ? ABILITY_IDS.find(a => a !== q('#luA1').value) : q('#luA2').value;
          bump(a2, 1);
          summary.push(`+1 ${t('abilities.' + q('#luA1').value)}, +1 ${t('abilities.' + a2)}`);
        }
      } else if (asiFeatName) {
        store.addFeat(asiFeatName, newLevel, asiFeatPick ? { class: asiFeatPick } : null);
        // apply fixed/per-level HP bonuses of the NEW feat directly
        const fx = repo.findFeat(asiFeatName)?.effects ?? {};
        const featHp = (fx.hpFlat ?? 0) + (fx.hpPerLevel ?? 0) * store.totalLevel();
        if (featHp) store.update({
          maxHP: store.field('maxHP') + featHp,
          currHP: store.field('currHP') + featHp,
        });
        summary.push(asiFeatName);
      }
    }

    // learn the chosen spells
    const picks = [...dlg.querySelectorAll('#luSpList input:checked')];
    if (picks.length) {
      const cur = store.field('spells') ?? [];
      store.update({ spells: [...cur, ...picks.map(cb =>
        ({ name: cb.value, level: +cb.dataset.lv, prepared: false }))] });
      summary.push(`${picks.length} ${t('tabs.spells')}`);
    }

    // sync subclass spells of the new level
    syncSubclassSpells();

    dlg.remove();
    bus.emit(EV.TOAST, { message: `${c.name} ${newLevel}: ${summary.join(' · ')}` });
  };
}

// == Automatically grant subclass spells =======================
// Domain/oath/circle spells (additionalSpells "prepared"/"known")
// are entered as prepared spells (marked with fromSubclass) once
// the respective class level is reached, and removed again on a
// level decrease or subclass change. Works for all classes and
// both rulesets (PHB14: from lvl 1, PHB24: from lvl 3; the levels
// come directly from the data).

function removeSubclassSpells(subclassName) {
  const kept = (store.field('spells') ?? []).filter(sp => sp.fromSubclass !== subclassName);
  if (kept.length !== (store.field('spells') ?? []).length) store.update({ spells: kept });
}

function syncSubclassSpells() {
  const classes = store.field('classes') ?? [];
  let spells = [...(store.field('spells') ?? [])];
  let added = 0, removed = 0;

  for (const c of classes) {
    if (!c.subclass) continue;
    const auto = repo.subclassAutoSpells(c.name, c.subclass);
    if (!auto) continue;

    // target set: all spells of levels ≤ current class level
    const desired = new Map(); // lowercase → spell object
    for (const [lvl, names] of Object.entries(auto)) {
      if (+lvl > (+c.level || 1)) continue;
      for (const n of names) {
        const lib = repo.findSpellCI(n);
        if (lib) desired.set(lib.name.toLowerCase(), lib);
      }
    }
    // remove: auto spells of this subclass above the level
    const before = spells.length;
    spells = spells.filter(sp =>
      sp.fromSubclass !== c.subclass || desired.has(sp.name.toLowerCase()));
    removed += before - spells.length;
    // add: missing target spells (always prepared)
    const have = new Set(spells.map(sp => sp.name.toLowerCase()));
    for (const [key, lib] of desired) {
      if (have.has(key)) continue;
      spells.push({ name: lib.name, level: lib.level, prepared: true, fromSubclass: c.subclass });
      added++;
    }
  }
  if (added || removed) {
    store.update({ spells });
    if (added) bus.emit(EV.TOAST, { message: `✓ ${added} ${t('spells.subclassGranted')}` });
  }
}

/** Recompute maximum HP after a level/class change.
 *  If the character was at full health, current HP stays at the
 *  new maximum; otherwise only maxHP is adjusted (currHP capped). */
function syncHP() {
  const s = store.get();
  const newMax = calcMaxHP(s, getAutoHpMethod());
  if (newMax === s.maxHP) return;
  const wasFull = s.currHP >= s.maxHP;
  store.update({
    maxHP: newMax,
    currHP: wasFull ? newMax : Math.min(s.currHP, newMax),
  });
  bus.emit(EV.TOAST, { message: `${t('combat.maxHP')}: ${newMax}` });
}
