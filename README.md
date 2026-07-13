# D&D 5e Studio

Lokaler, framework-freier Charaktereditor und -generator fuer Dungeons & Dragons 5e (Editionen 2014 und 2024) mit Datenanbindung an die 5etools-Mirror-Repositories. Die App laeuft vollstaendig lokal auf einem Node.js-Server, im Kern ohne npm-Abhaengigkeiten; die einzige Fremdbibliothek ist eine gebuendelte pdf-lib fuer den Bogen-Export.

Dieses Dokument ist die Entwickler-Dokumentation: Architektur, Funktionsreferenz der Module, Datenpipeline und Erweiterungspunkte.

## Schnellstart

```bash
node server.js          # startet auf http://localhost:8420
node tools/update.js    # optional: vollstaendige Daten von GitHub laden
node tools/test.mjs     # Funktionstest-Suite (125 Assertions) gegen die Packs
```

Windows-Alternativen im Projektordner: `DnD5e-Studio.exe` startet Server und Browser und beendet beim Schliessen des Fensters garantiert auch den Node-Prozess (Job-Objekt mit KILL_ON_JOB_CLOSE, Quellcode `tools/launcher.c`). `Start.vbs` startet unsichtbar, `Start.bat` sichtbar mit Logs, `Stop.vbs` beendet laufende Server.

Ohne Update laeuft die App mit SRD-Seed-Daten. `GET /api/update` (oder der Button in den Einstellungen) laedt alle Buecher, Klassen, Voelker, Zauber, Items, Hintergruende, Tierformen und Talente und legt sie als Packs unter `public/data/packs/` ab.

## Projektstruktur

```
dnd5e-studio/
    server.js                     HTTP-Server (Port 8420, /api/update, /api/shutdown)
    tools/
        updater.js                Datenpipeline: GitHub -> normalisierte Packs
        update.js                 CLI-Wrapper fuer den Updater
        test.mjs                  Funktionstest-Suite (Node, Browser-Stubs)
        launcher.c                Windows-Launcher (MinGW-Crosscompile)
    public/
        index.html                Einstiegspunkt, laedt src/main.js als ES-Modul
        styles/app.css            Gesamtes Styling inkl. Hell/Dunkel-Variablen
        vendor/pdf-lib.min.js     Gebuendelte pdf-lib
        assets/character-sheet.pdf   Offizieller ausfuellbarer WotC-Bogen (3 Seiten)
        data/seed/                Mitgelieferte SRD-Minimaldaten
        data/packs/               Vom Updater erzeugte Volldaten
        src/core/                 EventBus, Store, DataRepository, i18n, theme
        src/rules/                Regellogik ohne DOM
        src/components/           Ein Panel pro Tab plus Shell und Dialoge
        src/utils/pdfExport.js    Export auf den offiziellen Bogen
```

## Architektur und Datenfluss

Der Datenfluss ist unidirektional: Eingaben in den Panels rufen `store.update(patch)` auf, der Store persistiert und publiziert `CHAR_CHANGED` mit der Liste geaenderter Felder, und jedes Panel rendert nur dann neu, wenn eines seiner relevanten Felder (eigene `rel`-Liste) betroffen ist. Regelwissen liegt ausschliesslich in `src/rules/` (reine Funktionen ohne DOM), Datenzugriff ausschliesslich im `DataRepository`.

### EventBus (`core/EventBus.js`)

`bus.on(event, cb)` registriert (liefert eine Abmeldefunktion), `bus.emit(event, payload)` publiziert. Events in `EV`:

| Event | Bedeutung |
|---|---|
| `CHAR_CHANGED` | Charakterfeld geaendert; Payload `{ changed: [feldnamen] }`, `'*'` steht fuer alles |
| `CHAR_LOADED` | Anderer Charakter aktiv (Wechsel, Neu, Import) |
| `DATA_READY` | Packs oder Seed geladen, Bibliotheken nutzbar |
| `LANG_CHANGED` | Sprache umgestellt |
| `SOURCES_CHANGED` | Quellenbuecher oder Regelwerk umgestellt |
| `ROLL_RESULT` | Wurfergebnis fuer die Ergebnisanzeige |
| `TOAST` | Kurzmeldung anzeigen |

### Store (`core/Store.js`)

Verwaltet das Multi-Charakter-Roster in `localStorage` und den aktiven Charakterzustand. Neue Charaktere werden erst bei der ersten inhaltlichen Aenderung ins Roster geschrieben (verhindert leere Karteileichen).

| Funktion | Beschreibung |
|---|---|
| `blankCharacter()` | Vollstaendiges Default-Schema; jede Schema-Erweiterung wird hier mit Default eingetragen, `replace()` und `loadCharacter()` migrieren Altbestaende darueber |
| `get()` / `field(name)` | Zustand lesen (Kopie bzw. Einzelfeld) |
| `update(patch)` | Felder setzen, persistieren, `CHAR_CHANGED` publizieren |
| `quietUpdate(patch)` | Wie `update`, aber ohne Event (Fokus-Erhalt bei Texteingaben) |
| `updateClass(idx, patch)` / `addClass()` / `removeClass(idx)` | Klassenliste pflegen |
| `totalLevel()` | Summe aller Klassenstufen |
| `newCharacter(ruleset)` | Frischer Charakter; hinterlegt das Regelwerk auch global |
| `loadCharacter(id)` / `deleteCharacter(id)` / `listCharacters()` / `activeId()` | Rosterverwaltung; Laden publiziert `CHAR_LOADED` und synchronisiert das Regelwerk |
| `replace(character)` | Ganzen Charakter ersetzen (Generator, Import), mit Schema-Migration |
| `exportJson()` / `importJson(json)` | Einzelcharakter als JSON |
| `longRest()` | TP voll, halbe Trefferwuerfel zurueck, alle Slots, Pakt-Slots, Arkana, Wildgestalt |
| `shortRest()` | Regelwerk-abhaengig: Pakt-Slots immer; Wildgestalt 2014 vollstaendig, 2024 plus eine Nutzung (Maximum 2); Arkana bleiben verbraucht |
| `undo()` | Letzte Aenderung zuruecknehmen |

Wichtige Schema-Felder: `ruleset` (`'phb14' | 'phb24'`), `classes` (`[{name, level, subclass}]`), `feats` parallel zu `featLevels` (Stufe der Wahl; Duplikate fuer wiederholbare Talente erlaubt), `raceBonus/bgBonus/featBonus` (additive Attributs-Boni) mit `raceChoice/bgChoice` (gewaehlte Verteilung frei waehlbarer Boni), `arcanumUsed` (verbrauchte Mystische Arkana), `acManual` (unterdrueckt die automatische RK-Berechnung), `wildshape` (aktive Tierform).

### DataRepository (`core/DataRepository.js`)

Singleton `repo`. `load()` laedt Packs mit Seed-Fallback und publiziert `DATA_READY`.

| Funktion | Beschreibung |
|---|---|
| `bySource(list)` | Filtert nach aktivierten Quellenbuechern |
| `dedupeByName(list)` | Regelwerk-Dedupe: Rangfolge Homebrew, dann Editions-Familie des aktiven Regelwerks (2014: PHB/MM/DMG, 2024: XPHB/XMM/XDMG), dann die andere Familie; faellt automatisch auf die andere Edition zurueck, wenn ein Buch deaktiviert ist |
| `getClasses()` / `getRaces()` / `getBackgrounds()` / `getSpells()` / `getFeats()` / `getBeasts()` / `getItems()` | Gefilterte (und ausser bei Items deduplizierte) Sichten |
| `getClass(name)` | Klasse in der Fassung der aktiven Edition, Unterklassen ebenfalls dedupliziert; Fallback auf ungefilterte Liste, damit gespeicherte Charaktere ihre Klasse auch bei deaktivierter Quelle aufloesen |
| `findSpell/findItem/findFeat/findBeast(name)` | Namensaufloesung, editionsbewusst mit Fallback-Kaskade |
| `findSpellCI(name)` | Case-insensitive Zaubersuche (Unterklassen-Daten sind kleingeschrieben) |
| `getSpellsForClasses(classes, featNames)` | Waehlbare Zauber: Klassenlisten, exklusive Unterklassen-Zauber (`spells.extra`), Feat-gewaehrte Zauber (konkrete Namen und Kriterien `{levels, schools, classNames}`), Homebrew |
| `subclassAutoSpells(className, subclassName)` | Automatisch vorbereitete Unterklassen-Zauber als `{klassenstufe: [namen]}` |
| `addHomebrew(kind, entry)` / `removeHomebrew(kind, name)` / `getHomebrew()` | Homebrew, an den aktiven Charakter gebunden (`charId`); Alt-Eintraege ohne Bindung bleiben global; `refreshHomebrew()` baut die Sicht beim Charakterwechsel neu |
| `setRuleset(rs)` / `setSourceEnabled(src, on)` / `isSourceEnabled(src)` / `allSources()` / `setAdvanced(on)` | Regelwerk- und Quellensteuerung, publizieren `SOURCES_CHANGED` |

### i18n und Theme

`t('block.key')` liefert den Text der aktiven Sprache (de/en, `setLang`/`getLang`, `LANGS` als `[{id, label}]`). Spielbegriffe wie Zauber-, Item- und Sprachnamen bleiben englisch, konsistent zu den Daten und dem PDF-Bogen. `theme.js` verwaltet sechs warme Farb-Presets mit getrennten Hell- und Dunkel-Varianten (alle 24 Kombinationen numerisch auf WCAG AA geprueft); `applyTheme` loest den effektiven Modus auf (bei "System" mit Live-Wechsel per matchMedia) und setzt die Variante als Inline-Variablen.

## Funktionsreferenz Regellogik (`src/rules/`)

### calculations.js

| Funktion | Beschreibung |
|---|---|
| `calcMod(score)` | Attributsmodifikator, `floor((score - 10) / 2)` |
| `calcProfBonus(totalLevel)` | Uebungsbonus 2 bis 6 |
| `fmtMod(n)` | Vorzeichenformat (`+3`, `-1`, `+0`) |
| `calcSkillBonus(mod, prof, expertise, pb)` | Fertigkeitsbonus, Expertise verdoppelt den Uebungsbonus |
| `SKILL_DEFS` / `ABILITY_IDS` | 18 Fertigkeiten mit Attributszuordnung; Attributs-IDs |
| `effectiveAbilities(state)` | Effektivwerte `{scores, sources}` aus Basis plus Volks-, Hintergrund-, Talent-Boni und Item-Festwerten; in Wildgestalt ersetzen die Koerperwerte der Tierform STR/DEX/KON, Geisteswerte bleiben |
| `effMod(state, abilityId)` | Kurzform fuer `calcMod(effectiveAbilities(...).scores[a])` |
| `calcMaxHP(state)` | Durchschnittsregel (Stufe 1 Maximum, danach Durchschnitt) ueber alle Klassen plus KON je Stufe plus Talent-Effekte (`hpPerLevel`, `hpFlat`) |
| `calcAC(state)` | Ruestungsklasse: 10 plus DEX ohne Ruestung; leichte/mittlere/schwere Ruestung mit DEX-Deckel laut Item; Schild additiv; magischer `bonusAc` einer Ruestung zaehlt zur Ruestung selbst (keine Doppelzaehlung mit `itemBonuses`); nicht ausgeruestete Items zaehlen nicht |
| `itemBonuses(state)` | Freie Boni `{ac, save, spellDc, spellAtk}` ausgeruesteter Nicht-Ruestungs-Items (z. B. Ring of Protection); pausiert in Wildgestalt |
| `featEffects(state)` | Summierte Talent-Effekte `{speed, initiative, initiativeProf, hpPerLevel, hpFlat, carryFactor}` (editionsbewusst ueber `repo.findFeat`) |
| `effectiveSpeed(state)` / `effectiveInitiative(state)` | Geschwindigkeit bzw. Initiative inkl. Talent-Effekten |
| `carryCapacity(state)` | Traglast `STR * 15`, mal Talent-Faktor |
| `weaponAttack(state, libItem)` | `{atkBonus, dmgMod, ranged}`: Fernkampf nimmt DEX, Finesse das Maximum aus STR/DEX, sonst STR; plus Uebungsbonus und feste magische Boni des Items |
| `calcSpellSlots(classes)` | `{slots[9], pact, casterLevel}` nach Multiclass-Tabelle. Rundung: Einzelklasse entspricht der eigenen Klassentabelle (Halbcaster ab Stufe 2 aufgerundet, Drittelcaster ab 3), erst die Multiclass-Regel rundet ab. Warlock liefert `pact = {count, level, arcanum}` mit Pakt-Slots (1/2/3/4 Slots, Grad bis 5) und Mystischen Arkana (Grad 6/7/8/9 ab Stufe 11/13/15/17) |
| `primarySpellAbility(classes)` | Zauberattribut der ersten zaubernden Klasse |
| `hitDiceSummary(classes)` | Text wie `3W10 + 2W6` |

### dice.js

| Funktion | Beschreibung |
|---|---|
| `roll(sides, count)` | Array von Einzelwuerfen; `sides < 1` liefert Nullen |
| `d20(mod, mode)` | `{raw, first, second, total, isCrit, isFumble}`; `mode` `'adv'`/`'dis'`/`'normal'` |
| `parseAndRoll(formel)` | Parser fuer `NdS`, `khX`/`klX` (keep highest/lowest), `+`/`-` Boni; ungueltig ergibt `null` |
| `rollFormula(formel)` | Wie `parseAndRoll`, publiziert zusaetzlich `ROLL_RESULT` |
| `rollAbility/rollSkill/rollSave/rollInitiative(...)` | Komfort-Wuerfe mit korrekten Boni (Saves inkl. Item-Boni), publizieren `ROLL_RESULT` |
| `describeParts(parts)` | Lesbare Wurfbeschreibung |

### bonuses.js

| Funktion | Beschreibung |
|---|---|
| `raceEntry(name)` / `bgEntry(name)` | Rohdaten-Eintrag aus dem Repo |
| `combinedBonus(entry, choice)` | Feste Boni plus gewaehlte Variante; `choice = {variant, picks}` mit `picks` als Index-zu-Attribut je Gewicht; Dublettensperre verhindert doppelte Attribute |
| `raceBonusFor(name, choice)` / `bgBonusFor(name, choice)` | Bequeme Huellen um `combinedBonus` |
| `featBonusFor(featNames)` | Summierte feste Attributs-Boni aller Talente; Duplikate (wiederholbare Talente) zaehlen mehrfach |

### progression.js und wildshape.js

`asiLevels(className)` liefert die ASI-Stufen (Kaempfer zusaetzlich 6/14, Schurke 10), `subclassEntryLevel(className, ruleset)` die Unterklassen-Einstiegsstufe (2014: Kleriker/Sorcerer/Warlock 1, Druide/Magier 2, sonst 3; 2024: einheitlich 3), `ALIGNMENTS` die neun Gesinnungen.

`wildshapeLimits(classes)` liefert `{level, moon, maxCR, noFly, noSwim}` oder `null` unter Stufe 2 (CR 1/4 ab 2, 1/2 ab 4, 1 ab 8; Mond-Zirkel CR 1 bzw. Stufe/3 ab 6; Schwimmen ab 4, Fliegen ab 8). `availableForms(classes)` filtert die Tierformen des Repos entsprechend, `elementalUnlocked(classes)` schaltet Elementare fuer Mond-Druiden ab 10 frei, `crToNumber('1/4')` und `formatSpeed(speed)` sind Helfer, `druidLevel`/`isMoonDruid` lesen die Klassenliste.

## Komponenten (`src/components/`)

Jedes Panel exportiert eine `mount...`-Funktion, rendert in sein Wurzelelement und abonniert `CHAR_CHANGED` mit einer eigenen `rel`-Liste. Wichtige Panels: `CorePanel` (Identitaet, Attribute mit Boni-Aufschluesselung, Volk/Hintergrund inkl. Wahl-Dialog, Talente mit Bibliothek), `ClassesPanel` (Klassen, Unterklassen mit automatischer Zaubervergabe, Level-Up-Dialog mit TP-Wahl, ASI oder Talent und Zauberauswahl), `CombatPanel` (TP, RK, Angriffe, Rasten, Todesrettungswuerfe), `SpellsPanel` (Statistiken, Slots inkl. Pakt und Arkana, bekannte Zauber, Bibliothek mit Klassen-, Grad-, Schul-Filter), `InventoryPanel`, `WildshapePanel`, `DicePanel`, `GeneratorPanel` (regelkonformer Zufallscharakter), `DescriptionPanel` (Bogen-Seite 2 inkl. Portraet und Comboboxen), `SettingsPanel`, `CharacterSelect` (Roster und Regelwerk-Wahl).

## Datenpipeline (`tools/updater.js`)

Quellen: `5etools-mirror-3/5etools-src` (Regeln) und `5etools-mirror-3/5etools-img` (Tierbilder). Wichtige Normalisierungen:

* Klassen: beide Editionen bleiben im Pack (Dedupe je Name und Quelle), ebenso Unterklassen (Kopie mit `additionalSpells` bevorzugt). Felder: `spellcasting`, `spellAbility`, `casterProgression`, `saves`, `skillChoices`, `hitDie`.
* Unterklassen-Zauber: `prepared`/`known` mit Klassenstufen-Schluesseln wird zu `auto` (automatische Vergabe), aber nur bei genau einer unbenannten Variante; benannte Varianten (Land-Zirkel) und `expanded` (Warlock) landen nur in `extra` (waehlbare Bibliothek).
* Talente: `parseFeatEffects` liest mechanische Boni aus dem Regeltext (Geschwindigkeit nur bei Satzanfang, damit bedingte Boni wie Charger 2024 nicht faelschlich permanent werden; Initiative fest oder als Uebungsbonus-Flag; TP fest und je Stufe in beiden Schreibweisen). `parseFeatSpells` liest `additionalSpells` mit Namen und `choose`-Ausdruecken (`level=2|school=E;N`). `repeatable` markiert mehrfach waehlbare Talente.
* Voelker und Hintergruende: feste Boni getrennt von `abilityChoose`-Varianten (klassisches und gewichtetes 2024er-Format vereinheitlicht).
* Zauber: Schule, Klassenlisten, Schadens- und Heilformeln, Rettungswurf-Typ.

## PDF-Export (`utils/pdfExport.js`)

Fuellt den offiziellen Bogen via pdf-lib. Wissenswert: Die Feldnamen des Bogens sind teils inkonsistent (fuehrende/doppelte Leerzeichen) und per Feld-Enumeration verifiziert. `NeedAppearances` ist gesetzt, damit strenge Viewer die Modifikator-Ovale fuellen; weil Viewer dadurch Button-Darstellungen neu generieren, wird das Portraet nicht ins Bildfeld gesetzt, sondern direkt in den Seiteninhalt gezeichnet (Position zur Laufzeit aus dem Feld "CHARACTER IMAGE" gelesen, seitenverhaeltnis-treu eingepasst). Fuer Tests in Node akzeptiert die minifizierte pdf-lib keine Buffer, nur echte Uint8Arrays.

## Tests

`node tools/test.mjs` fuehrt die Funktionstest-Suite aus: 125 Assertions ueber alle exportierten Funktionen der Kern- und Regelmodule, gegen die echten Datenpacks, mit gestubbten Browser-Globals. Enthalten sind u. a. AC-Matrix, TP-Formeln mit Talenten, Slot-Progressionen aller Castertypen inkl. Pakt und Arkana, Rasten je Regelwerk, Editions-Dedupe mit Quellen-Fallback, Homebrew-Bindung, Wuerfelstatistik und ein i18n-Abdeckungsscan, der jeden in den Komponenten verwendeten Textschluessel in beiden Sprachen prueft. PDF-Aenderungen werden zusaetzlich per pypdfium2-Rendering verifiziert (`init_forms()` und `may_draw_forms=True`).

## Persistenz (localStorage)

| Schluessel | Inhalt |
|---|---|
| `dnd5e_studio_roster` | Alle Charaktere plus aktive ID |
| `dnd5e_ruleset` | Aktives Regelwerk |
| `dnd5e_studio_homebrew` | Homebrew-Eintraege (mit `charId`-Bindung) |
| `dnd5e_sources` | Aktivierte Quellenbuecher |
| `dnd5e_theme` | Modus, Preset, eigene Farben, Schrift |
| `dnd5e_advanced` | Erweiterter Modus (Sidekick-Klassen) |
| `dnd5e_wildshape_favs` | Favorisierte Wildgestalt-Formen |
| `dnd5e_show_electrum` | Elektrum in der Waehrung anzeigen |

## Typische Erweiterungen

Neues Charakterfeld: Default in `blankCharacter()`, Eingabe im Panel (Texteingaben mit `quietUpdate`), Feld in die `rel`-Liste des Panels, bei Bedarf PDF-Mapping und i18n. Neuer Datentyp aus 5etools: Fetch und Normalisierung im Updater, Getter im Repository (mit `bySource` und bei Editions-Kollisionen `dedupeByName`), Panel oder Bibliothek. Neuer Talent-Effekt: Muster in `parseFeatEffects` (auf bedingte Formulierungen achten), Summierung in `featEffects()`, Verrechnung an der Zielstelle, Korpus-Scan und Testfall in `tools/test.mjs`.

## Bekannte Grenzen

Talent-Effekte werden textbasiert erkannt und bewusst konservativ verrechnet; bedingte Boni (z. B. RK nur mit getragener Ruestung) werden nicht automatisch angewandt. Der Generator wuerfelt zufallsbasiert innerhalb der Regeln und ersetzt keine optimierten Builds. Die EXE setzt eine Node.js-Installation im PATH voraus.
