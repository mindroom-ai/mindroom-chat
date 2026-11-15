import { expect, it } from 'vitest';
import { offscreenCardSkip, View } from './CompactRoomView.css';

it('skips off-screen cards only where the browser anchors scrolling, and not while restoring', () => {
  // A card not drawn yet takes its real height when it first draws; without scroll anchoring the
  // cards in view would move, so the rule lives only inside this query and nowhere outside it.
  // While the list puts its cards back (`data-restoring-place`) every card draws, and the size it
  // drew at stays remembered (`auto`) for when it skips again.
  expect(offscreenCardSkip).toEqual({
    '@supports': {
      '(overflow-anchor: auto)': {
        containIntrinsicSize: 'auto 80px',
        selectors: {
          [`${View}:not([data-restoring-place]) &`]: { contentVisibility: 'auto' },
        },
      },
    },
  });
});
