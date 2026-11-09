// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LiveTranscriptBody } from './LiveTranscriptBody';

// The live transcript's scroll box: the room's side panel, which names itself, takes it as it is;
// the floating window names it, which makes it the stop for Tab and the keys that scroll it.

vi.mock('../CallTile', () => ({ CallMemberAvatar: () => null }));

const room = { roomId: '!room:example.org' } as Room;
const body = (label?: string) =>
  render(
    <LiveTranscriptBody room={room} view={{ state: 'loading' }} className="box" label={label} />
  ).container.querySelector<HTMLElement>('.box');

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}

      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("leaves the side panel's box as it was: unnamed, with no tab index of its own", () => {
  const box = body();
  expect(box?.getAttribute('role')).toBeNull();
  expect(box?.getAttribute('aria-label')).toBeNull();
  expect(box?.hasAttribute('tabindex')).toBe(false);
});

it('names the box the window shows and makes it a stop for Tab', () => {
  const box = body('Live transcript');
  expect(screen.getByRole('group', { name: 'Live transcript' })).toBe(box);
  expect(box?.tabIndex).toBe(0);
});
