import { beforeAll } from 'vitest';

/**
 * Loads a module before a test file's tests start. The first import of a large module graph
 * (RoomTimeline, RoomView) transforms and evaluates all of it, which takes about 5 s on a loaded
 * machine; inside the first test that counted against the 5 s test timeout. The hook takes that
 * time instead, as the `beforeAll` of shell/accountState.test.ts does, and the tests'
 * own imports then find the module, or after `vi.resetModules()` its transformed code, ready.
 * Right after a reboot, with nothing in the file cache and a load of 500, the import of RoomView
 * took over two minutes, so the hook gets ten, as that sweep does.
 */
export const importBeforeTests = (load: () => Promise<unknown>): void => {
  beforeAll(async () => {
    await load();
  }, 600_000);
};
