import React from 'react';
import { act, create } from 'react-test-renderer';
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { useInitializeShownThread } from './useInitializeShownThread';

type Observer = { root: unknown; rootMargin: unknown; observed: unknown[] };

const observeCards = (scrollRoot?: { current: Element | null }) => {
  const observers: Observer[] = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      record: Observer;

      constructor(_callback: unknown, options?: IntersectionObserverInit) {
        this.record = { root: options?.root, rootMargin: options?.rootMargin, observed: [] };
        observers.push(this.record);
      }

      observe = (target: Element) => this.record.observed.push(target);

      unobserve = vi.fn();
    }
  );
  const mx = {
    getSyncState: () => null,
    on: vi.fn(),
    getRoom: () => null,
  } as unknown as MatrixClient;
  const Card = ({ id }: { id: string }) => (
    <div ref={useInitializeShownThread('!room:example.org', id, scrollRoot)} />
  );
  act(() => {
    create(
      <MatrixClientProvider value={mx}>
        <Card id="$a" />
        <Card id="$b" />
      </MatrixClientProvider>,
      { createNodeMock: () => ({}) }
    );
  });
  return observers;
};

describe('useInitializeShownThread near a list view', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('counts a card a screen above or below its list view as shown, so its thread loads before it scrolls in', () => {
    const list = {} as Element;
    expect(observeCards({ current: list })).toEqual([
      { root: list, rootMargin: '100% 0px', observed: [{}, {}] },
    ]);
  });
});
