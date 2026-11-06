import { type ReactNode } from 'react';
import { config, toRem } from 'folds';
import { MESSAGE_AVATAR_WIDTH_PX, MESSAGE_LAYOUT_GAP_SPACE_KEY } from './config';

type MessageAsideProps = {
  /** Row data attributes and the like, passed to the wrapper. */
  [attribute: `data-${string}`]: string | undefined;
  /** A row of its own, such as a summary marker: a little space above and below it. */
  spaced?: boolean;
  /** Under the reader's own bubble, which sits on the end side: lined up with its end instead. */
  end?: boolean;
  children: ReactNode;
};

/**
 * Something that belongs to the message above it but is not part of it, such as a thread's reply
 * chip or an "AI titled this thread" marker: lined up with the message bodies, past the avatar
 * column. Inline styles, so the timeline tests can render it without the stylesheet build.
 */
export function MessageAside({
  spaced = false,
  end = false,
  children,
  ...attributes
}: MessageAsideProps) {
  const pastAvatar = `calc(${config.space.S400} + ${toRem(MESSAGE_AVATAR_WIDTH_PX)} + ${
    config.space[MESSAGE_LAYOUT_GAP_SPACE_KEY]
  })`;
  return (
    <div
      {...attributes}
      style={{
        paddingBlock: spaced ? config.space.S100 : undefined,
        paddingInlineStart: end ? config.space.S400 : pastAvatar,
        paddingInlineEnd: end ? pastAvatar : config.space.S400,
        ...(end && { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }),
      }}
    >
      {children}
    </div>
  );
}
