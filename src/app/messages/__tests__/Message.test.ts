import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import type { getLongTextSource } from '../../matrix/protocol/longText';
import type { useLongTextResolvedContent } from '../content/LongTextText';
import { MessageLayout } from '../../preferences/settings';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

type HostNodeMock = {
  focus: ReturnType<typeof vi.fn>;
  getBoundingClientRect: () => { x: number; y: number; width: number; height: number };
  props: Record<string, unknown>;
  type: unknown;
};

let lastMessageBaseNode: HostNodeMock | undefined;

const domMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  copyTextPromiseToClipboard: vi.fn(),
}));
const longTextMocks = vi.hoisted(() => ({
  getMindroomLongTextSource: vi.fn<typeof getLongTextSource>(() => undefined),
  getCachedLongTextContent: vi.fn<() => Record<string, unknown> | undefined>(() => undefined),
  hydrateCachedLongText: vi.fn<() => Promise<Record<string, unknown>>>(),
  useMindroomLongTextResolvedContent: vi.fn<typeof useLongTextResolvedContent>(() => undefined),
}));
const settingsMocks = vi.hoisted(() => ({
  developerTools: false,
  useSetting: vi.fn(() => [settingsMocks.developerTools, vi.fn()]),
}));
const pinningMocks = vi.hoisted(() => ({
  canPin: true,
  pinnedEventIds: [] as string[],
}));
const bugReportMocks = vi.hoisted(() => ({
  canReport: true,
}));
const recentEmojiMocks = vi.hoisted(() => ({
  recent: [] as Array<{ unicode: string; label?: string }>,
}));

// These renderer/UI mocks should move into shared Vitest setup once the repo adds one.
vi.mock('../styles.css', () => ({
  CollapsedTime: 'CollapsedTime',
  MessageAvatarWithModel: 'MessageAvatarWithModel',
  MessageBase: 'MessageBase',
  MessageMenuRows: 'MessageMenuRows',
  MessageQuickReaction: 'MessageQuickReaction',
  MessageOptionsBar: 'MessageOptionsBar',
  MessageOptionsBase: 'MessageOptionsBase',
  MessageOptionsBaseAbove: 'MessageOptionsBaseAbove',
  MessageOptionsBaseCollapsed: 'MessageOptionsBaseCollapsed',
  MessageOptionsButton: 'MessageOptionsButton',
  MessageOptionsReplyIcon: 'MessageOptionsReplyIcon',
  MessageOptionsRow: 'MessageOptionsRow',
  MessageToolbarButton: 'MessageToolbarButton',
  MessageToolbarCopiedIcon: 'MessageToolbarCopiedIcon',
  MessageToolbarRunStatsButton: 'MessageToolbarRunStatsButton',
  MessageToolbarSeparator: 'MessageToolbarSeparator',
  SenderLine: 'SenderLine',
}));

vi.mock('../agent-run/ModelBadge.css', () => ({
  Badge: 'Badge',
  Frame: 'Frame',
  Label: 'Label',
  Mark: 'Mark',
}));

vi.mock('../MessageCopyActions.css', () => ({
  CopyActionDivider: 'CopyActionDivider',
}));

vi.mock('../MessageControls.css', () => ({
  AiRunDetailsTarget: 'AiRunDetailsTarget',
  ReplyDetailsScroll: 'ReplyDetailsScroll',
}));

vi.mock('../../ui/page/PageScroll', async () => {
  const { createElement } = await import('react');
  return {
    PageScroll: ({ header, children }: { header?: React.ReactNode; children?: React.ReactNode }) =>
      createElement('div', null, header, children),
  };
});

vi.mock('focus-trap-react', () => ({
  FocusTrap: ({
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
    Icon: ({ src }: { src?: string | (() => unknown) }) =>
      createElement('span', null, typeof src === 'function' ? src.name : (src ?? 'icon')),
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
      BlockCode: 'BlockCode',
      Check: 'Check',
      CheckTwice: 'CheckTwice',
      Cross: 'Cross',
      Delete: 'Delete',
      Download: 'Download',
      Info: 'Info',
      Link: 'Link',
      Pencil: 'Pencil',
      Pin: 'Pin',
      ReplyArrow: 'ReplyArrow',
      Smile: 'Smile',
      SmilePlus: 'SmilePlus',
      Terminal: 'Terminal',
      Text: 'Text',
      Thread: 'Thread',
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
    Scroll: div(),
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
    Tooltip: div(),
    toRem: (px: number) => `${px / 16}rem`,
    TooltipProvider: ({
      children,
    }: {
      children: (triggerRef: React.Ref<unknown>) => React.ReactNode;
    }) => createElement(reactModule.Fragment, null, children(null)),
    as:
      (render: (props: Record<string, unknown>, ref: React.Ref<unknown>) => React.ReactNode) =>
      ({ ref, ...props }: Record<string, unknown> & { ref?: React.Ref<unknown> }) =>
        render(props, ref ?? null),
    color: {
      Critical: { Main: '#f00' },
      Success: { Main: '#0a0' },
    },
    config: {
      borderWidth: {
        B300: '1px',
      },
      space: {
        S100: '4px',
        S200: '8px',
        S400: '16px',
      },
    },
  };
});

vi.mock('../Time', () => ({
  Time: () => React.createElement('span', null, 'time'),
}));
vi.mock('../layout/layout', () => ({
  AvatarBase: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('div', props, children),
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
  MessageBase: ({
    children,
    ref,
    ...props
  }: {
    children?: React.ReactNode;
    ref?: React.Ref<HostNodeMock>;
    [key: string]: unknown;
  }) => {
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
      ref.current = nodeRef.current;
    }

    return React.createElement('div', props, children);
  },
  ModernLayout: ({ before, children }: { before?: React.ReactNode; children?: React.ReactNode }) =>
    React.createElement('div', null, before, children),
  Username: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement('button', { ...props, type: 'button' }, children),
  UsernameBold: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', null, children),
}));

vi.mock('../../matrix/room', () => ({
  canEditEvent: () => false,
  getEditedEvent: () => undefined,
  getLatestMessageContent: (mEvent: { getContent: () => Record<string, unknown> }) =>
    mEvent.getContent(),
  getMemberAvatarMxc: () => undefined,
  getMemberDisplayName: () => 'Alice',
}));

vi.mock('../../matrix/matrix', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../matrix/matrix')>();
  return {
    getCanonicalAliasOrRoomId: () => '!room:example.org',
    // The real ones: whether a sender is an agent is read from its user ID.
    getMxIdLocalPart: actual.getMxIdLocalPart,
    getMxIdServer: actual.getMxIdServer,
    isRoomAlias: () => false,
    mxcUrlToHttp: () => undefined,
  };
});

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getUserId: () => '@alice:example.org',
    sendStateEvent: vi.fn(),
    redactEvent: vi.fn(),
    reportEvent: vi.fn(),
  }),
}));

vi.mock('../../emoji/useRecentEmoji', () => ({
  useRecentEmoji: () => recentEmojiMocks.recent,
}));

vi.mock('../../emoji/useImagePacks', () => ({
  useRelevantImagePacks: () => [],
}));

vi.mock('../EventReaders', () => ({
  EventReaders: () => React.createElement('div', null, 'readers'),
}));

vi.mock('../viewers/TextViewer', () => ({
  TextViewer: () => React.createElement('div', null, 'viewer'),
}));

vi.mock('../viewers/EventSourceViewer', () => ({
  EventSourceViewer: () => React.createElement('div', null, 'viewer'),
}));

vi.mock('../../lib/hooks/useAsyncCallback', () => ({
  AsyncStatus: {
    Error: 'Error',
    Loading: 'Loading',
    Success: 'Success',
  },
  useAsyncCallback: () => [{ status: 'Idle' }, vi.fn()],
}));

vi.mock('../../emoji/board/LazyEmojiBoard', () => ({
  EmojiBoard: () => React.createElement('div', null, 'emoji-board'),
}));

vi.mock('../reactions/ReactionViewer', () => ({
  ReactionViewer: () => React.createElement('div', null, 'reactions'),
}));

vi.mock('../ForkIcon', () => ({ ForkIcon: 'Fork' }));
vi.mock('../edit/MessageEditor', () => ({
  MessageEditor: () => React.createElement('div', null, 'editor'),
}));

vi.mock('../../avatars/UserAvatar', () => ({
  UserAvatar: () => React.createElement('div', null, 'avatar'),
}));

vi.mock('../../lib/dom', () => ({
  copyToClipboard: domMocks.copyToClipboard,
  copyTextPromiseToClipboard: domMocks.copyTextPromiseToClipboard,
}));

vi.mock('../../lib/keyboard', () => ({
  stopPropagation: vi.fn(),
}));

vi.mock('../../matrix/matrix-to', () => ({
  getMatrixToRoomEvent: () => 'https://matrix.to/#/!room:example.org/$event',
}));

vi.mock('../../matrix/via-servers', () => ({
  getViaServers: () => [],
}));

vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../event-store/threads/useThreadPinning', () => ({
  usePinnedEventIds: () => pinningMocks.pinnedEventIds,
  useThreadPinning: () => ({
    pinnedEventIds: pinningMocks.pinnedEventIds,
    canPin: pinningMocks.canPin,
    setPinned: vi.fn(),
    updating: false,
    error: undefined,
  }),
}));

vi.mock('../../matrix/types/room', () => ({
  StateEvent: {
    RoomPinnedEvents: 'm.room.pinned_events',
  },
}));

// The bug-report flow pulls in thread and Matrix plumbing this message-menu test does not exercise.
vi.mock('../../bug-reports/MessageBugReportItem', async () => {
  const { createElement } = await import('react');
  return {
    MessageBugReportItem: () =>
      createElement('button', null, createElement('span', null, 'Report a bug')),
    useCanReportMessageBug: () => bugReportMocks.canReport,
  };
});

vi.mock('../../matrix/protocol/longText', () => ({
  getLongTextSource: longTextMocks.getMindroomLongTextSource,
  getCachedLongTextContent: longTextMocks.getCachedLongTextContent,
}));

vi.mock('../../event-store/cache/attachmentRepository', () => ({
  hydrateCachedLongText: longTextMocks.hydrateCachedLongText,
}));

vi.mock('../content/LongTextText', () => ({
  useLongTextResolvedContent: longTextMocks.useMindroomLongTextResolvedContent,
}));

vi.mock('../../preferences/settings', () => ({
  MessageLayout: {
    Compact: 'Compact',
    Bubble: 'Bubble',
    Modern: 'Modern',
  },
  settingsAtom: {},
}));
vi.mock('../../preferences/useSetting', () => ({
  useSetting: settingsMocks.useSetting,
}));

const getMessageComponent = async () => (await import('../Message')).Message;

let messageSender = '@alice:example.org';

beforeEach(() => {
  lastMessageBaseNode = undefined;
  messageSender = '@alice:example.org';
  settingsMocks.developerTools = false;
  pinningMocks.canPin = true;
  pinningMocks.pinnedEventIds = [];
  bugReportMocks.canReport = true;
  recentEmojiMocks.recent = [];
  vi.clearAllMocks();
  domMocks.copyToClipboard.mockResolvedValue(true);
  domMocks.copyTextPromiseToClipboard.mockImplementation((textPromise: Promise<string>) =>
    textPromise.then(
      (text) => domMocks.copyToClipboard(text),
      () => false
    )
  );
  longTextMocks.getMindroomLongTextSource.mockReturnValue(undefined);
  longTextMocks.getCachedLongTextContent.mockReturnValue(undefined);
  longTextMocks.hydrateCachedLongText.mockReset();
  longTextMocks.useMindroomLongTextResolvedContent.mockReturnValue(undefined);
});

const createMessageEvent = (content: Record<string, unknown>, eventId = '$event') =>
  ({
    threadRootId: undefined,
    getContent: () => content,
    getId: () => eventId,
    getSender: () => messageSender,
    getTs: () => 1,
    isRedacted: () => false,
  }) as unknown as MatrixEvent;

const createRoom = () =>
  ({
    roomId: '!room:example.org',
    getTimelineForEvent: () => undefined,
  }) as unknown as Room;

type RenderedMessage = {
  renderer: ReactTestRenderer;
  messageBaseNode?: HostNodeMock;
};

const renderMessage = async (
  content: Record<string, unknown>,
  {
    collapse = true,
    eventId = '$event',
    resolvedMessageContent,
    serverActions = false,
  }: {
    collapse?: boolean;
    eventId?: string;
    resolvedMessageContent?: Record<string, unknown>;
    serverActions?: boolean;
  } = {}
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
          mEvent: createMessageEvent(content, eventId),
          collapse,
          highlight: false,
          canDelete: serverActions,
          canPinEvent: serverActions,
          canSendReaction: serverActions,
          resolvedMessageContent,
          messageLayout: MessageLayout.Modern,
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

/** The text of every button, in order: the open menu's entries among them. */
const buttonTexts = (renderer: ReactTestRenderer): string[] =>
  renderer.root.findAllByType('button').map((node) =>
    node
      .findAllByType('span')
      .map((span) => span.children.join(''))
      .join('')
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
    .findAllByType('focus-trap' as never)
    .find((node) => typeof node.props.focusTrapOptions?.setReturnFocus === 'function');

  if (!dialogFocusTrap) {
    throw new Error('Expected AI run dialog focus trap to be present');
  }

  return dialogFocusTrap.props.focusTrapOptions;
};

/** The value beside a reply-details row label. */
const rowValue = (renderer: ReactTestRenderer, label: string): string | undefined => {
  const cells = renderer.root.findAll(
    (node) => node.type === 'span' && (node.props.as === 'dt' || node.props.as === 'dd')
  );
  const term = cells.findIndex(
    (node) => node.props.as === 'dt' && node.children.join('') === label
  );
  return term < 0 ? undefined : cells[term + 1]?.children.join('');
};

const hasNodeTip = (renderer: ReactTestRenderer, tip: string): boolean =>
  renderer.root.findAll((node) => node.props.tip === tip).length > 0;

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

const aiRunContent = {
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
      cache_read_tokens: 20,
      cache_write_tokens: 5,
      time_to_first_token: 0.042,
    },
    context: {
      input_tokens: 65,
      window_tokens: 100,
      cache_read_input_tokens: 20,
      cache_write_input_tokens: 5,
      uncached_input_tokens: 45,
    },
    tools: {
      count: 3,
    },
  },
} as const;

importBeforeTests(() => import('../Message'));

describe('Message local-echo actions', () => {
  it('hides every action that needs a confirmed server event id', async () => {
    const { renderer } = await renderMessage(
      {
        msgtype: 'm.text',
        body: 'pending root',
      },
      {
        eventId: '~!room:example.org:txn-root',
        serverActions: true,
      }
    );

    expect(getButtonByIcon(renderer, 'ReplyArrow')).toBeUndefined();
    expect(getButtonByIcon(renderer, 'ThreadPlus')).toBeUndefined();
    expect(getButtonByIcon(renderer, 'SmilePlus')).toBeUndefined();

    await openContextMenu(renderer);

    expect(getButtonByText(renderer, 'Reply')).toBeUndefined();
    expect(getButtonByText(renderer, 'Reply in Thread')).toBeUndefined();
    expect(getButtonByText(renderer, 'Add Reaction')).toBeUndefined();
    expect(getButtonByText(renderer, 'Copy Link')).toBeUndefined();
    expect(getButtonByText(renderer, 'Pin Message')).toBeUndefined();
    expect(getButtonByText(renderer, 'Delete')).toBeUndefined();
    expect(getButtonByText(renderer, 'Copy Text')).toBeDefined();
    // Failed and pending local echoes are prime bug-report targets, so it is not server-gated.
    expect(getButtonByText(renderer, 'Report a bug')).toBeDefined();
  });

  it('keeps confirmed message actions available', async () => {
    const { renderer } = await renderMessage(
      {
        msgtype: 'm.text',
        body: 'confirmed root',
      },
      {
        serverActions: true,
      }
    );

    expect(getButtonByIcon(renderer, 'ReplyArrow')).toBeDefined();
    expect(getButtonByIcon(renderer, 'ThreadPlus')).toBeDefined();
    expect(getButtonByIcon(renderer, 'SmilePlus')).toBeDefined();
    // The hover toolbar's icons name themselves, as the menu items do, with Copy Text first.
    expect(getButtonByIcon(renderer, 'CopyIconSrc')!.props['aria-label']).toBe('Copy Text');
    expect(getButtonByIcon(renderer, 'SmilePlus')!.props['aria-label']).toBe('Add Reaction');
    expect(getButtonByIcon(renderer, 'ReplyArrow')!.props['aria-label']).toBe('Reply');
    expect(getButtonByIcon(renderer, 'ThreadPlus')!.props['aria-label']).toBe('Reply in Thread');
    expect(getButtonByIcon(renderer, 'VerticalDots')!.props['aria-label']).toBe('More Options');

    await openContextMenu(renderer);

    expect(getButtonByText(renderer, 'Reply')).toBeDefined();
    expect(getButtonByText(renderer, 'Reply in Thread')).toBeDefined();
    expect(getButtonByText(renderer, 'Add Reaction')).toBeDefined();
    expect(getButtonByText(renderer, 'Copy Link')).toBeDefined();
    expect(getButtonByText(renderer, 'Pin Message')).toBeDefined();
    expect(getButtonByText(renderer, 'Delete')).toBeDefined();
  });
});

describe('Message from another thread, in a fork', () => {
  it('offers copying and the way to its own thread, and nothing that would write there', async () => {
    const Message = await getMessageComponent();
    const onOpenInOriginalThread = vi.fn();
    const onForkClick = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(
          Message,
          {
            room: createRoom(),
            mEvent: createMessageEvent({ msgtype: 'm.text', body: 'from the parent thread' }),
            collapse: true,
            highlight: false,
            messageLayout: MessageLayout.Modern,
            messageSpacing: '400',
            onOpenInOriginalThread,
            onForkClick,
          },
          React.createElement('div', null, 'message body')
        )
      );
    });

    expect(getButtonByIcon(renderer, 'ReplyArrow')).toBeUndefined();
    expect(getButtonByIcon(renderer, 'ThreadPlus')).toBeUndefined();
    expect(getButtonByIcon(renderer, 'SmilePlus')).toBeUndefined();

    await openContextMenu(renderer);

    expect(getButtonByText(renderer, 'Copy Text')).toBeDefined();
    expect(getButtonByText(renderer, 'Copy Link')).toBeDefined();
    for (const label of ['Reply', 'Reply in Thread', 'Add Reaction', 'Pin Message', 'Delete']) {
      expect(getButtonByText(renderer, label), label).toBeUndefined();
    }
    // Forking it forks its own thread, which needs nothing written there.
    const texts = buttonTexts(renderer);
    expect(texts.indexOf('Fork from here')).toBe(texts.indexOf('Open in original thread') + 1);

    await act(async () => {
      getButtonByText(renderer, 'Open in original thread')?.props.onClick();
    });
    expect(onOpenInOriginalThread).toHaveBeenCalledTimes(1);
    // Choosing an entry closed the menu.
    await openContextMenu(renderer);
    await act(async () => {
      getButtonByText(renderer, 'Fork from here')?.props.onClick();
    });
    expect(onForkClick).toHaveBeenCalledWith('$event');
  });
});

describe('Message Fork from here', () => {
  const renderForkable = async (eventId: string) => {
    const Message = await getMessageComponent();
    const onForkClick = vi.fn();
    const onForkToRoomClick = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(
          Message,
          {
            room: createRoom(),
            mEvent: createMessageEvent({ msgtype: 'm.text', body: 'a reply' }, eventId),
            collapse: true,
            highlight: false,
            messageLayout: MessageLayout.Modern,
            messageSpacing: '400',
            onReplyClick: vi.fn(),
            onForkClick,
            onForkToRoomClick,
          },
          React.createElement('div', null, 'message body')
        )
      );
    });
    await openContextMenu(renderer);
    return { renderer, onForkClick, onForkToRoomClick };
  };

  it('comes right after Copy Link in Copy & Fork, followed by Fork to room…, and forks at this message', async () => {
    const { renderer, onForkClick, onForkToRoomClick } = await renderForkable('$event');

    const texts = buttonTexts(renderer);
    expect(texts.indexOf('Copy Link')).toBeGreaterThan(-1);
    expect(texts.indexOf('Fork from here')).toBe(texts.indexOf('Copy Link') + 1);
    expect(texts.indexOf('Fork to room…')).toBe(texts.indexOf('Fork from here') + 1);
    await act(async () => {
      getButtonByText(renderer, 'Fork from here')?.props.onClick();
    });
    expect(onForkClick).toHaveBeenCalledWith('$event');

    await openContextMenu(renderer);
    await act(async () => {
      getButtonByText(renderer, 'Fork to room…')?.props.onClick();
    });
    expect(onForkToRoomClick).toHaveBeenCalledWith('$event');
  });

  it('is not offered for a message the server has not confirmed', async () => {
    const { renderer } = await renderForkable('~!room:example.org:txn-1');

    expect(getButtonByText(renderer, 'Fork from here')).toBeUndefined();
    expect(getButtonByText(renderer, 'Fork to room…')).toBeUndefined();
  });
});

describe('Message reply details menu item', () => {
  it('does not render Reply details in the context menu for messages without ai_run metadata', async () => {
    const { renderer } = await renderMessage({
      msgtype: 'm.text',
      body: 'hello',
    });

    await openContextMenu(renderer);

    expect(hasSpanText(renderer, 'Reply details')).toBe(false);
  }, 10000);

  it('opens reply details from the context menu and configures explicit return focus', async () => {
    const { renderer, messageBaseNode } = await renderMessage(aiRunContent);
    const aiRunAvatars = renderer.root.findAll(
      (node) => node.type === 'div' && node.props['data-user-id'] === '@alice:example.org'
    );
    const aiRunAvatarStacks = renderer.root.findAll(
      (node) => node.type === 'div' && node.props.className === 'MessageAvatarWithModel'
    );

    expect(aiRunAvatars).toHaveLength(1);
    expect(aiRunAvatars[0]?.props.size).toBe('300');
    expect(aiRunAvatarStacks).toHaveLength(1);
    expect(aiRunAvatarStacks[0]?.findAll((node) => node === aiRunAvatars[0])).toHaveLength(1);
    expect(hasSpanText(renderer, 'Fast')).toBe(true);
    expect(hasNodeTip(renderer, 'fast (openai / gpt-5-mini)')).toBe(true);
    expect(hasSpanText(renderer, 'Reply details')).toBe(false);

    await openContextMenu(renderer);

    const detailsButton = getButtonByText(renderer, 'Reply details');

    expect(detailsButton).toBeDefined();
    expect(detailsButton?.props['aria-pressed']).toBeUndefined();
    expect(messageBaseNode).toBeDefined();

    await act(async () => {
      detailsButton?.props.onClick();
    });

    expect(hasSpanText(renderer, 'Reply details')).toBe(true);
    expect(hasSpanText(renderer, 'Tokens')).toBe(true);
    expect(hasSpanText(renderer, '42')).toBe(true);
    expect(hasSpanText(renderer, 'Input')).toBe(true);
    expect(hasSpanText(renderer, 'Output')).toBe(true);
    const setReturnFocus = getDialogFocusTrapOptions(renderer).setReturnFocus as () =>
      HostNodeMock | false;
    expect(messageBaseNode).toBeDefined();
    expect(setReturnFocus).toBeTypeOf('function');
  });

  it('opens reply details from the hover toolbar RunStatsIcon button with dialog ARIA attributes', async () => {
    const { renderer } = await renderMessage(aiRunContent, { collapse: false });

    const statsButton = getButtonByAriaLabel(renderer, 'Reply details');

    expect(statsButton).toBeDefined();
    expect(statsButton?.props['aria-haspopup']).toBe('dialog');
    expect(statsButton?.props['aria-expanded']).toBe(false);
    expect(getButtonByIcon(renderer, 'RunStatsIcon')).toBe(statsButton);

    await act(async () => {
      statsButton?.props.onClick();
    });
    expect(getButtonByAriaLabel(renderer, 'Reply details')?.props['aria-expanded']).toBe(true);

    expect(hasSpanText(renderer, 'Reply details')).toBe(true);
    expect(hasSpanText(renderer, 'openai · gpt-5-mini')).toBe(true);
    expect(hasSpanText(renderer, '65 of 100 · 65.0%')).toBe(true);
    expect(hasSpanText(renderer, '3 tool calls')).toBe(true);
    expect(hasSpanText(renderer, '42 ms')).toBe(true);
    expect(rowValue(renderer, 'Configured model')).toBe('fast');
    expect(rowValue(renderer, 'Run ID')).toBe('run-123');
    expect(rowValue(renderer, 'Session ID')).toBe('session-456');
  });

  it('renders AvatarModelMark, ModelBadge, and Reply details on a streaming placeholder with early ai_run', async () => {
    const { renderer } = await renderMessage(
      {
        msgtype: 'm.text',
        body: 'Thinking...',
        'io.mindroom.stream_status': 'pending',
        'io.mindroom.ai_run': {
          version: 1,
          model: {
            config: 'gemini4_neon',
            display_name: 'Gemini 4 Neon',
            id: 'google/gemini-4-neon',
            provider: 'openrouter',
          },
        },
      },
      { collapse: false }
    );

    const avatarStacks = renderer.root.findAll(
      (node) => node.type === 'div' && node.props.className === 'MessageAvatarWithModel'
    );
    const avatarMarks = renderer.root.findAll(
      (node) => node.type === 'span' && node.props.className === 'Mark'
    );

    expect(avatarStacks).toHaveLength(1);
    expect(avatarMarks).toHaveLength(1);
    expect(hasSpanText(renderer, 'Gemini 4 Neon')).toBe(true);
    expect(
      hasNodeTip(renderer, 'Gemini 4 Neon · gemini4_neon (openrouter / google/gemini-4-neon)')
    ).toBe(true);
    expect(getButtonByAriaLabel(renderer, 'Reply details')).toBeDefined();
  });

  it('does not expose an empty Reply details button for bare status-only completed ai_run', async () => {
    const { renderer } = await renderMessage(
      {
        msgtype: 'm.text',
        body: 'Done',
        'io.mindroom.ai_run': {
          version: 1,
          status: 'completed',
        },
      },
      { collapse: false }
    );

    expect(getButtonByAriaLabel(renderer, 'Reply details')).toBeUndefined();

    await openContextMenu(renderer);
    expect(getButtonByText(renderer, 'Reply details')).toBeUndefined();
  });

  it('still exposes Reply details for flagged status-only cancelled ai_run', async () => {
    const { renderer } = await renderMessage(
      {
        msgtype: 'm.text',
        body: 'Stopped',
        'io.mindroom.ai_run': {
          version: 1,
          status: 'cancelled',
        },
      },
      { collapse: false }
    );

    expect(getButtonByAriaLabel(renderer, 'Reply details')).toBeDefined();
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
      const [resolvedContent, setResolvedContent] = React.useState<
        Record<string, unknown> | undefined
      >(() => undefined);

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

  it('gates Download Original and View Source behind developerTools without hiding Copy Text', async () => {
    const longTextContent = {
      msgtype: 'm.file',
      body: 'Long text overflow…',
      url: 'mxc://mindroom/overflow',
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
    };
    longTextMocks.getMindroomLongTextSource.mockReturnValue({
      previewContent: longTextContent,
      mxcUri: 'mxc://mindroom/overflow',
      isV2ContentJson: true,
    });
    longTextMocks.useMindroomLongTextResolvedContent.mockReturnValue({
      msgtype: 'm.text',
      body: 'Full long-text reply',
    });

    const { renderer: hidden } = await renderMessage(longTextContent);
    expect(settingsMocks.useSetting).not.toHaveBeenCalled();
    await openContextMenu(hidden);
    expect(getButtonByText(hidden, 'Copy Text')).toBeDefined();
    expect(getButtonByText(hidden, 'Download Original')).toBeUndefined();
    expect(getButtonByText(hidden, 'View Source')).toBeUndefined();

    settingsMocks.developerTools = true;
    const { renderer: shown } = await renderMessage(longTextContent);
    await openContextMenu(shown);
    expect(getButtonByText(shown, 'Download Original')).toBeDefined();
    expect(getButtonByText(shown, 'View Source')).toBeDefined();
    const texts = buttonTexts(shown);
    expect(texts.indexOf('Download Original')).toBe(texts.indexOf('Read Receipts') + 1);
    expect(texts.indexOf('View Source')).toBe(texts.indexOf('Download Original') + 1);
    expect(texts.indexOf('Report a bug')).toBe(texts.indexOf('View Source') + 1);
  });
});

describe('Message copy text tool markers', () => {
  const toolMarkerContent = {
    msgtype: 'm.text',
    body: 'Let me check.\n\n🔧 `search_web` [1]\n\nIt is sunny.',
    'io.mindroom.tool_trace': {
      version: 2,
      events: [
        {
          type: 'tool_call_completed',
          tool_name: 'search_web',
          args_preview: 'query=weather',
          result_preview: 'Sunny',
        },
      ],
    },
  };

  // An agent's markers draw tool rows, so its copy leaves their lines out.
  beforeEach(() => {
    messageSender = '@mindroom_code:example.org';
  });

  it('copies a marker line whole from a person, whose message shows it as text', async () => {
    messageSender = '@alice:example.org';
    const { renderer } = await renderMessage(toolMarkerContent);

    await openContextMenu(renderer);

    expect(getButtonByAriaLabel(renderer, 'Copy Text with Tool Calls')).toBeUndefined();
    await act(async () => {
      getButtonByText(renderer, 'Copy Text')?.props.onClick();
    });

    expect(domMocks.copyToClipboard).toHaveBeenCalledWith(toolMarkerContent.body);
  });

  it('keeps markers the rendered HTML shows as text', async () => {
    const body = 'Markers look like this:\n\n```\n🔧 `search_web` [1]\n```';
    const { renderer } = await renderMessage({
      msgtype: 'm.text',
      body,
      format: 'org.matrix.custom.html',
      formatted_body:
        '<p>Markers look like this:</p>\n<pre><code>🔧 `search_web` [1]\n</code></pre>\n',
    });

    await openContextMenu(renderer);

    expect(getButtonByAriaLabel(renderer, 'Copy Text with Tool Calls')).toBeUndefined();
    await act(async () => {
      getButtonByText(renderer, 'Copy Text')?.props.onClick();
    });

    expect(domMocks.copyToClipboard).toHaveBeenCalledWith(body);
  });

  it('copies the reply without tool markers from the primary action', async () => {
    const { renderer } = await renderMessage(toolMarkerContent);

    await openContextMenu(renderer);

    await act(async () => {
      getButtonByText(renderer, 'Copy Text')?.props.onClick();
    });

    expect(domMocks.copyToClipboard).toHaveBeenCalledWith('Let me check.\n\nIt is sunny.');
  });

  it('copies the reply with structured tool calls from the side action', async () => {
    const { renderer } = await renderMessage(toolMarkerContent);

    await openContextMenu(renderer);

    const copyWithToolCallsButton = getButtonByAriaLabel(renderer, 'Copy Text with Tool Calls');
    expect(copyWithToolCallsButton).toBeDefined();

    await act(async () => {
      copyWithToolCallsButton?.props.onClick();
    });

    expect(domMocks.copyToClipboard).toHaveBeenCalledWith(
      [
        'Let me check.',
        '',
        '**🔧 Tool call 1**',
        '',
        '```',
        'search_web(query=weather)',
        '```',
        '',
        'Result:',
        '',
        '```',
        'Sunny',
        '```',
        '',
        'It is sunny.',
      ].join('\n')
    );
  });

  it('copies tool calls from the primary action when the reply has no other text', async () => {
    const { renderer } = await renderMessage({
      msgtype: 'm.text',
      body: '🔧 `shell` [1] ⏳',
      'io.mindroom.tool_trace': {
        version: 2,
        events: [{ type: 'tool_call_started', tool_name: 'shell', args_preview: 'cmd=ls' }],
      },
    });

    await openContextMenu(renderer);

    // The side action would copy the same text, so it is not offered.
    expect(getButtonByText(renderer, 'Copy Text')).toBeDefined();
    expect(getButtonByAriaLabel(renderer, 'Copy Text with Tool Calls')).toBeUndefined();

    await act(async () => {
      getButtonByText(renderer, 'Copy Text')?.props.onClick();
    });

    expect(domMocks.copyToClipboard).toHaveBeenCalledWith(
      ['**🔧 Tool call 1 (running)**', '', '```', 'shell(cmd=ls)', '```'].join('\n')
    );
  });

  it('hides the side action while long text is still loading', async () => {
    longTextMocks.getMindroomLongTextSource.mockReturnValue({
      previewContent: toolMarkerContent,
      mxcUri: 'mxc://mindroom/overflow',
      isV2ContentJson: true,
    });

    const { renderer } = await renderMessage(toolMarkerContent);

    await openContextMenu(renderer);

    expect(getButtonByText(renderer, 'Copy Text (loading…)')).toBeDefined();
    expect(getButtonByAriaLabel(renderer, 'Copy Text with Tool Calls')).toBeUndefined();
  });

  it('copies the edited content the timeline resolved', async () => {
    const { renderer } = await renderMessage(
      { msgtype: 'm.text', body: 'original reply' },
      { resolvedMessageContent: toolMarkerContent }
    );

    await openContextMenu(renderer);

    await act(async () => {
      getButtonByText(renderer, 'Copy Text')?.props.onClick();
    });

    expect(domMocks.copyToClipboard).toHaveBeenCalledWith('Let me check.\n\nIt is sunny.');
  });

  it('shows a labelled tool-call row on touch screens', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('pointer: coarse'),
    }));
    try {
      const { renderer } = await renderMessage(toolMarkerContent);

      // A touch screen shows no hover toolbar; a long press opens the menu, as a context menu.
      vi.stubGlobal('document', { getSelection: () => null });
      const row = renderer.root.find(
        (node) =>
          typeof node.props.onContextMenu === 'function' &&
          typeof node.props.onFocusCapture === 'function'
      );
      await act(async () => {
        row.props.onContextMenu({
          target: { closest: () => null },
          currentTarget: { contains: () => true },
          preventDefault: () => undefined,
          clientX: 24,
          clientY: 24,
        });
      });

      expect(getButtonByAriaLabel(renderer, 'Copy Text with Tool Calls')).toBeUndefined();
      const labelledRow = getButtonByText(renderer, 'Copy Text with Tool Calls');
      expect(labelledRow).toBeDefined();

      await act(async () => {
        labelledRow?.props.onClick();
      });

      expect(domMocks.copyToClipboard).toHaveBeenCalledWith(
        expect.stringContaining('**🔧 Tool call 1**')
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('leaves a right click inside its pop-outs and their dialogs to the browser', async () => {
    const { renderer } = await renderMessage({ msgtype: 'm.text', body: 'plain reply' });
    const row = renderer.root.find(
      (node) =>
        typeof node.props.onContextMenu === 'function' &&
        typeof node.props.onFocusCapture === 'function'
    );
    const preventDefault = vi.fn();

    // React passes a right click inside a portal (View Source, say) up to the row.
    await act(async () => {
      row.props.onContextMenu({
        target: { closest: () => null },
        currentTarget: { contains: () => false },
        preventDefault,
        clientX: 24,
        clientY: 24,
      });
    });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(getButtonByText(renderer, 'Copy Text')).toBeUndefined();
  });

  it('hides the side action for replies without tool markers', async () => {
    const { renderer } = await renderMessage({ msgtype: 'm.text', body: 'plain reply' });

    await openContextMenu(renderer);

    expect(getButtonByText(renderer, 'Copy Text')).toBeDefined();
    expect(getButtonByAriaLabel(renderer, 'Copy Text with Tool Calls')).toBeUndefined();
  });
});

describe('Grouped message menu & Reply in Thread gating', () => {
  const renderCustom = async (
    content: Record<string, unknown>,
    props: Record<string, unknown> = {}
  ) => {
    const Message = await getMessageComponent();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(
          Message,
          {
            room: createRoom(),
            mEvent: createMessageEvent(content),
            collapse: true,
            highlight: false,
            ...props,
          },
          React.createElement('div', null, 'body')
        )
      );
    });
    return renderer;
  };

  const hostChild = (node: ReactTestInstance): ReactTestInstance =>
    typeof node.type === 'string'
      ? node
      : hostChild(
          node.children.find((child): child is ReactTestInstance => typeof child !== 'string')!
        );

  const inspectMenu = (renderer: ReactTestRenderer) => {
    const rows = renderer.root.find(
      (node) => node.type === 'div' && node.props.className === 'MessageMenuRows'
    );
    const children = rows.children
      .filter((child): child is ReactTestInstance => typeof child !== 'string')
      .map(hostChild);
    const kinds = children.map((child) => (child.type === 'hr' ? 'line' : 'group'));
    const groups = children
      .filter((child) => child.type !== 'hr')
      .map((group) => {
        const headingId = group.props['aria-labelledby'] as string | undefined;
        const label = headingId
          ? group
              .findAllByType('span')
              .find((span) => span.props.id === headingId)
              ?.children.join('')
          : undefined;
        const items = group.findAllByType('button').map((button) => {
          const text = button
            .findAllByType('span')
            .map((span) => span.children.join(''))
            .join('');
          return (button.props['aria-label'] as string | undefined) ?? text;
        });
        return { label, items };
      });
    return { kinds, groups };
  };

  it('orders groups with Copy & Fork / Copy and Details headings and dividers strictly between groups', async () => {
    recentEmojiMocks.recent = [{ unicode: '👍', label: 'thumbs up' }];
    messageSender = '@bob:example.org';
    const renderer = await renderCustom(aiRunContent, {
      canDelete: true,
      canPinEvent: true,
      canSendReaction: true,
      relations: {},
      onReplyClick: vi.fn(),
      onForkClick: vi.fn(),
      onForkToRoomClick: vi.fn(),
      onReactionToggle: vi.fn(),
    });

    await openContextMenu(renderer);
    expect(inspectMenu(renderer)).toEqual({
      kinds: ['group', 'line', 'group', 'line', 'group', 'line', 'group', 'line', 'group'],
      groups: [
        { label: undefined, items: ['thumbs up', 'Add Reaction'] },
        { label: undefined, items: ['Reply', 'Reply in Thread', 'Pin Message'] },
        {
          label: 'Copy & Fork',
          items: ['Copy Text', 'Copy Link', 'Fork from here', 'Fork to room…'],
        },
        {
          label: 'Details',
          items: ['Reply details', 'View Reactions', 'Read Receipts', 'Report a bug'],
        },
        { label: undefined, items: ['Delete', 'Report Message'] },
      ],
    });

    // Clicking Add Reaction in the top quick-reactions strip opens the emoji board and closes the menu.
    const addButton = renderer.root
      .find((node) => node.type === 'div' && node.props.className === 'MessageMenuRows')
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === 'Add Reaction');
    await act(async () => {
      addButton?.props.onClick();
    });
    expect(
      renderer.root.findAll(
        (node) => node.type === 'div' && node.children.join('') === 'emoji-board'
      )
    ).toHaveLength(1);
    expect(
      renderer.root.findAll(
        (node) => node.type === 'div' && node.props.className === 'MessageMenuRows'
      )
    ).toHaveLength(0);

    // Without fork actions and with no recent emojis, Copy uses "Copy" and top falls back to Add Reaction.
    recentEmojiMocks.recent = [];
    const plain = await renderMessage(
      { msgtype: 'm.text', body: 'plain' },
      { serverActions: true }
    );
    await openContextMenu(plain.renderer);
    expect(inspectMenu(plain.renderer).groups).toEqual([
      { label: undefined, items: ['Add Reaction'] },
      { label: undefined, items: ['Reply', 'Reply in Thread', 'Pin Message'] },
      { label: 'Copy', items: ['Copy Text', 'Copy Link'] },
      { label: 'Details', items: ['Read Receipts', 'Report a bug'] },
      { label: undefined, items: ['Delete', 'Report Message'] },
    ]);
  });

  it('omits empty groups and never renders leading, trailing, or consecutive dividers', async () => {
    const prefix = await renderCustom(
      { msgtype: 'm.text', body: 'prefix' },
      { onOpenInOriginalThread: vi.fn(), onForkClick: vi.fn() }
    );
    await openContextMenu(prefix);
    expect(inspectMenu(prefix)).toEqual({
      kinds: ['group', 'line', 'group'],
      groups: [
        {
          label: 'Copy & Fork',
          items: ['Copy Text', 'Copy Link', 'Open in original thread', 'Fork from here'],
        },
        { label: 'Details', items: ['Read Receipts', 'Report a bug'] },
      ],
    });

    // canPin=false despite canPinEvent=true and no Details items omits Group 1 and Details.
    pinningMocks.canPin = false;
    bugReportMocks.canReport = false;
    const minimal = await renderCustom(
      { msgtype: 'm.text', body: 'minimal' },
      { canPinEvent: true, hideReadReceipts: true }
    );
    await openContextMenu(minimal);
    expect(inspectMenu(minimal)).toEqual({
      kinds: ['group'],
      groups: [{ label: 'Copy', items: ['Copy Text', 'Copy Link'] }],
    });
  });

  it('hides Reply in Thread from both hover toolbar and menu when canReplyInThread is false', async () => {
    const hidden = await renderCustom(
      { msgtype: 'm.text', body: 'in thread' },
      { onReplyClick: vi.fn(), canReplyInThread: false }
    );
    expect(getButtonByIcon(hidden, 'ReplyArrow')).toBeDefined();
    expect(getButtonByIcon(hidden, 'ThreadPlus')).toBeUndefined();
    await openContextMenu(hidden);
    expect(getButtonByText(hidden, 'Reply')).toBeDefined();
    expect(getButtonByText(hidden, 'Reply in Thread')).toBeUndefined();

    const shown = await renderCustom(
      { msgtype: 'm.text', body: 'in room' },
      { onReplyClick: vi.fn(), canReplyInThread: true }
    );
    expect(getButtonByIcon(shown, 'ThreadPlus')).toBeDefined();
    await openContextMenu(shown);
    expect(getButtonByText(shown, 'Reply in Thread')).toBeDefined();
  });
});

describe('Message hover toolbar copy and RunStatsIcon order', () => {
  it('places RunStatsIcon (with separator) then Copy Text before reaction/reply/more actions', async () => {
    const { renderer } = await renderMessage(aiRunContent, {
      collapse: false,
      serverActions: true,
    });

    const toolbarRow = renderer.root.findByProps({ className: 'MessageOptionsRow' });
    const toolbarLabels = toolbarRow
      .findAllByType('button')
      .map((node) => node.props['aria-label'])
      .filter((label): label is string => typeof label === 'string');

    expect(toolbarLabels).toEqual([
      'Reply details',
      'Copy Text',
      'Add Reaction',
      'Reply',
      'Reply in Thread',
      'More Options',
    ]);
    expect(
      renderer.root.findAll(
        (node) => node.type === 'span' && node.props.className === 'MessageToolbarSeparator'
      )
    ).toHaveLength(1);
  });

  it('copies text synchronously from the hover toolbar and flashes Check feedback', async () => {
    vi.useFakeTimers();
    try {
      const { renderer } = await renderMessage({ msgtype: 'm.text', body: 'Quick copy me' });
      const copyButton = getButtonByAriaLabel(renderer, 'Copy Text');
      expect(copyButton).toBeDefined();

      await act(async () => {
        copyButton?.props.onClick();
        await Promise.resolve();
      });

      expect(domMocks.copyToClipboard).toHaveBeenCalledWith('Quick copy me');
      expect(getButtonByAriaLabel(renderer, 'Copied')).toBeDefined();
      expect(getButtonByIcon(renderer, 'Check')).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(1200);
      });
      expect(getButtonByAriaLabel(renderer, 'Copy Text')).toBeDefined();
      expect(getButtonByIcon(renderer, 'CopyIconSrc')).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('never fetches uncached long-text sidecars on hover, and hydrates on click to copy full text', async () => {
    const longTextSource = {
      previewContent: {
        msgtype: 'm.file',
        body: 'Truncated preview…',
        url: 'mxc://mindroom/overflow',
        'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      },
      mxcUri: 'mxc://mindroom/overflow',
      isV2ContentJson: true,
    };
    longTextMocks.getMindroomLongTextSource.mockReturnValue(longTextSource);
    longTextMocks.hydrateCachedLongText.mockResolvedValue({
      msgtype: 'm.text',
      body: 'Full hydrated body from sidecar',
    });

    const { renderer } = await renderMessage(longTextSource.previewContent);

    // Mere hover renders the Copy Text button without fetching the sidecar.
    expect(getButtonByAriaLabel(renderer, 'Copy Text')).toBeDefined();
    expect(longTextMocks.hydrateCachedLongText).not.toHaveBeenCalled();
    expect(longTextMocks.useMindroomLongTextResolvedContent).toHaveBeenCalledWith(
      longTextSource,
      false
    );

    await act(async () => {
      getButtonByAriaLabel(renderer, 'Copy Text')?.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(longTextMocks.hydrateCachedLongText).toHaveBeenCalledTimes(1);
    expect(domMocks.copyToClipboard).toHaveBeenCalledWith('Full hydrated body from sidecar');
  });

  it('copies cached long-text synchronously from the hover toolbar without re-fetching', async () => {
    const longTextSource = {
      previewContent: {
        msgtype: 'm.file',
        body: 'Truncated preview…',
        url: 'mxc://mindroom/overflow-cached',
        'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      },
      mxcUri: 'mxc://mindroom/overflow-cached',
      isV2ContentJson: true,
    };
    longTextMocks.getMindroomLongTextSource.mockReturnValue(longTextSource);
    longTextMocks.getCachedLongTextContent.mockReturnValue({
      msgtype: 'm.text',
      body: 'Already cached long text',
    });

    const { renderer } = await renderMessage(longTextSource.previewContent);

    await act(async () => {
      getButtonByAriaLabel(renderer, 'Copy Text')?.props.onClick();
      await Promise.resolve();
    });

    expect(longTextMocks.hydrateCachedLongText).not.toHaveBeenCalled();
    expect(domMocks.copyToClipboard).toHaveBeenCalledWith('Already cached long text');
  });

  it('applies layout-specific resting toolbar anchor classes and Modern collapsed hover timestamp', async () => {
    const Message = await getMessageComponent();
    const renderLayout = async (messageLayout: MessageLayout, collapse: boolean) => {
      let renderer!: ReactTestRenderer;
      await act(async () => {
        renderer = create(
          React.createElement(
            Message,
            {
              room: createRoom(),
              mEvent: createMessageEvent({ msgtype: 'm.text', body: 'layout check' }),
              collapse,
              highlight: false,
              messageLayout,
              messageSpacing: '400',
              onReplyClick: vi.fn(),
            },
            React.createElement('div', null, 'body')
          )
        );
      });
      const toolbarBase = renderer.root.find(
        (node) =>
          node.type === 'div' &&
          typeof node.props.className === 'string' &&
          node.props.className.split(' ').includes('MessageOptionsBase')
      );
      const collapsedTimes = renderer.root.findAll(
        (node) => node.type === 'div' && node.props.className === 'CollapsedTime'
      );
      return { className: toolbarBase.props.className as string, collapsedTimes };
    };

    const modernHeadered = await renderLayout(MessageLayout.Modern, false);
    expect(modernHeadered.className).toBe('MessageOptionsBase');
    expect(modernHeadered.collapsedTimes).toHaveLength(0);

    const modernCollapsed = await renderLayout(MessageLayout.Modern, true);
    expect(modernCollapsed.className).toBe('MessageOptionsBase MessageOptionsBaseCollapsed');
    expect(modernCollapsed.collapsedTimes).toHaveLength(1);

    const bubbleHeadered = await renderLayout(MessageLayout.Bubble, false);
    expect(bubbleHeadered.className).toBe('MessageOptionsBase MessageOptionsBaseAbove');
    expect(bubbleHeadered.collapsedTimes).toHaveLength(0);

    const bubbleCollapsed = await renderLayout(MessageLayout.Bubble, true);
    expect(bubbleCollapsed.className).toBe('MessageOptionsBase MessageOptionsBaseAbove');
    expect(bubbleCollapsed.collapsedTimes).toHaveLength(0);

    const compactRow = await renderLayout(MessageLayout.Compact, false);
    expect(compactRow.className).toBe('MessageOptionsBase MessageOptionsBaseAbove');
    expect(compactRow.collapsedTimes).toHaveLength(0);
  });

  it('starts copyTextPromiseToClipboard synchronously on click for uncached long text', async () => {
    const longTextSource = {
      previewContent: {
        msgtype: 'm.file',
        body: 'Truncated preview…',
        url: 'mxc://mindroom/overflow-webkit',
        'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      },
      mxcUri: 'mxc://mindroom/overflow-webkit',
      isV2ContentJson: true,
    };
    let resolveHydration!: (value: Record<string, unknown>) => void;
    longTextMocks.getMindroomLongTextSource.mockReturnValue(longTextSource);
    longTextMocks.hydrateCachedLongText.mockReturnValue(
      new Promise<Record<string, unknown>>((resolve) => {
        resolveHydration = resolve;
      })
    );

    const { renderer } = await renderMessage(longTextSource.previewContent);

    act(() => {
      getButtonByAriaLabel(renderer, 'Copy Text')?.props.onClick();
    });

    // Shared async clipboard helper starts synchronously inside the click gesture before hydration settles.
    expect(domMocks.copyTextPromiseToClipboard).toHaveBeenCalledTimes(1);
    expect(domMocks.copyToClipboard).not.toHaveBeenCalled();
    expect(getButtonByAriaLabel(renderer, 'Copied')).toBeUndefined();

    await act(async () => {
      resolveHydration({ msgtype: 'm.text', body: 'Hydrated WebKit full body' });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(domMocks.copyToClipboard).toHaveBeenCalledWith('Hydrated WebKit full body');
    expect(getButtonByAriaLabel(renderer, 'Copied')).toBeDefined();
    expect(getButtonByIcon(renderer, 'Check')).toBeDefined();
  });

  it('ignores menu preview fallback state and rejects hydration fallback without flashing Copied', async () => {
    const longTextSource = {
      previewContent: {
        msgtype: 'm.file',
        body: 'Truncated preview…',
        url: 'mxc://mindroom/overflow-fail',
        'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      },
      mxcUri: 'mxc://mindroom/overflow-fail',
      isV2ContentJson: true,
    };
    longTextMocks.getMindroomLongTextSource.mockReturnValue(longTextSource);
    // Simulate an earlier menu hydration failure leaving previewContent in resolvedLongTextContent
    // while getCachedLongTextContent remains undefined.
    longTextMocks.useMindroomLongTextResolvedContent.mockReturnValue(longTextSource.previewContent);
    longTextMocks.getCachedLongTextContent.mockReturnValue(undefined);
    longTextMocks.hydrateCachedLongText.mockResolvedValue(longTextSource.previewContent);

    const { renderer } = await renderMessage(longTextSource.previewContent);

    await act(async () => {
      getButtonByAriaLabel(renderer, 'Copy Text')?.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(longTextMocks.hydrateCachedLongText).toHaveBeenCalledTimes(1);
    expect(domMocks.copyTextPromiseToClipboard).toHaveBeenCalledTimes(1);
    await expect(domMocks.copyTextPromiseToClipboard.mock.calls[0]![0]).rejects.toThrow();
    expect(domMocks.copyToClipboard).not.toHaveBeenCalled();
    expect(getButtonByAriaLabel(renderer, 'Copied')).toBeUndefined();
    expect(getButtonByIcon(renderer, 'Check')).toBeUndefined();
    expect(getButtonByAriaLabel(renderer, 'Copy Text')).toBeDefined();

    // Once hydration succeeds on a retry, the full text copies and Check flashes.
    longTextMocks.hydrateCachedLongText.mockResolvedValueOnce({
      msgtype: 'm.text',
      body: 'Recovered full body',
    });
    await act(async () => {
      getButtonByAriaLabel(renderer, 'Copy Text')?.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(domMocks.copyToClipboard).toHaveBeenCalledWith('Recovered full body');
    expect(getButtonByAriaLabel(renderer, 'Copied')).toBeDefined();
    expect(getButtonByIcon(renderer, 'Check')).toBeDefined();
  });
});
