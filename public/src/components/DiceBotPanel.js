// ============================================================
// components/DiceBotPanel.js, Würfelbot
// ------------------------------------------------------------
// Zentraler Würfelbereich. Alle Automatik-Würfe (Attribute,
// Fertigkeiten, Rettungswürfe) holen ihre Modifikatoren selbst
// aus dem Charakter, der Nutzer klickt nur den Wurf an.
// Zusätzlich: Vorteil/Nachteil-Modus, freie Formeln, Verlauf.
// ============================================================
import { store }   from '../core/Store.js';
import { bus, EV } from '../core/EventBus.js';
import { t }       from '../core/i18n.js';
import { calcMod, calcProfBonus, calcSkillBonus, fmtMod, SKILL_DEFS, ABILITY_IDS, effectiveAbilities } from '../rules/calculations.js';
import { rollAbility, rollSkill, rollSave, rollInitiative, rollFormula, roll } from '../rules/dice.js';
import { askRollMode } from './RollPrompt.js';

let history = [];

export function mountDiceBot() {
  render();
  bus.on(EV.LANG_CHANGED, render);
  bus.on(EV.CHAR_CHANGED, ({ changed }) => {
    // Modifikator-Anzeigen aktualisieren, wenn sich relevante Werte ändern
    const rel = [...ABILITY_IDS, 'classes', 'items', 'wildshape', 'skillProficiencies', 'skillExpertise', 'saveProficiencies', '*'];
    if (changed.some(c => rel.includes(c))) render();
  });

  // Ergebnisse aller Würfe landen im Verlauf + in der Anzeige
  bus.on(EV.ROLL_RESULT, res => {
    history.unshift(res);
    if (history.length > 15) history.pop();
    showResult(res);
    renderHistory();
  });
}

function render() {
  const el = document.getElementById('tab-dice');
  const s  = store.get();
  const eff = effectiveAbilities(s).scores;
  const pb = calcProfBonus(store.totalLevel());

  const skillMod = id => {
    const def = SKILL_DEFS.find(x => x.id === id);
    return calcSkillBonus(calcMod(eff[def.attr]),
      s.skillProficiencies.includes(id), s.skillExpertise.includes(id), pb);
  };
  const saveMod = a => calcMod(eff[a]) + (s.saveProficiencies.includes(a) ? pb : 0);

  el.innerHTML = `
  <div class="panel dice-result">
    <div class="dice-result__num" id="dbNum">-</div>
    <div class="dice-result__detail" id="dbDetail">${t('dice.startHint')}</div>
  </div>

  <div class="panel">
    <div class="panel__title">${t('dice.quick')}</div>
    <div class="dice-grid">
      ${[4, 6, 8, 10, 12, 20, 100].map(d =>
        `<button class="btn" data-quick="${d}">W${d}</button>`).join('')}
      <button class="btn btn--gold" id="dbInit">⚡ ${t('abilities.initiative')} ${fmtMod(calcMod(eff.dex))}</button>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <input type="text" id="dbFormula" placeholder="${t('dice.formula')}" style="flex:1">
      <button class="btn btn--primary" id="dbRollFormula">${t('dice.roll')}</button>
    </div>
  </div>

  <div class="panel-row">
    <div class="panel">
      <div class="panel__title">${t('dice.ability')} / ${t('dice.saves')}</div>
      ${ABILITY_IDS.map(a => `
        <div class="list-row">
          <span class="row-grow">${t('abilities.' + a)}</span>
          <button class="btn btn--sm" data-roll-ability="${a}">Check ${fmtMod(calcMod(eff[a]))}</button>
          <button class="btn btn--sm btn--gold" data-roll-save="${a}">Save ${fmtMod(saveMod(a))}</button>
        </div>`).join('')}
    </div>

    <div class="panel">
      <div class="panel__title">${t('dice.skillRolls')}</div>
      ${SKILL_DEFS.map(sk => `
        <div class="list-row list-row--click" data-roll-skill="${sk.id}">
          <span class="row-mod">${fmtMod(skillMod(sk.id))}</span>
          <span class="row-grow">${t('skills.' + sk.id)}</span>
        </div>`).join('')}
    </div>
  </div>

  <div class="panel">
    <div class="panel__title">${t('dice.history')}
      <button class="btn btn--sm" id="dbClear">${t('dice.clear')}</button>
    </div>
    <div id="dbHistory"></div>
  </div>`;

  bindEvents(el);
  renderHistory();
}

function bindEvents(el) {
  // Schnellwürfe (einzelner Würfel, kein Modifikator)
  el.querySelectorAll('[data-quick]').forEach(b => {
    b.onclick = () => {
      const sides = +b.dataset.quick;
      const r = roll(sides)[0];
      bus.emit(EV.ROLL_RESULT, {
        total: r, label: `W${sides}`, detail: `W${sides} → ${r}`,
        special: sides === 20 && r === 20 ? 'crit' : sides === 20 && r === 1 ? 'fail' : '',
      });
    };
  });

  // Automatik-Würfe: erst Abfrage (Vorteil/Normal/Nachteil), dann würfeln
  el.querySelectorAll('[data-roll-ability]').forEach(b => {
    b.onclick = async () => {
      const mode = await askRollMode(t('abilities.' + b.dataset.rollAbility));
      if (mode) rollAbility(b.dataset.rollAbility, mode);
    };
  });
  el.querySelectorAll('[data-roll-save]').forEach(b => {
    b.onclick = async () => {
      const mode = await askRollMode(t('abilities.' + b.dataset.rollSave) + ' Save');
      if (mode) rollSave(b.dataset.rollSave, mode);
    };
  });
  el.querySelectorAll('[data-roll-skill]').forEach(row => {
    row.onclick = async () => {
      const mode = await askRollMode(t('skills.' + row.dataset.rollSkill));
      if (mode) rollSkill(row.dataset.rollSkill, mode);
    };
  });
  el.querySelector('#dbInit').onclick = async () => {
    const mode = await askRollMode(t('abilities.initiative'));
    if (mode) rollInitiative(mode);
  };

  // Freie Formel (Enter oder Button)
  const rollFromInput = () => {
    const formula = el.querySelector('#dbFormula').value.trim();
    if (formula && !rollFormula(formula)) {
      bus.emit(EV.TOAST, { message: '✗ ' + formula });
    }
  };
  el.querySelector('#dbRollFormula').onclick = rollFromInput;
  el.querySelector('#dbFormula').onkeydown = e => { if (e.key === 'Enter') rollFromInput(); };

  el.querySelector('#dbClear').onclick = () => { history = []; renderHistory(); };
}

function showResult({ total, detail, special }) {
  const num = document.getElementById('dbNum');
  const det = document.getElementById('dbDetail');
  if (num) {
    num.textContent = total;
    num.className = 'dice-result__num' + (special ? ' ' + special : '');
  }
  if (det) {
    // NAT 20 / NAT 1 als deutliches Badge hinter der Detailzeile
    const badge = special === 'crit'
      ? ' <span class="roll-nat roll-nat--20">NAT 20</span>'
      : special === 'fail'
      ? ' <span class="roll-nat roll-nat--1">NAT 1</span>' : '';
    det.innerHTML = detail + badge;
  }
}

function renderHistory() {
  const box = document.getElementById('dbHistory');
  if (!box) return;
  box.innerHTML = history.map(h => `
    <div class="history-entry">
      <span class="total ${h.special === 'crit' ? 'nat20' : h.special === 'fail' ? 'nat1' : ''}">${h.total}</span>
      <span style="color:var(--muted)">${h.detail}</span>
      ${h.special === 'crit' ? '<span class="roll-nat roll-nat--20">NAT 20</span>'
        : h.special === 'fail' ? '<span class="roll-nat roll-nat--1">NAT 1</span>' : ''}
    </div>`).join('') || `<p class="panel__hint">-</p>`;
}
