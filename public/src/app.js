// ============================================================
// app.js, entry point: load data, mount components
// ============================================================
import './core/theme.js'; // apply appearance immediately (before the first render)
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

// == Toast system (global, listens on the bus) ================
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
  await repo.load();          // load packs/seed/homebrew

  mountShell();               // tabs + IO bar
  mountHeader();
  mountCore();                // abilities & saving throws
  mountClasses();              // multiclass editor
  mountCombat();               // HP / AC / attacks
  mountWildshape();            // wild shape (only visible for druids)
  mountSkills();
  mountSpells();                // spells + library + casting
  mountInventory();            // items + library
  mountDescription();          // character image (DropZone) + free-text blocks
  mountSections();
  mountDiceBot();
  mountGenerator();
  mountSettings();              // language, sources, update, homebrew

  document.title = t('app.title');

  // before the sheet: show character selection ('New' → blank sheet)
  showCharacterSelect();
})();
