import React, { ReactNode } from 'react';
import classNames from 'classnames';
import { Box, Text, as } from 'folds';
import type { MessageSpacing } from '../../../state/settings';
import { MESSAGE_LAYOUT_GAP } from './config';
import * as css from './layout.css';

type MessageBaseProps = {
  space?: MessageSpacing;
  /** A follow-up from the same sender: no gap and no header. */
  collapse?: boolean;
  /** Passed for state events; adds no styling, and is kept off the DOM. */
  autoCollapse?: boolean;
  highlight?: boolean;
  selected?: boolean;
};

/** The row of one timeline event, with spacing, highlight, and selection. */
export const MessageBase = as<'div', MessageBaseProps>(
  ({ className, space, collapse, autoCollapse, highlight, selected, ...props }, ref) => (
    <div
      {...props}
      ref={ref}
      className={classNames(css.MessageBase({ space, collapse, highlight, selected }), className)}
    />
  )
);

/** The avatar slot of a message: centered in the avatar column, aligned to the first line. */
export const AvatarBase = as<'span'>(({ as: AsAvatarBase = 'span', className, ...props }, ref) => (
  <AsAvatarBase {...props} ref={ref} className={classNames(css.AvatarBase, className)} />
));

type LayoutProps = {
  before?: ReactNode;
};

/** Avatar column, then the header and body; follow-ups keep the avatar column empty. */
export const ModernLayout = as<'div', LayoutProps>(({ before, children, ...props }, ref) => (
  <Box gap={MESSAGE_LAYOUT_GAP} alignItems="Start" {...props} ref={ref}>
    <div className={css.AvatarColumn}>{before}</div>
    <div className={css.LayoutContent}>{children}</div>
  </Box>
));

/** Header and body on one dense line. */
export const CompactLayout = as<'div', LayoutProps>(({ before, children, ...props }, ref) => (
  <Box gap="200" alignItems="Baseline" {...props} ref={ref}>
    <Box shrink="No">{before}</Box>
    <div className={css.LayoutContent}>{children}</div>
  </Box>
));

/** Avatar beside a bubble holding the header and body. */
export const BubbleLayout = as<'div', LayoutProps & { header?: ReactNode }>(
  ({ before, header, children, ...props }, ref) => (
    <Box gap={MESSAGE_LAYOUT_GAP} alignItems="Start" {...props} ref={ref}>
      <div className={css.AvatarColumn}>{before}</div>
      <div className={css.LayoutContent}>
        <div className={css.BubbleContent}>
          {header}
          {children}
        </div>
      </div>
    </Box>






));

/** The bold part of a sender name. */
export const UsernameBold = as<'b'>(({ as: AsBold = 'b', ...props }, ref) => (
  <AsBold {...props} ref={ref} />
));

type MessageTextBodyProps = {
  preWrap?: boolean;
  jumboEmoji?: boolean;
  emote?: boolean;
  notice?: boolean;
};

/** Text block of a message body. */
export const MessageTextBody = as<'div', MessageTextBodyProps>(
  ({ className, preWrap, jumboEmoji, emote, notice, ...props }, ref) => {
    const variant = css.MessageTextBody({ preWrap, jumboEmoji, emote, notice });
    return (
      <Text
        as="div"
        size="T400"
        priority="400"
        {...props}
        ref={ref}
        className={classNames(variant, className)}
      />
    );
  }
);








  ({ username, children, className, ...props }, ref) => (
    <Box
      alignItems="Center"
      className={classNames(css.ReplyLayout, className)}
      {...props}
      ref={ref}
    >
      {username && <Box shrink="No">{username}</Box>}
      <Box grow="Yes" style={{ minWidth: 0 }}>
        {children}
      </Box>
    </Box>
  )
);
