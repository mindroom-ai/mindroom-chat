import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { ImageUsage } from '../../emoji/custom/types';
import { ImagePack } from '../../emoji/custom/ImagePack';
import { MessageQuickReactions } from './MessageReactionActions';

const imagePacks = vi.hoisted(() => ({ useRelevantImagePacks: vi.fn() }));
const mx = vi.hoisted(() => ({
  getAccountData: vi.fn(),
  getHomeserverUrl: () => 'https://example.org',
  mxcUrlToHttp: vi.fn(
    () => 'https://example.org/_matrix/client/v1/media/download/example.org/parrot'
  ),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../../emoji/useImagePacks', () => imagePacks);
vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => true }));
vi.mock('../styles.css', () => ({
  MessageQuickReaction: 'quick-reaction',
}));
vi.mock('./ReactionViewer', () => ({ ReactionViewer: () => null }));

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.clearAllMocks();
});

it('offers a recent custom emoji as its image and reacts with its mxc URL', () => {
  mx.getAccountData.mockReturnValue(
    new MatrixEvent({
      type: 'io.element.recent_emoji',
      content: {
        recent_emoji: [
          ['mxc://example.org/parrot', 2],
          ['😀', 1],
        ],
      },
    })
  );
  imagePacks.useRelevantImagePacks.mockReturnValue([
    new ImagePack(
      '@alice:example.org',
      { images: { 'party-parrot': { url: 'mxc://example.org/parrot' } } },
      undefined
    ),
  ]);
  const rooms = [{ roomId: '!room:example.org' }] as unknown as Room[];
  const onReaction = vi.fn();

  act(() => {
    renderer = create(<MessageQuickReactions imagePackRooms={rooms} onReaction={onReaction} />);
  });

  expect(imagePacks.useRelevantImagePacks).toHaveBeenCalledWith(ImageUsage.Emoticon, rooms);
  const [custom, unicode] = renderer!.root.findAllByType('button');
  expect(custom!.props['aria-label']).toBe('party-parrot');
  expect(renderer!.root.findAllByProps({ label: 'party-parrot' })).not.toHaveLength(0);
  const image = custom!.findByType('img');
  expect(image.props.alt).toBe('party-parrot');
  expect(image.props.src).toBe(
    'https://example.org/_matrix/client/v1/media/download/example.org/parrot'
  );
  // The authenticated media URL.
  expect(mx.mxcUrlToHttp).toHaveBeenCalledWith(
    'mxc://example.org/parrot',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true
  );
  expect(unicode!.findAllByProps({ children: '😀' })).not.toHaveLength(0);

  act(() => custom!.props.onClick());

  expect(onReaction).toHaveBeenCalledWith('mxc://example.org/parrot', 'party-parrot');
});
