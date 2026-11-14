// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from '../lib/dom';
import type { StoredSession } from '../matrix/session/sessions';
import {
  captureScreenshot,
  hideQuickCapture,
  isNativeQuickCaptureAvailable,
  openScreenRecordingSettings,
  ScreenshotError,
  showMainWindow,
} from '../native/nativeQuickCapture';
import type { CaptureChannel } from './captureChannel';
import type {
  CaptureAction,
  CaptureItem,
  CaptureMessage,
  CaptureResult,
  CaptureState,
} from './captureProtocol';
import { QuickCapturePage } from './QuickCapturePage';

const mocks = vi.hoisted(() => ({ session: undefined as StoredSession | undefined }));
vi.mock('../matrix/session/useSessionStore', () => ({ useActiveSession: () => mocks.session }));
vi.mock('../native/nativeQuickCapture', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../native/nativeQuickCapture')>()),
  isNativeQuickCaptureAvailable: vi.fn(),
  hideQuickCapture: vi.fn(),
  showMainWindow: vi.fn(),
  openScreenRecordingSettings: vi.fn(),
  captureScreenshot: vi.fn(),
}));
vi.mock('../lib/dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/dom')>()),
  copyToClipboard: vi.fn(),
}));

const HOST = 'host-1';

// jsdom lays nothing out and has no scrollIntoView.
const scrollIntoView = vi.fn();

const ROOMS = [
  { id: '!inbox', name: 'Inbox', direct: false },
  { id: '!code', name: 'Code', direct: false },
  { id: '!mind', name: 'Mind', direct: true },
];

// Each row moved a different while ago, so a time under the wrong row shows.
const ago = (minutes: number): number => Date.now() - minutes * 60_000;

const ITEMS: CaptureItem[] = [
  {
    threadId: '$one',
    title: 'Why does slot 27 flake?',
    line: 'Running the suite again',
    lineSender: 'Code',
    replyText: 'Running the suite again, with traces on.',
    chip: 'working',
    resolved: false,
    ts: ago(1),
  },
  { threadId: '$two', title: 'Idea: default room per app', line: '', resolved: false, ts: ago(5) },
  {
    threadId: '$ask',
    title: 'Deploy to staging?',
    line: 'Approve the deploy?',
    lineSender: 'Ops',
    replyText: 'Approve the deploy?',
    chip: 'needs-you',
    resolved: false,
    ts: ago(30),
  },
  {
    threadId: '$news',
    title: 'Cheapest speech-to-text?',
    line: 'Three fit',
    lineSender: 'Research',
    replyText: 'Three fit.',
    chip: 'new',
    resolved: false,
    ts: ago(120),
  },
  {
    threadId: '$done',
    title: 'Which Node version?',
    line: 'Node 24',
    lineSender: 'Code',
    replyText: 'Node 24.',
    resolved: true,
    ts: ago(3 * 24 * 60),
  },
];

const roomState = (items: CaptureItem[] = ITEMS): CaptureState => ({
  userId: '@me:x',
  roomId: '!inbox',
  rooms: ROOMS,
  items,
});

const makeChannel = () => {
  const posted: CaptureMessage[] = [];
  const listeners = new Set<(message: CaptureMessage) => void>();
  const channel: CaptureChannel = {
    post: (message) => {
      posted.push(message);
    },
    listen: (onMessage) => {
      listeners.add(onMessage);
      return () => listeners.delete(onMessage);
    },
    close: () => listeners.clear(),
  };
  const deliver = (message: CaptureMessage) =>
    act(() => {
      listeners.forEach((listener) => listener(message));
    });
  const requests = () => posted.flatMap((message) => (message.type === 'request' ? [message] : []));
  const actions = (): CaptureAction[] => requests().map((request) => request.action);
  /** Answers the newest request as the host would. */
  const respond = async (result: CaptureResult) => {
    const request = requests().at(-1);
    if (!request) throw new Error('No request to answer.');
    await act(async () => {
      listeners.forEach((listener) =>
        listener({ v: 1, type: 'response', id: request.id, hostId: HOST, result })
      );
    });
  };
  const pushState = (state: CaptureState) => deliver({ v: 1, type: 'state', hostId: HOST, state });
  const hellos = () => posted.filter((message) => message.type === 'hello').length;
  return { channel, posted, actions, respond, pushState, deliver, hellos };
};

/** The page against a fake host, which has sent `state` (with null, nothing yet). */
const setup = (state: CaptureState | null = roomState()) => {
  const rig = makeChannel();
  render(<QuickCapturePage channel={rig.channel} />);
  if (state) rig.pushState(state);
  return rig;
};

const input = () => screen.getByRole('textbox', { name: 'New entry' });
const item = (title: string) =>
  screen.getAllByRole('listitem').find((listed) => listed.textContent?.includes(title)) ??
  document.body;
/** The leading mark of a row, which resolves or reopens it. */
const mark = (title: string, name: 'Done' | 'Reopen' = 'Done') =>
  within(item(title)).getAllByRole('button', { name })[0] as HTMLButtonElement;
const footer = () => document.querySelector<HTMLElement>('[data-capture-hints]');
const row = (title: string) => screen.getByRole('button', { name: new RegExp(title) });
const press = (element: Element, key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(element, { key, ...init });
const type = (element: Element, value: string) => fireEvent.change(element, { target: { value } });
const png = (name: string) => new File(['png'], name, { type: 'image/png' });
const paste = (files: File[]) =>
  fireEvent.paste(input(), { clipboardData: { files, types: ['Files'] } });
/** Sets what `document.visibilityState` says and tells the page, as a hidden window does. */
const setPageVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

beforeEach(() => {
  mocks.session = undefined;
  vi.mocked(isNativeQuickCaptureAvailable).mockReturnValue(false);
  vi.mocked(hideQuickCapture).mockResolvedValue(undefined);
  vi.mocked(showMainWindow).mockResolvedValue(undefined);
  vi.mocked(openScreenRecordingSettings).mockResolvedValue(undefined);
  vi.mocked(copyToClipboard).mockResolvedValue(true);
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  Reflect.deleteProperty(document, 'visibilityState');
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('QuickCapturePage without a host', () => {
  it('asks to sign in when no host answers and there is no session', () => {
    vi.useFakeTimers();
    const { posted } = setup(null);
    expect(posted).toEqual([{ v: 1, type: 'hello' }]);
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    expect(screen.getByText('Sign in to MindRoom')).toBeTruthy();
    expect(screen.queryByText('MindRoom is not open')).toBeNull();
  });

  it('says MindRoom is not open with a session, and its button shows the main window', () => {
    vi.useFakeTimers();
    vi.mocked(isNativeQuickCaptureAvailable).mockReturnValue(true);
    mocks.session = { sessionId: 's', userId: '@me:x' } as unknown as StoredSession;
    setup(null);
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    expect(screen.getByText('MindRoom is not open')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open MindRoom' }));
    expect(showMainWindow).toHaveBeenCalledTimes(1);
  });

  it('offers no Open button without the native plugin, where it could show nothing', () => {
    vi.useFakeTimers();
    mocks.session = { sessionId: 's', userId: '@me:x' } as unknown as StoredSession;
    setup(null);
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    expect(screen.getByText('MindRoom is not open')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open MindRoom' })).toBeNull();
  });

  it('names itself in the document title', () => {
    setup(null);
    expect(document.title).toBe('Quick Capture');
  });
});

describe('QuickCapturePage in the Mac window', () => {
  it('marks itself as native, so the window material shows, only with the native plugin', () => {
    const { unmount } = render(<QuickCapturePage channel={makeChannel().channel} />);
    expect(document.querySelector('[data-native]')).toBeNull();
    unmount();
    vi.mocked(isNativeQuickCaptureAvailable).mockReturnValue(true);
    setup();
    expect(document.querySelector('[data-native]')).toBeTruthy();
  });

  it('opens no web menu on a right click, except in a field or on selected text', () => {
    vi.mocked(isNativeQuickCaptureAvailable).mockReturnValue(true);
    setup();
    const rightClick = (target: Element) => !fireEvent.contextMenu(target);
    expect(rightClick(item('Idea: default room per app'))).toBe(true);
    expect(rightClick(input())).toBe(false);
    const selection = { isCollapsed: false } as Selection;
    const getSelection = vi.spyOn(window, 'getSelection').mockReturnValue(selection);
    expect(rightClick(item('Idea: default room per app'))).toBe(false);
    getSelection.mockRestore();
  });

  it('leaves the right click alone in a browser', () => {
    setup();
    expect(fireEvent.contextMenu(item('Idea: default room per app'))).toBe(true);
  });
});

describe('QuickCapturePage and its host', () => {
  it('says no hello while hidden, and hello when it shows again or the window gets the focus', () => {
    vi.useFakeTimers();
    const rig = setup();
    expect(rig.hellos()).toBe(1);
    setPageVisibility('hidden');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(rig.hellos()).toBe(1);
    // Hidden, the widget does not count the host's silence: the list stays.
    expect(screen.getByRole('list', { name: 'Threads in Inbox' })).toBeTruthy();
    setPageVisibility('visible');
    expect(rig.hellos()).toBe(2);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(rig.hellos()).toBe(3);
  });

  it('keeps the text and the images of the entry while the host goes and comes back', () => {
    const rig = setup();
    paste([png('a.png')]);
    type(input(), 'What is this?');
    rig.deliver({ v: 1, type: 'gone', hostId: HOST });
    expect(screen.queryByRole('textbox', { name: 'New entry' })).toBeNull();
    rig.pushState(roomState());
    expect((input() as HTMLTextAreaElement).value).toBe('What is this?');
    expect(screen.getByRole('button', { name: 'Remove a.png' })).toBeTruthy();
  });
});

describe('QuickCapturePage room picker', () => {
  it('opens with no room; typing filters, and Enter picks the first row', () => {
    const rig = setup({ ...roomState([]), roomId: null });
    expect(screen.getByRole('button', { name: 'Choose a room' })).toBeTruthy();
    const field = screen.getByLabelText('Search rooms');
    expect(document.activeElement).toBe(field);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringContaining('Inbox'),
      expect.stringContaining('Code'),
      expect.stringContaining('Mind'),
    ]);
    type(field, ' MI ');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringContaining('Mind'),
    ]);
    press(field, 'Enter');
    expect(rig.actions()).toEqual([{ kind: 'selectRoom', roomId: '!mind' }]);
  });

  it('moves with the arrows and says when nothing matches', () => {
    const rig = setup({ ...roomState([]), roomId: null });
    const field = screen.getByLabelText('Search rooms');
    press(field, 'ArrowDown');
    press(field, 'ArrowDown');
    press(field, 'ArrowUp');
    press(field, 'Enter');
    expect(rig.actions()).toEqual([{ kind: 'selectRoom', roomId: '!code' }]);
    type(field, 'zzz');
    expect(screen.getByText('No rooms match')).toBeTruthy();
  });

  it('keeps the highlighted room when a new state moves it, and Enter picks that room', () => {
    const rig = setup({ ...roomState([]), roomId: null });
    const field = screen.getByLabelText('Search rooms');
    press(field, 'ArrowDown');
    expect(screen.getByRole('option', { name: /Code/ }).getAttribute('aria-selected')).toBe('true');
    // A message in Mind makes it the most recently active room.
    rig.pushState({
      ...roomState([]),
      roomId: null,
      rooms: [
        { id: '!mind', name: 'Mind', direct: true },
        { id: '!inbox', name: 'Inbox', direct: false },
        { id: '!code', name: 'Code', direct: false },
      ],
    });
    expect(screen.getAllByRole('option')[0]?.textContent).toContain('Mind');
    expect(screen.getByRole('option', { name: /Code/ }).getAttribute('aria-selected')).toBe('true');
    expect(field.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: /Code/ }).id
    );
    press(field, 'Enter');
    expect(rig.actions()).toEqual([{ kind: 'selectRoom', roomId: '!code' }]);
  });

  it('scrolls the highlighted room into view as the arrows move it', () => {
    setup({ ...roomState([]), roomId: null });
    const field = screen.getByLabelText('Search rooms');
    scrollIntoView.mockClear();
    press(field, 'ArrowDown');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(screen.getByRole('option', { name: /Code/ }));
    press(field, 'ArrowDown');
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(screen.getByRole('option', { name: /Mind/ }));
  });

  it('closes on a picked room and gives the input the focus', async () => {
    const rig = setup({ ...roomState([]), roomId: null });
    press(screen.getByLabelText('Search rooms'), 'Enter');
    rig.pushState(roomState());
    await rig.respond({ ok: true });
    expect(screen.queryByLabelText('Search rooms')).toBeNull();
    expect(document.activeElement).toBe(input());
  });

  it('opens from the room button and from Tab in an empty input', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Posting to Inbox. Change room' }));
    expect(screen.getByLabelText('Search rooms')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    press(screen.getByLabelText('Search rooms'), 'Escape');
    expect(screen.queryByLabelText('Search rooms')).toBeNull();
    type(input(), 'text');
    press(input(), 'Tab');
    expect(screen.queryByLabelText('Search rooms')).toBeNull();
    type(input(), '');
    press(input(), 'Tab');
    expect(screen.getByLabelText('Search rooms')).toBeTruthy();
  });
});

describe('QuickCapturePage with a room', () => {
  it('shows the room, focuses the input, and lists the threads', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Posting to Inbox. Change room' })).toBeTruthy();
    expect(document.activeElement).toBe(input());
    const list = screen.getByRole('list', { name: 'Threads in Inbox' });
    const items = within(list).getAllByRole('listitem');
    const rows = items.map((item) => item.textContent);
    expect(rows).toEqual([
      expect.stringContaining('Why does slot 27 flake?'),
      expect.stringContaining('Idea: default room per app'),
      expect.stringContaining('Deploy to staging?'),
      expect.stringContaining('Cheapest speech-to-text?'),
      expect.stringContaining('Which Node version?'),
    ]);
    expect(rows[0]).toContain('Code: Running the suite again');
    expect(rows[1]).toContain('Sent');
    expect(rows[2]).toContain('Ops: Approve the deploy?');
    expect(rows[3]).toContain('Research: Three fit');
    // What a thread is doing stands at its row's end: a spinner, a label, a dot. A thread at
    // work or waiting shows no time; the others do.
    const [working, sent, waiting, unread, resolved] = items as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement
    ];
    expect(within(working).getByRole('img', { name: 'Working' })).toBeTruthy();
    expect(within(waiting).getByText('Needs you')).toBeTruthy();
    expect(within(unread).getByRole('img', { name: 'New' })).toBeTruthy();
    expect(within(sent).queryAllByRole('img')).toHaveLength(0);
    expect(within(resolved).queryAllByRole('img')).toHaveLength(0);
    const timeOf = (row: HTMLElement) => row.querySelector('[data-capture-time]')?.textContent;
    expect(timeOf(sent)).toBe('5m');
    expect(timeOf(unread)).toBe('2h');
    expect(timeOf(resolved)).toBe('3d');
    expect(timeOf(working)).toBeUndefined();
    expect(timeOf(waiting)).toBeUndefined();
    // A resolved row says so to a screen reader; the eye has the check and the dimming.
    expect(rows[4]).toContain('Resolved');
    expect(within(resolved).getByRole('button', { name: 'Reopen' })).toBeTruthy();
  });

  it('shows the keys of the part that has the focus at the foot', () => {
    setup();
    // The entry holds no keys of its own.
    expect(input().closest('[data-capture-entry]')?.textContent).toBe('');
    // Each key before what it does, written as this platform's menus write it.
    expect(footer()?.dataset.captureHints).toBe('input');
    expect(footer()?.textContent).toBe('EnterSendCtrl+EnterSend and OpenTabRoom↓List');
    press(input(), 'ArrowDown');
    expect(footer()?.dataset.captureHints).toBe('list');
    expect(footer()?.textContent).toBe('SpacePeekRReplyXDoneEnterOpen');
    // The reply field is a part of the list.
    press(row('Why does slot 27 flake'), 'r');
    expect(document.activeElement).toBe(screen.getByLabelText('Reply in this thread'));
    expect(footer()?.dataset.captureHints).toBe('list');
  });

  it("shows the picker's keys at the foot while the picker is open", () => {
    setup();
    press(input(), 'Tab');
    expect(footer()?.dataset.captureHints).toBe('picker');
    expect(footer()?.textContent).toBe('↑↓Move');
  });

  it('resolves and reopens a thread from its leading mark, which is no tab stop', () => {
    const rig = setup();
    const open = mark('Why does slot 27 flake');
    expect(open.tabIndex).toBe(-1);
    fireEvent.click(open);
    fireEvent.click(mark('Which Node version', 'Reopen'));
    expect(rig.actions()).toEqual([
      { kind: 'resolve', roomId: '!inbox', threadId: '$one', resolved: true },
      { kind: 'resolve', roomId: '!inbox', threadId: '$done', resolved: false },
    ]);
  });

  it('disables the leading mark of an entry still being sent', () => {
    const rig = setup(
      roomState([{ threadId: '~pending', title: 'On its way', line: '', resolved: false, ts: 1 }])
    );
    expect(mark('On its way').disabled).toBe(true);
    fireEvent.click(mark('On its way'));
    expect(rig.actions()).toEqual([]);
  });

  it('says when the room has nothing open', () => {
    setup(roomState([]));
    expect(screen.getByText('Nothing open here')).toBeTruthy();
  });
});

describe('QuickCapturePage sending', () => {
  it('sends the text, then empties the input and keeps the focus', async () => {
    const rig = setup();
    type(input(), '  Buy oat milk ');
    press(input(), 'Enter');
    expect(rig.actions()).toEqual([
      { kind: 'send', roomId: '!inbox', text: 'Buy oat milk', images: [], open: false },
    ]);
    expect(screen.getByText('Sending')).toBeTruthy();
    await rig.respond({ ok: true, threadId: '$new' });
    expect((input() as HTMLTextAreaElement).value).toBe('');
    expect(document.activeElement).toBe(input());
    expect(hideQuickCapture).not.toHaveBeenCalled();
  });

  it('keeps the text and says it was not sent when the send fails', async () => {
    const rig = setup();
    type(input(), 'Buy oat milk');
    press(input(), 'Enter');
    await rig.respond({ ok: false, error: 'send-failed' });
    expect((input() as HTMLTextAreaElement).value).toBe('Buy oat milk');
    expect(screen.getByText('Not sent')).toBeTruthy();
  });

  it('posts nothing more on a second Enter before the answer', async () => {
    const rig = setup();
    type(input(), 'Buy oat milk');
    press(input(), 'Enter');
    press(input(), 'Enter');
    expect(rig.actions()).toHaveLength(1);
    await rig.respond({ ok: true });
    expect(rig.actions()).toHaveLength(1);
  });

  it('posts nothing for white space alone, nor for a new line', () => {
    const rig = setup();
    type(input(), '  \n ');
    press(input(), 'Enter');
    type(input(), 'Two');
    press(input(), 'Enter', { shiftKey: true });
    expect(rig.actions()).toEqual([]);
  });

  it('sends and opens on mod+Enter, then shows the main window and hides', async () => {
    const rig = setup();
    type(input(), 'Look into this');
    press(input(), 'Enter', { ctrlKey: true });
    expect(rig.actions()).toEqual([
      { kind: 'send', roomId: '!inbox', text: 'Look into this', images: [], open: true },
    ]);
    await rig.respond({ ok: true, threadId: '$new' });
    await waitFor(() => expect(hideQuickCapture).toHaveBeenCalledTimes(1));
    expect(showMainWindow).toHaveBeenCalledTimes(1);
    expect(vi.mocked(showMainWindow).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(hideQuickCapture).mock.invocationCallOrder[0] ?? 0
    );
  });
});

describe('QuickCapturePage attachments', () => {
  it('attaches pasted images, at most four, and sends them', async () => {
    const rig = setup();
    const [a, b] = [png('a.png'), png('b.png')];
    expect(paste([a, b])).toBe(false);
    expect(screen.getByRole('button', { name: 'Remove a.png' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove b.png' })).toBeTruthy();
    // A PDF is no image: the paste stays the browser's.
    expect(paste([new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' })])).toBe(true);
    expect(screen.queryByRole('button', { name: 'Remove doc.pdf' })).toBeNull();
    paste([png('c.png'), png('d.png')]);
    paste([png('e.png')]);
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Remove e.png' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove c.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove d.png' }));
    press(input(), 'Enter');
    expect(rig.actions()).toEqual([
      { kind: 'send', roomId: '!inbox', text: '', images: [a, b], open: false },
    ]);
    await rig.respond({ ok: true });
    expect(screen.queryAllByRole('button', { name: /^Remove / })).toEqual([]);
  });

  it('keeps the images when the send fails', async () => {
    const rig = setup();
    paste([png('a.png')]);
    type(input(), 'What is this?');
    press(input(), 'Enter');
    await rig.respond({ ok: false, error: 'upload-failed' });
    expect(screen.getByText('The image could not be uploaded')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove a.png' })).toBeTruthy();
  });

  it('attaches nothing pasted while an entry sends, and leaves it out of the send', async () => {
    const rig = setup();
    type(input(), 'First');
    press(input(), 'Enter');
    expect(paste([png('late.png')])).toBe(false);
    // Text pasted into the sending entry goes nowhere either.
    expect(fireEvent.paste(input(), { clipboardData: { files: [], types: ['text/plain'] } })).toBe(
      false
    );
    expect(screen.queryByRole('button', { name: 'Remove late.png' })).toBeNull();
    await rig.respond({ ok: true });
    expect(screen.queryAllByRole('button', { name: /^Remove / })).toEqual([]);
    expect(rig.actions()).toEqual([
      { kind: 'send', roomId: '!inbox', text: 'First', images: [], open: false },
    ]);
  });

  it('takes no screenshot while an entry sends', async () => {
    vi.mocked(isNativeQuickCaptureAvailable).mockReturnValue(true);
    vi.mocked(captureScreenshot).mockResolvedValue(png('Screen.png'));
    const rig = setup();
    type(input(), 'First');
    press(input(), 'Enter');
    press(input(), 'S', { ctrlKey: true, shiftKey: true });
    press(input(), 'A', { ctrlKey: true, shiftKey: true });
    const screenButton = screen.getByRole('button', { name: 'Screenshot of the whole screen' });
    expect((screenButton as HTMLButtonElement).disabled).toBe(true);
    await act(async () => undefined);
    expect(captureScreenshot).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('button', { name: /^Remove / })).toEqual([]);
    await rig.respond({ ok: true });
    expect(screen.queryAllByRole('button', { name: /^Remove / })).toEqual([]);
    expect(rig.actions()).toHaveLength(1);
  });

  it('keeps a screenshot started before a send that comes in while it sends', async () => {
    vi.mocked(isNativeQuickCaptureAvailable).mockReturnValue(true);
    let finish: (file: File) => void = () => undefined;
    vi.mocked(captureScreenshot).mockReturnValue(
      new Promise<File>((resolve) => {
        finish = resolve;
      })
    );
    const rig = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Screenshot of the front window' }));
    type(input(), 'First');
    press(input(), 'Enter');
    await act(async () => finish(png('Late.png')));
    await rig.respond({ ok: true });
    expect(rig.actions()).toEqual([
      { kind: 'send', roomId: '!inbox', text: 'First', images: [], open: false },
    ]);
    expect(screen.getByRole('button', { name: 'Remove Late.png' })).toBeTruthy();
  });

  it('offers no screenshot buttons without the native plugin', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Screenshot of the front window' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Screenshot of the whole screen' })).toBeNull();
  });

  it('attaches a screenshot of the window or the screen with the native plugin', async () => {
    vi.mocked(isNativeQuickCaptureAvailable).mockReturnValue(true);
    vi.mocked(captureScreenshot).mockResolvedValueOnce(png('Window.png'));
    vi.mocked(captureScreenshot).mockResolvedValueOnce(png('Screen.png'));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Screenshot of the front window' }));
    expect(await screen.findByRole('button', { name: 'Remove Window.png' })).toBeTruthy();
    expect(captureScreenshot).toHaveBeenLastCalledWith('window');
    press(input(), 'S', { ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole('button', { name: 'Remove Screen.png' })).toBeTruthy();
    expect(captureScreenshot).toHaveBeenLastCalledWith('screen');
  });

  it('asks for the Screen Recording permission when it is refused', async () => {
    vi.mocked(isNativeQuickCaptureAvailable).mockReturnValue(true);
    vi.mocked(captureScreenshot).mockRejectedValue(new ScreenshotError('PERMISSION_DENIED'));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Screenshot of the whole screen' }));
    expect(
      await screen.findByText('MindRoom needs the Screen Recording permission to take screenshots')
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open System Settings' }));
    expect(openScreenRecordingSettings).toHaveBeenCalledTimes(1);
  });

  it('says when the app in front has no window', async () => {
    vi.mocked(isNativeQuickCaptureAvailable).mockReturnValue(true);
    vi.mocked(captureScreenshot).mockRejectedValue(new ScreenshotError('NO_WINDOW'));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Screenshot of the front window' }));
    expect(await screen.findByText('The app in front has no window')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open System Settings' })).toBeNull();
  });
});

describe('QuickCapturePage list', () => {
  it('selects the first row on ArrowDown and peeks at its reply on Space', () => {
    setup();
    press(input(), 'ArrowDown');
    expect(document.activeElement).toBe(row('Why does slot 27 flake'));
    press(row('Why does slot 27 flake'), ' ');
    expect(screen.getByText('Running the suite again, with traces on.')).toBeTruthy();
    const first = within(item('Why does slot 27 flake'));
    // The answer in full stands in for the line that cut it short.
    expect(first.queryByText('Code: Running the suite again')).toBeNull();
    // A button's key is in its tooltip.
    expect(first.getByRole('button', { name: 'Copy' }).title).toBe('Copy (C)');
    expect(first.getByRole('button', { name: 'Open' })).toBeTruthy();
    // The peek's Done beside the row's leading mark.
    expect(first.getAllByRole('button', { name: 'Done' })).toHaveLength(2);
    press(row('Why does slot 27 flake'), ' ');
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(first.getByText('Code: Running the suite again')).toBeTruthy();
  });

  it('resolves the row on x, and reopens a resolved row', () => {
    const rig = setup();
    press(input(), 'ArrowDown');
    press(row('Why does slot 27 flake'), 'x');
    for (let step = 0; step < 4; step += 1) press(document.activeElement as Element, 'j');
    expect(document.activeElement).toBe(row('Which Node version'));
    press(row('Which Node version'), 'x');
    expect(rig.actions()).toEqual([
      { kind: 'resolve', roomId: '!inbox', threadId: '$one', resolved: true },
      { kind: 'resolve', roomId: '!inbox', threadId: '$done', resolved: false },
    ]);
  });

  it('moves on to the next row once a thread is resolved, where the next state keeps it', async () => {
    const rig = setup();
    press(input(), 'ArrowDown');
    press(row('Why does slot 27 flake'), 'x');
    await rig.respond({ ok: true });
    expect(document.activeElement).toBe(row('Idea: default room'));
    const [one, ...rest] = ITEMS as [CaptureItem, ...CaptureItem[]];
    rig.pushState(roomState([...rest, { ...one, resolved: true }]));
    expect(document.activeElement).toBe(row('Idea: default room'));
  });

  it('shows a failed resolve in its row', async () => {
    const rig = setup();
    press(input(), 'ArrowDown');
    press(row('Why does slot 27 flake'), 'x');
    await rig.respond({ ok: false, error: 'forbidden' });
    const first = screen.getAllByRole('listitem')[0];
    expect(first?.textContent).toContain('You cannot resolve threads in this room');
  });

  it('opens the thread on Enter, then shows the main window and hides', async () => {
    const rig = setup();
    press(input(), 'ArrowDown');
    press(row('Why does slot 27 flake'), 'Enter');
    expect(rig.actions()).toEqual([{ kind: 'open', roomId: '!inbox', threadId: '$one' }]);
    await rig.respond({ ok: true });
    await waitFor(() => expect(hideQuickCapture).toHaveBeenCalledTimes(1));
    expect(showMainWindow).toHaveBeenCalledTimes(1);
  });

  it('replies in the thread from the field r focuses', async () => {
    const rig = setup();
    press(input(), 'ArrowDown');
    press(row('Why does slot 27 flake'), 'r');
    const field = screen.getByRole('textbox', { name: 'Reply in this thread' });
    expect(document.activeElement).toBe(field);
    type(field, 'Thanks');
    press(field, 'Enter');
    expect(rig.actions()).toEqual([
      { kind: 'reply', roomId: '!inbox', threadId: '$one', text: 'Thanks' },
    ]);
    await rig.respond({ ok: true });
    expect((field as HTMLInputElement).value).toBe('');
  });

  it('copies the reply on c', async () => {
    setup();
    press(input(), 'ArrowDown');
    press(row('Why does slot 27 flake'), ' ');
    press(row('Why does slot 27 flake'), 'c');
    expect(copyToClipboard).toHaveBeenCalledWith('Running the suite again, with traces on.');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('does nothing on x, r and Enter for an entry still being sent', () => {
    const rig = setup(
      roomState([{ threadId: '~pending', title: 'On its way', line: '', resolved: false, ts: 1 }])
    );
    press(input(), 'ArrowDown');
    press(row('On its way'), 'x');
    press(row('On its way'), 'r');
    press(row('On its way'), 'Enter');
    expect(rig.actions()).toEqual([]);
    expect(screen.queryByRole('textbox', { name: 'Reply in this thread' })).toBeNull();
  });

  it('returns to the input on ArrowUp from the first row, and with a typed character', () => {
    setup();
    press(input(), 'ArrowDown');
    press(row('Why does slot 27 flake'), 'ArrowUp');
    expect(document.activeElement).toBe(input());
    press(input(), 'ArrowDown');
    press(row('Why does slot 27 flake'), 'B');
    expect(document.activeElement).toBe(input());
    expect((input() as HTMLTextAreaElement).value).toBe('B');
  });

  it('keeps a character typed in the list out of an entry that sends', async () => {
    const rig = setup();
    type(input(), 'Buy');
    press(input(), 'Enter');
    press(input(), 'ArrowDown');
    press(row('Why does slot 27 flake'), 'B');
    expect(document.activeElement).toBe(input());
    expect((input() as HTMLTextAreaElement).value).toBe('Buy');
    await rig.respond({ ok: false, error: 'send-failed' });
    expect((input() as HTMLTextAreaElement).value).toBe('Buy');
  });

  it('scrolls the peek into view as it opens and as it moves, not on a new state', () => {
    const rig = setup();
    press(input(), 'ArrowDown');
    for (let step = 0; step < 3; step += 1) press(document.activeElement as Element, 'j');
    expect(document.activeElement).toBe(row('Cheapest speech-to-text'));
    scrollIntoView.mockClear();
    press(row('Cheapest speech-to-text'), ' ');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(item('Cheapest speech-to-text'));
    press(row('Cheapest speech-to-text'), 'j');
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(item('Which Node version'));
    rig.pushState(roomState());
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('reads a new answer once each time its peek opens, and says nothing when that fails', async () => {
    const rig = setup();
    press(input(), 'ArrowDown');
    for (let step = 0; step < 3; step += 1) press(document.activeElement as Element, 'j');
    const read: CaptureAction = { kind: 'read', roomId: '!inbox', threadId: '$news' };
    press(row('Cheapest speech-to-text'), ' ');
    expect(rig.actions()).toEqual([read]);
    await rig.respond({ ok: false, error: 'timeout' });
    expect(within(item('Cheapest speech-to-text')).queryByRole('alert')).toBeNull();
    // The answer is still new in the next state, which reads nothing more.
    rig.pushState(roomState());
    expect(rig.actions()).toEqual([read]);
    press(row('Cheapest speech-to-text'), ' ');
    press(row('Cheapest speech-to-text'), ' ');
    expect(rig.actions()).toEqual([read, read]);
  });

  it('reads nothing for a row without a new answer, nor for an entry still being sent', () => {
    const rig = setup(
      roomState([
        ...ITEMS,
        {
          threadId: '~pending',
          title: 'On its way',
          line: '',
          chip: 'new',
          resolved: false,
          ts: 1,
        },
      ])
    );
    press(input(), 'ArrowDown');
    press(row('Why does slot 27 flake'), ' ');
    expect(row('Why does slot 27 flake').getAttribute('aria-expanded')).toBe('true');
    expect(rig.actions()).toEqual([]);
    // The open peek moves to the row that takes the focus.
    act(() => row('On its way').focus());
    expect(row('On its way').getAttribute('aria-expanded')).toBe('true');
    expect(rig.actions()).toEqual([]);
  });

  it('keeps the selected thread selected when a new state moves it', () => {
    const rig = setup();
    press(input(), 'ArrowDown');
    press(row('Why does slot 27 flake'), 'j');
    expect(document.activeElement).toBe(row('Idea: default room'));
    const [one, two, ...rest] = ITEMS as [CaptureItem, CaptureItem, ...CaptureItem[]];
    rig.pushState(roomState([{ ...two, ts: ago(0) }, one, ...rest]));
    expect(screen.getAllByRole('listitem')[0]?.textContent).toContain('Idea: default room');
    expect(document.activeElement).toBe(row('Idea: default room'));
    press(row('Idea: default room'), 'x');
    expect(rig.actions()).toEqual([
      { kind: 'resolve', roomId: '!inbox', threadId: '$two', resolved: true },
    ]);
  });
});

describe('QuickCapturePage Escape and focus', () => {
  it('closes the peek, then hides the widget', () => {
    setup();
    press(input(), 'ArrowDown');
    press(row('Why does slot 27 flake'), ' ');
    press(row('Why does slot 27 flake'), 'Escape');
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(hideQuickCapture).not.toHaveBeenCalled();
    press(row('Why does slot 27 flake'), 'Escape');
    expect(hideQuickCapture).toHaveBeenCalledTimes(1);
  });

  it('closes the picker before anything else', () => {
    setup();
    press(input(), 'Tab');
    press(screen.getByLabelText('Search rooms'), 'Escape');
    expect(screen.queryByLabelText('Search rooms')).toBeNull();
    expect(hideQuickCapture).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input());
    press(input(), 'Escape');
    expect(hideQuickCapture).toHaveBeenCalledTimes(1);
  });

  it('focuses the input when the window gets the focus', () => {
    setup();
    press(input(), 'ArrowDown');
    expect(document.activeElement).not.toBe(input());
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(document.activeElement).toBe(input());
  });
});
