import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resetStorageConnectionRecoveryForTesting,
  startStorageConnectionSentinel,
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

const createSessionStorage = (entries: Record<string, string> = {}) => {
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

afterEach(() => {
  resetStorageConnectionRecoveryForTesting();
});

describe('StorageConnectionStatus', () => {
  it('stays hidden while storage is healthy and explains a loss with a reload action', async () => {
    const host = createLosableIndexedDB();
    const reload = vi.fn();
    startStorageConnectionSentinel({
      indexedDB: host.indexedDB,
      sessionStorage: createSessionStorage(),
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

    expect(text(renderer)).toContain('MindRoom will reload when you leave it.');
    await act(async () => {
      renderer.root.findByType('button').props.onClick();
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('asks for a manual reload when storage fails again right after recovery', async () => {
    const host = createLosableIndexedDB();
    startStorageConnectionSentinel({
      indexedDB: host.indexedDB,
      sessionStorage: createSessionStorage({
        [STORAGE_RECOVERY_RELOAD_KEY]: String(Date.now()),
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
});
