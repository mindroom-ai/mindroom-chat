import { createTheme } from '@vanilla-extract/css';
import { color } from 'folds';

// MindRoom's palettes for the folds colour contract. Light and dark follow the reference
// screenshots (docs/design/reference/): neutral greys with a faint violet cast, a violet
// primary, green for success and resolved threads. Silver is a greyer light theme; midnight
// and butter are dark themes with a blue and a warm cast.

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
    ContainerLine: '#D6D6DB',
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

// Everything below this line is a dark palette; scrollbarTheme.test.ts reads their hover tracks.
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
    Main: '#5EA87B',
    MainHover: '#6BB287',
    MainActive: '#78BC93',
    MainLine: '#85C59F',
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

export const lightTheme = createTheme(color, lightPalette);
export const silverTheme = createTheme(color, silverPalette);
export const darkTheme = createTheme(color, darkPalette);
export const midnightTheme = createTheme(color, midnightPalette);
export const butterTheme = createTheme(color, butterPalette);
