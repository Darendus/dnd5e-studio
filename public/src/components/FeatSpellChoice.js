// ============================================================
// components/FeatSpellChoice.js, class-list prompt for feats
// ------------------------------------------------------------
// Some feats (Magic Initiate, Ritual Caster, ...) grant spells from
// ONE class's list, chosen when the feat is taken. This small dialog
// asks which list to use; the choice is stored on the character in
// featChoices (parallel to feats/featLevels) and later narrows the
// Spell Library to that one class, and picks the correct casting
// ability for those spells (see rules/featCasting.js).
//
// Usage:
//   const choice = await pickFeatSpellClass(feat);
//   if (choice === undefined) return;   // user cancelled -> abort
//   // choice is null if the feat doesn't need a choice at all
// ============================================================
import { t } from '../core/i18n.js';
import { escapeHtml, capitalize } from '../utils/format.js';

let overlay = null;
// resolves the previous still-open prompt (as cancelled) so its promise
// never hangs once a second call reuses the shared overlay/handlers
let cancelPending = null;

/** @returns {Promise<string|null|undefined>}
 *    string    = chosen class name
 *    null      = feat doesn't need a choice (fewer than 2 options)
 *    undefined = user cancelled the prompt
 */
export function pickFeatSpellClass(feat, options) {
  if (!options?.length || options.length < 2) return Promise.resolve(null);

  cancelPending?.();

  return new Promise(resolve => {
    cancelPending = () => { cancelPending = null; resolve(undefined); };
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'featSpellChoice';
      overlay.className = 'overlay';
      // this prompt can be opened from within the Level-Up dialog, which
      // sets its own overlay to z-index 10000 — without this it would be
      // painted (and click-hit-tested) BEHIND that dialog and be unusable
      overlay.style.zIndex = '10010';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="modal" style="max-width:420px">
        <div class="modal__head">
          <b>${escapeHtml(feat.name)}: ${t('feats.spellClassTitle')}</b>
          <button class="btn-icon" data-fsc="cancel">×</button>
        </div>
        <div class="modal__body">
          <p class="panel__hint" style="margin-bottom:10px">${t('feats.spellClassHint')}</p>
          <div style="display:grid;gap:8px">
            ${options.map(cn => `
              <button class="ruleset-option" data-fsc-pick="${escapeHtml(cn)}">
                <b>${escapeHtml(capitalize(cn))}</b>
              </button>`).join('')}
          </div>
        </div>
      </div>`;
    overlay.style.display = 'flex';

    const done = value => { cancelPending = null; overlay.style.display = 'none'; resolve(value); };
    overlay.onclick = e => {
      if (e.target === overlay || e.target.closest('[data-fsc="cancel"]')) return done(undefined);
      const btn = e.target.closest('[data-fsc-pick]');
      if (btn) done(btn.dataset.fscPick);
    };
  });
}

