import React, { ReactNode } from 'react';
import { Badge, Box, Text, toRem } from 'folds';

type UnreadBadgeProps = {
  /** Mentions and keywords: the badge stands out. */
  highlight?: boolean;
  /** Unread count; 0 shows a dot for unread activity without a count. */
  count: number;
  /** Direct messages read as personal, like highlights. */
  dm?: boolean;
};

const formatCount = (count: number): string => (count > 99 ? '99+' : `${count}`);

export function UnreadBadge({ highlight, count, dm }: UnreadBadgeProps) {
  const stressed = highlight || dm;
  if (count <= 0) {
    return (
      <Badge
        variant={stressed ? 'Primary' : 'Secondary'}
        fill="Solid"
        radii="Pill"
        size="200"
        style={{ minWidth: toRem(8), height: toRem(8), padding: 0 }}
        aria-hidden="true"
      />
    );
  }
  return (
    <Badge variant={stressed ? 'Primary' : 'Secondary'} fill="Solid" radii="Pill" size="400">
      <Text as="span" size="L400">
        {formatCount(count)}
      </Text>
    </Badge>
  );
}

/** Keeps a badge centered in a fixed-width slot, so rows with and without one line up. */
export function UnreadBadgeCenter({ children }: { children: ReactNode }) {
  return (
    <Box
      as="span"
      shrink="No"
      alignItems="Center"
      justifyContent="Center"
      style={{ minWidth: toRem(24) }}
    >
      {children}
    </Box>
  );
}
