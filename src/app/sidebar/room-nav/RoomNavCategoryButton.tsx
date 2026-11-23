import type { ReactNode } from 'react';
import classNames from 'classnames';
import { Box, Icon, Icons, Text, as } from 'folds';
import { ownDirectionLine } from '../../ui/directional';
import { CategoryButton } from './RoomNavCategoryButton.css';

type RoomNavCategoryButtonProps = {
  /** Whether the category is collapsed; the chevron points right then. */
  closed?: boolean;
  /** User-authored label: reads in its own direction while lining up with the interface. */
  ownDirection?: boolean;
  /** Trailing content inside the button, such as a collapsed section's unread dot. */
  after?: ReactNode;
};

/** The collapsible heading of a sidebar section such as Rooms or Threads. */
export const RoomNavCategoryButton = as<'button', RoomNavCategoryButtonProps>(
  (
    { as: AsButton = 'button', closed, ownDirection, after, children, style, className, ...props },
    ref
  ) => (
    <AsButton
      type="button"
      aria-expanded={!closed}
      className={classNames(CategoryButton, className)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        background: 'none',
        border: 0,
        padding: '4px',
        color: 'inherit',
        cursor: 'pointer',
        textAlign: 'start',
        flexGrow: 1,
        minWidth: 0,
        ...style,
      }}
      {...props}
      ref={ref}
    >
      <Icon
        size="50"
        src={closed ? Icons.ChevronRight : Icons.ChevronBottom}
        data-directional={closed || undefined}
      />
      <Box as="span" grow="Yes">
        <Text
          as="span"
          size="L400"
          priority="300"
          truncate
          {...(ownDirection ? ownDirectionLine : undefined)}
        >
          {children}
        </Text>
      </Box>
      {after}
    </AsButton>
  )
);
