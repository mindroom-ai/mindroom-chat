import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { EventStatus, MatrixError, MatrixEvent, RelationType, type Room } from 'matrix-js-sdk';
import { makeResolvedThreadRoom } from '../../test/utils/resolvedThreadRoom';
import { resetPendingThreadTagsForTests } from '../event-store/threads/threadTagPending';
import {
  buildPerTagStateKey,
  MINDROOM_THREAD_TAGS_EVENT,
  RESOLVED_TAG,
} from '../event-store/threads/threadTags';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FailedSendActions } from './FailedSendActions';

const mx = vi.hoisted(() => ({
  getUserId: () => '@alice:example.org',
  getSafeUserId: () => '@alice:example.org',
  resendEvent: vi.fn(),
  sendStateEvent: vi.fn(),
  cancelPendingEvent: vi.fn(),
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => mx,
}));

const room = { roomId: '!room:example.org' } as Room;
let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  resetPendingThreadTagsForTests();
  vi.clearAllMocks();
});

const renderActions = (error?: MatrixError) => {
  const event = new MatrixEvent({
    event_id: '~!room:example.org:txn-1',
    room_id: room.roomId,
    type: 'm.room.message',
    content: { msgtype: 'm.text', body: 'stop' },
  });
  if (error) event.error = error;
  event.setStatus(EventStatus.NOT_SENT);
  act(() => {
    renderer = create(<FailedSendActions room={room} event={event} />);
  });
  const button = (label: string) =>
    renderer!.root.find(
      (node) => node.type === 'button' && node.findAllByProps({ children: label }).length > 0
    );
  return { event, retry: button('Retry'), remove: button('Delete') };
};

describe('FailedSendActions', () => {
  it('resends the failed event in its room', async () => {
    mx.resendEvent.mockResolvedValue({ event_id: '$sent' });
    const { event, retry } = renderActions();

    await act(async () => retry.props.onClick());

    expect(mx.resendEvent).toHaveBeenCalledWith(event, room);
  });

  it('deletes the failed event', async () => {
    const { event, remove } = renderActions();

    await act(() => remove.props.onClick());

    expect(mx.cancelPendingEvent).toHaveBeenCalledWith(event);
  });

  it('ignores clicks once the event is no longer failed', () => {
    const { event, retry, remove } = renderActions();
    event.setStatus(EventStatus.SENDING);

    act(() => {
      retry.props.onClick();
      remove.props.onClick();
    });

    expect(mx.resendEvent).not.toHaveBeenCalled();
    expect(mx.cancelPendingEvent).not.toHaveBeenCalled();
  });

  it('says why the server did not take it, with its own words below', () => {
    renderActions(
      new MatrixError({ errcode: 'M_FORBIDDEN', error: 'Posting is limited in this room' }, 403)
    );
    const shown = JSON.stringify(renderer!.toJSON());
    expect(shown).toContain('Not sent');
    expect(shown).toContain("You don't have permission to do this.");
    expect(shown).toContain('M_FORBIDDEN: Posting is limited in this room');
  });

  it('names the wait a rate limit asks for', () => {
    renderActions(
      new MatrixError(
        { errcode: 'M_LIMIT_EXCEEDED', error: 'Too many requests', retry_after_ms: 120_000 },
        429
      )
    );
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      'Too many requests. Try again in 2 minutes.'
    );
  });

  it('shows only Not sent when no reason is known, as after a reload', () => {
    renderActions();
    const shown = JSON.stringify(renderer!.toJSON());
    expect(shown).toContain('Not sent');
    expect(shown).not.toContain('permission');
  });

  it('reopens a resolved thread when retrying a failed thread reply succeeds, and skips on failure or edit', async () => {
    const { room: resolvedRoom } = makeResolvedThreadRoom();
    const renderReply = (relation: Record<string, unknown>) => {
      const event = new MatrixEvent({
        event_id: '~!room:example.org:txn-retry',
        room_id: resolvedRoom.roomId,
        type: 'm.room.message',
        content: { msgtype: 'm.text', body: 'retry', 'm.relates_to': relation },
      });
      event.setStatus(EventStatus.NOT_SENT);
      act(() => {
        renderer = create(<FailedSendActions room={resolvedRoom} event={event} />);
      });
      return renderer!.root.find(
        (node) => node.type === 'button' && node.findAllByProps({ children: 'Retry' }).length > 0
      );
    };

    mx.sendStateEvent.mockResolvedValue({ event_id: '$tag' });
    mx.resendEvent.mockRejectedValueOnce(new Error('offline'));
    const failedRetry = renderReply({ rel_type: RelationType.Thread, event_id: '$root' });
    await act(async () => failedRetry.props.onClick());
    expect(mx.sendStateEvent).not.toHaveBeenCalled();

    mx.resendEvent.mockResolvedValueOnce({ event_id: '$edit' });
    const editRetry = renderReply({ rel_type: RelationType.Replace, event_id: '$root' });
    await act(async () => editRetry.props.onClick());
    expect(mx.sendStateEvent).not.toHaveBeenCalled();

    mx.resendEvent.mockResolvedValueOnce({ event_id: '$resent' });
    const okRetry = renderReply({ rel_type: RelationType.Thread, event_id: '$root' });
    await act(async () => okRetry.props.onClick());
    expect(mx.sendStateEvent).toHaveBeenCalledWith(
      resolvedRoom.roomId,
      MINDROOM_THREAD_TAGS_EVENT,
      {},
      buildPerTagStateKey('$root', RESOLVED_TAG)
    );
  });
});
