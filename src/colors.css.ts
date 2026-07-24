import { createTheme } from '@vanilla-extract/css';
import { color } from 'folds';

// Modern light palette: cool neutrals, soft-black text, indigo primary aligned
// with the dark themes' lavender accent. Replaces the folds default light theme.
const lightThemeData = {
  Background: {
    Container: '#ECEEF3',
    ContainerHover: '#E1E5EC',
    ContainerActive: '#D6DBE5',
    ContainerLine: '#C4CBD8',
    OnContainer: '#17181C',
  },

  Surface: {
    Container: '#FFFFFF',
    ContainerHover: '#F3F5F9',
    ContainerActive: '#E7EBF2',
    ContainerLine: '#DFE4EC',
    OnContainer: '#17181C',
  },

  SurfaceVariant: {
    Container: '#F0F2F7',
    ContainerHover: '#E4E8F0',
    ContainerActive: '#D9DEE9',
    ContainerLine: '#CDD4E1',
    OnContainer: '#17181C',
  },

  Primary: {
    Main: '#5B54E6',
    MainHover: '#5249DC',
    MainActive: '#4A41D2',
    MainLine: '#4239C8',
    OnMain: '#FFFFFF',
    Container: '#E3E2FB',
    ContainerHover: '#D8D6F9',
    ContainerActive: '#CCC9F7',
    ContainerLine: '#BFBBF4',
    OnContainer: '#2F2A8C',
  },

  Secondary: {
    Main: '#17181C',
    MainHover: '#26282E',
    MainActive: '#30333A',
    MainLine: '#3B3E46',
    OnMain: '#FFFFFF',
    Container: '#DFE2E8',
    ContainerHover: '#D3D7DF',
    ContainerActive: '#C6CBD5',
    ContainerLine: '#B9BFCA',
    OnContainer: '#17181C',
  },

  Success: {
    Main: '#0E9F6E',
    MainHover: '#0C8E62',
    MainActive: '#0B7E57',
    MainLine: '#096E4C',
    OnMain: '#FFFFFF',
    Container: '#D8F1E6',
    ContainerHover: '#C8EBDC',
    ContainerActive: '#B6E4D0',
    ContainerLine: '#A3DCC3',
    OnContainer: '#085C3E',
  },

  Warning: {
    Main: '#B45309',
    MainHover: '#A34B08',
    MainActive: '#924407',
    MainLine: '#813C06',
    OnMain: '#FFFFFF',
    Container: '#FBEEDA',
    ContainerHover: '#F8E5C8',
    ContainerActive: '#F4DBB4',
    ContainerLine: '#EFCF9E',
    OnContainer: '#6B3A04',
  },

  Critical: {
    Main: '#D92D20',
    MainHover: '#C4271C',
    MainActive: '#B02218',
    MainLine: '#9B1D14',
    OnMain: '#FFFFFF',
    Container: '#FCDFDC',
    ContainerHover: '#FBCFCB',
    ContainerActive: '#F9BEB8',
    ContainerLine: '#F6ACA4',
    OnContainer: '#8A1C13',
  },

  Other: {
    FocusRing: 'rgba(23 24 28 / 45%)',
    Shadow: 'rgba(23 24 28 / 16%)',
    Overlay: 'rgba(23 24 28 / 50%)',
  },
};

export const lightThemeColors = createTheme(color, lightThemeData);

// Silver: same modern ladder as light, but with a deeper gray backdrop so the
// two light themes stay visually distinct.
export const silverTheme = createTheme(color, {
  ...lightThemeData,
  Background: {
    Container: '#DFE2E9',
    ContainerHover: '#D4D8E1',
    ContainerActive: '#C9CEDA',
    ContainerLine: '#B6BDCC',
    OnContainer: '#17181C',
  },
});

const darkThemeData = {
  Background: {
    Container: '#1A1A1A',
    ContainerHover: '#25262B',
    ContainerActive: '#313237',
    ContainerLine: '#3E3F46',
    OnContainer: '#F2F2F2',
  },

  Surface: {
    Container: '#25262B',
    ContainerHover: '#313237',
    ContainerActive: '#3E3F46',
    ContainerLine: '#4B4C55',
    OnContainer: '#F2F2F2',
  },

  SurfaceVariant: {
    Container: '#313237',
    ContainerHover: '#3E3F46',
    ContainerActive: '#4B4C55',
    ContainerLine: '#575863',
    OnContainer: '#F2F2F2',
  },

  Primary: {
    Main: '#BDB6EC',
    MainHover: '#B2AAE9',
    MainActive: '#ADA3E8',
    MainLine: '#A79DE6',
    OnMain: '#2C2843',
    Container: '#413C65',
    ContainerHover: '#494370',
    ContainerActive: '#50497B',
    ContainerLine: '#575086',
    OnContainer: '#E3E1F7',
  },

  Secondary: {
    Main: '#FFFFFF',
    MainHover: '#E5E5E5',
    MainActive: '#D9D9D9',
    MainLine: '#CCCCCC',
    OnMain: '#1A1A1A',
    Container: '#404040',
    ContainerHover: '#4D4D4D',
    ContainerActive: '#595959',
    ContainerLine: '#666666',
    OnContainer: '#F2F2F2',
  },

  Success: {
    Main: '#85E0BA',
    MainHover: '#70DBAF',
    MainActive: '#66D9A9',
    MainLine: '#5CD6A3',
    OnMain: '#0F3D2A',
    Container: '#175C3F',
    ContainerHover: '#1A6646',
    ContainerActive: '#1C704D',
    ContainerLine: '#1F7A54',
    OnContainer: '#CCF2E2',
  },

  Warning: {
    Main: '#E3BA91',
    MainHover: '#DFAF7E',
    MainActive: '#DDA975',
    MainLine: '#DAA36C',
    OnMain: '#3F2A15',
    Container: '#5E3F20',
    ContainerHover: '#694624',
    ContainerActive: '#734D27',
    ContainerLine: '#7D542B',
    OnContainer: '#F3E2D1',
  },

  Critical: {
    Main: '#E69D9D',
    MainHover: '#E28D8D',
    MainActive: '#E08585',
    MainLine: '#DE7D7D',
    OnMain: '#401C1C',
    Container: '#602929',
    ContainerHover: '#6B2E2E',
    ContainerActive: '#763333',
    ContainerLine: '#803737',
    OnContainer: '#F5D6D6',
  },

  Other: {
    FocusRing: 'rgba(255, 255, 255, 0.5)',
    Shadow: 'rgba(0, 0, 0, 0.55)',
    Overlay: 'rgba(0, 0, 0, 0.8)',
  },
};

export const darkTheme = createTheme(color, darkThemeData);

// Dark surfaces tinted toward the lavender primary (hue ~247°, same lightness
// steps as the neutral dark ladder), with a softer shadow color.
export const midnightTheme = createTheme(color, {
  ...darkThemeData,
  Background: {
    Container: '#17161D',
    ContainerHover: '#23222A',
    ContainerActive: '#2F2E38',
    ContainerLine: '#3C3B45',
    OnContainer: '#F2F2F2',
  },

  Surface: {
    Container: '#23222A',
    ContainerHover: '#2F2E38',
    ContainerActive: '#3C3B45',
    ContainerLine: '#484753',
    OnContainer: '#F2F2F2',
  },

  SurfaceVariant: {
    Container: '#2F2E38',
    ContainerHover: '#3C3B45',
    ContainerActive: '#484753',
    ContainerLine: '#55545F',
    OnContainer: '#F2F2F2',
  },

  Secondary: {
    Main: '#FFFFFF',
    MainHover: '#E5E5E5',
    MainActive: '#D9D9D9',
    MainLine: '#CCCCCC',
    OnMain: '#17161D',
    Container: '#3C3B45',
    ContainerHover: '#484753',
    ContainerActive: '#55545F',
    ContainerLine: '#61606D',
    OnContainer: '#F2F2F2',
  },

  Other: {
    FocusRing: 'rgba(255, 255, 255, 0.5)',
    Shadow: 'rgba(0, 0, 0, 0.6)',
    Overlay: 'rgba(0, 0, 0, 0.8)',
  },
});

export const butterTheme = createTheme(color, {
  ...darkThemeData,
  Background: {
    Container: '#1A1916',
    ContainerHover: '#262621',
    ContainerActive: '#33322C',
    ContainerLine: '#403F38',
    OnContainer: '#FFFBDE',
  },

  Surface: {
    Container: '#262621',
    ContainerHover: '#33322C',
    ContainerActive: '#403F38',
    ContainerLine: '#4D4B43',
    OnContainer: '#FFFBDE',
  },

  SurfaceVariant: {
    Container: '#33322C',
    ContainerHover: '#403F38',
    ContainerActive: '#4D4B43',
    ContainerLine: '#59584E',
    OnContainer: '#FFFBDE',
  },

  Secondary: {
    Main: '#FFFBDE',
    MainHover: '#E5E2C8',
    MainActive: '#D9D5BD',
    MainLine: '#CCC9B2',
    OnMain: '#1A1916',
    Container: '#403F38',
    ContainerHover: '#4D4B43',
    ContainerActive: '#59584E',
    ContainerLine: '#666459',
    OnContainer: '#F2EED3',
  },
});
