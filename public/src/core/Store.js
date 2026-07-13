// ============================================================
// core/Store.js, Charakter-Zustand (Single Source of Truth)
// ------------------------------------------------------------
// NEU: Mehrcharakter-Verwaltung ("Roster")
//  • Alle Charaktere liegen unter EINEM localStorage-Schlüssel:
//      { characters: { <id>: <charakter> }, activeId }
//  • Beim Start zeigt die App eine Auswahl (CharacterSelect);
//    "Neu" erzeugt einen komplett leeren Bogen.
//  • Ein frisch erzeugter, noch unberührter Charakter wird erst
//    beim ersten Ändern gespeichert, so entstehen keine leeren
//    Karteileichen in der Auswahl.
//
// Schema-Highlights:
//  • classes: Array für Multiclassing
//  • sections: frei hinzufügbare Bogen-Abschnitte
//  • portrait: Charakterbild als DataURL (per DropZone)
//  • descriptionBlocks: Freitext-Blöcke zur Charakterbeschreibung
// ============================================================
import { bus, EV } from './EventBus.js';
import { t } from './i18n.js';

/** Leerer / Standard-Charakter (immer mit frischer ID) */
export function blankCharacter() {
  return {
    schemaVersion: 3,
    id: 'char_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    updatedAt: null,
    // Identität
    name: '', race: '', background: '', alignment: '', playerName: '',
    xp: 0,
    // Multiclassing: mind. ein Eintrag
    classes: [{ name: 'Fighter', level: 1, subclass: null }],
    // Attribute
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    // Übungen
    saveProficiencies: [],
    skillProficiencies: [],
    skillExpertise: [],
    // Kampf
    // Regelwerk-Version: 'phb14' (2014) oder 'phb24' (2024).
    // Bestimmt, welche Buchquelle bei Doppelungen bevorzugt wird.
    ruleset: 'phb14',
    ac: 10, acManual: false, maxHP: 10, currHP: 10, tempHP: 0, speed: 30,
    hitDiceLeft: 1, deathSuccesses: 0, deathFailures: 0, inspiration: false,
    attacks: [],
    // Zauber
    spells: [],
    spellSlotsUsed: [0,0,0,0,0,0,0,0,0],
    pactSlotsUsed: 0,
    // Verbrauchte Mystische Arkana (Warlock; Liste der Grade, z. B. [6, 8])
    arcanumUsed: [],
    // Inventar
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    items: [],
    // Talente (Feats)
    feats: [],
    // Wildgestalt (Druide): aktive Form + eigener TP-Pool + Nutzungen
    wildshape: null,      // null | { form: 'Wolf', currHP: 11 }
    wildshapeUses: 2,     // 2 pro Rast (PHB)
    // Charakterbeschreibung: Bild + Freitext-Blöcke
    // Die drei Standard-Blöcke sind feste Kategorien (fixed: Titel
    // nicht editierbar); zusätzliche Blöcke kann der Nutzer frei anlegen.
    portrait: null, // DataURL (verkleinert), via DropZone
    descriptionBlocks: [
      { id: 'db_appearance',  key: 'appearance',  fixed: true, content: '' },
      { id: 'db_personality', key: 'personality', fixed: true, content: '' },
      { id: 'db_backstory',   key: 'backstory',   fixed: true, content: '' },
    ],
    // Freie Abschnitte (dynamisch erweiterbar), "Persönlichkeit"
    // liegt bereits unter Beschreibung, hier nur noch Merkmale.
    sections: [
      { id: 'features', title: 'Merkmale & Fähigkeiten', content: '' },
    ],
    // Attributs-Boni aus Rasse / Hintergrund / Talenten (additiv)
    raceBonus: {}, bgBonus: {}, featBonus: {},
    // Stufe, auf der das jeweilige Talent gewählt wurde (parallel zu feats;
    // relevant für stufenbezogene Talente und den Level-Up-Verlauf)
    featLevels: [],
    // Getroffene Wahl bei frei verteilbaren Boni: { variant, picks: [attr,…] }
    raceChoice: null, bgChoice: null,
    // Freitext für den PDF-Bogen (Seite 1 & 2)
    languages: '',           // Sprachen (→ Other Proficiencies & Languages)
    otherProficiencies: '',  // Rüstungen/Waffen/Werkzeuge
    allies: '',              // Verbündete & Organisationen (Seite 2)
    treasure: '',            // Schätze (Seite 2)
    // Physische Details (Seite 2 des WotC-Bogens)
    age: '', height: '', weight: '', eyes: '', skin: '', hair: '',
  };
}

const ROSTER_KEY     = 'dnd5e_studio_roster';
const LEGACY_KEY     = 'dnd5e_studio_character'; // altes Ein-Charakter-Format

class Store {
  #state = blankCharacter();
  #roster = { characters: {}, activeId: null };
  #undoStack = [];
  #dirty = false; // erst nach erster Änderung im Roster speichern

  constructor() { this.#loadRoster(); }

  // == Lesen ==
  get()      { return structuredClone(this.#state); }
  /** true, solange der Charakter frisch über "Neu" geöffnet und noch
   *  unverändert ist, nur dann ist der Generator verfügbar. */
  isNew()    { return !this.#dirty; }
  field(key) { return structuredClone(this.#state[key]); }
  activeId() { return this.#state.id; }

  /** Gesamtstufe = Summe aller Klassenstufen (Multiclassing) */
  totalLevel() {
    return this.#state.classes.reduce((sum, c) => sum + (+c.level || 0), 0) || 1;
  }

  // == Roster-API (Charakterauswahl) ==========================

  /** Metadaten aller gespeicherten Charaktere, neueste zuerst */
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

  /** Bestehenden Charakter aus dem Roster laden */
  loadCharacter(id) {
    const c = this.#roster.characters[id];
    if (!c) return false;
    this.#state = { ...blankCharacter(), ...structuredClone(c), id };
    this.#roster.activeId = id;
    this.#dirty = true; // existiert bereits im Roster
    this.#undoStack = [];
    this.#saveRoster();
    // Regelversion des geladenen Charakters global wiederherstellen
    try { localStorage.setItem('dnd5e_ruleset', this.#state.ruleset ?? 'phb14'); } catch {}
    bus.emit(EV.SOURCES_CHANGED);
    bus.emit(EV.CHAR_LOADED);
    bus.emit(EV.CHAR_CHANGED, { changed: ['*'] });
    return true;
  }

  /** Komplett leeren Bogen öffnen ("Neu"-Knopf) */
  newCharacter(ruleset = 'phb14') {
    this.#state = blankCharacter();
    this.#state.ruleset = ruleset;
    this.#roster.activeId = this.#state.id;
    this.#dirty = false; // erst bei erster Änderung speichern
    this.#undoStack = [];
    // Regelversion global hinterlegen (Repository liest sie beim Filtern);
    // Änderung meldet SOURCES_CHANGED, damit Bibliotheken neu laden.
    try { localStorage.setItem('dnd5e_ruleset', ruleset); } catch {}
    bus.emit(EV.SOURCES_CHANGED);
    bus.emit(EV.CHAR_LOADED);
    bus.emit(EV.CHAR_CHANGED, { changed: ['*'] });
  }

  /** Charakter aus dem Roster löschen */
  deleteCharacter(id) {
    delete this.#roster.characters[id];
    if (this.#state.id === id) {
      // aktiven Charakter gelöscht → frischer leerer Bogen
      this.#state = blankCharacter();
      this.#roster.activeId = this.#state.id;
      this.#dirty = false;
      bus.emit(EV.CHAR_CHANGED, { changed: ['*'] });
    }
    this.#saveRoster();
  }

  // == Schreiben ==
  update(patch) {
    this.#pushUndo();
    Object.assign(this.#state, structuredClone(patch));
    this.#persist();
    bus.emit(EV.CHAR_CHANGED, { changed: Object.keys(patch) });
  }

  /** Wie update, aber OHNE CHAR_CHANGED-Event (kein Re-Render).
   *  Für Eingabefelder, deren Fokus/Cursor erhalten bleiben soll;
   *  die abgeleiteten Anzeigen werden vom Aufrufer beim blur aktualisiert. */
  quietUpdate(patch) {
    Object.assign(this.#state, structuredClone(patch));
    this.#persist();
  }

  /** Maximale Wildgestalt-Nutzungen: 2014 immer 2; 2024 skaliert
   *  mit der Druidenstufe (2 ab St. 2, 3 ab St. 6, 4 ab St. 17). */
  wildshapeMax() {
    const s = this.#state;
    const lvl = (s.classes ?? [])
      .filter(c => /^druid$|^druide$/i.test(c.name ?? ''))
      .reduce((a, c) => a + (+c.level || 0), 0);
    if (s.ruleset === 'phb24') return lvl >= 17 ? 4 : lvl >= 6 ? 3 : 2;
    return 2;
  }

  /** Kurze Rast, regelwerk-abhängig:
   *  • Warlock-Pakt-Slots kommen in BEIDEN Editionen zurück.
   *  • Wildgestalt: 2014 frischt ALLE Nutzungen auf (PHB S. 66),
   *    2024 gibt EINE Nutzung zurück (XPHB "regain one expended use").
   *  Trefferwürfel werden nicht automatisch ausgegeben, das bleibt
   *  eine Spielerentscheidung über die Trefferwürfel-Anzeige. */
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

  /** Lange Rast: TP voll, Trefferwürfel bis zur Hälfte zurück,
   *  Zauberslots + Pakt-Slots + Wildgestalt-Nutzungen aufgefrischt,
   *  Todesrettungswürfe zurückgesetzt. */
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

  /** Klassen-Array gezielt ändern */
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

  /** Abschnitte verwalten */
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

  /** Beschreibungs-Blöcke verwalten (DescriptionPanel) */
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

  // == Persistenz: Roster in localStorage ==
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

    // Migration: altes Ein-Charakter-Format ins Roster übernehmen
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

    // Aktiven Charakter in den Zustand laden (falls vorhanden)
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
      if (!parsed.classes && parsed.class) { // Migration Schema v1
        parsed.classes = [{ name: parsed.class, level: parsed.level ?? 1, subclass: parsed.subclass ?? null }];
      }
      // Import legt IMMER einen neuen Datensatz an (frische ID),
      // damit ein bestehender Charakter nicht überschrieben wird.
      const fresh = blankCharacter();
      this.#pushUndo();
      this.#state = { ...fresh, ...parsed, id: fresh.id, updatedAt: null };
      this.#dirty = false;
      this.#persist(); // schreibt unter der neuen ID ins Roster
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

  /** Aktuellen Bogen auf leer zurücksetzen (behält die ID) */
  reset() {
    this.#pushUndo();
    const id = this.#state.id;
    this.#state = { ...blankCharacter(), id };
    this.#persist();
    bus.emit(EV.CHAR_CHANGED, { changed: ['*'] });
  }
}

export const store = new Store();
