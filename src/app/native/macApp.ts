import { isMacOS } from '../lib/user-agent';
import { isNativeApp } from './nativeSso';

/** The newest release's Mac disk image: every release attaches one under this name. */
export const MAC_APP_DOWNLOAD_URL =
  'https://github.com/mindroom-ai/mindroom-chat/releases/latest/download/MindRoom.dmg';

/** Installs the Mac app with Homebrew, from MindRoom's tap. */
export const MAC_APP_BREW_COMMAND = 'brew install --cask mindroom-ai/tap/mindroom-chat';

/**
 * Whether to point at the Mac app: in a browser on a Mac (iPadOS, which reports a Mac, is not
 * one), never inside the app itself, which runs this client in its own shell.
 */
export const offersMacApp = (): boolean => isMacOS() && !isNativeApp();
