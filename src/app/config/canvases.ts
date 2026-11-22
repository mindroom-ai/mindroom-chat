import type { ClientConfig } from './useClientConfig';

/** Agent canvases are on unless the deployment sets `mindroom.canvas.enabled` to `false`. */
export const canvasesEnabled = (config: ClientConfig | undefined): boolean =>
  config?.mindroom?.canvas?.enabled !== false;
