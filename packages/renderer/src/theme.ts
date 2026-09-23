export interface RendererTheme {
  readonly colors: {
    readonly canvas: number;
    readonly scrim: number;
    readonly panel: number;
    readonly surface: number;
    readonly surfaceStrong: number;
    readonly line: number;
    readonly accent: number;
    readonly accentSoft: number;
    readonly text: number;
    readonly textMuted: number;
    readonly textDisabled: number;
    readonly textOnAccent: number;
    readonly danger: number;
  };
  readonly opacity: {
    readonly scrim: number;
    readonly panel: number;
    readonly surface: number;
    readonly line: number;
    readonly disabled: number;
  };
  readonly typography: {
    readonly titleSize: number;
    readonly headingSize: number;
    readonly bodySize: number;
    readonly uiSize: number;
    readonly captionSize: number;
    readonly titleLetterSpacing: number;
    readonly uiLetterSpacing: number;
  };
  readonly spacing: {
    readonly xs: number;
    readonly sm: number;
    readonly md: number;
    readonly lg: number;
    readonly xl: number;
  };
  readonly radius: {
    readonly sm: number;
    readonly md: number;
    readonly lg: number;
  };
}

export type RendererThemeOverrides = {
  readonly [K in keyof RendererTheme]?: Partial<RendererTheme[K]>;
};

const GROUP_KEYS: { readonly [K in keyof RendererTheme]: readonly string[] } = {
  colors: [
    'canvas', 'scrim', 'panel', 'surface', 'surfaceStrong', 'line', 'accent',
    'accentSoft', 'text', 'textMuted', 'textDisabled', 'textOnAccent', 'danger',
  ],
  opacity: ['scrim', 'panel', 'surface', 'line', 'disabled'],
  typography: [
    'titleSize', 'headingSize', 'bodySize', 'uiSize', 'captionSize',
    'titleLetterSpacing', 'uiLetterSpacing',
  ],
  spacing: ['xs', 'sm', 'md', 'lg', 'xl'],
  radius: ['sm', 'md', 'lg'],
};

const DEFAULT_THEME: RendererTheme = {
  colors: {
    canvas: 0xeef6ff,
    scrim: 0xe3eef8,
    panel: 0xf7fbff,
    surface: 0xedf5fb,
    surfaceStrong: 0xddebf7,
    line: 0x79bce4,
    accent: 0x203e88,
    accentSoft: 0x48688e,
    text: 0x192d67,
    textMuted: 0x385185,
    textDisabled: 0x788ba0,
    textOnAccent: 0xffffff,
    danger: 0x9e394e,
  },
  opacity: {
    scrim: 0.72,
    panel: 0.94,
    surface: 0.88,
    line: 0.48,
    disabled: 0.64,
  },
  typography: {
    titleSize: 68,
    headingSize: 30,
    bodySize: 28,
    uiSize: 22,
    captionSize: 18,
    titleLetterSpacing: 5,
    uiLetterSpacing: 1,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 40,
  },
  radius: {
    sm: 2,
    md: 4,
    lg: 6,
  },
};

function invalidTheme(message: string): never {
  throw new Error(`RENDERER_THEME_INVALID: ${message}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateValue(group: keyof RendererTheme, key: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalidTheme(`${group}.${key} must be finite`);
  }
  if (group === 'colors') {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffff) {
      invalidTheme(`${group}.${key} must be an integer in 0x000000..0xffffff`);
    }
    return;
  }
  if (group === 'opacity') {
    if (value < 0 || value > 1) invalidTheme(`${group}.${key} must be between 0 and 1`);
    return;
  }
  if (value < 0) invalidTheme(`${group}.${key} must be non-negative`);
}

function freezeTheme(theme: RendererTheme): RendererTheme {
  Object.freeze(theme.colors);
  Object.freeze(theme.opacity);
  Object.freeze(theme.typography);
  Object.freeze(theme.spacing);
  Object.freeze(theme.radius);
  return Object.freeze(theme);
}

export const DEFAULT_RENDERER_THEME: RendererTheme = freezeTheme({
  colors: { ...DEFAULT_THEME.colors },
  opacity: { ...DEFAULT_THEME.opacity },
  typography: { ...DEFAULT_THEME.typography },
  spacing: { ...DEFAULT_THEME.spacing },
  radius: { ...DEFAULT_THEME.radius },
});

export function createRendererTheme(overrides: RendererThemeOverrides = {}): RendererTheme {
  if (!isPlainObject(overrides)) invalidTheme('overrides must be a plain object');
  for (const key of Object.keys(overrides)) {
    if (!(key in GROUP_KEYS)) invalidTheme(`unknown group=${key}`);
    const group = key as keyof RendererTheme;
    const value = overrides[group];
    if (value === undefined) invalidTheme(`${group} override must be an object`);
    if (!isPlainObject(value)) invalidTheme(`${group} override must be a plain object`);
    const valueRecord = value as Record<string, unknown>;
    for (const nestedKey of Object.keys(valueRecord)) {
      if (!GROUP_KEYS[group].includes(nestedKey)) invalidTheme(`unknown token=${group}.${nestedKey}`);
      validateValue(group, nestedKey, valueRecord[nestedKey]);
    }
  }

  const theme = {
    colors: { ...DEFAULT_THEME.colors, ...(overrides.colors ?? {}) },
    opacity: { ...DEFAULT_THEME.opacity, ...(overrides.opacity ?? {}) },
    typography: { ...DEFAULT_THEME.typography, ...(overrides.typography ?? {}) },
    spacing: { ...DEFAULT_THEME.spacing, ...(overrides.spacing ?? {}) },
    radius: { ...DEFAULT_THEME.radius, ...(overrides.radius ?? {}) },
  } as RendererTheme;
  return freezeTheme(theme);
}
