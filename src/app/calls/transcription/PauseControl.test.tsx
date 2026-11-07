// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { IconButton } from 'folds';
import { PauseControl, usePausedBy } from './PauseControl';
import { liveTranscriptAtom, pauseRequestAtom } from './transcriptionState';
import type { TranscriptCall } from './api';

vi.mock('../../ui/directional', () => ({
  TooltipProvider: ({ children }: { children: (ref: undefined) => React.ReactNode }) =>
    children(undefined),
  PopOut: () => null,
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@ann:example.org' }),
}));

const ROOM_ID = '!room:example.org';
const MEMBERS: Record<string, string> = {
  '@ann:example.org': 'Ann',
  '@bob:example.org': 'Bob',
};
const room = {
  roomId: ROOM_ID,
  getMember: (userId: string) =>
    MEMBERS[userId] ? { userId, name: MEMBERS[userId], rawDisplayName: MEMBERS[userId] } : null,
} as unknown as Room;

const CALL: TranscriptCall = {
  id: 'call-1',
  roomId: ROOM_ID,
  rowEventId: '$row',
  startedAt: '2026-11-07T09:29:00Z',
  endedAt: null,
  members: ['@ann:example.org', '@bob:example.org'],
  pausedBy: null,
};

function PausedBy() {
  return <output>{usePausedBy(room) ?? ''}</output>;
}

let renderer: ReactTestRenderer | undefined;

const mount = () => {
  const store = createStore();
  store.set(liveTranscriptAtom, { roomId: ROOM_ID, call: CALL, lines: [], names: {} });
  act(() => {
    renderer = create(
      <Provider store={store}>
        <PauseControl room={room} />
        <PausedBy />
      </Provider>
    );
  });
  const tree = renderer!;
  const button = () => tree.root.findByType(IconButton);
  const click = () =>
    act(() => {
      button().props.onClick({});
    });
  const pausedBy = () => tree.root.findByType('output').props.children as string;
  /** MindRoom's state of the call: paused by `userId`, or not paused. */
  const pausedInCall = (userId: string | null, names: Record<string, string> = {}) =>
    act(() =>
      store.set(liveTranscriptAtom, {
        roomId: ROOM_ID,
        call: { ...CALL, pausedBy: userId },
        lines: [],
        names,
      })
    );
  return {
    store,
    button,
    click,
    pausedBy,
    pausedInCall,
    request: () => store.get(pauseRequestAtom),
  };
};

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
});

describe('PauseControl', () => {
  it('pauses with a click and resumes with the next, before MindRoom answers', () => {
    const t = mount();
    expect(t.button().props['aria-pressed']).toBe(false);

    t.click();
    expect(t.request()).toBe(true);
    expect(t.button().props['aria-pressed']).toBe(true);
    expect(t.pausedBy()).toBe('Paused by Ann');

    t.click();
    expect(t.request()).toBe(false);
    expect(t.button().props['aria-pressed']).toBe(false);
    expect(t.pausedBy()).toBe('');
  });

  it('resumes a call someone else paused', () => {
    const t = mount();
    t.pausedInCall('@bob:example.org');
    expect(t.button().props['aria-pressed']).toBe(true);

    t.click();
    expect(t.request()).toBe(false);
    expect(t.button().props['aria-pressed']).toBe(false);
  });

  it("looks like the controls' warning while the call is paused, naming who paused", () => {
    const t = mount();
    expect(t.button().props.variant).toBe('SurfaceVariant');
    expect(t.button().props['aria-description']).toBeUndefined();
    expect(t.pausedBy()).toBe('');

    t.pausedInCall('@bob:example.org');
    expect(t.button().props.variant).toBe('Warning');
    // Its name stays; who paused is its description.
    expect(t.button().props['aria-label']).toBe('Pause transcription');
    expect(t.button().props['aria-description']).toBe('Paused by Bob');
    expect(t.pausedBy()).toBe('Paused by Bob');

    // A member the room has not loaded, by MindRoom's name.
    t.pausedInCall('@dee:example.org', { '@dee:example.org': 'Dee' });
    expect(t.pausedBy()).toBe('Paused by Dee');
  });

  it('shows the state MindRoom reports once its answer ends the request', () => {
    const t = mount();
    t.click();
    act(() => t.store.set(pauseRequestAtom, undefined));
    expect(t.button().props['aria-pressed']).toBe(false);
    expect(t.button().props.variant).toBe('SurfaceVariant');
  });
});
