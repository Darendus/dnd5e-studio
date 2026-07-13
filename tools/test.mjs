// ============================================================
// D&D 5e Studio: umfassender Funktionstest (Node-Harness)
// Testet jede exportierte Funktion der Logik-Module gegen die
// echten Datenpacks. Browser-Globals werden gestubbt, fetch wird
// auf das Dateisystem umgeleitet.
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../public/', import.meta.url).pathname;

// -- Browser-Stubs ------------------------------------------
const storage = new Map();
globalThis.localStorage = {
  getItem: k => storage.has(k) ? storage.get(k) : null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
};
globalThis.window = globalThis;
globalThis.matchMedia = () => ({ matches: false, addEventListener: () => {} });
globalThis.fetch = async path => {
  try {
    const data = readFileSync(ROOT + String(path).replace(/^\//, ''), 'utf8');
    return { ok: true, json: async () => JSON.parse(data) };
  } catch { return { ok: false, json: async () => { throw new Error('404'); } }; }
};
globalThis.document = {
  querySelector: () => null, querySelectorAll: () => [],
  getElementById: () => null, createElement: () => ({ style: {}, classList: { add(){}, remove(){} } }),
  documentElement: { style: { setProperty(){} }, dataset: {}, setAttribute(){} },
  body: { appendChild(){} },
};

// -- Test-Helfer --------------------------------------------
let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (detail ? ' [' + detail + ']' : '')); }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want),
        'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want));
}

// -- Module laden -------------------------------------------
const { bus, EV } = await import(ROOT + 'src/core/EventBus.js');
const { t, setLang, getLang, LANGS } = await import(ROOT + 'src/core/i18n.js');
const { store, blankCharacter } = await import(ROOT + 'src/core/Store.js');
const { repo } = await import(ROOT + 'src/core/DataRepository.js');
await repo.load();
const calc = await import(ROOT + 'src/rules/calculations.js');
const bon  = await import(ROOT + 'src/rules/bonuses.js');
const dice = await import(ROOT + 'src/rules/dice.js');
const prog = await import(ROOT + 'src/rules/progression.js');
const wild = await import(ROOT + 'src/rules/wildshape.js');

console.log('Packs: ' + repo.classes.length + ' Klassen, ' + repo.spells.length + ' Zauber, '
  + repo.feats.length + ' Feats, ' + repo.beasts.length + ' Tierformen');

// ============================================================
// 1) EventBus
// ============================================================
{
  let got = null;
  const off = bus.on('T_EVT', p => got = p);
  bus.emit('T_EVT', 42);
  eq('bus.on/emit', got, 42);
  off?.call ? off() : bus.off?.('T_EVT');
  check('EV vollstaendig', ['CHAR_CHANGED','CHAR_LOADED','DATA_READY','LANG_CHANGED','SOURCES_CHANGED','ROLL_RESULT','TOAST'].every(k => EV[k]));
}

// ============================================================
// 2) calculations: Grundfunktionen
// ============================================================
eq('calcMod(10)', calc.calcMod(10), 0);
eq('calcMod(8)', calc.calcMod(8), -1);
eq('calcMod(20)', calc.calcMod(20), 5);
eq('calcMod(7)', calc.calcMod(7), -2);
eq('calcProfBonus(1)', calc.calcProfBonus(1), 2);
eq('calcProfBonus(4)', calc.calcProfBonus(4), 2);
eq('calcProfBonus(5)', calc.calcProfBonus(5), 3);
eq('calcProfBonus(20)', calc.calcProfBonus(20), 6);
eq('fmtMod(+3)', calc.fmtMod(3), '+3');
eq('fmtMod(-1)', calc.fmtMod(-1), '-1');
eq('fmtMod(0)', calc.fmtMod(0), '+0');
check('ABILITY_IDS', JSON.stringify(calc.ABILITY_IDS) === JSON.stringify(['str','dex','con','int','wis','cha']));
check('SKILL_DEFS 18 Fertigkeiten', calc.SKILL_DEFS.length === 18);
check('SKILL_DEFS Attribute gueltig', calc.SKILL_DEFS.every(s => calc.ABILITY_IDS.includes(s.attr)));

// calcSkillBonus: Basis / geuebt / Expertise
eq('skill ungeuebt', calc.calcSkillBonus(3, false, false, 2), 3);
eq('skill geuebt', calc.calcSkillBonus(3, true, false, 2), 5);
eq('skill Expertise', calc.calcSkillBonus(3, true, true, 2), 7);

// ============================================================
// 3) effectiveAbilities: Boni, Items, Wildgestalt
// ============================================================
{
  const c = { ...blankCharacter(), str: 10, dex: 14, raceBonus: { str: 2 }, bgBonus: { str: 1 }, featBonus: { dex: 1 } };
  const eff = calc.effectiveAbilities(c);
  eq('effAbilities Summierung', [eff.scores.str, eff.scores.dex], [13, 15]);
  check('effAbilities sources', eff.sources?.str?.length >= 2);

  // Item mit festem Attributswert (z. B. Guertel) via Items-Pack pruefen wir generisch:
  const wolf = repo.getBeasts().find(b => /^Wolf$/i.test(b.name));
  if (wolf) {
    const shifted = { ...c, wildshape: { active: true, form: wolf.name } };
    const effW = calc.effectiveAbilities(shifted);
    check('Wildgestalt ersetzt Koerperwerte', effW.scores.str === wolf.str && effW.scores.dex === wolf.dex);
    check('Wildgestalt behaelt Geisteswerte', effW.scores.int === eff.scores.int);
  } else check('Wolf im Pack', false);
}

// ============================================================
// 4) calcMaxHP: Durchschnittsregel + Feat-Effekte
// ============================================================
{
  const base = { ...blankCharacter(), con: 14, classes: [{ name: 'Fighter', level: 5 }] };
  eq('maxHP Fighter 5 KON14', calc.calcMaxHP(base), 44); // 10+2 + 4*(6+2)
  const tough = { ...base, feats: ['Tough'] };
  eq('maxHP + Tough', calc.calcMaxHP(tough), 54);
  const boon = { ...base, feats: ['Boon of Fortitude'] };
  eq('maxHP + Boon of Fortitude', calc.calcMaxHP(boon), 84);
  const multi = { ...blankCharacter(), con: 14, classes: [{ name: 'Fighter', level: 3 }, { name: 'Wizard', level: 2 }] };
  eq('maxHP Multiclass F3/W2', calc.calcMaxHP(multi), 12 + 16 + 2 * (4 + 2)); // 10+2, 2*(6+2), 2*(4+2)
}

// ============================================================
// 5) calcAC: Ruestungstypen, Schild, magische Ruestung
// ============================================================
{
  const st = items => ({ ...blankCharacter(), dex: 16, items });
  eq('AC ohne Ruestung 10+3', calc.calcAC(st([])), 13);
  check('AC Leichte Ruestung 11+3', calc.calcAC(st([{ name: 'Leather Armor', equipped: true }])) === 14,
        'got=' + calc.calcAC(st([{ name: 'Leather Armor', equipped: true }])));
  check('AC Platte ignoriert DEX (18)', calc.calcAC(st([{ name: 'Plate Armor', equipped: true }])) === 18,
        'got=' + calc.calcAC(st([{ name: 'Plate Armor', equipped: true }])));
  check('AC Platte+Schild (20)', calc.calcAC(st([{ name: 'Plate Armor', equipped: true }, { name: 'Shield', equipped: true }])) === 20);
  check('AC Mittel deckelt DEX auf 2 (17)', calc.calcAC(st([{ name: 'Half Plate Armor', equipped: true }])) === 17,
        'got=' + calc.calcAC(st([{ name: 'Half Plate Armor', equipped: true }])));
  check('AC nicht ausgeruestete Ruestung ignoriert', calc.calcAC(st([{ name: 'Plate Armor', equipped: false }])) === 13);
  const dwarven = repo.findItem('Dwarven Plate');
  if (dwarven) {
    check('AC Dwarven Plate 20 (18+2, keine Doppelzaehlung)',
          calc.calcAC(st([{ name: 'Dwarven Plate', equipped: true }])) === 20,
          'got=' + calc.calcAC(st([{ name: 'Dwarven Plate', equipped: true }])));
  } else check('Dwarven Plate im Pack', false);
}

// ============================================================
// 6) itemBonuses und featEffects
// ============================================================
{
  const ring = repo.findItem('Ring of Protection');
  if (ring) {
    const ib = calc.itemBonuses({ ...blankCharacter(), items: [{ name: 'Ring of Protection', equipped: true }] });
    check('Ring of Protection +1 AC/+1 Save', ib.ac === 1 && ib.save === 1, JSON.stringify(ib));
    const ibShift = calc.itemBonuses({ ...blankCharacter(), items: [{ name: 'Ring of Protection', equipped: true }],
                                       wildshape: { form: 'Wolf' } });
    check('itemBonuses pausiert in Wildgestalt', ibShift.ac === 0 && ibShift.save === 0);
  } else check('Ring of Protection im Pack', false);

  const fx = calc.featEffects({ ...blankCharacter(), feats: ['Alert', 'Mobile', 'Tough', 'Boon of Fortitude'] });
  check('featEffects Initiative +5 (Alert 2014)', fx.initiative === 5);
  check('featEffects Speed +10 (Mobile)', fx.speed === 10);
  check('featEffects hpPerLevel 2 (Tough)', fx.hpPerLevel === 2);
  check('featEffects hpFlat 40 (Boon)', fx.hpFlat === 40);
  repo.setRuleset('phb24'); // App synchronisiert das Regelwerk beim Laden
  const fx24 = calc.featEffects({ ...blankCharacter(), ruleset: 'phb24', feats: ['Alert'] });
  check('featEffects initiativeProf (Alert 2024)', fx24.initiativeProf === true, JSON.stringify(fx24));
  repo.setRuleset('phb14');

  const spd = calc.effectiveSpeed({ ...blankCharacter(), speed: 30, feats: ['Mobile'] });
  eq('effectiveSpeed 30+10', spd, 40);
}

// ============================================================
// 7) calcSpellSlots: alle Progressionen + Multiclass + Arkanum
// ============================================================
{
  const s = cs => calc.calcSpellSlots(cs);
  eq('Slots Wizard 5', s([{ name: 'Wizard', level: 5 }]).slots.slice(0, 3), [4, 3, 2]);
  eq('Slots Paladin 5 (halb)', s([{ name: 'Paladin', level: 5 }]).slots.slice(0, 2), [4, 2]);
  const wl = s([{ name: 'Warlock', level: 11 }]);
  check('Warlock 11: 3 Pakt-Slots Grad 5', wl.pact.count === 3 && wl.pact.level === 5);
  eq('Warlock 11 Arkanum [6]', wl.pact.arcanum, [6]);
  eq('Warlock 17 Arkana', s([{ name: 'Warlock', level: 17 }]).pact.arcanum, [6, 7, 8, 9]);
  check('Warlock hat keine Standard-Slots', wl.slots.every(n => n === 0));
  // Multiclass: Wizard 3 + Paladin 2 -> Casterlevel 4 -> [4,3]
  const mc = s([{ name: 'Wizard', level: 3 }, { name: 'Paladin', level: 2 }]);
  eq('Multiclass W3/P2 Casterlevel 4', mc.slots.slice(0, 2), [4, 3]);
  // Eldritch Knight (Drittel-Caster ueber Unterklasse)
  const ek = s([{ name: 'Fighter', level: 6, subclass: 'Eldritch Knight' }]);
  check('Eldritch Knight 6 hat Slots', ek.slots[0] > 0, JSON.stringify(ek.slots));
}

// ============================================================
// 8) weaponAttack, hitDiceSummary, carryCapacity, primarySpellAbility
// ============================================================
{
  const c = { ...blankCharacter(), str: 16, dex: 14, classes: [{ name: 'Fighter', level: 5 }] };
  const atk = calc.weaponAttack(c, repo.findItem('Longsword'));
  check('weaponAttack Longsword STR+Prof (+6)', atk.atkBonus === 3 + 3, JSON.stringify(atk));
  const fin = calc.weaponAttack({ ...c, dex: 18 }, repo.findItem('Dagger'));
  check('weaponAttack Finesse nimmt DEX (+7)', fin.atkBonus === 4 + 3, JSON.stringify(fin));
  const bow = calc.weaponAttack(c, repo.findItem('Longbow'));
  check('weaponAttack Fernkampf nimmt DEX', bow.ranged === true && bow.atkBonus === 2 + 3, JSON.stringify(bow));

  const hd = calc.hitDiceSummary([{ name: 'Fighter', level: 3 }, { name: 'Wizard', level: 2 }]);
  check('hitDiceSummary 3W10+2W6', /3.?[dW]10/.test(hd) && /2.?[dW]6/.test(hd), hd);

  eq('carryCapacity STR16', calc.carryCapacity({ ...blankCharacter(), str: 16 }), 16 * 15);
  eq('primarySpellAbility Wizard', calc.primarySpellAbility([{ name: 'Wizard', level: 1 }]), 'int');
}

// ============================================================
// 9) bonuses: raceBonusFor / bgBonusFor / featBonusFor / combinedBonus
// ============================================================
{
  const hillDwarf = repo.getRaces().find(r => /Dwarf \(Hill\)|Hill Dwarf/i.test(r.name)) ?? repo.getRaces().find(r => r.name === 'Dwarf');
  if (hillDwarf) {
    const b = bon.raceBonusFor(hillDwarf.name, null);
    check('raceBonusFor Zwerg KON+2', (b.con ?? 0) >= 2, JSON.stringify(b));
  } else check('Zwerg im Pack', false);

  const fb = bon.featBonusFor(['Resilient']);
  check('featBonusFor liefert Objekt', typeof fb === 'object');
  // Wiederholbares Talent zaehlt doppelt
  const asi2 = bon.featBonusFor(['Ability Score Improvement', 'Ability Score Improvement']);
  check('featBonusFor Duplikate ok', typeof asi2 === 'object');

  // combinedBonus: picks ist Index-zu-Attribut (je Gewicht eine Wahl)
  const bg24 = repo.getBackgrounds().find(b => b.source === 'XPHB' && b.abilityChoose?.length);
  if (bg24) {
    const variant = bg24.abilityChoose[0];
    const picks = {};
    variant.weights.forEach((w, i) => { picks[i] = variant.from[i % variant.from.length]; });
    const cb = bon.combinedBonus(bg24, { variant: 0, picks });
    const sum = Object.values(cb).reduce((a, x) => a + x, 0);
    const want = variant.weights.reduce((a, w) => a + w, 0);
    check('combinedBonus 2024-BG summiert Gewichte', sum === want, sum + ' vs ' + want + ' ' + JSON.stringify(cb));
    // Dublettensperre: zweimal dasselbe Attribut -> nur erstes zaehlt
    const dup = bon.combinedBonus(bg24, { variant: 0, picks: { 0: variant.from[0], 1: variant.from[0] } });
    check('combinedBonus Dublettensperre', (dup[variant.from[0]] ?? 0) === variant.weights[0], JSON.stringify(dup));
  } else check('2024-Hintergrund mit choose', false);
}

// ============================================================
// 10) dice: Wuerfe in Grenzen, Vorteil/Nachteil, Formeln
// ============================================================
{
  let ok = true;
  for (let i = 0; i < 200; i++) { const r = dice.roll(20)[0]; if (r < 1 || r > 20) ok = false; }
  check('roll(20) in [1,20]', ok);
  eq('roll(6, 4) liefert 4 Wuerfe', dice.roll(6, 4).length, 4);
  eq('roll(0) liefert 0 (kein 1d0=1)', dice.roll(0)[0], 0);
  let advOk = true, disOk = true, critSeen = false;
  for (let i = 0; i < 300; i++) {
    const a = dice.d20(2, 'adv');
    if (a.raw !== Math.max(a.first, a.second) || a.total !== a.raw + 2) advOk = false;
    const dd = dice.d20(0, 'dis');
    if (dd.raw !== Math.min(dd.first, dd.second)) disOk = false;
    if (a.isCrit) critSeen = true;
  }
  check('d20 Vorteil nimmt Maximum + Bonus', advOk);
  check('d20 Nachteil nimmt Minimum', disOk);
  check('d20 isCrit tritt auf (300 Versuche)', critSeen);
  const f = dice.parseAndRoll('2d6+3');
  check('parseAndRoll 2d6+3 in [5,15]', f.total >= 5 && f.total <= 15, JSON.stringify(f));
  const kh = dice.parseAndRoll('4d6kh3');
  check('parseAndRoll 4d6kh3 in [3,18]', kh && kh.total >= 3 && kh.total <= 18, JSON.stringify(kh));
  const neg = dice.parseAndRoll('1d4-6');
  check('parseAndRoll mit Minus-Bonus', neg && neg.total >= -5 && neg.total <= -2, JSON.stringify(neg));
  check('parseAndRoll Muell -> null', dice.parseAndRoll('kaese') === null);
  const rf = dice.rollFormula('1d8+2');
  check('rollFormula publiziert und liefert Ergebnis', rf.total >= 3 && rf.total <= 10, JSON.stringify(rf));
}

// ============================================================
// 11) progression
// ============================================================
eq('asiLevels Fighter', prog.asiLevels('Fighter'), [4, 6, 8, 12, 14, 16, 19]);
eq('asiLevels Rogue', prog.asiLevels('Rogue'), [4, 8, 10, 12, 16, 19]);
eq('asiLevels Wizard (Default)', prog.asiLevels('Wizard'), [4, 8, 12, 16, 19]);
eq('subclassEntryLevel Cleric 2014', prog.subclassEntryLevel('Cleric', 'phb14'), 1);
eq('subclassEntryLevel Wizard 2014', prog.subclassEntryLevel('Wizard', 'phb14'), 2);
eq('subclassEntryLevel Cleric 2024', prog.subclassEntryLevel('Cleric', 'phb24'), 3);
check('ALIGNMENTS 9 Eintraege', prog.ALIGNMENTS.length === 9);

// ============================================================
// 12) wildshape
// ============================================================
{
  eq('crToNumber 1/4', wild.crToNumber('1/4'), 0.25);
  eq('crToNumber 5', wild.crToNumber('5'), 5);
  check('wildshapeLimits < Stufe 2 -> null', wild.wildshapeLimits([{ name: 'Druid', level: 1 }]) === null);
  const d2 = wild.wildshapeLimits([{ name: 'Druid', level: 2 }]);
  check('Druide 2: CR 1/4, kein Fliegen/Schwimmen', d2.maxCR === 0.25 && d2.noFly && d2.noSwim, JSON.stringify(d2));
  const d8 = wild.wildshapeLimits([{ name: 'Druid', level: 8 }]);
  check('Druide 8: CR 1, Fliegen erlaubt', d8.maxCR === 1 && d8.noFly === false, JSON.stringify(d8));
  const moon6 = wild.wildshapeLimits([{ name: 'Druid', level: 6, subclass: 'Circle of the Moon' }]);
  check('Mond-Druide 6: CR 2', moon6.maxCR >= 2, JSON.stringify(moon6));
  eq('druidLevel Multiclass', wild.druidLevel([{ name: 'Druid', level: 4 }, { name: 'Fighter', level: 2 }]), 4);
  check('elementalUnlocked Mond 10', wild.elementalUnlocked([{ name: 'Druid', level: 10, subclass: 'Circle of the Moon' }]) === true);
  check('elementalUnlocked Land 10 nicht', wild.elementalUnlocked([{ name: 'Druid', level: 10, subclass: 'Circle of the Land' }]) === false);
  const forms = wild.availableForms([{ name: 'Druid', level: 2 }]);
  check('availableForms Druide 2 gefiltert', forms.length > 0 &&
        forms.every(f => f.elemental || wild.crToNumber(f.cr) <= 0.25), 'n=' + forms.length);
  check('formatSpeed liefert String', typeof wild.formatSpeed({ walk: 30, fly: 60 }) === 'string');
}

// ============================================================
// 13) Store: Schema, Rasten, Migration, Roster
// ============================================================
{
  const blank = blankCharacter();
  const must = ['ruleset','classes','feats','featLevels','arcanumUsed','raceBonus','bgBonus','featBonus',
                'spellSlotsUsed','pactSlotsUsed','hitDiceLeft','skillProficiencies','saveProficiencies',
                'items','spells','attacks','currency','languages','otherProficiencies','portrait','acManual'];
  const missing = must.filter(k => !(k in blank));
  check('blankCharacter Schema vollstaendig', missing.length === 0, missing.join(','));

  store.newCharacter('phb24');
  eq('newCharacter setzt ruleset', store.field('ruleset'), 'phb24');
  store.update({ classes: [{ name: 'Warlock', level: 5, subclass: null }], pactSlotsUsed: 2,
                 arcanumUsed: [6], wildshapeUses: 0, spellSlotsUsed: [1,0,0,0,0,0,0,0,0] });
  eq('totalLevel', store.totalLevel(), 5);
  store.shortRest();
  eq('shortRest stellt Pakt-Slots her', store.field('pactSlotsUsed'), 0);
  eq('shortRest laesst Arkana unberuehrt', store.field('arcanumUsed'), [6]);
  store.longRest();
  eq('longRest setzt Arkana zurueck', store.field('arcanumUsed'), []);
  eq('longRest setzt Slots zurueck', store.field('spellSlotsUsed'), [0,0,0,0,0,0,0,0,0]);

  // Wildgestalt-Rast je Regelwerk
  store.update({ classes: [{ name: 'Druid', level: 4, subclass: null }], wildshapeUses: 0, ruleset: 'phb14' });
  store.shortRest();
  eq('shortRest 2014: Wildgestalt voll (2)', store.field('wildshapeUses'), 2);
  store.update({ wildshapeUses: 0, ruleset: 'phb24' });
  store.shortRest();
  eq('shortRest 2024: Wildgestalt +1', store.field('wildshapeUses'), 1);

  // Migration: Alt-Charakter ohne neue Felder
  store.replace({ name: 'Alt', classes: [{ name: 'Fighter', level: 1 }] });
  check('replace migriert featLevels', Array.isArray(store.field('featLevels')));
  check('replace migriert arcanumUsed', Array.isArray(store.field('arcanumUsed')));

  // Roster
  const prevId = store.activeId();
  store.newCharacter('phb14');
  check('newCharacter wechselt aktive ID', store.activeId() !== prevId);
  store.update({ name: 'Testheld' }); // erst jetzt wird das Roster gespeichert (by design)
  check('Roster enthaelt neuen Charakter nach Aenderung',
        store.listCharacters().some(c => c.id === store.activeId()));
  const json = store.exportJson();
  check('exportJson enthaelt Namen', json.includes('"name"'));
  check('importJson akzeptiert Export', store.importJson(json) === true);
  check('importJson lehnt Muell ab', store.importJson('{kaputt') === false);
}

// ============================================================
// 14) DataRepository: Dedupe, Bibliothek, Homebrew
// ============================================================
{
  repo.setRuleset('phb14');
  check('getClass Fighter 2014 -> PHB', repo.getClass('Fighter')?.source === 'PHB');
  repo.setRuleset('phb24');
  check('getClass Fighter 2024 -> XPHB', repo.getClass('Fighter')?.source === 'XPHB');
  check('Unterklassen dedupliziert', (() => {
    const subs = repo.getClass('Paladin').subclasses.map(sc => sc.name);
    return new Set(subs).size === subs.length;
  })());
  repo.setRuleset('phb14');

  check('findSpell Fireball', repo.findSpell('Fireball')?.name === 'Fireball');
  check('findSpellCI kleingeschrieben', repo.findSpellCI('cure wounds')?.name === 'Cure Wounds');
  check('findFeat/findItem/findBeast', !!repo.findFeat('Tough') && !!repo.findItem('Shield') && !!repo.findBeast('Wolf'));

  const auto = repo.subclassAutoSpells('Cleric', repo.getClass('Cleric').subclasses.find(sc => /Life/.test(sc.name))?.name);
  check('subclassAutoSpells Life Domain', auto && Object.keys(auto).length >= 4, JSON.stringify(auto)?.slice(0, 60));

  // Bibliothek: Klassenliste + Unterklassen-extra + Feat-Kriterien
  const baseLib = repo.getSpellsForClasses(['Fighter']);
  const featLib = repo.getSpellsForClasses(['Fighter'], ['Adept of the Black Robes']);
  check('Feat-Kriterien erweitern Bibliothek', featLib.length > baseLib.length,
        baseLib.length + ' -> ' + featLib.length);
  const fiendLib = repo.getSpellsForClasses([{ name: 'Warlock', subclass: 'The Fiend' }]);
  check('Unterklassen-extra: Fireball beim Unhold', fiendLib.some(sp => sp.name === 'Fireball'));

  // Homebrew: Charakter-Bindung
  storage.set('dnd5e_studio_roster', JSON.stringify({ activeId: 'charA', characters: [] }));
  repo.addHomebrew('spells', { name: 'Testfunke', level: 1, classes: ['Fighter'] });
  check('Homebrew fuer Ersteller sichtbar', repo.getHomebrew().spells.some(e => e.name === 'Testfunke'));
  storage.set('dnd5e_studio_roster', JSON.stringify({ activeId: 'charB', characters: [] }));
  repo.refreshHomebrew();
  check('Homebrew fuer anderen Charakter unsichtbar', !repo.getHomebrew().spells.some(e => e.name === 'Testfunke'));
  storage.set('dnd5e_studio_roster', JSON.stringify({ activeId: 'charA', characters: [] }));
  repo.removeHomebrew('spells', 'Testfunke');
  check('Homebrew entfernt', !repo.getHomebrew().spells.some(e => e.name === 'Testfunke'));

  // Quellen-Schalter
  repo.setSourceEnabled('PHB', false);
  check('Quelle deaktivierbar', repo.isSourceEnabled('PHB') === false);
  check('Dedupe faellt auf XPHB zurueck', repo.getClass('Fighter')?.source === 'XPHB');
  repo.setSourceEnabled('PHB', true);
}

// ============================================================
// 15) i18n: beide Sprachen + Key-Abdeckung aller Komponenten
// ============================================================
{
  setLang('de');
  check('t() deutsch', t('app.save')?.length > 0 && t('app.save') !== 'app.save');
  setLang('en');
  check('t() englisch', t('app.save')?.length > 0);
  check('LANGS de+en', LANGS.some(l => l.id === 'de') && LANGS.some(l => l.id === 'en'));

  // Alle t('x.y')-Literale der Komponenten gegen beide Sprachen pruefen
  const { readdirSync } = await import('node:fs');
  const keys = new Set();
  const dirs = ['src/components/', 'src/rules/', 'src/utils/'];
  for (const dir of dirs) {
    for (const file of readdirSync(ROOT + dir)) {
      if (!file.endsWith('.js')) continue;
      const code = readFileSync(ROOT + dir + file, 'utf8');
      for (const m of code.matchAll(/[^a-zA-Z]t\('([a-zA-Z0-9_.]+)'\)/g)) keys.add(m[1]);
    }
  }
  const missing = { de: [], en: [] };
  for (const lang of ['de', 'en']) {
    setLang(lang);
    for (const k of keys) {
      const v = t(k);
      if (v === k || v == null) missing[lang].push(k);
    }
  }
  check('i18n de vollstaendig (' + keys.size + ' Keys)', missing.de.length === 0, missing.de.slice(0, 6).join(','));
  check('i18n en vollstaendig', missing.en.length === 0, missing.en.slice(0, 6).join(','));
  setLang('de');
}

// ============================================================
console.log('');
console.log('Bestanden: ' + pass + ' | Fehlgeschlagen: ' + fail);
if (fail) { console.log('FEHLER:'); failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('✓ ALLE TESTS BESTANDEN');
