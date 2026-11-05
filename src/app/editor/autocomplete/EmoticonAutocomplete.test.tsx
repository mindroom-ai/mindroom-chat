import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createEditor, type Descendant, Editor, Transforms } from 'slate';
import type { Room } from 'matrix-js-sdk';
import { ImagePack } from '../../emoji/custom';
import { loadEmojiData } from '../../emoji/emojiData';
import { toPlainText } from '../output';
import { getPrevWorldRange, withInlineElements } from '../utils';
import { AUTOCOMPLETE_PREFIXES, getAutocompleteQuery } from './autocompleteQuery';
import { EmoticonAutocomplete } from './EmoticonAutocomplete';
import { defined } from '../../../test/utils/defined';

// A loaded machine can take seconds to load a lazy module's code.
const LOAD_WAIT = { timeout: 60_000, interval: 20 };
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const state = vi.hoisted(() => ({ packs: [] as unknown[], addRecentEmoji: vi.fn() }));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../../emoji/useImagePacks', () => ({ useRelevantImagePacks: () => state.packs }));
vi.mock('../../emoji/recent-emoji-list', () => ({ addRecentEmoji: state.addRecentEmoji }));
vi.mock('../../matrix/matrix', () => ({ mxcUrlToHttp: (_mx: unknown, mxc: string) => mxc }));
vi.mock('./AutocompleteMenu', () => ({
  AutocompleteMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../ui/glass/GlassPrimitives', () => ({
  MenuItem: ({
    children,
    after,
    onClick,
  }: {
    children: React.ReactNode;
    after?: React.ReactNode;
    onClick: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
      {after}
    </button>
  ),
}));

const originalWindow = globalThis.window;
let renderer: ReactTestRenderer | undefined;

// The emoji data loads on the first query; the last test covers the render before it arrives.
beforeAll(async () => {
  await loadEmojiData();
});

beforeEach(() => {
  state.packs = [];
  state.addRecentEmoji.mockResolvedValue(undefined);
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { addEventListener: () => undefined, removeEventListener: () => undefined },
  });
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.clearAllMocks();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
});

/** An editor holding `text` with the caret at its end, and the `:` query there. */
const editorWith = (text: string) => {
  const editor = withInlineElements(createEditor());
  editor.children = [{ type: 'paragraph', children: [{ text }] }] as Descendant[];
  Transforms.select(editor, Editor.end(editor, []));
  const range = getPrevWorldRange(editor);
  const query = range && getAutocompleteQuery(editor, range, AUTOCOMPLETE_PREFIXES);
  if (!query) throw new Error(`no query in ${text}`);
  return { editor, query };
};

const render = (text: string, Autocomplete = EmoticonAutocomplete) => {
  const { editor, query } = editorWith(text);
  const requestClose = vi.fn();
  const onSuggestionsChange = vi.fn();
  act(() => {
    renderer = create(
      <Autocomplete
        packRooms={[] as Room[]}
        editor={editor}
        query={query}
        requestClose={requestClose}
        onSuggestionsChange={onSuggestionsChange}
      />
    );
  });
  return { editor, requestClose, onSuggestionsChange };
};

const rows = () => renderer!.root.findAllByType('button');

it('replaces the typed shortcode with the picked emoji and a space', () => {
  const { editor, requestClose } = render('hi :wave');

  act(() => {
    defined(rows()[0], 'a suggestion row').props.onClick();
  });

  expect(toPlainText(editor.children, false)).toBe('hi 👋 ');
  expect(state.addRecentEmoji).toHaveBeenCalledWith({}, '👋');
  expect(requestClose).toHaveBeenCalled();
});

it('inserts a custom emoji as an emoticon that sends as an image', () => {
  state.packs = [
    new ImagePack(
      'p',
      { pack: { display_name: 'Birds' }, images: { parrot: { url: 'mxc://x/p' } } },
      {
        roomId: '!r:x',
        stateKey: '',
      }
    ),
  ];
  const { editor } = render(':parr');

  expect(renderer!.root.findByProps({ children: 'Birds' })).toBeTruthy();
  act(() => {
    defined(rows()[0], 'a suggestion row').props.onClick();
  });

  expect(toPlainText(editor.children, false)).toBe(':parrot: ');
  expect(state.addRecentEmoji).toHaveBeenCalledWith({}, 'mxc://x/p');
});

it('shows nothing for a colon in ordinary text', () => {
  const { onSuggestionsChange } = render('nice :D');

  expect(rows()).toHaveLength(0);
  expect(onSuggestionsChange).toHaveBeenLastCalledWith(false);
});

it('reports that it shows suggestions', () => {
  const { onSuggestionsChange } = render(':smi');

  expect(rows().length).toBeGreaterThan(0);
  expect(onSuggestionsChange).toHaveBeenLastCalledWith(true);
});

it('adds the Unicode emoji once the emoji data, which the first query asks for, has loaded', async () => {
  vi.resetModules();
  const fresh = await import('./EmoticonAutocomplete');
  const freshData = await import('../../emoji/emojiData');
  expect(freshData.getEmojiData()).toBeUndefined();
  const { onSuggestionsChange } = render(':wave', fresh.EmoticonAutocomplete);
  expect(rows()).toHaveLength(0);

  await act(async () => {
    await vi.waitFor(() => expect(freshData.getEmojiData()).toBeDefined(), LOAD_WAIT);
  });

  expect(renderer!.root.findByProps({ children: ':wave:' })).toBeTruthy();
  expect(onSuggestionsChange).toHaveBeenLastCalledWith(true);
});
