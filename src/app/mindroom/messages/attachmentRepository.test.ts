import 'fake-indexeddb/auto';
import { encryptAttachment } from 'browser-encrypt-attachment';
import { IDBFactory } from 'fake-indexeddb';
import { createClient, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionId } from '../../state/sessions';
import type { IEncryptedFile } from '../../../types/matrix/common';
import {
  deleteCacheStoreDb,
  loadCachedAttachment,
  openCacheStore,
  resetCacheStoreForTesting,
} from '../threads/cacheStore';
import {
  clearMindroomLongTextHydrationCache,
  hydrateMindroomLongTextSource,
  type MindroomLongTextSource,
} from './longText';
import { downloadMindroomLongTextSidecarText } from './longTextDownload';
import { downloadMindroomSidecarBlob } from './sidecarDownload';
import {
  clearAttachmentRepositoryMemory,
  downloadCachedAttachment,
  getCachedAttachmentCacheMetadata,
} from './attachmentRepository';

const BASE_URL = 'https://matrix.example.org';
const SOURCE: MindroomLongTextSource = {
  previewContent: {
    body: 'Preview response',
    msgtype: 'm.text',
    url: 'mxc://matrix.example.org/complete-response',
    'io.mindroom.long_text': {
      version: 2,
      encoding: 'matrix_event_content_json',
    },
  },
  mxcUri: 'mxc://matrix.example.org/complete-response',
  isV2ContentJson: true,
};

const createAccountClient = (userId: string): MatrixClient =>
  createClient({ baseUrl: BASE_URL, userId });

const hydrate = (mx: MatrixClient) =>
  hydrateMindroomLongTextSource(
    SOURCE,
    (source) => downloadMindroomLongTextSidecarText(mx, source, false),
    mx
  );

describe('persistent attachment repository', () => {
  beforeEach(() => {
    (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    resetCacheStoreForTesting();
    clearMindroomLongTextHydrationCache();
    clearAttachmentRepositoryMemory();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetCacheStoreForTesting();
    clearMindroomLongTextHydrationCache();
    clearAttachmentRepositoryMemory();
  });

  it('hydrates a complete long-text body offline after restart without leaking it to another account', async () => {
    let transportOffline = false;
    const fetchMock = vi.fn(async () => {
      if (transportOffline) throw new TypeError('network offline');
      return new Response(
        JSON.stringify({
          body: 'Complete response from the sidecar',
          msgtype: 'm.text',
        }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await hydrate(createAccountClient('@alice:matrix.example.org'));
    expect(first.body).toBe('Complete response from the sidecar');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      (
        await getCachedAttachmentCacheMetadata(
          createAccountClient('@alice:matrix.example.org'),
          SOURCE.mxcUri
        )
      )?.essential
    ).toBe(true);

    clearMindroomLongTextHydrationCache();
    transportOffline = true;

    const restarted = await hydrate(createAccountClient('@alice:matrix.example.org'));
    expect(restarted.body).toBe('Complete response from the sidecar');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clearMindroomLongTextHydrationCache();
    const otherAccount = await hydrate(createAccountClient('@bob:matrix.example.org'));
    expect(otherAccount.body).toBe('Preview response');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('persists encrypted attachments as cipher bytes and decrypts only the consumer blob', async () => {
    vi.stubGlobal('window', {
      atob: globalThis.atob,
      btoa: globalThis.btoa,
      crypto: globalThis.crypto,
      location: { protocol: 'https:' },
    });
    const plaintext = new TextEncoder().encode('private attachment body');
    const encrypted = await encryptAttachment(plaintext);
    const encryptedFile: IEncryptedFile = {
      ...encrypted.info,
      url: 'mxc://matrix.example.org/encrypted-body',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(encrypted.data, {
            headers: { 'Content-Type': 'application/octet-stream' },
            status: 200,
          })
      )
    );
    const alice = createAccountClient('@alice:matrix.example.org');

    const consumerBlob = await downloadCachedAttachment(
      alice,
      {
        mxcUri: encryptedFile.url,
        encryptedFile,
        mimeType: 'text/plain',
      },
      false,
      { essential: true, roomId: '!room:matrix.example.org' }
    );

    expect(await consumerBlob.text()).toBe('private attachment body');
    const sessionId = createSessionId(BASE_URL, '@alice:matrix.example.org');
    const stored = await loadCachedAttachment(sessionId, encryptedFile.url);
    expect(new Uint8Array(stored?.bytes ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array(encrypted.data)
    );
    expect(new TextDecoder().decode(stored?.bytes)).not.toContain('private attachment body');
  });

  it('retries transport after a failed download', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network offline'))
      .mockResolvedValueOnce(new Response('available again', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = { mxcUri: 'mxc://matrix.example.org/retry', mimeType: 'text/plain' };

    await expect(downloadCachedAttachment(alice, source, false)).rejects.toThrow('network offline');
    await expect((await downloadCachedAttachment(alice, source, false)).text()).resolves.toBe(
      'available again'
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one fetch across concurrent callers and preserves essential room promotion', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = { mxcUri: 'mxc://matrix.example.org/shared', mimeType: 'text/plain' };

    const essential = downloadCachedAttachment(alice, source, false, {
      essential: true,
      roomId: '!essential:matrix.example.org',
    });
    const ordinary = downloadCachedAttachment(alice, source, false, {
      roomId: '!ordinary:matrix.example.org',
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolveFetch?.(new Response('shared body', { status: 200 }));

    await expect(Promise.all([essential, ordinary])).resolves.toHaveLength(2);
    const metadata = await getCachedAttachmentCacheMetadata(alice, source.mxcUri);
    expect(metadata?.essential).toBe(true);
    expect(metadata?.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roomId: '!essential:matrix.example.org',
          essential: true,
          status: 'cached',
        }),
        expect.objectContaining({ roomId: '!ordinary:matrix.example.org' }),
      ])
    );
  });

  it('shares lookup and transport when a concurrent fetch resolves immediately', async () => {
    const fetchMock = vi.fn(async () => new Response('shared body', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = {
      mxcUri: 'mxc://matrix.example.org/immediate-shared',
      mimeType: 'text/plain',
    };

    const blobs = await Promise.all(
      Array.from({ length: 10 }, () => downloadCachedAttachment(alice, source, false))
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(Promise.all(blobs.map((blob) => blob.text()))).resolves.toEqual(
      Array.from({ length: 10 }, () => 'shared body')
    );
  });

  it('promotes an existing cached attachment to essential without another fetch', async () => {
    const fetchMock = vi.fn(async () => new Response('cached body', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = { mxcUri: 'mxc://matrix.example.org/promote', mimeType: 'text/plain' };

    await downloadCachedAttachment(alice, source, false);
    expect((await getCachedAttachmentCacheMetadata(alice, source.mxcUri))?.essential).toBe(false);

    await downloadCachedAttachment(alice, source, false, {
      essential: true,
      roomId: '!room:matrix.example.org',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const promoted = await getCachedAttachmentCacheMetadata(alice, source.mxcUri);
    expect(promoted?.essential).toBe(true);
    expect(promoted?.references).toEqual([
      expect.objectContaining({ roomId: '!room:matrix.example.org', essential: true }),
    ]);
  });

  it('keeps generic sidecars ordinary unless their caller marks them essential', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 }))
    );
    const alice = createAccountClient('@alice:matrix.example.org');
    const mxcUri = 'mxc://matrix.example.org/ordinary-sidecar';

    await downloadMindroomSidecarBlob(alice, { mxcUri }, false);

    expect((await getCachedAttachmentCacheMetadata(alice, mxcUri))?.essential).toBe(false);
  });

  it('returns a downloaded blob without claiming persistence when storage is unavailable', async () => {
    Reflect.deleteProperty(globalThis, 'indexedDB');
    resetCacheStoreForTesting();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('interactive body', { status: 200 }))
    );
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = { mxcUri: 'mxc://matrix.example.org/no-storage', mimeType: 'text/plain' };

    expect(await (await downloadCachedAttachment(alice, source, false)).text()).toBe(
      'interactive body'
    );
    expect(await getCachedAttachmentCacheMetadata(alice, source.mxcUri)).toBeUndefined();
  });

  it('revokes a late write when logout deletes the session cache during transport', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = { mxcUri: 'mxc://matrix.example.org/late', mimeType: 'text/plain' };
    const sessionId = createSessionId(BASE_URL, '@alice:matrix.example.org');

    const pending = downloadCachedAttachment(alice, source, false, { essential: true });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await deleteCacheStoreDb(sessionId);
    resolveFetch?.(new Response('late body', { status: 200 }));

    expect(await (await pending).text()).toBe('late body');
    expect(await getCachedAttachmentCacheMetadata(alice, source.mxcUri)).toBeUndefined();
  });

  it('does not persist a caller-aborted transport after its shared fetch settles', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          })
      )
    );
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = { mxcUri: 'mxc://matrix.example.org/aborted', mimeType: 'text/plain' };
    const controller = new AbortController();
    const pending = downloadCachedAttachment(alice, source, false, {
      essential: true,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(resolveFetch).toBeTypeOf('function'));

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    resolveFetch?.(new Response('unused body', { status: 200 }));
    await vi.waitFor(async () => {
      expect(await getCachedAttachmentCacheMetadata(alice, source.mxcUri)).toBeUndefined();
    });
  });

  it('lets an independent consumer persist after another shared caller aborts', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = {
      mxcUri: 'mxc://matrix.example.org/partially-aborted',
      mimeType: 'text/plain',
    };
    const controller = new AbortController();
    const canceled = downloadCachedAttachment(alice, source, false, {
      essential: true,
      roomId: '!canceled:matrix.example.org',
      signal: controller.signal,
    });
    const remaining = downloadCachedAttachment(alice, source, false, {
      roomId: '!remaining:matrix.example.org',
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    controller.abort();
    await expect(canceled).rejects.toMatchObject({ name: 'AbortError' });
    resolveFetch?.(new Response('shared survivor body', { status: 200 }));

    await expect((await remaining).text()).resolves.toBe('shared survivor body');
    const metadata = await getCachedAttachmentCacheMetadata(alice, source.mxcUri);
    expect(metadata?.essential).toBe(false);
    expect(metadata?.references).toEqual([
      expect.objectContaining({
        roomId: '!remaining:matrix.example.org',
        essential: false,
        status: 'cached',
      }),
    ]);
  });

  it('aborts persistence when cancellation follows transport completion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unused body', { status: 200 }))
    );
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = {
      mxcUri: 'mxc://matrix.example.org/abort-persistence',
      mimeType: 'text/plain',
    };
    const sessionId = createSessionId(BASE_URL, '@alice:matrix.example.org');
    const db = await openCacheStore(sessionId);
    const controller = new AbortController();
    const transaction = db?.transaction.bind(db);
    expect(transaction).toBeTypeOf('function');
    vi.spyOn(db as IDBDatabase, 'transaction').mockImplementation(
      (...args: Parameters<IDBDatabase['transaction']>) => {
        const result = transaction?.(...args) as IDBTransaction;
        if (args[1] === 'readwrite') controller.abort();
        return result;
      }
    );

    await expect(
      downloadCachedAttachment(alice, source, false, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(await getCachedAttachmentCacheMetadata(alice, source.mxcUri)).toBeUndefined();
  });

  it('honors an already-aborted caller even when the bytes are cached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('cached body', { status: 200 }))
    );
    const alice = createAccountClient('@alice:matrix.example.org');
    const source = { mxcUri: 'mxc://matrix.example.org/abort-cached', mimeType: 'text/plain' };
    await downloadCachedAttachment(alice, source, false);
    const controller = new AbortController();
    controller.abort();

    await expect(
      downloadCachedAttachment(alice, source, false, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
