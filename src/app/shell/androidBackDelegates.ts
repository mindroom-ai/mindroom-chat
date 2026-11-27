import type { createStore } from 'jotai';
import { commandPaletteOpenAtom } from '../command-palette/commandPaletteState';
import {
  installAndroidBackButton,
  type AndroidBackButtonDelegates,
} from '../native/androidBackButton';
import { imageViewerOpenAtom } from '../navigation/imageViewerState';
import { runTopEdgeBackAction, SWIPE_PRIORITY } from '../navigation/interactiveSwipe';
import { phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';
import { runLiveHistoryBackSlide } from '../navigation/phonePageSlide';
import { settingsModalAtom, stepBackSettings } from '../navigation/settingsModal';

type JotaiStore = ReturnType<typeof createStore>;

export const createAndroidBackButtonDelegates = (
  store: JotaiStore
): AndroidBackButtonDelegates => ({
  isCommandPaletteOpen: () => store.get(commandPaletteOpenAtom) !== undefined,
  closeCommandPalette: () => store.set(commandPaletteOpenAtom, undefined),
  isImageViewerOpen: () => store.get(imageViewerOpenAtom),
  closeImageViewer: () => store.set(imageViewerOpenAtom, false),
  isSettingsOpen: () => store.get(settingsModalAtom) !== undefined,
  stepBackSettings,
  closeSettings: () => store.set(settingsModalAtom, undefined),
  isPhoneNavDrawerOpen: () => store.get(phoneNavDrawerOpenAtom),
  closePhoneNavDrawer: () => {
    store.set(phoneNavDrawerOpenAtom, false);
  },
  closeSidePanel: () => runTopEdgeBackAction(SWIPE_PRIORITY.PANEL),
  slideHistoryBack: runLiveHistoryBackSlide,
  exitRootPage: () => runTopEdgeBackAction(SWIPE_PRIORITY.PAGE),
});

export const installAppAndroidBackButton = (store: JotaiStore): (() => void) =>
  installAndroidBackButton(createAndroidBackButtonDelegates(store));
