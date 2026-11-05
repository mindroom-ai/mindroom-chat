import { useMatch } from 'react-router-dom';
import { getCanvasesPath } from './pathUtils';

export const useCanvasesSelected = (): boolean =>
  !!useMatch({ path: getCanvasesPath(), caseSensitive: true, end: false });
