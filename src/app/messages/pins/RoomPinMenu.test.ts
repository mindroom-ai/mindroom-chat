import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const APPROVAL_EVENT_TYPE = 'io.mindroom.tool_approval';

const {
  getEditedEventMock,
  navigateRoomMock,
  pinnedEventMock,
  renderMessageContentMock,
  roomMock,
  settingValues,
} = vi.hoisted(() => ({
  getEditedEventMock: vi.fn(() => undefined),
  navigateRoomMock: vi.fn(),
  pinnedEventMock: {
    replyEventId: undefined,
    threadRootId: undefined,
    getContent: vi.fn(() => ({
      approval_id: 'approval-1',
      tool_name: 'web_search',
      arguments: { query: 'release date' },
      agent_name: 'research',
      status: 'pending',
      requested_at: '2026-04-10T12:00:00Z',
      expires_at: '2026-04-17T12:00:00Z',
      resolved_at: null,
      resolved_by: null,
      resolution_reason: null,
    })),
    getOriginalContent() {
      return this.getContent();
    },
    getId: vi.fn(() => '$approval'),
    getSender: vi.fn(() => '@alice:example.org'),
    getTs: vi.fn(() => 0),
    getType: vi.fn(() => APPROVAL_EVENT_TYPE),
    getUnsigned: vi.fn(() => ({})),
    isRedacted: vi.fn(() => false),
    replacingEvent: vi.fn(() => undefined),
  },
  renderMessageContentMock: vi.fn(),
  roomMock: {
    roomId: '!room:example.org',
    hasEncryptionStateEvent: vi.fn(() => false),
    getTimelineForEvent: vi.fn(() => undefined),
    getUnfilteredTimelineSet: vi.fn(() => undefined),
  },
  settingValues: {} as Record<string, boolean>,
}));

vi.mock('folds', () => {
  const Box = ({
    as: Tag = 'div',
    children,
    ...props
  }: {
    as?: keyof JSX.IntrinsicElements;
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement(Tag, props, children);

  const ButtonLike = ({
    children,
    onClick,
    ...props
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => React.createElement('button', { ...props, onClick, type: 'button' }, children);

  const ForwardedDiv = React.forwardRef<
    HTMLDivElement,
    { children?: React.ReactNode; [key: string]: unknown }
  >(({ children, ...props }, ref) => React.createElement('div', { ...props, ref }, children));

  return {
    Avatar: Box,
    Box,
    Chip: ButtonLike,
    color: {
      Critical: {
        Main: 'red',
      },
    },
    config: {
      radii: {
        R300: '12px',
      },
      space: {
        S200: '8px',
        S400: '16px',
        S700: '28px',
      },
    },
    Header: Box,
    Icon: ({ src }: { src?: string }) => React.createElement('span', null, src ?? 'icon'),
    IconButton: ButtonLike,
    Icons: {
      Cross: 'Cross',
      User: 'User',
    },
    Menu: ForwardedDiv,
    Scroll: ForwardedDiv,
    Spinner: () => React.createElement('span', null, 'spinner'),
    Text: ({ as: Tag = 'span', children, ...props }: any) =>
      React.createElement(Tag, props, children),
    toRem: (value: number) => `${value}px`,
  };
});

vi.mock('../Time', () => ({
  Time: () => React.createElement('span', null, 'time'),
}));
vi.mock('../content/FallbackContent', () => ({
  MessageNotDecryptedContent: () => React.createElement('span', null, 'not-decrypted'),
  MessageUnsupportedContent: () => React.createElement('span', null, 'unsupported'),
}));
vi.mock('../../avatars/UserAvatar', () => ({
  UserAvatar: () => React.createElement('div', { 'data-renderer': 'user-avatar' }),
}));

vi.mock('../../matrix/matrix', () => ({
  getMxIdLocalPart: () => 'alice',
  mxcUrlToHttp: () => undefined,
}));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getUserId: () => '@me:example.org',
    sendStateEvent: vi.fn(),
  }),
}));

vi.mock('../../matrix/room', () => ({
  getEditedEvent: getEditedEventMock,
  getMemberAvatarMxc: vi.fn(() => undefined),
  getMemberDisplayName: vi.fn(() => 'Alice'),
  getStateEvent: vi.fn(() => undefined),
}));

vi.mock('../html/react-custom-html-parser', () => ({
  factoryRenderLinkifyWithMention: () => vi.fn(),
  getReactCustomHtmlParser: () => ({}),
  LINKIFY_OPTS: {},
  makeMentionCustomProps: () => ({}),
  renderMatrixMention: () => null,
}));

vi.mock('../content/RenderMessageContent', () => ({
  RenderMessageContent: ({
    edited,
    eventType,
    getContent,
    mEvent,
    urlPreview,
  }: {
    edited?: boolean | undefined;
    eventType?: string;
    getContent?: () => Record<string, unknown>;
    mEvent?: unknown;
    urlPreview?: boolean;
  }) => {
    renderMessageContentMock({ edited, eventType, getContent, mEvent, urlPreview });
    const content = getContent?.();
    const newContent = content?.['m.new_content'];
    const approvalStatus =
      typeof newContent === 'object' && newContent && !Array.isArray(newContent)
        ? (newContent as Record<string, unknown>).status
        : content?.status;

    return React.createElement('div', {
      'data-renderer': 'message-content',
      'data-event-type': eventType ?? '',
      'data-edited': edited ? 'true' : 'false',
      'data-approval-status': typeof approvalStatus === 'string' ? approvalStatus : '',
    });
  },
}));

vi.mock('../../preferences/useSetting', () => ({
  useSetting: (_atom: unknown, key: string) => [settingValues[key] ?? false],
}));

vi.mock('../../preferences/settings', () => ({
  settingsAtom: {},
}));

vi.mock('./RoomPinMenu.css', () => ({
  PinnedEntry: 'PinnedEntry',
  PinnedJump: 'PinnedJump',
}));

vi.mock('../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: navigateRoomMock,
  }),
}));

vi.mock('../../ui/styles/ContainerColor.css', () => ({
  ContainerColor: () => 'ContainerColor',
}));

vi.mock('../../event-store/threads/useThreadPinning', () => ({
  useThreadPinning: () => ({
    pinnedEventIds: ['$approval'],
    canPin: false,
    setPinned: vi.fn(),
    updating: false,
  }),
}));

vi.mock('../../event-store/cache/useRoomEvent', () => ({
  useRoomEvent: () => pinnedEventMock,
}));

vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

import { RoomPinMenu } from './RoomPinMenu';

describe('RoomPinMenu', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
    }

    renderer = undefined;
    getEditedEventMock.mockReset();
    getEditedEventMock.mockReturnValue(undefined);
    navigateRoomMock.mockReset();
    // Back to each mock's own implementation, without the return values a test set.
    pinnedEventMock.getContent.mockRestore();
    pinnedEventMock.getId.mockRestore();
    pinnedEventMock.getSender.mockRestore();
    pinnedEventMock.getTs.mockRestore();
    pinnedEventMock.getType.mockRestore();
    pinnedEventMock.getUnsigned.mockRestore();
    pinnedEventMock.isRedacted.mockRestore();
    pinnedEventMock.replacingEvent.mockReset();
    pinnedEventMock.replacingEvent.mockReturnValue(undefined);
    renderMessageContentMock.mockReset();
    roomMock.getTimelineForEvent.mockReset();
    roomMock.getTimelineForEvent.mockReturnValue(undefined);
    roomMock.hasEncryptionStateEvent.mockReturnValue(false);
    Object.keys(settingValues).forEach((key) => delete settingValues[key]);
  });

  it('routes pinned approval events through RenderMessageContent with the approval event type', () => {
    act(() => {
      renderer = create(
        React.createElement(RoomPinMenu, {
          room: roomMock as never,
          requestClose: vi.fn(),
        })
      );
    });

    const renderedApproval = renderer!.root.findByProps({
      'data-renderer': 'message-content',
    });

    expect(renderedApproval.props['data-event-type']).toBe(APPROVAL_EVENT_TYPE);
  });

  it('uses relation-only edits for encrypted pinned approval events', () => {
    const relationEditEvent = {
      getContent: vi.fn(() => ({
        'm.new_content': {
          status: 'denied',
          resolved_at: '2026-04-10T12:05:00Z',
          resolved_by: '@ops:example.org',
          resolution_reason: 'Missing justification',
        },
      })),
    };
    const decryptedApprovalEvent = {
      getContent: vi.fn(() => ({
        approval_id: 'approval-1',
        tool_name: 'web_search',
        arguments: { query: 'release date' },
        agent_name: 'research',
        status: 'pending',
        requested_at: '2026-04-10T12:00:00Z',
        expires_at: '2026-04-17T12:00:00Z',
        resolved_at: null,
        resolved_by: null,
        resolution_reason: null,
      })),
      getOriginalContent() {
        return this.getContent();
      },
      getId: vi.fn(() => '$approval'),
      getTs: vi.fn(() => 0),
      getType: vi.fn(() => APPROVAL_EVENT_TYPE),
      isRedacted: vi.fn(() => false),
      replacingEvent: vi.fn(() => undefined),
    };
    const timelineSet = { relations: {} };
    const eventTimeline = {
      getEvents: vi.fn(() => [decryptedApprovalEvent]),
      getTimelineSet: vi.fn(() => timelineSet),
    };

    pinnedEventMock.getType.mockReturnValue('m.room.encrypted');
    roomMock.getTimelineForEvent.mockReturnValue(eventTimeline as never);
    getEditedEventMock.mockReturnValue(relationEditEvent as never);

    act(() => {
      renderer = create(
        React.createElement(RoomPinMenu, {
          room: roomMock as never,
          requestClose: vi.fn(),
        })
      );
    });

    const renderedApproval = renderer!.root.findByProps({
      'data-renderer': 'message-content',
    });

    expect(getEditedEventMock).toHaveBeenCalledWith(
      '$approval',
      decryptedApprovalEvent,
      timelineSet
    );
    expect(renderedApproval.props['data-event-type']).toBe(APPROVAL_EVENT_TYPE);
    expect(renderedApproval.props['data-approval-status']).toBe('denied');
    expect(renderedApproval.props['data-edited']).toBe('true');
  });

  it('passes the source event through ordinary pinned message rendering', () => {
    pinnedEventMock.getType.mockReturnValue('m.room.message');
    pinnedEventMock.getContent.mockReturnValue({
      msgtype: 'm.text',
      body: 'Pinned request',
    } as never);

    act(() => {
      renderer = create(
        React.createElement(RoomPinMenu, {
          room: roomMock as never,
          requestClose: vi.fn(),
        })
      );
    });

    expect(renderMessageContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ mEvent: pinnedEventMock })
    );
  });

  it.each([
    { encrypted: true, urlPreview: false },
    { encrypted: false, urlPreview: true },
  ])(
    'uses the encrypted-room URL preview setting when encrypted is $encrypted',
    ({ encrypted, urlPreview }) => {
      settingValues.urlPreview = true;
      settingValues.encUrlPreview = false;
      roomMock.hasEncryptionStateEvent.mockReturnValue(encrypted);
      pinnedEventMock.getType.mockReturnValue('m.room.message');
      pinnedEventMock.getContent.mockReturnValue({
        msgtype: 'm.text',
        body: 'https://example.org',
      } as never);

      act(() => {
        renderer = create(
          React.createElement(RoomPinMenu, {
            room: roomMock as never,
            requestClose: vi.fn(),
          })
        );
      });

      expect(renderMessageContentMock).toHaveBeenCalledWith(
        expect.objectContaining({ urlPreview })
      );
    }
  );

  it('passes the decrypted event through encrypted pinned message rendering', () => {
    const decryptedMessageEvent = {
      getContent: vi.fn(() => ({ msgtype: 'm.text', body: 'Pinned encrypted request' })),
      getId: vi.fn(() => '$approval'),
      getTs: vi.fn(() => 0),
      getType: vi.fn(() => 'm.room.message'),
      isRedacted: vi.fn(() => false),
      replacingEvent: vi.fn(() => undefined),
    };
    const eventTimeline = {
      getEvents: vi.fn(() => [decryptedMessageEvent]),
      getTimelineSet: vi.fn(() => ({ relations: {} })),
    };
    pinnedEventMock.getType.mockReturnValue('m.room.encrypted');
    roomMock.getTimelineForEvent.mockReturnValue(eventTimeline as never);

    act(() => {
      renderer = create(
        React.createElement(RoomPinMenu, {
          room: roomMock as never,
          requestClose: vi.fn(),
        })
      );
    });

    expect(renderMessageContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ mEvent: decryptedMessageEvent })
    );
  });
});
