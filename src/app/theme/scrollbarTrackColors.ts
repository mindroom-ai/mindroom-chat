const darkAccentTrackColors = {
  Primary: '#423C6C',
  Success: '#175030',
  Warning: '#5E3B05',
  Critical: '#68312D',
} as const;

export const scrollbarTrackColors = {
  light: {
    Background: '#E7E7EB',
    Surface: '#F6F6FB',
    SurfaceVariant: '#ECECF0',
    Primary: '#E4E3FF',
    Secondary: '#D4D4D8',
    Success: '#D2EFDB',
    Warning: '#F8E2CA',
    Critical: '#FFDDD9',
  },
  silver: {
    Background: '#D0D0D4',
    Surface: '#E7E7EB',
    SurfaceVariant: '#D9D9DD',
    Primary: '#E4E3FF',
    Secondary: '#CACACE',
    Success: '#D2EFDB',
    Warning: '#F8E2CA',
    Critical: '#FFDDD9',
  },
  dark: {
    Background: '#2B2B2E',
    Surface: '#363639',
    SurfaceVariant: '#424144',
    Secondary: '#424144',
    ...darkAccentTrackColors,
  },
  midnight: {
    Background: '#2B2A36',
    Surface: '#363542',
    SurfaceVariant: '#41404D',
    Secondary: '#41404D',
    ...darkAccentTrackColors,
  },
  butter: {
    Background: '#2D2B24',
    Surface: '#39372F',
    SurfaceVariant: '#44423A',
    Secondary: '#44423A',
    ...darkAccentTrackColors,
  },
} as const;
