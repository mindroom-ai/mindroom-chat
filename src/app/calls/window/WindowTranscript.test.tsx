// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeCallAtom, type ActiveCall } from '../callStore';
import type { TranscriptLine } from '../transcription/api';
import {
  callTranscriptionAtom,
  liveTranscriptAtom,
  type TranscriptionStatus,
} from '../transcription/transcriptionState';
import { transcriptPanelAtom } from '../transcription/transcriptPanel';
import { CallWindowSizeContext, type CallWindowSize } from './callWindowFrame';
import { clearCallWindowStore, getCallWindowSettingsAtom } from './callWindowState';
import { WindowTranscript } from './WindowTranscript';

// The live transcript inside the floating window: under the stage, beside it, or its latest line
// over it, by the window's size; the divider between them; and the same transcript as the room's
// side panel shows, as this device's transcriber reads it.

const USER = '@ann:example.org';
const BOB = '@bob:example.org';
const ROOM_ID = '!room:example.org';

/** Each time something reads the live call on its own, which the window never does. */
const polls = vi.hoisted(() => ({ count: 0 }));
vi.mock('../transcription/useTranscriptionServer', () => ({
  useTranscriptionServer: () => ({ apiUrl: 'https://mindroom.example.org', discovered: true }),
}));
vi.mock('../transcription/liveCallPoll', () => ({
  pollLiveCall: () => {
    polls.count += 1;
    return new Promise(() => undefined);
  },
}));
vi.mock('../../matrix/openidAudience', () => ({ requestAudienceOpenIdToken: vi.fn() }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => USER, getUserId: () => USER }),
}));
vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));
vi.mock('../CallTile', () => ({ CallMemberAvatar: () => <span data-avatar="" /> }));

const NAMES: Record<string, string> = { [USER]: 'Ann', [BOB]: 'Bob' };
const room = {
  roomId: ROOM_ID,
  getMember: (userId: string) =>
    NAMES[userId] ? { userId, name: NAMES[userId], rawDisplayName: NAMES[userId] } : null,
  membersLoaded: () => true,
} as unknown as Room;

const speech = (id: string, userId: string, text: string): TranscriptLine => ({
  id,
  callId: 'call-1',
  userId,
  saidAt: `2026-11-07T09:30:0${id.slice(-1)}Z`,
  seconds: 2,
  kind: 'speech',
  text,
});
const LINES: TranscriptLine[] = [
  speech('l1', USER, 'Shall we start?'),
  { ...speech('l2', BOB, ''), kind: 'gap', reason: 'paused' } as TranscriptLine,
  speech('l3', BOB, 'I will write the notes.'),
];

let store = createStore();
const settings = () => store.get(getCallWindowSettingsAtom(USER));

/** This device is in the room's call, which MindRoom transcribes (`status`), with `lines` said. */
const inCall = (status: TranscriptionStatus = 'transcribing', lines = LINES) => {
  store.set(activeCallAtom, {
    kind: 'room',
    call: { room: { roomId: ROOM_ID } },
  } as unknown as ActiveCall);
  store.set(callTranscriptionAtom, { roomId: ROOM_ID, status });
  store.set(liveTranscriptAtom, {
    roomId: ROOM_ID,
    call: {
      id: 'call-1',
      roomId: ROOM_ID,
      rowEventId: '$row',
      startedAt: '2026-11-07T09:29:00Z',
      endedAt: null,
      members: [USER, BOB],
      pausedBy: null,
    },
    lines,
    names: {},
  });
};
const showTranscript = (split?: number) =>
  store.set(getCallWindowSettingsAtom(USER), {
    mode: 'floating',
    transcript: true,
    transcriptSplit: split,
  });

// The window's title bar, its handle (focusable, as a button is), comes before the call's body.
const windowWith = (size: CallWindowSize) => (
  <Provider store={store}>
    <CallWindowSizeContext.Provider value={size}>
      <button type="button" data-call-window-handle="" />
      <WindowTranscript room={room}>
        <button type="button" data-stage="" />
      </WindowTranscript>
    </CallWindowSizeContext.Provider>
  </Provider>
);

const layout = () =>
  document
    .querySelector('[data-call-transcript-layout]')
    ?.getAttribute('data-call-transcript-layout');
const divider = () => screen.queryByRole('separator', { name: 'Resize the transcript' });
const texts = (selector: string) =>
  [...document.querySelectorAll(selector)].map((element) => element.textContent);

// jsdom has no pointer events or pointer capture.
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;

  readonly isPrimary: boolean;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.isPrimary = init.isPrimary ?? false;
  }
}
const CAPTURE = ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture'] as const;

// jsdom lays nothing out: a test sizes the transcript's scroll box itself and reports the change
// as the browser's ResizeObserver would.
const observed = new Map<Element, () => void>();
class TestResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    const entry = { target } as ResizeObserverEntry;
    observed.set(target, () => this.callback([entry], this as unknown as ResizeObserver));
  }

  unobserve(target: Element) {
    observed.delete(target);
  }

  disconnect() {
    observed.clear();
  }
}

/**
 * The transcript's scroll box, `content` px of lines in a box `height` px tall, scrolled to the
 * end; its scroll position stays within them, as a browser's does.
 */
const scrollBox = (content: number, height: number) => {
  const body = document.querySelector<HTMLElement>('[data-call-window-transcript] > div')!;
  const box = { content, height, top: content - height };
  const clamp = (top: number) => Math.max(0, Math.min(top, box.content - box.height));
  Object.defineProperties(body, {
    scrollHeight: { configurable: true, get: () => box.content },
    clientHeight: { configurable: true, get: () => box.height },
    scrollTop: {
      configurable: true,
      get: () => box.top,
      set: (top: number) => {
        box.top = clamp(top);
      },
    },
  });
  /** The box at a new size, which layout reports after it moved what it had to. */
  const resize = (next: Partial<Pick<typeof box, 'content' | 'height'>>) => {
    Object.assign(box, next);
    box.top = clamp(box.top);
    act(() => observed.get(body)?.());
  };
  return { body, box, resize };
};

beforeEach(() => {
  localStorage.clear();
  store = createStore();
  polls.count = 0;
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  Object.assign(HTMLElement.prototype, {
    setPointerCapture: () => undefined,
    hasPointerCapture: () => true,
    releasePointerCapture: () => undefined,
  });
});

afterEach(() => {
  cleanup();
  clearCallWindowStore(USER);
  observed.clear();
  vi.unstubAllGlobals();
  for (const name of CAPTURE) Reflect.deleteProperty(HTMLElement.prototype, name);
});

describe('the live transcript in the floating window', () => {
  it('shows only the stage until it is switched on, and only once MindRoom transcribes the call', () => {
    inCall();
    const { rerender } = render(windowWith({ width: 400, height: 480 }));
    expect(document.querySelector('[data-stage]')).not.toBeNull();
    expect(layout()).toBeUndefined();
    expect(screen.queryByRole('log')).toBeNull();

    act(() => showTranscript());
    expect(layout()).toBe('stacked');
    expect(screen.getByRole('log')).toBeTruthy();

    // Before MindRoom first answered, there is no transcript to show yet.
    act(() => store.set(callTranscriptionAtom, { roomId: ROOM_ID, status: 'joining' }));
    rerender(windowWith({ width: 400, height: 480 }));
    expect(layout()).toBeUndefined();
  });

  it("closes the room's side transcript once it shows, so the lines show and are read out once", () => {
    // Opened from the call's row before joining, with the window's transcript left on: it shows
    // once MindRoom answers for the call.
    inCall('joining');
    store.set(transcriptPanelAtom, { roomId: ROOM_ID, replacedCall: false });
    showTranscript();
    render(windowWith({ width: 400, height: 480 }));
    expect(store.get(transcriptPanelAtom)?.roomId).toBe(ROOM_ID);

    act(() => store.set(callTranscriptionAtom, { roomId: ROOM_ID, status: 'transcribing' }));
    expect(layout()).toBe('stacked');
    expect(store.get(transcriptPanelAtom)).toBeUndefined();
  });

  it("leaves another room's side transcript open when it shows", () => {
    inCall();
    const other = { roomId: '!other:example.org', replacedCall: false };
    store.set(transcriptPanelAtom, other);
    showTranscript();
    render(windowWith({ width: 400, height: 480 }));
    expect(layout()).toBe('stacked');
    expect(store.get(transcriptPanelAtom)).toEqual(other);
  });

  it("shows the side panel's transcript as the transcriber reads it, without reading on its own", () => {
    inCall();
    showTranscript();
    render(windowWith({ width: 400, height: 480 }));

    expect(texts('[data-live-transcript-name]')).toEqual(['Ann', 'Bob']);
    expect(texts('[data-live-transcript-text]')).toEqual([
      'Shall we start?',
      'I will write the notes.',
    ]);
    expect(texts('[data-live-transcript-gap]')).toEqual(['Paused']);
    expect(document.body.textContent).toContain('This call is transcribed.');
    // The stage shows who is in the call.
    expect(document.querySelector('[data-live-transcript-member]')).toBeNull();
    expect(polls.count).toBe(0);
  });

  it('says transcripts are unavailable while MindRoom cannot be reached, keeping what it read', () => {
    inCall('unavailable');
    showTranscript();
    render(windowWith({ width: 400, height: 480 }));
    expect(screen.getByRole('status').textContent).toBe('Transcripts are unavailable');
    expect(texts('[data-live-transcript-text]')).toHaveLength(2);
  });

  it.each([
    [400, 480, 'stacked', 'horizontal'],
    [559, 340, 'stacked', 'horizontal'],
    [560, 240, 'side', 'vertical'],
    [800, 600, 'side', 'vertical'],
  ] as const)(
    'gives a %i by %i window the %s layout with a %s divider',
    (width, height, expected, orientation) => {
      inCall();
      showTranscript();
      render(windowWith({ width, height }));
      expect(layout()).toBe(expected);
      expect(divider()?.getAttribute('aria-orientation')).toBe(orientation);
    }
  );

  it.each([
    [400, 339],
    [559, 300],
    [900, 239],
  ])(
    'shows a %i by %i window only the latest line over the stage, the whole log still read out',
    (width, height) => {
      inCall();
      showTranscript();
      render(windowWith({ width: 400, height: 480 }));
      const log = screen.getByRole('log');

      cleanup();
      render(windowWith({ width, height }));
      expect(layout()).toBe('subtitle');
      expect(divider()).toBeNull();
      const subtitle = document.querySelector('[data-call-window-subtitle]');
      expect(subtitle?.textContent).toBe('Bob I will write the notes.');
      // The log announces each new line; the subtitle shows its last one again, so it is not read.
      expect(subtitle?.getAttribute('aria-hidden')).toBe('true');
      expect(screen.getByRole('log').textContent).toBe(log.textContent);
    }
  );

  it('keeps the log when the window is resized from one layout to another', () => {
    inCall();
    showTranscript();
    const { rerender } = render(windowWith({ width: 400, height: 480 }));
    const log = screen.getByRole('log');
    rerender(windowWith({ width: 400, height: 300 }));
    expect(layout()).toBe('subtitle');
    rerender(windowWith({ width: 700, height: 480 }));
    expect(layout()).toBe('side');
    expect(screen.getByRole('log')).toBe(log);
  });

  it('shows a gap as the latest line in the subtitle, and nothing before anyone spoke', () => {
    inCall('transcribing', [speech('l1', USER, 'Hello.'), { ...LINES[1]!, id: 'l2' }]);
    showTranscript();
    const { rerender } = render(windowWith({ width: 400, height: 300 }));
    expect(document.querySelector('[data-call-window-subtitle]')?.textContent).toBe('Paused');

    act(() => inCall('transcribing', []));
    rerender(windowWith({ width: 400, height: 300 }));
    expect(document.querySelector('[data-call-window-subtitle]')).toBeNull();
  });

  it('names the divider and gives the stage 60 percent until it is moved', () => {
    inCall();
    showTranscript();
    render(windowWith({ width: 400, height: 480 }));
    const separator = divider()!;
    expect(separator.tabIndex).toBe(0);
    expect(separator.getAttribute('aria-valuenow')).toBe('60');
    expect(separator.getAttribute('aria-valuemin')).toBe('25');
    expect(separator.getAttribute('aria-valuemax')).toBe('80');
    // The value is the stage's share, so it says whose share is which.
    expect(separator.getAttribute('aria-valuetext')).toBe(
      'Stage 60 percent, transcript 40 percent'
    );
    fireEvent.keyDown(separator, { key: 'ArrowDown' });
    expect(separator.getAttribute('aria-valuetext')).toBe(
      'Stage 65 percent, transcript 35 percent'
    );
  });

  it("hands the focus the divider had to the window's handle when the divider goes", () => {
    inCall();
    showTranscript();
    const { rerender } = render(windowWith({ width: 400, height: 480 }));
    const handle = document.querySelector<HTMLElement>('[data-call-window-handle]');

    // The window turned too short for more than the subtitle.
    act(() => divider()!.focus());
    rerender(windowWith({ width: 400, height: 300 }));
    expect(document.activeElement).toBe(handle);

    // The transcript was switched off.
    rerender(windowWith({ width: 400, height: 480 }));
    act(() => divider()!.focus());
    act(() => store.set(getCallWindowSettingsAtom(USER), { mode: 'floating', transcript: false }));
    expect(divider()).toBeNull();
    expect(document.activeElement).toBe(handle);

    // Focus elsewhere stays there.
    act(() => showTranscript());
    const stage = document.querySelector<HTMLElement>('[data-stage]')!;
    act(() => stage.focus());
    rerender(windowWith({ width: 400, height: 300 }));
    expect(document.activeElement).toBe(stage);
  });

  it('moves the divider 5 percent a key step, Home and End to its ends, and keeps each step', () => {
    inCall();
    showTranscript();
    const { rerender } = render(windowWith({ width: 400, height: 480 }));
    const key = (name: string) => fireEvent.keyDown(divider()!, { key: name });

    key('ArrowDown');
    expect(divider()?.getAttribute('aria-valuenow')).toBe('65');
    expect(settings().transcriptSplit).toBe(0.65);
    key('ArrowUp');
    key('ArrowUp');
    expect(settings().transcriptSplit).toBe(0.55);
    key('Home');
    expect(divider()?.getAttribute('aria-valuenow')).toBe('25');
    key('End');
    expect(settings().transcriptSplit).toBe(0.8);
    // Up and Down belong to the stacked layout; beside the stage, Left and Right move it.
    rerender(windowWith({ width: 700, height: 480 }));
    key('ArrowDown');
    expect(settings().transcriptSplit).toBe(0.8);
    key('ArrowLeft');
    expect(settings().transcriptSplit).toBe(0.75);
  });

  it('follows the pointer while dragged and keeps the split on release, not before', () => {
    inCall();
    showTranscript();
    render(windowWith({ width: 400, height: 480 }));
    const split = document.querySelector<HTMLElement>('[data-call-transcript-layout]')!;
    split.getBoundingClientRect = () =>
      ({ left: 0, top: 100, right: 380, bottom: 400, width: 380, height: 300 } as DOMRect);
    const pointer = { pointerId: 3, isPrimary: true, button: 0 };

    const pressed = fireEvent.pointerDown(divider()!, { ...pointer, clientY: 280 });
    // Nothing else (text, the window) takes the press.
    expect(pressed).toBe(false);
    fireEvent.pointerMove(divider()!, { ...pointer, clientY: 310 });
    expect(divider()?.getAttribute('aria-valuenow')).toBe('70');
    expect(settings().transcriptSplit).toBeUndefined();
    // Past the end, it stops at 80 percent.
    fireEvent.pointerMove(divider()!, { ...pointer, clientY: 395 });
    expect(divider()?.getAttribute('aria-valuenow')).toBe('80');
    fireEvent.pointerMove(divider()!, { ...pointer, clientY: 250 });
    fireEvent.pointerUp(divider()!, { ...pointer, clientY: 250 });
    expect(settings().transcriptSplit).toBe(0.5);
    expect(divider()?.getAttribute('aria-valuenow')).toBe('50');

    // A move after the release is no drag.
    fireEvent.pointerMove(divider()!, { ...pointer, clientY: 160 });
    expect(divider()?.getAttribute('aria-valuenow')).toBe('50');
  });

  it('drops a drag the divider goes away during, keeping the split it had', () => {
    inCall();
    showTranscript();
    const { rerender } = render(windowWith({ width: 400, height: 480 }));
    const split = document.querySelector<HTMLElement>('[data-call-transcript-layout]')!;
    split.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300 } as DOMRect);
    const pointer = { pointerId: 4, isPrimary: true, button: 0 };
    fireEvent.pointerDown(divider()!, { ...pointer, clientY: 180 });
    fireEvent.pointerMove(divider()!, { ...pointer, clientY: 90 });
    expect(divider()?.getAttribute('aria-valuenow')).toBe('30');

    // The window shrinks to the subtitle layout, which has no divider, and grows back.
    rerender(windowWith({ width: 400, height: 300 }));
    rerender(windowWith({ width: 400, height: 480 }));
    expect(divider()?.getAttribute('aria-valuenow')).toBe('60');
    expect(settings().transcriptSplit).toBeUndefined();
  });

  it('gives the stage and the transcript their shares of the window body', () => {
    inCall();
    showTranscript(0.7);
    render(windowWith({ width: 400, height: 480 }));
    const stagePane = document.querySelector<HTMLElement>('[data-stage]')!.parentElement!;
    const pane = document.querySelector<HTMLElement>('[data-call-window-transcript]')!;
    expect(stagePane.style.flexGrow).toBe('70');
    expect(pane.style.flexGrow).toBe('30');
  });

  it('keeps the newest line in view, unless the person scrolled up', () => {
    inCall('transcribing', LINES.slice(0, 1));
    showTranscript();
    const { rerender } = render(windowWith({ width: 400, height: 480 }));
    const body = document.querySelector<HTMLElement>('[data-call-window-transcript] > div')!;
    let top = 0;
    Object.defineProperties(body, {
      scrollHeight: { configurable: true, get: () => 600 },
      clientHeight: { configurable: true, get: () => 100 },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value: number) => {
          top = value;
        },
      },
    });

    act(() => inCall('transcribing', LINES.slice(0, 2)));
    rerender(windowWith({ width: 400, height: 480 }));
    expect(top).toBe(600);

    top = 100;
    fireEvent.scroll(body);
    act(() => inCall('transcribing', LINES));
    rerender(windowWith({ width: 400, height: 480 }));
    expect(top).toBe(100);
  });

  it('keeps the newest line in view when the layout changes or the divider moves', () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    inCall();
    showTranscript();
    const { rerender } = render(windowWith({ width: 400, height: 480 }));
    const { body, box, resize } = scrollBox(1204, 120);

    // Shrunk to the subtitle, the transcript's box held all its lines (Chromium scrolled it to the
    // top); grown back, it shows the end again.
    rerender(windowWith({ width: 400, height: 300 }));
    resize({ height: 1204 });
    rerender(windowWith({ width: 400, height: 480 }));
    resize({ height: 120 });
    expect(box.top).toBe(1084);

    // A larger stage leaves the transcript less room, which would hide its newest lines.
    fireEvent.keyDown(divider()!, { key: 'ArrowDown' });
    resize({ height: 80 });
    expect(box.top).toBe(1124);

    // The scroll event of that comes a frame late, after the next step shrank the box again: the
    // person did not scroll, so the end still stays in view.
    fireEvent.keyDown(divider()!, { key: 'ArrowDown' });
    box.height = 40;
    fireEvent.scroll(body);
    resize({});
    expect(box.top).toBe(1164);
  });

  it('keeps where the person scrolled up to when the layout changes or the divider moves', () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    inCall();
    showTranscript();
    const { rerender } = render(windowWith({ width: 400, height: 480 }));
    const { body, box, resize } = scrollBox(1204, 120);
    box.top = 300;
    fireEvent.scroll(body);

    fireEvent.keyDown(divider()!, { key: 'ArrowDown' });
    resize({ height: 80 });
    expect(box.top).toBe(300);
    rerender(windowWith({ width: 400, height: 300 }));
    resize({ height: 16 });
    rerender(windowWith({ width: 400, height: 480 }));
    resize({ height: 80 });
    expect(box.top).toBe(300);
  });
});
