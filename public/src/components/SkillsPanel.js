// ============================================================
// components/SkillsPanel.js, skills
// ------------------------------------------------------------
// • click the circle: no proficiency → proficient → expertise → none
// • click the row: the dice bot rolls the skill check
//   automatically with the correct modifier.
// ============================================================
import { store }   from '../core/Store.js';
import { bus, EV } from '../core/EventBus.js';
import { t }       from '../core/i18n.js';
import {
  calcMod, calcProfBonus, calcSkillBonus, fmtMod, SKILL_DEFS, effectiveAbilities,
} from '../rules/calculations.js';
import { rollSkill } from '../rules/dice.js';
import { askRollMode } from './RollPrompt.js';

export function mountSkills() {
  render();
  bus.on(EV.CHAR_CHANGED, ({ changed }) => {
    const rel = ['str','dex','con','int','wis','cha','classes','items','wildshape',
                 'skillProficiencies','skillExpertise','*'];
    if (changed.some(c => rel.includes(c))) render();
  });
  bus.on(EV.LANG_CHANGED, render);
}

function render() {
  const el = document.getElementById('tab-skills');
  const s  = store.get();
  const eff = effectiveAbilities(s).scores;
  const pb = calcProfBonus(store.totalLevel());

  // local roll result at the top of the tab (in addition to the dice bot tab)
  el.innerHTML = `
  <div id="skillRollResult"></div>

  <div class="panel">
    <div class="panel__title">${t('skills.title')}</div>
    <p class="panel__hint" style="margin-bottom:8px">${t('skills.hint')}</p>
    ${SKILL_DEFS.map(sk => {
      const prof   = s.skillProficiencies.includes(sk.id);
      const expert = s.skillExpertise.includes(sk.id);
      const total  = calcSkillBonus(calcMod(eff[sk.attr]), prof, expert, pb);
      const icon   = expert ? '◎' : prof ? '⬤' : '○';
      const iconCls = expert ? 'indicator--exp' : prof ? 'indicator--prof' : 'indicator--none';
      return `
      <div class="list-row list-row--click" data-skill-roll="${sk.id}">
        <span class="indicator ${iconCls}" data-skill-cycle="${sk.id}" title="${t('skills.hint')}">${icon}</span>
        <span class="row-mod">${fmtMod(total)}</span>
        <span class="row-grow">${t('skills.' + sk.id)}</span>
        <span class="row-dim">${t('abilities.' + sk.attr).slice(0, 3).toUpperCase()}</span>
      </div>`;
    }).join('')}
  </div>`;

  // == Events ==
  // cycle the proficiency state (click on the circle)
  el.querySelectorAll('[data-skill-cycle]').forEach(ind => {
    ind.onclick = e => {
      e.stopPropagation(); // don't roll at the same time
      cycleProficiency(ind.dataset.skillCycle);
    };
  });

  // skill check (click on the row), result shown locally + in the dice bot
  el.querySelectorAll('[data-skill-roll]').forEach(row => {
    row.onclick = async () => {
      const mode = await askRollMode(t('skills.' + row.dataset.skillRoll));
      if (!mode) return;
      const r = rollSkill(row.dataset.skillRoll, mode);
      if (r) showLocalResult(row.dataset.skillRoll, r);
    };
  });
}

/** none → proficient → expertise → none */
function cycleProficiency(id) {
  const profs   = store.field('skillProficiencies');
  const experts = store.field('skillExpertise');
  const isProf = profs.includes(id), isExp = experts.includes(id);

  if (!isProf && !isExp) {
    store.update({ skillProficiencies: [...profs, id] });
  } else if (isProf && !isExp) {
    store.update({ skillExpertise: [...experts, id] });
  } else {
    store.update({
      skillProficiencies: profs.filter(p => p !== id),
      skillExpertise:     experts.filter(p => p !== id),
    });
  }
}

function showLocalResult(skillId, r) {
  const box = document.getElementById('skillRollResult');
  if (!box) return;
  const cls = r.isCrit ? 'crit' : r.isFumble ? 'fail' : 'atk';
  box.innerHTML = `
    <div class="panel">
      <div class="cast-step cast-step--${cls}">
        <span class="cast-step__label">${t('skills.' + skillId)}</span>
        <span class="cast-step__detail">W20(${r.raw})${r.second !== null ? ` [${r.first}|${r.second}]` : ''} ${fmtMod(r.total - r.raw)}</span>
        <span class="cast-step__val">${r.total}</span>
      </div>
    </div>`;
}
