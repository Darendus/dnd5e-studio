// ============================================================
// app.js, Einstiegspunkt: Daten laden, Komponenten mounten
// ============================================================
import './core/theme.js'; // Erscheinungsbild sofort anwenden (vor dem ersten Rendern)
import { repo }            from './core/DataRepository.js';
import { bus, EV }         from './core/EventBus.js';
import { t }               from './core/i18n.js';

import { mountShell }      from './components/Shell.js';
import { mountHeader }     from './components/HeaderPanel.js';
import { mountCore }       from './components/CorePanel.js';
import { mountClasses }    from './components/ClassesPanel.js';
import { mountCombat }     from './components/CombatPanel.js';
import { mountWildshape }  from './components/WildshapePanel.js';
import { mountSkills }     from './components/SkillsPanel.js';
import { mountSpells }     from './components/SpellsPanel.js';
import { mountInventory }  from './components/InventoryPanel.js';
import { mountSections }   from './components/SectionsPanel.js';
import { mountDiceBot }    from './components/DiceBotPanel.js';
import { mountGenerator }  from './components/GeneratorPanel.js';
import { mountSettings }   from './components/SettingsPanel.js';
import { mountDescription } from './components/DescriptionPanel.js';
import { showCharacterSelect } from './components/CharacterSelect.js';

// == Toast-System (global, hört auf Bus) ======================
bus.on(EV.TOAST, ({ message }) => {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2400);
});

// == Start ====================================================
(async function boot() {
  await repo.load();          // Packs/Seed/Homebrew laden

  mountShell();               // Tabs + IO-Leiste
  mountHeader();              // Charakterkopf
  mountCore();                // Attribute & Rettungswürfe
  mountClasses();             // Multiclass-Editor
  mountCombat();              // HP / RK / Angriffe
  mountWildshape();           // Wildgestalt (nur bei Druiden sichtbar)
  mountSkills();              // Fertigkeiten
  mountSpells();              // Zauber + Bibliothek + Wirken
  mountInventory();           // Items + Bibliothek
  mountDescription();         // Charakterbild (DropZone) + Freitext-Blöcke
  mountSections();            // Freie Abschnitte
  mountDiceBot();             // Würfelbot
  mountGenerator();           // Charakter-Generator
  mountSettings();            // Sprache, Quellen, Update, Homebrew

  document.title = t('app.title');

  // Vor dem Bogen: Charakterauswahl anzeigen ('Neu' → leerer Bogen)
  showCharacterSelect();
})();
