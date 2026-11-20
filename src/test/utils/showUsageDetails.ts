import { getDefaultStore } from 'jotai';
import { getSettings, settingsAtom } from '../../app/preferences/settings';

/**
 * Shows sub-agents' and background jobs' calls, tokens, cost and model, as a reader who turned
 * them on in Settings (`showUsageDetails`), or hides them again (`shown` false), as they start.
 */
export const showUsageDetails = (shown = true): void => {
  getDefaultStore().set(settingsAtom, { ...getSettings(), showUsageDetails: shown });
};
