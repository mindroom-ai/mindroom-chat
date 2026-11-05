import { type ComponentProps, Suspense, useEffect } from 'react';
import { Box } from 'folds';
import { lazyPart } from '../../lib/lazyPart';
import type { EmojiBoard as EmojiBoardComponent } from './EmojiBoard';
import * as css from './components/styles.css';

type BoardProps = ComponentProps<typeof EmojiBoardComponent>;

/** Without its chunk (offline before a board ever opened) the board closes; the next open loads it. */
function BoardUnavailable({ requestClose }: BoardProps) {
  useEffect(() => requestClose(), [requestClose]);
  return null;
}

// The board comes with the Emojibase data (about 850 kB), so it loads when a board first opens.
const Board = lazyPart(
  () => import('./EmojiBoard').then(({ EmojiBoard }) => ({ default: EmojiBoard })),
  BoardUnavailable
);

/** The emoji and sticker picker; an empty board of its size holds its place while it loads. */
export function EmojiBoard(props: BoardProps) {
  return (
    <Suspense fallback={<Box className={css.Base} aria-busy />}>
      <Board {...props} />
    </Suspense>
  );
}
