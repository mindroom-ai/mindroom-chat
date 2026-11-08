// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importBeforeTests } from '../../test/utils/importBeforeTests';

type AppUpdate = typeof import('./appUpdate');

const BUILD = 'development-build';

/** A fresh copy of the module, whose state is per page. */
const loadAppUpdate = async (): Promise<AppUpdate> => {
  vi.resetModules();
  return import('./appUpdate');
};

importBeforeTests(() => import('./appUpdate'));

const publishes = (version: string | null) =>
  vi.fn(async () => new Response(JSON.stringify({ version }), { status: 200 }));

const failChunk = () => window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));

/** Lets the version request and its handlers run. */
const settle = () => vi.waitFor(() => undefined);

describe('new version after a failed part', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says so once a part fails to load and the server publishes another version', async () => {
    const fetchMock = publishes('build-2');
    vi.stubGlobal('fetch', fetchMock);
    const { getNewVersion, subscribeToNewVersion, watchForNewVersion } = await loadAppUpdate();
    const listener = vi.fn();
    subscribeToNewVersion(listener);
    const stop = watchForNewVersion();

    expect(getNewVersion()).toBeUndefined();
    failChunk();
    await vi.waitFor(() => expect(getNewVersion()).toBe('build-2'));
    expect(listener).toHaveBeenCalledOnce();

    // Later failures need no new question.
    failChunk();
    await settle();
    expect(fetchMock).toHaveBeenCalledOnce();
    stop();
  });

  it('stays quiet when the server still has this version, has none, or cannot be reached', async () => {
    const answers = [
      publishes(BUILD),
      publishes(null),
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    ];
    for (const fetchMock of answers) {
      vi.stubGlobal('fetch', fetchMock);
      // eslint-disable-next-line no-await-in-loop
      const { getNewVersion, watchForNewVersion } = await loadAppUpdate();
      const stop = watchForNewVersion();
      failChunk();
      // eslint-disable-next-line no-await-in-loop
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      // eslint-disable-next-line no-await-in-loop
      await settle();
      expect(getNewVersion()).toBeUndefined();
      stop();
    }
  });

  it('asks again after a failure that was not a deployment', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: BUILD })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 'build-2' })));
    vi.stubGlobal('fetch', fetchMock);
    const { checkForNewVersion, getNewVersion } = await loadAppUpdate();
    await checkForNewVersion();
    expect(getNewVersion()).toBeUndefined();
    await checkForNewVersion();
    expect(getNewVersion()).toBe('build-2');
  });

  it('stops listening when stopped', async () => {
    const fetchMock = publishes('build-2');
    vi.stubGlobal('fetch', fetchMock);
    const { watchForNewVersion } = await loadAppUpdate();
    watchForNewVersion()();
    failChunk();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('new version without a failed part', () => {
  const setVisibility = (state: DocumentVisibilityState) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setVisibility('visible');
  });

  it('says so when the page is shown again after a deployment', async () => {
    const fetchMock = publishes('build-2');
    vi.stubGlobal('fetch', fetchMock);
    const { getNewVersion, watchForNewVersion } = await loadAppUpdate();
    const stop = watchForNewVersion();
    setVisibility('hidden');
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();

    setVisibility('visible');
    await vi.waitFor(() => expect(getNewVersion()).toBe('build-2'));
    stop();
  });

  it('asks as soon as the page starts, so a page the old worker served after a deployment says so', async () => {
    const fetchMock = publishes('build-2');
    vi.stubGlobal('fetch', fetchMock);
    const { getNewVersion, watchForNewVersion } = await loadAppUpdate();
    const stop = watchForNewVersion();
    await vi.waitFor(() => expect(getNewVersion()).toBe('build-2'));
    expect(fetchMock).toHaveBeenCalledOnce();
    stop();
  });

  it('asks at the start only when the page is shown', async () => {
    const fetchMock = publishes('build-2');
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const { getNewVersion, watchForNewVersion } = await loadAppUpdate();
    const stop = watchForNewVersion();
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    setVisibility('visible');
    await vi.waitFor(() => expect(getNewVersion()).toBe('build-2'));
    stop();
  });

  it('asks every five minutes while the page is shown, and when it comes back online', async () => {
    vi.useFakeTimers();
    const fetchMock = publishes(BUILD);
    vi.stubGlobal('fetch', fetchMock);
    const { watchForNewVersion } = await loadAppUpdate();
    const stop = watchForNewVersion();
    // The start asks once.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    stop();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    setVisibility('visible');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

type WorkerState = ServiceWorkerState;

/** A service worker whose state the test moves on. */
const fakeWorker = (state: WorkerState) => {
  const worker = Object.assign(new EventTarget(), {
    state,
    postMessage: vi.fn(),
  });
  const moveTo = (next: WorkerState) => {
    worker.state = next;
    worker.dispatchEvent(new Event('statechange'));
  };
  return { worker, moveTo };
};

const fakeContainer = (registration: unknown) => {
  const container = Object.assign(new EventTarget(), {
    getRegistration: vi.fn(async () => registration),
    register: vi.fn(),
  });
  vi.stubGlobal('navigator', { serviceWorker: container });
  return container;
};

describe('reloadForNewVersion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // The server still publishes this page's version unless a test says otherwise.
    vi.stubGlobal('fetch', publishes(BUILD));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('asks the waiting worker to take over and reloads once it controls the page', async () => {
    const { worker } = fakeWorker('installed');
    const container = fakeContainer({ waiting: worker, installing: null });
    worker.postMessage.mockImplementation(() => {
      container.dispatchEvent(new Event('controllerchange'));
    });
    const reload = vi.fn();
    const { reloadForNewVersion } = await loadAppUpdate();

    await reloadForNewVersion({ reload });

    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'takeOver' });
    expect(reload).toHaveBeenCalledOnce();
  });

  it('waits for a worker that is still installing', async () => {
    const { worker, moveTo } = fakeWorker('installing');
    const container = fakeContainer({ waiting: null, installing: worker });
    worker.postMessage.mockImplementation(() => {
      container.dispatchEvent(new Event('controllerchange'));
    });
    const reload = vi.fn();
    const { reloadForNewVersion } = await loadAppUpdate();

    const reloading = reloadForNewVersion({ reload });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(worker.postMessage).not.toHaveBeenCalled();
    moveTo('installed');
    await reloading;

    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'takeOver' });
    expect(reload).toHaveBeenCalledOnce();
  });

  it("stages the server's version first when the version monitor has not yet", async () => {
    vi.stubGlobal('fetch', publishes('build-2'));
    const { worker } = fakeWorker('installed');
    const container = fakeContainer({ waiting: null, installing: null, active: {} });
    container.register.mockResolvedValue({ waiting: worker, installing: null });
    worker.postMessage.mockImplementation(() => {
      container.dispatchEvent(new Event('controllerchange'));
    });
    const reload = vi.fn();
    const { checkForNewVersion, reloadForNewVersion } = await loadAppUpdate();
    await checkForNewVersion();

    await reloadForNewVersion({ reload });

    const [scriptUrl] = container.register.mock.calls[0] as unknown as [URL];
    expect(scriptUrl.searchParams.get('version')).toBe('build-2');
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'takeOver' });
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads after the time limit when the new worker never takes over', async () => {
    const { worker } = fakeWorker('installed');
    fakeContainer({ waiting: worker, installing: null });
    const reload = vi.fn();
    const { reloadForNewVersion, TAKE_OVER_TIMEOUT_MS } = await loadAppUpdate();

    const reloading = reloadForNewVersion({ reload });
    await vi.advanceTimersByTimeAsync(TAKE_OVER_TIMEOUT_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await reloading;
    expect(reload).toHaveBeenCalledOnce();
  });

  it('unregisters the worker and reloads once when the server now has an app whose worker never takes over', async () => {
    vi.stubGlobal('fetch', publishes('legacy-build'));
    const { worker } = fakeWorker('installed');
    const reload = vi.fn();
    const unregister = vi.fn(async () => {
      expect(reload).not.toHaveBeenCalled();
      return true;
    });
    fakeContainer({ waiting: worker, installing: null, unregister });
    const { reloadForNewVersion, TAKE_OVER_TIMEOUT_MS } = await loadAppUpdate();

    const reloading = reloadForNewVersion({ reload });
    await vi.advanceTimersByTimeAsync(TAKE_OVER_TIMEOUT_MS);
    await reloading;

    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'takeOver' });
    expect(unregister).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('unregisters the worker when the new one fails to install or to register', async () => {
    vi.stubGlobal('fetch', publishes('build-2'));
    const reload = vi.fn();
    const { worker } = fakeWorker('redundant');
    const failedInstall = {
      waiting: null,
      installing: worker,
      unregister: vi.fn(async () => true),
    };
    fakeContainer(failedInstall);
    await (await loadAppUpdate()).reloadForNewVersion({ reload });

    const failedRegister = { waiting: null, installing: null, unregister: vi.fn(async () => true) };
    const container = fakeContainer(failedRegister);
    container.register.mockRejectedValue(new TypeError('Failed to register a ServiceWorker'));
    const update = await loadAppUpdate();
    await update.checkForNewVersion();
    await update.reloadForNewVersion({ reload });

    expect(failedInstall.unregister).toHaveBeenCalledOnce();
    expect(failedRegister.unregister).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('keeps the worker when the new one cannot take over and the server is out of reach or has this version', async () => {
    const reload = vi.fn();
    for (const fetchMock of [
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
      publishes(BUILD),
    ]) {
      vi.stubGlobal('fetch', fetchMock);
      const { worker } = fakeWorker('installed');
      const unregister = vi.fn(async () => true);
      fakeContainer({ waiting: worker, installing: null, unregister });
      // eslint-disable-next-line no-await-in-loop
      const { reloadForNewVersion, TAKE_OVER_TIMEOUT_MS } = await loadAppUpdate();

      const reloading = reloadForNewVersion({ reload });
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(TAKE_OVER_TIMEOUT_MS);
      // eslint-disable-next-line no-await-in-loop
      await reloading;

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(unregister).not.toHaveBeenCalled();
    }
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('just reloads without a service worker, a registration or a worker to hand over to', async () => {
    const reload = vi.fn();
    vi.stubGlobal('navigator', {});
    let update = await loadAppUpdate();
    await update.reloadForNewVersion({ reload });

    fakeContainer(undefined);
    update = await loadAppUpdate();
    await update.reloadForNewVersion({ reload });

    const { worker } = fakeWorker('redundant');
    fakeContainer({ waiting: null, installing: worker });
    update = await loadAppUpdate();
    await update.reloadForNewVersion({ reload });

    expect(reload).toHaveBeenCalledTimes(3);
    expect(worker.postMessage).not.toHaveBeenCalled();
  });
});

describe('failed modules', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.head.replaceChildren();
  });

  /** A module preload link of Vite's helper that failed to load. */
  const failPreload = (href: string, rel = 'modulepreload') => {
    const link = document.createElement('link');
    link.rel = rel;
    link.href = href;
    document.head.append(link);
    link.dispatchEvent(new Event('error'));
  };

  it('fetches each module whose preload failed before the reload, once', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL) => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { reloadForNewVersion, watchForNewVersion } = await loadAppUpdate();
    const stop = watchForNewVersion();
    failPreload('/assets/Board-a1.js');
    failPreload('/assets/board-data-b2.js');
    failPreload('/assets/Board-c3.css', 'stylesheet');
    stop();
    failPreload('/assets/Later-d4.js');
    const reload = vi.fn(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    await reloadForNewVersion({ reload });

    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/assets/Board-a1.js',
      '/assets/board-data-b2.js',
    ]);
    expect(reload).toHaveBeenCalledOnce();
    await reloadForNewVersion({ reload: vi.fn() });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
