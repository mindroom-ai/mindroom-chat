import React, { type ReactNode } from 'react';
import { config, toRem } from 'folds';
import { MESSAGE_AVATAR_WIDTH_PX, MESSAGE_LAYOUT_GAP_SPACE_KEY } from './config';

type MessageAsideProps = {
  /** Row data attributes and the like, passed to the wrapper. */
  [attribute: `data-${string}`]: string | undefined;
  children: ReactNode;
};

/**
 * Something that belongs to the message above it but is not part of it, such as a thread's reply
 * chip or an "AI titled this thread" marker: lined up with the message bodies, past the avatar
 * column. Inline styles, so the timeline tests can render it without the stylesheet build.
 */
export function MessageAside({ children, ...attributes }: MessageAsideProps) {
  return (
    <div
      {...attributes}
      style={{
        paddingInlineStart: `calc(${config.space.S400} + ${toRem(MESSAGE_AVATAR_WIDTH_PX)} + ${
          config.space[MESSAGE_LAYOUT_GAP_SPACE_KEY]
        })`,
        paddingInlineEnd: config.space.S400,
      }}
    >
      {children}
    </div>
  );
}
