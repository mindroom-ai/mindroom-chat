import { type ComponentProps, Suspense, lazy } from 'react';
import { Box } from 'folds';
import type { EmojiBoard as EmojiBoardComponent } from './EmojiBoard';
import * as css from './components/styles.css';

// The board comes with the Emojibase data (about 850 kB), so it loads when a board first opens.
const Board = lazy(() =>
  import('./EmojiBoard').then(({ EmojiBoard }) => ({ default: EmojiBoard }))
);

/** The emoji and sticker picker; an empty board of its size holds its place while it loads. */
export function EmojiBoard(props: ComponentProps<typeof EmojiBoardComponent>) {
  return (
    <Suspense fallback={<Box className={css.Base} aria-busy />}>
      <Board {...props} />
    </Suspense>
  );
}
