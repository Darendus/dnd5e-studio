// ============================================================
// core/theme.js, Erscheinungsbild (Themes, Farben, Schriften)
// ------------------------------------------------------------
// Drei Ebenen, die sich überlagern:
//  1. Modus:  auto (System) / hell / dunkel  → data-mode am <html>
//  2. Preset: fertige Farb-Themes (Akzent + Zweitfarbe)
//  3. Custom: einzelne CSS-Variablen per Farbwähler übersteuern
// Plus: Schriftart-Auswahl. Alles wird in localStorage persistiert
// und beim Start sofort angewendet.
// ============================================================

const THEME_KEY = 'dnd5e_theme';

/** Farb-Presets: warme Paletten mit HOHEM Kontrast.
 *  Jedes Preset trägt getrennte Hell-/Dunkel-Varianten, damit die
 *  Farben in BEIDEN Modi gut lesbar bleiben (alle Werte numerisch
 *  gegen die Hintergründe geprüft: WCAG AA, Kontrast ≥ 4.5:1 -
 *  die meisten liegen über 6:1). Im Dunkelmodus sind die Töne
 *  aufgehellt, im Hellmodus abgedunkelt. */
export const PRESETS = [
  { id: 'standard',   light: { accent: '#8b1a1a', gold: '#755408' }, dark: { accent: '#e8837a', gold: '#dfb763' } },
  { id: 'ember',      light: { accent: '#99330a', gold: '#7c5a00' }, dark: { accent: '#f0925e', gold: '#e3ac4f' } },
  { id: 'terracotta', light: { accent: '#9c3d1e', gold: '#6d5936' }, dark: { accent: '#eb9678', gold: '#d6b483' } },
  { id: 'kupfer',     light: { accent: '#82410c', gold: '#6b5a20' }, dark: { accent: '#e39b5c', gold: '#cfb56e' } },
  { id: 'olive',      light: { accent: '#59560a', gold: '#7a5210' }, dark: { accent: '#c4c06a', gold: '#dcae5e' } },
  { id: 'mahagoni',   light: { accent: '#6e2410', gold: '#6b4a08' }, dark: { accent: '#e88f70', gold: '#d8ab58' } },
];

/** Schriftarten (System-Stacks, keine Downloads nötig) */
export const FONTS = [
  { id: 'system',  stack: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { id: 'serif',   stack: "Georgia, 'Times New Roman', serif" },
  { id: 'fantasy', stack: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif" },
  { id: 'mono',    stack: "ui-monospace, 'Cascadia Code', 'Courier New', monospace" },
  { id: 'clean',   stack: "'Trebuchet MS', Verdana, 'Segoe UI', sans-serif" },
];

/** Frei übersteuerbare Variablen (Farbwähler in den Einstellungen) */
export const CUSTOM_VARS = [
  { id: 'accent', cssVar: '--accent' },
  { id: 'gold',   cssVar: '--gold' },
  { id: 'bg',     cssVar: '--bg' },
  { id: 'panel',  cssVar: '--bg2' },
  { id: 'text',   cssVar: '--ink' },
  { id: 'boost',  cssVar: '--boost' }, // Farbe für Item-verstärkte Attribute
];

const DEFAULTS = { mode: 'auto', preset: 'standard', font: 'system', custom: {} };

let current = { ...DEFAULTS };

// == Laden / Speichern ========================================
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

// == Anwenden =================================================
export function applyTheme() {
  const root = document.documentElement;

  // 1) Modus: auto = Attribut entfernen (Media-Query greift)
  if (current.mode === 'auto') root.removeAttribute('data-mode');
  else root.setAttribute('data-mode', current.mode);

  // 2) Alle Inline-Variablen zurücksetzen, dann neu setzen
  CUSTOM_VARS.forEach(v => root.style.removeProperty(v.cssVar));
  root.style.removeProperty('--font');
  root.style.removeProperty('--accent-bg');
  root.style.removeProperty('--gold-bg');

  // Preset-Farben: Hell-/Dunkel-Variante nach EFFEKTIVEM Modus.
  // (Inline-Styles überschreiben die CSS-Media-Query, daher muss
  //  die Modus-Auflösung hier passieren, sonst wären dunkle Akzente
  //  auf dunklem Grund unlesbar.)
  const preset = PRESETS.find(p => p.id === current.preset) ?? PRESETS[0];
  const dark = current.mode === 'dark' ||
    (current.mode === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  const colors = dark ? preset.dark : preset.light;
  root.style.setProperty('--accent', colors.accent);
  root.style.setProperty('--gold',   colors.gold);
  root.style.setProperty('--accent-bg', tint(colors.accent, dark));
  root.style.setProperty('--gold-bg',   tint(colors.gold, dark));

  // 3) Custom-Farben übersteuern Preset
  for (const [id, value] of Object.entries(current.custom ?? {})) {
    const def = CUSTOM_VARS.find(v => v.id === id);
    if (def && value) {
      root.style.setProperty(def.cssVar, value);
      if (id === 'accent') root.style.setProperty('--accent-bg', tint(value, dark));
      if (id === 'gold')   root.style.setProperty('--gold-bg',   tint(value, dark));
    }
  }

  // 4) Schriftart
  const font = FONTS.find(f => f.id === current.font) ?? FONTS[0];
  root.style.setProperty('--font', font.stack);
}

/** Zarte Hintergrund-Tönung aus einer Vollfarbe (Modus-abhängig) */
function tint(hex, dark = false) {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return 'transparent';
  const [r, g, b] = [m[1], m[2], m[3]].map(h => parseInt(h, 16));
  return `rgba(${r}, ${g}, ${b}, ${dark ? 0.16 : 0.12})`;
}

// Bei Systemwechsel hell↔dunkel (Modus "auto") die passende
// Preset-Variante nachziehen.
try {
  window.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => { if (current.mode === 'auto') applyTheme(); });
} catch { /* ältere Browser: kein Live-Wechsel */ }

// == Initialisierung beim Modul-Import ========================
try {
  const raw = localStorage.getItem(THEME_KEY);
  if (raw) current = { ...DEFAULTS, ...JSON.parse(raw) };
} catch {}
applyTheme();
