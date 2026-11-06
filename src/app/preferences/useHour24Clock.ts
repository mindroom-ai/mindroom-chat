import { useTranslation } from 'react-i18next';
import { languageUses24HourClock } from '../lib/time';
import { settingsAtom } from './settings';
import { useSetting } from './useSetting';

/**
 * Whether times show on a 24-hour clock: the user's choice, else the app language's own clock
 * (German "14:40", English "2:40 PM"). The setter records a choice.
 */
export const useHour24Clock = (): [boolean, (on: boolean) => void] => {
  const { i18n } = useTranslation();
  const [chosen, setChosen] = useSetting(settingsAtom, 'hour24Clock');
  return [chosen ?? languageUses24HourClock(i18n.language), setChosen];
};
