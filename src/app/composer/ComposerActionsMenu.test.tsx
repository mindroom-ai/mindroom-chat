// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  conversationBehindPanelAtom,
  conversationCoveredAtom,
} from '../navigation/conversationCover';
import {
  ConversationViewContext,
  shownConversationViewsAtom,
} from '../navigation/conversationView';
import { DEBUG_MODE_KEY } from '../diagnostics/debugMode';
import { ComposerActionsMenu } from './ComposerActionsMenu';

// jsdom lays nothing out, so the trap would find no control to hold.
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

const store = getDefaultStore();

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(DEBUG_MODE_KEY);
  store.set(conversationCoveredAtom, false);
  store.set(conversationBehindPanelAtom, false);
  store.set(shownConversationViewsAtom, []);
});

/** Opens the menu, in the room page's composer unless `view` names another conversation view. */
const openMenu = (view?: string, onAttachAppLogs: () => void = () => undefined) => {
  const noop = () => undefined;
  render(
    <ConversationViewContext.Provider value={view}>
      <ComposerActionsMenu
        formattingOpen={false}
        onAttach={noop}
        onAttachAppLogs={onAttachAppLogs}
        onToggleFormatting={noop}
        onEmoji={noop}
      />
    </ConversationViewContext.Provider>
  );
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
};

const entryNames = () =>
  Array.from(screen.getByRole('menu').querySelectorAll('[role^="menuitem"]'), (entry) =>
    entry.textContent?.trim()
  );

describe('the composer actions menu', () => {
  it('offers no app logs while debug mode is off', () => {
    openMenu();
    expect(entryNames()).toEqual(['Attach files', 'Formatting', 'Emoji']);
  });

  it('offers Attach app logs while debug mode is on, and runs it as the menu closes', () => {
    window.localStorage.setItem(DEBUG_MODE_KEY, '1');
    const onAttachAppLogs = vi.fn();
    openMenu(undefined, onAttachAppLogs);
    expect(entryNames()).toEqual(['Attach files', 'Attach app logs', 'Formatting', 'Emoji']);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Attach app logs' }));

    expect(onAttachAppLogs).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it.each([
    ["a plugin's cover", conversationCoveredAtom],
    ['a side panel in its place', conversationBehindPanelAtom],
  ])('closes as %s hides the conversation', (_what, atom) => {
    openMenu();
    expect(screen.queryByRole('menu')).not.toBeNull();

    act(() => store.set(atom, true));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it("stays open in another conversation view as a side panel hides the room's page", () => {
    store.set(shownConversationViewsAtom, [{ view: 'thread-view', roomId: '!room:example.org' }]);
    openMenu('thread-view');
    act(() => store.set(conversationBehindPanelAtom, true));
    expect(screen.queryByRole('menu')).not.toBeNull();
    // It closes as its side panel folds.
    act(() => store.set(shownConversationViewsAtom, []));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
