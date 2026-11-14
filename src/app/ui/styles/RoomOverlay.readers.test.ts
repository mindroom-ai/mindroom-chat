import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_ROOT, REPO_ROOT, readSource, walkProductionSources } from '../../../test/architecture';

// The room's box sets the overview inset, and the containers of its rows and cards hold it at a
// constant (`overviewInsetStop`), so a change of the filter bar's height does not restyle every
// row. The files below name the inset or a class built on it. Before adding a file to READERS,
// check that what it renders with the inset is not inside the Compact card list
// (CompactRoomView's content box) or the room's virtual inner list (RoomTimeline's
// `virtualInnerRef`): there it would read the constant, not the inset.
const READERS = [
  'src/app/shell/layout/floatingCardsLayout.css.ts',
  'src/app/threads/overview/CompactRoomView.css.ts',
  'src/app/threads/overview/CompactRoomView.tsx',
  'src/app/timeline/RoomTimeline.tsx',
  'src/app/timeline/RoomTimelineOverlays.tsx',
  'src/app/timeline/TimelineMinimap.css.ts',
  'src/app/timeline/TimelineMinimap.tsx',
  'src/app/timeline/roomTimelineUnread.tsx',
  'src/app/ui/styles/RoomOverlay.css.ts',
];

// The inset by name, and the classes built on it: RoomOverlay.css's Scroll and Scrollbar (by the
// `overlay` namespace or a named import) and the minimap's container.
const INSET = new RegExp(
  [
    String.raw`\b(?:overviewInset|topInset|controlsTopInset|overviewInsetStop|MinimapContainer)\b`,
    '--room-overview-height',
    String.raw`\boverlay\.Scroll(?:bar)?\b`,
    String.raw`import \{[^}]*\bScroll(?:bar)?\b[^}]*\} from '[^']*RoomOverlay\.css'`,
  ].join('|')
);

describe('readers of the room overview inset', () => {
  it('are the files checked to render outside the rows and cards', () => {
    const readers = walkProductionSources(APP_ROOT)
      .filter((file) => INSET.test(readSource(file)))
      .map((file) => relative(REPO_ROOT, file).replace(/\\/g, '/'))
      .sort();
    expect(readers).toEqual(READERS);
  });
});
