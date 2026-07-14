// ============================================================
// rules/bonuses.js, ability bonuses from race/background/feat
// ------------------------------------------------------------
// Fixed bonuses are set automatically; freely selectable bonuses
// ("choose") come as VARIANTS from the data:
//   abilityChoose = [{from:['int','wis','cha'], weights:[2,1]}, …]
// Each variant is a list of bonuses (weights) that the user
// distributes across different abilities from "from". 2024
// backgrounds offer e.g. two variants: +2/+1 or +1/+1/+1.
//
// The choice made lives on the character as
//   { variant: 0, picks: ['wis', 'cha'] }   (picks[i] ↔ weights[i])
// and is combined here with the fixed bonuses into the total bonus.
// ============================================================
import { repo } from '../core/DataRepository.js';

const ABILITY_IDS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

function fixedFrom(entry) {
  const out = {};
  for (const a of ABILITY_IDS) if (entry?.abilityBonuses?.[a]) out[a] = entry.abilityBonuses[a];
  return out;
}

/** Race entry (deduplicated, with raw fallback) */
export function raceEntry(raceName) {
  return repo.getRaces().find(x => x.name === raceName)
      ?? repo.races.find(x => x.name === raceName) ?? null;
}
/** Background entry */
export function bgEntry(bgName) {
  return repo.getBackgrounds().find(x => x.name === bgName)
      ?? repo.backgrounds.find(x => x.name === bgName) ?? null;
}

/**
 * Total bonus of an entry: fixed bonuses + distributed choice.
 * choice = { variant, picks } or null (then only fixed bonuses).
 * Invalid/incomplete picks are ignored (no duplicate ability).
 */
export function combinedBonus(entry, choice) {
  const out = fixedFrom(entry);
  const variants = entry?.abilityChoose;
  if (!variants || !choice) return out;
  const variant = variants[choice.variant ?? 0];
  if (!variant) return out;
  const used = new Set();
  variant.weights.forEach((w, i) => {
    const attr = choice.picks?.[i];
    if (!attr || !variant.from.includes(attr) || used.has(attr)) return;
    used.add(attr);
    out[attr] = (out[attr] ?? 0) + w;
  });
  return out;
}

/** Race bonuses (fixed + choice) */
export function raceBonusFor(raceName, choice = null) {
  return combinedBonus(raceEntry(raceName), choice);
}

/** Background bonuses (fixed + choice) */
export function bgBonusFor(bgName, choice = null) {
  return combinedBonus(bgEntry(bgName), choice);
}

/** Feat bonuses from the feat list */
export function featBonusFor(featNames) {
  const out = {};
  for (const name of featNames ?? []) {
    const f = repo.findFeat(name);
    for (const a of ABILITY_IDS) if (f?.abilityBonuses?.[a]) out[a] = (out[a] ?? 0) + f.abilityBonuses[a];
  }
  return out;
}
