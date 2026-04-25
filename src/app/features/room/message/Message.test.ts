import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type HostNodeMock = {
  focus: ReturnType<typeof vi.fn>;
  getBoundingClientRect: () => { x: number; y: number; width: number; height: number };
  props: Record<string, unknown>;
  type: unknown;
};

let lastMessageBaseNode: HostNodeMock | undefined;

const domMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
}));
const longTextMocks = vi.hoisted(() => ({
  downloadMindroomLongTextSidecarBlob: vi.fn(),
  getMindroomLongTextSource: vi.fn(() => undefined),
  useMindroomLongTextResolvedContent: vi.fn(() => undefined),
}));

// These renderer/UI mocks should move into shared Vitest setup once the repo adds one.
vi.mock('./styles.css', () => ({
  BubbleAvatarBase: 'BubbleAvatarBase',
  MessageAiRunInfoButton: 'MessageAiRunInfoButton',
  MessageAvatar: 'MessageAvatar',
  MessageBase: 'MessageBase',
  MessageBaseBubbleCollapsed: 'MessageBaseBubbleCollapsed',
  MessageMenuGroup: 'MessageMenuGroup',
  MessageMenuItemText: 'MessageMenuItemText',
  MessageOptionsBar: 'MessageOptionsBar',
  MessageOptionsBase: 'MessageOptionsBase',
}));

vi.mock('focus-trap-react', () => ({
  default: ({
    children,
    focusTrapOptions,
  }: {
    children: React.ReactNode;
    focusTrapOptions?: Record<string, unknown>;
  }) => React.createElement('focus-trap', { focusTrapOptions }, children),
}));

vi.mock('react-aria', () => ({
  useHover: ({ onHoverChange }: { onHoverChange?: (hovering: boolean) => void }) => {
    React.useEffect(() => {
      onHoverChange?.(true);
    }, [onHoverChange]);

    return { hoverProps: {} };
  },
  useFocusWithin: () => ({ focusWithinProps: {} }),
}));

vi.mock('folds', async () => {
  const reactModule = await import('react');
  const { createElement } = reactModule;

  const div =
    (tag = 'div') =>
    ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
      createElement(tag, props, children);

  return {
    Avatar: div(),
    Box: div(),
    Button: div('button'),
    Dialog: div(),
    Header: div(),
    Icon: ({ src }: { src?: string }) => createElement('span', null, src ?? 'icon'),
    IconButton: ({
      children,
      onClick,
      ...props
    }: {
      children?: React.ReactNode;
      onClick?: () => void;
      [key: string]: unknown;
    }) => createElement('button', { ...props, onClick, type: 'button' }, children),
    Icons: {
      CheckTwice: 'CheckTwice',
      Cross: 'Cross',
      Delete: 'Delete',
      Download: 'Download',
      Info: 'Info',
      Link: 'Link',
      Pencil: 'Pencil',
      Pin: 'Pin',
      ReplyArrow: 'ReplyArrow',
      SmilePlus: 'SmilePlus',
      ThreadPlus: 'ThreadPlus',
      User: 'User',
      VerticalDots: 'VerticalDots',
      Warning: 'Warning',
    },
    Input: div('input'),
    Line: div('hr'),
    Menu: div(),
    MenuItem: ({
      children,
      onClick,
      ...props
    }: {
      children?: React.ReactNode;
      onClick?: () => void;
      [key: string]: unknown;
    }) => createElement('button', { ...props, onClick, type: 'button' }, children),
    Modal: div(),
    Overlay: ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
      open ? createElement('div', null, children) : null,
    OverlayBackdrop: div(),
    OverlayCenter: div(),
    PopOut: ({
      children,
      content,
      anchor,
    }: {
      children?: React.ReactNode;
      content?: React.ReactNode;
      anchor?: unknown;
    }) => createElement('div', null, children, anchor ? content : null),
    Spinner: () => createElement('div', null, 'spinner'),
    Text: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
      createElement('span', props, children),
    as: (render: (props: Record<string, unknown>, ref: React.Ref<unknown>) => React.ReactNode) =>
      reactModule.forwardRef(render),
    color: {
      Critical: { Main: '#f00' },
      Success: { Main: '#0a0' },
    },
    config: {
      borderWidth: {
        B300: '1px',
      },
      space: {
        S200: '8px',
        S400: '16px',
      },
    },
  };
});

vi.mock('../../../components/message', () => ({
  AvatarBase: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
  BubbleLayout: ({
    before,
    header,
    children,
  }: {
    before?: React.ReactNode;
    header?: React.ReactNode;
    children?: React.ReactNode;
  }) => React.createElement('div', null, before, header, children),
  CompactLayout: ({ before, children }: { before?: React.ReactNode; children?: React.ReactNode }) =>
    React.createElement('div', null, before, children),
  MessageBase: React.forwardRef(
    (
      {
        children,
        ...props
      }: {
        children?: React.ReactNode;
        [key: string]: unknown;
      },
      ref: React.Ref<HostNodeMock>
    ) => {
      const nodeRef = React.useRef<HostNodeMock>({
        focus: vi.fn(),
        getBoundingClientRect: () => ({
          x: 10,
          y: 20,
          width: 30,
          height: 40,
        }),
        props: {},
        type: 'div',
      });

      nodeRef.current.props = props;
      lastMessageBaseNode = nodeRef.current;

      if (typeof ref === 'function') {
        ref(nodeRef.current);
      } else if (ref) {
        const mutableRef = ref as React.MutableRefObject<HostNodeMock | null>;
        mutableRef.current = nodeRef.current;
      }

      return React.createElement('div', props, children);
    }
  ),
  ModernLayout: ({ before, children }: { before?: React.ReactNode; children?: React.ReactNode }) =>
    React.createElement('div', null, before, children),
  Time: () => React.createElement('span', null, 'time'),
  Username: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement('button', { ...props, type: 'button' }, children),
  UsernameBold: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', null, children),
}));

vi.mock('../../../utils/room', () => ({
  canEditEvent: () => false,
  getEventEdits: () => undefined,
  getEditedEvent: () => undefined,
  getLatestMessageContent: (mEvent: { getContent: () => Record<string, unknown> }) =>
    mEvent.getContent(),
  getMemberAvatarMxc: () => undefined,
  getMemberDisplayName: () => 'Alice',
}));

vi.mock('../../../utils/matrix', () => ({
  getCanonicalAliasOrRoomId: () => '!room:example.org',
  getMxIdLocalPart: () => 'alice',
  isRoomAlias: () => false,
  mxcUrlToHttp: () => undefined,
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getUserId: () => '@alice:example.org',
    sendStateEvent: vi.fn(),
    redactEvent: vi.fn(),
    reportEvent: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useRecentEmoji', () => ({
  useRecentEmoji: () => [],
}));

vi.mock('../../../components/event-readers', () => ({
  EventReaders: () => React.createElement('div', null, 'readers'),
}));

vi.mock('../../../components/text-viewer', () => ({
  TextViewer: () => React.createElement('div', null, 'viewer'),
}));

vi.mock('../../../hooks/useAsyncCallback', () => ({
  AsyncStatus: {
    Error: 'Error',
    Loading: 'Loading',
    Success: 'Success',
  },
  useAsyncCallback: () => [{ status: 'Idle' }, vi.fn()],
}));

vi.mock('../../../components/emoji-board', () => ({
  EmojiBoard: () => React.createElement('div', null, 'emoji-board'),
}));

vi.mock('../reaction-viewer', () => ({
  ReactionViewer: () => React.createElement('div', null, 'reactions'),
}));

vi.mock('./MessageEditor', () => ({
  MessageEditor: () => React.createElement('div', null, 'editor'),
}));

vi.mock('../../../components/user-avatar', () => ({
  UserAvatar: () => React.createElement('div', null, 'avatar'),
}));

vi.mock('../../../utils/dom', () => ({
  copyToClipboard: domMocks.copyToClipboard,
}));

vi.mock('../../../utils/keyboard', () => ({
  stopPropagation: vi.fn(),
}));

vi.mock('../../../plugins/matrix-to', () => ({
  getMatrixToRoomEvent: () => 'https://matrix.to/#/!room:example.org/$event',
}));

vi.mock('../../../plugins/via-servers', () => ({
  getViaServers: () => [],
}));

vi.mock('../../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../../hooks/useRoomPinnedEvents', () => ({
  useRoomPinnedEvents: () => [],
}));

vi.mock('../../../../types/matrix/room', () => ({
  StateEvent: {
    RoomPinnedEvents: 'm.room.pinned_events',
  },
}));

vi.mock('../../../components/power', () => ({
  PowerIcon: () => null,
}));

vi.mock('../../../../util/colorMXID', () => ({
  default: () => '#333',
}));

vi.mock('../../../hooks/useMemberPowerTag', () => ({
  getPowerTagIconSrc: () => undefined,
}));

vi.mock('../../../mindroom/messages/longText', () => ({
  getMindroomLongTextSource: longTextMocks.getMindroomLongTextSource,
}));

vi.mock('../../../mindroom/messages/MindroomLongTextText', () => ({
  downloadMindroomLongTextSidecarBlob: longTextMocks.downloadMindroomLongTextSidecarBlob,
  useMindroomLongTextResolvedContent: longTextMocks.useMindroomLongTextResolvedContent,
}));

vi.mock('../../../state/settings', () => ({
  MessageLayout: {
    Compact: 'Compact',
    Bubble: 'Bubble',
    Modern: 'Modern',
  },
}));

const getMessageComponent = async () => (await import('./Message')).Message;

beforeEach(() => {
  lastMessageBaseNode = undefined;
  vi.clearAllMocks();
  longTextMocks.getMindroomLongTextSource.mockReturnValue(undefined);
  longTextMocks.useMindroomLongTextResolvedContent.mockReturnValue(undefined);
});

const createMessageEvent = (content: Record<string, unknown>) =>
  ({
    threadRootId: undefined,
    getContent: () => content,
    getId: () => '$event',
    getSender: () => '@alice:example.org',
    getTs: () => 1,
    isRedacted: () => false,
  } as const);

const createRoom = () =>
  ({
    roomId: '!room:example.org',
    getTimelineForEvent: () => undefined,
  } as const);

type RenderedMessage = {
  renderer: ReactTestRenderer;
  messageBaseNode?: HostNodeMock;
};

const renderMessage = async (
  content: Record<string, unknown>,
  { collapse = true }: { collapse?: boolean } = {}
): Promise<RenderedMessage> => {
  const Message = await getMessageComponent();
  let renderer!: ReactTestRenderer;
  lastMessageBaseNode = undefined;

  await act(async () => {
    renderer = create(
      React.createElement(
        Message,
        {
          room: createRoom(),
          mEvent: createMessageEvent(content),
          collapse,
          highlight: false,
          messageLayout: 'Modern',
          messageSpacing: '400',
          onUserClick: vi.fn(),
          onUsernameClick: vi.fn(),
          onReplyClick: vi.fn(),
          onReactionToggle: vi.fn(),
          hour24Clock: false,
          dateFormatString: 'MMM D',
        },
        React.createElement('div', null, 'message body')
      )
    );
  });

  return { renderer, messageBaseNode: lastMessageBaseNode };
};

const hasSpanText = (renderer: ReactTestRenderer, text: string): boolean =>
  renderer.root.findAllByType('span').some((node) => node.children.join('') === text);

const getButtonByText = (
  renderer: ReactTestRenderer,
  text: string
): ReactTestInstance | undefined =>
  renderer.root
    .findAllByType('button')
    .find((node) =>
      node.findAllByType('span').some((spanNode) => spanNode.children.join('') === text)
    );

const getButtonByAriaLabel = (
  renderer: ReactTestRenderer,
  ariaLabel: string
): ReactTestInstance | undefined =>
  renderer.root.findAllByType('button').find((node) => node.props['aria-label'] === ariaLabel);

const getButtonByIcon = (
  renderer: ReactTestRenderer,
  icon: string
): ReactTestInstance | undefined =>
  renderer.root
    .findAllByType('button')
    .find((node) =>
      node.findAllByType('span').some((spanNode) => spanNode.children.join('') === icon)
    );

const getDialogFocusTrapOptions = (renderer: ReactTestRenderer): Record<string, unknown> => {
  const dialogFocusTrap = renderer.root
    .findAllByType('focus-trap')
    .find((node) => typeof node.props.focusTrapOptions?.setReturnFocus === 'function');

  if (!dialogFocusTrap) {
    throw new Error('Expected AI run dialog focus trap to be present');
  }

  return dialogFocusTrap.props.focusTrapOptions;
};

const openContextMenu = async (renderer: ReactTestRenderer) => {
  const menuButton = getButtonByIcon(renderer, 'VerticalDots');

  expect(menuButton).toBeDefined();

  await act(async () => {
    menuButton?.props.onClick({
      currentTarget: {
        parentElement: {
          parentElement: {
            getBoundingClientRect: () => ({
              x: 100,
              y: 200,
              width: 24,
              height: 24,
            }),
          },
        },
      },
    });
  });
};

const mindroomAiRunContent = {
  msgtype: 'm.text',
  body: 'hello',
  'io.mindroom.ai_run': {
    version: 1,
    status: 'completed',
    run_id: 'run-123',
    session_id: 'session-456',
    model: {
      config: 'fast',
      provider: 'openai',
      id: 'gpt-5-mini',
    },
    usage: {
      input_tokens: 40,
      output_tokens: 2,
      total_tokens: 42,
      time_to_first_token: 0.042,
    },
    context: {
      input_tokens: 40,
      window_tokens: 100,
    },
    tools: {
      count: 3,
    },
  },
} as const;

describe('Message token usage menu item', () => {
  it(
    'does not render Token usage in the context menu for messages without ai_run metadata',
    async () => {
      const { renderer } = await renderMessage({
        msgtype: 'm.text',
        body: 'hello',
      });

      await openContextMenu(renderer);

      expect(hasSpanText(renderer, 'Token usage')).toBe(false);
    },
    10000
  );

  it('opens the AI run dialog from the context menu and configures explicit return focus', async () => {
    const { renderer, messageBaseNode } = await renderMessage(mindroomAiRunContent);

    expect(hasSpanText(renderer, 'AI Run Metadata')).toBe(false);

    await openContextMenu(renderer);

    expect(hasSpanText(renderer, 'Token usage')).toBe(true);

    const tokenUsageButton = getButtonByText(renderer, 'Token usage');

    expect(tokenUsageButton).toBeDefined();
    expect(tokenUsageButton?.props['aria-pressed']).toBeUndefined();
    expect(messageBaseNode).toBeDefined();

    await act(async () => {
      tokenUsageButton?.props.onClick();
    });

    expect(hasSpanText(renderer, 'AI Run Metadata')).toBe(true);
    expect(hasSpanText(renderer, 'Status: completed')).toBe(true);
    expect(hasSpanText(renderer, 'Tokens: in 40 • out 2 • total 42')).toBe(true);
    const setReturnFocus = getDialogFocusTrapOptions(renderer).setReturnFocus as () =>
      | HostNodeMock
      | false;
    expect(messageBaseNode).toBeDefined();
    expect(setReturnFocus).toBeTypeOf('function');
  });

  it('keeps the header info button path opening the same AI run metadata details', async () => {
    const { renderer } = await renderMessage(mindroomAiRunContent, { collapse: false });

    const infoButton = getButtonByAriaLabel(renderer, 'Open AI run metadata');

    expect(infoButton).toBeDefined();

    await act(async () => {
      infoButton?.props.onClick();
    });

    expect(hasSpanText(renderer, 'AI Run Metadata')).toBe(true);
    expect(hasSpanText(renderer, 'Model: fast (openai / gpt-5-mini)')).toBe(true);
    expect(hasSpanText(renderer, 'Request Context: 40 / 100 (40.0%)')).toBe(true);
    expect(hasSpanText(renderer, 'Tools: 3')).toBe(true);
    expect(hasSpanText(renderer, 'TTFT: 42 ms')).toBe(true);
    expect(hasSpanText(renderer, 'Run: run-123')).toBe(true);
    expect(hasSpanText(renderer, 'Session: session-456')).toBe(true);
  });
});

describe('Message copy text overflow integration', () => {
  it('copies the hydrated long-text body from the context menu', async () => {
    const longTextSource = {
      previewContent: {
        msgtype: 'm.file',
        body: 'Long text overflow…',
        url: 'mxc://mindroom/overflow',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      },
      mxcUri: 'mxc://mindroom/overflow',
      isV2ContentJson: true,
    };
    const resolvedLongTextContent = {
      msgtype: 'm.text',
      body: 'Resolved overflow body',
    };

    longTextMocks.getMindroomLongTextSource.mockReturnValue(longTextSource);
    longTextMocks.useMindroomLongTextResolvedContent.mockImplementation((source, enabled) => {
      const [resolvedContent, setResolvedContent] = React.useState<Record<string, unknown> | undefined>(
        () => undefined
      );

      React.useEffect(() => {
        if (!source || !enabled) {
          setResolvedContent(undefined);
          return;
        }

        void Promise.resolve().then(() => {
          setResolvedContent(resolvedLongTextContent);
        });
      }, [enabled, source]);

      return resolvedContent;
    });

    const { renderer } = await renderMessage({
      msgtype: 'm.file',
      body: 'Long text overflow…',
      url: 'mxc://mindroom/overflow',
      'io.mindroom.long_text': {
        version: 2,
        encoding: 'matrix_event_content_json',
      },
    });

    await openContextMenu(renderer);

    await act(async () => {
      await Promise.resolve();
    });

    const copyTextButton = getButtonByText(renderer, 'Copy Text');

    expect(copyTextButton).toBeDefined();

    await act(async () => {
      copyTextButton?.props.onClick();
    });

    expect(domMocks.copyToClipboard).toHaveBeenCalledWith('Resolved overflow body');
  });
});
