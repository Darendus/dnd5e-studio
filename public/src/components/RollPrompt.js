// ============================================================
// components/RollPrompt.js, Abfrage vor dem Würfeln
// ------------------------------------------------------------
// Vor jedem W20-Wurf mit Modifikator (Attribut, Fertigkeit,
// Rettungswurf, Initiative, Treffer-Würfe, Zauberangriffe)
// erscheint dieser kleine Dialog: Nachteil / Normal / Vorteil.
// Abbrechen (×, Hintergrund, Esc) bricht den Wurf ab.
//
// Verwendung:
//   const mode = await askRollMode('Heimlichkeit');
//   if (!mode) return;            // abgebrochen
//   rollSkill('stealth', mode);   // 'normal' | 'adv' | 'dis'
// ============================================================
import { t } from '../core/i18n.js';

let overlay = null;
let cleanup = null;

export function askRollMode(label = '') {
  return new Promise(resolve => {
    // Eventuell offenen Dialog abbrechen (Doppelklicks etc.)
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
          <b>${esc(label) || t('dice.howToRoll')}</b>
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
      if (e.key === 'Enter')  done('normal'); // Enter = normaler Wurf
    };
    document.addEventListener('keydown', onKey);

    overlay.onclick = e => {
      if (e.target === overlay) return done(null); // Hintergrund = abbrechen
      const btn = e.target.closest('[data-rp]');
      if (!btn) return;
      done(btn.dataset.rp === 'cancel' ? null : btn.dataset.rp);
    };

    // Fokus auf "Normal" für schnelle Tastatur-Bedienung
    overlay.querySelector('[data-rp="normal"]')?.focus();
  });
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
