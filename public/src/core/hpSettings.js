// ============================================================
// core/hpSettings.js, global default for HP calculation
// ------------------------------------------------------------
// Preference for how max HP is (re)computed outside the interactive
// per-level Level-Up dialog, which keeps its own average/roll choice
// for each level-up regardless of this setting: the Generator, the
// "recalc HP" actions, and the automatic resync after feat/class
// changes all read this instead of always assuming the average rule.
// ============================================================
const KEY = 'dnd5e_hp_method';
export const HP_METHODS = ['average', 'max', 'roll'];

export function getHpMethod() {
  try {
    const v = localStorage.getItem(KEY);
    return HP_METHODS.includes(v) ? v : 'average';
  } catch { return 'average'; }
}

export function setHpMethod(method) {
  if (!HP_METHODS.includes(method)) return;
  try { localStorage.setItem(KEY, method); } catch {}
}

/** For the AUTOMATIC resyncs (feat add/remove, class/level/subclass
 *  edits) rather than an explicit "recalc"/generate action: calcMaxHP()
 *  re-derives every level's HP from scratch on each call, so with
 *  'roll' it would silently re-roll already-rolled levels every time
 *  something unrelated changes. Falls back to 'average' there; the
 *  Generator and the explicit "recalc HP" button still honor 'roll'. */
export function getAutoHpMethod() {
  const m = getHpMethod();
  return m === 'roll' ? 'average' : m;
}
