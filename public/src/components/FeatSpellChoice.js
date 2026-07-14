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

let overlay = null;

/** @returns {Promise<string|null|undefined>}
 *    string    = chosen class name
 *    null      = feat doesn't need a choice (fewer than 2 options)
 *    undefined = user cancelled the prompt
 */
export function pickFeatSpellClass(feat, options) {
  if (!options?.length || options.length < 2) return Promise.resolve(null);

  return new Promise(resolve => {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'featSpellChoice';
      overlay.className = 'overlay';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="modal" style="max-width:420px">
        <div class="modal__head">
          <b>${esc(feat.name)}: ${t('feats.spellClassTitle')}</b>
          <button class="btn-icon" data-fsc="cancel">×</button>
        </div>
        <div class="modal__body">
          <p class="panel__hint" style="margin-bottom:10px">${t('feats.spellClassHint')}</p>
          <div style="display:grid;gap:8px">
            ${options.map(cn => `
              <button class="ruleset-option" data-fsc-pick="${esc(cn)}">
                <b>${esc(cn.charAt(0).toUpperCase() + cn.slice(1))}</b>
              </button>`).join('')}
          </div>
        </div>
      </div>`;
    overlay.style.display = 'flex';

    const done = value => { overlay.style.display = 'none'; resolve(value); };
    overlay.onclick = e => {
      if (e.target === overlay || e.target.closest('[data-fsc="cancel"]')) return done(undefined);
      const btn = e.target.closest('[data-fsc-pick]');
      if (btn) done(btn.dataset.fscPick);
    };
  });
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
