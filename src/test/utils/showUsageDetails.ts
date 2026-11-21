import { getDefaultStore } from 'jotai';
import { getSettings, settingsAtom } from '../../app/preferences/settings';

/**
 * Shows usage and current activity for sub-agents and jobs, plus models in the jobs bar, as a reader who turned
 * them on in Settings (`showUsageDetails`), or hides them again (`shown` false), as they start.
 */
export const showUsageDetails = (shown = true): void => {
  getDefaultStore().set(settingsAtom, { ...getSettings(), showUsageDetails: shown });
};
