import { type ComponentProps, Suspense } from 'react';
import { Box } from 'folds';
import FocusTrap from 'focus-trap-react';
import { type PartLoadRetry, lazyPart } from '../../lib/lazyPart';
import { PartUnavailable } from '../../ui/PartUnavailable';
import type { EmojiBoard as EmojiBoardComponent } from './EmojiBoard';
import * as css from './components/styles.css';
import { makeRetryViewTrapOptions } from './boardFocusTrap';

type BoardProps = ComponentProps<typeof EmojiBoardComponent>;

/**
 * Without its chunk (offline before a board ever opened) the board says so and offers Retry. It
 * closes as the board does: on Escape and on a click outside.
 */
function BoardUnavailable({
  requestClose,
  returnFocusOnDeactivate,
  maxHeight,
  retryLoad,
}: BoardProps & PartLoadRetry) {
  return (
    <FocusTrap focusTrapOptions={makeRetryViewTrapOptions(requestClose, returnFocusOnDeactivate)}>
      <Box className={css.Base} style={{ maxHeight }}>
        <PartUnavailable retryLoad={retryLoad} />
      </Box>
    </FocusTrap>
  );
}

// The board comes with the Emojibase data (about 850 kB), so it loads when a board first opens.
const Board = lazyPart(
  () => import('./EmojiBoard').then(({ EmojiBoard }) => ({ default: EmojiBoard })),
  BoardUnavailable
);

/** The emoji and sticker picker; an empty board of its size holds its place while it loads. */
export function EmojiBoard(props: BoardProps) {
  return (
    <Suspense
      fallback={<Box className={css.Base} style={{ maxHeight: props.maxHeight }} aria-busy />}
    >
      <Board {...props} />
    </Suspense>
  );
}
