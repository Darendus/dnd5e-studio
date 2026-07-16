// ============================================================
// components/GeneratorPanel.js, complete character generator
// ------------------------------------------------------------
// Only visible for NEW characters (opened via "New", still
// unsaved); the shell hides the tab otherwise.
// Generates a complete character at a selectable level (1-20):
//  • abilities (4d6 / standard array / point buy) distributed
//    class-optimized + race bonuses
//  • saving throw proficiencies and skill selection of the class
//  • background incl. its skills
//  • subclass (from level 3), ability increases/feats
//    at the ASI levels (4/8/12/16/19)
//  • HP per the average rule, spells for spellcasting classes,
//    starting equipment with computed AC, currency, XP
//  • export as an official WotC PDF sheet
// ============================================================
import { store, blankCharacter } from '../core/Store.js';
import { repo }    from '../core/DataRepository.js';
import { bus, EV } from '../core/EventBus.js';
import { t }       from '../core/i18n.js';
import { calcMod, calcSpellSlots, ABILITY_IDS, fmtMod, calcAC, calcMaxHP } from '../rules/calculations.js';
import { roll }    from '../rules/dice.js';
import { exportToPdf } from '../utils/pdfExport.js';
import { combinedBonus } from '../rules/bonuses.js';
import { ALIGNMENTS, asiLevels, subclassEntryLevel } from '../rules/progression.js';
import { getHpMethod } from '../core/hpSettings.js';

const NAMES = ['Aelindra', 'Tharok', 'Miriel', 'Borgrim', 'Kaelen', 'Sylvara',
               'Dorn', 'Elowen', 'Grimjaw', 'Lyra', 'Fenwick', 'Zara'];
const XP_THRESHOLDS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000,
                       64000, 85000, 100000, 120000, 140000, 165000, 195000,
                       225000, 265000, 305000, 355000];

// 5e.tools skill names → app IDs (for background data)
const SKILL_MAP = { 'animal handling': 'animal', 'sleight of hand': 'sleight' };
const toSkillId = n => SKILL_MAP[n] ?? n;
const VALID_SKILLS = new Set(['acrobatics','animal','arcana','athletics','deception',
  'history','insight','intimidation','investigation','medicine','nature','perception',
  'performance','persuasion','religion','sleight','stealth','survival']);

// starting equipment per class (names from the PHB item pack)
const CLASS_GEAR = {
  Barbarian: { weapons: ['Greataxe', 'Handaxe'], armor: null },
  Bard:      { weapons: ['Rapier', 'Dagger'], armor: 'Leather Armor' },
  Cleric:    { weapons: ['Mace'], armor: 'Scale Mail', shield: true },
  Druid:     { weapons: ['Quarterstaff'], armor: 'Leather Armor' },
  Fighter:   { weapons: ['Longsword', 'Longbow'], armor: 'Chain Mail', shield: true },
  Monk:      { weapons: ['Quarterstaff'], armor: null },
  Paladin:   { weapons: ['Longsword'], armor: 'Chain Mail', shield: true },
  Ranger:    { weapons: ['Longbow', 'Shortsword'], armor: 'Leather Armor' },
  Rogue:     { weapons: ['Rapier', 'Dagger'], armor: 'Leather Armor' },
  Sorcerer:  { weapons: ['Quarterstaff', 'Dagger'], armor: null },
  Warlock:   { weapons: ['Quarterstaff', 'Dagger'], armor: 'Leather Armor' },
  Wizard:    { weapons: ['Quarterstaff', 'Dagger'], armor: null },
};
const BASE_GEAR = ['Backpack', 'Bedroll', 'Rations (1 day)', 'Waterskin', 'Hempen Rope (50 feet)'];

let preview = null;

export function mountGenerator() {
  render();
  bus.on(EV.LANG_CHANGED, render);
  bus.on(EV.SOURCES_CHANGED, render);
  bus.on(EV.CHAR_LOADED, () => { preview = null; render(); });
}

function render() {
  const el = document.getElementById('tab-generator');
  if (!el) return;
  const races   = repo.getRaces();
  const classes = repo.getClasses();
  const bgs     = repo.getBackgrounds();

  el.innerHTML = `
  <div class="panel">
    <div class="panel__title">${t('generator.title')}</div>
    <p class="panel__hint" style="margin-bottom:10px">${t('generator.onlyNewHint')}</p>
    <div style="display:grid;gap:10px;max-width:460px">
      <div class="meta-field">
        <label>${t('app.level')}</label>
        <select id="genLevel">
          ${Array.from({ length: 20 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}
        </select>
      </div>
      <div class="meta-field">
        <label>${t('generator.method')}</label>
        <select id="genMethod">
          <option value="4d6">${t('generator.roll4d6')}</option>
          <option value="standard">${t('generator.standard')}</option>
          <option value="pointbuy">${t('generator.pointBuy')}</option>
        </select>
      </div>
      <div class="meta-field">
        <label>Race</label>
        <select id="genRace"><option value="">Random</option>
          ${races.map(r => `<option>${r.name}</option>`).join('')}</select>
      </div>
      <div class="meta-field">
        <label>${t('tabs.classes')}</label>
        <select id="genClass"><option value="">Random</option>
          ${classes.map(c => `<option>${c.name}</option>`).join('')}</select>
      </div>
      <div class="meta-field">
        <label>Background</label>
        <select id="genBg"><option value="">Random</option>
          ${bgs.map(b => `<option>${b.name}</option>`).join('')}</select>
      </div>
      <button class="btn btn--primary" id="genGo">${t('generator.generate')}</button>
    </div>
  </div>
  <div id="genPreview"></div>`;

  el.querySelector('#genGo').onclick = () => {
    preview = generate({
      level:  +el.querySelector('#genLevel').value,
      method: el.querySelector('#genMethod').value,
      race:   el.querySelector('#genRace').value,
      cls:    el.querySelector('#genClass').value,
      bg:     el.querySelector('#genBg').value,
    });
    renderPreview();
  };
  renderPreview();
}

// == Generation =================================================

function generate({ level, method, race: raceName, cls: className, bg: bgName }) {
  const races   = repo.getRaces();
  const classes = repo.getClasses();
  // don't randomly pick placeholder backgrounds ("Custom Background" etc.)
  const bgs = repo.getBackgrounds();
  const randomBgs = bgs.filter(b => !/custom|variant/i.test(b.name));

  const race = raceName ? races.find(r => r.name === raceName) : pick(races);
  const cls  = className ? classes.find(c => c.name === className) : pick(classes);
  const bg   = bgName ? bgs.find(b => b.name === bgName) : pick(randomBgs);

  const char = blankCharacter();
  // adopt the ruleset of the CURRENT context, otherwise a character
  // generated under PHB24 would be saved as phb14 and flip the app's
  // ruleset when loaded.
  char.ruleset = repo.ruleset;
  const clsName = cls?.name ?? 'Fighter';

  // 1) raw scores + class-optimized distribution + race bonuses
  let scores;
  if (method === '4d6') {
    scores = Array.from({ length: 6 }, () =>
      roll(6, 4).sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0));
  } else if (method === 'standard') {
    scores = [15, 14, 13, 12, 10, 8];
  } else {
    scores = pointBuyRandom();
  }
  const priority = classPriority(clsName);
  scores.sort((a, b) => b - a);
  priority.forEach((attr, i) => { char[attr] = scores[i]; });

  // write bonuses into the bonus system (don't bake them into the base
  // values), so the origin stays traceable by color in the editor.
  char.raceBonus = { ...(race?.abilityBonuses ?? {}) };
  // automatically distribute freely selectable bonuses class-optimized
  char.raceChoice = autoPickChoice(race, priority);
  if (char.raceChoice) char.raceBonus = combinedBonus(race, char.raceChoice);
  char.bgChoice = autoPickChoice(bg, priority);
  char.bgBonus = char.bgChoice ? combinedBonus(bg, char.bgChoice) : { ...(bg?.abilityBonuses ?? {}) };

  // effective value (base + race/background bonuses) for follow-up calculations
  const effA = a => (char[a] ?? 10) + (char.raceBonus[a] ?? 0) + (char.bgBonus[a] ?? 0);

  // 2) ASI levels: ability increase OR feat
  const feats = [];
  const featLevels = [];
  const featPool = repo.getFeats().filter(f => !f.prerequisite);
  for (const asiLvl of asiLevels(clsName).filter(l => l <= level)) {
    if (Math.random() < 0.4 && featPool.length) {
      // take a feat (no duplicates, except repeatable ones)
      const f = pick(featPool.filter(f => f.repeatable || !feats.includes(f.name)));
      if (f) { feats.push(f.name); featLevels.push(asiLvl); continue; }
    }
    // +2 on the most important ability whose EFFECTIVE value
    // (base + race/background bonuses) is below 20, so no
    // rule-breaking values above the ability maximum occur.
    const bonusOf = a => (char.raceBonus[a] ?? 0) + (char.bgBonus[a] ?? 0);
    const target = priority.find(a => effA(a) < 20) ?? priority[0];
    char[target] = Math.min(char[target] + 2, 20 - bonusOf(target));
  }
  char.feats = feats;
  char.featLevels = featLevels;

  // 3) class, level, subclass, entry level per edition:
  //    2014: Cleric/Sorcerer/Warlock from 1, Druid/Wizard from 2, rest from 3.
  //    2024: all classes uniformly from level 3.
  const subLevel = subclassEntryLevel(clsName, char.ruleset);
  // subclasses edition-accurate (ruleset-deduplicated) via the repo
  const subPool = repo.getClass(clsName)?.subclasses ?? [];
  const subclass = level >= subLevel && subPool.length ? pick(subPool).name : null;
  char.classes = [{ name: clsName, level, subclass }];

  // 4) saving throws (from class data) + skills (class + background)
  char.saveProficiencies = (cls?.saves ?? priority.slice(0, 2)).filter(a => ABILITY_IDS.includes(a));

  const skills = new Set();
  (bg?.skills ?? []).map(toSkillId).filter(s => VALID_SKILLS.has(s)).forEach(s => skills.add(s));
  if (cls?.skillChoices) {
    const pool = cls.skillChoices.from.filter(s => VALID_SKILLS.has(s) && !skills.has(s));
    pickN(pool, cls.skillChoices.count).forEach(s => skills.add(s));
  }
  char.skillProficiencies = [...skills];

  // 5) HP: level 1 = maximum, then per the globally configured method
  // (average/max/roll); shares the same logic as the rest of the app,
  // so it also picks up feat HP bonuses (Tough, Boon of Fortitude, ...).
  char.maxHP = calcMaxHP(char, getHpMethod());
  char.currHP = char.maxHP;
  char.hitDiceLeft = level;

  // 6) spells for spellcasting classes (class list, up to the highest slot level)
  if (cls?.spellcasting) {
    const { slots, pact } = calcSpellSlots(char.classes);
    let maxLv = 0;
    slots.forEach((n, i) => { if (n > 0) maxLv = i + 1; });
    if (pact) maxLv = Math.max(maxLv, pact.level);
    const pool = repo.getSpellsForClasses([clsName]);
    const cantrips = pickN(pool.filter(sp => sp.level === 0), 3);
    const leveled  = pickN(pool.filter(sp => sp.level >= 1 && sp.level <= maxLv),
                           Math.min(12, 3 + Math.floor(level / 2)));
    char.spells = [...cantrips, ...leveled]
      .map(sp => ({ name: sp.name, level: sp.level, prepared: true }));
  }

  // 6b) automatically grant exclusive subclass spells (domains/oaths/patrons),
  //     just like in the editor, for both rulesets.
  if (subclass) {
    const auto = repo.subclassAutoSpells(clsName, subclass);
    if (auto) {
      char.spells = char.spells ?? [];
      const have = new Set(char.spells.map(sp => sp.name.toLowerCase()));
      for (const [lvl, names] of Object.entries(auto)) {
        if (+lvl > level) continue;
        for (const n of names) {
          const lib = repo.findSpellCI(n);
          if (lib && !have.has(lib.name.toLowerCase())) {
            have.add(lib.name.toLowerCase());
            char.spells.push({ name: lib.name, level: lib.level, prepared: true, fromSubclass: subclass });
          }
        }
      }
    }
  }

  // 7) equipment + AC + currency
  const gear = CLASS_GEAR[clsName] ?? { weapons: ['Dagger'], armor: 'Leather Armor' };
  const items = [];
  const addItem = (name, equipped) => {
    const lib = repo.findItem(name);
    if (lib) items.push({ name: lib.name, qty: 1, equipped, weight: lib.weight ?? 0, source: lib.source });
  };
  gear.weapons.forEach(w => addItem(w, true));
  if (gear.armor)  addItem(gear.armor, true);
  if (gear.shield) addItem('Shield', true);
  BASE_GEAR.forEach(n => addItem(n, false));
  char.items = items;
  char.ac = calcAC(char); // central AC logic from rules/calculations
  char.currency = { cp: 0, sp: 0, ep: 0,
    gp: (2 + level) * 10 + Math.floor(Math.random() * 41), pp: 0 };

  // 8) rest
  char.name  = pick(NAMES);
  char.race  = race?.name ?? '';
  char.background = bg?.name ?? '';
  char.alignment  = pick(ALIGNMENTS);
  char.speed = race?.speed ?? 30;
  char.xp    = XP_THRESHOLDS[level - 1] ?? 0;
  return char;
}


/** Automatically distribute freely selectable bonuses: first variant,
 *  abilities per class priority from the allowed list. */
function autoPickChoice(entry, priority) {
  const variants = entry?.abilityChoose;
  if (!variants?.length) return null;
  const variant = variants[0];
  const picks = [];
  for (const attr of priority) {
    if (picks.length >= variant.weights.length) break;
    if (variant.from.includes(attr) && !picks.includes(attr)) picks.push(attr);
  }
  // fill up in case the priority list didn't have enough allowed abilities
  for (const attr of variant.from) {
    if (picks.length >= variant.weights.length) break;
    if (!picks.includes(attr)) picks.push(attr);
  }
  return { variant: 0, picks };
}

function classPriority(name) {
  const P = {
    Barbarian: ['str','con','dex','wis','cha','int'],
    Bard:      ['cha','dex','con','wis','int','str'],
    Cleric:    ['wis','con','str','dex','cha','int'],
    Druid:     ['wis','con','dex','int','cha','str'],
    Fighter:   ['str','con','dex','wis','cha','int'],
    Monk:      ['dex','wis','con','str','cha','int'],
    Paladin:   ['str','cha','con','wis','dex','int'],
    Ranger:    ['dex','wis','con','str','int','cha'],
    Rogue:     ['dex','int','con','cha','wis','str'],
    Sorcerer:  ['cha','con','dex','int','wis','str'],
    Warlock:   ['cha','con','dex','wis','int','str'],
    Wizard:    ['int','con','dex','wis','cha','str'],
    Artificer: ['int','con','dex','wis','str','cha'],
  };
  return P[name] ?? ABILITY_IDS;
}

function pointBuyRandom() {
  const COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
  let scores, total;
  do {
    scores = Array.from({ length: 6 }, () => 8 + Math.floor(Math.random() * 8));
    total = scores.reduce((sum, s) => sum + COST[s], 0);
  } while (total !== 27);
  return scores;
}

const pick  = arr => arr[Math.floor(Math.random() * arr.length)] ?? null;
const pickN = (arr, n) => {
  const copy = [...arr], out = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  return out;
};

// == Preview ====================================================

function renderPreview() {
  const box = document.getElementById('genPreview');
  if (!box) return;
  if (!preview) { box.innerHTML = ''; return; }
  const p = preview;
  const c = p.classes[0];

  box.innerHTML = `
  <div class="panel">
    <div class="panel__title">${p.name}, ${p.race} ${c.name} ${c.level}</div>
    <p class="panel__hint" style="margin-bottom:10px">
      ${c.subclass ? `${c.subclass} · ` : ''}${p.background} · ${p.alignment ? t('align.' + p.alignment) : ''} · XP ${p.xp}
    </p>
    <div class="ability-grid" style="margin-bottom:12px">
      ${ABILITY_IDS.map(a => `
        <div class="ability-block">
          <label>${t('abilities.' + a).slice(0, 3).toUpperCase()}</label>
          ${(() => {
            const bonus = (p.raceBonus?.[a] ?? 0) + (p.bgBonus?.[a] ?? 0);
            const eff = p[a] + bonus;
            return `
          <div style="font-size:20px;font-weight:600;margin:4px 0">${eff}${bonus ? ` <span style="font-size:11px;color:var(--gold)" title="+${bonus} race/background">▲</span>` : ''}</div>
          <div class="ability-mod">${fmtMod(calcMod(eff))}</div>`;
          })()}
        </div>`).join('')}
    </div>
    <div class="stat-row" style="margin-bottom:12px">
      <div class="stat-box"><span class="stat-box__val">${p.maxHP}</span><span class="stat-box__lbl">HP</span></div>
      <div class="stat-box"><span class="stat-box__val">${p.ac}</span><span class="stat-box__lbl">AC</span></div>
      <div class="stat-box"><span class="stat-box__val">${p.speed}</span><span class="stat-box__lbl">${t('abilities.speed')}</span></div>
      <div class="stat-box"><span class="stat-box__val">${p.currency.gp}</span><span class="stat-box__lbl">GP</span></div>
    </div>
    <div class="gen-detail"><b>${t('generator.savesLabel')}:</b> ${p.saveProficiencies.map(a => a.toUpperCase()).join(', ')}</div>
    <div class="gen-detail"><b>${t('tabs.skills')}:</b> ${p.skillProficiencies.map(s => t('skills.' + s)).join(', ')}</div>
    ${p.feats.length ? `<div class="gen-detail"><b>${t('feats.title')}:</b> ${p.feats.join(', ')}</div>` : ''}
    ${(() => {
      // show the generated character's spell slots
      const { slots, pact } = calcSpellSlots(p.classes);
      const parts = slots.map((n, i) => n > 0 ? `${i + 1}. ${t('generator.gradeShort')}: ${n}` : '').filter(Boolean);
      if (pact) parts.push(`${t('generator.pactShort')}: ${pact.count}× ${pact.level}. ${t('generator.gradeShort')}`);
      return parts.length ? `<div class="gen-detail"><b>${t('spells.slots')}:</b> ${parts.join(' · ')}</div>` : '';
    })()}
    ${p.spells.length ? `<div class="gen-detail"><b>${t('tabs.spells')}:</b> ${p.spells.map(sp => sp.name).join(', ')}</div>` : ''}
    <div class="gen-detail"><b>${t('tabs.inventory')}:</b> ${p.items.map(it => it.name).join(', ')}</div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn btn--primary" id="genApply">✓ ${t('generator.apply')}</button>
      <button class="btn btn--gold" id="genPdf">${t('generator.exportPdf')}</button>
      <button class="btn" id="genAgain">${t('generator.generate')}</button>
    </div>
  </div>`;

  box.querySelector('#genApply').onclick = () => {
    store.replace(preview);
    bus.emit(EV.TOAST, { message: `✓ ${preview.name}` });
    preview = null;
    // once applied, the character is saved → the generator tab
    // disappears; the shell automatically switches to the core tab.
  };
  box.querySelector('#genPdf').onclick = async () => {
    try { await exportToPdf(preview); }
    catch (e) { bus.emit(EV.TOAST, { message: '✗ PDF: ' + e.message }); }
  };
  box.querySelector('#genAgain').onclick = () =>
    document.getElementById('genGo')?.click();
}
