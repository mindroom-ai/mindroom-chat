import { useClientConfig } from '../config/useClientConfig';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useComputerApiUrls } from '../computer/useComputerApiUrl';
import { useCanvasIndexRecorder } from './canvasIndex';

/**
 * Keeps the Canvases list and the "agent showed its computer" record current on every route,
 * while this deployment has canvases or a computer service.
 */
export function CanvasIndexFeature() {
  const mx = useMatrixClient();
  const canvasesEnabled = useClientConfig().mindroom?.canvas?.enabled === true;
  const computersAvailable = useComputerApiUrls().urls.length > 0;
  useCanvasIndexRecorder(mx, canvasesEnabled || computersAvailable);
  return null;
}
