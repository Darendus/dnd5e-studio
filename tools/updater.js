// ============================================================
// tools/updater.js, Modulare Update-Bibliothek
// ------------------------------------------------------------
// Datenquelle: GitHub-Repository (Raw-Zugriff)
//   https://github.com/5etools-mirror-3/5etools-src/tree/main/data
//
// Aufbau: DATA_TYPES ist ein Konfigurations-Array, jeder Eintrag
// beschreibt einen Datentyp (Quelle, Normalisierer, Zieldatei).
// Neue Inhalte (z. B. Monster) lassen sich durch einen weiteren
// Eintrag ergänzen, ohne Update-Logik anzufassen.
//
// Genutzt von:
//   • tools/update.js  (CLI:  npm run update)
//   • server.js        (HTTP: GET /api/update, Knopf in der App)
// ============================================================
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAW_BASE = 'https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data';
const OUT_DIR  = join(fileURLToPath(new URL('..', import.meta.url)), 'public', 'data');
const PACK_DIR = join(OUT_DIR, 'packs');

// == HTTP =====================================================
async function fetchJson(path) {
  const url = `${RAW_BASE}/${path}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'dnd5e-studio-updater' } });
  if (!res.ok) throw new Error(`${res.status}, ${path}`);
  return res.json();
}

// == Gemeinsame Normalisierungs-Helfer ========================

/** 5e.tools-Entry-Bäume in Klartext wandeln, Tags wie {@damage 2d6} entpacken */
function flattenEntries(entries, limit = 400) {
  if (!entries) return '';
  const walk = e => typeof e === 'string' ? e
    : Array.isArray(e) ? e.map(walk).join(' ')
    : e?.entries ? walk(e.entries)
    : e?.items ? walk(e.items) : '';
  return walk(entries)
    // Kampf-Tags mit fester Bedeutung zuerst auflösen
    .replace(/\{@atk mw,rw\}/g, 'Melee or Ranged Weapon Attack:')
    .replace(/\{@atk mw\}/g, 'Melee Weapon Attack:')
    .replace(/\{@atk rw\}/g, 'Ranged Weapon Attack:')
    .replace(/\{@atkr?\s*m,r\}/g, 'Melee or Ranged Attack Roll:')
    .replace(/\{@atkr m\}/g, 'Melee Attack Roll:')
    .replace(/\{@atkr r\}/g, 'Ranged Attack Roll:')
    .replace(/\{@hit (-?\d+)\}/g, '+$1')
    .replace(/\{@h\}/g, 'Hit: ')
    .replace(/\{@hom\}/g, 'Hit or Miss: ')
    .replace(/\{@dc (\d+)\}/g, 'DC $1')
    .replace(/\{@actSave (\w+)\}/g, (m, a) => a.toUpperCase() + ' Saving Throw:')
    .replace(/\{@actSaveFail\}/g, 'Failure:')
    .replace(/\{@actSaveSuccess\}/g, 'Success:')
    // Generisch: {@tag Inhalt|…} → Inhalt
    .replace(/\{@\w+ ([^}|]+)[^}]*\}/g, '$1')
    // Übrig gebliebene leere Tags entfernen
    .replace(/\{@\w+\}/g, '')
    .slice(0, limit);
}

const SAVE_MAP = { strength:'str', dexterity:'dex', constitution:'con',
                   intelligence:'int', wisdom:'wis', charisma:'cha' };

// == Normalisierer pro Datentyp ===============================

function normSpell(sp, ctx) {
  const raw = JSON.stringify(sp.entries ?? '');
  const save = raw.match(/(strength|dexterity|constitution|intelligence|wisdom|charisma) saving throw/i);
  const dmg  = raw.match(/\{@damage ([0-9]+d[0-9]+(?:\s*[+-]\s*[0-9]+)?)\}/);
  // Heilung: "regains … {@dice 1d8}" ODER "{@dice 1d8} … hit points" (beide Wortstellungen)
  const heal = raw.match(/regains?[^.]{0,80}?\{@dice ([0-9]+d[0-9]+)/i)?.[1]
            ?? raw.match(/\{@dice ([0-9]+d[0-9]+)[^}]*\}[^.]{0,40}hit points/i)?.[1]
            ?? null;

  // Klassen-Zuordnung: liegt im Repo nicht mehr am Zauber selbst,
  // sondern zentral in generated/gendata-spell-source-lookup.json
  // Struktur: lookup[quelle_klein][name_klein].class[klassenQuelle][KlassenName] = true
  let classes = (sp.classes?.fromClassList ?? []).map(c => c.name);
  const entry = ctx?.lookup?.[sp.source?.toLowerCase()]?.[sp.name?.toLowerCase()];
  if (entry?.class) {
    const set = new Set(classes);
    for (const bySource of Object.values(entry.class)) {
      Object.keys(bySource).forEach(name => set.add(name));
    }
    classes = [...set];
  }

  return {
    name: sp.name, source: sp.source, level: sp.level ?? 0, school: sp.school ?? '?',
    classes,
    castTime: sp.time?.[0] ? `${sp.time[0].number} ${sp.time[0].unit}` : '?',
    range: sp.range?.distance
      ? `${sp.range.distance.amount ?? ''} ${sp.range.distance.type}`.trim()
      : (sp.range?.type ?? '?'),
    components: [sp.components?.v && 'V', sp.components?.s && 'S', sp.components?.m && 'M']
      .filter(Boolean).join(','),
    duration: sp.duration?.[0]?.type ?? '?',
    attackRoll: /\{@hit\}|spell attack/i.test(raw),
    saveType: save ? SAVE_MAP[save[1].toLowerCase()] : null,
    damage: dmg ? dmg[1].replace(/\s/g, '') : null,
    damageType: sp.damageInflict?.[0] ?? null,
    healing: heal ?? null,
    description: flattenEntries(sp.entries, 4000),
  };
}

// "+1" / "-2" → Zahl (für flache Boni magischer Items)
function parseBonus(v) {
  if (v == null) return null;
  const n = parseInt(String(v).replace(/[^0-9+-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function normItem(it) {
  const rarity = it.rarity ?? 'none';
  // Attributs-Effekte: { static: { str: 29 } } → Wert wird GESETZT,
  //                    { con: 2 }             → Wert wird ADDIERT
  // Auswahl-Effekte ("choose"/"from") werden ignoriert (nicht automatisierbar).
  let ability = null;
  if (it.ability) {
    const stat = it.ability.static ?? null;
    const add  = {};
    for (const k of ['str','dex','con','int','wis','cha']) {
      if (typeof it.ability[k] === 'number') add[k] = it.ability[k];
    }
    if (stat || Object.keys(add).length) ability = { static: stat, add: Object.keys(add).length ? add : null };
  }
  return {
    name: it.name, source: it.source,
    // Typ/Eigenschaften: Quellen-Suffixe wie "M|XPHB" entfernen
    type: (it.type ?? '?').split('|')[0],
    property: (it.property ?? []).map(p => String(p.uid ?? p).split('|')[0]),
    rarity,
    magic: (rarity !== 'none' && rarity !== 'unknown') || !!it.wondrous || !!it.reqAttune,
    reqAttune: !!it.reqAttune,
    ability,
    // Flache Boni magischer Gegenstände (z. B. Cloak of Protection +1)
    bonusSave:   parseBonus(it.bonusSavingThrow),
    bonusAc:     parseBonus(it.bonusAc),
    bonusSpellDc: parseBonus(it.bonusSpellSaveDc),
    bonusSpellAtk: parseBonus(it.bonusSpellAttack),
    weight: it.weight ?? null, value: it.value ?? null,
    ac: it.ac ?? null, dmg1: it.dmg1 ?? null, dmgType: it.dmgType ?? null,
    description: flattenEntries(it.entries, 4000),
  };
}

// Ability-Auswahl ("choose") in einheitliche Varianten wandeln.
// Zwei Formate in den Rohdaten:
//  • klassisch: {choose:{from:[...], count:2, amount:1}} → eine Variante
//  • 2024er "weighted": [{choose:{weighted:{from:[...],weights:[2,1]}}},
//    {choose:{weighted:{from:[...],weights:[1,1,1]}}}] → mehrere Varianten
// Ergebnis: [{from:[...], weights:[2,1]}, ...], jede Variante ist eine
// Liste von Boni (weights), die der Nutzer auf Attribute aus "from" verteilt.
function parseAbilityChoose(abilityArr) {
  const variants = [];
  for (const entry of abilityArr ?? []) {
    const ch = entry?.choose;
    if (!ch) continue;
    if (ch.weighted?.from && ch.weighted?.weights) {
      variants.push({ from: ch.weighted.from, weights: ch.weighted.weights });
    } else if (ch.from) {
      const count = ch.count ?? 1, amount = ch.amount ?? 1;
      variants.push({ from: ch.from, weights: Array(count).fill(amount) });
    }
  }
  return variants.length ? variants : null;
}

function normRace(r) {
  // Ability-Boni: nur feste Zahlenwerte; "choose" separat halten
  const ab = r.ability?.[0] ?? {};
  const fixed = {};
  for (const k of ['str','dex','con','int','wis','cha']) {
    if (typeof ab[k] === 'number') fixed[k] = ab[k];
  }
  return {
    name: r.name, source: r.source,
    speed: typeof r.speed === 'number' ? r.speed : (r.speed?.walk ?? 30),
    abilityBonuses: fixed,
    abilityChoose: parseAbilityChoose(r.ability),
    size: r.size?.[0] ?? 'M',
    traits: (r.entries ?? []).filter(e => e?.name).map(e => e.name),
  };
}

// 5e.tools-Fertigkeitsnamen → App-IDs
const SKILL_ID_MAP = {
  'animal handling': 'animal', 'sleight of hand': 'sleight',
};
const toSkillId = n => SKILL_ID_MAP[n] ?? n;

// Unterklassen-Zauber (additionalSpells) normalisieren.
// Drei Formate in den Rohdaten:
//  • prepared/known: {Klassenstufe: [Namen]} → automatisch gelernt/vorbereitet
//  • expanded: {s<Zaubergrad>: [Namen]} → erweitert nur die wählbare Liste (Warlock)
//  • mehrere BENANNTE Varianten (z. B. Land-Zirkel: Arid/Polar/…) → der
//    Spieler wählt eine, daher KEINE Auto-Vergabe, aber alle wählbar.
// Ergebnis: { auto: {stufe:[namen]}|null, extra: [namen] }
function normAdditionalSpells(addl) {
  if (!Array.isArray(addl) || !addl.length) return null;
  const clean = n => String(n).split('|')[0].toLowerCase().trim();
  const extra = new Set();
  const collect = obj => {
    for (const list of Object.values(obj ?? {})) {
      for (const entry of Array.isArray(list) ? list : []) {
        if (typeof entry === 'string') extra.add(clean(entry));
      }
    }
  };
  for (const variant of addl) {
    collect(variant.prepared);
    collect(variant.known);
    collect(variant.expanded);
  }
  // Auto-Vergabe nur bei genau EINER unbenannten Variante (eindeutig)
  let auto = null;
  if (addl.length === 1 && !addl[0].name) {
    auto = {};
    for (const key of ['prepared', 'known']) {
      for (const [lvl, list] of Object.entries(addl[0][key] ?? {})) {
        if (!/^\d+$/.test(lvl)) continue; // nur Klassenstufen-Schlüssel
        const names = (Array.isArray(list) ? list : [])
          .filter(e => typeof e === 'string').map(clean);
        if (names.length) auto[lvl] = [...(auto[lvl] ?? []), ...names];
      }
    }
    if (!Object.keys(auto).length) auto = null;
  }
  return { auto, extra: [...extra] };
}

function normClass(c, subclasses) {
  // Fertigkeits-Auswahl der Klasse ("wähle 2 aus: …")
  const skillEntry = (c.startingProficiencies?.skills ?? []).find(s => s.choose);
  const skillChoices = skillEntry
    ? { count: skillEntry.choose.count ?? 2,
        from: (skillEntry.choose.from ?? []).map(toSkillId) }
    : null;
  const isSidekick = /sidekick/i.test(c.source ?? '') ||
    ['Expert', 'Warrior', 'Spellcaster'].includes(c.name);
  return {
    name: c.name, source: c.source,
    sidekick: isSidekick,
    hitDie: `d${c.hd?.faces ?? 8}`,
    saves: c.proficiency ?? [],   // Rettungswurf-Übungen, z. B. ['str','con']
    skillChoices,                 // { count, from } oder null
    spellcasting: !!c.spellcastingAbility,
    spellAbility: c.spellcastingAbility ?? null,
    casterProgression: c.casterProgression ?? null,
    subclassTitle: c.subclassTitle ?? 'Subclass',
    // Dedupe je (Name, Quelle): Unterklassen stehen je Klassen-Version
    // (PHB/XPHB) doppelt in der Datei; die Kopie MIT additionalSpells
    // wird bevorzugt. BEIDE Editionen bleiben im Pack, welche der
    // Nutzer sieht, entscheidet zur Laufzeit die Regelwerk-Dedupe.
    subclasses: (() => {
      const map = new Map();
      for (const sc of subclasses.filter(x => x.className === c.name)) {
        const key = sc.name + '|' + sc.source;
        const entry = { name: sc.name, source: sc.source, shortName: sc.shortName ?? sc.name,
                        spells: normAdditionalSpells(sc.additionalSpells) };
        const prev = map.get(key);
        if (!prev || (!prev.spells && entry.spells)) map.set(key, entry);
      }
      return [...map.values()];
    })(),
  };
}

function normBackground(b) {
  const ab = b.ability?.[0] ?? {};
  const fixed = {};
  for (const k of ['str','dex','con','int','wis','cha']) {
    if (typeof ab[k] === 'number') fixed[k] = ab[k];
  }
  return {
    name: b.name, source: b.source,
    skills: (b.skillProficiencies ?? []).flatMap(sp =>
      Object.keys(sp).filter(k => sp[k] === true)),
    abilityBonuses: fixed,
    abilityChoose: parseAbilityChoose(b.ability),
    feat: (b.feats ?? []).map(f => Object.keys(f)[0]?.split('|')[0]).filter(Boolean)[0] ?? null,
    description: flattenEntries(b.entries, 1500),
  };
}

// Mechanische Feat-Effekte aus dem Fließtext ableiten.
// Die Effekte stehen im Original nur als Text und unterscheiden sich
// zwischen PHB (2014) und XPHB (2024), z. B. Alert: +5 Initiative (2014)
// vs. Übungsbonus auf Initiative (2024). Wir erkennen die häufigsten.
function parseFeatEffects(f) {
  const text = flattenEntries(f.entries, 4000).toLowerCase();
  const fixed = {};   // { speed, initiative, carry, hpPerLevel }
  const flags = {};   // { initiativeProf }

  // Attributs-Boni (feste Zahlen, kein "choose")
  const ab = f.ability?.[0] ?? {};
  const abilityBonuses = {};
  for (const k of ['str','dex','con','int','wis','cha']) {
    if (typeof ab[k] === 'number') abilityBonuses[k] = ab[k];
  }

  // Geschwindigkeit: nur PERMANENTE Erhöhungen, "Your speed increases …"
  // muss einen Satz/Abschnitt BEGINNEN (nach ., : oder ;). Bedingte Boni
  // wie Charger/2024 ("When you take the Dash action, your Speed
  // increases … for that action") stehen nach einem Komma mitten im
  // Satz und werden bewusst ausgelassen.
  let m = text.match(/(?:^|[.:;]\s*)your speed increases by ([0-9]+)\s*fe?e?t/);
  if (m) fixed.speed = +m[1];

  // Initiative: fester Bonus (2014) ODER Übungsbonus (2024)
  m = text.match(/\+([0-9]+) bonus to initiative/);
  if (m) fixed.initiative = +m[1];
  // 2024er Alert: "when you roll initiative, you can add your proficiency (bonus) to the roll"
  if (/initiative[^.]*add your proficiency/.test(text)) flags.initiativeProf = true;

  // TP-Maximum, fester Wert: "Your Hit Points maximum increases by 40"
  // (Boon of Fortitude; Singular UND Plural abdecken)
  m = text.match(/hit points? maximum increases by ([0-9]+)\b/);
  if (m) fixed.hpFlat = +m[1];

  // TP-Maximum pro Stufe (Tough, beide Editionen)
  if (/hit points? maximum increases by an amount equal to twice your/.test(text)) {
    fixed.hpPerLevel = 2;
  }

  // Traglast (z. B. Powerful Build-artige Feats, selten)
  m = text.match(/carrying capacity[^.]*?(doubl|two times)/);
  if (m) fixed.carryFactor = 2;

  return { abilityBonuses, fixed, flags };
}

// Feat-gewährte Zauber (additionalSpells an Talenten) normalisieren.
// Zwei Arten von Einträgen:
//  • konkrete Namen ("fear") → direkt lernbar
//  • Auswahl-Ausdrücke ({choose: "level=2|school=E;N"}) → KRITERIEN,
//    nach denen der Spieler einen Zauber frei wählen darf, auch
//    außerhalb der eigenen Klassenliste (z. B. Adept of the Black
//    Robes: ein Grad-2-Zauber aus Verzauberung oder Nekromantie).
// Ergebnis: { names: [...], filters: [{levels, schools, classNames}] }
function parseFeatSpells(addl) {
  if (!Array.isArray(addl) || !addl.length) return null;
  const clean = n => String(n).split('|')[0].toLowerCase().trim();
  const names = new Set();
  const filters = [];
  const walk = v => {
    if (v == null) return;
    if (typeof v === 'string') { names.add(clean(v)); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') {
      if (typeof v.choose === 'string') {
        const f = parseChooseExpr(v.choose);
        if (f) filters.push(f);
        return;
      }
      Object.values(v).forEach(walk);
    }
  };
  // NUR Zauber-Schlüssel durchlaufen ("ability" enthält Attributsnamen!)
  for (const variant of addl) {
    for (const key of ['prepared', 'known', 'expanded', 'innate']) walk(variant[key]);
  }
  if (!names.size && !filters.length) return null;
  return { names: [...names], filters };
}

// "level=2|school=E;N|class=Wizard" → { levels:[2], schools:['E','N'], classNames:['wizard'] }
function parseChooseExpr(expr) {
  const out = {};
  for (const part of String(expr).split('|')) {
    const [k, v] = part.split('=');
    if (!v) continue;
    const vals = v.split(';').map(x => x.trim()).filter(Boolean);
    if (k === 'level')  out.levels = vals.map(Number).filter(Number.isFinite);
    if (k === 'school') out.schools = vals.map(x => x.toUpperCase());
    if (k === 'class')  out.classNames = vals.map(x => x.toLowerCase());
  }
  return (out.levels || out.schools || out.classNames) ? out : null;
}

function normFeat(f) {
  const eff = parseFeatEffects(f);
  return {
    name: f.name, source: f.source,
    repeatable: !!f.repeatable, // z. B. Attributsverbesserung (2024): mehrfach wählbar
    spells: parseFeatSpells(f.additionalSpells),
    prerequisite: f.prerequisite ? flattenEntries(f.prerequisite, 120) : null,
    abilityBonuses: eff.abilityBonuses,   // feste Attributs-Boni
    effects: eff.fixed,                    // { speed, initiative, hpPerLevel, carryFactor }
    flags: eff.flags,                      // { initiativeProf }
    description: flattenEntries(f.entries, 4000),
  };
}

// == Wildtiere (Beasts) für Druiden-Wildgestalt ===============
// Aus dem Bestiarium werden nur Kreaturen vom Typ "beast" mit
// vollständigem Statblock übernommen (keine _copy-Verweise).

// Die vier Elementare des Mond-Zirkels (Elemental Wild Shape, St. 10):
// Typ "elemental" statt "beast", gezielt mit aufnehmen.
const MOON_ELEMENTALS = new Set([
  'Air Elemental', 'Earth Elemental', 'Fire Elemental', 'Water Elemental',
]);

function creatureType(m) {
  return typeof m.type === 'object' ? m.type.type : m.type;
}

function isBeast(m) {
  const t = creatureType(m);
  const usable = m.cr != null && !m._copy && m.str != null;
  return usable && (t === 'beast' || (t === 'elemental' && MOON_ELEMENTALS.has(m.name)));
}

function normSpeed(sp) {
  if (typeof sp === 'number') return { walk: sp };
  const out = {};
  for (const k of ['walk', 'fly', 'swim', 'climb', 'burrow']) {
    const v = sp?.[k];
    if (v) out[k] = typeof v === 'object' ? v.number : v;
  }
  return out;
}

function normBeastAction(a) {
  const raw = JSON.stringify(a.entries ?? '');
  const hit = raw.match(/\{@hit (-?\d+)\}/);
  const dmg = raw.match(/\{@damage ([0-9]+d[0-9]+(?:\s*[+-]\s*[0-9]+)?)\}/);
  return {
    name: a.name,
    attackBonus: hit ? +hit[1] : null,
    damage: dmg ? dmg[1].replace(/\s/g, '') : null,
    text: flattenEntries(a.entries, 350),
  };
}

function normBeast(m) {
  const crRaw = typeof m.cr === 'object' ? m.cr.cr : m.cr;
  const acRaw = Array.isArray(m.ac)
    ? (typeof m.ac[0] === 'object' ? m.ac[0].ac : m.ac[0]) : m.ac;
  return {
    name: m.name, source: m.source,
    elemental: creatureType(m) === 'elemental', // Mond-Zirkel: Elemental Wild Shape
    size: (m.size ?? ['M'])[0],
    cr: String(crRaw ?? '0'),
    ac: acRaw ?? 10,
    hp: m.hp?.average ?? 1,
    hpFormula: m.hp?.formula ?? null,
    speed: normSpeed(m.speed),
    str: m.str, dex: m.dex, con: m.con, int: m.int, wis: m.wis, cha: m.cha,
    senses: (m.senses ?? []).join(', '),
    passive: m.passive ?? null,
    traits: (m.trait ?? []).map(t => ({ name: t.name, text: flattenEntries(t.entries, 300) })),
    actions: (Array.isArray(m.action) ? m.action : m.action ? [m.action] : []).map(normBeastAction),
  };
}

// == Modulare Datentyp-Konfiguration ==========================
// mode 'single'  → eine JSON-Datei, Schlüssel `key` enthält das Array
// mode 'indexed' → index.json verweist auf Teildateien pro Quelle
// mode 'multi'   → mehrere Einzeldateien zusammenführen
// mode 'class'   → Sonderfall: Klassen + Unterklassen je Datei

export const DATA_TYPES = [
  { id: 'books',       mode: 'single',  path: 'books.json',       key: 'book',
    norm: b => ({ id: b.id, name: b.name, group: b.group ?? 'other', published: b.published ?? null }) },
  { id: 'classes',     mode: 'class',   path: 'class/index.json' },
  { id: 'races',       mode: 'single',  path: 'races.json',       key: 'race',       norm: normRace },
  { id: 'spells',      mode: 'indexed', path: 'spells/index.json', dir: 'spells', key: 'spell', norm: normSpell,
    version: 4, // Cache-Version: bei Normalisierer-Änderungen erhöhen → alte Teil-Caches werden verworfen
    pre: async () => ({ lookup: await fetchJson('generated/gendata-spell-source-lookup.json') }) },
  { id: 'items',       mode: 'multi',   paths: ['items-base.json', 'items.json'],
    keys: ['baseitem', 'item'], norm: normItem },
  { id: 'backgrounds', mode: 'single',  path: 'backgrounds.json', key: 'background', norm: normBackground },
  { id: 'beasts',      mode: 'indexed', path: 'bestiary/index.json', dir: 'bestiary', key: 'monster',
    version: 3, filter: isBeast, norm: normBeast },
  { id: 'feats',       mode: 'single',  path: 'feats.json',       key: 'feat',       norm: normFeat },
];

// == Manifest =================================================
async function loadManifest() {
  try { return JSON.parse(await readFile(join(OUT_DIR, 'manifest.json'), 'utf8')); }
  catch { return { updatedAt: null, origin: RAW_BASE, sources: {}, files: {} }; }
}

// == Haupt-Update =============================================
/**
 * Führt das komplette Update aus.
 * @param {object} opts
 * @param {boolean}  [opts.force]  Alles neu laden, Cache ignorieren
 * @param {function} [opts.log]    Fortschritts-Callback (Zeile für Zeile)
 * @returns {Promise<{ok:boolean, newBooks:string[], counts:object, errors:string[]}>}
 */
export async function runUpdate({ force = false, log = () => {} } = {}) {
  await mkdir(PACK_DIR, { recursive: true });
  const manifest = await loadManifest();
  manifest.origin = RAW_BASE;
  const result = { ok: true, newBooks: [], counts: {}, errors: [] };

  for (const type of DATA_TYPES) {
    try {
      log(`→ ${type.id}…`);
      let entries = [];

      if (type.mode === 'single') {
        const data = await fetchJson(type.path);
        entries = (data[type.key] ?? []).map(type.norm);

        // Neue Regelwerke erkennen und melden (nur bei books)
        if (type.id === 'books') {
          const known = new Set(Object.keys(manifest.sources));
          for (const b of entries) {
            if (!known.has(b.id)) result.newBooks.push(`${b.id}, ${b.name}`);
            manifest.sources[b.id] = { name: b.name, group: b.group };
          }
          if (result.newBooks.length) log(`  ✨ ${result.newBooks.length} neue Regelwerke`);
        }

      } else if (type.mode === 'indexed') {
        // Optionale Zusatzdaten laden (z. B. Zauber↔Klassen-Lookup)
        const ctx = type.pre ? await type.pre() : null;
        const ver = type.version ? `@v${type.version}` : '';

        // index.json → Teildateien pro Quelle, mit versioniertem Datei-Cache
        const index = await fetchJson(type.path);
        for (const [src, file] of Object.entries(index)) {
          const cacheKey = `${type.dir}/${file}${ver}`;
          if (!force && manifest.files[cacheKey]) {
            const cached = await readCache(type.id + ver, src);
            if (cached) { entries.push(...cached); continue; }
          }
          try {
            const data = await fetchJson(`${type.dir}/${file}`);
            let list = data[type.key] ?? [];
            if (type.filter) list = list.filter(type.filter); // z. B. nur Beasts
            const norm = list.map(e => type.norm(e, ctx));
            entries.push(...norm);
            await writeCache(type.id + ver, src, norm);
            manifest.files[cacheKey] = { count: norm.length, at: new Date().toISOString() };
            if (norm.length) log(`  ${src}: ${norm.length}`);
          } catch (e) { log(`  ⚠ ${src} übersprungen (${e.message})`); }
        }

      } else if (type.mode === 'multi') {
        for (let i = 0; i < type.paths.length; i++) {
          const data = await fetchJson(type.paths[i]);
          entries.push(...(data[type.keys[i]] ?? []).map(type.norm));
        }

      } else if (type.mode === 'class') {
        const index = await fetchJson('class/index.json');
        // Dedupe je (Name, Quelle): BEIDE Editionen (PHB + XPHB) bleiben
        // im Pack, welche der Nutzer sieht, entscheidet zur Laufzeit
        // die Regelwerk-Dedupe (phb14 ↔ phb24).
        const seenClasses = new Set();
        for (const [name, file] of Object.entries(index)) {
          try {
            const data = await fetchJson(`class/${file}`);
            for (const c of data.class ?? []) {
              const key = c.name + '|' + c.source;
              if (seenClasses.has(key)) continue;
              seenClasses.add(key);
              entries.push(normClass(c, data.subclass ?? []));
            }
            log(`  ${name} ✓`);
          } catch (e) { log(`  ⚠ ${name} übersprungen (${e.message})`); }
        }
      }

      await writeFile(join(PACK_DIR, `${type.id}.json`), JSON.stringify(entries));
      manifest.files[`${type.id}.json`] = { count: entries.length, at: new Date().toISOString() };
      result.counts[type.id] = entries.length;
      log(`  ✓ ${entries.length} ${type.id}`);

    } catch (e) {
      result.ok = false;
      result.errors.push(`${type.id}: ${e.message}`);
      log(`  ✗ ${type.id} fehlgeschlagen: ${e.message}`);
    }
  }

  manifest.updatedAt = new Date().toISOString();
  await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  log(result.ok ? '✓ Update abgeschlossen.' : '⚠ Update mit Fehlern beendet.');
  return result;
}

// == Teil-Cache pro Quelle (spart erneute Downloads) =========
async function readCache(kind, src) {
  try { return JSON.parse(await readFile(join(PACK_DIR, `.${kind}-${src}.json`), 'utf8')); }
  catch { return null; }
}
async function writeCache(kind, src, data) {
  await writeFile(join(PACK_DIR, `.${kind}-${src}.json`), JSON.stringify(data));
}
