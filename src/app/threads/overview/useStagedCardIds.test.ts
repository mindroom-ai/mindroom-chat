// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CARD_MOUNT_CHUNK,
  FIRST_SCREEN_CARDS,
  firstRenderCardCount,
  useStagedCardIds,
} from './useStagedCardIds';

const ids = (from: number, to: number) =>
  Array.from({ length: to - from }, (_unused, index) => `$${from + index}`);

describe('useStagedCardIds', () => {
  let shown: string[] = [];
  let renderer: ReactTestRenderer | undefined;
  const Harness = ({ scope, list, first }: { scope: string; list: string[]; first?: number }) => {
    shown = useStagedCardIds(scope, list, first);
    return null;
  };
  const show = (scope: string, list: string[], first?: number) =>
    act(() => {
      const element = React.createElement(Harness, { scope, list, first });
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

  it("mounts the cards a room's first render asks for, then the rest a chunk per task", () => {
    const all = ids(0, 600);
    show('!room', all, FIRST_SCREEN_CARDS);
    expect(shown).toEqual(all.slice(0, FIRST_SCREEN_CARDS));
    nextTask();
    expect(shown).toEqual(all.slice(0, FIRST_SCREEN_CARDS + CARD_MOUNT_CHUNK));
    while (shown.length < all.length) nextTask();
    expect(shown).toBe(all);
    expect(vi.getTimerCount()).toBe(0);

    const few = ids(0, FIRST_SCREEN_CARDS);
    show('!few', few, FIRST_SCREEN_CARDS);
    expect(shown).toBe(few);
  });

  it('mounts the next chunk in a task of its own, not on any render before it', () => {
    // A room's first commit sets off renders of its own (effects that set state, in the same task).
    const all = ids(0, 600);
    show('!room', all, FIRST_SCREEN_CARDS);
    const first = shown;
    show('!room', all, FIRST_SCREEN_CARDS);
    expect(shown).toBe(first);
    // The same cards in a new array, as a rebuilt index gives them.
    show('!room', [...all], FIRST_SCREEN_CARDS);
    expect(shown).toBe(first);
    nextTask();
    const second = shown;
    expect(second).toHaveLength(FIRST_SCREEN_CARDS + CARD_MOUNT_CHUNK);
    show('!room', all, FIRST_SCREEN_CARDS);
    expect(shown).toBe(second);

    const odd = all.filter((_id, index) => index % 2 === 1);
    show('!other', odd);
    show('!other', all);
    const filtered = shown;
    show('!other', all);
    expect(shown).toBe(filtered);
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

describe('firstRenderCardCount', () => {
  const all = ids(0, 600);

  it('is the first screenful for a room never left or left at its top', () => {
    expect(firstRenderCardCount(all, undefined)).toBe(FIRST_SCREEN_CARDS);
    expect(firstRenderCardCount(all, { scrollTop: 0, anchors: [{ key: '$300', offset: 0 }] })).toBe(
      FIRST_SCREEN_CARDS
    );
  });

  it('reaches a screenful past the last listed card of the place the reader left', () => {
    const anchors = [
      { key: '$100', offset: -40 },
      { key: '$104', offset: 400 },
      { key: '$gone', offset: 600 },
    ];
    expect(firstRenderCardCount(all, { scrollTop: 9000, anchors })).toBe(105 + FIRST_SCREEN_CARDS);
  });

  it('reaches the card that takes the focus as the list shows', () => {
    expect(firstRenderCardCount(all, undefined, '$40')).toBe(41);
    expect(firstRenderCardCount(all, undefined, '$3')).toBe(FIRST_SCREEN_CARDS);
    expect(firstRenderCardCount(all, undefined, '$gone')).toBe(FIRST_SCREEN_CARDS);
    const place = { scrollTop: 9000, anchors: [{ key: '$100', offset: 0 }] };
    expect(firstRenderCardCount(all, place, '$300')).toBe(301);
    expect(firstRenderCardCount(all, place, '$40')).toBe(101 + FIRST_SCREEN_CARDS);
  });

  it('is the whole list when that place has no listed card to find', () => {
    expect(
      firstRenderCardCount(all, { scrollTop: 9000, anchors: [{ key: '$gone', offset: 0 }] })
    ).toBe(all.length);
    expect(firstRenderCardCount(all, { scrollTop: 9000, anchors: [] })).toBe(all.length);
  });
});
