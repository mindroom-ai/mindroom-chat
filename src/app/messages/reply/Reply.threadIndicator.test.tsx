import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Reply } from './Reply';

const mocks = vi.hoisted(() => ({
  useRoomEvent: vi.fn(),
  ThreadIndicator: vi.fn((_props: Record<string, unknown>) => null),
}));

vi.mock('../../event-store/cache/useRoomEvent', () => ({ useRoomEvent: mocks.useRoomEvent }));
vi.mock('../ThreadIndicator', () => ({ ThreadIndicator: mocks.ThreadIndicator }));

const quoted = new MatrixEvent({
  event_id: '$quoted',
  type: 'm.room.message',
  content: { msgtype: 'm.text', body: 'Quoted text' },
});
const room = { findEventById: () => quoted } as unknown as Room;

const rendered: ReactTestRenderer[] = [];

/** The thread indicators of a reply to `$quoted`. */
const renderIndicators = (props: {
  threadRootId?: string;
  hideThreadIndicator?: boolean;
  onThreadClick?: () => void;
}) => {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(<Reply room={room} replyEventId="$quoted" {...props} />);
  });
  if (!renderer) throw new Error('Reply failed to render');
  rendered.push(renderer);
  return renderer.root.findAllByType(mocks.ThreadIndicator);
};

describe('Reply thread indicator', () => {
  afterEach(() => {
    act(() => rendered.splice(0).forEach((renderer) => renderer.unmount()));
    mocks.useRoomEvent.mockReset();
    mocks.ThreadIndicator.mockClear();
  });

  it('loads the quoted event from its thread and offers a button that opens the thread', () => {
    mocks.useRoomEvent.mockReturnValue(quoted);
    const onThreadClick = vi.fn();

    const indicators = renderIndicators({ threadRootId: '$root', onThreadClick });

    expect(mocks.useRoomEvent).toHaveBeenCalledWith(room, '$quoted', expect.any(Function), {
      threadId: '$root',
    });
    expect(indicators).toHaveLength(1);
    expect(indicators[0]?.props).toMatchObject({
      as: 'button',
      room,
      threadRootId: '$root',
      'data-thread-root-id': '$root',
      'data-event-id': '$root',
      onClick: onThreadClick,
    });
  });

  it('shows no indicator without a thread root or when the reply is inside that thread', () => {
    mocks.useRoomEvent.mockReturnValue(quoted);

    expect(renderIndicators({})).toHaveLength(0);
    expect(mocks.useRoomEvent).toHaveBeenLastCalledWith(room, '$quoted', expect.any(Function), {
      threadId: undefined,
    });
    expect(renderIndicators({ threadRootId: '$root', hideThreadIndicator: true })).toHaveLength(0);
  });
});
