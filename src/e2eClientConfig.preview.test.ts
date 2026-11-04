import { describe, expect, it, vi } from 'vitest';
import { e2eClientConfig } from '../scripts/e2e-client-config.mjs';
import { defined } from './app/test-utils/defined';

type Handler = (
  req: { url?: string },
  res: { setHeader: (name: string, value: string) => void; end: (body: string) => void },
  next: () => void
) => void;

describe('e2e client config under vite preview', () => {
  it('answers /config.json from the preview server too, before the built copy', () => {
    const handlers: Handler[] = [];
    e2eClientConfig('http://127.0.0.1:4302').configurePreviewServer({
      middlewares: { use: (handler: Handler) => handlers.push(handler) },
    });
    expect(handlers).toHaveLength(1);

    const res = { setHeader: vi.fn(), end: vi.fn() };
    const next = vi.fn();
    defined(handlers[0], 'the preview handler')({ url: '/config.json' }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(
      JSON.parse(defined(res.end.mock.calls[0], 'a response')[0]).sidebar.mindRoomProvisioningUrl
    ).toBe('http://127.0.0.1:4302');
  });

  it('installs nothing on a preview server without a provisioning origin', () => {
    const use = vi.fn();
    e2eClientConfig(undefined).configurePreviewServer({ middlewares: { use } });
    expect(use).not.toHaveBeenCalled();
  });
});
