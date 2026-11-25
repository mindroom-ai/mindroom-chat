import { ALL_THEME_NAMES, LIGHT_THEME_NAMES, type ThemeName } from '../../preferences/themeNames';

export type ParticleTheme = {
  backgroundColor: string;
  particleColor: string;
  backgroundRadialGradient: string;
};

const parseHexRgb = (hex: string): readonly [number, number, number] => {
  if (!/^#[\da-f]{6}$/i.test(hex)) {
    throw new Error(`Expected 6-digit hex color, got: ${hex}`);
  }
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
};

export const buildParticleTheme = (
  backgroundColor: string,
  particleColor: string,
  isLight: boolean
): ParticleTheme => {
  const [br, bg, bb] = parseHexRgb(backgroundColor);
  const [pr, pg, pb] = parseHexRgb(particleColor);
  const glowAlpha = isLight ? 0.16 : 0.18;
  const backgroundRadialGradient =
    `radial-gradient(circle at 50% 45%, rgba(${pr}, ${pg}, ${pb}, ${glowAlpha}), ` +
    `rgba(${br}, ${bg}, ${bb}, 0.12) 30%, rgba(${br}, ${bg}, ${bb}, 1) 72%)`;
  return { backgroundColor, particleColor, backgroundRadialGradient };
};

// Mirrors each theme's Background.Container (pageColors) and Primary.Main (primaryColors) from
// theme/colors.css.ts. Kept free of theme/colors.css so ui (layer 2) does not import theme
// (layer 3) and particleBackgroundTheme.css stays free of folds, which splash/auth unit tests
// mock without `color`. particleBackgroundTheme.test.ts verifies exact parity with colors.css.ts.
const THEME_PARTICLE_COLORS: Record<
  ThemeName,
  { readonly backgroundColor: string; readonly particleColor: string }
> = {
  light: { backgroundColor: '#F2F2F2', particleColor: '#694CCD' },
  silver: { backgroundColor: '#DEDEDE', particleColor: '#694CCD' },
  sakura: { backgroundColor: '#F7E8EC', particleColor: '#B83B74' },
  matcha: { backgroundColor: '#E9EEDD', particleColor: '#4F7420' },
  catppuccinLatte: { backgroundColor: '#E6E9EF', particleColor: '#8839EF' },
  gruvboxLight: { backgroundColor: '#F2E5BC', particleColor: '#AF3A03' },
  solarizedLight: { backgroundColor: '#EEE8D5', particleColor: '#1A69A6' },
  dark: { backgroundColor: '#1A1A1A', particleColor: '#9B85F0' },
  midnight: { backgroundColor: '#17161D', particleColor: '#9B85F0' },
  butter: { backgroundColor: '#1A1916', particleColor: '#E3C46B' },
  green: { backgroundColor: '#042018', particleColor: '#25FAA1' },
  orange: { backgroundColor: '#0F161B', particleColor: '#FF5000' },
  black: { backgroundColor: '#000000', particleColor: '#9B85F0' },
  ocean: { backgroundColor: '#06192B', particleColor: '#4FD8E8' },
  wine: { backgroundColor: '#1C0E15', particleColor: '#E9C07B' },
  synthwave: { backgroundColor: '#1A1030', particleColor: '#FF6AD5' },
  catppuccinMocha: { backgroundColor: '#181825', particleColor: '#CBA6F7' },
  dracula: { backgroundColor: '#21222C', particleColor: '#BD93F9' },
  gruvboxDark: { backgroundColor: '#1D2021', particleColor: '#FE8019' },
  nord: { backgroundColor: '#242933', particleColor: '#88C0D0' },
  rosePine: { backgroundColor: '#191724', particleColor: '#EBBCBA' },
  solarizedDark: { backgroundColor: '#00212B', particleColor: '#4AA3E8' },
  tokyoNight: { backgroundColor: '#16161E', particleColor: '#7AA2F7' },
};

const LIGHT_THEME_SET: ReadonlySet<ThemeName> = new Set(LIGHT_THEME_NAMES);

export const PARTICLE_THEMES: Record<ThemeName, ParticleTheme> = Object.fromEntries(
  ALL_THEME_NAMES.map((name) => {
    const { backgroundColor, particleColor } = THEME_PARTICLE_COLORS[name];
    return [name, buildParticleTheme(backgroundColor, particleColor, LIGHT_THEME_SET.has(name))];
  })
) as Record<ThemeName, ParticleTheme>;
