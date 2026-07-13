// ============================================================
// rules/bonuses.js, Attributs-Boni aus Rasse/Hintergrund/Talent
// ------------------------------------------------------------
// Feste Boni werden automatisch gesetzt; frei wählbare Boni
// ("choose") kommen als VARIANTEN aus den Daten:
//   abilityChoose = [{from:['int','wis','cha'], weights:[2,1]}, …]
// Jede Variante ist eine Liste von Boni (weights), die der Nutzer
// auf verschiedene Attribute aus "from" verteilt. 2024er-Hinter-
// gründe bieten z. B. zwei Varianten: +2/+1 oder +1/+1/+1.
//
// Die getroffene Wahl liegt am Charakter als
//   { variant: 0, picks: ['wis', 'cha'] }   (picks[i] ↔ weights[i])
// und wird hier mit den festen Boni zum Gesamt-Bonus kombiniert.
// ============================================================
import { repo } from '../core/DataRepository.js';

const ABILITY_IDS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

function fixedFrom(entry) {
  const out = {};
  for (const a of ABILITY_IDS) if (entry?.abilityBonuses?.[a]) out[a] = entry.abilityBonuses[a];
  return out;
}

/** Rassen-Eintrag (dedupliziert, mit Roh-Fallback) */
export function raceEntry(raceName) {
  return repo.getRaces().find(x => x.name === raceName)
      ?? repo.races.find(x => x.name === raceName) ?? null;
}
/** Hintergrund-Eintrag */
export function bgEntry(bgName) {
  return repo.getBackgrounds().find(x => x.name === bgName)
      ?? repo.backgrounds.find(x => x.name === bgName) ?? null;
}

/**
 * Gesamt-Bonus eines Eintrags: feste Boni + verteilte Wahl.
 * choice = { variant, picks } oder null (dann nur feste Boni).
 * Ungültige/unvollständige picks werden ignoriert (kein Doppel-Attribut).
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

/** Rasse-Boni (fest + Wahl) */
export function raceBonusFor(raceName, choice = null) {
  return combinedBonus(raceEntry(raceName), choice);
}

/** Hintergrund-Boni (fest + Wahl) */
export function bgBonusFor(bgName, choice = null) {
  return combinedBonus(bgEntry(bgName), choice);
}

/** Talent-Boni aus der Feat-Liste */
export function featBonusFor(featNames) {
  const out = {};
  for (const name of featNames ?? []) {
    const f = repo.findFeat(name);
    for (const a of ABILITY_IDS) if (f?.abilityBonuses?.[a]) out[a] = (out[a] ?? 0) + f.abilityBonuses[a];
  }
  return out;
}
