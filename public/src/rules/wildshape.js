// ============================================================
// rules/wildshape.js, Wildgestalt-Regeln (PHB, inkl. Mond-Zirkel)
// ------------------------------------------------------------
// Standard-Druide ("Beast Shapes"-Tabelle):
//   Stufe 2:  max HG 1/4, KEIN Flug- und KEIN Schwimmtempo
//   Stufe 4:  max HG 1/2, KEIN Flugtempo
//   Stufe 8:  max HG 1,   keine Einschränkungen
//
// Zirkel des Mondes ("Circle Forms"):
//   Stufe 2:  max HG 1 (Bewegungs-Einschränkungen der Tabelle
//             gelten weiterhin: kein Schwimmen < St. 4, kein Flug < St. 8)
//   Stufe 6+: max HG = Druidenstufe / 3 (abgerundet)
//
// Bei Multiclassing zählt NUR die Druiden-Stufe.
// ============================================================
import { repo } from '../core/DataRepository.js';

/** Herausforderungsgrad-String → Zahl ("1/4" → 0.25) */
export function crToNumber(cr) {
  const s = String(cr);
  if (s.includes('/')) { const [a, b] = s.split('/'); return (+a) / (+b); }
  return +s || 0;
}

/** Druiden-Stufe (nur die Druide-Einträge im Multiclass-Array) */
export function druidLevel(classes) {
  return (classes ?? [])
    .filter(c => c.name === 'Druid')
    .reduce((sum, c) => sum + (+c.level || 0), 0);
}

/** Ist die Unterklasse "Circle of the Moon" gewählt? */
export function isMoonDruid(classes) {
  return (classes ?? []).some(c =>
    c.name === 'Druid' && /moon/i.test(c.subclass ?? ''));
}

/**
 * Aktuelle Wildgestalt-Grenzen des Charakters.
 * @returns {null | { level, moon, maxCR, noFly, noSwim }}
 *   null = keine Wildgestalt verfügbar (Druide < Stufe 2 oder kein Druide)
 */
export function wildshapeLimits(classes) {
  const level = druidLevel(classes);
  if (level < 2) return null;
  const moon = isMoonDruid(classes);

  let maxCR = level >= 8 ? 1 : level >= 4 ? 0.5 : 0.25;
  if (moon) maxCR = level >= 6 ? Math.floor(level / 3) : 1;

  return {
    level, moon, maxCR,
    noFly:  level < 8, // Flugtempo erst ab Stufe 8
    noSwim: level < 4, // Schwimmtempo erst ab Stufe 4
  };
}

/**
 * Elemental Wild Shape (Zirkel des Mondes, Stufe 10):
 * Verwandlung in Luft-/Erd-/Feuer-/Wasserelementar für ZWEI
 * Wildgestalt-Nutzungen. Die HG-/Bewegungs-Grenzen der
 * Tiergestalten-Tabelle gelten dafür NICHT.
 */
export function elementalUnlocked(classes) {
  return isMoonDruid(classes) && druidLevel(classes) >= 10;
}

/** Alle Formen aus dem Bestiarium, die der Charakter annehmen darf */
export function availableForms(classes) {
  const limits = wildshapeLimits(classes);
  if (!limits) return [];
  const elementals = elementalUnlocked(classes);
  return repo.getBeasts().filter(b => {
    // Elementare: eigener Freischalt-Pfad, Tier-Tabelle greift nicht
    if (b.elemental) return elementals;
    if (crToNumber(b.cr) > limits.maxCR) return false;
    if (limits.noFly  && b.speed?.fly)  return false;
    if (limits.noSwim && b.speed?.swim) return false;
    return true;
  });
}

/** Geschwindigkeits-Objekt hübsch formatieren: "40 ft, Schwimmen 40 ft" */
export function formatSpeed(speed, labels = {}) {
  const L = { walk: '', fly: labels.fly ?? 'Fly', swim: labels.swim ?? 'Swim',
              climb: labels.climb ?? 'Climb', burrow: labels.burrow ?? 'Burrow' };
  return Object.entries(speed ?? {})
    .map(([k, v]) => (L[k] ? L[k] + ' ' : '') + v + ' ft')
    .join(', ') || '-';
}
