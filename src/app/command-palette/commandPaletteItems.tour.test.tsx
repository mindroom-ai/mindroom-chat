// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { createClient } from 'matrix-js-sdk';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { tourAtom } from '../navigation/tourState';
import { useCommandPaletteSource } from './commandPaletteItems';

const client = createClient({
  baseUrl: 'https://matrix.example.org',
  userId: '@alice:example.org',
});

// What the source reads from the server, the route and the screen; the tour actions use none of it.
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: vi.fn(),
    navigateSpace: vi.fn(),
    navigateRoomThread: vi.fn(),
  }),
}));
vi.mock('../threads/tags/useRoomThreadTags', () => ({
  useThreadResolution: () => ({ isResolved: false }),
  useToggleThreadResolution: () => ({ canToggle: false, setResolved: vi.fn() }),
}));
vi.mock('../theme/useTheme', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../theme/useTheme')>()),
  useTheme: () => ({ kind: 'light' }),
}));
vi.mock('./useCommandPaletteCommands', () => ({
  useCommandPaletteCommands: () => ({
    actions: [],
    commands: [],
    pages: {
      theme: { title: '', items: [] },
      'message-layout': { title: '', items: [] },
      language: { title: '', items: [] },
    },
  }),
}));
vi.mock('./useCommandPalettePeople', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useCommandPalettePeople')>()),
  useStartDirectChat: () => vi.fn(),
}));

/** The source's actions with no room open, and the store their handlers write to. */
const renderActions = () => {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        {children}
      </MemoryRouter>
    </Provider>
  );
  const { result } = renderHook(() => useCommandPaletteSource(), { wrapper });
  return { store, actions: result.current.actions };
};

describe('useCommandPaletteSource tour actions', () => {
  it.each([
    ['take-quick-tour', 'Take the quick tour', 'quick'],
    ['take-full-tour', 'Take the full tour', 'full'],
  ] as const)('lists %s as "%s", and choosing it opens the %s tour', (id, title, level) => {
    const { store, actions } = renderActions();
    const action = actions.find((item) => item.id === id);

    expect(action?.title).toBe(title);
    expect(store.get(tourAtom)).toBeUndefined();
    act(() => action?.onSelect?.());
    expect(store.get(tourAtom)).toEqual({ level });
  });
});
