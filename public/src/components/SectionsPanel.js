// ============================================================
// components/SectionsPanel.js, free sheet sections
// ------------------------------------------------------------
// The user can add any number of sections, e.g. further feature
// descriptions or additional inventory, when the default area is
// full. Title + content are freely editable.
// ============================================================
import { store }   from '../core/Store.js';
import { bus, EV } from '../core/EventBus.js';
import { t }       from '../core/i18n.js';

export function mountSections() {
  render();
  bus.on(EV.CHAR_CHANGED, ({ changed }) => {
    // only re-render on structural changes (number of sections);
    // text content is saved "quietly" (focus is preserved).
    if (changed.includes('*')) render();
    if (changed.includes('sections') && structureChanged()) render();
  });
  bus.on(EV.LANG_CHANGED, render);
}

// structure detection: compare number/IDs of sections
let lastIds = '';
function structureChanged() {
  const ids = store.field('sections').map(s => s.id).join(',');
  const changed = ids !== lastIds;
  lastIds = ids;
  return changed;
}

function render() {
  const el = document.getElementById('tab-sections');
  const sections = store.field('sections');
  lastIds = sections.map(s => s.id).join(',');

  el.innerHTML = `
  <div class="panel">
    <div class="panel__title">${t('sections.title')}
      <button class="btn btn--sm btn--gold" id="secAdd">+ ${t('sections.addSection')}</button>
    </div>
    <p class="panel__hint">${t('sections.hint')}</p>
  </div>

  ${sections.map(sec => `
    <div class="panel section-card" data-sec="${sec.id}">
      <button class="btn-icon" data-sec-rm="${sec.id}" title="${t('app.remove')}">×</button>
      <input class="section-title-input" type="text" value="${esc(sec.title)}"
             data-sec-title="${sec.id}" placeholder="${t('sections.sectionName')}">
      <textarea data-sec-content="${sec.id}" placeholder="${t('sections.placeholder')}"
                style="margin-top:10px;min-height:120px">${esc(sec.content)}</textarea>
    </div>`).join('')}`;

  // == Events ==
  el.querySelector('#secAdd').onclick = () => {
    const title = prompt(t('sections.sectionName'));
    if (title?.trim()) store.addSection(title.trim());
  };

  el.querySelectorAll('[data-sec-rm]').forEach(b => {
    b.onclick = () => store.removeSection(b.dataset.secRm);
  });

  // title & content: save quietly (no re-render while typing)
  el.querySelectorAll('[data-sec-title]').forEach(inp => {
    inp.oninput = () => store.updateSection(inp.dataset.secTitle, { title: inp.value });
  });
  el.querySelectorAll('[data-sec-content]').forEach(ta => {
    ta.oninput = () => store.updateSection(ta.dataset.secContent, { content: ta.value });
  });
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}
