import { getDefaultStore } from 'jotai';
import { getSettings, settingsAtom } from '../../app/preferences/settings';

/**
 * Shows agent replies' tool calls, as a reader who turned them on in Settings: the tests of how
 * tool calls render start each test with it, since they start hidden.
 */
export const showToolCalls = (): void => {
  getDefaultStore().set(settingsAtom, { ...getSettings(), showToolCalls: true });
};
