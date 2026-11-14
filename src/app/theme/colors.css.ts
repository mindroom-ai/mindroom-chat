import { createTheme, globalStyle } from '@vanilla-extract/css';
import { color } from 'folds';
import { DARK_THEMES, LIGHT_THEMES, type ThemeName } from '../preferences/themeNames';

// MindRoom's palettes for the folds colour contract. Light and dark follow the reference
// screenshots (docs/design/reference/): neutral greys with a faint violet cast, a violet
// primary, green for success and resolved threads. Silver is a greyer light theme; midnight
// and butter are dark themes with a blue and a warm cast. Green and orange are dark themes on
// deep green and blue-black surfaces with a neon green and an orange primary.
//
// The other palettes tint their surfaces, primary, neutral buttons and focus ring, and keep the
// light or the dark palette's success, warning and critical colours. Sakura, matcha, black,
// ocean, wine and synthwave are the app's own. Catppuccin (Latte and Mocha), Dracula, Gruvbox,
// Nord, Rosé Pine, Solarized and Tokyo Night take the surface, text and accent colours those
// schemes publish (NOTICE, "Colour schemes"); the steps between are mixed here.

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

// Blush surfaces with a raspberry primary.
const sakuraPalette: Palette = {
  Background: {
    Container: '#F7E8EC',
    ContainerHover: '#EEDFE3',
    ContainerActive: '#E4D4D9',
    ContainerLine: '#E8D8DD',
    OnContainer: '#3A2230',
  },
  Surface: {
    Container: '#FFF9FA',
    ContainerHover: '#F7F0F2',
    ContainerActive: '#F0E9EB',
    ContainerLine: '#E5DDE0',
    OnContainer: '#3A2230',
  },
  SurfaceVariant: {
    Container: '#FBEEF1',
    ContainerHover: '#F2E5E8',
    ContainerActive: '#EADCE0',
    ContainerLine: '#E7D9DD',
    OnContainer: '#3A2230',
  },
  ...lightAccents,
  Primary: {
    Main: '#B83B74',
    MainHover: '#A9366B',
    MainActive: '#9E3364',
    MainLine: '#932F5D',
    OnMain: '#FFFFFF',
    Container: '#F8E6ED',
    ContainerHover: '#F3DAE4',
    ContainerActive: '#EFCDDB',
    ContainerLine: '#EAC0D2',
    OnContainer: '#7B284E',
  },
  Secondary: {
    Main: '#3A2230',
    MainHover: '#462F3C',
    MainActive: '#503A47',
    MainLine: '#5A4551',
    OnMain: '#FFFFFF',
    Container: '#E4D4D9',
    ContainerHover: '#DBCBD0',
    ContainerActive: '#D2C1C7',
    ContainerLine: '#CAB8BF',
    OnContainer: '#3A2230',
  },
  Other: {
    FocusRing: 'rgba(184, 59, 116, 0.5)',
    Shadow: 'rgba(58, 34, 48, 0.18)',
    Overlay: 'rgba(58, 34, 48, 0.45)',
  },
};

// Green tea surfaces with a leaf green primary.
const matchaPalette: Palette = {
  Background: {
    Container: '#E9EEDD',
    ContainerHover: '#E0E5D4',
    ContainerActive: '#D5DBCA',
    ContainerLine: '#D9DFCE',
    OnContainer: '#232E1E',
  },
  Surface: {
    Container: '#F8FAF0',
    ContainerHover: '#EFF2E8',
    ContainerActive: '#E8EBE0',
    ContainerLine: '#DCDFD5',
    OnContainer: '#232E1E',
  },
  SurfaceVariant: {
    Container: '#EFF3E4',
    ContainerHover: '#E6EADB',
    ContainerActive: '#DDE1D2',
    ContainerLine: '#DADECF',
    OnContainer: '#232E1E',
  },
  ...lightAccents,
  Primary: {
    Main: '#4F7420',
    MainHover: '#496B1D',
    MainActive: '#44641C',
    MainLine: '#3F5D1A',
    OnMain: '#FFFFFF',
    Container: '#E7EDDB',
    ContainerHover: '#DCE4CE',
    ContainerActive: '#D1DBC0',
    ContainerLine: '#C5D2B2',
    OnContainer: '#354E15',
  },
  Secondary: {
    Main: '#232E1E',
    MainHover: '#303B2C',
    MainActive: '#3B4537',
    MainLine: '#464F42',
    OnMain: '#FFFFFF',
    Container: '#D5DBCA',
    ContainerHover: '#CCD2C1',
    ContainerActive: '#C2C9B8',
    ContainerLine: '#B9C0AF',
    OnContainer: '#232E1E',
  },
  Other: {
    FocusRing: 'rgba(79, 116, 32, 0.5)',
    Shadow: 'rgba(35, 46, 30, 0.18)',
    Overlay: 'rgba(35, 46, 30, 0.45)',
  },
};

// Catppuccin Latte: mantle around base, crust lines, text and mauve.
const catppuccinLattePalette: Palette = {
  Background: {
    Container: '#E6E9EF',
    ContainerHover: '#DFE2E9',
    ContainerActive: '#D7DAE2',
    ContainerLine: '#DCE0E8',
    OnContainer: '#4C4F69',
  },
  Surface: {
    Container: '#EFF1F5',
    ContainerHover: '#E8EBEF',
    ContainerActive: '#E3E5EB',
    ContainerLine: '#DCE0E8',
    OnContainer: '#4C4F69',
  },
  SurfaceVariant: {
    Container: '#EAEDF2',
    ContainerHover: '#E3E6EC',
    ContainerActive: '#DCDFE6',
    ContainerLine: '#D9DCE4',
    OnContainer: '#4C4F69',
  },
  ...lightAccents,
  Primary: {
    Main: '#8839EF',
    MainHover: '#7D34DC',
    MainActive: '#7531CE',
    MainLine: '#6D2EBF',
    OnMain: '#EFF1F5',
    Container: '#E5DFF4',
    ContainerHover: '#DED3F4',
    ContainerActive: '#D7C7F4',
    ContainerLine: '#D0BAF3',
    OnContainer: '#5B26A0',
  },
  Secondary: {
    Main: '#4C4F69',
    MainHover: '#575A72',
    MainActive: '#60627A',
    MainLine: '#696B81',
    OnMain: '#EFF1F5',
    Container: '#D7DAE2',
    ContainerHover: '#CFD2DB',
    ContainerActive: '#C8CBD5',
    ContainerLine: '#C1C4CF',
    OnContainer: '#4C4F69',
  },
  Other: {
    FocusRing: 'rgba(136, 57, 239, 0.5)',
    Shadow: 'rgba(76, 79, 105, 0.18)',
    Overlay: 'rgba(76, 79, 105, 0.45)',
  },
};

// Gruvbox light: the soft background around the medium one, with the faded orange.
const gruvboxLightPalette: Palette = {
  Background: {
    Container: '#F2E5BC',
    ContainerHover: '#E9DDB6',
    ContainerActive: '#E0D4AF',
    ContainerLine: '#E3D7B1',
    OnContainer: '#3C3836',
  },
  Surface: {
    Container: '#FBF1C7',
    ContainerHover: '#F3EAC1',
    ContainerActive: '#EDE3BC',
    ContainerLine: '#E2D9B4',
    OnContainer: '#3C3836',
  },
  SurfaceVariant: {
    Container: '#F6EBC1',
    ContainerHover: '#EEE3BB',
    ContainerActive: '#E5DBB4',
    ContainerLine: '#E2D8B2',
    OnContainer: '#3C3836',
  },
  ...lightAccents,
  Primary: {
    Main: '#AF3A03',
    MainHover: '#A13503',
    MainActive: '#973203',
    MainLine: '#8C2E02',
    OnMain: '#FBF1C7',
    Container: '#F3DFB3',
    ContainerHover: '#EED3A7',
    ContainerActive: '#EAC79A',
    ContainerLine: '#E4BA8C',
    OnContainer: '#752702',
  },
  Secondary: {
    Main: '#3C3836',
    MainHover: '#484442',
    MainActive: '#514E4C',
    MainLine: '#5B5856',
    OnMain: '#FBF1C7',
    Container: '#E0D4AF',
    ContainerHover: '#D7CCA8',
    ContainerActive: '#CFC3A2',
    ContainerLine: '#C6BB9C',
    OnContainer: '#3C3836',
  },
  Other: {
    FocusRing: 'rgba(175, 58, 3, 0.5)',
    Shadow: 'rgba(60, 56, 54, 0.18)',
    Overlay: 'rgba(60, 56, 54, 0.45)',
  },
};

// Solarized light: base2 around base3, with base02 text. The blue is darker than the
// scheme's, to read on both.
const solarizedLightPalette: Palette = {
  Background: {
    Container: '#EEE8D5',
    ContainerHover: '#E3E0CE',
    ContainerActive: '#D7D6C6',
    ContainerLine: '#DCDAC9',
    OnContainer: '#073642',
  },
  Surface: {
    Container: '#FDF6E3',
    ContainerHover: '#F3EEDD',
    ContainerActive: '#EBE8D7',
    ContainerLine: '#DDDDCE',
    OnContainer: '#073642',
  },
  SurfaceVariant: {
    Container: '#F5EFDC',
    ContainerHover: '#EAE7D5',
    ContainerActive: '#E0DECE',
    ContainerLine: '#DCDCCC',
    OnContainer: '#073642',
  },
  ...lightAccents,
  Primary: {
    Main: '#1A69A6',
    MainHover: '#186199',
    MainActive: '#165A8F',
    MainLine: '#155485',
    OnMain: '#FDF6E3',
    Container: '#E6E8DD',
    ContainerHover: '#D8DFD9',
    ContainerActive: '#C9D6D5',
    ContainerLine: '#B9CCD1',
    OnContainer: '#11466F',
  },
  Secondary: {
    Main: '#073642',
    MainHover: '#16424D',
    MainActive: '#224C57',
    MainLine: '#2F5660',
    OnMain: '#FDF6E3',
    Container: '#D7D6C6',
    ContainerHover: '#CCCEBF',
    ContainerActive: '#C1C5B8',
    ContainerLine: '#B7BDB2',
    OnContainer: '#073642',
  },
  Other: {
    FocusRing: 'rgba(26, 105, 166, 0.5)',
    Shadow: 'rgba(7, 54, 66, 0.18)',
    Overlay: 'rgba(7, 54, 66, 0.45)',
  },
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

// True black, for OLED screens, with the dark palette's accents.
const blackPalette: Palette = {
  Background: {
    Container: '#000000',
    ContainerHover: '#0D0D0D',
    ContainerActive: '#1F1F20',
    ContainerLine: '#181819',
    OnContainer: '#F2F2F5',
  },
  Surface: {
    Container: '#0A0A0B',
    ContainerHover: '#141415',
    ContainerActive: '#1D1D1F',
    ContainerLine: '#212122',
    OnContainer: '#F2F2F5',
  },
  SurfaceVariant: {
    Container: '#18181B',
    ContainerHover: '#222225',
    ContainerActive: '#2B2B2E',
    ContainerLine: '#2B2B2E',
    OnContainer: '#F2F2F5',
  },
  ...darkAccents,
};

// Deep navy surfaces with an aqua primary.
const oceanPalette: Palette = {
  Background: {
    Container: '#06192B',
    ContainerHover: '#122536',
    ContainerActive: '#233546',
    ContainerLine: '#1C2F40',
    OnContainer: '#E4F0FA',
  },
  Surface: {
    Container: '#0B2338',
    ContainerHover: '#142C40',
    ContainerActive: '#1D3448',
    ContainerLine: '#21384B',
    OnContainer: '#E4F0FA',
  },
  SurfaceVariant: {
    Container: '#123049',
    ContainerHover: '#1B3851',
    ContainerActive: '#244159',
    ContainerLine: '#244159',
    OnContainer: '#E4F0FA',
  },
  ...darkAccents,
  Primary: {
    Main: '#4FD8E8',
    MainHover: '#65DDEB',
    MainActive: '#7BE2EE',
    MainLine: '#91E7F1',
    OnMain: '#06192B',
    Container: '#1A4B5F',
    ContainerHover: '#245366',
    ContainerActive: '#2F5B6D',
    ContainerLine: '#396375',
    OnContainer: '#CEF4F9',
  },
  Secondary: {
    Main: '#E4F0FA',
    MainHover: '#D7E3EE',
    MainActive: '#C9D6E1',
    MainLine: '#BCC9D5',
    OnMain: '#06192B',
    Container: '#213D55',
    ContainerHover: '#2B465D',
    ContainerActive: '#354E64',
    ContainerLine: '#3F576C',
    OnContainer: '#E4F0FA',
  },
  Other: {
    ...darkAccents.Other,
    FocusRing: 'rgba(79, 216, 232, 0.55)',
  },
};

// Burgundy surfaces with a champagne gold primary.
const winePalette: Palette = {
  Background: {
    Container: '#1C0E15',
    ContainerHover: '#281A21',
    ContainerActive: '#392B31',
    ContainerLine: '#32242B',
    OnContainer: '#F8ECEF',
  },
  Surface: {
    Container: '#27131D',
    ContainerHover: '#301C26',
    ContainerActive: '#39252F',
    ContainerLine: '#3C2932',
    OnContainer: '#F8ECEF',
  },
  SurfaceVariant: {
    Container: '#351B28',
    ContainerHover: '#3E2431',
    ContainerActive: '#462D3A',
    ContainerLine: '#462D3A',
    OnContainer: '#F8ECEF',
  },
  ...darkAccents,
  Primary: {
    Main: '#E9C07B',
    MainHover: '#ECC88C',
    MainActive: '#EFD09C',
    MainLine: '#F1D8AD',
    OnMain: '#1C0E15',
    Container: '#523932',
    ContainerHover: '#5A423B',
    ContainerActive: '#624B44',
    ContainerLine: '#69544E',
    OnContainer: '#F9EDDA',
  },
  Secondary: {
    Main: '#F8ECEF',
    MainHover: '#EBDFE2',
    MainActive: '#DED1D5',
    MainLine: '#D0C4C8',
    OnMain: '#1C0E15',
    Container: '#432A36',
    ContainerHover: '#4B343F',
    ContainerActive: '#543D48',
    ContainerLine: '#5C4751',
    OnContainer: '#F8ECEF',
  },
  Other: {
    ...darkAccents.Other,
    FocusRing: 'rgba(233, 192, 123, 0.55)',
  },
};

// Violet-black surfaces with a neon pink primary and a cyan focus ring.
const synthwavePalette: Palette = {
  Background: {
    Container: '#1A1030',
    ContainerHover: '#261C3B',
    ContainerActive: '#362D4B',
    ContainerLine: '#302645',
    OnContainer: '#F5EEFF',
  },
  Surface: {
    Container: '#221741',
    ContainerHover: '#2B2049',
    ContainerActive: '#342951',
    ContainerLine: '#372D54',
    OnContainer: '#F5EEFF',
  },
  SurfaceVariant: {
    Container: '#2E2054',
    ContainerHover: '#37295C',
    ContainerActive: '#403263',
    ContainerLine: '#403263',
    OnContainer: '#F5EEFF',
  },
  ...darkAccents,
  Primary: {
    Main: '#FF6AD5',
    MainHover: '#FF7DDA',
    MainActive: '#FF8FE0',
    MainLine: '#FFA2E5',
    OnMain: '#1A1030',
    Container: '#532962',
    ContainerHover: '#5B3369',
    ContainerActive: '#623C70',
    ContainerLine: '#6A4677',
    OnContainer: '#FFD5F3',
  },
  Secondary: {
    Main: '#F5EEFF',
    MainHover: '#E8E1F3',
    MainActive: '#DBD3E6',
    MainLine: '#CEC6DA',
    OnMain: '#1A1030',
    Container: '#3C2E60',
    ContainerHover: '#453767',
    ContainerActive: '#4E416E',
    ContainerLine: '#564A75',
    OnContainer: '#F5EEFF',
  },
  Other: {
    ...darkAccents.Other,
    FocusRing: 'rgba(54, 249, 246, 0.55)',
  },
};

// Catppuccin Mocha: mantle around base, surface0 for code, text and mauve.
const catppuccinMochaPalette: Palette = {
  Background: {
    Container: '#181825',
    ContainerHover: '#222230',
    ContainerActive: '#303140',
    ContainerLine: '#2A2B3A',
    OnContainer: '#CDD6F4',
  },
  Surface: {
    Container: '#1E1E2E',
    ContainerHover: '#252636',
    ContainerActive: '#2D2D3F',
    ContainerLine: '#313244',
    OnContainer: '#CDD6F4',
  },
  SurfaceVariant: {
    Container: '#313244',
    ContainerHover: '#38394C',
    ContainerActive: '#45475A',
    ContainerLine: '#45475A',
    OnContainer: '#CDD6F4',
  },
  ...darkAccents,
  Primary: {
    Main: '#CBA6F7',
    MainHover: '#D2B1F8',
    MainActive: '#D8BCF9',
    MainLine: '#DFC7FA',
    OnMain: '#181825',
    Container: '#443C5A',
    ContainerHover: '#4C4561',
    ContainerActive: '#554E69',
    ContainerLine: '#5D5670',
    OnContainer: '#F0E6FD',
  },
  Secondary: {
    Main: '#CDD6F4',
    MainHover: '#C2CBE8',
    MainActive: '#B7BFDB',
    MainLine: '#ACB4CF',
    OnMain: '#181825',
    Container: '#3C3D50',
    ContainerHover: '#454658',
    ContainerActive: '#4E4E60',
    ContainerLine: '#565768',
    OnContainer: '#CDD6F4',
  },
  Other: {
    ...darkAccents.Other,
    FocusRing: 'rgba(203, 166, 247, 0.55)',
  },
};

// Dracula: its background, a darker shade around it, the current line and purple.
const draculaPalette: Palette = {
  Background: {
    Container: '#21222C',
    ContainerHover: '#2D2E37',
    ContainerActive: '#3D3E46',
    ContainerLine: '#373740',
    OnContainer: '#F8F8F2',
  },
  Surface: {
    Container: '#282A36',
    ContainerHover: '#31333E',
    ContainerActive: '#393B46',
    ContainerLine: '#3D3F49',
    OnContainer: '#F8F8F2',
  },
  SurfaceVariant: {
    Container: '#343746',
    ContainerHover: '#3D3F4E',
    ContainerActive: '#44475A',
    ContainerLine: '#44475A',
    OnContainer: '#F8F8F2',
  },
  ...darkAccents,
  Primary: {
    Main: '#BD93F9',
    MainHover: '#C5A1FA',
    MainActive: '#CEAEFB',
    MainLine: '#D6BCFB',
    OnMain: '#21222C',
    Container: '#494161',
    ContainerHover: '#514A68',
    ContainerActive: '#59526F',
    ContainerLine: '#625B76',
    OnContainer: '#EDE1FD',
  },
  Secondary: {
    Main: '#F8F8F2',
    MainHover: '#EBEBE6',
    MainActive: '#DEDEDA',
    MainLine: '#D1D1CE',
    OnMain: '#21222C',
    Container: '#424552',
    ContainerHover: '#4B4D5A',
    ContainerActive: '#535662',
    ContainerLine: '#5C5E69',
    OnContainer: '#F8F8F2',
  },
  Other: {
    ...darkAccents.Other,
    FocusRing: 'rgba(189, 147, 249, 0.55)',
  },
};

// Gruvbox dark: the hard, medium and soft backgrounds, with the bright orange.
const gruvboxDarkPalette: Palette = {
  Background: {
    Container: '#1D2021',
    ContainerHover: '#282A29',
    ContainerActive: '#383834',
    ContainerLine: '#323330',
    OnContainer: '#EBDBB2',
  },
  Surface: {
    Container: '#282828',
    ContainerHover: '#30302E',
    ContainerActive: '#383734',
    ContainerLine: '#3C3836',
    OnContainer: '#EBDBB2',
  },
  SurfaceVariant: {
    Container: '#32302F',
    ContainerHover: '#3A3835',
    ContainerActive: '#423F3B',
    ContainerLine: '#423F3B',
    OnContainer: '#EBDBB2',
  },
  ...darkAccents,
  Primary: {
    Main: '#FE8019',
    MainHover: '#FE9036',
    MainActive: '#FEA053',
    MainLine: '#FEB06F',
    OnMain: '#1D2021',
    Container: '#573B25',
    ContainerHover: '#5F442F',
    ContainerActive: '#664D39',
    ContainerLine: '#6E5542',
    OnContainer: '#FFDBBF',
  },
  Secondary: {
    Main: '#EBDBB2',
    MainHover: '#DFD0A9',
    MainActive: '#D2C5A1',
    MainLine: '#C6B998',
    OnMain: '#1D2021',
    Container: '#3F3C38',
    ContainerHover: '#484541',
    ContainerActive: '#504E4A',
    ContainerLine: '#595653',
    OnContainer: '#EBDBB2',
  },
  Other: {
    ...darkAccents.Other,
    FocusRing: 'rgba(254, 128, 25, 0.55)',
  },
};

// Nord: Polar Night surfaces, Snow Storm text and the Frost blue nord8.
const nordPalette: Palette = {
  Background: {
    Container: '#242933',
    ContainerHover: '#2E3440',
    ContainerActive: '#3B4252',
    ContainerLine: '#383D46',
    OnContainer: '#ECEFF4',
  },
  Surface: {
    Container: '#2E3440',
    ContainerHover: '#363C48',
    ContainerActive: '#3B4252',
    ContainerLine: '#434C5E',
    OnContainer: '#ECEFF4',
  },
  SurfaceVariant: {
    Container: '#353B49',
    ContainerHover: '#3B4252',
    ContainerActive: '#434C5E',
    ContainerLine: '#434C5E',
    OnContainer: '#ECEFF4',
  },
  ...darkAccents,
  Primary: {
    Main: '#88C0D0',
    MainHover: '#97C8D6',
    MainActive: '#A6D0DC',
    MainLine: '#B5D8E2',
    OnMain: '#242933',
    Container: '#3B4854',
    ContainerHover: '#44505C',
    ContainerActive: '#4D5863',
    ContainerLine: '#55616B',
    OnContainer: '#DEEDF2',
  },
  Secondary: {
    Main: '#ECEFF4',
    MainHover: '#E0E3E8',
    MainActive: '#D4D7DD',
    MainLine: '#C8CBD1',
    OnMain: '#242933',
    Container: '#3C4250',
    ContainerHover: '#454B58',
    ContainerActive: '#4E5360',
    ContainerLine: '#565C68',
    OnContainer: '#ECEFF4',
  },
  Other: {
    ...darkAccents.Other,
    FocusRing: 'rgba(136, 192, 208, 0.55)',
  },
};

// Rosé Pine: base, surface and overlay, with text and rose.
const rosePinePalette: Palette = {
  Background: {
    Container: '#191724',
    ContainerHover: '#24222F',
    ContainerActive: '#33313F',
    ContainerLine: '#2D2B39',
    OnContainer: '#E0DEF4',
  },
  Surface: {
    Container: '#1F1D2E',
    ContainerHover: '#272536',
    ContainerActive: '#2F2D3F',
    ContainerLine: '#323042',
    OnContainer: '#E0DEF4',
  },
  SurfaceVariant: {
    Container: '#26233A',
    ContainerHover: '#2E2B42',
    ContainerActive: '#36334A',
    ContainerLine: '#403D52',
    OnContainer: '#E0DEF4',
  },
  ...darkAccents,
  Primary: {
    Main: '#EBBCBA',
    MainHover: '#EEC4C3',
    MainActive: '#F0CDCB',
    MainLine: '#F3D5D4',
    OnMain: '#191724',
    Container: '#4C404D',
    ContainerHover: '#544955',
    ContainerActive: '#5C515D',
    ContainerLine: '#645A65',
    OnContainer: '#F9ECEC',
  },
  Secondary: {
    Main: '#E0DEF4',
    MainHover: '#D4D2E8',
    MainActive: '#C8C6DB',
    MainLine: '#BCBACF',
    OnMain: '#191724',
    Container: '#333047',
    ContainerHover: '#3C394F',
    ContainerActive: '#454358',
    ContainerLine: '#4F4C60',
    OnContainer: '#E0DEF4',
  },
  Other: {
    ...darkAccents.Other,
    FocusRing: 'rgba(235, 188, 186, 0.55)',
  },
};

// Solarized dark: base03 and base02 on a darker shade, with base2 text. The blue is lighter
// than the scheme's, to read on both.
const solarizedDarkPalette: Palette = {
  Background: {
    Container: '#00212B',
    ContainerHover: '#0D2C34',
    ContainerActive: '#1F3B41',
    ContainerLine: '#18353C',
    OnContainer: '#EEE8D5',
  },
  Surface: {
    Container: '#002B36',
    ContainerHover: '#0A333D',
    ContainerActive: '#143B43',
    ContainerLine: '#183E46',
    OnContainer: '#EEE8D5',
  },
  SurfaceVariant: {
    Container: '#073642',
    ContainerHover: '#113E48',
    ContainerActive: '#1B464F',
    ContainerLine: '#1B464F',
    OnContainer: '#EEE8D5',
  },
  ...darkAccents,
  Primary: {
    Main: '#4AA3E8',
    MainHover: '#61AFEB',
    MainActive: '#77BAEE',
    MainLine: '#8EC6F1',
    OnMain: '#00212B',
    Container: '#10455D',
    ContainerHover: '#1B4D64',
    ContainerActive: '#26566C',
    ContainerLine: '#305E73',
    OnContainer: '#CCE5F9',
  },
  Secondary: {
    Main: '#EEE8D5',
    MainHover: '#E0DCCB',
    MainActive: '#D1D0C1',
    MainLine: '#C3C4B6',
    OnMain: '#00212B',
    Container: '#17424C',
    ContainerHover: '#214B54',
    ContainerActive: '#2C535C',
    ContainerLine: '#365C64',
    OnContainer: '#EEE8D5',
  },
  Other: {
    ...darkAccents.Other,
    FocusRing: 'rgba(74, 163, 232, 0.55)',
  },
};

// Tokyo Night: the night backgrounds, the storm one for code, and blue.
const tokyoNightPalette: Palette = {
  Background: {
    Container: '#16161E',
    ContainerHover: '#1F202A',
    ContainerActive: '#2C2D3A',
    ContainerLine: '#272834',
    OnContainer: '#C0CAF5',
  },
  Surface: {
    Container: '#1A1B26',
    ContainerHover: '#21222F',
    ContainerActive: '#282A37',
    ContainerLine: '#292E42',
    OnContainer: '#C0CAF5',
  },
  SurfaceVariant: {
    Container: '#24283B',
    ContainerHover: '#2B2F43',
    ContainerActive: '#32364B',
    ContainerLine: '#32364B',
    OnContainer: '#C0CAF5',
  },
  ...darkAccents,
  Primary: {
    Main: '#7AA2F7',
    MainHover: '#8BAEF8',
    MainActive: '#9BB9F9',
    MainLine: '#ACC5FA',
    OnMain: '#16161E',
    Container: '#2F3954',
    ContainerHover: '#38425C',
    ContainerActive: '#424B63',
    ContainerLine: '#4B546B',
    OnContainer: '#DAE5FD',
  },
  Secondary: {
    Main: '#C0CAF5',
    MainHover: '#B6BFE8',
    MainActive: '#ACB4DB',
    MainLine: '#A1AACE',
    OnMain: '#16161E',
    Container: '#2F3348',
    ContainerHover: '#383C50',
    ContainerActive: '#424558',
    ContainerLine: '#4B4F61',
    OnContainer: '#C0CAF5',
  },
  Other: {
    ...darkAccents.Other,
    FocusRing: 'rgba(122, 162, 247, 0.55)',
  },
};

export const lightTheme = createTheme(color, lightPalette);
export const silverTheme = createTheme(color, silverPalette);
export const sakuraTheme = createTheme(color, sakuraPalette);
export const matchaTheme = createTheme(color, matchaPalette);
export const catppuccinLatteTheme = createTheme(color, catppuccinLattePalette);
export const gruvboxLightTheme = createTheme(color, gruvboxLightPalette);
export const solarizedLightTheme = createTheme(color, solarizedLightPalette);
export const darkTheme = createTheme(color, darkPalette);
export const midnightTheme = createTheme(color, midnightPalette);
export const butterTheme = createTheme(color, butterPalette);
export const greenTheme = createTheme(color, greenPalette);
export const orangeTheme = createTheme(color, orangePalette);
export const blackTheme = createTheme(color, blackPalette);
export const oceanTheme = createTheme(color, oceanPalette);
export const wineTheme = createTheme(color, winePalette);
export const synthwaveTheme = createTheme(color, synthwavePalette);
export const catppuccinMochaTheme = createTheme(color, catppuccinMochaPalette);
export const draculaTheme = createTheme(color, draculaPalette);
export const gruvboxDarkTheme = createTheme(color, gruvboxDarkPalette);
export const nordTheme = createTheme(color, nordPalette);
export const rosePineTheme = createTheme(color, rosePinePalette);
export const solarizedDarkTheme = createTheme(color, solarizedDarkPalette);
export const tokyoNightTheme = createTheme(color, tokyoNightPalette);

/** Each theme's page colour, its Background.Container, which the document shows behind the app. */
export const pageColors: Record<ThemeName, string> = {
  light: lightPalette.Background.Container,
  silver: silverPalette.Background.Container,
  sakura: sakuraPalette.Background.Container,
  matcha: matchaPalette.Background.Container,
  catppuccinLatte: catppuccinLattePalette.Background.Container,
  gruvboxLight: gruvboxLightPalette.Background.Container,
  solarizedLight: solarizedLightPalette.Background.Container,
  dark: darkPalette.Background.Container,
  midnight: midnightPalette.Background.Container,
  butter: butterPalette.Background.Container,
  green: greenPalette.Background.Container,
  orange: orangePalette.Background.Container,
  black: blackPalette.Background.Container,
  ocean: oceanPalette.Background.Container,
  wine: winePalette.Background.Container,
  synthwave: synthwavePalette.Background.Container,
  catppuccinMocha: catppuccinMochaPalette.Background.Container,
  dracula: draculaPalette.Background.Container,
  gruvboxDark: gruvboxDarkPalette.Background.Container,
  nord: nordPalette.Background.Container,
  rosePine: rosePinePalette.Background.Container,
  solarizedDark: solarizedDarkPalette.Background.Container,
  tokyoNight: tokyoNightPalette.Background.Container,
};

// Scrollbars (src/index.css draws them): a thumb that stays visible on every track of a theme
// of its kind. Native controls and scrollbars follow the kind's colour scheme.
globalStyle(`:root, ${LIGHT_THEMES}`, { vars: { '--mr-scrollbar-thumb-color': '#1f1e2659' } });
globalStyle(DARK_THEMES, {
  vars: { '--mr-scrollbar-thumb-color': '#ffffff73' },
  colorScheme: 'dark',
});
globalStyle(LIGHT_THEMES, { colorScheme: 'light' });
