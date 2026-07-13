// ============================================================
// core/theme.js, appearance (themes, colors, fonts)
// ------------------------------------------------------------
// Three layers that stack on top of each other:
//  1. Mode:   auto (system) / light / dark  → data-mode on <html>
//  2. Preset: ready-made color themes (accent + secondary color)
//  3. Custom: override individual CSS variables via color picker
// Plus: font selection. Everything is persisted in localStorage
// and applied immediately on startup.
// ============================================================

const THEME_KEY = 'dnd5e_theme';

/** Color presets: warm palettes with HIGH contrast.
 *  Each preset carries separate light/dark variants so the colors
 *  stay well readable in BOTH modes (all values checked numerically
 *  against the backgrounds: WCAG AA, contrast ≥ 4.5:1 -
 *  most are above 6:1). In dark mode the tones are lightened,
 *  in light mode darkened. */
export const PRESETS = [
  { id: 'standard',   light: { accent: '#8b1a1a', gold: '#755408' }, dark: { accent: '#e8837a', gold: '#dfb763' } },
  { id: 'ember',      light: { accent: '#99330a', gold: '#7c5a00' }, dark: { accent: '#f0925e', gold: '#e3ac4f' } },
  { id: 'terracotta', light: { accent: '#9c3d1e', gold: '#6d5936' }, dark: { accent: '#eb9678', gold: '#d6b483' } },
  { id: 'kupfer',     light: { accent: '#82410c', gold: '#6b5a20' }, dark: { accent: '#e39b5c', gold: '#cfb56e' } },
  { id: 'olive',      light: { accent: '#59560a', gold: '#7a5210' }, dark: { accent: '#c4c06a', gold: '#dcae5e' } },
  { id: 'mahagoni',   light: { accent: '#6e2410', gold: '#6b4a08' }, dark: { accent: '#e88f70', gold: '#d8ab58' } },
];

/** Fonts (system stacks, no downloads needed) */
export const FONTS = [
  { id: 'system',  stack: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { id: 'serif',   stack: "Georgia, 'Times New Roman', serif" },
  { id: 'fantasy', stack: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif" },
  { id: 'mono',    stack: "ui-monospace, 'Cascadia Code', 'Courier New', monospace" },
  { id: 'clean',   stack: "'Trebuchet MS', Verdana, 'Segoe UI', sans-serif" },
];

/** Freely overridable variables (color pickers in the settings) */
export const CUSTOM_VARS = [
  { id: 'accent', cssVar: '--accent' },
  { id: 'gold',   cssVar: '--gold' },
  { id: 'bg',     cssVar: '--bg' },
  { id: 'panel',  cssVar: '--bg2' },
  { id: 'text',   cssVar: '--ink' },
  { id: 'boost',  cssVar: '--boost' }, // color for item-boosted abilities
];

const DEFAULTS = { mode: 'auto', preset: 'standard', font: 'system', custom: {} };

let current = { ...DEFAULTS };

// == Load / save ==============================================
export function getTheme() { return structuredClone(current); }

export function setTheme(patch) {
  current = { ...current, ...structuredClone(patch) };
  if (patch.custom) current.custom = { ...structuredClone(patch.custom) };
  localStorage.setItem(THEME_KEY, JSON.stringify(current));
  applyTheme();
}

export function resetTheme() {
  current = { ...DEFAULTS, custom: {} };
  localStorage.removeItem(THEME_KEY);
  applyTheme();
}

// == Apply ====================================================
export function applyTheme() {
  const root = document.documentElement;

  // 1) mode: auto = remove the attribute (media query takes over)
  if (current.mode === 'auto') root.removeAttribute('data-mode');
  else root.setAttribute('data-mode', current.mode);

  // 2) reset all inline variables, then set them anew
  CUSTOM_VARS.forEach(v => root.style.removeProperty(v.cssVar));
  root.style.removeProperty('--font');
  root.style.removeProperty('--accent-bg');
  root.style.removeProperty('--gold-bg');

  // Preset colors: light/dark variant based on the EFFECTIVE mode.
  // (Inline styles override the CSS media query, so the mode
  //  resolution has to happen here; otherwise dark accents on a
  //  dark background would be unreadable.)
  const preset = PRESETS.find(p => p.id === current.preset) ?? PRESETS[0];
  const dark = current.mode === 'dark' ||
    (current.mode === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  const colors = dark ? preset.dark : preset.light;
  root.style.setProperty('--accent', colors.accent);
  root.style.setProperty('--gold',   colors.gold);
  root.style.setProperty('--accent-bg', tint(colors.accent, dark));
  root.style.setProperty('--gold-bg',   tint(colors.gold, dark));

  // 3) custom colors override the preset
  for (const [id, value] of Object.entries(current.custom ?? {})) {
    const def = CUSTOM_VARS.find(v => v.id === id);
    if (def && value) {
      root.style.setProperty(def.cssVar, value);
      if (id === 'accent') root.style.setProperty('--accent-bg', tint(value, dark));
      if (id === 'gold')   root.style.setProperty('--gold-bg',   tint(value, dark));
    }
  }

  // 4) font
  const font = FONTS.find(f => f.id === current.font) ?? FONTS[0];
  root.style.setProperty('--font', font.stack);
}

/** Subtle background tint from a solid color (mode-dependent) */
function tint(hex, dark = false) {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return 'transparent';
  const [r, g, b] = [m[1], m[2], m[3]].map(h => parseInt(h, 16));
  return `rgba(${r}, ${g}, ${b}, ${dark ? 0.16 : 0.12})`;
}

// On system switch light↔dark (mode "auto"), follow up with the
// matching preset variant.
try {
  window.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => { if (current.mode === 'auto') applyTheme(); });
} catch { /* older browsers: no live switching */ }

// == Initialization on module import ==========================
try {
  const raw = localStorage.getItem(THEME_KEY);
  if (raw) current = { ...DEFAULTS, ...JSON.parse(raw) };
} catch {}
applyTheme();
