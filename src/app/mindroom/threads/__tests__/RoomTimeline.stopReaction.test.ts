import React from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { Relations } from 'matrix-js-sdk/lib/models/relations';
import { act } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { MessageEvent } from '../../../../types/matrix/room';
import { MINDROOM_TOOL_APPROVAL_EVENT } from '../../messages/toolApproval';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  getEventReactionsMock,
  makeEvent,
  makeRoom,
} from '../test-utils/RoomTimeline.test.shared';

const makeReactionEvent = (): MatrixEvent =>
  ({
    getSender: () => '@agent:mindroom.chat',
    getRelation: () => ({ rel_type: 'm.annotation' }),
    isRedacted: () => false,
  } as MatrixEvent);

const makeRelations = (keys: string[]): Relations =>
  ({
    getSortedAnnotationsByKey: () =>
      keys.map((key) => [key, new Set([makeReactionEvent()])] as [string, Set<MatrixEvent>]),
  } as unknown as Relations);

const approvalContent = {
  approval_id: 'approval-1',
  tool_name: 'web_search',
  arguments: { query: 'release date' },
  agent_name: 'research',
  status: 'pending',
  requested_at: '2026-04-10T12:00:00Z',
  expires_at: '2026-04-17T12:00:00Z',
  'io.mindroom.stream_status': 'completed',
};

const renderTimeline = async (events: ReturnType<typeof makeEvent>[]) => {
  const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
  const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
  let renderer: ReturnType<typeof create> | undefined;

  await act(async () => {
    renderer = create(
      React.createElement(ControlledRoomTimeline, {
        room: makeRoom({ liveEvents: events }),
        initialViewMode: 'classic',
      })
    );
    await flushAsyncWork(1);
  });

  return renderer!;
};

describe('RoomTimeline stale stop-reaction gates', () => {
  it('does not mount an empty reactions container in any message branch', async () => {
    getEventReactionsMock.mockReturnValue(makeRelations(['🛑']));
    const events = [
      makeEvent('$message', {
        type: MessageEvent.RoomMessage,
        content: { body: 'done', 'io.mindroom.stream_status': 'completed' },
      }),
      makeEvent('$approval', {
        type: MINDROOM_TOOL_APPROVAL_EVENT,
        content: approvalContent,
      }),
      makeEvent('$encrypted', {
        type: MessageEvent.RoomMessageEncrypted,
        content: { 'io.mindroom.stream_status': 'completed' },
      }),
      makeEvent('$sticker', {
        type: MessageEvent.Sticker,
        content: {
          body: 'sticker',
          url: 'mxc://mindroom.chat/sticker',
          'io.mindroom.stream_status': 'completed',
        },
      }),
    ];

    const renderer = await renderTimeline(events);

    for (const event of events) {
      const message = renderer.root.findByProps({ 'data-message-id': event.getId() });
      expect(message.props.relations, event.getId()).toBeUndefined();
      expect(message.props.reactions, event.getId()).toBeFalsy();
    }
  });

  it('keeps the reactions container when an ordinary chip remains', async () => {
    const relations = makeRelations(['🛑', '👍']);
    getEventReactionsMock.mockReturnValue(relations);

    const renderer = await renderTimeline([
      makeEvent('$mixed', {
        type: MessageEvent.RoomMessage,
        content: { body: 'done', 'io.mindroom.stream_status': 'completed' },
      }),
    ]);
    const message = renderer.root.findByProps({ 'data-message-id': '$mixed' });

    expect(message.props.relations).toBe(relations);
    expect(message.props.reactions).toBeTruthy();
  });
});
