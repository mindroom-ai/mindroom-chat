// @vitest-environment jsdom
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, expect, it, vi } from 'vitest';
import { clientSessions } from '../../computer/clientSessions';
import { putSession } from '../../matrix/session/sessions';
import { removeCurrentClientSessionAndReload } from './sessionLifecycle';

// What happened, in order: each request (`<method> <url> <bearer>`) and the reload.
const steps = vi.hoisted(() => [] as string[]);
vi.mock('../../routes/pathUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../routes/pathUtils')>()),
  reloadAppAt: () => {
    steps.push('reload');
  },
}));
vi.mock('../../matrix/openidAudience', () => ({
  requestAudienceOpenIdToken: async () => ({ access_token: 'openid' }),
}));

const ALICE = '@alice:example.org';

afterEach(() => {
  localStorage.clear();
  steps.length = 0;
  vi.unstubAllGlobals();
});

it("ends each of the account's MindRoom sessions at sign-out, before the page reloads", async () => {
  let signIns = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      if (method === 'POST') {
        signIns += 1;
        return Response.json({ session_token: `session-${signIns}`, expires_at: 2e9 });
      }
      steps.push(`${method} ${String(input)} ${new Headers(init.headers).get('Authorization')}`);
      return new Response(null, { status: 204 });
    })
  );
  const alice = putSession({
    baseUrl: 'https://matrix.example.org',
    userId: ALICE,
    deviceId: 'DEVICE',
    accessToken: 'token',
  });
  const mx = {
    getHomeserverUrl: () => 'https://matrix.example.org',
    getSafeUserId: () => ALICE,
    getDeviceId: () => alice.deviceId,
    stopClient: () => undefined,
    clearStores: () => Promise.resolve(),
  } as unknown as MatrixClient;
  await clientSessions(mx, 'https://one.example.org', true).send('/api/plugins');
  await clientSessions(mx, 'https://two.example.org', false).send('/api/plugins');
  steps.length = 0;

  await removeCurrentClientSessionAndReload(mx, alice);

  expect(steps).toEqual([
    'DELETE https://one.example.org/api/client-sessions Bearer session-1',
    'DELETE https://two.example.org/api/client-sessions Bearer session-2',
    'reload',
  ]);
});
