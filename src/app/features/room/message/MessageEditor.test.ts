import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const editorMocks = vi.hoisted(() => ({
  editor: {
    children: [{ type: 'paragraph', children: [{ text: 'Edited root' }] }],
    insertFragment: vi.fn(),
  },
  focus: vi.fn(),
  select: vi.fn(),
}));

const matrixMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(() => Promise.resolve({ event_id: '$edit' })),
}));

vi.mock('folds', async () => {
  const reactModule = await import('react');
  const element =
    (tag = 'div') =>
    ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
      reactModule.createElement(tag, props, children);

  return {
    Box: element(),
    Chip: element('button'),
    Icon: element('span'),
    IconButton: element('button'),
    Icons: {
      Alphabet: 'Alphabet',
      AlphabetUnderline: 'AlphabetUnderline',
      Smile: 'Smile',
    },
    Line: element('hr'),
    PopOut: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    Spinner: element(),
    Text: element('span'),
    as: (render: (props: Record<string, unknown>, ref: React.Ref<unknown>) => React.ReactNode) =>
      reactModule.forwardRef(render),
    config: {
      space: {
        S200: '8px',
      },
    },
  };
});

vi.mock('slate', () => ({
  Editor: {
    end: () => [0, 0],
    start: () => [0, 0],
  },
  Transforms: {
    select: editorMocks.select,
  },
}));

vi.mock('slate-react', () => ({
  ReactEditor: {
    focus: editorMocks.focus,
  },
}));

vi.mock('../../../components/editor', () => ({
  AUTOCOMPLETE_PREFIXES: [],
  AutocompletePrefix: {
    Emoticon: 'Emoticon',
    RoomMention: 'RoomMention',
    UserMention: 'UserMention',
  },
  CustomEditor: ({ bottom }: { bottom?: React.ReactNode }) =>
    React.createElement('div', null, 'editor', bottom),
  EmoticonAutocomplete: () => null,
  RoomMentionAutocomplete: () => null,
  Toolbar: () => null,
  UserMentionAutocomplete: () => null,
  createEmoticonElement: vi.fn(),
  customHtmlEqualsPlainText: () => false,
  getAutocompleteQuery: () => undefined,
  getMentions: () => ({
    room: false,
    users: new Set<string>(),
  }),
  getPrevWorldRange: () => undefined,
  htmlToEditorInput: () => [],
  moveCursor: vi.fn(),
  plainToEditorInput: () => [],
  toMatrixCustomHTML: () => '<p>Edited root</p>',
  toPlainText: () => 'Edited root',
  trimCustomHtml: (value: string) => value,
  useEditor: () => editorMocks.editor,
}));

vi.mock('../../../state/hooks/settings', () => ({
  useSetting: () => [false],
}));

vi.mock('../../../state/settings', () => ({
  settingsAtom: {},
}));

vi.mock('../../../components/UseStateProvider', () => ({
  UseStateProvider: ({
    children,
  }: {
    children: (value: undefined, setValue: ReturnType<typeof vi.fn>) => React.ReactNode;
  }) => children(undefined, vi.fn()),
}));

vi.mock('../../../components/emoji-board', () => ({
  EmojiBoard: () => null,
}));

vi.mock('../../../hooks/useAsyncCallback', () => ({
  AsyncStatus: {
    Loading: 'loading',
    Success: 'success',
  },
  useAsyncCallback: (callback: () => Promise<unknown>) => [{ status: 'idle' }, callback],
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    sendMessage: matrixMocks.sendMessage,
  }),
}));

vi.mock('../../../utils/room', () => ({
  getEditedEvent: () => undefined,
  getMentionContent: () => ({}),
  trimReplyFromFormattedBody: (value: string) => value,
}));

vi.mock('../../../utils/user-agent', () => ({
  mobileOrTablet: () => true,
}));

vi.mock('../../../hooks/useComposingCheck', () => ({
  useComposingCheck: () => () => false,
}));

const getSaveButton = (renderer: ReactTestRenderer): ReactTestInstance => {
  const saveButton = renderer.root
    .findAllByType('button')
    .find((node) =>
      node.findAllByType('span').some((spanNode) => spanNode.children.join('') === 'Save')
    );

  if (!saveButton) {
    throw new Error('Expected Save button');
  }
  return saveButton;
};

describe('MessageEditor local-echo target', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    matrixMocks.sendMessage.mockResolvedValue({ event_id: '$edit' });
  });

  it.each([false, true])(
    'blocks a pending-root edit until the target id is confirmed when encryption is %s',
    async (encrypted) => {
      let eventId = '~!room:example.org:txn-root';
      const room = {
        getTimelineForEvent: () => undefined,
        hasEncryptionStateEvent: () => encrypted,
      } as unknown as Room;
      const mEvent = {
        getContent: () => ({
          body: 'Original root',
          msgtype: 'm.text',
        }),
        getId: () => eventId,
      } as unknown as MatrixEvent;
      const props = {
        roomId: '!room:example.org',
        room,
        mEvent,
        onCancel: vi.fn(),
      };
      let renderer!: ReactTestRenderer;

      await act(async () => {
        renderer = create(
          React.createElement((await import('./MessageEditor')).MessageEditor, props)
        );
      });

      expect(getSaveButton(renderer).props.disabled).toBe(true);
      await act(async () => {
        getSaveButton(renderer).props.onClick();
        eventId = '$confirmed-root';
        await Promise.resolve();
      });
      expect(matrixMocks.sendMessage).not.toHaveBeenCalled();

      await act(async () => {
        renderer.update(
          React.createElement((await import('./MessageEditor')).MessageEditor, {
            ...props,
            mEvent,
          })
        );
      });

      expect(getSaveButton(renderer).props.disabled).toBe(false);
      await act(async () => {
        await getSaveButton(renderer).props.onClick();
      });

      expect(matrixMocks.sendMessage).toHaveBeenCalledOnce();
      expect(matrixMocks.sendMessage).toHaveBeenCalledWith(
        '!room:example.org',
        expect.objectContaining({
          'm.relates_to': {
            event_id: '$confirmed-root',
            rel_type: 'm.replace',
          },
        })
      );
      expect(JSON.stringify(matrixMocks.sendMessage.mock.calls[0]?.[1])).not.toContain(
        '~!room:example.org:txn-root'
      );
    }
  );
});
