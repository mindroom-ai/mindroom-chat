import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { EventStatus, MatrixError, MatrixEvent, type Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FailedSendActions } from './FailedSendActions';

const mx = vi.hoisted(() => ({
  resendEvent: vi.fn(),
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

  it('deletes the failed event', () => {
    const { event, remove } = renderActions();

    act(() => remove.props.onClick());

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
});
