import { createTheme, globalStyle } from '@vanilla-extract/css';
import { color } from 'folds';
import { DARK_THEMES, LIGHT_THEMES, type ThemeName } from '../preferences/themeNames';

// MindRoom's palettes for the folds colour contract. Light and dark follow the reference
// screenshots (docs/design/reference/): neutral greys with a faint violet cast, a violet
// primary, green for success and resolved threads. Silver is a greyer light theme; midnight
// and butter are dark themes with a blue and a warm cast. Green and orange are dark themes on
// deep green and blue-black surfaces with a neon green and an orange primary.

type Palette = Parameters<typeof createTheme<typeof color>>[1];

const lightAccents = {
  Primary: {
    Main: '#694CCD',
    MainHover: '#5E43BE',
    MainActive: '#573EB2',
    MainLine: '#5039A4',
    OnMain: '#FFFFFF',
    Container: '#EFEEFF',
    ContainerHover: '#E6E3FD',
    ContainerActive: '#DCD8FB',
    ContainerLine: '#D1CCF8',
    OnContainer: '#462C93',
  },
  Secondary: {
    Main: '#1F1E26',
    MainHover: '#2C2B34',
    MainActive: '#37363F',
    MainLine: '#43424B',
    OnMain: '#FFFFFF',
    Container: '#DDDDE2',
    ContainerHover: '#D3D3D9',
    ContainerActive: '#C9C9D0',
    ContainerLine: '#BFBFC7',
    OnContainer: '#1F1E26',
  },
  Success: {
    Main: '#1F8A4D',
    MainHover: '#1C7D46',
    MainActive: '#1A7541',
    MainLine: '#186D3C',
    OnMain: '#FFFFFF',
    Container: '#E2F6E8',
    ContainerHover: '#D5F1DE',
    ContainerActive: '#C8EBD3',
    ContainerLine: '#BBE5C8',
    OnContainer: '#166235',
  },
  Warning: {
    Main: '#A85400',
    MainHover: '#984C00',
    MainActive: '#8E4700',
    MainLine: '#854300',
    OnMain: '#FFFFFF',
    Container: '#FDEDDC',
    ContainerHover: '#FAE3CB',
    ContainerActive: '#F7D9BA',
    ContainerLine: '#F3CFA9',
    OnContainer: '#783B00',
  },
  Critical: {
    Main: '#C0383A',
    MainHover: '#AE3234',
    MainActive: '#A32F31',
    MainLine: '#982C2D',
    OnMain: '#FFFFFF',
    Container: '#FBE9E9',
    ContainerHover: '#F7DDDD',
    ContainerActive: '#F3D0D0',
    ContainerLine: '#EFC4C4',
    OnContainer: '#8A2224',
  },
  Other: {
    FocusRing: 'rgba(105, 76, 205, 0.5)',
    Shadow: 'rgba(31, 30, 38, 0.18)',
    Overlay: 'rgba(31, 30, 38, 0.45)',
  },
};

const lightPalette: Palette = {
  Background: {
    Container: '#F2F2F2',
    ContainerHover: '#E8E8EC',
    ContainerActive: '#DDDDE2',
    // home.png and settings.png: the sidebar, members panel and dialog dividers.
    ContainerLine: '#E1E1E6',
    OnContainer: '#1F1E26',
  },
  Surface: {
    Container: '#FFFFFF',
    ContainerHover: '#F6F6F9',
    ContainerActive: '#EEEEF2',
    ContainerLine: '#E1E1E6',
    OnContainer: '#1F1E26',
  },
  SurfaceVariant: {
    Container: '#F4F4F8',
    ContainerHover: '#EBEBF0',
    ContainerActive: '#E2E2E8',
    ContainerLine: '#DFDFE4',
    OnContainer: '#1F1E26',
  },
  ...lightAccents,
};

const silverPalette: Palette = {
  Background: {
    Container: '#DEDEDE',
    ContainerHover: '#D3D3D5',
    ContainerActive: '#C9C9CC',
    ContainerLine: '#C0C0C3',
    OnContainer: '#1A1A1E',
  },
  Surface: {
    Container: '#EBEBEB',
    ContainerHover: '#E2E2E4',
    ContainerActive: '#D9D9DC',
    ContainerLine: '#CDCDD0',
    OnContainer: '#1A1A1E',
  },
  SurfaceVariant: {
    Container: '#E3E3E6',
    ContainerHover: '#DADADE',
    ContainerActive: '#D1D1D6',
    ContainerLine: '#C7C7CC',
    OnContainer: '#1A1A1E',
  },
  ...lightAccents,
};

// Every palette below this line is a dark one; scrollbarTheme.test.ts reads their hover tracks.
const darkAccents = {
  Primary: {
    Main: '#9B85F0',
    MainHover: '#A893F2',
    MainActive: '#B4A1F4',
    MainLine: '#C0AFF6',
    OnMain: '#17142B',
    Container: '#3C3857',
    ContainerHover: '#45405F',
    ContainerActive: '#4E4968',
    ContainerLine: '#575171',
    OnContainer: '#E1DFFD',
  },
  Secondary: {
    Main: '#ECECEF',
    MainHover: '#DFDFE3',
    MainActive: '#D3D3D8',
    MainLine: '#C7C7CD',
    OnMain: '#1A1A1A',
    Container: '#3A3A3E',
    ContainerHover: '#434347',
    ContainerActive: '#4C4C50',
    ContainerLine: '#55555A',
    OnContainer: '#ECECEF',
  },
  Success: {
    // room-dark.png: "Resolved by" and the streaming dot.
    Main: '#81D39F',
    MainHover: '#8DD8A8',
    MainActive: '#99DDB1',
    MainLine: '#A5E2BA',
    OnMain: '#0B2416',
    Container: '#0D4326',
    ContainerHover: '#124D2D',
    ContainerActive: '#175734',
    ContainerLine: '#1C613B',
    OnContainer: '#CDEBD8',
  },
  Warning: {
    Main: '#E0A15E',
    MainHover: '#E5AC6E',
    MainActive: '#E9B77E',
    MainLine: '#EDC28F',
    OnMain: '#2B1700',
    Container: '#4A3116',
    ContainerHover: '#553A1C',
    ContainerActive: '#604222',
    ContainerLine: '#6B4B28',
    OnContainer: '#F7DFC3',
  },
  Critical: {
    Main: '#E57C7C',
    MainHover: '#E98B8B',
    MainActive: '#EC9A9A',
    MainLine: '#EFA8A8',
    OnMain: '#2E0B0B',
    Container: '#4D1E1F',
    ContainerHover: '#582426',
    ContainerActive: '#632A2C',
    ContainerLine: '#6E3032',
    OnContainer: '#F8D3D3',
  },
  Other: {
    FocusRing: 'rgba(155, 133, 240, 0.55)',
    Shadow: 'rgba(0, 0, 0, 0.45)',
    Overlay: 'rgba(0, 0, 0, 0.5)',
  },
};

const darkPalette: Palette = {
  Background: {
    Container: '#1A1A1A',
    ContainerHover: '#262628',
    ContainerActive: '#363639',
    ContainerLine: '#2F2F31',
    OnContainer: '#ECECEF',
  },
  Surface: {
    Container: '#2B2B2E',
    ContainerHover: '#333336',
    ContainerActive: '#3B3B3E',
    ContainerLine: '#3E3E41',
    OnContainer: '#ECECEF',
  },
  SurfaceVariant: {
    Container: '#363639',
    ContainerHover: '#3E3E41',
    ContainerActive: '#464649',
    ContainerLine: '#464649',
    OnContainer: '#ECECEF',
  },
  ...darkAccents,
};

const midnightPalette: Palette = {
  Background: {
    Container: '#17161D',
    ContainerHover: '#211F29',
    ContainerActive: '#2D2B37',
    ContainerLine: '#2A2833',
    OnContainer: '#E9E8F2',
  },
  Surface: {
    Container: '#22202B',
    ContainerHover: '#2A2834',
    ContainerActive: '#32303D',
    ContainerLine: '#36343F',
    OnContainer: '#E9E8F2',
  },
  SurfaceVariant: {
    Container: '#2D2B37',
    ContainerHover: '#35333F',
    ContainerActive: '#3D3B48',
    ContainerLine: '#403E4A',
    OnContainer: '#E9E8F2',
  },
  ...darkAccents,
};

const butterPalette: Palette = {
  Background: {
    Container: '#1A1916',
    ContainerHover: '#25241F',
    ContainerActive: '#33312B',
    ContainerLine: '#2E2D28',
    OnContainer: '#F0EDE4',
  },
  Surface: {
    Container: '#25231F',
    ContainerHover: '#2D2B26',
    ContainerActive: '#35332D',
    ContainerLine: '#3A3832',
    OnContainer: '#F0EDE4',
  },
  SurfaceVariant: {
    Container: '#302E28',
    ContainerHover: '#38362F',
    ContainerActive: '#403E37',
    ContainerLine: '#45433C',
    OnContainer: '#F0EDE4',
  },
  ...darkAccents,
  Primary: {
    ...darkAccents.Primary,
    Main: '#E3C46B',
    MainHover: '#E8CD7E',
    MainActive: '#ECD690',
    MainLine: '#F0DEA2',
    OnMain: '#2A2108',
    Container: '#4A4123',
    ContainerHover: '#544A29',
    ContainerActive: '#5E532F',
    ContainerLine: '#685C35',
    OnContainer: '#F6EBC8',
  },
};

// The surfaces keep the dark palette's lightness steps in the hue of the timeline's green
// (Surface.Container), and the neutral buttons take the same tint.
const greenPalette: Palette = {
  Background: {
    Container: '#042018',
    ContainerHover: '#112C24',
    ContainerActive: '#213D34',
    ContainerLine: '#1A362D',
    OnContainer: '#F7F7F5',
  },
  Surface: {
    Container: '#103228',
    ContainerHover: '#193A30',
    ContainerActive: '#214238',
    ContainerLine: '#24463B',
    OnContainer: '#F7F7F5',
  },
  SurfaceVariant: {
    Container: '#1C3E33',
    ContainerHover: '#24463B',
    ContainerActive: '#2C4E43',
    ContainerLine: '#2C4E43',
    OnContainer: '#F7F7F5',
  },
  ...darkAccents,
  Primary: {
    Main: '#25FAA1',
    MainHover: '#46FBAF',
    MainActive: '#66FCBD',
    MainLine: '#87FCCB',
    OnMain: '#103228',
    Container: '#0F4B36',
    ContainerHover: '#1A533E',
    ContainerActive: '#235C46',
    ContainerLine: '#2C644E',
    OnContainer: '#DCF7EA',
  },
  Secondary: {
    Main: '#F7F7F5',
    MainHover: '#E9EBE7',
    MainActive: '#DCDFDA',
    MainLine: '#CED2CC',
    OnMain: '#103228',
    Container: '#324840',
    ContainerHover: '#3A5048',
    ContainerActive: '#425850',
    ContainerLine: '#4A6158',
    OnContainer: '#F7F7F5',
  },
  Other: {
    ...darkAccents.Other,
    FocusRing: 'rgba(37, 250, 161, 0.55)',
  },
};

// Blue-black surfaces with an orange primary; the code block background (SurfaceVariant) is
// the navy the surfaces step up to.
const orangePalette: Palette = {
  Background: {
    Container: '#0F161B',
    ContainerHover: '#1B2227',
    ContainerActive: '#2A3237',
    ContainerLine: '#232B30',
    OnContainer: '#FAFAFA',
  },
  Surface: {
    Container: '#19262F',
    ContainerHover: '#212E37',
    ContainerActive: '#28363F',
    ContainerLine: '#2B3942',
    OnContainer: '#FAFAFA',
  },
  SurfaceVariant: {
    Container: '#233440',
    ContainerHover: '#2B3C48',
    ContainerActive: '#324450',
    ContainerLine: '#324450',
    OnContainer: '#FAFAFA',
  },
  ...darkAccents,
  Primary: {
    Main: '#FF5000',
    MainHover: '#FF621A',
    MainActive: '#FF7333',
    MainLine: '#FF844C',
    OnMain: '#0F161B',
    Container: '#622F1D',
    ContainerHover: '#6B3725',
    ContainerActive: '#743F2D',
    ContainerLine: '#7D4835',
    OnContainer: '#FFDCCC',
  },
  Secondary: {
    Main: '#FAFAFA',
    MainHover: '#ECEDEE',
    MainActive: '#DEE0E2',
    MainLine: '#D0D3D6',
    OnMain: '#0F161B',
    Container: '#39444C',
    ContainerHover: '#414C54',
    ContainerActive: '#49545D',
    ContainerLine: '#515D65',
    OnContainer: '#FAFAFA',
  },
  Other: {
    ...darkAccents.Other,
    FocusRing: 'rgba(255, 80, 0, 0.55)',
  },
};

export const lightTheme = createTheme(color, lightPalette);
export const silverTheme = createTheme(color, silverPalette);
export const darkTheme = createTheme(color, darkPalette);
export const midnightTheme = createTheme(color, midnightPalette);
export const butterTheme = createTheme(color, butterPalette);
export const greenTheme = createTheme(color, greenPalette);
export const orangeTheme = createTheme(color, orangePalette);

/** Each theme's page colour, its Background.Container, which the document shows behind the app. */
export const pageColors: Record<ThemeName, string> = {
  light: lightPalette.Background.Container,
  silver: silverPalette.Background.Container,
  dark: darkPalette.Background.Container,
  midnight: midnightPalette.Background.Container,
  butter: butterPalette.Background.Container,
  green: greenPalette.Background.Container,
  orange: orangePalette.Background.Container,
};

// Scrollbars (src/index.css draws them): a thumb that stays visible on every track of a theme
// of its kind. Native controls and scrollbars follow the kind's colour scheme.
globalStyle(`:root, ${LIGHT_THEMES}`, { vars: { '--mr-scrollbar-thumb-color': '#1f1e2659' } });
globalStyle(DARK_THEMES, {
  vars: { '--mr-scrollbar-thumb-color': '#ffffff73' },
  colorScheme: 'dark',
});
globalStyle(LIGHT_THEMES, { colorScheme: 'light' });
