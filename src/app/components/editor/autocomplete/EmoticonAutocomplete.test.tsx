import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEditor, type Descendant, Editor, Transforms } from 'slate';
import type { Room } from 'matrix-js-sdk';
import { ImagePack } from '../../../plugins/custom-emoji';
import { toPlainText } from '../output';
import { getPrevWorldRange, withInlineElements } from '../utils';
import { AUTOCOMPLETE_PREFIXES, getAutocompleteQuery } from './autocompleteQuery';
import { EmoticonAutocomplete } from './EmoticonAutocomplete';

const state = vi.hoisted(() => ({ packs: [] as unknown[], addRecentEmoji: vi.fn() }));

vi.mock('../../../hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../../../hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../../../hooks/useImagePacks', () => ({ useRelevantImagePacks: () => state.packs }));
vi.mock('../../../plugins/recent-emoji', () => ({ addRecentEmoji: state.addRecentEmoji }));
vi.mock('../../../utils/matrix', () => ({ mxcUrlToHttp: (_mx: unknown, mxc: string) => mxc }));
vi.mock('./AutocompleteMenu', () => ({
  AutocompleteMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../glass/GlassPrimitives', () => ({
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

const render = (text: string) => {
  const { editor, query } = editorWith(text);
  const requestClose = vi.fn();
  const onSuggestionsChange = vi.fn();
  act(() => {
    renderer = create(
      <EmoticonAutocomplete
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

  act(() => rows()[0].props.onClick());

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
  act(() => rows()[0].props.onClick());

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
