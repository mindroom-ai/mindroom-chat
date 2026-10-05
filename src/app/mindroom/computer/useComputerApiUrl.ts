import { useAtomValue } from 'jotai';
import { useClientConfig } from '../../hooks/useClientConfig';
import {
  computerServicePreferenceAtom,
  resolveComputerServiceUrl,
} from './computerServiceSettings';

export const useComputerApiUrl = (): string | undefined => {
  const preference = useAtomValue(computerServicePreferenceAtom);
  const config = useClientConfig();
  return resolveComputerServiceUrl(preference, config.mindroom?.computers?.apiUrl);
};
