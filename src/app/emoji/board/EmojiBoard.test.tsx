import React from 'react';
import type { Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { EmojiBoard } from './EmojiBoard';
import { ImagePack } from '../custom/ImagePack';

const recentEmoji = vi.hoisted(() => ({ addRecentEmoji: vi.fn() }));
const addForm = vi.hoisted(() => ({
  onAdd: undefined as ((mxc: string, sc: string) => void) | undefined,
  open: false,
}));
const mx = vi.hoisted(() => ({ getRoom: vi.fn() }));
// Stable like the real hooks' results, which the board memoizes on.
const none = vi.hoisted(() => []);
const boardPacks = vi.hoisted(() => ({ value: [] as unknown[] }));
const virtualizerSpy = vi.hoisted(() => ({ scrollToIndex: vi.fn() }));

vi.mock('focus-trap-react', () => ({
  FocusTrap: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./components/styles.css', () =>
  Object.fromEntries(
    ['AddCustomEmoji', 'AddCustomEmojiPreview', 'Base', 'CustomEmojiImg', 'EmojiGroup']
      .concat(['EmojiGroupContent', 'EmojiGroupLabel', 'EmojiItem', 'Header', 'Preview'])
      .concat(['PreviewEmoji', 'PreviewImg', 'Sidebar', 'SidebarBtnImg', 'SidebarContent'])
      .concat(['SidebarDivider', 'SidebarStack', 'StickerImg', 'StickerItem'])
      .map((name) => [name, name])
  )
);
vi.mock('../../ui/VirtualTile.css', () => ({ VirtualTile: 'VirtualTile' }));
vi.mock('./components/AddCustomEmoji', () => ({
  AddCustomEmoji: ({ onAdd }: { onAdd: (mxc: string, shortcode: string) => void }) => {
    addForm.onAdd = onAdd;
    React.useLayoutEffect(() => {
      addForm.open = true;
      return () => {
        addForm.open = false;
      };
    }, []);
    return null;
  },
}));
// Every group renders: the test renderer has no layout for the virtualizer to measure.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({
    count,
    getItemKey,
  }: {
    count: number;
    getItemKey: (i: number) => unknown;
  }) => ({
    getTotalSize: () => 0,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: getItemKey(index),
        start: 0,
        end: 0,
        size: 0,
        lane: 0,
      })),
    measureElement: () => undefined,
    scrollToIndex: (index: number, options?: unknown) => {
      // Mirror TanStack Virtual: ignore calls while the list is unmounted behind AddCustomEmoji,
      // and clamp the target index against the currently committed item count.
      if (addForm.open) return;
      virtualizerSpy.scrollToIndex(Math.min(index, Math.max(0, count - 1)), options, count);
    },
  }),
}));
vi.mock('../../matrix/matrix', () => ({
  mxcUrlToHttp: (_client: unknown, mxc: string) => mxc.replace('mxc://', 'https://'),
}));
vi.mock('../../lib/user-agent', () => ({ mobileOrTablet: () => false }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../useImagePacks', () => ({ useRelevantImagePacks: () => boardPacks.value }));
vi.mock('../useRecentEmoji', () => ({ useRecentEmoji: () => none }));
vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));
vi.mock('../../lib/hooks/useFilePicker', () => ({
  useFilePicker: (onSelect: (file: File) => void) => () =>
    onSelect(new File(['png'], 'parrot.png', { type: 'image/png' })),
}));
vi.mock('../recent-emoji-list', () => recentEmoji);

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  boardPacks.value = none;
  addForm.open = false;
  vi.clearAllMocks();
});

const renderBoard = () => {
  const onCustomEmojiSelect = vi.fn();
  act(() => {
    renderer = create(
      <EmojiBoard
        imagePackRooms={[] as Room[]}
        requestClose={vi.fn()}
        onCustomEmojiSelect={onCustomEmojiSelect}
      />
    );
  });
  return onCustomEmojiSelect;
};

/** A click on a board item, as the item list hands it on to the board. */
const clickItem = async (attributes: Record<string, string>) => {
  const button = {
    matches: (selector: string) => selector === 'button',
    getAttribute: (name: string) => attributes[name] ?? null,
  };
  const list = renderer!.root.findAll((node) => typeof node.props.onMouseMove === 'function')[0]!;
  await act(() =>
    list.props.onClick({
      nativeEvent: { composedPath: () => [button] },
      altKey: false,
      shiftKey: false,
    })
  );
};

it('records a picked custom emoji among the recent ones by its mxc URL', async () => {
  const onCustomEmojiSelect = renderBoard();

  await clickItem({
    title: 'party-parrot',
    'data-emoji-type': 'customEmoji',
    'data-emoji-data': 'mxc://example.org/parrot',
    'data-emoji-shortcode': 'party-parrot',
  });

  expect(onCustomEmojiSelect).toHaveBeenCalledWith('mxc://example.org/parrot', 'party-parrot');
  expect(recentEmoji.addRecentEmoji).toHaveBeenCalledWith(mx, 'mxc://example.org/parrot');
});

it('records an emoji added from the board among the recent ones', async () => {
  const onCustomEmojiSelect = renderBoard();
  const addButton = renderer!.root.find(
    (node) => node.type === 'button' && node.props['aria-label'] === 'Add custom emoji'
  );
  await act(() => addButton.props.onClick());

  act(() => addForm.onAdd!('mxc://example.org/new', 'parrot'));

  expect(onCustomEmojiSelect).toHaveBeenCalledWith('mxc://example.org/new', 'parrot');
  expect(recentEmoji.addRecentEmoji).toHaveBeenCalledWith(mx, 'mxc://example.org/new');
});

/** A room pack named `name` holding one emoji per shortcode. */
const roomPack = (roomId: string, stateKey: string, name: string, shortcodes: string[]) =>
  new ImagePack(
    `${roomId}/${stateKey}`,
    {
      pack: { display_name: name },
      images: Object.fromEntries(
        shortcodes.map((shortcode) => [shortcode, { url: `mxc://example.org/${shortcode}` }])
      ),
    },
    { roomId, stateKey }
  );

/** The sidebar buttons' labels, in order, without the add button or the emoji items. */
const sidebarLabels = () =>
  renderer!.root
    .findAll(
      (node) =>
        node.type === 'button' &&
        typeof node.props.title === 'string' &&
        node.props['data-emoji-type'] === undefined
    )
    .map((node) => node.props.title as string)
    .filter((label) => label !== 'Add custom emoji');

/** The shortcodes of the custom emoji the board shows, in order. */
const customShortcodes = () =>
  renderer!.root
    .findAll((node) => node.type === 'button' && node.props['data-emoji-type'] === 'customEmoji')
    .map((node) => node.props['data-emoji-shortcode'] as string);

/** The group labels the board shows, in order. */
const groupLabels = () =>
  renderer!.root
    .findAll((node) => node.props.className === 'EmojiGroupLabel' && node.props.size === 'O400')
    .map((node) => String(node.props.children));

it('shows same-named packs of one room as one group after the Unicode groups', () => {
  boardPacks.value = [
    roomPack('!emoji:example.org', '', 'Server', ['frog-1']),
    roomPack('!other:example.org', '', 'Server', ['cat']),
    roomPack('!emoji:example.org', '2', 'Server', ['frog-2']),
  ];
  renderBoard();

  const labels = sidebarLabels();
  expect(labels.filter((label) => label === 'Server')).toHaveLength(2);
  expect(labels.indexOf('Server')).toBeGreaterThan(labels.indexOf('Flags'));
  expect(labels.slice(-2)).toEqual(['Server', 'Server']);
});

it('labels a split pack once and keeps all of its emoji', () => {
  boardPacks.value = [
    roomPack('!emoji:example.org', '', 'Server', ['frog-1']),
    roomPack('!emoji:example.org', '2', 'Server', ['frog-2']),
  ];
  renderBoard();

  expect(sidebarLabels().filter((label) => label === 'Server')).toHaveLength(1);
  expect(customShortcodes()).toEqual(['frog-1', 'frog-2']);
  expect(groupLabels().filter((label) => label === 'Server')).toHaveLength(1);
});

it('lists a split pack in state key order whatever order the room state gives', () => {
  boardPacks.value = [
    roomPack('!emoji:example.org', '10', 'Server', ['frog-10']),
    roomPack('!emoji:example.org', '2', 'Server', ['frog-2']),
    roomPack('!emoji:example.org', '', 'Server', ['frog-1']),
  ];
  renderBoard();

  expect(customShortcodes()).toEqual(['frog-1', 'frog-2', 'frog-10']);
});

it('lists custom emoji before Unicode ones in search results', () => {
  boardPacks.value = [roomPack('!emoji:example.org', '', 'Server', ['smile-frog'])];
  renderBoard();
  const search = renderer!.root.find(
    (node) => node.type === 'input' && typeof node.props.onChange === 'function'
  );
  act(() => {
    search.props.onChange({ target: { value: 'smile' }, currentTarget: { value: 'smile' } });
  });

  const results = renderer!.root
    .findAll((node) => node.type === 'button' && node.props['data-emoji-type'] !== undefined)
    .map((node) => node.props['data-emoji-shortcode'] as string);
  expect(results[0]).toBe('smile-frog');
  expect(results.length).toBeGreaterThan(1);
});

it('scrolls to the chosen custom pack on one sidebar click while searching', () => {
  boardPacks.value = [
    roomPack('!emoji:example.org', '', 'Frogs', ['frog-1']),
    roomPack('!emoji:example.org', '2', 'Frogs', ['frog-2']),
    roomPack('!emoji:example.org', 'parrots', 'Parrots', ['parrot-1']),
  ];
  renderBoard();

  const search = renderer!.root.find(
    (node) => node.type === 'input' && typeof node.props.onChange === 'function'
  );
  act(() => {
    search.props.onChange({
      target: { value: 'no-such-emoji' },
      currentTarget: { value: 'no-such-emoji' },
    });
  });

  const parrotsButton = renderer!.root.find(
    (node) => node.type === 'button' && node.props.title === 'Parrots'
  );
  act(() => {
    parrotsButton.props.onClick();
  });

  // 8 Unicode groups + 2 Frogs chunks = index 10 for Parrots, out of 11 total groups.
  expect(virtualizerSpy.scrollToIndex).toHaveBeenCalledTimes(1);
  expect(virtualizerSpy.scrollToIndex).toHaveBeenCalledWith(10, { align: 'start' }, 11);
});

it('scrolls to the chosen pack after closing the add-custom-emoji view from the sidebar', async () => {
  boardPacks.value = [roomPack('!emoji:example.org', '', 'Frogs', ['frog-1'])];
  renderBoard();

  const addButton = renderer!.root.find(
    (node) => node.type === 'button' && node.props['aria-label'] === 'Add custom emoji'
  );
  await act(() => addButton.props.onClick());

  const frogsButton = renderer!.root.find(
    (node) => node.type === 'button' && node.props.title === 'Frogs'
  );
  act(() => {
    frogsButton.props.onClick();
  });

  expect(virtualizerSpy.scrollToIndex).toHaveBeenCalledTimes(1);
  expect(virtualizerSpy.scrollToIndex).toHaveBeenCalledWith(8, { align: 'start' }, 9);
});
