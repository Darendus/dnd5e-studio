// ============================================================
// components/HeaderPanel.js, Charakterkopf
// Zeigt Name, Volk, Hintergrund + Multiclass-Zusammenfassung
// ("Paladin 5 / Warlock 1") sowie Kern-Badges.
// ============================================================
import { store }   from '../core/Store.js';
import { repo }    from '../core/DataRepository.js';
import { bus, EV } from '../core/EventBus.js';
import { t }       from '../core/i18n.js';
import { calcMod, calcProfBonus, fmtMod, effectiveAbilities, effectiveInitiative, effectiveSpeed } from '../rules/calculations.js';
import { raceBonusFor, bgBonusFor, raceEntry, bgEntry } from '../rules/bonuses.js';

export function mountHeader() {
  render();
  // Bei "leisen" Updates (Texteingabe) nicht neu rendern → Fokus bleibt erhalten
  bus.on(EV.CHAR_CHANGED, () => { if (!quiet) render(); });
  bus.on(EV.LANG_CHANGED, () => render());
  bus.on(EV.SOURCES_CHANGED, () => render());
}

function classSummary(s) {
  return s.classes.map(c => `${c.name} ${c.level}`).join(' / ') || '-';
}

function render() {
  const el = document.getElementById('panel-header');
  const s  = store.get();
  const lvl = store.totalLevel();
  const pb  = calcProfBonus(lvl);
  const eff = effectiveAbilities(s).scores;
  const passive = 10 + calcMod(eff.wis)
    + (s.skillProficiencies.includes('perception') ? pb : 0)
    + (s.skillExpertise.includes('perception') ? pb : 0);

  el.innerHTML = `
  <div class="panel">
    <div class="char-header">
      <div style="flex:1">
        <input class="char-name" id="hdName" type="text" value="${esc(s.name)}" placeholder="${t('app.name')}…">
        <div class="meta-grid">
          <div class="meta-field">
            <label>${t('tabs.classes')}</label>
            <div style="font-weight:600;padding:4px 0">${classSummary(s)} <span style="color:var(--muted);font-weight:400">(${t('classes.totalLevel')} ${lvl})</span></div>
          </div>
          <div class="meta-field">
            <label>Volk / Race</label>
            <select id="hdRace">
              <option value="">-</option>
              ${repo.getRaces().map(r => `<option ${r.name === s.race ? 'selected' : ''}>${r.name}</option>`).join('')}
            </select>
          </div>
          <div class="meta-field">
            <label>Background</label>
            <select id="hdBackground">
              <option value="">-</option>
              ${repo.getBackgrounds().map(b =>
                `<option ${b.name === s.background ? 'selected' : ''}>${b.name}</option>`).join('')}
              ${s.background && !repo.getBackgrounds().find(b => b.name === s.background)
                ? `<option selected>${esc(s.background)}</option>` : ''}
            </select>
          </div>
          <div class="meta-field">
            <label>XP</label>
            <input type="number" id="hdXP" value="${s.xp}" min="0">
          </div>
        </div>
        ${renderChoicePicker('race', raceEntry(s.race), s.raceChoice)}
        ${renderChoicePicker('bg', bgEntry(s.background), s.bgChoice)}
        <div class="badges">
          <span class="badge badge--gold">${t('abilities.profBonus')}: <b>+${pb}</b></span>
          <span class="badge badge--red ${s.inspiration ? '' : 'badge--off'}" id="hdInspiration">✦ Inspiration</span>
          <span class="badge">${t('abilities.passivePerc')}: <b>${passive}</b></span>
          <span class="badge">${t('abilities.initiative')}: <b>${fmtMod(effectiveInitiative(s))}</b></span>
          <span class="badge">${t('abilities.speed')}: <b>${effectiveSpeed(s)} ft</b></span>
        </div>
      </div>
    </div>
  </div>`;

  // Events (nach jedem Render neu binden, da innerHTML ersetzt)
  el.querySelector('#hdName').oninput        = e => quietUpdate({ name: e.target.value });
  el.querySelector('#hdRace').onchange       = e => store.update({
    race: e.target.value, raceChoice: null,
    raceBonus: raceBonusFor(e.target.value) });
  el.querySelector('#hdBackground').onchange = e => store.update({
    background: e.target.value, bgChoice: null,
    bgBonus: bgBonusFor(e.target.value) });
  el.querySelector('#hdXP').onchange         = e => store.update({ xp: +e.target.value || 0 });
  el.querySelector('#hdInspiration').onclick = () => store.update({ inspiration: !store.field('inspiration') });
  bindChoicePicker(el, 'race', raceEntry(s.race));
  bindChoicePicker(el, 'bg', bgEntry(s.background));
}

// == Attributswahl (Rasse/Hintergrund mit "choose"-Boni) =====
// Zeigt Varianten-Auswahl (z. B. "+2/+1" vs. "+1/+1/+1") und je
// Bonus ein Attribut-Dropdown. Die Wahl wird am Charakter gespeichert
// und fließt über raceBonus/bgBonus in die effektiven Werte ein.

function renderChoicePicker(kind, entry, choice) {
  const variants = entry?.abilityChoose;
  if (!variants?.length) return '';
  const vIdx = Math.min(choice?.variant ?? 0, variants.length - 1);
  const variant = variants[vIdx];
  const picks = choice?.picks ?? [];
  const complete = variant.weights.every((_, i) => picks[i]);
  return `
  <div class="choice-picker" data-choice="${kind}">
    <div class="choice-picker__head">
      <b>${kind === 'race' ? 'Volk / Race' : 'Background'}: ${t('choice.title')}</b>
      ${!complete ? `<span class="choice-picker__todo">${t('choice.todo')}</span>` : '<span class="choice-picker__done">✓</span>'}
    </div>
    ${variants.length > 1 ? `
      <div class="choice-picker__variants">
        ${variants.map((v, i) => `
          <label><input type="radio" name="${kind}Variant" value="${i}" ${i === vIdx ? 'checked' : ''}>
            ${v.weights.map(w => '+' + w).join(' / ')}</label>`).join('')}
      </div>` : ''}
    <div class="choice-picker__picks">
      ${variant.weights.map((w, i) => `
        <label class="meta-field">
          <span>+${w}</span>
          <select data-choice-pick="${i}">
            <option value="">-</option>
            ${variant.from.map(a => {
              const takenElsewhere = picks.some((p, pi) => pi !== i && p === a);
              return `<option value="${a}" ${picks[i] === a ? 'selected' : ''} ${takenElsewhere ? 'disabled' : ''}>${t('abilities.' + a)}</option>`;
            }).join('')}
          </select>
        </label>`).join('')}
    </div>
  </div>`;
}

function bindChoicePicker(el, kind, entry) {
  const box = el.querySelector(`[data-choice="${kind}"]`);
  if (!box || !entry?.abilityChoose) return;
  const apply = () => {
    const variant = +([...box.querySelectorAll(`input[name="${kind}Variant"]`)]
      .find(r => r.checked)?.value ?? 0);
    const picks = [...box.querySelectorAll('[data-choice-pick]')]
      .map(sel => sel.value || null);
    const choice = { variant, picks };
    const bonus = kind === 'race'
      ? raceBonusFor(store.field('race'), choice)
      : bgBonusFor(store.field('background'), choice);
    store.update(kind === 'race'
      ? { raceChoice: choice, raceBonus: bonus }
      : { bgChoice: choice, bgBonus: bonus });
  };
  box.querySelectorAll(`input[name="${kind}Variant"]`).forEach(r => {
    r.onchange = () => {
      // Variantenwechsel: Picks zurücksetzen (andere Anzahl Boni)
      const variant = +r.value;
      const choice = { variant, picks: [] };
      const bonus = kind === 'race'
        ? raceBonusFor(store.field('race'), choice)
        : bgBonusFor(store.field('background'), choice);
      store.update(kind === 'race'
        ? { raceChoice: choice, raceBonus: bonus }
        : { bgChoice: choice, bgBonus: bonus });
    };
  });
  box.querySelectorAll('[data-choice-pick]').forEach(sel => { sel.onchange = apply; });
}

// Bei Texteingaben nicht sofort neu rendern (Fokus-Verlust vermeiden)
let quiet = false;
function quietUpdate(patch) {
  quiet = true;
  store.update(patch);
  quiet = false;
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
