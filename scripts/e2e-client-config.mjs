// @ts-check
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const runtimeConfigPath = fileURLToPath(new URL('../config.mindroom.json', import.meta.url));

/**
 * @typedef {{
 *   middlewares: {
 *     use: (
 *       handler: (
 *         req: { url?: string },
 *         res: { setHeader: (name: string, value: string) => void; end: (body: string) => void },
 *         next: () => void
 *       ) => void
 *     ) => unknown;
 *   };
 * }} MiddlewareHost
 */

/**
 * Vite plugin for the end-to-end dev server. It answers `/config.json` with the MindRoom
 * runtime config, pointing `sidebar.mindRoomProvisioningUrl` at the given origin, so browser
 * tests never reach the hosted provisioning service. With no URL the plugin does nothing.
 * `vite preview` of a build (`scripts/e2e-slot.sh --preview`) answers it the same way, ahead of
 * the built `config.json`.
 *
 * @param {string | undefined} provisioningUrl
 */
export const e2eClientConfig = (provisioningUrl) => {
  /** @param {MiddlewareHost} server */
  const answerConfig = (server) => {
    if (!provisioningUrl) return;

    server.middlewares.use((req, res, next) => {
      if ((req.url ?? '').split('?')[0] !== '/config.json') {
        next();
        return;
      }

      const config = JSON.parse(readFileSync(runtimeConfigPath, 'utf8'));
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(
        JSON.stringify({
          ...config,
          sidebar: { ...config.sidebar, mindRoomProvisioningUrl: provisioningUrl },
          encryptionRecovery: { ...config.encryptionRecovery, promptAtStart: false },
        })
      );
    });
  };

  return {
    name: 'mindroom-e2e-client-config',
    configureServer: answerConfig,
    configurePreviewServer: answerConfig,
  };
};
