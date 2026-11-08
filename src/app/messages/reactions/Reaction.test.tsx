import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { expect, it, vi } from 'vitest';
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
