// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  conversationBehindPanelAtom,
  conversationCoveredAtom,
} from '../navigation/conversationCover';
import { ConversationViewContext } from '../navigation/conversationView';
import { ComposerActionsMenu } from './ComposerActionsMenu';

// jsdom lays nothing out, so the trap would find no control to hold.
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

const store = getDefaultStore();

afterEach(() => {
  cleanup();
  store.set(conversationCoveredAtom, false);
  store.set(conversationBehindPanelAtom, false);
});

/** Opens the menu, in the room page's composer unless `view` names another conversation view. */
const openMenu = (view?: string) => {
  const noop = () => undefined;
  render(
    <ConversationViewContext.Provider value={view}>
      <ComposerActionsMenu
        formattingOpen={false}
        onAttach={noop}
        onToggleFormatting={noop}
        onEmoji={noop}
      />
    </ConversationViewContext.Provider>
  );
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
};

describe('the composer actions menu', () => {
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
    openMenu('thread-view');
    act(() => store.set(conversationBehindPanelAtom, true));
    expect(screen.queryByRole('menu')).not.toBeNull();
  });
});
