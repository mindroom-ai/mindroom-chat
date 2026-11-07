// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { createClient, Room } from 'matrix-js-sdk';
import type { Editor } from 'slate';
import { Editable, Slate } from 'slate-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../config/useClientConfig';
import { conversationCoveredAtom } from '../navigation/conversationCover';
import { runShortcut } from '../shortcuts/useShortcut';
import { RoomView } from './RoomView';

const mx = createClient({ baseUrl: 'https://matrix.example.org', userId: '@alice:example.org' });
const room = new Room('!room:example.org', mx, '@alice:example.org');

const mocks = vi.hoisted(() => {
  // Which covers are open, by name, and who listens; `set` opens or closes them.
  const open = new Set<string>();
  const listeners = new Set<() => void>();
  const set = (name: string, shown: boolean) => {
    if (shown) open.add(name);
    else open.delete(name);
    listeners.forEach((listener) => listener());
  };
  const cover = (name: string, extra: object = {}) => ({
    covers: () => open.has(name),
    subscribe: (_room: unknown, onChange: () => void) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    Component: () => (
      <div>
        <p>{`${name} cover`}</p>
        <input aria-label={`${name} field`} />
        <button type="button">{`${name} button`}</button>
      </div>
    ),
    ...extra,
  });
  return { open, set, cover, reportBoundaryError: vi.fn() };
});

vi.mock('../bug-reports/error-reporting/errorReporting', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reportBoundaryError: mocks.reportBoundaryError,
}));

// Plugins as a build lists them: `broken`, with a cover that throws once open, one whose condition
// throws, one whose subscription throws, one whose subscription's stop throws and one whose
// condition throws later; `example`, with a cover Escape closes; `other`, with a cover
// Escape leaves, one that puts the focus in its own field and one with a portaled popover; and
// `faulty`, whose close throws.
vi.mock('../plugins/pluginEntries', () => ({
  pluginEntries: [
    {
      id: 'broken',
      version: '0.1.0',
      plugin: {
        conversationCovers: [
          mocks.cover('broken', {
            Component: () => {
              throw new Error('boom');
            },
          }),
          {
            covers: () => {
              throw new Error('no answer');
            },
            subscribe: () => () => undefined,
            Component: () => 'never shown',
          },
          {
            covers: () => false,
            subscribe: () => {
              throw new Error('no listening');
            },
            Component: () => 'never shown',
          },
          // Its condition throws once its plugin changes something, without a new render.
          mocks.cover('flaky', {
            covers: () => {
              if (mocks.open.has('flaky')) throw new Error('flaky');
              return false;
            },
          }),
          {
            covers: () => false,
            subscribe: () => () => {
              throw new Error('no stop');
            },
            Component: () => 'never shown',
          },
        ],
      },
    },
    {
      id: 'example',
      version: '1.0.0',
      plugin: {
        conversationCovers: [
          mocks.cover('closable', { close: () => mocks.set('closable', false) }),
        ],
      },
    },
    {
      id: 'other',
      version: '2.0.0',
      plugin: {
        conversationCovers: [
          mocks.cover('fixed'),
          // A cover that puts the focus in its own field as it shows.
          mocks.cover('autofocus', {
            Component: () => <input aria-label="autofocus field" autoFocus />,
          }),
          // A cover without controls of its own, whose popover is portaled into the page's body.
          mocks.cover('portal', {
            Component: () => createPortal(<input aria-label="popover field" />, document.body),
            close: () => mocks.set('portal', false),
          }),
        ],
      },
    },
    {
      id: 'faulty',
      version: '3.0.0',
      plugin: {
        conversationCovers: [
          mocks.cover('faulty', {
            close: () => {
              throw new Error('no close');
            },
          }),
        ],
      },
    },
  ],
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../matrix/hooks/usePowerLevels', () => ({ usePowerLevelsContext: () => ({}) }));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ event: () => true }),
}));
vi.mock('../matrix/hooks/useStateEvent', () => ({ useStateEvent: () => undefined }));
vi.mock('../event-store/engine/engineContext', () => ({
  useSyncEngine: () => ({ noteRoomFocused: () => undefined, clearRoomFocus: () => undefined }),
}));
vi.mock('./useRoomViewThreadState', () => ({
  useRoomViewThreadState: () => ({ viewMode: 'compact' }),
}));
vi.mock('./RoomViewHeader', () => ({
  RoomViewHeader: () => <button type="button">Header</button>,
}));
vi.mock('./RoomHeaderSlot', () => ({ RoomHeaderSlot: () => null }));
vi.mock('../timeline/RoomTimeline', () => ({
  RoomTimeline: () => <button type="button">A message</button>,
}));
vi.mock('../timeline/typing/RoomViewTyping', () => ({ RoomViewTyping: () => null }));
vi.mock('../timeline/RoomViewFollowing', () => ({ RoomViewFollowing: () => null }));
vi.mock('../background-jobs/BackgroundJobsBar', () => ({ BackgroundJobsBar: () => null }));
vi.mock('../approvals/ThreadApprovalProvider', () => ({
  ThreadApprovalProvider: ({ children }: { children: ReactNode }) => children,
}));
// The composer is its Slate text box.
vi.mock('../composer/RoomInput', () => ({
  RoomInput: ({ editor }: { editor: Editor }) => (
    <Slate editor={editor} initialValue={[{ type: 'paragraph', children: [{ text: 'draft' }] }]}>
      <Editable aria-label="Message" />
    </Slate>
  ),
}));

afterEach(() => {
  // Unmounting stops every subscription, so closing the covers needs only the set emptied.
  cleanup();
  mocks.open.clear();
  mocks.reportBoundaryError.mockReset();
  vi.restoreAllMocks();
});

const renderRoom = (config: ClientConfig = {}) =>
  render(
    <ClientConfigProvider value={config}>
      <RoomView room={room} />
    </ClientConfigProvider>
  );

const show = (name: string, shown = true) => act(() => mocks.set(name, shown));
const layer = () => document.querySelector<HTMLElement>('[data-conversation-cover]');
const composer = () => screen.getByRole('textbox', { name: 'Message', hidden: true });
/** The part of the room the cover hides: the timeline, the dock and the composer. */
const conversation = () => composer().closest<HTMLElement>('[style*="contents"]')!;
const covered = () => getDefaultStore().get(conversationCoveredAtom);

describe('a conversation cover', () => {
  it('shows nothing while no condition holds, and leaves the conversation as it is', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = renderRoom();
    expect(layer()).toBeNull();
    expect(conversation().inert).toBeFalsy();
    expect(covered()).toBe(false);
    // The covers whose condition, subscription or its stop throws cover nothing, and each is
    // reported once.
    expect(screen.queryByText('never shown')).toBeNull();
    const reported = () =>
      mocks.reportBoundaryError.mock.calls.map(([error]) => (error as Error).message).sort();
    expect(reported()).toEqual([
      '[plugin broken@0.1.0] no answer',
      '[plugin broken@0.1.0] no listening',
    ]);
    // A condition that throws when its plugin says something changed is reported at once.
    show('flaky');
    expect(reported()).toEqual([
      '[plugin broken@0.1.0] flaky',
      '[plugin broken@0.1.0] no answer',
      '[plugin broken@0.1.0] no listening',
    ]);
    unmount();
    expect(reported()).toEqual([
      '[plugin broken@0.1.0] flaky',
      '[plugin broken@0.1.0] no answer',
      '[plugin broken@0.1.0] no listening',
      '[plugin broken@0.1.0] no stop',
    ]);
  });

  it('keeps Tab and Shift+Tab inside the cover', () => {
    // jsdom lays nothing out; the cover counts only controls that take up room.
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as never);
    renderRoom();
    show('fixed');
    const field = screen.getByRole('textbox', { name: 'fixed field' });
    const button = screen.getByRole('button', { name: 'fixed button' });
    // From the cover itself, or its first control, Shift+Tab goes round to its last control.
    expect(fireEvent.keyDown(layer()!, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(button);
    field.focus();
    expect(fireEvent.keyDown(field, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(button);
    // From its last control, Tab goes round to its first.
    expect(fireEvent.keyDown(button, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(field);
    // Between them, the browser moves the focus.
    expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(true);
    // A control Tab skips does not count: the field is then the last as well as the first.
    button.tabIndex = -1;
    expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(field);
    button.tabIndex = 0;
  });

  it("leaves Tab and Escape in a popover the cover's component portals elsewhere to the popover", () => {
    renderRoom();
    show('portal');
    const popoverField = screen.getByRole('textbox', { name: 'popover field' });
    popoverField.focus();
    expect(fireEvent.keyDown(popoverField, { key: 'Tab' })).toBe(true);
    expect(document.activeElement).toBe(popoverField);
    // Escape there is the popover's too: the cover stays.
    expect(fireEvent.keyDown(popoverField, { key: 'Escape' })).toBe(true);
    expect(layer()).not.toBeNull();
  });

  it('brings the focus back when Tab takes it out of the cover all the same', async () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as never);
    renderRoom();
    show('fixed');
    const field = screen.getByRole('textbox', { name: 'fixed field' });
    const button = screen.getByRole('button', { name: 'fixed button' });
    const header = screen.getByRole('button', { name: 'Header' });
    // A browser that skips the button (Safari's default) takes Tab from the field out of the cover:
    // the focus comes round to the cover's first control.
    const nextTask = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    field.focus();
    expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(true);
    header.focus();
    await nextTask();
    expect(document.activeElement).toBe(field);
    // Backwards, to its last.
    button.focus();
    fireEvent.keyDown(button, { key: 'Tab', shiftKey: true });
    header.focus();
    await nextTask();
    expect(document.activeElement).toBe(button);
    // Tab between the cover's own controls leaves the focus where the browser put it.
    field.focus();
    fireEvent.keyDown(field, { key: 'Tab' });
    button.focus();
    await nextTask();
    expect(document.activeElement).toBe(button);
    // A click elsewhere is no Tab: the focus goes there.
    header.focus();
    await nextTask();
    expect(document.activeElement).toBe(header);
  });

  it("takes away a cover whose close throws on Escape, and reports it under its plugin's tag", () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderRoom();
    show('faulty');
    fireEvent.keyDown(layer()!, { key: 'Escape' });
    expect(layer()).toBeNull();
    expect(covered()).toBe(false);
    expect(mocks.reportBoundaryError).toHaveBeenCalledWith(
      expect.objectContaining({ message: '[plugin faulty@3.0.0] no close' }),
      undefined
    );
  });

  it('covers the conversation while its condition holds, out of reach, and moves the focus in and back', () => {
    renderRoom();
    composer().focus();

    show('fixed');
    expect(layer()?.textContent).toContain('fixed cover');
    expect(conversation().inert).toBe(true);
    expect(conversation().getAttribute('aria-hidden')).toBe('true');
    expect(covered()).toBe(true);
    expect(layer()!.contains(document.activeElement)).toBe(true);
    // The header stays in reach above it.
    expect(screen.getByRole('button', { name: 'Header' }).closest('[inert]')).toBeNull();

    // A letter typed, or Escape, in the cover leaves the composer alone.
    fireEvent.keyDown(document.activeElement!, { key: 'a', code: 'KeyA' });
    expect(runShortcut('focusComposer', new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(
      false
    );
    expect(layer()!.contains(document.activeElement)).toBe(true);

    show('fixed', false);
    expect(layer()).toBeNull();
    expect(conversation().inert).toBe(false);
    expect(conversation().hasAttribute('aria-hidden')).toBe(false);
    expect(covered()).toBe(false);
    expect(document.activeElement).toBe(composer());
  });

  it('gives the composer back its caret with the focus', () => {
    renderRoom();
    composer().focus();
    const text = screen.getByText('draft').firstChild!;
    document.getSelection()!.collapse(text, 3);
    show('fixed');
    // A click in the cover takes the page's selection there, as a browser does.
    document.getSelection()!.collapse(screen.getByText('fixed cover').firstChild, 2);
    show('fixed', false);
    expect(document.activeElement).toBe(composer());
    const caret = document.getSelection()!;
    expect([caret.anchorNode, caret.anchorOffset]).toEqual([text, 3]);
  });

  it("gives the focus back also when the cover's own field took it as it showed", () => {
    renderRoom();
    composer().focus();
    show('autofocus');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'autofocus field' }));
    show('autofocus', false);
    expect(document.activeElement).toBe(composer());
  });

  it('gives the focus back also after one cover took over from another', () => {
    renderRoom();
    composer().focus();
    show('fixed');
    // Earlier in build order, it takes the place of the shown one, and then gives it back.
    show('closable');
    show('closable', false);
    expect(layer()?.textContent).toContain('fixed cover');
    show('fixed', false);
    expect(document.activeElement).toBe(composer());
  });

  it('leaves the focus where the person moved it when the cover goes', () => {
    renderRoom();
    composer().focus();
    show('fixed');
    const header = screen.getByRole('button', { name: 'Header' });
    header.focus();
    show('fixed', false);
    expect(document.activeElement).toBe(header);
  });

  it('closes on Escape in the cover when its plugin allows it, and only then', () => {
    renderRoom();
    show('fixed');
    // Not taken from whatever else listens for it.
    expect(fireEvent.keyDown(layer()!, { key: 'Escape' })).toBe(true);
    expect(layer()?.textContent).toContain('fixed cover');
    show('fixed', false);

    show('closable');
    // Another key does not close it.
    const field = screen.getByRole('textbox', { name: 'closable field' });
    fireEvent.keyDown(field, { key: 'a' });
    expect(layer()?.textContent).toContain('closable cover');
    // Escape that ends an input method's composition belongs to it.
    fireEvent.keyDown(field, { key: 'Escape', isComposing: true });
    fireEvent.keyDown(field, { key: 'Escape', keyCode: 229 });
    expect(layer()?.textContent).toContain('closable cover');
    // Escape that something in the cover handled stays there.
    field.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(layer()?.textContent).toContain('closable cover');

    // The Escape that closes it reaches none of the window's Escape handlers (the room's Escape
    // read among them), which would act on the conversation the cover hid.
    const windowEscape = vi.fn();
    window.addEventListener('keydown', windowEscape);
    try {
      fireEvent.keyDown(field, { key: 'Escape' });
    } finally {
      window.removeEventListener('keydown', windowEscape);
    }
    expect(layer()).toBeNull();
    expect(covered()).toBe(false);
    expect(windowEscape).not.toHaveBeenCalled();
  });

  it('shows the first cover in build order whose condition holds, of the plugins config.json leaves on', () => {
    const { unmount } = renderRoom();
    show('fixed');
    show('closable');
    expect(layer()?.textContent).toContain('closable cover');
    unmount();

    renderRoom({ plugins: { example: { enabled: false } } } as unknown as ClientConfig);
    expect(layer()?.textContent).toContain('fixed cover');
  });

  it("takes away a cover that throws, reports it under its plugin's tag, and shows the next", () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderRoom();
    show('fixed');
    show('broken');
    expect(layer()?.textContent).toContain('fixed cover');
    expect(covered()).toBe(true);
    expect(mocks.reportBoundaryError).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Error', message: '[plugin broken@0.1.0] boom' }),
      expect.any(String)
    );

    show('fixed', false);
    expect(layer()).toBeNull();
    expect(covered()).toBe(false);
  });
});
