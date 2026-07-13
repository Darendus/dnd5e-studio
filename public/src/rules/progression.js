// ============================================================
// rules/progression.js
// Gemeinsame Stufen- und Charakter-Konstanten, die zuvor in
// mehreren Komponenten dupliziert waren (ClassesPanel, Generator,
// CorePanel). Eine Quelle der Wahrheit fuer:
//  * Gesinnungs-Kuerzel (i18n-Schluessel unter align.*)
//  * ASI-Stufen je Klasse (Kaempfer und Schurke haben Zusatzstufen)
//  * Einstiegsstufe der Unterklasse je Klasse und Regelwerk
// ============================================================

/** Die neun Standard-Gesinnungen (Kuerzel = i18n-Schluessel align.*) */
export const ALIGNMENTS = ['LG', 'NG', 'CG', 'LN', 'TN', 'CN', 'LE', 'NE', 'CE'];

/** ASI-Stufen (Attributsverbesserung/Talent) je Klasse.
 *  Standard: 4/8/12/16/19. Kaempfer erhaelt zusaetzlich 6 und 14,
 *  Schurke zusaetzlich 10 (gilt in beiden Editionen). */
const ASI_BY_CLASS = {
  Fighter: [4, 6, 8, 12, 14, 16, 19],
  Rogue:   [4, 8, 10, 12, 16, 19],
};
const ASI_DEFAULT = [4, 8, 12, 16, 19];

export function asiLevels(className) {
  return ASI_BY_CLASS[className] ?? ASI_DEFAULT;
}

/** Einstiegsstufe der Unterklasse.
 *  2014: Kleriker/Sorcerer/Warlock ab 1, Druide/Magier ab 2, Rest ab 3.
 *  2024: alle Klassen einheitlich ab Stufe 3. */
const SUB_LVL_14 = { Cleric: 1, Sorcerer: 1, Warlock: 1, Druid: 2, Wizard: 2 };

export function subclassEntryLevel(className, ruleset) {
  return ruleset === 'phb24' ? 3 : (SUB_LVL_14[className] ?? 3);
}
