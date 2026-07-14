// ============================================================
// core/Store.js, character state (single source of truth)
// ------------------------------------------------------------
// NEW: multi-character management ("roster")
//  • All characters live under ONE localStorage key:
//      { characters: { <id>: <character> }, activeId }
//  • On startup the app shows a selection (CharacterSelect);
//    "New" creates a completely blank sheet.
//  • A freshly created, still untouched character is only saved
//    on its first change, so no empty orphan entries appear
//    in the selection.
//
// Schema highlights:
//  • classes: array for multiclassing
//  • sections: freely addable sheet sections
//  • portrait: character image as data URL (via DropZone)
//  • descriptionBlocks: free-text blocks for the character description
// ============================================================
import { bus, EV } from './EventBus.js';
import { t } from './i18n.js';

/** Blank / default character (always with a fresh ID) */
export function blankCharacter() {
  return {
    schemaVersion: 3,
    id: 'char_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    updatedAt: null,
    // identity
    name: '', race: '', background: '', alignment: '', playerName: '',
    xp: 0,
    // multiclassing: at least one entry
    classes: [{ name: 'Fighter', level: 1, subclass: null }],
    // abilities
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    // proficiencies
    saveProficiencies: [],
    skillProficiencies: [],
    skillExpertise: [],
    // combat
    // Ruleset version: 'phb14' (2014) or 'phb24' (2024).
    // Determines which book source is preferred on duplicates.
    ruleset: 'phb14',
    ac: 10, acManual: false, maxHP: 10, currHP: 10, tempHP: 0, speed: 30,
    hitDiceLeft: 1, deathSuccesses: 0, deathFailures: 0, inspiration: false,
    attacks: [],
    // spells
    spells: [],
    spellSlotsUsed: [0,0,0,0,0,0,0,0,0],
    pactSlotsUsed: 0,
    // spent Mystic Arcana (Warlock; list of levels, e.g. [6, 8])
    arcanumUsed: [],
    // inventory
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    items: [],
    // feats
    feats: [],
    // wild shape (druid): active form + own HP pool + uses
    wildshape: null,      // null | { form: 'Wolf', currHP: 11 }
    wildshapeUses: 2,     // 2 per rest (PHB)
    // Character description: image + free-text blocks.
    // The three default blocks are fixed categories (fixed: title
    // not editable); the user can freely add further blocks.
    portrait: null, // data URL (downscaled), via DropZone
    descriptionBlocks: [
      { id: 'db_appearance',  key: 'appearance',  fixed: true, content: '' },
      { id: 'db_personality', key: 'personality', fixed: true, content: '' },
      { id: 'db_backstory',   key: 'backstory',   fixed: true, content: '' },
    ],
    // Free sections (dynamically extendable); "personality" already
    // lives under description, only features remain here.
    sections: [
      { id: 'features', title: 'Merkmale & Fähigkeiten', content: '' },
    ],
    // ability bonuses from race / background / feats (additive)
    raceBonus: {}, bgBonus: {}, featBonus: {},
    // level at which each feat was chosen (parallel to feats;
    // relevant for level-based feats and the level-up history)
    featLevels: [],
    // chosen spell-list class for feats that grant spells from one of
    // several lists (e.g. Magic Initiate), parallel to feats; entries
    // are { class: 'wizard' } or null for feats with no such choice
    featChoices: [],
    // chosen distribution of freely assignable bonuses: { variant, picks: [attr,…] }
    raceChoice: null, bgChoice: null,
    // free text for the PDF sheet (pages 1 & 2)
    languages: '',           // languages (→ Other Proficiencies & Languages)
    otherProficiencies: '',  // armor/weapons/tools
    allies: '',              // Allies & Organizations (page 2)
    treasure: '',            // Treasure (page 2)
    // physical details (page 2 of the WotC sheet)
    age: '', height: '', weight: '', eyes: '', skin: '', hair: '',
  };
}

const ROSTER_KEY     = 'dnd5e_studio_roster';
const LEGACY_KEY     = 'dnd5e_studio_character'; // old single-character format

class Store {
  #state = blankCharacter();
  #roster = { characters: {}, activeId: null };
  #undoStack = [];
  #dirty = false; // only save to the roster after the first change

  constructor() { this.#loadRoster(); }

  // == Reading ==
  get()      { return structuredClone(this.#state); }
  /** true as long as the character was freshly opened via "New" and is
   *  still unchanged; only then is the generator available. */
  isNew()    { return !this.#dirty; }
  field(key) { return structuredClone(this.#state[key]); }
  activeId() { return this.#state.id; }

  /** Total level = sum of all class levels (multiclassing) */
  totalLevel() {
    return this.#state.classes.reduce((sum, c) => sum + (+c.level || 0), 0) || 1;
  }

  // == Roster API (character selection) =======================

  /** Metadata of all saved characters, newest first */
  listCharacters() {
    return Object.values(this.#roster.characters)
      .map(c => ({
        id: c.id, name: c.name || '-',
        classes: (c.classes ?? []).map(k => `${k.name} ${k.level}`).join(' / '),
        level: (c.classes ?? []).reduce((s, k) => s + (+k.level || 0), 0),
        portrait: c.portrait ?? null,
        updatedAt: c.updatedAt ?? null,
      }))
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }

  /** Load an existing character from the roster */
  loadCharacter(id) {
    const c = this.#roster.characters[id];
    if (!c) return false;
    this.#state = { ...blankCharacter(), ...structuredClone(c), id };
    this.#roster.activeId = id;
    this.#dirty = true; // already exists in the roster
    this.#undoStack = [];
    this.#saveRoster();
    // restore the loaded character's ruleset version globally
    try { localStorage.setItem('dnd5e_ruleset', this.#state.ruleset ?? 'phb14'); } catch {}
    bus.emit(EV.SOURCES_CHANGED);
    bus.emit(EV.CHAR_LOADED);
    bus.emit(EV.CHAR_CHANGED, { changed: ['*'] });
    return true;
  }

  /** Open a completely blank sheet ("New" button) */
  newCharacter(ruleset = 'phb14') {
    this.#state = blankCharacter();
    this.#state.ruleset = ruleset;
    this.#roster.activeId = this.#state.id;
    this.#dirty = false; // only save on the first change
    this.#undoStack = [];
    // Store the ruleset version globally (the repository reads it when
    // filtering); the change emits SOURCES_CHANGED so libraries reload.
    try { localStorage.setItem('dnd5e_ruleset', ruleset); } catch {}
    bus.emit(EV.SOURCES_CHANGED);
    bus.emit(EV.CHAR_LOADED);
    bus.emit(EV.CHAR_CHANGED, { changed: ['*'] });
  }

  /** Delete a character from the roster */
  deleteCharacter(id) {
    delete this.#roster.characters[id];
    if (this.#state.id === id) {
      // active character deleted → fresh blank sheet
      this.#state = blankCharacter();
      this.#roster.activeId = this.#state.id;
      this.#dirty = false;
      bus.emit(EV.CHAR_CHANGED, { changed: ['*'] });
    }
    this.#saveRoster();
  }

  // == Writing ==
  update(patch) {
    this.#pushUndo();
    Object.assign(this.#state, structuredClone(patch));
    this.#persist();
    bus.emit(EV.CHAR_CHANGED, { changed: Object.keys(patch) });
  }

  /** Like update, but WITHOUT the CHAR_CHANGED event (no re-render).
   *  For input fields whose focus/cursor should be preserved;
   *  the derived displays are updated by the caller on blur. */
  quietUpdate(patch) {
    Object.assign(this.#state, structuredClone(patch));
    this.#persist();
  }

  /** Maximum wild shape uses: 2014 always 2; 2024 scales with
   *  the druid level (2 from lvl 2, 3 from lvl 6, 4 from lvl 17). */
  wildshapeMax() {
    const s = this.#state;
    const lvl = (s.classes ?? [])
      .filter(c => /^druid$|^druide$/i.test(c.name ?? ''))
      .reduce((a, c) => a + (+c.level || 0), 0);
    if (s.ruleset === 'phb24') return lvl >= 17 ? 4 : lvl >= 6 ? 3 : 2;
    return 2;
  }

  /** Short rest, ruleset-dependent:
   *  • Warlock pact slots come back in BOTH editions.
   *  • Wild shape: 2014 refreshes ALL uses (PHB p. 66),
   *    2024 returns ONE use (XPHB "regain one expended use").
   *  Hit dice are not spent automatically; that remains a player
   *  decision via the hit dice display. */
  shortRest() {
    const s = this.#state;
    const patch = { pactSlotsUsed: 0 };
    const druidLvl = (s.classes ?? [])
      .filter(c => /^druid$|^druide$/i.test(c.name ?? ''))
      .reduce((a, c) => a + (+c.level || 0), 0);
    if (druidLvl >= 2) {
      const max = this.wildshapeMax();
      patch.wildshapeUses = s.ruleset === 'phb24'
        ? Math.min(max, (s.wildshapeUses ?? 0) + 1)
        : max;
    }
    this.update(patch);
  }

  /** Long rest: full HP, hit dice back up to half,
   *  spell slots + pact slots + wild shape uses refreshed,
   *  death saving throws reset. */
  longRest() {
    const s = this.#state;
    const total = (s.classes ?? []).reduce((a, c) => a + (+c.level || 0), 0) || 1;
    this.update({
      currHP: s.maxHP,
      tempHP: 0,
      hitDiceLeft: Math.min(total, (s.hitDiceLeft ?? 0) + Math.max(1, Math.floor(total / 2))),
      spellSlotsUsed: Array(9).fill(0),
      pactSlotsUsed: 0,
      arcanumUsed: [],
      wildshapeUses: this.wildshapeMax(),
      deathSuccesses: 0,
      deathFailures: 0,
    });
  }

  /** Modify the classes array in a targeted way */
  updateClass(index, patch) {
    const classes = this.field('classes');
    if (!classes[index]) return;
    Object.assign(classes[index], patch);
    this.update({ classes });
  }
  addClass(name = 'Fighter') {
    const classes = this.field('classes');
    classes.push({ name, level: 1, subclass: null });
    this.update({ classes });
  }
  removeClass(index) {
    const classes = this.field('classes');
    if (classes.length <= 1) return;
    classes.splice(index, 1);
    this.update({ classes });
  }

  /** Manage sections */
  addSection(title) {
    const sections = this.field('sections');
    sections.push({ id: 'sec_' + Date.now(), title, content: '' });
    this.update({ sections });
  }
  updateSection(id, patch) {
    const sections = this.field('sections').map(s => s.id === id ? { ...s, ...patch } : s);
    this.update({ sections });
  }
  removeSection(id) {
    this.update({ sections: this.field('sections').filter(s => s.id !== id) });
  }

  /** Manage description blocks (DescriptionPanel) */
  addDescriptionBlock(title) {
    const blocks = this.field('descriptionBlocks') ?? [];
    blocks.push({ id: 'db_' + Date.now(), title, content: '' });
    this.update({ descriptionBlocks: blocks });
  }
  updateDescriptionBlock(id, patch) {
    const blocks = (this.field('descriptionBlocks') ?? [])
      .map(b => b.id === id ? { ...b, ...patch } : b);
    this.update({ descriptionBlocks: blocks });
  }
  removeDescriptionBlock(id) {
    this.update({ descriptionBlocks: (this.field('descriptionBlocks') ?? []).filter(b => b.id !== id) });
  }

  // == Undo ==
  undo() {
    const prev = this.#undoStack.pop();
    if (!prev) return;
    this.#state = prev;
    this.#persist();
    bus.emit(EV.CHAR_CHANGED, { changed: ['*'] });
  }
  #pushUndo() {
    this.#undoStack.push(structuredClone(this.#state));
    if (this.#undoStack.length > 30) this.#undoStack.shift();
  }

  // == Persistence: roster in localStorage ==
  #persist() {
    this.#dirty = true;
    this.#state.updatedAt = new Date().toISOString();
    this.#roster.characters[this.#state.id] = structuredClone(this.#state);
    this.#roster.activeId = this.#state.id;
    this.#saveRoster();
  }
  #saveRoster() {
    try { localStorage.setItem(ROSTER_KEY, JSON.stringify(this.#roster)); } catch {}
  }
  #loadRoster() {
    try {
      const raw = localStorage.getItem(ROSTER_KEY);
      if (raw) this.#roster = JSON.parse(raw);
    } catch {}

    // migration: carry the old single-character format into the roster
    try {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy && Object.keys(this.#roster.characters).length === 0) {
        const c = { ...blankCharacter(), ...JSON.parse(legacy) };
        this.#roster.characters[c.id] = c;
        this.#roster.activeId = c.id;
        localStorage.removeItem(LEGACY_KEY);
        this.#saveRoster();
      }
    } catch {}

    // load the active character into the state (if present)
    const active = this.#roster.characters[this.#roster.activeId];
    if (active) {
      this.#state = { ...blankCharacter(), ...structuredClone(active) };
      this.#dirty = true;
    }
  }

  // == Import / Export ==
  exportJson() { return JSON.stringify(this.#state, null, 2); }

  importJson(json) {
    try {
      const parsed = JSON.parse(json);
      if (!parsed.classes && parsed.class) { // migration schema v1
        parsed.classes = [{ name: parsed.class, level: parsed.level ?? 1, subclass: parsed.subclass ?? null }];
      }
      // Import ALWAYS creates a new record (fresh ID) so an
      // existing character is not overwritten.
      const fresh = blankCharacter();
      this.#pushUndo();
      this.#state = { ...fresh, ...parsed, id: fresh.id, updatedAt: null };
      this.#dirty = false;
      this.#persist(); // writes to the roster under the new ID
      bus.emit(EV.CHAR_LOADED);
      bus.emit(EV.CHAR_CHANGED, { changed: ['*'] });
      return true;
    } catch { return false; }
  }

  replace(character) {
    this.#pushUndo();
    this.#state = { ...blankCharacter(), ...structuredClone(character) };
    this.#persist();
    bus.emit(EV.CHAR_CHANGED, { changed: ['*'] });
  }

  /** Reset the current sheet to blank (keeps the ID) */
  reset() {
    this.#pushUndo();
    const id = this.#state.id;
    this.#state = { ...blankCharacter(), id };
    this.#persist();
    bus.emit(EV.CHAR_CHANGED, { changed: ['*'] });
  }
}

export const store = new Store();
