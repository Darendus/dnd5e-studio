// ============================================================
// components/CombatPanel.js, HP, AC, attacks, death saving throws
// Attacks roll automatically: first the hit (d20+bonus),
// then damage (formula) via the dice engine.
// ============================================================
import { store }   from '../core/Store.js';
import { bus, EV } from '../core/EventBus.js';
import { t }       from '../core/i18n.js';
import { hitDiceSummary, fmtMod, calcMod, calcProfBonus, weaponAttack, effectiveAbilities, calcMaxHP, calcAC, featEffects } from '../rules/calculations.js';
import { repo } from '../core/DataRepository.js';
import { askRollMode } from './RollPrompt.js';
import { formatSpeed } from '../rules/wildshape.js';
import { d20, parseAndRoll, describeParts } from '../rules/dice.js';

export function mountCombat() {
  render();
  bus.on(EV.CHAR_CHANGED, ({ changed }) => {
    const rel = ['ac','maxHP','currHP','tempHP','attacks','deathSuccesses','deathFailures','classes','hitDiceLeft','items','spells','wildshape','inspiration','feats','str','dex','con','int','wis','cha','*'];
    if (changed.some(c => rel.includes(c))) render();
  });
  bus.on(EV.LANG_CHANGED, render);
}

function hpPct(s) { return Math.max(0, Math.min(100, Math.round((s.currHP / (s.maxHP || 1)) * 100))); }

function render() {
  const el = document.getElementById('tab-combat');
  const s  = store.get();
  const pct = hpPct(s);

  el.innerHTML = `
  <!-- attack roll result -->
  <div id="atkResult"></div>

  <div class="panel">
    <div class="panel__title">${t('combat.hp')}</div>
    <div class="stat-row" style="margin-bottom:10px">
      <div class="stat-box"><input type="number" id="cbMaxHP" value="${s.maxHP}" min="1"
        style="width:70px;text-align:center;font-size:18px;font-weight:600;border:none;background:none;color:var(--ink)">
        <span class="stat-box__lbl">${t('combat.maxHP')}${(() => {
          const fe = featEffects(s);
          const bonus = fe.hpFlat + fe.hpPerLevel * store.totalLevel();
          return bonus ? ` <span style="color:var(--gold)" title="+${bonus} ${t('combat.hpFromFeats')}">✦+${bonus}</span>` : '';
        })()}</span></div>
      <div class="stat-box"><input type="number" id="cbCurrHP" value="${s.currHP}" min="0"
        style="width:70px;text-align:center;font-size:18px;font-weight:600;border:none;background:none;color:var(--ink)">
        <span class="stat-box__lbl">${t('combat.currHP')}</span></div>
      <div class="stat-box"><input type="number" id="cbTempHP" value="${s.tempHP}" min="0"
        style="width:70px;text-align:center;font-size:18px;font-weight:600;border:none;background:none;color:var(--ink)">
        <span class="stat-box__lbl">${t('combat.tempHP')}</span></div>
      <div class="stat-box"><input type="number" id="cbAC" value="${s.ac}" min="0"
        style="width:70px;text-align:center;font-size:18px;font-weight:600;border:none;background:none;color:var(--ink)">
        <span class="stat-box__lbl">${t('combat.ac')}</span></div>
    </div>
    <div class="hp-bar"><div class="hp-fill ${pct <= 25 ? 'hp-fill--low' : pct <= 50 ? 'hp-fill--mid' : ''}" style="width:${pct}%"></div></div>
    <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap">
      <button class="btn btn--sm btn--danger" id="cbDamage">− ${t('combat.damage')}</button>
      <input type="number" id="cbAmount" value="1" min="1" style="width:64px;text-align:center">
      <button class="btn btn--sm" id="cbHeal">+ ${t('combat.heal')}</button>
      <button class="btn btn--sm" id="cbShortRest" title="${t('combat.shortRestHint')}">${t('combat.shortRest')}</button>
      <button class="btn btn--sm btn--gold" id="cbLongRest">${t('combat.longRest')}</button>
      <button class="btn btn--sm" id="cbRecalcHP" title="${t('combat.recalcHPHint')}">↺ ${t('combat.maxHP')}</button>
      <button class="btn btn--sm" id="cbRecalcAC" title="${t('combat.recalcACHint')}">↺ ${t('combat.ac')}</button>
      <span style="flex:1"></span>
      <span class="panel__hint">${t('combat.hitDice')}: <b>${hitDiceSummary(s.classes)}</b></span>
    </div>
  </div>

  <div class="panel-row">
    <div class="panel">
      <div class="panel__title">${t('combat.deathSaves')}</div>
      <div style="display:flex;gap:24px;justify-content:center;padding:8px 0">
        <div>
          <div class="panel__hint" style="text-align:center;margin-bottom:6px">${t('combat.success')}</div>
          <div style="display:flex;gap:6px">
            ${[0,1,2].map(i => `<button class="ds-bubble ds-bubble--s ${i < s.deathSuccesses ? 'filled' : ''}" data-ds="s" data-i="${i}"></button>`).join('')}
          </div>
        </div>
        <div>
          <div class="panel__hint" style="text-align:center;margin-bottom:6px">${t('combat.fail')}</div>
          <div style="display:flex;gap:6px">
            ${[0,1,2].map(i => `<button class="ds-bubble ds-bubble--f ${i < s.deathFailures ? 'filled' : ''}" data-ds="f" data-i="${i}"></button>`).join('')}
          </div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel__title">Inspiration & Sonstiges</div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink)">
        <input type="checkbox" id="cbInsp" ${s.inspiration ? 'checked' : ''}> ✦ Inspiration
      </label>
    </div>
  </div>

  ${renderWildshapeSection(s)}

  <!-- attacks: equipped weapons + known damage-dealing spells -->
  <div class="panel">
    <div class="panel__title">${t('combat.attacks')}, ${t('combat.weapons')}</div>
    ${renderWeaponRows(s)}
  </div>

  <div class="panel">
    <div class="panel__title">${t('combat.attacks')}, ${t('tabs.spells')}</div>
    ${renderSpellRows(s)}
  </div>

  <div class="panel">
    <div class="panel__title">${t('combat.customAttacks')}</div>
    ${s.attacks.map((a, i) => `
      <div class="list-row">
        <span class="row-grow"><b>${a.name}</b></span>
        <span class="row-dim">${a.damage}</span>
        <button class="btn btn--sm btn--gold" data-catk-hit="${i}">${t('combat.hitRoll')} ${a.bonus}</button>
        <button class="btn btn--sm btn--danger" data-catk-dmg="${i}">${t('combat.dmgRoll')}</button>
        <button class="btn-icon" data-atk-remove="${i}">×</button>
      </div>`).join('') || `<p class="panel__hint">-</p>`}
    <div style="display:flex;gap:8px;margin-top:10px">
      <input type="text" id="atkName" placeholder="${t('combat.weaponName')}" style="flex:1">
      <input type="text" id="atkBonus" placeholder="+5" style="width:64px">
      <input type="text" id="atkDmg" placeholder="1d8+3" style="width:90px">
      <button class="btn btn--sm" id="atkAdd">+ ${t('app.add')}</button>
    </div>
  </div>`;

  bindEvents(el, s);
}

// == Equipped weapons from the inventory =======================
// Source: items with equipped=true whose library entry has a
// damage die (dmg1). Attack bonus from proficiency bonus +
// STR/DEX (ranged → DEX, finesse → the better of the two).

function equippedWeapons(s) {
  const seen = new Set();
  const out = [];
  for (const it of s.items ?? []) {
    if (!it.equipped) continue;
    const lib = repo.findItem(it.name);
    if (!lib?.dmg1 || seen.has(lib.name)) continue;
    seen.add(lib.name);
    out.push({ item: it, lib, ...weaponAttack(s, lib) });
  }
  return out;
}

function renderWeaponRows(s) {
  const weapons = equippedWeapons(s);
  if (!weapons.length) return `<p class="panel__hint">${t('combat.noWeapons')}</p>`;
  return weapons.map(w => `
    <div class="list-row">
      <span class="row-grow"><b>${w.lib.name}</b>
        <span class="tag tag--src">${w.ranged ? t('combat.ranged') : t('combat.melee')}</span>
      </span>
      <span class="row-dim">${w.lib.dmg1}${w.dmgMod ? fmtMod(w.dmgMod) : ''} ${w.lib.dmgType ?? ''}</span>
      <button class="btn btn--sm btn--gold" data-wpn-hit="${esc(w.lib.name)}">${t('combat.hitRoll')} ${fmtMod(w.atkBonus)}</button>
      <button class="btn btn--sm btn--danger" data-wpn-dmg="${esc(w.lib.name)}">${t('combat.dmgRoll')}</button>
    </div>`).join('');
}

// == Damage spells from "known spells" =========================
// Attack roll/damage/saving throw were extracted from the spell
// descriptions during the data update (attackRoll, damage, saveType).

function damagingSpells(s) {
  const eff = effectiveAbilities(s).scores;
  const pb  = calcProfBonus((s.classes ?? []).reduce((a, c) => a + (+c.level || 0), 0) || 1);
  const out = [];
  for (const sp of s.spells ?? []) {
    if (!sp.prepared) continue; // only PREPARED spells (red dot)
    const lib = repo.findSpell(sp.name);
    if (!lib?.damage) continue;
    // determine the spellcasting ability of the matching class
    let mod = 0;
    for (const c of s.classes ?? []) {
      const cd = repo.getClass(c.name);
      if (cd?.spellAbility && (lib.classes ?? []).includes(c.name)) { mod = calcMod(eff[cd.spellAbility]); break; }
      if (cd?.spellAbility && !mod) mod = calcMod(eff[cd.spellAbility]);
    }
    out.push({ lib, atkBonus: pb + mod, dc: 8 + pb + mod });
  }
  return out;
}

function renderSpellRows(s) {
  const spells = damagingSpells(s);
  if (!spells.length) return `<p class="panel__hint">${t('combat.noSpells')}</p>`;
  return spells.map(sp => `
    <div class="list-row">
      <span class="row-grow"><b>${sp.lib.name}</b>
        <span class="tag tag--src">${sp.lib.level === 0 ? t('spells.cantrips') : sp.lib.level + t('spells.grade')}</span>
      </span>
      <span class="row-dim">${sp.lib.damage} ${sp.lib.damageType ?? ''}</span>
      ${sp.lib.attackRoll
        ? `<button class="btn btn--sm btn--gold" data-sp-hit="${esc(sp.lib.name)}">${t('combat.hitRoll')} ${fmtMod(sp.atkBonus)}</button>`
        : sp.lib.saveType
          ? `<span class="tag tag--save">${sp.lib.saveType.toUpperCase()} DC ${sp.dc}</span>`
          : ''}
      <button class="btn btn--sm btn--danger" data-sp-dmg="${esc(sp.lib.name)}">${t('combat.dmgRoll')}</button>
    </div>`).join('');
}

// == Wild shape in combat =======================================
// In beast form: AC/HP of the form, its attacks with hit and
// damage rolls (bonuses from the beast's stat block), reverting back.

function renderWildshapeSection(s) {
  if (!s.wildshape?.form) return '';
  const beast = repo.findBeast(s.wildshape.form);
  if (!beast) return '';
  return `
  <div class="panel" style="border-color:var(--boost)">
    <div class="panel__title" style="color:var(--boost)">
      ${t('wildshape.currentForm')}: ${beast.name}
      <button class="btn btn--sm btn--danger" id="cwsRevert">↩ ${t('wildshape.revert')}</button>
    </div>
    <div class="stat-row" style="margin-bottom:10px">
      <div class="stat-box"><span class="stat-box__val">${beast.ac}</span>
        <span class="stat-box__lbl">${t('combat.ac')}</span></div>
      <div class="stat-box">
        <input type="number" id="cwsHP" value="${s.wildshape.currHP}" min="0" max="${beast.hp}"
               style="width:64px;text-align:center;font-size:18px;font-weight:600;border:none;background:none;color:var(--ink)">
        <span class="stat-box__lbl">${t('wildshape.formHP')} / ${beast.hp}</span>
      </div>
      <div class="stat-box"><span class="stat-box__val" style="font-size:13px">${formatSpeed(beast.speed)}</span>
        <span class="stat-box__lbl">${t('abilities.speed')}</span></div>
    </div>
    ${(beast.actions ?? []).map((a, i) => `
      <div class="list-row">
        <span class="row-grow"><b>${a.name}</b></span>
        ${a.damage ? `<span class="row-dim">${a.damage}</span>` : ''}
        ${a.attackBonus !== null
          ? `<button class="btn btn--sm btn--gold" data-ws-hit="${i}">${t('combat.hitRoll')} ${fmtMod(a.attackBonus)}</button>` : ''}
        ${a.damage
          ? `<button class="btn btn--sm btn--danger" data-ws-dmg="${i}">${t('combat.dmgRoll')}</button>` : ''}
      </div>`).join('') || `<p class="panel__hint">-</p>`}
  </div>`;
}

function esc(str) { return String(str ?? '').replace(/"/g, '&quot;'); }

// == Roll logic: separate hit and damage roll ==================
// After a critical hit, lastCrit remembers the entry - the next
// damage roll for it automatically doubles the dice.
const lastCrit = new Set();

function showSteps(steps) {
  document.getElementById('atkResult').innerHTML = `
    <div class="panel">
      ${steps.map(st => `
        <div class="cast-step cast-step--${st.cls}">
          <span class="cast-step__label">${st.label}</span>
          <span class="cast-step__detail">${st.detail}</span>
          <span class="cast-step__val">${st.val}</span>
        </div>`).join('')}
    </div>`;
}

async function rollHit(key, label, bonus) {
  // prompt: advantage / normal / disadvantage (cancel possible)
  const mode = await askRollMode(label);
  if (!mode) return;

  const hit = d20(bonus, mode);
  if (hit.isCrit) lastCrit.add(key); else lastCrit.delete(key);
  // with advantage/disadvantage show both d20s: "W20(14|3)→14"
  const dice = hit.second !== null
    ? `W20(${hit.first}|${hit.second})→${hit.raw}` : `W20(${hit.raw})`;
  showSteps([{
    cls: hit.isCrit ? 'crit' : hit.isFumble ? 'fail' : 'atk',
    label: `${label}, ${t('combat.hitRoll')}${mode === 'adv' ? ' (' + t('dice.advantage') + ')' : mode === 'dis' ? ' (' + t('dice.disadvantage') + ')' : ''}`,
    detail: `${dice} ${fmtMod(bonus)}${hit.isCrit ? ', ' + t('spells.crit') : hit.isFumble ? ', ' + t('spells.fumble') : ''}`,
    val: hit.total,
  }]);
}

function rollDmg(key, label, formula, flatMod = 0) {
  const crit = lastCrit.delete(key); // consume the crit once
  let f = formula;
  if (crit) f = f.replace(/(\d+)d/g, (m, n) => (+n * 2) + 'd');
  if (flatMod) f += (flatMod > 0 ? '+' : '') + flatMod;
  const dmg = parseAndRoll(f);
  if (!dmg) return;
  showSteps([{
    cls: crit ? 'crit' : 'dmg',
    label: `${label}, ${t('combat.dmgRoll')}${crit ? ' (' + t('spells.crit') + ')' : ''}`,
    detail: describeParts(dmg.parts),
    val: dmg.total,
  }]);
}

function bindEvents(el, s) {
  const upd = (id, key, min = 0) => {
    el.querySelector(id).onchange = e =>
      store.update({ [key]: Math.max(min, +e.target.value || min) });
  };
  upd('#cbMaxHP', 'maxHP', 1);
  upd('#cbCurrHP', 'currHP');
  upd('#cbTempHP', 'tempHP');
  // manually editing AC → suspend automatic adjustment from armor
  el.querySelector('#cbAC').onchange = e =>
    store.update({ ac: Math.max(0, +e.target.value || 0), acManual: true });

  el.querySelector('#cbDamage').onclick = () => {
    const amt = +el.querySelector('#cbAmount').value || 1;
    store.update({ currHP: Math.max(0, store.field('currHP') - amt) });
  };
  el.querySelector('#cbHeal').onclick = () => {
    const amt = +el.querySelector('#cbAmount').value || 1;
    store.update({ currHP: Math.min(store.field('maxHP'), store.field('currHP') + amt) });
  };
  el.querySelector('#cbShortRest').onclick = () => {
    store.shortRest();
    bus.emit(EV.TOAST, { message: t('combat.shortRestDone') });
  };
  el.querySelector('#cbLongRest').onclick = () => {
    store.longRest();
    bus.emit(EV.TOAST, { message: t('combat.longRestDone') });
  };
  el.querySelector('#cbRecalcHP').onclick = () => {
    const newMax = calcMaxHP(store.get());
    const wasFull = store.field('currHP') >= store.field('maxHP');
    store.update({ maxHP: newMax, currHP: wasFull ? newMax : Math.min(store.field('currHP'), newMax) });
    bus.emit(EV.TOAST, { message: `${t('combat.maxHP')}: ${newMax}` });
  };
  el.querySelector('#cbRecalcAC').onclick = () => {
    const newAC = calcAC(store.get());
    // back to automatic: AC follows armor again from now on
    store.update({ ac: newAC, acManual: false });
    bus.emit(EV.TOAST, { message: `${t('combat.ac')}: ${newAC}` });
  };
  el.querySelector('#cbInsp').onchange = e => store.update({ inspiration: e.target.checked });

  // death saving throws: clicking bubble n sets the counter to n+1 (or n on another click)
  el.querySelectorAll('[data-ds]').forEach(b => {
    b.onclick = () => {
      const key = b.dataset.ds === 's' ? 'deathSuccesses' : 'deathFailures';
      const idx = +b.dataset.i + 1;
      store.update({ [key]: store.field(key) === idx ? idx - 1 : idx });
    };
  });

  // add / remove attack
  el.querySelector('#atkAdd').onclick = () => {
    const name = el.querySelector('#atkName').value.trim();
    if (!name) return;
    store.update({ attacks: [...store.field('attacks'), {
      name,
      bonus: el.querySelector('#atkBonus').value.trim() || '+0',
      damage: el.querySelector('#atkDmg').value.trim() || '1d6',
    }]});
  };
  el.querySelectorAll('[data-atk-remove]').forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      const atks = store.field('attacks');
      atks.splice(+b.dataset.atkRemove, 1);
      store.update({ attacks: atks });
    };
  });

  // weapons: hit roll / damage roll (equipped items)
  el.querySelectorAll('[data-wpn-hit]').forEach(b => {
    b.onclick = () => {
      const w = equippedWeapons(store.get()).find(x => x.lib.name === b.dataset.wpnHit);
      if (w) rollHit('w:' + w.lib.name, w.lib.name, w.atkBonus);
    };
  });
  el.querySelectorAll('[data-wpn-dmg]').forEach(b => {
    b.onclick = () => {
      const w = equippedWeapons(store.get()).find(x => x.lib.name === b.dataset.wpnDmg);
      if (w) rollDmg('w:' + w.lib.name, w.lib.name, w.lib.dmg1, w.dmgMod);
    };
  });

  // spells: hit roll / damage roll (known damage spells)
  el.querySelectorAll('[data-sp-hit]').forEach(b => {
    b.onclick = () => {
      const sp = damagingSpells(store.get()).find(x => x.lib.name === b.dataset.spHit);
      if (sp) rollHit('s:' + sp.lib.name, sp.lib.name, sp.atkBonus);
    };
  });
  el.querySelectorAll('[data-sp-dmg]').forEach(b => {
    b.onclick = () => {
      const sp = damagingSpells(store.get()).find(x => x.lib.name === b.dataset.spDmg);
      if (sp) rollDmg('s:' + sp.lib.name, sp.lib.name, sp.lib.damage);
    };
  });

  // custom attacks: hit / damage
  el.querySelectorAll('[data-catk-hit]').forEach(b => {
    b.onclick = () => {
      const a = store.field('attacks')[+b.dataset.catkHit];
      if (a) rollHit('c:' + a.name, a.name, parseInt(a.bonus, 10) || 0);
    };
  });
  el.querySelectorAll('[data-catk-dmg]').forEach(b => {
    b.onclick = () => {
      const a = store.field('attacks')[+b.dataset.catkDmg];
      if (a) rollDmg('c:' + a.name, a.name, a.damage);
    };
  });

  // wild shape: the beast form's attacks (bonuses from the stat block)
  const wsBeast = s.wildshape?.form ? repo.findBeast(s.wildshape.form) : null;
  el.querySelectorAll('[data-ws-hit]').forEach(b => {
    b.onclick = () => {
      const a = wsBeast?.actions?.[+b.dataset.wsHit];
      if (a) rollHit('ws:' + a.name, `${wsBeast.name}, ${a.name}`, a.attackBonus);
    };
  });
  el.querySelectorAll('[data-ws-dmg]').forEach(b => {
    b.onclick = () => {
      const a = wsBeast?.actions?.[+b.dataset.wsDmg];
      if (a?.damage) rollDmg('ws:' + a.name, `${wsBeast.name}, ${a.name}`, a.damage);
    };
  });
  el.querySelector('#cwsRevert')?.addEventListener('click', () =>
    store.update({ wildshape: null }));
  el.querySelector('#cwsHP')?.addEventListener('change', e => {
    const val = Math.max(0, +e.target.value || 0);
    if (val === 0) {
      store.update({ wildshape: null });
      bus.emit(EV.TOAST, { message: t('wildshape.revertedAtZero') });
    } else {
      store.update({ wildshape: { ...store.field('wildshape'), currHP: val } });
    }
  });
}
