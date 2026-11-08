// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  conversationBehindPanelAtom,
  conversationCoveredAtom,
} from '../navigation/conversationCover';
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

describe('the composer actions menu', () => {
  it.each([
    ["a plugin's cover", conversationCoveredAtom],
    ['a side panel in its place', conversationBehindPanelAtom],
  ])('closes as %s hides the conversation', (_what, atom) => {
    const noop = () => undefined;
    render(
      <ComposerActionsMenu
        formattingOpen={false}
        onAttach={noop}
        onToggleFormatting={noop}
        onEmoji={noop}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menu')).not.toBeNull();

    act(() => store.set(atom, true));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
