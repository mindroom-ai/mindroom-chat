import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerStorageRecoveryBlocker,
  resetStorageConnectionRecoveryForTesting,
  startStorageConnectionSentinel,
  STORAGE_RECOVERY_IDLE_MS,
  STORAGE_RECOVERY_RELOAD_KEY,
} from '../../mindroom/client/storageConnectionRecovery';
import { StorageConnectionStatus } from './StorageConnectionStatus';

vi.mock('../../styles/ContainerColor.css', () => ({ ContainerColor: () => '' }));

const createLosableIndexedDB = () => {
  const database = new EventTarget();
  const indexedDB = {
    open: () => {
      const request = { result: database, onsuccess: null as null | (() => void) };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  } as unknown as IDBFactory;
  return {
    indexedDB,
    lose: () => {
      database.dispatchEvent(new Event('close'));
    },
  };
};

const createMarkerStorage = (entries: Record<string, string> = {}) => {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  } as unknown as Storage;
};

const text = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => typeof node.type === 'string')
    .flatMap((node) => node.children.filter((child): child is string => typeof child === 'string'))
    .join(' ');

beforeEach(() => {
  vi.stubGlobal('window', { setInterval, clearInterval, setTimeout, clearTimeout });
});

afterEach(() => {
  resetStorageConnectionRecoveryForTesting();
  vi.unstubAllGlobals();
});

describe('StorageConnectionStatus', () => {
  it('stays hidden while storage is healthy and explains a loss with a reload action', async () => {
    const host = createLosableIndexedDB();
    const reload = vi.fn();
    startStorageConnectionSentinel({
      indexedDB: host.indexedDB,
      markerStorage: createMarkerStorage(),
      reload,
    });
    await act(async () => {
      await Promise.resolve();
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<StorageConnectionStatus />);
    });
    expect(renderer.toJSON()).toBeNull();

    await act(async () => host.lose());

    expect(text(renderer)).toContain('MindRoom will reload to restore it.');
    await act(async () => {
      renderer.root.findByType('button').props.onClick();
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('asks for a manual reload when storage fails again right after recovery', async () => {
    const host = createLosableIndexedDB();
    startStorageConnectionSentinel({
      indexedDB: host.indexedDB,
      markerStorage: createMarkerStorage({
        [STORAGE_RECOVERY_RELOAD_KEY]: JSON.stringify({ at: Date.now(), automatic: true }),
      }),
      reload: vi.fn(),
    });
    await act(async () => {
      await Promise.resolve();
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<StorageConnectionStatus />);
    });

    await act(async () => host.lose());

    expect(text(renderer)).toContain('Reload MindRoom to restore it.');
  });

  it('explains waiting for unsent work and warns before a reload would discard it', async () => {
    const host = createLosableIndexedDB();
    const reload = vi.fn();
    registerStorageRecoveryBlocker(() => true);
    startStorageConnectionSentinel({
      indexedDB: host.indexedDB,
      markerStorage: createMarkerStorage(),
      reload,
    });
    await act(async () => {
      await Promise.resolve();
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<StorageConnectionStatus />);
    });

    await act(async () => host.lose());

    expect(text(renderer)).toContain('once unsent work is sent or discarded.');
    await act(async () => {
      renderer.root.findByType('button').props.onClick();
    });
    expect(text(renderer)).toContain('discards unsent work');
    expect(reload).not.toHaveBeenCalled();

    await act(async () => {
      renderer.root.findByType('button').props.onClick();
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('hosts automatic recovery while it is mounted, even without a client', async () => {
    const host = createLosableIndexedDB();
    const reload = vi.fn();
    let now = 1_000_000;
    const intervals: Array<() => void> = [];
    startStorageConnectionSentinel({
      indexedDB: host.indexedDB,
      markerStorage: createMarkerStorage(),
      reload,
      now: () => now,
      setInterval: (callback) => intervals.push(callback),
      clearInterval: () => undefined,
    });
    await act(async () => {
      await Promise.resolve();
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<StorageConnectionStatus />);
    });

    await act(async () => host.lose());
    now += STORAGE_RECOVERY_IDLE_MS;
    intervals.forEach((check) => check());
    expect(reload).toHaveBeenCalledTimes(1);

    await act(async () => renderer.unmount());
  });
});
