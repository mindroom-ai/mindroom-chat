import MindRoomLogo from '../../../../public/res/branding/mindroom-logo.png';
import MindRoomFavicon from '../../../../public/res/branding/mindroom-favicon.png';

export const MINDROOM_APP_NAME = 'MindRoom Chat';
/** The name a new session (Matrix device) gets, by the app it signs in from. */
export const MINDROOM_DEVICE_DISPLAY_NAMES = {
  web: `${MINDROOM_APP_NAME} Web`,
  ios: `${MINDROOM_APP_NAME} iOS`,
  android: `${MINDROOM_APP_NAME} Android`,
  macos: `${MINDROOM_APP_NAME} macOS`,
} as const;
export const MINDROOM_NOTIFICATION_BRAND = MINDROOM_APP_NAME;

export const MINDROOM_SITE_URL = 'https://mindroom.chat';
export const MINDROOM_SOURCE_URL = 'https://github.com/mindroom-ai/mindroom';
export const MINDROOM_CHAT_SOURCE_URL = 'https://github.com/mindroom-ai/mindroom-chat';
export const MINDROOM_DOCS_URL = 'https://docs.mindroom.chat/';

export const MINDROOM_LOGO_SRC = MindRoomLogo;
export const MINDROOM_LOGO_ALT = 'MindRoom Chat Logo';
export const MINDROOM_FAVICON_SRC = MindRoomFavicon;

export type PoweredByLink = {
  label: string;
  url: string;
};

export const MINDROOM_DEFAULT_POWERED_BY: PoweredByLink[] = [
  { label: 'MindRoom', url: MINDROOM_SITE_URL },
  { label: 'Matrix', url: 'https://matrix.org' },
];
