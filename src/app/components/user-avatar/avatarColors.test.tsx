// @vitest-environment jsdom
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RoomAvatar } from '../room-avatar/RoomAvatar';
import { UserAvatar, getAvatarFallbackStyle } from './UserAvatar';
import {
  AVATAR_SWATCHES,
  AVATAR_SWATCH_COUNT,
  AVATAR_SWATCH_INK,
  avatarSwatchIndex,
  avatarSwatchVar,
} from './avatarSwatches';

const ids = [
  '@maya:matrix.localhost',
  '@mindroom_research:matrix.localhost',
  '!LaunchWarRoom:matrix.localhost',
  '!kitchen:example.org',
  '@a:b',
  '',
  '@très-long-ünïcode-name:🙂.example',
];

describe('avatar swatches', () => {
  it('give every ID one swatch inside the palette, the same on every call', () => {
    for (const id of ids) {
      const swatch = avatarSwatchIndex(id);
      expect(Number.isInteger(swatch)).toBe(true);
      expect(swatch).toBeGreaterThanOrEqual(0);
      expect(swatch).toBeLessThan(AVATAR_SWATCH_COUNT);
      expect(avatarSwatchIndex(id)).toBe(swatch);
    }
  });

  it('spread IDs over the palette', () => {
    const used = new Set(
      Array.from({ length: 64 }, (_, n) => avatarSwatchIndex(`@user${n}:matrix.localhost`))
    );
    expect(used.size).toBe(AVATAR_SWATCH_COUNT);
  });

  it('tell apart IDs that differ only slightly', () => {
    // Accounts made together share most of their ID; a weak hash put most such pairs on one hue.
    const pairs = Array.from({ length: 200 }, (_, n) => [
      `@colors_viewer_${n.toString(16)}:matrix.localhost`,
      `@colors_peer_${n.toString(16)}:matrix.localhost`,
    ]);
    const same = pairs.filter(([a, b]) => avatarSwatchIndex(a) === avatarSwatchIndex(b)).length;
    expect(same / pairs.length).toBeLessThan(0.25);
    const neighbours = Array.from({ length: 200 }, (_, n) => [`!room${n}a:x`, `!room${n}b:x`]);
    const alike = neighbours.filter(([a, b]) => avatarSwatchIndex(a) === avatarSwatchIndex(b));
    expect(alike.length / neighbours.length).toBeLessThan(0.25);
  });

  it('keep the reference header tile blue as the first swatch', () => {
    expect(AVATAR_SWATCHES[0]).toEqual({ light: '#3569AF', dark: '#9FC7FE' });
  });
});

describe('getAvatarFallbackStyle', () => {
  it('fills an ID with its swatch and the palette ink by default', () => {
    for (const id of ids) {
      expect(getAvatarFallbackStyle(id)).toEqual({
        backgroundColor: avatarSwatchVar(avatarSwatchIndex(id)),
        color: AVATAR_SWATCH_INK,
      });
      expect(getAvatarFallbackStyle(id, 'solid')).toEqual(getAvatarFallbackStyle(id));
    }
  });

  it('leaves a plain fallback unfilled', () => {
    expect(getAvatarFallbackStyle('!room:test', 'plain')).toBeUndefined();
  });
});

describe('fallback avatars', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // jsdom drops `var()` values from inline styles, so the rendered fallbacks are compared by the
  // ID they name, which getAvatarFallbackStyle (above) turns into the color.
  const fallbackIds = () =>
    Array.from(container.querySelectorAll<HTMLElement>('[data-avatar-fallback-id]')).map(
      (node) => node.dataset.avatarFallbackId
    );

  it('color a user by their ID in every place, whatever the fallback shows', () => {
    act(() =>
      root.render(
        <>
          <UserAvatar userId="@maya:test" renderFallback={() => 'M'} />
          <UserAvatar userId="@maya:test" renderFallback={() => null} className="chip" />
          <UserAvatar userId="@maya:test" fallbackTone="solid" renderFallback={() => 'Maya'} />
        </>
      )
    );
    expect(fallbackIds()).toEqual(['@maya:test', '@maya:test', '@maya:test']);
  });

  it('color a room by its ID whatever the fallback shows', () => {
    act(() =>
      root.render(
        <>
          <RoomAvatar roomId="!launch:test" renderFallback={() => '#'} />
          <RoomAvatar roomId="!launch:test" fallbackTone="solid" renderFallback={() => 'L'} />
        </>
      )
    );
    expect(fallbackIds()).toEqual(['!launch:test', '!launch:test']);
  });

  it('give a direct chat the color of the person it is with', () => {
    act(() =>
      root.render(
        <>
          <RoomAvatar roomId="!dm:test" fallbackId="@pat:test" renderFallback={() => 'P'} />
          <UserAvatar userId="@pat:test" renderFallback={() => 'P'} />
        </>
      )
    );
    expect(fallbackIds()).toEqual(['@pat:test', '@pat:test']);
  });

  it('leave a plain fallback unfilled and unnamed', () => {
    act(() =>
      root.render(
        <RoomAvatar roomId="!room:test" fallbackTone="plain" renderFallback={() => '#'} />
      )
    );
    expect(fallbackIds()).toEqual([]);
    expect(container.textContent).toBe('#');
  });
});
