// ============================================================
// components/CharacterSelect.js, Charakterauswahl beim Start
// ------------------------------------------------------------
// Vollbild-Overlay, das VOR dem Charakterbogen erscheint:
//  • Karten aller gespeicherten Charaktere (Bild, Name, Klassen,
//    Stufe, letzte Änderung), Klick lädt den Charakter
//  • "Neu"-Knopf öffnet einen komplett leeren Bogen
//  • Löschen pro Karte (mit Rückfrage)
// Über die Kopfleiste ("Charaktere") jederzeit wieder aufrufbar.
// ============================================================
import { store }   from '../core/Store.js';
import { repo }    from '../core/DataRepository.js';
import { bus, EV } from '../core/EventBus.js';
import { t }       from '../core/i18n.js';

let overlay = null;

export function showCharacterSelect() {
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'charSelect';
    overlay.className = 'select-screen';
    document.body.appendChild(overlay);
  }
  render();
  overlay.style.display = 'flex';
}

function hide() { if (overlay) overlay.style.display = 'none'; }

/** Regelwerk-Abfrage vor dem Erstellen: PHB 2014 oder PHB 2024.
 *  Die Wahl bestimmt, welche Buchquelle bei Doppelungen bevorzugt wird
 *  und aktiviert/deaktiviert die jeweils passenden Quellenbücher. */
function showRulesetChooser() {
  const dlg = document.createElement('div');
  dlg.className = 'overlay';
  dlg.style.display = 'flex';
  dlg.style.zIndex = '10000';
  dlg.innerHTML = `
    <div class="modal" style="max-width:460px">
      <div class="modal__head"><b>${t('ruleset.title')}</b></div>
      <div class="modal__body">
        <p class="panel__hint" style="margin-bottom:16px">${t('ruleset.hint')}</p>
        <div style="display:grid;gap:12px">
          <button class="ruleset-option" data-rs="phb14">
            <b>${t('ruleset.phb14')}</b>
            <span>${t('ruleset.phb14Hint')}</span>
          </button>
          <button class="ruleset-option" data-rs="phb24">
            <b>${t('ruleset.phb24')}</b>
            <span>${t('ruleset.phb24Hint')}</span>
          </button>
        </div>
        <button class="btn btn--sm" id="rsCancel" style="margin-top:14px">${t('app.cancel')}</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);

  dlg.querySelectorAll('[data-rs]').forEach(b => {
    b.onclick = () => {
      const ruleset = b.dataset.rs;
      applyRulesetSources(ruleset);
      store.newCharacter(ruleset);
      dlg.remove();
      hide();
    };
  });
  dlg.querySelector('#rsCancel').onclick = () => dlg.remove();
  dlg.onclick = e => { if (e.target === dlg) dlg.remove(); };
}

/** Passende Quellenbücher für die Regelversion aktivieren/deaktivieren:
 *  phb14 → PHB an, XPHB aus; phb24 → XPHB an, PHB aus. Andere Bücher
 *  bleiben unberührt. */
function applyRulesetSources(ruleset) {
  if (ruleset === 'phb24') {
    repo.setSourceEnabled('XPHB', true);
    repo.setSourceEnabled('PHB', false);
  } else {
    repo.setSourceEnabled('PHB', true);
    repo.setSourceEnabled('XPHB', false);
  }
}

function render() {
  const chars = store.listCharacters();

  overlay.innerHTML = `
  <div class="select-inner">
    <h1 class="select-title">${t('select.title')}</h1>
    <p class="panel__hint" style="text-align:center;margin-bottom:1.5rem">${t('select.hint')}</p>

    <div class="select-grid">
      <!-- Neu: leerer Bogen -->
      <button class="select-card select-card--new" id="selNew">
        <span class="select-card__plus">+</span>
        <span class="select-card__name">${t('select.new')}</span>
        <span class="select-card__meta">${t('select.newHint')}</span>
      </button>

      ${chars.map(c => `
      <div class="select-card" data-sel-load="${c.id}" role="button" tabindex="0">
        <div class="select-card__portrait">
          ${c.portrait
            ? `<img src="${c.portrait}" alt="">`
            : `<span class="select-card__initial">${(c.name || '?').charAt(0).toUpperCase()}</span>`}
        </div>
        <span class="select-card__name">${esc(c.name) || '-'}</span>
        <span class="select-card__meta">${esc(c.classes)} · ${t('app.level')} ${c.level}</span>
        <span class="select-card__meta select-card__date">${c.updatedAt
          ? new Date(c.updatedAt).toLocaleDateString() : ''}</span>
        <button class="btn-icon select-card__delete" data-sel-del="${c.id}" title="${t('app.remove')}">×</button>
      </div>`).join('')}
    </div>

    <div style="text-align:center;margin-top:1.5rem">
      <button class="btn btn--sm" id="selClose">${t('select.continue')}</button>
    </div>
  </div>`;

  // == Events ==
  overlay.querySelector('#selNew').onclick = () => showRulesetChooser();
  overlay.querySelector('#selClose')?.addEventListener('click', hide);

  overlay.querySelectorAll('[data-sel-load]').forEach(card => {
    card.onclick = e => {
      if (e.target.closest('[data-sel-del]')) return; // Löschen nicht als Laden werten
      store.loadCharacter(card.dataset.selLoad);
      hide();
    };
  });

  overlay.querySelectorAll('[data-sel-del]').forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      if (confirm(t('select.confirmDelete'))) {
        store.deleteCharacter(b.dataset.selDel);
        render(); // Liste aktualisieren, Overlay bleibt offen
      }
    };
  });
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
