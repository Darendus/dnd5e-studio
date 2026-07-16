// ============================================================
// components/RollPrompt.js, prompt before rolling
// ------------------------------------------------------------
// Before every d20 roll with a modifier (ability, skill, saving
// throw, initiative, hit rolls, spell attacks), this small dialog
// appears: disadvantage / normal / advantage.
// Cancel (×, background, Esc) aborts the roll.
//
// Usage:
//   const mode = await askRollMode('Stealth');
//   if (!mode) return;            // cancelled
//   rollSkill('stealth', mode);   // 'normal' | 'adv' | 'dis'
// ============================================================
import { t } from '../core/i18n.js';
import { escapeHtml } from '../utils/format.js';

let overlay = null;
let cleanup = null;

export function askRollMode(label = '') {
  return new Promise(resolve => {
    // cancel any open dialog (double clicks etc.)
    if (cleanup) cleanup(null);

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'rollPrompt';
      overlay.className = 'overlay';
      document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
      <div class="modal roll-prompt">
        <div class="modal__head">
          <b>${escapeHtml(label) || t('dice.howToRoll')}</b>
          <button class="btn-icon" data-rp="cancel">×</button>
        </div>
        <div class="roll-prompt__body">
          <button class="btn roll-prompt__btn roll-prompt__btn--dis"    data-rp="dis">${t('dice.disadvantage')}</button>
          <button class="btn roll-prompt__btn roll-prompt__btn--normal" data-rp="normal">${t('dice.normal')}</button>
          <button class="btn roll-prompt__btn roll-prompt__btn--adv"    data-rp="adv">${t('dice.advantage')}</button>
        </div>
      </div>`;
    overlay.style.display = 'flex';

    const done = mode => {
      overlay.style.display = 'none';
      document.removeEventListener('keydown', onKey);
      cleanup = null;
      resolve(mode);
    };
    cleanup = done;

    const onKey = e => {
      if (e.key === 'Escape') done(null);
      if (e.key === 'Enter')  done('normal'); // Enter = normal roll
    };
    document.addEventListener('keydown', onKey);

    overlay.onclick = e => {
      if (e.target === overlay) return done(null); // background = cancel
      const btn = e.target.closest('[data-rp]');
      if (!btn) return;
      done(btn.dataset.rp === 'cancel' ? null : btn.dataset.rp);
    };

    // focus "Normal" for quick keyboard use
    overlay.querySelector('[data-rp="normal"]')?.focus();
  });
}

