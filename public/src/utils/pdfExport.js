// ============================================================
// utils/pdfExport.js, Export auf den offiziellen WotC-Bogen
// ------------------------------------------------------------
// Befüllt den ausfüllbaren 3-Seiten-Standardbogen (D&D 5e, ©WotC)
// unter public/assets/character-sheet.pdf:
//   Seite 1: Kernbogen (Attribute, Saves, Skills, Kampf, Waffen,
//            Ausrüstung, Währung, Talente/Merkmale)
//   Seite 2: Beschreibung (Hintergrundgeschichte, Talente im Detail)
//   Seite 3: Zauberbogen (Klasse, SG, Slots, Zauber pro Grad mit
//            Vorbereitet-Häkchen)
// Die Zeilen-/Checkbox-Zuordnung der Zauberseite wurde geometrisch
// aus den Widget-Positionen des Formulars abgeleitet.
//
// Wichtig: Einige Felder des Bogens haben keinen /DA-Eintrag -
// ohne gesetzte Schriftgröße rendert Acrobat sie in Auto-Größe
// (riesiger Text). setText setzt daher notfalls die Default-
// Appearance direkt, bevor der Text geschrieben wird.
// ============================================================
import { repo } from '../core/DataRepository.js';
import { t } from '../core/i18n.js';
import {
  calcMod, calcProfBonus, fmtMod, effectiveAbilities, weaponAttack,
  calcSkillBonus, SKILL_DEFS, ABILITY_IDS, hitDiceSummary, calcSpellSlots,
  effectiveInitiative, effectiveSpeed,
} from '../rules/calculations.js';

// == Seite 1: Checkbox- und Feldnamen (offizieller Bogen) =====
const SAVE_BOXES  = { str: 'Check Box 11', dex: 'Check Box 18', con: 'Check Box 19',
                      int: 'Check Box 20', wis: 'Check Box 21', cha: 'Check Box 22' };
const SKILL_BOXES = {
  acrobatics: 'Check Box 23', animal: 'Check Box 24', arcana: 'Check Box 25',
  athletics: 'Check Box 26', deception: 'Check Box 27', history: 'Check Box 28',
  insight: 'Check Box 29', intimidation: 'Check Box 30', investigation: 'Check Box 31',
  medicine: 'Check Box 32', nature: 'Check Box 33', perception: 'Check Box 34',
  performance: 'Check Box 35', persuasion: 'Check Box 36', religion: 'Check Box 37',
  sleight: 'Check Box 38', stealth: 'Check Box 39', survival: 'Check Box 40',
};
const SKILL_FIELDS = {
  acrobatics: 'Acrobatics', animal: 'Animal', arcana: 'Arcana', athletics: 'Athletics',
  deception: 'Deception ', history: 'History ', insight: 'Insight', intimidation: 'Intimidation',
  investigation: 'Investigation ', medicine: 'Medicine', nature: 'Nature',
  perception: 'Perception ', performance: 'Performance', persuasion: 'Persuasion',
  religion: 'Religion', sleight: 'SleightofHand', stealth: 'Stealth ', survival: 'Survival',
};
const SAVE_FIELDS = { str: 'ST Strength', dex: 'ST Dexterity', con: 'ST Constitution',
                      int: 'ST Intelligence', wis: 'ST Wisdom', cha: 'ST Charisma' };
const ABILITY_FIELDS = {
  str: ['STR', 'STRmod'], dex: ['DEX', 'DEXmod '], con: ['CON', 'CONmod'],
  int: ['INT', 'INTmod'], wis: ['WIS', 'WISmod'], cha: ['CHA', 'CHamod'],
};
const DMG_WORDS = { P: 'piercing', B: 'bludgeoning', S: 'slashing', R: 'radiant',
                    N: 'necrotic', F: 'fire', C: 'cold', L: 'lightning', A: 'acid',
                    T: 'thunder', PS: 'psychic', I: 'poison', O: 'force' };

// == Seite 3: Zauberzeilen pro Grad + Vorbereitet-Checkboxen ==
// (geometrisch aus dem offiziellen Formular abgeleitet, Reihenfolge
//  = von oben nach unten innerhalb des jeweiligen Grad-Blocks)
const SPELL_LINES = {
  0: ["Spells 1014", "Spells 1016", "Spells 1017", "Spells 1018", "Spells 1019", "Spells 1020", "Spells 1021", "Spells 1022"],
  1: ["Spells 1015", "Spells 1023", "Spells 1024", "Spells 1025", "Spells 1026", "Spells 1027", "Spells 1028", "Spells 1029", "Spells 1030", "Spells 1031", "Spells 1032", "Spells 1033"],
  2: ["Spells 1046", "Spells 1034", "Spells 1035", "Spells 1036", "Spells 1037", "Spells 1038", "Spells 1039", "Spells 1040", "Spells 1041", "Spells 1042", "Spells 1043", "Spells 1044", "Spells 1045"],
  3: ["Spells 1048", "Spells 1047", "Spells 1049", "Spells 1050", "Spells 1051", "Spells 1052", "Spells 1053", "Spells 1054", "Spells 1055", "Spells 1056", "Spells 1057", "Spells 1058", "Spells 1059"],
  4: ["Spells 1061", "Spells 1060", "Spells 1062", "Spells 1063", "Spells 1064", "Spells 1065", "Spells 1066", "Spells 1067", "Spells 1068", "Spells 1069", "Spells 1070", "Spells 1071", "Spells 1072"],
  5: ["Spells 1074", "Spells 1073", "Spells 1075", "Spells 1076", "Spells 1077", "Spells 1078", "Spells 1079", "Spells 1080", "Spells 1081"],
  6: ["Spells 1083", "Spells 1082", "Spells 1084", "Spells 1085", "Spells 1086", "Spells 1087", "Spells 1088", "Spells 1089", "Spells 1090"],
  7: ["Spells 1092", "Spells 1091", "Spells 1093", "Spells 1094", "Spells 1095", "Spells 1096", "Spells 1097", "Spells 1098", "Spells 1099"],
  8: ["Spells 10101", "Spells 10100", "Spells 10102", "Spells 10103", "Spells 10104", "Spells 10105", "Spells 10106"],
  9: ["Spells 10108", "Spells 10107", "Spells 10109", "Spells 101010", "Spells 101011", "Spells 101012", "Spells 101013"],
};
const PREPARED_BOX = {"Spells 1015":"Check Box 251", "Spells 1023":"Check Box 309", "Spells 1024":"Check Box 3010", "Spells 1025":"Check Box 3011", "Spells 1026":"Check Box 3012", "Spells 1027":"Check Box 3013", "Spells 1028":"Check Box 3014", "Spells 1029":"Check Box 3015", "Spells 1030":"Check Box 3016", "Spells 1031":"Check Box 3017", "Spells 1032":"Check Box 3018", "Spells 1033":"Check Box 3019", "Spells 1034":"Check Box 310", "Spells 1035":"Check Box 3020", "Spells 1036":"Check Box 3021", "Spells 1037":"Check Box 3022", "Spells 1038":"Check Box 3023", "Spells 1039":"Check Box 3024", "Spells 1040":"Check Box 3025", "Spells 1041":"Check Box 3026", "Spells 1042":"Check Box 3027", "Spells 1043":"Check Box 3028", "Spells 1044":"Check Box 3029", "Spells 1045":"Check Box 3030", "Spells 1046":"Check Box 313", "Spells 1047":"Check Box 314", "Spells 1048":"Check Box 315", "Spells 1049":"Check Box 3031", "Spells 1050":"Check Box 3032", "Spells 1051":"Check Box 3033", "Spells 1052":"Check Box 3034", "Spells 1053":"Check Box 3035", "Spells 1054":"Check Box 3036", "Spells 1055":"Check Box 3037", "Spells 1056":"Check Box 3038", "Spells 1057":"Check Box 3039", "Spells 1058":"Check Box 3040", "Spells 1059":"Check Box 3041", "Spells 1060":"Check Box 316", "Spells 1061":"Check Box 317", "Spells 1062":"Check Box 3042", "Spells 1063":"Check Box 3043", "Spells 1064":"Check Box 3044", "Spells 1065":"Check Box 3045", "Spells 1066":"Check Box 3046", "Spells 1067":"Check Box 3047", "Spells 1068":"Check Box 3048", "Spells 1069":"Check Box 3049", "Spells 1070":"Check Box 3050", "Spells 1071":"Check Box 3051", "Spells 1072":"Check Box 3052", "Spells 1073":"Check Box 318", "Spells 1074":"Check Box 319", "Spells 1075":"Check Box 3053", "Spells 1076":"Check Box 3054", "Spells 1077":"Check Box 3055", "Spells 1078":"Check Box 3056", "Spells 1079":"Check Box 3057", "Spells 1080":"Check Box 3058", "Spells 1081":"Check Box 3059", "Spells 1082":"Check Box 320", "Spells 1083":"Check Box 321", "Spells 1084":"Check Box 3060", "Spells 1085":"Check Box 3061", "Spells 1086":"Check Box 3062", "Spells 1087":"Check Box 3063", "Spells 1088":"Check Box 3064", "Spells 1089":"Check Box 3065", "Spells 1090":"Check Box 3066", "Spells 1091":"Check Box 322", "Spells 1092":"Check Box 323", "Spells 1093":"Check Box 3067", "Spells 1094":"Check Box 3068", "Spells 1095":"Check Box 3069", "Spells 1096":"Check Box 3070", "Spells 1097":"Check Box 3071", "Spells 1098":"Check Box 3072", "Spells 1099":"Check Box 3073", "Spells 10100":"Check Box 324", "Spells 10101":"Check Box 325", "Spells 10102":"Check Box 3074", "Spells 10103":"Check Box 3075", "Spells 10104":"Check Box 3076", "Spells 10105":"Check Box 3077", "Spells 10106":"Check Box 3078", "Spells 10107":"Check Box 326", "Spells 10108":"Check Box 327", "Spells 10109":"Check Box 3079", "Spells 101010":"Check Box 3080", "Spells 101011":"Check Box 3081", "Spells 101012":"Check Box 3082", "Spells 101013":"Check Box 3083"};
// SlotsTotal/SlotsRemaining 19..27 entsprechen Grad 1..9
const slotField = (kind, level) => `${kind} ${18 + level}`;

/** Aktiven Charakter (oder Generator-Vorschau) als WotC-PDF herunterladen */
export async function exportToPdf(s) {
  const { PDFDocument } = window.PDFLib;
  const bytes = await (await fetch('assets/character-sheet.pdf')).arrayBuffer();
  const doc   = await PDFDocument.load(bytes);
  const form  = doc.getForm();

  // Text setzen; Schriftgröße robust: erst setFontSize, bei fehlendem
  // /DA-Eintrag Default-Appearance direkt schreiben (verhindert Auto-
  // Größe = Riesen-Schrift in großen Feldern).
  const setText = (name, value, size = null) => {
    let f;
    try { f = form.getTextField(name); } catch { return; }
    if (size) {
      try { f.setFontSize(size); }
      catch { try { f.acroField.setDefaultAppearance(`/Helv ${size} Tf 0 g`); } catch {} }
    }
    try { f.setText(String(value ?? '')); } catch {}
  };
  const check = name => { try { form.getCheckBox(name).check(); } catch {} };

  const totalLevel = (s.classes ?? []).reduce((a, c) => a + (+c.level || 0), 0) || 1;
  const pb  = calcProfBonus(totalLevel);
  const eff = effectiveAbilities(s).scores;

  // ════ SEITE 1 ════════════════════════════════════════════

  setText('CharacterName', s.name);
  setText('ClassLevel', (s.classes ?? [])
    .map(c => `${c.name}${c.subclass ? ' (' + c.subclass + ')' : ''} ${c.level}`).join(' / '), 9);
  setText('Background', s.background, 9);
  setText('Race ', s.race, 9);
  const ALIGN_NAMES = {
    LG: 'Lawful Good', NG: 'Neutral Good', CG: 'Chaotic Good',
    LN: 'Lawful Neutral', TN: 'True Neutral', CN: 'Chaotic Neutral',
    LE: 'Lawful Evil', NE: 'Neutral Evil', CE: 'Chaotic Evil',
  };
  setText('Alignment', ALIGN_NAMES[s.alignment] ?? s.alignment ?? '', 9);
  setText('XP', s.xp || '', 9);
  setText('PlayerName', s.playerName ?? '', 9);

  for (const a of ABILITY_IDS) {
    const [scoreField, modField] = ABILITY_FIELDS[a];
    setText(scoreField, eff[a]);
    setText(modField, fmtMod(calcMod(eff[a])));
  }
  setText('ProfBonus', fmtMod(pb));
  if (s.inspiration) setText('Inspiration', '1');

  for (const a of ABILITY_IDS) {
    const prof = (s.saveProficiencies ?? []).includes(a);
    setText(SAVE_FIELDS[a], fmtMod(calcMod(eff[a]) + (prof ? pb : 0)));
    if (prof) check(SAVE_BOXES[a]);
  }

  for (const sk of SKILL_DEFS) {
    const prof   = (s.skillProficiencies ?? []).includes(sk.id);
    const expert = (s.skillExpertise ?? []).includes(sk.id);
    setText(SKILL_FIELDS[sk.id], fmtMod(calcSkillBonus(calcMod(eff[sk.attr]), prof, expert, pb)));
    if (prof || expert) check(SKILL_BOXES[sk.id]);
  }
  const percProf = (s.skillProficiencies ?? []).includes('perception');
  const percExp  = (s.skillExpertise ?? []).includes('perception');
  setText('Passive', 10 + calcSkillBonus(calcMod(eff.wis), percProf, percExp, pb));

  setText('AC', s.ac);
  setText('Initiative', fmtMod(effectiveInitiative(s)));
  setText('Speed', effectiveSpeed(s));
  setText('HPMax', s.maxHP);
  setText('HPCurrent', s.currHP);
  setText('HPTemp', s.tempHP || '');
  setText('HDTotal', hitDiceSummary(s.classes));
  setText('HD', s.hitDiceLeft ?? '');

  // Waffen (max. 3 aus angelegter Ausrüstung), Schadenstyp ausgeschrieben
  const weapons = [];
  const seen = new Set();
  for (const it of s.items ?? []) {
    if (!it.equipped) continue;
    const lib = repo.findItem(it.name);
    if (!lib?.dmg1 || seen.has(lib.name)) continue;
    seen.add(lib.name);
    const wa = weaponAttack(s, lib);
    const dmgType = DMG_WORDS[lib.dmgType] ?? lib.dmgType ?? '';
    weapons.push({ name: lib.name, atk: fmtMod(wa.atkBonus),
      dmg: `${lib.dmg1}${wa.dmgMod ? fmtMod(wa.dmgMod) : ''} ${dmgType}`.trim() });
  }
  const wpnFields = [
    ['Wpn Name', 'Wpn1 AtkBonus', 'Wpn1 Damage'],
    ['Wpn Name 2', 'Wpn2 AtkBonus ', 'Wpn2 Damage '],
    ['Wpn Name 3', 'Wpn3 AtkBonus  ', 'Wpn3 Damage '],
  ];
  weapons.slice(0, 3).forEach((w, i) => {
    setText(wpnFields[i][0], w.name, 8);
    setText(wpnFields[i][1], w.atk, 8);
    setText(wpnFields[i][2], w.dmg, 8);
  });

  // Kurzliste der Angriffs-/Schadenszauber unter den Waffenzeilen
  const spellLines = (s.spells ?? [])
    .map(sp => ({ sp, lib: repo.findSpell(sp.name) }))
    .filter(x => x.lib?.damage || x.lib?.attackRoll)
    .slice(0, 6)
    .map(x => {
      const bits = [x.sp.name];
      if (x.lib.damage) bits.push(x.lib.damage);
      if (x.lib.saveType) bits.push(x.lib.saveType.toUpperCase() + '-Save');
      return bits.join(' · ');
    });
  setText('AttacksSpellcasting', spellLines.join('\n'), 8);

  setText('Equipment', (s.items ?? [])
    .map(it => `${it.name}${(it.qty ?? 1) > 1 ? ' ×' + it.qty : ''}${it.equipped ? ' (E)' : ''}`)
    .join(', '), 8);
  for (const c of ['cp', 'sp', 'ep', 'gp', 'pp']) {
    setText(c.toUpperCase(), s.currency?.[c] || '');
  }

  const blocks = s.descriptionBlocks ?? [];
  const blockText = idPart => blocks.find(b => b.id.includes(idPart))?.content ?? '';
  setText('PersonalityTraits ', blockText('personality'), 8);
  setText('Ideals', '', 8);
  setText('Bonds', '', 8);
  setText('Flaws', '', 8);

  const featureParts = [];
  for (const c of s.classes ?? []) {
    if (c.subclass) featureParts.push(`${c.name}: ${c.subclass}`);
  }
  if (s.feats?.length) featureParts.push('Feats: ' + s.feats.join(', '));
  const featureSection = (s.sections ?? []).find(x => /merkmal|feature/i.test(x.title));
  if (featureSection?.content) featureParts.push(featureSection.content);
  setText('Features and Traits', featureParts.join('\n'), 8);

  // "Other Proficiencies & Languages": tatsächliche andere Übungen
  // (Rüstung/Waffen/Werkzeuge) + Sprachen. Fertigkeiten stehen bereits
  // als Häkchen im Skills-Block und gehören hier NICHT hin.
  const profParts = [];
  if (s.otherProficiencies) profParts.push(s.otherProficiencies);
  if (s.languages) profParts.push(t('desc.languages') + ': ' + s.languages);
  setText('ProficienciesLang', profParts.join('\n'), 8);

  // ════ SEITE 2: Beschreibung ══════════════════════════════

  setText('CharacterName 2', s.name);
  // Aussehen-Details (Age/Height/… gibt es als eigene Felder auf Seite 2)
  setText('Age', s.age ?? '', 9);
  setText('Height', s.height ?? '', 9);
  setText('Weight', s.weight ?? '', 9);
  setText('Eyes', s.eyes ?? '', 9);
  setText('Skin', s.skin ?? '', 9);
  setText('Hair', s.hair ?? '', 9);
  // Aussehen-Freitext + Hintergrundgeschichte
  const appearance = blockText('appearance');
  setText('Backstory',
    (appearance ? appearance + '\n\n' : '') + blockText('backstory'), 9);
  // Talente im Detail (Name + Kurzbeschreibung aus der Bibliothek)
  const featDetails = (s.feats ?? []).map(name => {
    const lib = repo.findFeat(name);
    return lib?.description ? `${name}: ${lib.description.slice(0, 220)}` : name;
  });
  setText('Feat+Traits', featDetails.join('\n\n'), 9);
  setText('Allies', s.allies ?? '', 9);
  setText('Treasure', s.treasure ?? '', 9);

  // ════ SEITE 3: Zauberbogen ═══════════════════════════════

  const casterClasses = (s.classes ?? [])
    .map(c => ({ c, data: repo.getClass(c.name) }))
    .filter(x => x.data?.spellAbility);

  if (casterClasses.length && (s.spells ?? []).length) {
    const first = casterClasses[0];
    const ability = first.data.spellAbility;
    setText('Spellcasting Class 2', casterClasses.map(x => x.c.name).join(' / '), 10);
    setText('SpellcastingAbility 2', ability.toUpperCase());
    setText('SpellSaveDC  2', 8 + pb + calcMod(eff[ability])); // Feldname mit 2 Leerzeichen!
    setText('SpellAtkBonus 2', fmtMod(pb + calcMod(eff[ability])));

    // Slots pro Grad (inkl. Warlock-Pakt-Slots auf ihrem Grad)
    const { slots, pact } = calcSpellSlots(s.classes);
    const used = s.spellSlotsUsed ?? [];
    for (let lv = 1; lv <= 9; lv++) {
      let total = slots[lv - 1] ?? 0;
      if (pact && pact.level === lv) total += pact.count;
      if (!total) continue;
      setText(slotField('SlotsTotal', lv), total);
      setText(slotField('SlotsRemaining', lv), Math.max(0, total - (used[lv - 1] ?? 0)));
    }

    // Zauber in die Zeilen ihres Grades, Vorbereitet-Häkchen setzen
    const byLevel = {};
    for (const sp of s.spells ?? []) (byLevel[sp.level ?? 0] ??= []).push(sp);
    for (const [lv, list] of Object.entries(byLevel)) {
      const lines = SPELL_LINES[lv] ?? [];
      list.sort((a, b) => a.name.localeCompare(b.name));
      list.slice(0, lines.length).forEach((sp, i) => {
        setText(lines[i], sp.name, 9);
        if (sp.prepared && PREPARED_BOX[lines[i]]) check(PREPARED_BOX[lines[i]]);
      });
    }
  }

  // == Charakterbild → "CHARACTER IMAGE"-Bereich (Seite 2, Appearance) ==
  // Das Porträt liegt als DataURL am Charakter (Canvas-Export, JPEG;
  // ältere Stände evtl. PNG). WICHTIG: Das Bild wird DIREKT in den
  // Seiteninhalt gezeichnet statt per setImage in das Button-Feld -
  // das gesetzte NeedAppearances-Flag (nötig für die Modifikator-
  // Ovale) lässt Viewer die Button-Darstellung neu generieren und
  // würde ein Feld-Bild wieder löschen (mit pdfium verifiziert).
  // Gezeichneter Seiteninhalt bleibt in jedem Viewer und im Druck.
  if (typeof s.portrait === 'string' && s.portrait.startsWith('data:image/')) {
    try {
      const [head, b64] = s.portrait.split(',');
      const bin = atob(b64);
      const imgBytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) imgBytes[i] = bin.charCodeAt(i);
      const img = head.includes('image/png')
        ? await doc.embedPng(imgBytes)
        : await doc.embedJpg(imgBytes);
      // Zielrechteck vom Formularfeld übernehmen (liegt auf Seite 2)
      const widget = form.getButton('CHARACTER IMAGE').acroField.getWidgets()[0];
      const rect   = widget.getRectangle();
      const pages  = doc.getPages();
      const page   = pages.find(p => p.ref === widget.P()) ?? pages[1];
      // "contain": Seitenverhältnis erhalten, zentriert einpassen
      const fit = Math.min(rect.width / img.width, rect.height / img.height);
      const w = img.width * fit, h = img.height * fit;
      page.drawImage(img, {
        x: rect.x + (rect.width  - w) / 2,
        y: rect.y + (rect.height - h) / 2,
        width: w, height: h,
      });
    } catch (e) {
      // Bild-Einbettung darf den Export nie verhindern
      console.warn('Porträt konnte nicht in den Bogen übernommen werden:', e);
    }
  }

  // == Speichern & Download ==
  // NeedAppearances erzwingt, dass Viewer die Feld-Darstellungen neu
  // generieren, ohne das bleiben manche Felder (z. B. die kleinen
  // Modifikator-Ovale) in strengen Viewern leer.
  try { form.acroForm.dict.set(window.PDFLib.PDFName.of('NeedAppearances'), window.PDFLib.PDFBool.True); } catch {}
  const out  = await doc.save();
  const blob = new Blob([out], { type: 'application/pdf' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = (s.name || 'character').toLowerCase().replace(/\s+/g, '_') + '_sheet.pdf';
  a.click();
  URL.revokeObjectURL(url);
}
