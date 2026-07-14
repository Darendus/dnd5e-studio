// ============================================================
// components/SettingsPanel.js, settings
// ------------------------------------------------------------
// • language (German / English)
// • ruleset selection: only enabled sources appear in
//   the libraries and in the generator
// • data status display + instructions for the update function
// • homebrew management (view/delete own entries)
// ============================================================
import { repo }    from '../core/DataRepository.js';
import { bus, EV } from '../core/EventBus.js';
import { t, getLang, setLang, LANGS } from '../core/i18n.js';
import { getTheme, setTheme, resetTheme, PRESETS, FONTS, CUSTOM_VARS } from '../core/theme.js';

export function mountSettings() {
  render();
  bus.on(EV.LANG_CHANGED, render);
  bus.on(EV.SOURCES_CHANGED, render);
}

function render() {
  const el = document.getElementById('tab-settings');
  const sources = repo.allSources();
  const manifest = repo.manifest;
  const hb = repo.getHomebrew();

  const theme = getTheme();

  el.innerHTML = `
  <!-- cosmetics: mode, themes, custom colors, font -->
  <div class="panel">
    <div class="panel__title">${t('appearance.title')}
      <button class="btn btn--sm" id="appReset">↺ ${t('appearance.reset')}</button>
    </div>
    <p class="panel__hint" style="margin-bottom:12px">${t('appearance.hint')}</p>

    <div class="panel__title" style="margin-top:4px">${t('appearance.mode')}</div>
    <div class="mode-toggle" style="display:inline-flex;margin-bottom:14px">
      ${['auto','light','dark'].map(m => `
        <button class="btn btn--sm ${theme.mode === m ? 'active' : ''}" data-app-mode="${m}">
          ${t('appearance.mode' + m.charAt(0).toUpperCase() + m.slice(1))}
        </button>`).join('')}
    </div>

    <div class="panel__title">${t('appearance.presets')}</div>
    <div class="preset-row" style="margin-bottom:14px">
      ${PRESETS.map(p => `
        <button class="preset-swatch ${theme.preset === p.id ? 'active' : ''}"
                data-app-preset="${p.id}" title="${t('appearance.preset_' + p.id)}">
          <span style="background:${p.light.accent}"></span><span style="background:${p.light.gold}"></span>
        </button>`).join('')}
    </div>

    <div class="panel__title">${t('appearance.customColors')}</div>
    <div class="color-grid" style="margin-bottom:14px">
      ${CUSTOM_VARS.map(v => `
        <label class="color-field">
          <input type="color" data-app-color="${v.id}"
                 value="${theme.custom?.[v.id] ?? currentVar(v.cssVar)}">
          ${t('appearance.color_' + v.id)}
        </label>`).join('')}
    </div>

    <div class="panel__title">${t('appearance.font')}</div>
    <select id="appFont" style="max-width:280px">
      ${FONTS.map(f => `<option value="${f.id}" ${theme.font === f.id ? 'selected' : ''}>${t('appearance.font_' + f.id)}</option>`).join('')}
    </select>
    <span class="font-sample" style="margin-left:12px">Aa Bb, 1d20+5</span>
  </div>

  <div class="panel">
    <div class="panel__title">${t('settings.language')}</div>
    <div style="display:flex;gap:8px">
      ${LANGS.map(l => `
        <button class="btn ${getLang() === l.id ? 'btn--primary' : ''}" data-lang="${l.id}">${l.label}</button>`).join('')}
    </div>
  </div>

  <div class="panel">
    <div class="panel__title">${t('settings.advanced')}</div>
    <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
      <input type="checkbox" id="setAdvanced" ${repo.advanced ? 'checked' : ''}
             style="width:18px;height:18px;accent-color:var(--gold)">
      <span>
        <b>${t('settings.advancedToggle')}</b>
        <div class="panel__hint">${t('settings.advancedHint')}</div>
      </span>
    </label>
  </div>

  <div class="panel">
    <div class="panel__title">${t('settings.sources')}</div>
    <p class="panel__hint" style="margin-bottom:10px">${t('settings.sourcesHint')}</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px">
      ${sources.map(src => `
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink);
                      padding:5px 8px;border:1px solid var(--border);border-radius:var(--r-sm)">
          <input type="checkbox" data-src="${src.id}" ${src.enabled ? 'checked' : ''}>
          <b>${src.id}</b>
          <span class="row-dim" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${src.name}</span>
        </label>`).join('')}
    </div>
  </div>

  <div class="panel">
    <div class="panel__title">${t('settings.update')}</div>
    <p class="panel__hint" style="margin-bottom:10px">${t('settings.updateHint')}</p>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <button class="btn btn--primary" id="setUpdate">⟳ ${t('settings.runUpdate')}</button>
      <button class="btn" id="setUpdateForce" title="--force">⟳ ${t('settings.runUpdateForce')}</button>
      <button class="btn btn--sm" id="setReload">↻ ${t('settings.checkNow')}</button>
    </div>
    <pre id="setUpdateLog" style="display:none;font-family:var(--mono);font-size:11px;background:var(--bg);
         border:1px solid var(--border);border-radius:var(--r-sm);padding:10px;max-height:220px;
         overflow-y:auto;white-space:pre-wrap;margin-bottom:10px"></pre>
    <div class="stat-row">
      <div class="stat-box">
        <span class="stat-box__val" style="font-size:13px">${manifest?.updatedAt
          ? new Date(manifest.updatedAt).toLocaleString()
          : t('settings.never')}</span>
        <span class="stat-box__lbl">${t('settings.lastUpdate')}</span>
      </div>
      <div class="stat-box">
        <span class="stat-box__val">${repo.spells.length}</span>
        <span class="stat-box__lbl">${t('tabs.spells')}</span>
      </div>
      <div class="stat-box">
        <span class="stat-box__val">${repo.items.length}</span>
        <span class="stat-box__lbl">${t('inventory.items')}</span>
      </div>
      <div class="stat-box">
        <span class="stat-box__val">${repo.feats.length}</span>
        <span class="stat-box__lbl">Feats</span>
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="panel__title">${t('settings.homebrew')}</div>
    <p class="panel__hint" style="margin-bottom:10px">${t('settings.homebrewHint')}</p>
    <details style="margin-bottom:12px">
      <summary style="cursor:pointer;color:var(--gold);font-weight:600;font-size:13px">${t('settings.homebrewHowTo')}</summary>
      <div class="panel__hint" style="margin-top:8px;line-height:1.6">${t('settings.homebrewGuide')}</div>
    </details>
    ${['spells', 'items'].map(kind => {
      const entries = hb[kind] ?? [];
      if (!entries.length) return '';
      return `
        <div class="lib-group-head">${t('tabs.' + (kind === 'spells' ? 'spells' : 'inventory'))} (${entries.length})</div>
        ${entries.map(e => `
          <div class="list-row">
            <span class="row-grow">${e.name}</span>
            <button class="btn-icon" data-hb-rm="${kind}|${e.name.replace(/"/g, '&quot;')}">×</button>
          </div>`).join('')}`;
    }).join('') || `<p class="panel__hint">-</p>`}
  </div>

  <!-- quit app: stops the server (invisible operation via Start.vbs) -->
  <div class="panel">
    <div class="panel__title">${t('settings.shutdown')}</div>
    <p class="panel__hint" style="margin-bottom:10px">${t('settings.shutdownHint')}</p>
    <button class="btn btn--danger" id="setShutdown">⏻ ${t('settings.shutdown')}</button>
  </div>`;

  // == Events: appearance ==
  el.querySelectorAll('[data-app-mode]').forEach(b => {
    b.onclick = () => { setTheme({ mode: b.dataset.appMode }); render(); };
  });
  el.querySelectorAll('[data-app-preset]').forEach(b => {
    b.onclick = () => { setTheme({ preset: b.dataset.appPreset, custom: {} }); render(); };
  });
  el.querySelectorAll('[data-app-color]').forEach(inp => {
    inp.oninput = () => {
      const custom = { ...getTheme().custom, [inp.dataset.appColor]: inp.value };
      setTheme({ custom });
    };
  });
  el.querySelector('#appFont').onchange = e => setTheme({ font: e.target.value });
  el.querySelector('#appReset').onclick = () => { resetTheme(); render(); };

  // == Events ==
  el.querySelectorAll('[data-lang]').forEach(b => {
    b.onclick = () => setLang(b.dataset.lang);
  });
  el.querySelectorAll('[data-src]').forEach(cb => {
    cb.onchange = () => repo.setSourceEnabled(cb.dataset.src, cb.checked);
  });
  const adv = el.querySelector('#setAdvanced');
  if (adv) adv.onchange = () => repo.setAdvanced(adv.checked);

  // update at the push of a button: streams progress live into the log window
  const startUpdate = async force => {
    const logBox = el.querySelector('#setUpdateLog');
    const btns = [el.querySelector('#setUpdate'), el.querySelector('#setUpdateForce')];
    btns.forEach(b => b.disabled = true);
    logBox.style.display = 'block';
    logBox.textContent = '…\n';

    const result = await repo.triggerUpdate(line => {
      logBox.textContent += line + '\n';
      logBox.scrollTop = logBox.scrollHeight;
    }, force);

    btns.forEach(b => b.disabled = false);
    if (result?.newBooks?.length) {
      bus.emit(EV.TOAST, { message: `✨ ${result.newBooks.length} ${t('settings.newBooks')}` });
    } else {
      bus.emit(EV.TOAST, { message: result?.ok ? '✓ Update' : '⚠ Update' });
    }
    render(); // refresh counters & date (the log closes in the process; the toast summarizes)
  };
  el.querySelector('#setUpdate').onclick      = () => startUpdate(false);
  el.querySelector('#setUpdateForce').onclick = () => startUpdate(true);

  el.querySelector('#setReload').onclick = async () => {
    await repo.load(); // re-read manifest & packs
    bus.emit(EV.TOAST, { message: '✓' });
    render();
  };
  // quit app: stop the server, show a farewell page
  el.querySelector('#setShutdown').onclick = async () => {
    if (!confirm(t('settings.shutdownConfirm'))) return;
    try { await fetch('/api/shutdown'); } catch { /* server is gone, expected */ }
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;
                  font-family:var(--font);color:var(--ink);background:var(--bg);
                  text-align:center;padding:2rem">
        <div>
          <div style="font-size:40px;margin-bottom:12px">⏻</div>
          <div style="font-size:16px">${t('settings.shutdownDone')}</div>
        </div>
      </div>`;
  };

  el.querySelectorAll('[data-hb-rm]').forEach(b => {
    b.onclick = () => {
      const [kind, name] = b.dataset.hbRm.split('|');
      repo.removeHomebrew(kind, name);
    };
  });
}


/** Read the current value of a CSS variable as hex (initial value of the color pickers) */
function currentVar(cssVar) {
  const val = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  if (/^#[0-9a-f]{6}$/i.test(val)) return val;
  if (/^#[0-9a-f]{3}$/i.test(val)) return '#' + [...val.slice(1)].map(c => c + c).join('');
  const m = val.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('');
  return '#888888';
}
