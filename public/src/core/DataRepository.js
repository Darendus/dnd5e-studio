// ============================================================
// core/DataRepository.js, central data access
// ------------------------------------------------------------
// Loads in this order:
//   1. data/packs/*  (generated from 5e.tools by tools/update.js)
//   2. data/seed/*   (bundled SRD base data as fallback)
//   3. homebrew      (localStorage, source "HB")
// Provides source filtering: only enabled rulebooks appear.
// ============================================================
import { bus, EV } from './EventBus.js';

const HB_KEY  = 'dnd5e_homebrew';
const SRC_KEY = 'dnd5e_enabled_sources';

class DataRepository {
  classes = []; races = []; spells = []; items = []; books = [];
  backgrounds = []; feats = []; beasts = [];
  manifest = null;
  #enabledSources = null; // null = all enabled

  // == Initial load ===========================================
  async load() {
    // prefer packs (GitHub repo data), otherwise seed
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

  // == Update at the push of a button =========================
  // Calls the server endpoint that loads the data from the GitHub
  // repo. Progress lines are streamed through to onLine; afterwards
  // the repository is reloaded.
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
      buffer = lines.pop(); // keep the incomplete last line
      for (const line of lines) {
        if (line.startsWith('RESULT ')) {
          try { result = JSON.parse(line.slice(7)); } catch {}
        } else if (line.trim()) {
          onLine(line);
        }
      }
    }

    await this.load(); // read fresh packs → all panels re-render
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

  // == Source management ======================================
  allSources() {
    // all sources that actually occur in the data
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

  /** Filters arbitrary entries by enabled sources */
  bySource(arr) { return arr.filter(e => this.isSourceEnabled(e.source ?? 'HB')); }

  /** Dedupe by name, preferring HB, then the source family of the
   *  chosen ruleset version (2014: PHB/MM/DMG · 2024: XPHB/XMM/XDMG),
   *  then the other family. That way, with PHB14 disabled, the PHB24
   *  content appears instead of none at all, and wild shape forms come
   *  from the Monster Manual of the matching edition. */
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

  // ruleset version (2014/2024): controls source preference on duplicates
  get ruleset() {
    try { return localStorage.getItem('dnd5e_ruleset') || 'phb14'; } catch { return 'phb14'; }
  }
  setRuleset(v) {
    try { localStorage.setItem('dnd5e_ruleset', v); } catch {}
    bus.emit(EV.SOURCES_CHANGED);
  }

  // advanced mode: reveals sidekick classes and the like
  get advanced() {
    try { return localStorage.getItem('dnd5e_advanced') === '1'; } catch { return false; }
  }
  setAdvanced(on) {
    try { localStorage.setItem('dnd5e_advanced', on ? '1' : '0'); } catch {}
    bus.emit(EV.SOURCES_CHANGED);
  }

  // == Queries (source-filtered + name-deduplicated) ==========
  getClasses() {
    let list = this.dedupeByName(this.bySource(this.classes));
    if (!this.advanced) list = list.filter(c => !c.sidekick);
    return list;
  }
  getClass(name) {
    // Apply the source filter (like getClasses); fall back to the
    // unfiltered list so an already saved character can still resolve
    // its class even when the source is disabled.
    const cls = this.dedupeByName(this.bySource(this.classes)).find(c => c.name === name)
             ?? this.dedupeByName(this.classes).find(c => c.name === name)
             ?? this.classes.find(c => c.name === name);
    if (!cls) return null;
    // dedupe subclasses at runtime by ruleset
    // (pack contains PHB AND XPHB versions, e.g. "Oath of Devotion")
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

  /** Spells for specific classes (multiclassing: multiple names).
   *  classes may also be [{name, subclass}], in which case the
   *  EXCLUSIVE subclass spells (domains, patron lists, circles) are
   *  included in the selectable list even if they are not on the
   *  general class list.
   *  featNames entries may be plain strings (no restriction beyond the
   *  feat's own filters) or { name, choice: { class } } objects — when a
   *  feat offers several class lists to choose from (e.g. Magic Initiate)
   *  and a class has been chosen, filters are narrowed to that one class. */
  getSpellsForClasses(classes, featNames = []) {
    const names = new Set();
    const extraNames = new Set(); // lowercase names from subclasses/feats
    const featFilters = [];       // criteria from feats (level/school/class)
    for (const c of classes) {
      const clsName = typeof c === 'string' ? c : c.name;
      names.add(clsName);
      const subName = typeof c === 'object' ? c.subclass : null;
      if (subName) {
        const sub = this.getClass(clsName)?.subclasses?.find(sc => sc.name === subName);
        for (const n of sub?.spells?.extra ?? []) extraNames.add(n);
      }
    }
    // Feat-granted spells: concrete names + choice criteria
    // (e.g. Adept of the Black Robes: level 2 from enchantment/necromancy,
    // selectable even outside the own class list)
    for (const entry of featNames ?? []) {
      const fn = typeof entry === 'string' ? entry : entry.name;
      const chosenClass = (typeof entry === 'object' ? entry.choice?.class : null)?.toLowerCase();
      const f = this.findFeat(fn);
      for (const n of f?.spells?.names ?? []) extraNames.add(n);
      for (const fl of f?.spells?.filters ?? []) {
        // narrow a "pick one class list" feat to the class actually chosen
        if (chosenClass && fl.classNames?.length && !fl.classNames.includes(chosenClass)) continue;
        featFilters.push(fl);
      }
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

  /** Distinct class-list options a feat's spells can be drawn from
   *  (e.g. Magic Initiate: ['bard','cleric',...]). Empty if the feat
   *  has no class-restricted spell filters, meaning there is nothing
   *  to choose between (fixed named spells, or a school/level-only
   *  filter that isn't tied to picking one class). */
  featSpellClassOptions(featName) {
    const f = this.findFeat(featName);
    const names = new Set();
    for (const fl of f?.spells?.filters ?? []) {
      for (const cn of fl.classNames ?? []) names.add(cn);
    }
    return [...names];
  }

  /** Find a spell case-insensitively (subclass data is lowercase) */
  findSpellCI(name) {
    const lower = String(name).toLowerCase();
    return this.getSpells().find(sp => sp.name.toLowerCase() === lower)
        ?? this.spells.find(sp => sp.name.toLowerCase() === lower) ?? null;
  }

  /** Auto spells of a subclass: {classLevel: [names]} or null */
  subclassAutoSpells(className, subclassName) {
    const sub = this.getClass(className)?.subclasses?.find(sc => sc.name === subclassName);
    return sub?.spells?.auto ?? null;
  }

  // Name resolution: first the ruleset-deduplicated view (returns the
  // version of the active edition), then dedupe without source filter,
  // finally the raw list as fallback for disabled sources.
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

  /** ID of the active character (for character-bound homebrew).
   *  Read directly from the roster to avoid a circular import with
   *  the store. */
  #activeCharId() {
    try { return JSON.parse(localStorage.getItem('dnd5e_studio_roster') ?? '{}').activeId ?? null; }
    catch { return null; }
  }

  #mergeHomebrew() {
    try { this.#homebrew = { spells: [], items: [], classes: [], races: [], feats: [], ...JSON.parse(localStorage.getItem(HB_KEY) ?? '{}') }; }
    catch {}
    // Mark homebrew entries with source "HB" and merge them in.
    // Character-bound entries (charId) are only visible for that
    // character; legacy entries without charId remain global.
    const active = this.#activeCharId();
    for (const kind of ['spells', 'items', 'classes', 'races', 'feats']) {
      const entries = this.#homebrew[kind]
        .filter(e => !e.charId || e.charId === active)
        .map(e => ({ ...e, source: 'HB' }));
      // remove old HB entries, append new ones (idempotent on reload)
      this[kind] = this[kind].filter(e => e.source !== 'HB').concat(entries);
    }
  }

  addHomebrew(kind, entry) {
    if (!this.#homebrew[kind]) return false;
    // bind new entries to the active character
    this.#homebrew[kind].push({ ...entry, charId: this.#activeCharId() });
    localStorage.setItem(HB_KEY, JSON.stringify(this.#homebrew));
    this.#mergeHomebrew();
    bus.emit(EV.SOURCES_CHANGED);
    return true;
  }

  removeHomebrew(kind, name) {
    // Remove only the active character's entry (or global legacy
    // entries); other characters' homebrew remains untouched.
    const active = this.#activeCharId();
    this.#homebrew[kind] = (this.#homebrew[kind] ?? []).filter(e =>
      e.name !== name || (e.charId && e.charId !== active));
    localStorage.setItem(HB_KEY, JSON.stringify(this.#homebrew));
    this.#mergeHomebrew();
    bus.emit(EV.SOURCES_CHANGED);
  }

  /** Homebrew of the ACTIVE character (plus global legacy entries) */
  getHomebrew() {
    const active = this.#activeCharId();
    const out = {};
    for (const [kind, list] of Object.entries(this.#homebrew)) {
      out[kind] = list.filter(e => !e.charId || e.charId === active).map(e => structuredClone(e));
    }
    return out;
  }

  /** Rebuild the HB view on character switch */
  refreshHomebrew() { this.#mergeHomebrew(); }
}

export const repo = new DataRepository();

// on character switch, refresh the character-bound homebrew view
bus.on(EV.CHAR_LOADED, () => repo.refreshHomebrew());
