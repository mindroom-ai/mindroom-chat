import { useMatch } from 'react-router-dom';
import { getUsagePath } from './pathUtils';

export const useUsageSelected = (): boolean =>
  !!useMatch({ path: getUsagePath(), caseSensitive: true, end: false });
