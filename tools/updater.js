// ============================================================
// tools/updater.js, modular update library
// ------------------------------------------------------------
// Data source: GitHub repository (raw access)
//   https://github.com/5etools-mirror-3/5etools-src/tree/main/data
//
// Structure: DATA_TYPES is a configuration array, each entry
// describes one data type (source, normalizer, target file).
// New content (e.g. monsters) can be added via another entry
// without touching the update logic.
//
// Used by:
//   • tools/update.js  (CLI:  npm run update)
//   • server.js        (HTTP: GET /api/update, button in the app)
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

// == Shared normalization helpers =============================

/** Convert 5e.tools entry trees to plain text, unpack tags like {@damage 2d6} */
function flattenEntries(entries, limit = 400) {
  if (!entries) return '';
  const walk = e => typeof e === 'string' ? e
    : Array.isArray(e) ? e.map(walk).join(' ')
    : e?.entries ? walk(e.entries)
    : e?.items ? walk(e.items) : '';
  return walk(entries)
    // resolve combat tags with fixed meaning first
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
    // generic: {@tag content|…} → content
    .replace(/\{@\w+ ([^}|]+)[^}]*\}/g, '$1')
    // remove leftover empty tags
    .replace(/\{@\w+\}/g, '')
    .slice(0, limit);
}

const SAVE_MAP = { strength:'str', dexterity:'dex', constitution:'con',
                   intelligence:'int', wisdom:'wis', charisma:'cha' };

// == Normalizers per data type ================================

function normSpell(sp, ctx) {
  const raw = JSON.stringify(sp.entries ?? '');
  const save = raw.match(/(strength|dexterity|constitution|intelligence|wisdom|charisma) saving throw/i);
  const dmg  = raw.match(/\{@damage ([0-9]+d[0-9]+(?:\s*[+-]\s*[0-9]+)?)\}/);
  // Healing: "regains … {@dice 1d8}" OR "{@dice 1d8} … hit points" (both word orders)
  const heal = raw.match(/regains?[^.]{0,80}?\{@dice ([0-9]+d[0-9]+)/i)?.[1]
            ?? raw.match(/\{@dice ([0-9]+d[0-9]+)[^}]*\}[^.]{0,40}hit points/i)?.[1]
            ?? null;

  // Class mapping: no longer stored on the spell itself in the repo,
  // but centrally in generated/gendata-spell-source-lookup.json
  // Structure: lookup[source_lc][name_lc].class[classSource][ClassName] = true
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

// "+1" / "-2" → number (for flat bonuses of magic items)
function parseBonus(v) {
  if (v == null) return null;
  const n = parseInt(String(v).replace(/[^0-9+-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function normItem(it) {
  const rarity = it.rarity ?? 'none';
  // Ability effects: { static: { str: 29 } } → value is SET,
  //                   { con: 2 }             → value is ADDED
  // Choice effects ("choose"/"from") are ignored (not automatable).
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
    // type/properties: strip source suffixes like "M|XPHB"
    type: (it.type ?? '?').split('|')[0],
    property: (it.property ?? []).map(p => String(p.uid ?? p).split('|')[0]),
    rarity,
    magic: (rarity !== 'none' && rarity !== 'unknown') || !!it.wondrous || !!it.reqAttune,
    reqAttune: !!it.reqAttune,
    ability,
    // flat bonuses of magic items (e.g. Cloak of Protection +1)
    bonusSave:   parseBonus(it.bonusSavingThrow),
    bonusAc:     parseBonus(it.bonusAc),
    bonusSpellDc: parseBonus(it.bonusSpellSaveDc),
    bonusSpellAtk: parseBonus(it.bonusSpellAttack),
    weight: it.weight ?? null, value: it.value ?? null,
    ac: it.ac ?? null, dmg1: it.dmg1 ?? null, dmgType: it.dmgType ?? null,
    description: flattenEntries(it.entries, 4000),
  };
}

// Convert ability choices ("choose") into uniform variants.
// Two formats in the raw data:
//  • classic: {choose:{from:[...], count:2, amount:1}} → one variant
//  • 2024 "weighted": [{choose:{weighted:{from:[...],weights:[2,1]}}},
//    {choose:{weighted:{from:[...],weights:[1,1,1]}}}] → multiple variants
// Result: [{from:[...], weights:[2,1]}, ...], each variant is a list
// of bonuses (weights) the user distributes across abilities from "from".
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

// 5etools ships the 2014 PHB/SRD "Human" entry with NO "ability" field at
// all (it's marked reprintedAs "Human|XPHB" and left as a stub upstream),
// even though the 2014 rule text still grants +1 to all six scores. Fill
// that specific gap explicitly; every other 2014 race carries its bonus
// normally and needs no fallback.
const HUMAN_FALLBACK_SOURCES = new Set(['PHB', 'SRD']);
const HUMAN_ALL_SIX = { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 };

function normRace(r) {
  // ability bonuses: fixed numeric values only; keep "choose" separate
  const ab = r.ability?.[0] ?? {};
  const fixed = {};
  for (const k of ['str','dex','con','int','wis','cha']) {
    if (typeof ab[k] === 'number') fixed[k] = ab[k];
  }
  if (r.name === 'Human' && HUMAN_FALLBACK_SOURCES.has(r.source) && !r.ability?.length) {
    Object.assign(fixed, HUMAN_ALL_SIX);
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

// 5e.tools skill names → app IDs
const SKILL_ID_MAP = {
  'animal handling': 'animal', 'sleight of hand': 'sleight',
};
const toSkillId = n => SKILL_ID_MAP[n] ?? n;

// Normalize subclass spells (additionalSpells).
// Three formats in the raw data:
//  • prepared/known: {classLevel: [names]} → automatically learned/prepared
//  • expanded: {s<spellLevel>: [names]} → only extends the selectable list (Warlock)
//  • multiple NAMED variants (e.g. Circle of the Land: Arid/Polar/…) → the
//    player picks one, therefore NO auto-assignment, but all selectable.
// Result: { auto: {level:[names]}|null, extra: [names] }
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
  // auto-assignment only with exactly ONE unnamed variant (unambiguous)
  let auto = null;
  if (addl.length === 1 && !addl[0].name) {
    auto = {};
    for (const key of ['prepared', 'known']) {
      for (const [lvl, list] of Object.entries(addl[0][key] ?? {})) {
        if (!/^\d+$/.test(lvl)) continue; // class-level keys only
        const names = (Array.isArray(list) ? list : [])
          .filter(e => typeof e === 'string').map(clean);
        if (names.length) auto[lvl] = [...(auto[lvl] ?? []), ...names];
      }
    }
    if (!Object.keys(auto).length) auto = null;
  }
  return { auto, extra: [...extra] };
}

// == Class features and per-level progression tables ==========
// Combat abilities like Sneak Attack, Rage, Bardic Inspiration, etc.
// come from two places in the same per-class file already fetched
// for normClass():
//  • classFeature/subclassFeature: flat lists of ALL feature text,
//    one entry per (name, level), tagged with className and,
//    for subclasses, subclassShortName.
//  • class.classTableGroups: optional per-level numeric/dice columns
//    (e.g. Rogue's "Sneak Attack" column: 1d6 at level 1, up to 10d6
//    at level 20) — extracted so the app can show a live value
//    instead of only prose.

/** A single progression-table cell → a short display string. */
function tableCellToText(cell) {
  if (cell == null) return null;
  if (typeof cell === 'string' || typeof cell === 'number') return String(cell);
  if (cell.type === 'dice' && Array.isArray(cell.toRoll)) {
    return cell.toRoll.map(d => `${d.number}d${d.faces}`).join(' + ');
  }
  if (typeof cell.value === 'number') return (cell.value >= 0 ? '+' : '') + cell.value;
  return null;
}

/** { columnLabel: [level1..level20 display strings] } */
function normProgressionTable(classTableGroups) {
  const out = {};
  for (const g of classTableGroups ?? []) {
    const labels = g.colLabels ?? [];
    (g.rows ?? []).forEach((row, levelIdx) => {
      labels.forEach((label, colIdx) => {
        const val = tableCellToText(row?.[colIdx]);
        if (val == null) return;
        (out[label] ??= [])[levelIdx] = val;
      });
    });
  }
  return out;
}

/** Flatten one feature list (class or subclass) into {name, level, source, text} */
function normFeatureList(rawFeatures, match) {
  return (rawFeatures ?? [])
    .filter(match)
    .map(f => ({ name: f.name, level: f.level ?? 1, source: f.source, text: flattenEntries(f.entries, 1200) }))
    .filter(f => f.text)
    .sort((a, b) => a.level - b.level);
}

function normClass(c, subclasses, classFeatureRaw = [], subclassFeatureRaw = []) {
  // the class's skill choice ("choose 2 from: …")
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
    saves: c.proficiency ?? [],   // saving throw proficiencies, e.g. ['str','con']
    skillChoices,                 // { count, from } or null
    spellcasting: !!c.spellcastingAbility,
    spellAbility: c.spellcastingAbility ?? null,
    casterProgression: c.casterProgression ?? null,
    subclassTitle: c.subclassTitle ?? 'Subclass',
    // full class feature text, all levels (Sneak Attack, Rage, Extra
    // Attack, ...), plus any numeric/dice scaling table the class has
    features: normFeatureList(classFeatureRaw, f => f.className === c.name && f.classSource === c.source),
    progressionTable: normProgressionTable(c.classTableGroups),
    // Dedupe by (name, source): subclasses appear twice in the file,
    // once per class version (PHB/XPHB); the copy WITH additionalSpells
    // is preferred. BOTH editions stay in the pack; which one the user
    // sees is decided at runtime by the ruleset dedupe.
    subclasses: (() => {
      const map = new Map();
      for (const sc of subclasses.filter(x => x.className === c.name)) {
        const key = sc.name + '|' + sc.source;
        const entry = { name: sc.name, source: sc.source, shortName: sc.shortName ?? sc.name,
                        spells: normAdditionalSpells(sc.additionalSpells),
                        features: normFeatureList(subclassFeatureRaw, f =>
                          f.className === c.name && f.subclassShortName === (sc.shortName ?? sc.name)
                          && f.subclassSource === sc.source) };
        const prev = map.get(key);
        if (!prev || (!prev.spells && entry.spells) || (!prev.features?.length && entry.features.length)) map.set(key, entry);
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

// Derive mechanical feat effects from the prose text.
// The effects exist only as text in the original and differ between
// PHB (2014) and XPHB (2024), e.g. Alert: +5 initiative (2014)
// vs. proficiency bonus to initiative (2024). We detect the most common ones.
function parseFeatEffects(f) {
  const text = flattenEntries(f.entries, 4000).toLowerCase();
  const fixed = {};   // { speed, initiative, carry, hpPerLevel }
  const flags = {};   // { initiativeProf }

  // ability bonuses (fixed numbers, no "choose")
  const ab = f.ability?.[0] ?? {};
  const abilityBonuses = {};
  for (const k of ['str','dex','con','int','wis','cha']) {
    if (typeof ab[k] === 'number') abilityBonuses[k] = ab[k];
  }

  // Speed: only PERMANENT increases, "Your speed increases …" must
  // START a sentence/section (after ., : or ;). Conditional bonuses
  // like Charger/2024 ("When you take the Dash action, your Speed
  // increases … for that action") appear after a comma mid-sentence
  // and are deliberately skipped.
  let m = text.match(/(?:^|[.:;]\s*)your speed increases by ([0-9]+)\s*fe?e?t/);
  if (m) fixed.speed = +m[1];

  // initiative: fixed bonus (2014) OR proficiency bonus (2024)
  m = text.match(/\+([0-9]+) bonus to initiative/);
  if (m) fixed.initiative = +m[1];
  // 2024 Alert: "when you roll initiative, you can add your proficiency (bonus) to the roll"
  if (/initiative[^.]*add your proficiency/.test(text)) flags.initiativeProf = true;

  // HP maximum, fixed value: "Your Hit Points maximum increases by 40"
  // (Boon of Fortitude; cover singular AND plural)
  m = text.match(/hit points? maximum increases by ([0-9]+)\b/);
  if (m) fixed.hpFlat = +m[1];

  // HP maximum per level (Tough, both editions)
  if (/hit points? maximum increases by an amount equal to twice your/.test(text)) {
    fixed.hpPerLevel = 2;
  }

  // carrying capacity (e.g. Powerful Build-style feats, rare)
  m = text.match(/carrying capacity[^.]*?(doubl|two times)/);
  if (m) fixed.carryFactor = 2;

  return { abilityBonuses, fixed, flags };
}

// Normalize feat-granted spells (additionalSpells on feats).
// Two kinds of entries:
//  • concrete names ("fear") → directly learnable
//  • choice expressions ({choose: "level=2|school=E;N"}) → CRITERIA
//    by which the player may freely pick a spell, even outside
//    their own class list (e.g. Adept of the Black Robes: one
//    level-2 spell from enchantment or necromancy).
// Result: { names: [...], filters: [{levels, schools, classNames}] }
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
  // walk ONLY spell keys ("ability" contains ability names!)
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
    repeatable: !!f.repeatable, // e.g. Ability Score Improvement (2024): can be taken multiple times
    spells: parseFeatSpells(f.additionalSpells),
    prerequisite: f.prerequisite ? flattenEntries(f.prerequisite, 120) : null,
    abilityBonuses: eff.abilityBonuses,   // fixed ability bonuses
    effects: eff.fixed,                    // { speed, initiative, hpPerLevel, carryFactor }
    flags: eff.flags,                      // { initiativeProf }
    description: flattenEntries(f.entries, 4000),
  };
}

// == Beasts for druid wild shape ==============================
// From the bestiary only creatures of type "beast" with a
// complete stat block are taken (no _copy references).

// The four elementals of the Circle of the Moon (Elemental Wild Shape, lvl 10):
// type "elemental" instead of "beast", included explicitly.
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
    elemental: creatureType(m) === 'elemental', // Circle of the Moon: Elemental Wild Shape
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

// == Modular data type configuration ==========================
// mode 'single'  → one JSON file, key `key` holds the array
// mode 'indexed' → index.json points to partial files per source
// mode 'multi'   → merge several individual files
// mode 'class'   → special case: classes + subclasses per file

export const DATA_TYPES = [
  { id: 'books',       mode: 'single',  path: 'books.json',       key: 'book',
    norm: b => ({ id: b.id, name: b.name, group: b.group ?? 'other', published: b.published ?? null }) },
  { id: 'classes',     mode: 'class',   path: 'class/index.json' },
  { id: 'races',       mode: 'single',  path: 'races.json',       key: 'race',       norm: normRace },
  { id: 'spells',      mode: 'indexed', path: 'spells/index.json', dir: 'spells', key: 'spell', norm: normSpell,
    version: 4, // cache version: bump on normalizer changes → old partial caches are discarded
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

// == Main update ==============================================
/**
 * Runs the complete update.
 * @param {object} opts
 * @param {boolean}  [opts.force]  Reload everything, ignore cache
 * @param {function} [opts.log]    Progress callback (line by line)
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

        // detect and report new rulebooks (books only)
        if (type.id === 'books') {
          const known = new Set(Object.keys(manifest.sources));
          for (const b of entries) {
            if (!known.has(b.id)) result.newBooks.push(`${b.id}, ${b.name}`);
            manifest.sources[b.id] = { name: b.name, group: b.group };
          }
          if (result.newBooks.length) log(`  ✨ ${result.newBooks.length} neue Regelwerke`);
        }

      } else if (type.mode === 'indexed') {
        // load optional extra data (e.g. spell↔class lookup)
        const ctx = type.pre ? await type.pre() : null;
        const ver = type.version ? `@v${type.version}` : '';

        // index.json → partial files per source, with versioned file cache
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
            if (type.filter) list = list.filter(type.filter); // e.g. beasts only
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
        // Dedupe by (name, source): BOTH editions (PHB + XPHB) stay
        // in the pack; which one the user sees is decided at runtime
        // by the ruleset dedupe (phb14 ↔ phb24).
        const seenClasses = new Set();
        for (const [name, file] of Object.entries(index)) {
          try {
            const data = await fetchJson(`class/${file}`);
            for (const c of data.class ?? []) {
              const key = c.name + '|' + c.source;
              if (seenClasses.has(key)) continue;
              seenClasses.add(key);
              entries.push(normClass(c, data.subclass ?? [], data.classFeature ?? [], data.subclassFeature ?? []));
            }
            log(`  ${name} ✓`);
          } catch (e) { log(`  ⚠ ${name} skipped (${e.message})`); }
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

// == Partial cache per source (saves repeat downloads) ========
async function readCache(kind, src) {
  try { return JSON.parse(await readFile(join(PACK_DIR, `.${kind}-${src}.json`), 'utf8')); }
  catch { return null; }
}
async function writeCache(kind, src, data) {
  await writeFile(join(PACK_DIR, `.${kind}-${src}.json`), JSON.stringify(data));
}
