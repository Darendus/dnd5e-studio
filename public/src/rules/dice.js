// ============================================================
// rules/dice.js, dice engine of the dice bot
// ------------------------------------------------------------
// • Formula parser:  "2d6+3", "1d20-1", "4d6kh3" (keep highest 3)
// • Advantage/disadvantage for d20 rolls
// • Automatic modifier rolls (ability / skill / save) fetch their
//   bonuses directly from Store + rules.
// ============================================================
import { store } from '../core/Store.js';
import {
  calcMod, calcProfBonus, calcSkillBonus, fmtMod, SKILL_DEFS, effectiveAbilities, itemBonuses,
} from './calculations.js';
import { bus, EV } from '../core/EventBus.js';
import { t } from '../core/i18n.js';

// == Basic roll ===============================================
export function roll(sides, count = 1) {
  // dS with S≤0 has no sides → 0 (prevents 1d0 incorrectly returning 1)
  if (!sides || sides < 1) return Array.from({ length: count }, () => 0);
  return Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
}

// == Formula parser ===========================================
// Supports: NdS, NdSkhX (keep highest), NdSklX (keep lowest), +/- bonus,
// multiple terms: "2d6+1d4+3"
export function parseAndRoll(formula) {
  const clean = formula.replace(/\s+/g, '').toLowerCase();
  if (!clean) return null;

  const termRe = /([+-]?)(?:(\d*)d(\d+)(?:k([hl])(\d+))?|(\d+))/g;
  let match, total = 0;
  const parts = [];
  let matchedLen = 0;

  while ((match = termRe.exec(clean)) !== null) {
    matchedLen += match[0].length;
    const sign = match[1] === '-' ? -1 : 1;

    if (match[3]) { // dice term
      const count = +(match[2] || 1);
      const sides = +match[3];
      if (count > 100 || sides > 1000) return null; // guard
      let rolls = roll(sides, count);
      let kept  = rolls;
      if (match[4]) { // keep highest/lowest
        const keep = +match[5];
        const sorted = [...rolls].sort((a, b) => match[4] === 'h' ? b - a : a - b);
        kept = sorted.slice(0, keep);
      }
      const sum = kept.reduce((a, b) => a + b, 0);
      total += sign * sum;
      parts.push({ type: 'dice', text: `${count}d${sides}${match[4] ? 'k' + match[4] + match[5] : ''}`, rolls, kept, sign });
    } else {      // constant
      total += sign * +match[6];
      parts.push({ type: 'const', text: match[6], sign });
    }
  }

  if (matchedLen !== clean.length) return null; // invalid characters
  return { total, parts, formula: clean };
}

/** Roll detail as a string, e.g. "[4, 2] + 3" */
export function describeParts(parts) {
  return parts.map((p, i) => {
    const sign = i === 0 ? (p.sign < 0 ? '-' : '') : (p.sign < 0 ? ' − ' : ' + ');
    if (p.type === 'const') return sign + p.text;
    const shown = p.kept.length !== p.rolls.length
      ? `[${p.rolls.join(',')}→${p.kept.join(',')}]`
      : `[${p.rolls.join(', ')}]`;
    return sign + shown;
  }).join('');
}

// == d20 with advantage/disadvantage ==========================
// mode: 'normal' | 'adv' | 'dis'
export function d20(mod = 0, mode = 'normal') {
  const first  = roll(20)[0];
  const second = mode === 'normal' ? null : roll(20)[0];
  const raw = second === null ? first
            : mode === 'adv' ? Math.max(first, second)
            : Math.min(first, second);
  return {
    raw, first, second,
    total: raw + mod,
    isCrit: raw === 20,
    isFumble: raw === 1,
  };
}

// == Automatic rolls (dice bot core) ===========================
// These functions compute the modifier autonomously from the
// character state and publish the result on the bus.

function publish(total, label, detail, special = '') {
  bus.emit(EV.ROLL_RESULT, { total, label, detail, special });
}

function d20Detail(r, mod, suffix) {
  const both = r.second !== null ? `W20(${r.first}|${r.second})→${r.raw}` : `W20(${r.raw})`;
  return `${both} ${fmtMod(mod)} ${suffix}`;
}

/** Ability check, e.g. rollAbility('dex', 'adv') */
export function rollAbility(attr, mode = 'normal') {
  const mod = calcMod(effectiveAbilities(store.get()).scores[attr]);
  const r   = d20(mod, mode);
  const special = r.isCrit ? 'crit' : r.isFumble ? 'fail' : '';
  const note = r.isCrit ? `, ${t('spells.crit')}` : r.isFumble ? `, ${t('spells.fumble')}` : '';
  publish(r.total, t(`abilities.${attr}`), d20Detail(r, mod, t(`abilities.${attr}`)) + note, special);
  return r;
}

/** Skill check incl. proficiency/expertise, e.g. rollSkill('stealth') */
export function rollSkill(skillId, mode = 'normal') {
  const def = SKILL_DEFS.find(s => s.id === skillId);
  if (!def) return null;
  const s   = store.get();
  const eff = effectiveAbilities(s).scores;
  const pb  = calcProfBonus(store.totalLevel());
  const mod = calcSkillBonus(
    calcMod(eff[def.attr]),
    s.skillProficiencies.includes(skillId),
    s.skillExpertise.includes(skillId),
    pb,
  );
  const r = d20(mod, mode);
  const special = r.isCrit ? 'crit' : r.isFumble ? 'fail' : '';
  publish(r.total, t(`skills.${skillId}`), d20Detail(r, mod, t(`skills.${skillId}`)), special);
  return r;
}

/** Saving throw incl. proficiency + flat item bonuses (e.g. Cloak of Protection) */
export function rollSave(attr, mode = 'normal') {
  const s   = store.get();
  const eff = effectiveAbilities(s).scores;
  const pb  = calcProfBonus(store.totalLevel());
  const mod = calcMod(eff[attr]) + (s.saveProficiencies.includes(attr) ? pb : 0)
            + (itemBonuses(s).save || 0);
  const r   = d20(mod, mode);
  const special = r.isCrit ? 'crit' : r.isFumble ? 'fail' : '';
  publish(r.total, `${t(`abilities.${attr}`)} Save`, d20Detail(r, mod, 'Save'), special);
  return r;
}

/** Initiative (DEX mod) */
export function rollInitiative(mode = 'normal') {
  const mod = calcMod(effectiveAbilities(store.get()).scores.dex);
  const r = d20(mod, mode);
  publish(r.total, t('abilities.initiative'), d20Detail(r, mod, 'Init'));
  return r;
}

/** Roll a free-form formula */
export function rollFormula(formula) {
  const result = parseAndRoll(formula);
  if (!result) return null;
  publish(result.total, formula, describeParts(result.parts) + ` = ${result.total}`);
  return result;
}
