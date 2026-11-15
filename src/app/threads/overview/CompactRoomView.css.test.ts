import { expect, it } from 'vitest';
import { offscreenCardSkip } from './CompactRoomView.css';

it('skips off-screen cards only where the browser anchors the scroll position', () => {
  // A card not drawn yet takes its real height when it first draws; without scroll anchoring the
  // cards in view would move, so the rule lives only inside this query and nowhere outside it.
  expect(offscreenCardSkip).toEqual({
    '@supports': {
      '(overflow-anchor: auto)': {
        contentVisibility: 'auto',
        containIntrinsicSize: 'auto 80px',
      },
    },
  });
});
