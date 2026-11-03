import React, { ReactNode } from 'react';
import classNames from 'classnames';
import { Box, Text, as } from 'folds';
import type { MessageSpacing } from '../../../state/settings';
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












type LayoutProps = {
  before?: ReactNode;
};

/** Avatar column, then the header and body; follow-ups keep the avatar column empty. */



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



      <div className={css.LayoutContent}>
        <div className={css.BubbleContent}>
          {header}
          {children}
        </div>
      </div>
    </Box>









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














};

/** A quoted message line: who wrote it, then the quoted text. */
export const ReplyLayout = as<'div', ReplyLayoutProps>(
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
