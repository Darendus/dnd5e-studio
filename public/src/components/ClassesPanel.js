// ============================================================
// components/ClassesPanel.js, Multiclass-Editor
// ------------------------------------------------------------
// Jede Zeile = eine Klasse mit eigener Stufe + Unterklasse.
// Beispiel: Paladin 5 / Warlock 1. Zauberplätze, Trefferwürfel
// und Übungsbonus werden automatisch daraus abgeleitet.
// ============================================================
import { store }   from '../core/Store.js';
import { repo }    from '../core/DataRepository.js';
import { bus, EV } from '../core/EventBus.js';
import { t }       from '../core/i18n.js';
import { calcSpellSlots, hitDiceSummary, calcMaxHP, calcMod, effectiveAbilities,
         featEffects, ABILITY_IDS } from '../rules/calculations.js';
import { featBonusFor } from '../rules/bonuses.js';
import { asiLevels, subclassEntryLevel } from '../rules/progression.js';

export function mountClasses() {
  render();
  bus.on(EV.CHAR_CHANGED, ({ changed }) => {
    if (changed.includes('classes') || changed.includes('*')) render();
  });
  bus.on(EV.LANG_CHANGED, render);
  bus.on(EV.SOURCES_CHANGED, render);
}

function render() {
  const el = document.getElementById('tab-classes');
  const s  = store.get();
  const allClasses = dedupeByName(repo.getClasses());
  const { casterLevel, pact } = calcSpellSlots(s.classes);

  el.innerHTML = `
  <div class="panel">
    <div class="panel__title">
      ${t('classes.title')}
      <button class="btn btn--sm" id="clsAdd">+ ${t('classes.addClass')}</button>
    </div>
    <p class="panel__hint" style="margin-bottom:10px">${t('classes.multiHint')}</p>

    ${s.classes.map((c, i) => {
      const clsData = repo.getClass(c.name);
      const subs = dedupeByName(clsData?.subclasses ?? []);
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
  </div>`;

  // == Events ==
  el.querySelector('#clsAdd').onclick = () => store.addClass(allClasses[0]?.name ?? 'Fighter');

  el.querySelectorAll('[data-cls-name]').forEach(sel => {
    sel.onchange = () => {
      const idx = +sel.dataset.clsName;
      store.updateClass(idx, { name: sel.value, subclass: null });
      // Rettungswurf-Übungen aus der HAUPTKLASSE übernehmen (5e-Regel:
      // nur die erste Klasse gewährt Save-Übungen; Multiclass nicht).
      if (idx === 0) {
        const saves = repo.getClass(sel.value)?.saves;
        if (saves?.length) {
          store.update({ saveProficiencies: [...saves] });
          bus.emit(EV.TOAST, { message: t('classes.savesApplied') + ': ' + saves.map(a => a.toUpperCase()).join(', ') });
        }
      }
      // Bekannte Zauber, die nur zur alten Klasse gehörten, entfernen
      // (Zauber anderer noch vorhandener Klassen bleiben erhalten).
      const remaining = store.field('classes').map(c => c.name);
      const kept = (store.field('spells') ?? []).filter(sp => {
        // Unterklassen-Zauber bleiben, solange die Unterklasse existiert
        if (sp.fromSubclass && store.field('classes').some(c => c.subclass === sp.fromSubclass)) return true;
        const lib = repo.findSpell(sp.name);
        if (!lib || sp.source === 'HB') return true;
        return (lib.classes ?? []).some(cn => remaining.includes(cn));
      });
      if (kept.length !== (store.field('spells') ?? []).length) {
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
      syncSubclassSpells(); // ggf. neue Domänen-Zauber ab dieser Stufe
    };
  });
  el.querySelectorAll('[data-cls-sub]').forEach(sel => {
    sel.onchange = () => {
      const idx = +sel.dataset.clsSub;
      const oldSub = store.field('classes')[idx]?.subclass;
      store.updateClass(idx, { subclass: sel.value || null });
      // Auto-Zauber der ALTEN Unterklasse entfernen, neue vergeben
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


// == Level-Up-Dialog =========================================
// Interaktiver Stufenaufstieg: Trefferpunkte (Durchschnitt oder
// gewürfelt), ggf. Unterklassen-Wahl, ASI-Stufen (Attribute ODER
// Talent) und Zauberauswahl für neu erreichbare Grade. ASI-Stufen
// sind klassenspezifisch (Kämpfer 6/14, Schurke 10 zusätzlich).

function showLevelUp(idx) {
  const s = store.get();
  const c = s.classes[idx];
  if (!c || c.level >= 20) return;
  const newLevel = (+c.level || 1) + 1;
  const cls = repo.getClass(c.name);
  const die = +(cls?.hitDie?.slice(1) ?? 8);
  const conMod = calcMod(effectiveAbilities(s).scores.con);
  const perLvl = featEffects(s).hpPerLevel;           // z. B. Zäh: +2
  const avg = Math.floor(die / 2) + 1;

  // Unterklasse fällig?
  const subLevel = subclassEntryLevel(c.name, s.ruleset);
  const needsSub = !c.subclass && newLevel >= subLevel && (cls?.subclasses?.length ?? 0) > 0;

  // ASI-Stufe? (klassenspezifisch)
  const isASI = asiLevels(c.name).includes(newLevel);

  // Zauber: welche Grade werden mit der neuen Stufe erreichbar?
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
  const learnable = isCaster
    ? repo.getSpellsForClasses(newClasses, s.feats)
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
        <b>${t('levelup.hp')}</b> <span class="row-dim">(W${die} ${conMod >= 0 ? '+' : ''}${conMod} KON${perLvl ? ` +${perLvl} ${t('levelup.fromFeats')}` : ''})</span>
        <div style="display:flex;gap:10px;align-items:center;margin-top:6px;flex-wrap:wrap">
          <label><input type="radio" name="luHp" value="avg" checked> ${t('levelup.hpAvg')} (${Math.max(1, avg + conMod + perLvl)})</label>
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
              <input type="checkbox" class="lib-select" value="${sp.name.replace(/"/g, '&quot;')}" data-lv="${sp.level}">
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

  // TP: Würfel-Modus
  let rolled = null;
  dlg.querySelectorAll('input[name="luHp"]').forEach(r => r.onchange = () => {
    q('#luRollBtn').style.display = r.value === 'roll' && r.checked ? '' : 'none';
  });
  q('#luRollBtn').onclick = () => {
    rolled = 1 + Math.floor(Math.random() * die);
    q('#luRollOut').textContent = `${rolled} + ${conMod + perLvl} = ${Math.max(1, rolled + conMod + perLvl)}`;
  };

  // ASI: Umschalten Attribut/Talent, +2 vs +1/+1, Talent-Suche
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

  // Zauber-Suche
  const spSearch = q('#luSpSearch');
  if (spSearch) spSearch.oninput = () => {
    const needle = spSearch.value.toLowerCase();
    dlg.querySelectorAll('[data-lu-sp]').forEach(row =>
      row.style.display = row.dataset.luSp.includes(needle) ? '' : 'none');
  };

  q('#luClose').onclick = () => dlg.remove();
  dlg.onclick = e => { if (e.target === dlg) dlg.remove(); };

  // == Anwenden ==
  q('#luApply').onclick = () => {
    // 1) TP-Zuwachs (min. 1)
    const useRoll = dlg.querySelector('input[name="luHp"]:checked')?.value === 'roll';
    if (useRoll && rolled == null) { q('#luRollBtn').click(); }
    const gain = Math.max(1, (useRoll ? rolled : avg) + conMod + perLvl);

    // 2) Stufe (+ ggf. Unterklasse)
    const patch = { level: newLevel };
    const pickedSub = q('#luSub')?.value || null;
    if (pickedSub) patch.subclass = pickedSub;
    store.updateClass(idx, patch);

    // 3) TP anwenden (aktuelle TP wachsen mit)
    store.update({
      maxHP: store.field('maxHP') + gain,
      currHP: store.field('currHP') + gain,
      hitDiceLeft: Math.min(store.totalLevel(), (store.field('hitDiceLeft') ?? 0) + 1),
    });

    const summary = [`+${gain} ${t('combat.maxHP')}`];

    // 4) ASI: Attribute oder Talent
    if (isASI) {
      const mode = dlg.querySelector('input[name="luAsi"]:checked')?.value;
      if (mode === 'attr') {
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
      } else {
        const featName = q('#luFeat').value;
        if (featName) {
          const feats = [...(store.field('feats') ?? []), featName];
          const featLevels = [...(store.field('featLevels') ?? []), newLevel];
          store.update({ feats, featLevels, featBonus: featBonusFor(feats) });
          // Feste/stufige TP-Boni des NEUEN Talents direkt aufschlagen
          const fx = repo.findFeat(featName)?.effects ?? {};
          const featHp = (fx.hpFlat ?? 0) + (fx.hpPerLevel ?? 0) * store.totalLevel();
          if (featHp) store.update({
            maxHP: store.field('maxHP') + featHp,
            currHP: store.field('currHP') + featHp,
          });
          summary.push(featName);
        }
      }
    }

    // 5) Gewählte Zauber lernen
    const picks = [...dlg.querySelectorAll('#luSpList input:checked')];
    if (picks.length) {
      const cur = store.field('spells') ?? [];
      store.update({ spells: [...cur, ...picks.map(cb =>
        ({ name: cb.value, level: +cb.dataset.lv, prepared: false }))] });
      summary.push(`${picks.length} ${t('tabs.spells')}`);
    }

    // 6) Unterklassen-Zauber der neuen Stufe synchronisieren
    syncSubclassSpells();

    dlg.remove();
    bus.emit(EV.TOAST, { message: `${c.name} ${newLevel}: ${summary.join(' · ')}` });
  };
}

// == Unterklassen-Zauber automatisch vergeben ================
// Domänen-/Eid-/Zirkel-Zauber (additionalSpells "prepared"/"known")
// werden beim Erreichen der jeweiligen Klassenstufe automatisch als
// vorbereitete Zauber eingetragen (markiert mit fromSubclass) und bei
// Stufensenkung oder Unterklassen-Wechsel wieder entfernt.
// Funktioniert für alle Klassen und beide Regelwerke (PHB14: ab St. 1,
// PHB24: ab St. 3, die Stufen kommen direkt aus den Daten).

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

    // Soll-Menge: alle Zauber der Stufen ≤ aktueller Klassenstufe
    const desired = new Map(); // lowercase → Spell-Objekt
    for (const [lvl, names] of Object.entries(auto)) {
      if (+lvl > (+c.level || 1)) continue;
      for (const n of names) {
        const lib = repo.findSpellCI(n);
        if (lib) desired.set(lib.name.toLowerCase(), lib);
      }
    }
    // Entfernen: Auto-Zauber dieser Unterklasse oberhalb der Stufe
    const before = spells.length;
    spells = spells.filter(sp =>
      sp.fromSubclass !== c.subclass || desired.has(sp.name.toLowerCase()));
    removed += before - spells.length;
    // Hinzufügen: fehlende Soll-Zauber (immer vorbereitet)
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

/** Nach einer Stufen-/Klassenänderung die maximalen TP neu berechnen.
 *  Stand der Charakter auf voller Gesundheit, bleiben die aktuellen TP
 *  am neuen Maximum; sonst wird nur maxHP angepasst (currHP gekappt). */
function syncHP() {
  const s = store.get();
  const newMax = calcMaxHP(s);
  if (newMax === s.maxHP) return;
  const wasFull = s.currHP >= s.maxHP;
  store.update({
    maxHP: newMax,
    currHP: wasFull ? newMax : Math.min(s.currHP, newMax),
  });
  bus.emit(EV.TOAST, { message: `${t('combat.maxHP')}: ${newMax}` });
}


/** Doppelte Einträge (gleicher Name, z. B. PHB + XPHB) nur einmal anzeigen */
function dedupeByName(arr) {
  return [...new Map(arr.map(e => [e.name, e])).values()];
}
