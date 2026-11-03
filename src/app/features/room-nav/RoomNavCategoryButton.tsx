import React from 'react';
import { Box, Icon, Icons, Text, as } from 'folds';

type RoomNavCategoryButtonProps = {
  /** Whether the category is collapsed; the chevron points right then. */
  closed?: boolean;
};

/** The collapsible heading of a sidebar section such as Rooms or Threads. */
export const RoomNavCategoryButton = as<'button', RoomNavCategoryButtonProps>(
  ({ as: AsButton = 'button', closed, children, style, ...props }, ref) => (
    <AsButton
      type="button"
      aria-expanded={!closed}
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
      <Icon size="50" src={closed ? Icons.ChevronRight : Icons.ChevronBottom} />
      <Box as="span" grow="Yes">
        <Text as="span" size="O400" priority="300" truncate>
          {children}
        </Text>
      </Box>
    </AsButton>
  )
);
