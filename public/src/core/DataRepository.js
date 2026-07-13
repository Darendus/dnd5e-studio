// ============================================================
// core/DataRepository.js, Zentraler Datenzugriff
// ------------------------------------------------------------
// Lädt in dieser Reihenfolge:
//   1. data/packs/*  (von tools/update.js aus 5e.tools erzeugt)
//   2. data/seed/*   (mitgelieferte SRD-Basisdaten als Fallback)
//   3. Homebrew      (localStorage, Quelle "HB")
// Bietet Quellen-Filterung: Nur aktivierte Regelwerke erscheinen.
// ============================================================
import { bus, EV } from './EventBus.js';

const HB_KEY  = 'dnd5e_homebrew';
const SRC_KEY = 'dnd5e_enabled_sources';

class DataRepository {
  classes = []; races = []; spells = []; items = []; books = [];
  backgrounds = []; feats = []; beasts = [];
  manifest = null;
  #enabledSources = null; // null = alle aktiv

  // == Initial-Ladung =========================================
  async load() {
    // Packs (GitHub-Repo-Daten) bevorzugen, sonst Seed
    this.classes     = await this.#loadFirst(['data/packs/classes.json',     'data/seed/classes.json']);
    this.races       = await this.#loadFirst(['data/packs/races.json',       'data/seed/races.json']);
    this.spells      = await this.#loadFirst(['data/packs/spells.json',      'data/seed/spells.json']);
    this.items       = await this.#loadFirst(['data/packs/items.json',       'data/seed/items.json']);
    this.books       = await this.#loadFirst(['data/packs/books.json',       'data/seed/books.json']);
    this.backgrounds = await this.#loadFirst(['data/packs/backgrounds.json', 'data/seed/backgrounds.json']);
    this.feats       = await this.#loadFirst(['data/packs/feats.json',       'data/seed/feats.json']);
    this.beasts      = await this.#loadFirst(['data/packs/beasts.json',      'data/seed/beasts.json']);
    this.manifest    = await this.#tryFetch('data/manifest.json');

    this.#loadEnabledSources();
    this.#mergeHomebrew();
    bus.emit(EV.DATA_READY);
  }

  // == Update per Knopfdruck ==================================
  // Ruft den Server-Endpunkt auf, der die Daten aus dem GitHub-
  // Repo lädt. Fortschrittszeilen werden gestreamt an onLine
  // durchgereicht; danach wird das Repository neu geladen.
  async triggerUpdate(onLine = () => {}, force = false) {
    const res = await fetch('/api/update' + (force ? '?force=1' : ''));
    if (!res.ok) { onLine(await res.text()); return null; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', result = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // unvollständige letzte Zeile behalten
      for (const line of lines) {
        if (line.startsWith('RESULT ')) {
          try { result = JSON.parse(line.slice(7)); } catch {}
        } else if (line.trim()) {
          onLine(line);
        }
      }
    }

    await this.load(); // frische Packs einlesen → alle Panels rendern neu
    return result;
  }

  async #loadFirst(paths) {
    for (const p of paths) {
      const data = await this.#tryFetch(p);
      if (data) return data;
    }
    return [];
  }
  async #tryFetch(path) {
    try {
      const res = await fetch(path);
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  // == Quellen-Verwaltung =====================================
  allSources() {
    // Alle Quellen, die in den Daten tatsächlich vorkommen
    const found = new Set();
    [this.classes, this.races, this.spells, this.items, this.backgrounds, this.feats].forEach(arr =>
      arr.forEach(e => e.source && found.add(e.source)));
    found.add('HB');
    return [...found].sort().map(id => ({
      id,
      name: this.books.find(b => b.id === id)?.name ?? (id === 'HB' ? 'Homebrew' : id),
      enabled: this.isSourceEnabled(id),
    }));
  }

  isSourceEnabled(id) {
    return this.#enabledSources === null || this.#enabledSources.has(id);
  }

  setSourceEnabled(id, enabled) {
    if (this.#enabledSources === null) {
      this.#enabledSources = new Set(this.allSources().map(s => s.id));
    }
    enabled ? this.#enabledSources.add(id) : this.#enabledSources.delete(id);
    localStorage.setItem(SRC_KEY, JSON.stringify([...this.#enabledSources]));
    bus.emit(EV.SOURCES_CHANGED);
  }

  #loadEnabledSources() {
    try {
      const raw = localStorage.getItem(SRC_KEY);
      this.#enabledSources = raw ? new Set(JSON.parse(raw)) : null;
    } catch { this.#enabledSources = null; }
  }

  /** Filtert beliebige Einträge nach aktivierten Quellen */
  bySource(arr) { return arr.filter(e => this.isSourceEnabled(e.source ?? 'HB')); }

  /** Nach Namen deduplizieren, bevorzugt HB, dann die Quellen-Familie
   *  der gewählten Regelversion (2014: PHB/MM/DMG · 2024: XPHB/XMM/XDMG),
   *  dann die andere Familie. So erscheinen bei deaktiviertem PHB14 die
   *  PHB24-Inhalte statt gar keiner, und Wildgestalt-Formen kommen aus
   *  dem Monsterhandbuch der passenden Edition. */
  dedupeByName(arr) {
    const FAM14 = new Set(['PHB', 'MM', 'DMG']);
    const FAM24 = new Set(['XPHB', 'XMM', 'XDMG']);
    const prefer = this.ruleset === 'phb24' ? FAM24 : FAM14;
    const other  = this.ruleset === 'phb24' ? FAM14 : FAM24;
    const rank = src => src === 'HB' ? 4
                      : prefer.has(src) ? 3
                      : other.has(src) ? 2
                      : 1;
    const map = new Map();
    for (const e of arr) {
      const prev = map.get(e.name);
      if (!prev || rank(e.source) > rank(prev.source)) map.set(e.name, e);
    }
    return [...map.values()];
  }

  // Regelversion (2014/2024): steuert Quellen-Bevorzugung bei Doppelungen
  get ruleset() {
    try { return localStorage.getItem('dnd5e_ruleset') || 'phb14'; } catch { return 'phb14'; }
  }
  setRuleset(v) {
    try { localStorage.setItem('dnd5e_ruleset', v); } catch {}
    bus.emit(EV.SOURCES_CHANGED);
  }

  // Advanced-Modus: blendet Sidekick-Klassen u. Ä. ein
  get advanced() {
    try { return localStorage.getItem('dnd5e_advanced') === '1'; } catch { return false; }
  }
  setAdvanced(on) {
    try { localStorage.setItem('dnd5e_advanced', on ? '1' : '0'); } catch {}
    bus.emit(EV.SOURCES_CHANGED);
  }

  // == Abfragen (quellen-gefiltert + name-dedupliziert) =======
  getClasses() {
    let list = this.dedupeByName(this.bySource(this.classes));
    if (!this.advanced) list = list.filter(c => !c.sidekick);
    return list;
  }
  getClass(name) {
    // Quellen-Filter anwenden (wie getClasses); Fallback auf die
    // ungefilterte Liste, damit ein bereits gespeicherter Charakter
    // seine Klasse auch bei deaktivierter Quelle noch aufloesen kann.
    const cls = this.dedupeByName(this.bySource(this.classes)).find(c => c.name === name)
             ?? this.dedupeByName(this.classes).find(c => c.name === name)
             ?? this.classes.find(c => c.name === name);
    if (!cls) return null;
    // Unterklassen zur Laufzeit nach Regelwerk deduplizieren
    // (Pack enthält PHB- UND XPHB-Version, z. B. "Oath of Devotion")
    return { ...cls, subclasses: this.dedupeByName(cls.subclasses ?? []) };
  }
  getRaces()            { return this.dedupeByName(this.bySource(this.races)); }
  getItems()            { return this.bySource(this.items); }
  getSpells()           { return this.dedupeByName(this.bySource(this.spells)); }
  getBackgrounds()      { return this.dedupeByName(this.bySource(this.backgrounds)); }
  getFeats()            { return this.dedupeByName(this.bySource(this.feats)); }
  getBeasts()           { return this.dedupeByName(this.bySource(this.beasts)); }
  findBeast(name)       { return this.getBeasts().find(b => b.name === name)
                               ?? this.beasts.find(b => b.name === name) ?? null; }

  /** Zauber für bestimmte Klassen (Multiclassing: mehrere Namen).
   *  classes darf auch [{name, subclass}] sein, dann werden die
   *  EXKLUSIVEN Unterklassen-Zauber (Domänen, Patron-Listen, Zirkel)
   *  mit in die wählbare Liste aufgenommen, auch wenn sie nicht auf
   *  der allgemeinen Klassenliste stehen. */
  getSpellsForClasses(classes, featNames = []) {
    const names = new Set();
    const extraNames = new Set(); // lowercase-Namen aus Unterklassen/Feats
    const featFilters = [];       // Kriterien aus Feats (Grad/Schule/Klasse)
    for (const c of classes) {
      const clsName = typeof c === 'string' ? c : c.name;
      names.add(clsName);
      const subName = typeof c === 'object' ? c.subclass : null;
      if (subName) {
        const sub = this.getClass(clsName)?.subclasses?.find(sc => sc.name === subName);
        for (const n of sub?.spells?.extra ?? []) extraNames.add(n);
      }
    }
    // Feat-gewährte Zauber: konkrete Namen + Auswahl-Kriterien
    // (z. B. Adept of the Black Robes: Grad 2 aus Verzauberung/Nekromantie
    // , auch außerhalb der eigenen Klassenliste wählbar)
    for (const fn of featNames ?? []) {
      const f = this.findFeat(fn);
      for (const n of f?.spells?.names ?? []) extraNames.add(n);
      for (const fl of f?.spells?.filters ?? []) featFilters.push(fl);
    }
    const matchesFilter = sp => featFilters.some(fl =>
      (!fl.levels || fl.levels.includes(sp.level)) &&
      (!fl.schools || fl.schools.includes(sp.school)) &&
      (!fl.classNames || (sp.classes ?? []).some(cn => fl.classNames.includes(cn.toLowerCase()))));
    return this.getSpells().filter(sp =>
      sp.source === 'HB'
      || (sp.classes ?? []).some(cn => names.has(cn))
      || extraNames.has(sp.name.toLowerCase())
      || matchesFilter(sp));
  }

  /** Zauber case-insensitiv finden (Unterklassen-Daten sind kleingeschrieben) */
  findSpellCI(name) {
    const lower = String(name).toLowerCase();
    return this.getSpells().find(sp => sp.name.toLowerCase() === lower)
        ?? this.spells.find(sp => sp.name.toLowerCase() === lower) ?? null;
  }

  /** Auto-Zauber einer Unterklasse: {Klassenstufe: [Namen]} oder null */
  subclassAutoSpells(className, subclassName) {
    const sub = this.getClass(className)?.subclasses?.find(sc => sc.name === subclassName);
    return sub?.spells?.auto ?? null;
  }

  // Namensaufloesung: zuerst die regelwerk-deduplizierte Sicht (liefert
  // die Fassung der aktiven Edition), dann Dedupe ohne Quellen-Filter,
  // zuletzt die Rohliste als Fallback fuer deaktivierte Quellen.
  findSpell(name) { return this.getSpells().find(s => s.name === name)
                        ?? this.dedupeByName(this.spells).find(s => s.name === name)
                        ?? this.spells.find(s => s.name === name) ?? null; }
  findItem(name)  { return this.dedupeByName(this.getItems()).find(i => i.name === name)
                        ?? this.dedupeByName(this.items).find(i => i.name === name)
                        ?? this.items.find(i => i.name === name) ?? null; }
  findFeat(name)  { return this.getFeats().find(f => f.name === name)
                        ?? this.dedupeByName(this.feats).find(f => f.name === name)
                        ?? this.feats.find(f => f.name === name) ?? null; }

  // == Homebrew ===============================================
  #homebrew = { spells: [], items: [], classes: [], races: [], feats: [] };

  /** ID des aktiven Charakters (für Charakter-gebundenes Homebrew).
   *  Direkt aus dem Roster gelesen, um einen Zirkular-Import mit dem
   *  Store zu vermeiden. */
  #activeCharId() {
    try { return JSON.parse(localStorage.getItem('dnd5e_studio_roster') ?? '{}').activeId ?? null; }
    catch { return null; }
  }

  #mergeHomebrew() {
    try { this.#homebrew = { spells: [], items: [], classes: [], races: [], feats: [], ...JSON.parse(localStorage.getItem(HB_KEY) ?? '{}') }; }
    catch {}
    // Homebrew-Einträge mit Quelle "HB" markieren und einmischen.
    // Charakter-gebundene Einträge (charId) sind nur für den jeweiligen
    // Charakter sichtbar; Alt-Einträge ohne charId bleiben global.
    const active = this.#activeCharId();
    for (const kind of ['spells', 'items', 'classes', 'races', 'feats']) {
      const entries = this.#homebrew[kind]
        .filter(e => !e.charId || e.charId === active)
        .map(e => ({ ...e, source: 'HB' }));
      // Alte HB-Einträge entfernen, neue anhängen (idempotent bei Reload)
      this[kind] = this[kind].filter(e => e.source !== 'HB').concat(entries);
    }
  }

  addHomebrew(kind, entry) {
    if (!this.#homebrew[kind]) return false;
    // Neue Einträge an den aktiven Charakter binden
    this.#homebrew[kind].push({ ...entry, charId: this.#activeCharId() });
    localStorage.setItem(HB_KEY, JSON.stringify(this.#homebrew));
    this.#mergeHomebrew();
    bus.emit(EV.SOURCES_CHANGED);
    return true;
  }

  removeHomebrew(kind, name) {
    // Nur den Eintrag des aktiven Charakters (bzw. globale Alt-Einträge)
    // entfernen, Homebrew anderer Charaktere bleibt unangetastet.
    const active = this.#activeCharId();
    this.#homebrew[kind] = (this.#homebrew[kind] ?? []).filter(e =>
      e.name !== name || (e.charId && e.charId !== active));
    localStorage.setItem(HB_KEY, JSON.stringify(this.#homebrew));
    this.#mergeHomebrew();
    bus.emit(EV.SOURCES_CHANGED);
  }

  /** Homebrew des AKTIVEN Charakters (plus globale Alt-Einträge) */
  getHomebrew() {
    const active = this.#activeCharId();
    const out = {};
    for (const [kind, list] of Object.entries(this.#homebrew)) {
      out[kind] = list.filter(e => !e.charId || e.charId === active).map(e => structuredClone(e));
    }
    return out;
  }

  /** Beim Charakterwechsel die HB-Sicht neu aufbauen */
  refreshHomebrew() { this.#mergeHomebrew(); }
}

export const repo = new DataRepository();

// Beim Charakterwechsel die Charakter-gebundene Homebrew-Sicht nachziehen
bus.on(EV.CHAR_LOADED, () => repo.refreshHomebrew());
