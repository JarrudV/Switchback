export type ThemeMode = "dark" | "light";
export type ThemeAccent = "peakready" | "neon" | "sunset";

export const THEME_MODE_STORAGE_KEY = "peakready.theme.mode";
export const THEME_ACCENT_STORAGE_KEY = "peakready.theme.accent";

const DEFAULT_THEME: { mode: ThemeMode; accent: ThemeAccent } = {
  mode: "dark",
  accent: "peakready",
};

const THEME_COLOR_MAP: Record<ThemeMode, Record<ThemeAccent, string>> = {
  dark: {
    peakready: "#0f0c29",
    neon: "#04170f",
    sunset: "#2b1207",
  },
  light: {
    peakready: "#eef4ff",
    neon: "#effff3",
    sunset: "#fff4e9",
  },
};

export function isThemeMode(value: string | null | undefined): value is ThemeMode {
  return value === "dark" || value === "light";
}

export function isThemeAccent(value: string | null | undefined): value is ThemeAccent {
  return value === "peakready" || value === "neon" || value === "sunset";
}

export function readStoredTheme() {
  const modeRaw = localStorage.getItem(THEME_MODE_STORAGE_KEY);
  const accentRaw = localStorage.getItem(THEME_ACCENT_STORAGE_KEY);

  return {
    mode: isThemeMode(modeRaw) ? modeRaw : DEFAULT_THEME.mode,
    accent: isThemeAccent(accentRaw) ? accentRaw : DEFAULT_THEME.accent,
  };
}

export function persistThemeLocally(mode: ThemeMode, accent: ThemeAccent) {
  localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  localStorage.setItem(THEME_ACCENT_STORAGE_KEY, accent);
}

export function applyTheme(mode: ThemeMode, accent: ThemeAccent) {
  const root = document.documentElement;
  root.dataset.themeMode = mode;
  root.dataset.themeAccent = accent;

  const themeColor = THEME_COLOR_MAP[mode][accent];
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", themeColor);
  }
}

export function getDefaultTheme() {
  return DEFAULT_THEME;
}
