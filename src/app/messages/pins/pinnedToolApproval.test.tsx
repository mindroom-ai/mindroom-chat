import React from 'react';
import { MatrixEvent } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MINDROOM_TOOL_APPROVAL_EVENT } from '../../matrix/protocol/toolApproval';
import { renderPinnedToolApprovalEvent } from './pinnedToolApproval';

vi.mock('../content/RenderMessageContent', () => ({
  RenderMessageContent: (props: Record<string, unknown>) =>
    React.createElement('message-content', props),
}));

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

const options = {
  roomId: '!room:example.org',
  displayName: 'MindRoom',
  mediaAutoLoad: true,
  urlPreview: false,
  htmlReactParserOptions: {},
  linkifyOpts: {},
};

const renderPinned = (event: MatrixEvent, eventId?: string) => {
  act(() => {
    renderer = create(<>{renderPinnedToolApprovalEvent(event, { ...options, eventId })}</>);
  });
  return renderer!.root.findByType('message-content' as never).props;
};

describe('pinned tool approvals', () => {
  it('render the card with the room, event and thread it answers in', () => {
    const event = new MatrixEvent({
      event_id: '$approval',
      type: MINDROOM_TOOL_APPROVAL_EVENT,
      room_id: options.roomId,
      sender: '@mindroom_agent:example.org',
      content: { 'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' } },
    });

    expect(renderPinned(event)).toMatchObject({
      roomId: '!room:example.org',
      eventId: '$approval',
      threadId: '$thread',
    });
  });

  it('keep the event ID the pin menu resolved', () => {
    const event = new MatrixEvent({
      event_id: '$approval',
      type: MINDROOM_TOOL_APPROVAL_EVENT,
      room_id: options.roomId,
      content: {},
    });

    expect(renderPinned(event, '$pinned')).toMatchObject({ eventId: '$pinned' });
  });
});
