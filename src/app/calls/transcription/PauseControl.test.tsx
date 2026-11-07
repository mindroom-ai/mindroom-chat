// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { IconButton } from 'folds';
import { PauseControl, usePausedBy } from './PauseControl';
import { liveTranscriptAtom, pauseHeldAtom } from './transcriptionState';
import * as css from './PauseControl.css';
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
  holds: [],
  transcribedBy: ['@ann:example.org', '@bob:example.org'],
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
  const fire = (handler: string, event: Record<string, unknown> = {}) =>
    act(() => {
      button().props[handler]({ preventDefault: vi.fn(), button: 0, ...event });
    });
  const pausedBy = () => tree.root.findByType('output').props.children as string;
  return { store, button, fire, pausedBy, held: () => store.get(pauseHeldAtom) };
};

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
});

describe('PauseControl', () => {
  it.each(['onPointerUp', 'onPointerCancel', 'onPointerLeave'])(
    'holds Pause while pressed, and lets go on %s',
    (release) => {
      const t = mount();
      t.fire('onPointerDown');
      expect(t.held()).toBe(true);
      expect(t.button().props['aria-pressed']).toBe(true);

      t.fire(release);
      expect(t.held()).toBe(false);
      expect(t.button().props['aria-pressed']).toBe(false);
    }
  );

  it('takes no hold for a secondary button', () => {
    const t = mount();
    t.fire('onPointerDown', { button: 2 });
    expect(t.held()).toBe(false);
  });

  it.each([' ', 'Enter'])('holds Pause while "%s" is down, and lets go when it comes up', (key) => {
    const t = mount();
    t.fire('onKeyDown', { key });
    expect(t.held()).toBe(true);
    t.fire('onKeyUp', { key });
    expect(t.held()).toBe(false);

    // A key held down repeats: that is still one press.
    t.fire('onKeyDown', { key, repeat: true });
    expect(t.held()).toBe(false);
  });

  it('lets go when the control loses focus', () => {
    const t = mount();
    t.fire('onKeyDown', { key: ' ' });
    t.fire('onBlur');
    expect(t.held()).toBe(false);
  });

  it.each([
    ['the window loses focus', () => window.dispatchEvent(new Event('blur'))],
    [
      'the page is hidden',
      () => {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
      },
    ],
    ['the page goes away', () => window.dispatchEvent(new Event('pagehide'))],
  ])('lets go when %s', (_case, happen) => {
    const t = mount();
    t.fire('onPointerDown');
    act(() => happen());
    expect(t.held()).toBe(false);
  });

  it('lets go when it goes away', () => {
    const t = mount();
    t.fire('onPointerDown');
    act(() => renderer?.unmount());
    renderer = undefined;
    expect(t.held()).toBe(false);
  });

  it("looks like the controls' warning while anyone holds it, naming who does", () => {
    const t = mount();
    expect(t.button().props.variant).toBe('SurfaceVariant');
    expect(t.pausedBy()).toBe('');

    // Pressed here, it says so before MindRoom answers.
    t.fire('onPointerDown');
    expect(t.button().props.variant).toBe('Warning');
    expect(t.pausedBy()).toBe('Paused by Ann');
    t.fire('onPointerUp');

    act(() =>
      t.store.set(liveTranscriptAtom, {
        roomId: ROOM_ID,
        call: { ...CALL, holds: ['@bob:example.org'] },
        lines: [],
        names: {},
      })
    );
    expect(t.button().props.variant).toBe('Warning');
    expect(t.button().props['aria-pressed']).toBe(false);
    // Its name stays; who paused is its description.
    expect(t.button().props['aria-label']).toBe('Pause transcription');
    expect(t.button().props['aria-description']).toBe('Paused by Bob');
    expect(t.pausedBy()).toBe('Paused by Bob');

    // Pressed here as well: both, and a member the room has not loaded by MindRoom's name.
    t.fire('onPointerDown');
    act(() =>
      t.store.set(liveTranscriptAtom, {
        roomId: ROOM_ID,
        call: { ...CALL, holds: ['@bob:example.org', '@dee:example.org'] },
        lines: [],
        names: { '@dee:example.org': 'Dee' },
      })
    );
    expect(t.pausedBy()).toBe('Paused by Ann, Bob, and Dee');
  });

  it('keeps its name, and tells how it works while nobody holds it', () => {
    const t = mount();
    expect(t.button().props['aria-label']).toBe('Pause transcription');
    expect(t.button().props['aria-description']).toBe(
      'Hold to pause, or click to pause until you click again'
    );
  });

  it('neither scrolls nor opens a callout while a finger holds it', () => {
    const t = mount();
    expect(t.button().props.className).toContain(css.HoldControl);
  });

  it('holds Pause on a click that came without a press, until the next click', () => {
    const t = mount();
    // Screen readers, voice control and switch access click without pressing.
    t.fire('onClick');
    expect(t.held()).toBe(true);
    expect(t.button().props['aria-pressed']).toBe(true);
    // Moving the pointer over and off it lets nothing go.
    t.fire('onPointerLeave');
    expect(t.held()).toBe(true);

    t.fire('onClick');
    expect(t.held()).toBe(false);
  });

  it.each([
    ['the control loses focus', () => undefined, 'onBlur'],
    ['the window loses focus', () => window.dispatchEvent(new Event('blur')), undefined],
    ['the page goes away', () => window.dispatchEvent(new Event('pagehide')), undefined],
  ])('lets a clicked hold go when %s', (_case, happen, handler) => {
    const t = mount();
    t.fire('onClick');
    if (handler) t.fire(handler);
    act(() => {
      happen();
    });
    expect(t.held()).toBe(false);
  });

  it('lets a clicked hold go when it goes away', () => {
    const t = mount();
    t.fire('onClick');
    act(() => renderer?.unmount());
    renderer = undefined;
    expect(t.held()).toBe(false);
  });

  it.each([
    ['a mouse', ['onPointerDown', 'onPointerUp', 'onClick']],
    // Touch and pen: the pointer leaves the button before the click comes.
    ['a finger', ['onPointerDown', 'onPointerUp', 'onPointerLeave', 'onClick']],
  ])('takes the click that ends a press with %s for that press', (_case, events) => {
    const t = mount();
    events.forEach((handler) => {
      t.fire(handler);
    });
    expect(t.held()).toBe(false);
    expect(t.button().props['aria-pressed']).toBe(false);

    // A click on its own afterwards still holds it.
    t.fire('onClick');
    expect(t.held()).toBe(true);
  });

  it('takes a click long after a press that ended elsewhere as a click on its own', () => {
    vi.useFakeTimers();
    try {
      const t = mount();
      t.fire('onPointerDown');
      t.fire('onPointerLeave');
      vi.advanceTimersByTime(5_000);
      t.fire('onClick');
      expect(t.held()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a refused hold as not held while still pressed', () => {
    const t = mount();
    t.fire('onPointerDown');
    act(() => t.store.set(pauseHeldAtom, false));
    expect(t.button().props.variant).toBe('SurfaceVariant');
    expect(t.button().props['aria-pressed']).toBe(false);
    // Letting go afterwards takes nothing back.
    t.fire('onPointerUp');
    expect(t.held()).toBe(false);
  });
});
