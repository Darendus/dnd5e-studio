// ============================================================
// components/GeneratorPanel.js, Vollständiger Charakter-Generator
// ------------------------------------------------------------
// Nur für NEUE Charaktere sichtbar (über "Neu" geöffnet, noch
// ungespeichert), die Shell blendet den Tab sonst aus.
// Erzeugt einen kompletten Charakter auf wählbarer Stufe (1-20):
//  • Attribute (4W6 / Standard-Array / Point Buy) klassenoptimiert
//    verteilt + Volksboni
//  • Rettungswurf-Übungen und Fertigkeits-Auswahl der Klasse
//  • Hintergrund inkl. dessen Fertigkeiten
//  • Unterklasse (ab Stufe 3), Attributssteigerungen/Talente
//    auf den ASI-Stufen (4/8/12/16/19)
//  • TP nach Durchschnittsregel, Zauber für Zauberklassen,
//    Start-Ausrüstung mit berechneter RK, Währung, XP
//  • Export als offizieller WotC-PDF-Bogen
// ============================================================
import { store, blankCharacter } from '../core/Store.js';
import { repo }    from '../core/DataRepository.js';
import { bus, EV } from '../core/EventBus.js';
import { t }       from '../core/i18n.js';
import { calcMod, calcSpellSlots, ABILITY_IDS, fmtMod, calcAC } from '../rules/calculations.js';
import { roll }    from '../rules/dice.js';
import { exportToPdf } from '../utils/pdfExport.js';
import { combinedBonus } from '../rules/bonuses.js';
import { ALIGNMENTS, asiLevels, subclassEntryLevel } from '../rules/progression.js';

const NAMES = ['Aelindra', 'Tharok', 'Miriel', 'Borgrim', 'Kaelen', 'Sylvara',
               'Dorn', 'Elowen', 'Grimjaw', 'Lyra', 'Fenwick', 'Zara'];
const XP_THRESHOLDS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000,
                       64000, 85000, 100000, 120000, 140000, 165000, 195000,
                       225000, 265000, 305000, 355000];

// 5e.tools-Fertigkeitsnamen → App-IDs (für Hintergrund-Daten)
const SKILL_MAP = { 'animal handling': 'animal', 'sleight of hand': 'sleight' };
const toSkillId = n => SKILL_MAP[n] ?? n;
const VALID_SKILLS = new Set(['acrobatics','animal','arcana','athletics','deception',
  'history','insight','intimidation','investigation','medicine','nature','perception',
  'performance','persuasion','religion','sleight','stealth','survival']);

// Start-Ausrüstung je Klasse (Namen aus dem PHB-Item-Pack)
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

// == Generierung ==============================================

function generate({ level, method, race: raceName, cls: className, bg: bgName }) {
  const races   = repo.getRaces();
  const classes = repo.getClasses();
  // Platzhalter-Hintergründe ("Custom Background" etc.) nicht zufällig wählen
  const bgs = repo.getBackgrounds();
  const randomBgs = bgs.filter(b => !/custom|variant/i.test(b.name));

  const race = raceName ? races.find(r => r.name === raceName) : pick(races);
  const cls  = className ? classes.find(c => c.name === className) : pick(classes);
  const bg   = bgName ? bgs.find(b => b.name === bgName) : pick(randomBgs);

  const char = blankCharacter();
  // Regelwerk des AKTUELLEN Kontexts übernehmen, sonst würde ein unter
  // PHB24 generierter Charakter als phb14 gespeichert und beim Laden
  // das Regelwerk der App umkippen.
  char.ruleset = repo.ruleset;
  const clsName = cls?.name ?? 'Fighter';

  // 1) Rohwerte + klassenoptimierte Verteilung + Volksboni
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

  // Boni ins Bonus-System schreiben (nicht in die Basiswerte einbacken),
  // damit die Herkunft im Editor farblich nachvollziehbar bleibt.
  char.raceBonus = { ...(race?.abilityBonuses ?? {}) };
  // Frei wählbare Boni automatisch klassenoptimiert verteilen
  char.raceChoice = autoPickChoice(race, priority);
  if (char.raceChoice) char.raceBonus = combinedBonus(race, char.raceChoice);
  char.bgChoice = autoPickChoice(bg, priority);
  char.bgBonus = char.bgChoice ? combinedBonus(bg, char.bgChoice) : { ...(bg?.abilityBonuses ?? {}) };

  // Effektiver Wert (Basis + Rasse-/Hintergrund-Boni) für Folgeberechnungen
  const effA = a => (char[a] ?? 10) + (char.raceBonus[a] ?? 0) + (char.bgBonus[a] ?? 0);

  // 2) ASI-Stufen: Attributssteigerung ODER Talent (Feat)
  const feats = [];
  const featLevels = [];
  const featPool = repo.getFeats().filter(f => !f.prerequisite);
  for (const asiLvl of asiLevels(clsName).filter(l => l <= level)) {
    if (Math.random() < 0.4 && featPool.length) {
      // Talent nehmen (keine Duplikate, wiederholbare ausgenommen)
      const f = pick(featPool.filter(f => f.repeatable || !feats.includes(f.name)));
      if (f) { feats.push(f.name); featLevels.push(asiLvl); continue; }
    }
    // +2 auf das wichtigste Attribut, dessen EFFEKTIVER Wert
    // (Basis + Volks-/Hintergrund-Boni) unter 20 liegt, so entstehen
    // keine regelwidrigen Werte über dem Attributs-Maximum.
    const bonusOf = a => (char.raceBonus[a] ?? 0) + (char.bgBonus[a] ?? 0);
    const target = priority.find(a => effA(a) < 20) ?? priority[0];
    char[target] = Math.min(char[target] + 2, 20 - bonusOf(target));
  }
  char.feats = feats;
  char.featLevels = featLevels;

  // 3) Klasse, Stufe, Unterklasse, Einstiegsstufe je Edition:
  //    2014: Kleriker/Sorcerer/Warlock ab 1, Druide/Magier ab 2, Rest ab 3.
  //    2024: alle Klassen einheitlich ab Stufe 3.
  const subLevel = subclassEntryLevel(clsName, char.ruleset);
  // Unterklassen editionstreu (regelwerk-dedupliziert) über das Repo
  const subPool = repo.getClass(clsName)?.subclasses ?? [];
  const subclass = level >= subLevel && subPool.length ? pick(subPool).name : null;
  char.classes = [{ name: clsName, level, subclass }];

  // 4) Rettungswürfe (aus Klassendaten) + Fertigkeiten (Klasse + Hintergrund)
  char.saveProficiencies = (cls?.saves ?? priority.slice(0, 2)).filter(a => ABILITY_IDS.includes(a));

  const skills = new Set();
  (bg?.skills ?? []).map(toSkillId).filter(s => VALID_SKILLS.has(s)).forEach(s => skills.add(s));
  if (cls?.skillChoices) {
    const pool = cls.skillChoices.from.filter(s => VALID_SKILLS.has(s) && !skills.has(s));
    for (let i = 0; i < cls.skillChoices.count && pool.length; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      skills.add(pool.splice(idx, 1)[0]);
    }
  }
  char.skillProficiencies = [...skills];

  // 5) TP: Stufe 1 = Maximum, danach Durchschnitt (PHB-Standard)
  // KON inkl. Rasse-/Hintergrund-Boni
  const die = +(cls?.hitDie?.slice(1) ?? 8);
  const conMod = calcMod(effA('con'));
  char.maxHP = Math.max(1, die + conMod +
    (level - 1) * Math.max(1, Math.floor(die / 2) + 1 + conMod));
  char.currHP = char.maxHP;
  char.hitDiceLeft = level;

  // 6) Zauber für Zauberklassen (Klassen-Liste, bis zum höchsten Slot-Grad)
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

  // 6b) Exklusive Unterklassen-Zauber (Domänen/Eide/Patrone) automatisch
  //     vergeben, wie im Editor, für beide Regelwerke.
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

  // 7) Ausrüstung + RK + Währung
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
  char.ac = calcAC(char); // zentrale RK-Logik aus rules/calculations
  char.currency = { cp: 0, sp: 0, ep: 0,
    gp: (2 + level) * 10 + Math.floor(Math.random() * 41), pp: 0 };

  // 8) Rest
  char.name  = pick(NAMES);
  char.race  = race?.name ?? '';
  char.background = bg?.name ?? '';
  char.alignment  = pick(ALIGNMENTS);
  char.speed = race?.speed ?? 30;
  char.xp    = XP_THRESHOLDS[level - 1] ?? 0;
  return char;
}


/** Frei wählbare Boni automatisch verteilen: erste Variante, Attribute
 *  nach Klassen-Priorität aus der erlaubten Liste. */
function autoPickChoice(entry, priority) {
  const variants = entry?.abilityChoose;
  if (!variants?.length) return null;
  const variant = variants[0];
  const picks = [];
  for (const attr of priority) {
    if (picks.length >= variant.weights.length) break;
    if (variant.from.includes(attr) && !picks.includes(attr)) picks.push(attr);
  }
  // auffüllen, falls die Prioritätsliste nicht genug erlaubte Attribute hatte
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
  return P[name] ?? ['str','dex','con','int','wis','cha'];
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

// == Vorschau =================================================

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
          <div style="font-size:20px;font-weight:600;margin:4px 0">${eff}${bonus ? ` <span style="font-size:11px;color:var(--gold)" title="+${bonus} Rasse/Hintergrund">▲</span>` : ''}</div>
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
      // Zauberplätze des generierten Charakters anzeigen
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
    // Nach dem Übernehmen ist der Charakter gespeichert → Generator-Tab
    // verschwindet; die Shell wechselt automatisch auf den Kern-Tab.
  };
  box.querySelector('#genPdf').onclick = async () => {
    try { await exportToPdf(preview); }
    catch (e) { bus.emit(EV.TOAST, { message: '✗ PDF: ' + e.message }); }
  };
  box.querySelector('#genAgain').onclick = () =>
    document.getElementById('genGo')?.click();
}
