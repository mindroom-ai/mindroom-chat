import { ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Box, Text, color, toRem } from 'folds';
import { localDigits } from '../lib/localDigits';
import { playsMotion } from './listMotion';

type UnreadBadgeProps = {
  /** Mentions and keywords: the badge stands out. */
  highlight?: boolean;
  /** Unread count; 0 shows a dot for unread activity without a count. */
  count: number;
  /** Direct messages read as personal, like highlights. */
  dm?: boolean;
};

const MENTION_RING = {
  outlineStyle: 'solid',
  outlineWidth: toRem(1.5),
  outlineColor: color.Primary.Main,
  outlineOffset: toRem(1.5),
} as const;

/** The count in the interface language's digits, as every other number on screen. */
export const formatBadgeCount = (count: number, language: string): string =>
  localDigits(count > 99 ? '99+' : `${count}`, language);

/** A badge whose count grew while it showed pops once, so what just came catches the eye. */
const usePopOnGrowth = (count: number) => {
  const badgeRef = useRef<HTMLDivElement>(null);
  const shownRef = useRef(count);
  useEffect(() => {
    const grew = count > shownRef.current;
    shownRef.current = count;
    const badge = badgeRef.current;
    if (grew && badge && playsMotion(badge)) {
      badge.animate([{ scale: 1 }, { scale: 1.25 }, { scale: 1 }], { duration: 240 });
    }
  }, [count]);
  return badgeRef;
};

export function UnreadBadge({ highlight, count, dm }: UnreadBadgeProps) {
  const { i18n } = useTranslation();
  const badgeRef = usePopOnGrowth(count);
  const stressed = highlight || dm;
  if (count <= 0) {
    // A small accent dot; a mention's is larger with a ring around it, a shape that reads alone.
    const dot = toRem(stressed ? 8 : 6);
    return (
      <Badge
        ref={badgeRef}
        variant="Primary"
        fill="Solid"
        radii="Pill"
        size="200"
        style={{ minWidth: dot, height: dot, padding: 0, ...(stressed && MENTION_RING) }}
        aria-hidden="true"
      />
    );
  }
  // A plain count is a quiet pale accent chip with a hairline ring; mentions and direct messages
  // stay solid so they stand out (docs/design/reference/home.png).
  return (
    <Badge
      ref={badgeRef}
      variant="Primary"
      fill={stressed ? 'Solid' : 'Soft'}
      outlined={!stressed}
      radii="Pill"
      size="400"
    >
      <Text as="span" size="L400">
        {formatBadgeCount(count, i18n.language)}
      </Text>
    </Badge>
  );
}

/** Keeps a badge centered in a fixed-width slot, so rows with and without one line up. */
export function UnreadBadgeCenter({ children }: { children?: ReactNode }) {
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
