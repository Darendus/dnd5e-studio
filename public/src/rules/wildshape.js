// ============================================================
// rules/wildshape.js, wild shape rules (PHB, incl. Circle of the Moon)
// ------------------------------------------------------------
// Standard druid ("Beast Shapes" table):
//   level 2:  max CR 1/4, NO flying and NO swimming speed
//   level 4:  max CR 1/2, NO flying speed
//   level 8:  max CR 1,   no restrictions
//
// Circle of the Moon ("Circle Forms"):
//   level 2:  max CR 1 (movement restrictions of the table still
//             apply: no swimming < lvl 4, no flying < lvl 8)
//   level 6+: max CR = druid level / 3 (rounded down)
//
// With multiclassing, ONLY the druid level counts.
// ============================================================
import { repo } from '../core/DataRepository.js';

/** Challenge rating string → number ("1/4" → 0.25) */
export function crToNumber(cr) {
  const s = String(cr);
  if (s.includes('/')) { const [a, b] = s.split('/'); return (+a) / (+b); }
  return +s || 0;
}

/** Druid level (only the druid entries in the multiclass array) */
export function druidLevel(classes) {
  return (classes ?? [])
    .filter(c => c.name === 'Druid')
    .reduce((sum, c) => sum + (+c.level || 0), 0);
}

/** Is the "Circle of the Moon" subclass selected? */
export function isMoonDruid(classes) {
  return (classes ?? []).some(c =>
    c.name === 'Druid' && /moon/i.test(c.subclass ?? ''));
}

/**
 * Character's current wild shape limits.
 * @returns {null | { level, moon, maxCR, noFly, noSwim }}
 *   null = no wild shape available (druid < level 2 or not a druid)
 */
export function wildshapeLimits(classes) {
  const level = druidLevel(classes);
  if (level < 2) return null;
  const moon = isMoonDruid(classes);

  let maxCR = level >= 8 ? 1 : level >= 4 ? 0.5 : 0.25;
  if (moon) maxCR = level >= 6 ? Math.floor(level / 3) : 1;

  return {
    level, moon, maxCR,
    noFly:  level < 8, // flying speed only from level 8
    noSwim: level < 4, // swimming speed only from level 4
  };
}

/**
 * Elemental Wild Shape (Circle of the Moon, level 10):
 * Transformation into an air/earth/fire/water elemental for TWO
 * wild shape uses. The CR/movement limits of the beast shape
 * table do NOT apply to this.
 */
export function elementalUnlocked(classes) {
  return isMoonDruid(classes) && druidLevel(classes) >= 10;
}

/** All forms from the bestiary the character is allowed to take */
export function availableForms(classes) {
  const limits = wildshapeLimits(classes);
  if (!limits) return [];
  const elementals = elementalUnlocked(classes);
  return repo.getBeasts().filter(b => {
    // elementals: own unlock path, the beast table does not apply
    if (b.elemental) return elementals;
    if (crToNumber(b.cr) > limits.maxCR) return false;
    if (limits.noFly  && b.speed?.fly)  return false;
    if (limits.noSwim && b.speed?.swim) return false;
    return true;
  });
}

/** Nicely format a speed object: "40 ft, Swim 40 ft" */
export function formatSpeed(speed, labels = {}) {
  const L = { walk: '', fly: labels.fly ?? 'Fly', swim: labels.swim ?? 'Swim',
              climb: labels.climb ?? 'Climb', burrow: labels.burrow ?? 'Burrow' };
  return Object.entries(speed ?? {})
    .map(([k, v]) => (L[k] ? L[k] + ' ' : '') + v + ' ft')
    .join(', ') || '-';
}
