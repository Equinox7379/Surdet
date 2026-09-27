/** Shared pure-data theme contract for project validation and every renderer consumer. */
export interface PresentationTheme {
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
  /** 可选 UI 皮肤资源键（背景图像注册表）；空字符串表示无皮肤。 */
  readonly skins: {
    readonly dialogSkin: string;
    readonly buttonSkin: string;
  };
  /** 基础布局旋钮；数值为引擎单位，null/undefined 语义在消费端按默认处理。 */
  readonly layout: {
    readonly dialogHeightRatio: number | null;
    readonly dialogMarginX: number | null;
    readonly dialogMarginBottom: number | null;
  };
}

export type PresentationThemeOverrides = {
  readonly [K in keyof PresentationTheme]?: Partial<PresentationTheme[K]>;
};

const GROUP_KEYS: { readonly [K in keyof PresentationTheme]: readonly string[] } = {
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
  skins: ['dialogSkin', 'buttonSkin'],
  layout: ['dialogHeightRatio', 'dialogMarginX', 'dialogMarginBottom'],
};

const DEFAULT_THEME: PresentationTheme = {
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
  skins: {
    dialogSkin: '',
    buttonSkin: '',
  },
  layout: {
    dialogHeightRatio: null,
    dialogMarginX: null,
    dialogMarginBottom: null,
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

function validateValue(group: keyof PresentationTheme, key: string, value: unknown): void {
  if (group === 'skins') {
    if (typeof value !== 'string') invalidTheme(`${group}.${key} must be a string`);
    return;
  }
  if (group === 'layout') {
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
      invalidTheme(`${group}.${key} must be finite or null`);
    }
    if (typeof value === 'number' && (value < 0 || (key === 'dialogHeightRatio' && (value === 0 || value > 1)))) invalidTheme(`${group}.${key} is out of range`);
    return;
  }
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

function freezeTheme(theme: PresentationTheme): PresentationTheme {
  Object.freeze(theme.colors);
  Object.freeze(theme.opacity);
  Object.freeze(theme.typography);
  Object.freeze(theme.spacing);
  Object.freeze(theme.radius);
  Object.freeze(theme.skins);
  Object.freeze(theme.layout);
  return Object.freeze(theme);
}

export const DEFAULT_PRESENTATION_THEME: PresentationTheme = freezeTheme({
  colors: { ...DEFAULT_THEME.colors },
  opacity: { ...DEFAULT_THEME.opacity },
  typography: { ...DEFAULT_THEME.typography },
  spacing: { ...DEFAULT_THEME.spacing },
  radius: { ...DEFAULT_THEME.radius },
  skins: { ...DEFAULT_THEME.skins },
  layout: { ...DEFAULT_THEME.layout },
});

export function createPresentationTheme(overrides: PresentationThemeOverrides = {}): PresentationTheme {
  if (!isPlainObject(overrides)) invalidTheme('overrides must be a plain object');
  for (const key of Object.keys(overrides)) {
    if (!Object.hasOwn(GROUP_KEYS, key)) invalidTheme(`unknown group=${key}`);
    const group = key as keyof PresentationTheme;
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
    skins: { ...DEFAULT_THEME.skins, ...(overrides.skins ?? {}) },
    layout: { ...DEFAULT_THEME.layout, ...(overrides.layout ?? {}) },
  } as PresentationTheme;
  return freezeTheme(theme);
}
