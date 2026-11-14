import { createRef } from 'react';
import { MatrixEvent, MatrixEventEvent, type EventTimelineSet, type Room } from 'matrix-js-sdk';
import { createEditor } from 'slate';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { create, makeEvent, makeRoom } from '../test-utils/RoomTimeline.test.shared';
import { MessageLayout, type MessageSpacing } from '../../preferences/settings';
import { RenderMessageContent } from '../../messages/content/RenderMessageContent';
import { MINDROOM_TOOL_APPROVAL_EVENT } from '../../matrix/protocol/toolApproval';
import { MessageEvent } from '../../matrix/types/room';
import { defined } from '../../../test/utils/defined';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

const reactionMocks = vi.hoisted(() => ({ toggleReaction: vi.fn(async () => undefined) }));
vi.mock('../../messages/reactions/reactionToggle', () => ({ toggleReaction: reactionMocks.toggleReaction }));

const emptyData = () => ({
  threadRecordMap: new Map(),
  threadEventMap: new Map(),
  handleOpenReply: vi.fn(),
  approvalTimeline: {
    hiddenEventIds: new Set<string>(),
    historyByResponseId: new Map(),
    fallbackGroupsByEventId: new Map(),
  },
  threadSummaryTimeline: {
    hiddenEventIds: new Set<string>(),
    markersByEventId: new Map(),
  },
});

/** Renders one row; `content()` gives the props its message content received last. */
const renderRow = async (event: MatrixEvent, threadId?: string) => {
  const { useTimelineMessageFeature } = await import('./useTimelineMessageFeature');
  const room = makeRoom({ liveEvents: [] }) as unknown as Room;
  const editor = createEditor();
  const scrollRef = createRef<HTMLDivElement>();
  const data = emptyData() as never;
  const row = {
    eventId: event.getId()!,
    event,
    index: 0,
    timelineSet: {} as EventTimelineSet,
    collapse: false,
    highlighted: false,
  };
  function Harness() {
    const feature = useTimelineMessageFeature({
      room,
      editor,
      threadId,
      scrollRef,
      showThreadRepliesInRoom: false,
      messageLayout: MessageLayout.Compact,
      messageSpacing: '400' as MessageSpacing,
      hideActivity: false,
    });
    return feature.wrapExpansion(<>{feature.renderEvent(row, data)}</>);
  }
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Harness />);
  });
  return {
    renderer,
    content: () =>
      defined(
        renderer.root.findAll(
          (node) => node.type === RenderMessageContent && typeof node.props.msgType === 'string'
        )[0],
        'the rendered message content'
      ).props,
  };
};

const renderApproval = async (event: MatrixEvent, threadId?: string) =>
  (await renderRow(event, threadId)).content();

importBeforeTests(() => import('./useTimelineMessageFeature'));

describe('timeline approval cards', () => {
  it('get the room and the thread of a reply shown in the room timeline', async () => {
    const event = makeEvent('$approval', {
      type: MINDROOM_TOOL_APPROVAL_EVENT,
      threadRootId: '$thread',
    }) as unknown as MatrixEvent;

    expect(await renderApproval(event)).toMatchObject({
      roomId: '!room:example.org',
      eventId: '$approval',
      threadId: '$thread',
    });
  });

  it('get the open thread inside a thread', async () => {
    const event = makeEvent('$approval', {
      type: MINDROOM_TOOL_APPROVAL_EVENT,
    }) as unknown as MatrixEvent;

    expect(await renderApproval(event, '$root')).toMatchObject({
      roomId: '!room:example.org',
      threadId: '$root',
    });
  });

  it('get the original approval content with its latest edit as the new content', async () => {
    const event = makeEvent('$approval', {
      type: MINDROOM_TOOL_APPROVAL_EVENT,
      content: { approval_id: 'approval-1', status: 'pending' },
    }) as unknown as MatrixEvent & { __editedEvent?: unknown };
    event.__editedEvent = makeEvent('$edit', {
      type: MINDROOM_TOOL_APPROVAL_EVENT,
      content: { 'm.new_content': { approval_id: 'approval-1', status: 'approved' } },
    });

    expect((await renderApproval(event)).getContent()).toEqual({
      approval_id: 'approval-1',
      status: 'pending',
      'm.new_content': { approval_id: 'approval-1', status: 'approved' },
    });
  });
});

describe('timeline message extras', () => {
  // The renderer draws `com.mindroom.message_extras` only when asked (its own tests cover the
  // drawing); timeline rows always ask.
  it('are drawn under every timeline message', async () => {
    const event = makeEvent('$extras', {
      sender: '@mindroom_agent:example.org',
      content: {
        msgtype: 'm.text',
        body: 'Moved the thread.',
        'com.mindroom.message_extras': {
          version: 1,
          sections: [{ title: 'Tool output', content_type: 'text/plain', content: 'moved 3' }],
        },
      },
    }) as unknown as MatrixEvent;

    const { content } = await renderRow(event);

    expect(content().showMessageExtras).toBe(true);
  });
});

describe('timeline reactions', () => {
  it('tell the user under the message when changing their reaction failed', async () => {
    vi.useFakeTimers();
    try {
      reactionMocks.toggleReaction.mockRejectedValueOnce(new Error('M_FORBIDDEN'));
      const event = makeEvent('$liked', {
        content: { msgtype: 'm.text', body: 'Lunch?' },
      }) as unknown as MatrixEvent;
      const { renderer } = await renderRow(event);
      const message = () =>
        renderer.root.find(
          (node) =>
            node.props.eventId === '$liked' && typeof node.props.onReactionToggle === 'function'
        );
      // The row's reaction slot, which the real message draws under its body.
      const alerts = () => {
        const slot = create(<>{message().props.reactions}</>);
        const found = slot.root.findAll((node) => node.props.role === 'alert');
        return found.map((node) => JSON.stringify(node.children));
      };

      await act(async () => {
        message().props.onReactionToggle('👍');
      });

      expect(reactionMocks.toggleReaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ targetEventId: '$liked', key: '👍' })
      );
      expect(alerts()).toEqual([expect.stringContaining("Couldn't change your reaction")]);

      act(() => {
        vi.advanceTimersByTime(6000);
      });
      expect(alerts()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

const decrypted = (event: MatrixEvent, content: Record<string, unknown>) =>
  event.attemptDecryption({
    decryptEvent: async () => ({ clearEvent: { type: MessageEvent.RoomMessage, content } }),
  } as unknown as Parameters<MatrixEvent['attemptDecryption']>[0]);

describe('timeline rows of an encrypted room', () => {
  it('repaint when a decrypted edit replaces the content, and unsubscribe on unmount', async () => {
    const encrypted = (eventId: string) =>
      new MatrixEvent({
        event_id: eventId,
        type: MessageEvent.RoomMessageEncrypted,
        room_id: '!room:example.org',
        sender: '@mindroom_agent:example.org',
        content: {},
      });
    const reply = encrypted('$reply');
    await act(async () => {
      await decrypted(reply, { msgtype: 'm.text', body: 'Thinking' });
    });
    const { renderer, content } = await renderRow(reply);
    expect(content().edited).toBe(false);
    expect(reply.listenerCount(MatrixEventEvent.Replaced)).toBe(1);

    const edit = encrypted('$edit');
    await decrypted(edit, {
      msgtype: 'm.text',
      body: '* Done',
      'm.new_content': { msgtype: 'm.text', body: 'Done' },
      'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
    });
    act(() => reply.makeReplaced(edit));

    expect(content().edited).toBe(true);
    act(() => renderer.unmount());
    expect(reply.listenerCount(MatrixEventEvent.Replaced)).toBe(0);
  });
});
