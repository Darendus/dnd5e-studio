// ============================================================
// rules/progression.js
// Shared level and character constants that used to be duplicated
// across several components (ClassesPanel, Generator, CorePanel).
// One source of truth for:
//  * alignment abbreviations (i18n keys under align.*)
//  * ASI levels per class (Fighter and Rogue get extra levels)
//  * subclass entry level per class and ruleset
// ============================================================

/** The nine standard alignments (abbreviation = i18n key align.*) */
export const ALIGNMENTS = ['LG', 'NG', 'CG', 'LN', 'TN', 'CN', 'LE', 'NE', 'CE'];

/** ASI levels (Ability Score Improvement/feat) per class.
 *  Default: 4/8/12/16/19. Fighter additionally gets 6 and 14,
 *  Rogue additionally 10 (applies in both editions). */
const ASI_BY_CLASS = {
  Fighter: [4, 6, 8, 12, 14, 16, 19],
  Rogue:   [4, 8, 10, 12, 16, 19],
};
const ASI_DEFAULT = [4, 8, 12, 16, 19];

export function asiLevels(className) {
  return ASI_BY_CLASS[className] ?? ASI_DEFAULT;
}

/** Subclass entry level.
 *  2014: Cleric/Sorcerer/Warlock from 1, Druid/Wizard from 2, rest from 3.
 *  2024: all classes uniformly from level 3. */
const SUB_LVL_14 = { Cleric: 1, Sorcerer: 1, Warlock: 1, Druid: 2, Wizard: 2 };

export function subclassEntryLevel(className, ruleset) {
  return ruleset === 'phb24' ? 3 : (SUB_LVL_14[className] ?? 3);
}
