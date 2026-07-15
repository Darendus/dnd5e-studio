// ============================================================
// rules/featCasting.js, spellcasting ability for feat-granted spells
// ------------------------------------------------------------
// Feats like Magic Initiate let the player draw spells from one
// class's list, chosen when the feat is taken; that same class
// determines which ability governs those spells (PHB: Charisma
// for bard/sorcerer/warlock, Wisdom for cleric/druid, Intelligence
// for wizard — the 2024 XPHB version narrows the list of classes
// but keeps the same per-class ability).
// ============================================================
const ABILITY_BY_CLASS = {
  bard: 'cha', sorcerer: 'cha', warlock: 'cha',
  cleric: 'wis', druid: 'wis',
  wizard: 'int',
};

export function abilityForFeatClass(className) {
  return ABILITY_BY_CLASS[String(className ?? '').toLowerCase()] ?? 'int';
}

/** feats + their chosen spell-list class, zipped from the parallel
 *  feats/featChoices arrays (choice is null for feats without one) */
export function featEntries(s) {
  return (s.feats ?? []).map((name, i) => ({ name, choice: (s.featChoices ?? [])[i] ?? null }));
}
