import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, expect, it, vi } from 'vitest';
import { clearFetchedAvatars } from '../../avatars/avatarMedia';
import { Reaction, ReactionTooltipMsg } from './Reaction';

vi.mock('./Reaction.css', () => ({
  Reaction: 'Reaction',
  ReactionText: 'ReactionText',
  ReactionImg: 'ReactionImg',
}));
vi.mock('../../emoji/emojiData', () => ({ useEmojiData: () => undefined }));

// An annotation's key is any text its sender chose; applied, the override would show this one as
// `ok very`.
const KEY = 'ok\u202eyrev\u202c';
const KEY_SHOWN = 'ok<U+202E>yrev<U+202C>';
const CONTROL = /[\u202a-\u202e]/;

const text = (renderer: ReactTestRenderer): string => JSON.stringify(renderer.toJSON());

it('shows the direction controls of a reaction key as code points, on its chip and in its tooltip', () => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: '@reader:example.org' });
  const room = new Room('!room:example.org', mx, '@reader:example.org');
  const reaction = new MatrixEvent({
    type: 'm.reaction',
    sender: '@member:example.org',
    room_id: room.roomId,
    content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: '$target', key: KEY } },
  });

  let chip!: ReactTestRenderer;
  let tooltip!: ReactTestRenderer;
  act(() => {
    chip = create(<Reaction mx={mx} reaction={KEY} count={1} />);
    tooltip = create(<ReactionTooltipMsg room={room} reaction={KEY} events={[reaction]} />);
  });

  expect(text(chip)).toContain(KEY_SHOWN);
  expect(text(chip)).not.toMatch(CONTROL);
  expect(text(tooltip)).toContain(KEY_SHOWN);
  expect(text(tooltip)).not.toMatch(CONTROL);
  act(() => {
    chip.unmount();
    tooltip.unmount();
  });
});

afterEach(() => {
  void clearFetchedAvatars();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('fetches custom emoji reactions with Authorization Bearer on Capacitor using explicit mx prop', async () => {
  vi.stubGlobal('window', { location: { protocol: 'capacitor:' } });
  vi.stubGlobal('navigator', {});
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) => new Response(new Blob(['png']), { status: 200 })
  );
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:reaction-1');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  const mx = createClient({
    baseUrl: 'https://example.org',
    userId: '@reader:example.org',
    accessToken: 'cap-token',
  });
  let chip!: ReactTestRenderer;
  act(() => {
    chip = create(
      <Reaction mx={mx} reaction="mxc://example.org/parrot" count={2} useAuthentication />
    );
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe(
    'https://example.org/_matrix/client/v1/media/download/example.org/parrot?allow_redirect=true'
  );
  expect(url).not.toContain('access_token');
  expect(init).toEqual({ headers: { Authorization: 'Bearer cap-token' } });
  expect(chip.root.findByType('img').props.src).toBe('blob:reaction-1');
  act(() => chip.unmount());
});
