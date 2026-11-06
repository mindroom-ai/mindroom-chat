// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD_MOUNT_CHUNK, FIRST_SCREEN_CARDS, useStagedCardIds } from './useStagedCardIds';

const ids = (from: number, to: number) =>
  Array.from({ length: to - from }, (_unused, index) => `$${from + index}`);

describe('useStagedCardIds', () => {
  let shown: string[] = [];
  let renderer: ReactTestRenderer | undefined;
  const Harness = ({ scope, list }: { scope: string; list: string[] }) => {
    shown = useStagedCardIds(scope, list);
    return null;
  };
  const show = (scope: string, list: string[]) =>
    act(() => {
      const element = React.createElement(Harness, { scope, list });
      if (renderer) renderer.update(element);
      else renderer = create(element);
    });
  const nextTask = () =>
    act(() => {
      vi.advanceTimersToNextTimer();
    });

  beforeEach(() => {
    vi.useFakeTimers();
    renderer = undefined;
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    vi.useRealTimers();
  });

  it("renders a room's whole list at first", () => {
    const all = ids(0, 600);
    show('!room', all);
    expect(shown).toBe(all);
  });

  it('keeps shown cards and mounts the first screenful, then the rest a chunk per task', () => {
    const all = ids(0, 600);
    const odd = all.filter((_id, index) => index % 2 === 1);
    show('!room', odd);
    show('!room', all);
    // Every odd card stays; the even ones of the first screenful and one chunk mount.
    const firstScreenEven = all.slice(0, FIRST_SCREEN_CARDS).filter((_id, i) => i % 2 === 0);
    const newNow = shown.filter((id) => !odd.includes(id));
    expect(shown.filter((id) => odd.includes(id))).toEqual(odd);
    expect(newNow.slice(0, firstScreenEven.length)).toEqual(firstScreenEven);
    expect(newNow).toHaveLength(firstScreenEven.length + CARD_MOUNT_CHUNK);
    expect(shown).toEqual(all.filter((id) => shown.includes(id)));

    let tasks = 0;
    while (shown.length < all.length) {
      const before = shown.length;
      nextTask();
      expect(shown.length - before).toBeLessThanOrEqual(CARD_MOUNT_CHUNK);
      expect(shown).toEqual(all.filter((id) => shown.includes(id)));
      tasks += 1;
    }
    expect(shown).toBe(all);
    expect(tasks).toBe(
      Math.ceil((300 - firstScreenEven.length - CARD_MOUNT_CHUNK) / CARD_MOUNT_CHUNK)
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('mounts a few new cards at once', () => {
    const all = ids(0, 600);
    show('!room', all.slice(CARD_MOUNT_CHUNK));
    show('!room', all);
    expect(shown).toBe(all);
  });

  it('drops hidden cards at once', () => {
    const all = ids(0, 600);
    show('!room', all);
    const unresolved = all.filter((_id, index) => index % 4 !== 1);
    show('!room', unresolved);
    expect(shown).toBe(unresolved);
  });

  it("renders another room's list whole", () => {
    show('!room', ids(0, 10));
    const other = ids(1000, 1600);
    show('!other', other);
    expect(shown).toBe(other);
  });
});
