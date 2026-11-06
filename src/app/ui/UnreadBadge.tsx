import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Box, Text, toRem } from 'folds';
import { localDigits } from '../lib/localDigits';

type UnreadBadgeProps = {
  /** Mentions and keywords: the badge stands out. */
  highlight?: boolean;
  /** Unread count; 0 shows a dot for unread activity without a count. */
  count: number;
  /** Direct messages read as personal, like highlights. */
  dm?: boolean;
};

/** The count in the interface language's digits, as every other number on screen. */
const formatCount = (count: number, language: string): string =>
  localDigits(count > 99 ? '99+' : `${count}`, language);

export function UnreadBadge({ highlight, count, dm }: UnreadBadgeProps) {
  const { i18n } = useTranslation();
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
  // A plain count is a quiet grey chip with a hairline ring; mentions and direct messages
  // stay solid so they stand out (docs/design/reference/home.png).
  return (
    <Badge
      variant={stressed ? 'Primary' : 'Secondary'}
      fill={stressed ? 'Solid' : 'Soft'}
      outlined={!stressed}
      radii="Pill"
      size="400"
    >
      <Text as="span" size="L400">
        {formatCount(count, i18n.language)}
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
