// @vitest-environment jsdom
import type { ReactNode } from 'react';
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
      </div>
    ),
    ...extra,
  });
  return { open, listeners, set, cover, reportBoundaryError: vi.fn() };
});

vi.mock('../bug-reports/error-reporting/errorReporting', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reportBoundaryError: mocks.reportBoundaryError,
}));

// Plugins as a build lists them: one whose cover throws once open, one whose condition and
// subscription throw, one with a cover Escape closes, and one with a cover Escape leaves.
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
            subscribe: () => {
              throw new Error('no listening');
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
    { id: 'other', version: '2.0.0', plugin: { conversationCovers: [mocks.cover('fixed')] } },
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
    <Slate editor={editor} initialValue={[{ type: 'paragraph', children: [{ text: '' }] }]}>
      <Editable aria-label="Message" />
    </Slate>
  ),
}));

afterEach(() => {
  cleanup();
  act(() => {
    ['broken', 'closable', 'fixed'].forEach((name) => mocks.set(name, false));
  });
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
    renderRoom();
    expect(layer()).toBeNull();
    expect(conversation().inert).toBeFalsy();
    expect(covered()).toBe(false);
    // The condition that throws covers nothing, and the room still renders.
    expect(screen.queryByText('never shown')).toBeNull();
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
    fireEvent.keyDown(layer()!, { key: 'Escape' });
    expect(layer()?.textContent).toContain('fixed cover');
    show('fixed', false);

    show('closable');
    // Escape that something in the cover handled stays there.
    const field = screen.getByRole('textbox', { name: 'closable field' });
    field.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(layer()?.textContent).toContain('closable cover');

    fireEvent.keyDown(field, { key: 'Escape' });
    expect(layer()).toBeNull();
    expect(covered()).toBe(false);
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
