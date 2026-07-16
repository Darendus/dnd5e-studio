// ============================================================
// rules/calculations.js, D&D 5e rules calculations
// Pure functions without side effects, incl. multiclassing.
// ============================================================
import { repo } from '../core/DataRepository.js';

// == Basics ===================================================

export const calcMod       = score => Math.floor(((score ?? 10) - 10) / 2);
export const calcProfBonus = level => Math.ceil((level ?? 1) / 4) + 1;
export const fmtMod        = n => (n >= 0 ? '+' : '') + n;

export function calcSkillBonus(attrMod, prof, expert, pb) {
  return attrMod + (expert ? pb * 2 : prof ? pb : 0);
}

// == Skill definitions (IDs are i18n keys) ===================
export const SKILL_DEFS = [
  { id: 'acrobatics', attr: 'dex' },   { id: 'animal', attr: 'wis' },
  { id: 'arcana', attr: 'int' },       { id: 'athletics', attr: 'str' },
  { id: 'deception', attr: 'cha' },    { id: 'history', attr: 'int' },
  { id: 'insight', attr: 'wis' },      { id: 'intimidation', attr: 'cha' },
  { id: 'investigation', attr: 'int' },{ id: 'medicine', attr: 'wis' },
  { id: 'nature', attr: 'int' },       { id: 'perception', attr: 'wis' },
  { id: 'performance', attr: 'cha' },  { id: 'persuasion', attr: 'cha' },
  { id: 'religion', attr: 'int' },     { id: 'sleight', attr: 'dex' },
  { id: 'stealth', attr: 'dex' },      { id: 'survival', attr: 'wis' },
];

export const ABILITY_IDS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

// == Effective abilities (base + equipped items) ==============
// Equipped items change abilities dynamically:
//  • static (e.g. Belt of Storm Giant Strength → STR 29):
//    value is SET, but only if it is higher (RAW)
//  • add (e.g. Belt of Dwarvenkind → CON +2): is ADDED (capped at 30)
// The return value additionally contains WHICH item changes which
// ability, so the UI can highlight it in color.

/**
 * @param {object} state, character state (with items[])
 * @returns {{ scores: object, sources: object }}
 *   scores  = effective value per ability
 *   sources = { attr: [item names] } only for actually changed abilities
 */
export function effectiveAbilities(state) {
  const scores  = {};
  ABILITY_IDS.forEach(a => scores[a] = state[a] ?? 10);
  const sources = {};

  // == Race / background / feats ==
  // These bonuses are calculated ADDITIVELY on top of the base values
  // and live as fixed bonus objects on the character (populated when
  // setting race/background/feat). This keeps the base values
  // editable and the calculation transparent.
  const applyBonus = (obj, label) => {
    for (const [attr, val] of Object.entries(obj ?? {})) {
      if (ABILITY_IDS.includes(attr) && val) {
        scores[attr] = Math.min(30, scores[attr] + val);
        (sources[attr] ??= []).push(label);
      }
    }
  };
  applyBonus(state.raceBonus,  'Race');
  applyBonus(state.bgBonus,    'Background');
  applyBonus(state.featBonus,  'Feat');

  // == Wild shape (druid) ==
  // In beast form the character takes on the beast's STR/DEX/CON,
  // but keeps INT/WIS/CHA. Equipment merges with the form and has
  // no effect (RAW) → item effects are skipped.
  if (state.wildshape?.form) {
    const beast = repo.findBeast(state.wildshape.form);
    if (beast) {
      for (const a of ['str', 'dex', 'con']) {
        if (beast[a] != null) {
          if (beast[a] !== scores[a]) (sources[a] ??= []).push(beast.name);
          scores[a] = beast[a];
        }
      }
      return { scores, sources };
    }
  }

  for (const it of state.items ?? []) {
    if (!it.equipped) continue;
    const lib = repo.findItem(it.name);
    const ab  = lib?.ability;
    if (!ab) continue;

    if (ab.static) {
      for (const [attr, val] of Object.entries(ab.static)) {
        if (ABILITY_IDS.includes(attr) && val > scores[attr]) {
          scores[attr] = val;
          (sources[attr] ??= []).push(lib.name);
        }
      }
    }
    if (ab.add) {
      for (const [attr, val] of Object.entries(ab.add)) {
        if (ABILITY_IDS.includes(attr)) {
          scores[attr] = Math.min(30, scores[attr] + val);
          (sources[attr] ??= []).push(lib.name);
        }
      }
    }
  }
  return { scores, sources };
}

// == Weapon attacks (from equipped items) ======================
// Attack bonus = proficiency bonus + ability modifier:
//  • ranged weapon (type R) → DEX
//  • finesse (property F)   → the better of STR/DEX
//  • otherwise (melee)      → STR
// The EFFECTIVE abilities are used (items count too).

export function weaponAttack(state, libItem) {
  const { scores } = effectiveAbilities(state);
  const strM = calcMod(scores.str), dexM = calcMod(scores.dex);
  const props  = libItem?.property ?? [];
  const ranged = String(libItem?.type ?? '').startsWith('R');
  const mod = ranged ? dexM
            : props.includes('F') ? Math.max(strM, dexM)
            : strM;
  const pb = calcProfBonus(
    (state.classes ?? []).reduce((s, c) => s + (+c.level || 0), 0) || 1);
  // fixed magical bonuses (e.g. +1 weapon or homebrew values)
  const atkFlat = libItem?.atkBonus ?? 0;
  const dmgFlat = libItem?.dmgBonus ?? 0;
  return {
    atkBonus: pb + mod + atkFlat,
    dmgMod: mod + dmgFlat,
    ranged,
  };
}

// == Multiclass spell slots ====================================
// Per PHB multiclassing rules:
//  full caster  → full level            (Bard, Cleric, Druid, Sorcerer, Wizard)
//  1/2 caster   → level / 2 rounded down (Paladin, Ranger)
//  1/3 caster   → level / 3 rounded down (Eldritch Knight, Arcane Trickster)
//  pact (Warlock) → own pact slots, does NOT count toward the table
// ------------------------------------------------------------

const SLOT_TABLE = {
  1:[2,0,0,0,0,0,0,0,0], 2:[3,0,0,0,0,0,0,0,0], 3:[4,2,0,0,0,0,0,0,0],
  4:[4,3,0,0,0,0,0,0,0], 5:[4,3,2,0,0,0,0,0,0], 6:[4,3,3,0,0,0,0,0,0],
  7:[4,3,3,1,0,0,0,0,0], 8:[4,3,3,2,0,0,0,0,0], 9:[4,3,3,3,1,0,0,0,0],
  10:[4,3,3,3,2,0,0,0,0],11:[4,3,3,3,2,1,0,0,0],12:[4,3,3,3,2,1,0,0,0],
  13:[4,3,3,3,2,1,1,0,0],14:[4,3,3,3,2,1,1,0,0],15:[4,3,3,3,2,1,1,1,0],
  16:[4,3,3,3,2,1,1,1,0],17:[4,3,3,3,2,1,1,1,1],18:[4,3,3,3,3,1,1,1,1],
  19:[4,3,3,3,3,2,1,1,1],20:[4,3,3,3,3,2,2,1,1],
};

// Warlock pact slots: [count, slot level] per warlock level
const PACT_TABLE = {
  1:[1,1], 2:[2,1], 3:[2,2], 4:[2,2], 5:[2,3], 6:[2,3], 7:[2,4], 8:[2,4],
  9:[2,5], 10:[2,5], 11:[3,5], 12:[3,5], 13:[3,5], 14:[3,5], 15:[3,5],
  16:[3,5], 17:[4,5], 18:[4,5], 19:[4,5], 20:[4,5],
};

/** Determine a class's progression (from repo data or fallback) */
function casterProgression(className) {
  const cls = repo.getClass(className);
  if (cls?.casterProgression) return cls.casterProgression;
  // fallback by class name (covers seed + English)
  const FULL = ['Bard','Cleric','Druid','Sorcerer','Wizard','Barde','Kleriker','Druide','Zauberer','Magier'];
  const HALF = ['Paladin','Ranger'];
  const PACT = ['Warlock','Hexenmeister'];
  if (FULL.includes(className)) return 'full';
  if (HALF.includes(className)) return '1/2';
  if (PACT.includes(className)) return 'pact';
  return null;
}

/**
 * Spell slots for a multiclass character.
 * @param {Array<{name,level,subclass}>} classes
 * @returns {{ slots:number[], pact:{count,level}|null, casterLevel:number }}
 */
export function calcSpellSlots(classes) {
  let casterLevel = 0;
  let pact = null;

  // Rounding rule: a SINGLE CLASS uses its own class table, which
  // corresponds to rounding UP (Paladin 5 = caster level 3 = 4/2).
  // Only the multiclass rule (PHB ch. 6) rounds DOWN. Level 1 of
  // half casters and levels 1-2 of third casters never grant slots.
  const single = classes.length === 1;
  const half  = lvl => single ? (lvl < 2 ? 0 : Math.ceil(lvl / 2)) : Math.floor(lvl / 2);
  const third = lvl => single ? (lvl < 3 ? 0 : Math.ceil(lvl / 3)) : Math.floor(lvl / 3);
  // Artificer is a half caster that (unlike Paladin/Ranger) already has
  // slots at level 1; per TCE it rounds UP in both single- and
  // multiclass, so half the level rounded up in every case.
  const artificer = lvl => Math.ceil(lvl / 2);

  for (const c of classes) {
    const lvl  = +c.level || 0;
    const prog = casterProgression(c.name);
    if (prog === 'full') casterLevel += lvl;
    else if (prog === '1/2') casterLevel += half(lvl);
    else if (prog === '1/3') casterLevel += third(lvl);
    else if (prog === 'artificer') casterLevel += artificer(lvl);
    else if (prog === 'pact') {
      const wl = Math.min(20, lvl);
      const p = PACT_TABLE[wl];
      if (p) pact = { count: p[0], level: p[1] };
      // Mystic Arcanum: one casting each of level 6/7/8/9 from
      // warlock level 11/13/15/17 (identical in both editions)
      if (pact) {
        pact.arcanum = [[11, 6], [13, 7], [15, 8], [17, 9]]
          .filter(([minLvl]) => wl >= minLvl)
          .map(([, grade]) => grade);
      }
    }
    // subclass casters (Eldritch Knight / Arcane Trickster)
    if (!prog && /eldritch knight|arcane trickster/i.test(c.subclass ?? '')) {
      casterLevel += third(lvl);
    }
  }

  casterLevel = Math.min(20, casterLevel);
  return {
    slots: casterLevel > 0 ? SLOT_TABLE[casterLevel] : Array(9).fill(0),
    pact,
    casterLevel,
  };
}

/**
 * Armor class from worn armor + shield + DEX:
 *  light armor = AC + DEX, medium armor = AC + min(DEX,2), heavy armor = fixed;
 *  +2 (or more) per shield. Magic armor/shields fold their bonusAc into
 *  their own AC value (e.g. Dwarven Plate: 18 + 2 = 20). Without armor: 10 + DEX.
 *  Flat bonuses from NON-armor items (Ring/Cloak of Protection) are added
 *  separately via itemBonuses(state).ac.
 */
export function calcAC(state) {
  const dexMod = calcMod(effectiveAbilities(state).scores.dex);
  let base = 10 + dexMod;
  let shield = 0;
  for (const it of state.items ?? []) {
    if (!it.equipped) continue;
    const lib = repo.findItem(it.name);
    if (!lib?.ac) continue;
    // bonusAc of a magic armor/shield counts toward ITS OWN AC
    const bonus = lib.bonusAc ?? 0;
    if (lib.type === 'S') { shield += lib.ac + bonus; continue; }
    base = lib.type === 'LA' ? lib.ac + dexMod + bonus
         : lib.type === 'MA' ? lib.ac + Math.min(dexMod, 2) + bonus
         : lib.ac + bonus; // heavy armor and everything else: fixed value + bonus
  }
  return base + shield + (itemBonuses(state).ac || 0);
}

/** Sum of the character's mechanical feat effects */
export function featEffects(state) {
  const out = { speed: 0, initiative: 0, hpPerLevel: 0, hpFlat: 0, carryFactor: 1, initiativeProf: false };
  for (const name of state.feats ?? []) {
    const f = repo.findFeat(name);
    if (!f) continue;
    out.speed      += f.effects?.speed ?? 0;
    out.initiative += f.effects?.initiative ?? 0;
    out.hpPerLevel += f.effects?.hpPerLevel ?? 0;
    out.hpFlat     += f.effects?.hpFlat ?? 0;
    if (f.effects?.carryFactor) out.carryFactor = Math.max(out.carryFactor, f.effects.carryFactor);
    if (f.flags?.initiativeProf) out.initiativeProf = true;
  }
  return out;
}

/** Effective speed (base + feat bonuses) */
export function effectiveSpeed(state) {
  return (state.speed ?? 30) + featEffects(state).speed;
}

/** Initiative bonus: DEX mod + possible feat bonus/proficiency bonus (Alert) */
export function effectiveInitiative(state) {
  const dexMod = calcMod(effectiveAbilities(state).scores.dex);
  const fe = featEffects(state);
  const pb = calcProfBonus((state.classes ?? []).reduce((s, c) => s + (+c.level || 0), 0) || 1);
  return dexMod + fe.initiative + (fe.initiativeProf ? pb : 0);
}

/** Carrying capacity in lbs: STR × 15 × possible factor from feats */
export function carryCapacity(state) {
  const str = effectiveAbilities(state).scores.str;
  return str * 15 * featEffects(state).carryFactor;
}

/** Sum of FLAT bonuses of equipped items that are NOT armor/shield
 *  (Ring/Cloak of Protection and similar). The bonusAc of armor/shields
 *  is already folded into their own AC value in calcAC and must NOT be
 *  counted again here (otherwise double counting, e.g. Dwarven Plate). */
export function itemBonuses(state) {
  const out = { save: 0, ac: 0, spellDc: 0, spellAtk: 0 };
  if (state.wildshape?.form) return out; // equipment has no effect in beast form
  for (const it of state.items ?? []) {
    if (!it.equipped) continue;
    const lib = repo.findItem(it.name);
    if (!lib) continue;
    const isArmorOrShield = lib.ac != null; // has its own AC value
    out.save     += lib.bonusSave     ?? 0;
    if (!isArmorOrShield) out.ac += lib.bonusAc ?? 0; // rings/cloaks etc. only
    out.spellDc  += lib.bonusSpellDc  ?? 0;
    out.spellAtk += lib.bonusSpellAtk ?? 0;
  }
  return out;
}

export function hitDiceSummary(classes) {
  const byDie = {};
  for (const c of classes) {
    const die = repo.getClass(c.name)?.hitDie ?? 'd8';
    byDie[die] = (byDie[die] ?? 0) + (+c.level || 0);
  }
  return Object.entries(byDie).map(([die, n]) => `${n}${die}`).join(' + ') || '-';
}

/**
 * Maximum HP, per one of three methods (PHB "Average" is the default):
 *  • 'average': every level but the very first uses the average (die/2 + 1)
 *  • 'max':     every level uses the full hit die
 *  • 'roll':    every level but the very first rolls the hit die
 *  In all three, the very first level of the very first class is always
 *  the full hit die maximum (RAW) regardless of method.
 *  + CON mod per character level (effective CON incl. bonuses).
 *  Additionally: the "Tough" feat grants +2 HP per level.
 */
export function calcMaxHP(state, method = 'average') {
  const classes = state.classes ?? [];
  const total = classes.reduce((s, c) => s + (+c.level || 0), 0);
  if (total < 1) return 1;
  const conMod = calcMod(effectiveAbilities(state).scores.con);

  let hp = 0, levelsCounted = 0;
  classes.forEach((c, ci) => {
    const die = +(repo.getClass(c.name)?.hitDie?.slice(1) ?? 8);
    const avg = Math.floor(die / 2) + 1;
    for (let l = 0; l < (+c.level || 0); l++) {
      if (ci === 0 && l === 0) hp += die; // very first character level → always maximum
      else if (method === 'max') hp += die;
      else if (method === 'roll') hp += 1 + Math.floor(Math.random() * die);
      else hp += avg; // 'average' (default)
      levelsCounted++;
    }
  });
  hp += conMod * levelsCounted;
  // feats with an HP bonus per level (e.g. Tough: +2/level)
  const fe = featEffects(state);
  hp += fe.hpPerLevel * total;
  // fixed HP bonuses from feats (e.g. Boon of Fortitude: +40)
  hp += fe.hpFlat;
  return Math.max(1, hp);
}
