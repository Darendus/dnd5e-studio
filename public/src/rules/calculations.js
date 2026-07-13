// ============================================================
// rules/calculations.js, D&D 5e Regelberechnungen
// Reine Funktionen ohne Seiteneffekte, inkl. Multiclassing.
// ============================================================
import { repo } from '../core/DataRepository.js';

// == Basis ====================================================

export const calcMod       = score => Math.floor(((score ?? 10) - 10) / 2);
export const calcProfBonus = level => Math.ceil((level ?? 1) / 4) + 1;
export const fmtMod        = n => (n >= 0 ? '+' : '') + n;

export function calcSkillBonus(attrMod, prof, expert, pb) {
  return attrMod + (expert ? pb * 2 : prof ? pb : 0);
}

// == Fertigkeiten-Definitionen (IDs sind i18n-Schlüssel) =====
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

// == Effektive Attribute (Basis + angelegte Items) ============
// Angelegte Gegenstände verändern Attribute dynamisch:
//  • static (z. B. Belt of Storm Giant Strength → STR 29):
//    Wert wird GESETZT, aber nur wenn er höher ist (RAW)
//  • add (z. B. Belt of Dwarvenkind → KON +2): wird ADDIERT (Kappe 30)
// Rückgabe enthält zusätzlich, WELCHES Item welches Attribut ändert,
// damit die Oberfläche es farblich hervorheben kann.

/**
 * @param {object} state, Charakterzustand (mit items[])
 * @returns {{ scores: object, sources: object }}
 *   scores  = effektive Werte je Attribut
 *   sources = { attr: [Itemnamen] } nur für tatsächlich geänderte Attribute
 */
export function effectiveAbilities(state) {
  const scores  = {};
  ABILITY_IDS.forEach(a => scores[a] = state[a] ?? 10);
  const sources = {};

  // == Rasse / Hintergrund / Talente ==
  // Diese Boni werden ADDITIV auf die Basiswerte gerechnet und
  // liegen als feste Bonus-Objekte am Charakter (beim Setzen von
  // Rasse/Hintergrund/Talent befüllt). Das hält die Basiswerte
  // editierbar und die Verrechnung transparent.
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

  // == Wildgestalt (Druide) ==
  // In Tierform übernimmt der Charakter STÄ/GES/KON des Tiers,
  // behält aber INT/WEI/CHA. Ausrüstung verschmilzt mit der Form
  // und wirkt nicht (RAW) → Item-Effekte werden übersprungen.
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
    if (!it.equipped) continue;                 // nur ANGELEGTE Items wirken
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

/** Kurzform: effektiver Modifikator eines Attributs */
export function effMod(state, attr) {
  return calcMod(effectiveAbilities(state).scores[attr]);
}

// == Waffenangriffe (aus angelegten Items) ====================
// Angriffsbonus = Übungsbonus + Attributsmodifikator:
//  • Fernkampfwaffe (type R) → GES
//  • Finesse (property F)    → das Bessere aus STÄ/GES
//  • sonst (Nahkampf)        → STÄ
// Es werden die EFFEKTIVEN Attribute genutzt (Items zählen mit).

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
  // Feste magische Boni (z. B. +1-Waffe oder Homebrew-Werte)
  const atkFlat = libItem?.atkBonus ?? 0;
  const dmgFlat = libItem?.dmgBonus ?? 0;
  return {
    atkBonus: pb + mod + atkFlat,
    dmgMod: mod + dmgFlat,
    ranged,
  };
}

// == Multiclass-Zauberplätze ==================================
// Nach PHB-Multiclassing-Regeln:
//  full caster  → volle Stufe          (Bard, Cleric, Druid, Sorcerer, Wizard)
//  1/2 caster   → Stufe / 2 abgerundet (Paladin, Ranger)
//  1/3 caster   → Stufe / 3 abgerundet (Eldritch Knight, Arcane Trickster)
//  pact (Warlock) → eigene Pakt-Slots, zählt NICHT zur Tabelle
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

// Warlock-Pakt-Slots: [Anzahl, Slot-Grad] je Warlock-Stufe
const PACT_TABLE = {
  1:[1,1], 2:[2,1], 3:[2,2], 4:[2,2], 5:[2,3], 6:[2,3], 7:[2,4], 8:[2,4],
  9:[2,5], 10:[2,5], 11:[3,5], 12:[3,5], 13:[3,5], 14:[3,5], 15:[3,5],
  16:[3,5], 17:[4,5], 18:[4,5], 19:[4,5], 20:[4,5],
};

/** Progression einer Klasse ermitteln (aus Repo-Daten oder Fallback) */
function casterProgression(className) {
  const cls = repo.getClass(className);
  if (cls?.casterProgression) return cls.casterProgression;
  // Fallback nach Klassenname (deckt Seed + Englisch ab)
  const FULL = ['Bard','Cleric','Druid','Sorcerer','Wizard','Barde','Kleriker','Druide','Zauberer','Magier'];
  const HALF = ['Paladin','Ranger'];
  const PACT = ['Warlock','Hexenmeister'];
  if (FULL.includes(className)) return 'full';
  if (HALF.includes(className)) return '1/2';
  if (PACT.includes(className)) return 'pact';
  return null;
}

/**
 * Zauberplätze für einen Multiclass-Charakter.
 * @param {Array<{name,level,subclass}>} classes
 * @returns {{ slots:number[], pact:{count,level}|null, casterLevel:number }}
 */
export function calcSpellSlots(classes) {
  let casterLevel = 0;
  let pact = null;

  // Rundungsregel: EINZELKLASSE nutzt die eigene Klassentabelle,
  // die dem AUFrunden entspricht (Paladin 5 = Casterstufe 3 = 4/2).
  // Erst die Multiclass-Regel (PHB Kap. 6) rundet AB. Stufe 1 der
  // Halbcaster und Stufen 1-2 der Drittelcaster geben nie Slots.
  const single = classes.length === 1;
  const half  = lvl => single ? (lvl < 2 ? 0 : Math.ceil(lvl / 2)) : Math.floor(lvl / 2);
  const third = lvl => single ? (lvl < 3 ? 0 : Math.ceil(lvl / 3)) : Math.floor(lvl / 3);

  for (const c of classes) {
    const lvl  = +c.level || 0;
    const prog = casterProgression(c.name);
    if (prog === 'full') casterLevel += lvl;
    else if (prog === '1/2') casterLevel += half(lvl);
    else if (prog === '1/3') casterLevel += third(lvl);
    else if (prog === 'pact') {
      const wl = Math.min(20, lvl);
      const p = PACT_TABLE[wl];
      if (p) pact = { count: p[0], level: p[1] };
      // Mystisches Arkanum: je ein Wirken von Grad 6/7/8/9 ab
      // Warlock-Stufe 11/13/15/17 (beide Editionen identisch)
      if (pact) {
        pact.arcanum = [[11, 6], [13, 7], [15, 8], [17, 9]]
          .filter(([minLvl]) => wl >= minLvl)
          .map(([, grade]) => grade);
      }
    }
    // Unterklassen-Caster (Eldritch Knight / Arcane Trickster)
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
 * Primäre Zauberfähigkeit: Nimmt die der ersten zaubernden Klasse.
 * (Bei echtem Multiclassing hat jede Klasse ihre eigene, wir zeigen
 *  die wichtigste an; Würfe pro Zauber nutzen die Klassenzuordnung.)
 */
export function primarySpellAbility(classes) {
  for (const c of classes) {
    const cls = repo.getClass(c.name);
    if (cls?.spellAbility) return cls.spellAbility;
  }
  return null;
}

/** Trefferwürfel-Zusammenfassung: "5d10 + 1d8" bei Multiclassing */
/**
 * Rüstungsklasse aus getragener Rüstung + Schild + GES:
 *  LA = RK + GES, MA = RK + min(GES,2), HA = fix; +2 (oder mehr) pro Schild.
 *  Magische Rüstungen/Schilde bringen ihren bonusAc in den eigenen RK-Wert
 *  ein (z. B. Dwarven Plate: 18 + 2 = 20). Ohne Rüstung: 10 + GES.
 *  Flache Boni von NICHT-Rüstungsgegenständen (Ring/Cloak of Protection)
 *  werden separat über itemBonuses(state).ac addiert.
 */
export function calcAC(state) {
  const dexMod = calcMod(effectiveAbilities(state).scores.dex);
  let base = 10 + dexMod;
  let shield = 0;
  for (const it of state.items ?? []) {
    if (!it.equipped) continue;
    const lib = repo.findItem(it.name);
    if (!lib?.ac) continue;
    // bonusAc einer magischen Rüstung/eines Schilds zählt zu DEREN RK
    const bonus = lib.bonusAc ?? 0;
    if (lib.type === 'S') { shield += lib.ac + bonus; continue; } // Schild-Basis meist 2
    base = lib.type === 'LA' ? lib.ac + dexMod + bonus
         : lib.type === 'MA' ? lib.ac + Math.min(dexMod, 2) + bonus
         : lib.ac + bonus; // HA und alles andere: fester Wert + Bonus
  }
  return base + shield + (itemBonuses(state).ac || 0);
}

/** Summe der mechanischen Feat-Effekte des Charakters */
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

/** Effektive Geschwindigkeit (Basis + Feat-Boni) */
export function effectiveSpeed(state) {
  return (state.speed ?? 30) + featEffects(state).speed;
}

/** Initiative-Bonus: GES-Mod + evtl. Feat-Bonus/Übungsbonus (Alert) */
export function effectiveInitiative(state) {
  const dexMod = calcMod(effectiveAbilities(state).scores.dex);
  const fe = featEffects(state);
  const pb = calcProfBonus((state.classes ?? []).reduce((s, c) => s + (+c.level || 0), 0) || 1);
  return dexMod + fe.initiative + (fe.initiativeProf ? pb : 0);
}

/** Traglast in lbs: STÄ × 15 × evtl. Faktor aus Feats */
export function carryCapacity(state) {
  const str = effectiveAbilities(state).scores.str;
  return str * 15 * featEffects(state).carryFactor;
}

/** Summe FLACHER Boni angelegter Items, die KEINE Rüstung/Schild sind
 *  (Ring/Cloak of Protection u. Ä.). Der bonusAc von Rüstungen/Schilden
 *  wird bereits in calcAC in deren eigenen RK-Wert eingerechnet und darf
 *  hier NICHT noch einmal zählen (sonst Doppelzählung, z. B. Dwarven Plate). */
export function itemBonuses(state) {
  const out = { save: 0, ac: 0, spellDc: 0, spellAtk: 0 };
  if (state.wildshape?.form) return out; // Ausrüstung wirkt in Tierform nicht
  for (const it of state.items ?? []) {
    if (!it.equipped) continue;
    const lib = repo.findItem(it.name);
    if (!lib) continue;
    const isArmorOrShield = lib.ac != null; // hat einen eigenen RK-Wert
    out.save     += lib.bonusSave     ?? 0;
    if (!isArmorOrShield) out.ac += lib.bonusAc ?? 0; // nur Ringe/Umhänge etc.
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
 * Maximale TP nach Durchschnittsregel (PHB):
 *  • Stufe 1 der ersten Klasse: volles Trefferwürfel-Maximum
 *  • jede weitere Stufe: Durchschnitt (Würfel/2 + 1)
 *  • + KON-Mod je Charakterstufe (effektive KON inkl. Boni)
 * Zusätzlich: das Talent "Tough" gibt +2 TP pro Stufe.
 */
export function calcMaxHP(state) {
  const classes = state.classes ?? [];
  const total = classes.reduce((s, c) => s + (+c.level || 0), 0);
  if (total < 1) return 1;
  const conMod = calcMod(effectiveAbilities(state).scores.con);

  let hp = 0, levelsCounted = 0;
  classes.forEach((c, ci) => {
    const die = +(repo.getClass(c.name)?.hitDie?.slice(1) ?? 8);
    const avg = Math.floor(die / 2) + 1;
    for (let l = 0; l < (+c.level || 0); l++) {
      // allererste Charakterstufe → Maximum, sonst Durchschnitt
      hp += (ci === 0 && l === 0) ? die : avg;
      levelsCounted++;
    }
  });
  hp += conMod * levelsCounted;
  // Talente mit TP-Bonus pro Stufe (z. B. Tough: +2/Stufe)
  const fe = featEffects(state);
  hp += fe.hpPerLevel * total;
  // Feste TP-Boni aus Talenten (z. B. Boon of Fortitude: +40)
  hp += fe.hpFlat;
  return Math.max(1, hp);
}
