import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The room's box sets the overview inset, and the containers of its rows and cards hold it at a
// constant (`overviewInsetStop`), so a change of the filter bar's height does not restyle every
// row. Before adding a file to READERS, check that what it renders with the inset is not inside
// the Compact card list (CompactRoomView's content box) or the room's virtual inner list
// (RoomTimeline's `virtualInnerRef`): there it would read the constant, not the inset.
const READERS = [
  'src/app/threads/overview/CompactRoomView.css.ts',
  'src/app/threads/overview/CompactRoomView.tsx',
  'src/app/timeline/RoomTimeline.tsx',
  'src/app/timeline/RoomTimelineOverlays.tsx',
  'src/app/timeline/TimelineMinimap.css.ts',
  'src/app/timeline/roomTimelineUnread.tsx',
  'src/app/ui/styles/RoomOverlay.css.ts',
];

const INSET =
  /\b(?:overviewInset|topInset|controlsTopInset|overviewInsetStop)\b|--room-overview-height/;

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(file);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [file] : [];
  });

describe('readers of the room overview inset', () => {
  it('are the files checked to render outside the rows and cards', () => {
    const root = path.resolve(__dirname, '../../../..');
    const readers = sources(path.join(root, 'src/app'))
      .filter((file) => INSET.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file).split(path.sep).join('/'))
      .sort();
    expect(readers).toEqual(READERS);
  });
});
