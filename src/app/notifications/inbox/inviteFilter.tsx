import { useId } from 'react';
import { Badge, Box, Chip, Icon, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { EventType, type MatrixClient } from 'matrix-js-sdk';

/**
 * Which list an invite goes in: from someone the user already talks to (`primary`), from anyone
 * else (`public`), or with words of spam invites (`spam`).
 */
export type InviteCategory = 'primary' | 'public' | 'spam';

export const INVITE_CATEGORIES: readonly InviteCategory[] = ['primary', 'public', 'spam'];

/** The inviter has a direct chat with the user, or is a member of a room the user joined. */
const isKnownInviter = (mx: MatrixClient, senderId: string | undefined): boolean => {
  if (!senderId) return false;
  const directRooms = mx.getAccountData(EventType.Direct)?.getContent()?.[senderId];
  if (Array.isArray(directRooms) && directRooms.length > 0) return true;
  return mx
    .getRooms()
    .some(
      (room) => room.getMyMembership() === 'join' && room.getMember(senderId)?.membership === 'join'
    );
};

type CategorizedInvite = { senderId?: string };

export const categorizeInvite = (
  mx: MatrixClient,
  invite: CategorizedInvite,
  looksLikeSpam: boolean
): InviteCategory => {
  if (looksLikeSpam) return 'spam';
  return isKnownInviter(mx, invite.senderId) ? 'primary' : 'public';
};

/** The name of each list, which its chip and the heading over its invites show. */
export const INVITE_CATEGORY_LABEL_KEYS = {
  primary: 'sharedUi.invites.primary',
  public: 'sharedUi.invites.public',
  spam: 'sharedUi.invites.spam',
} as const;

type InviteFilterChipsProps = {
  counts: Record<InviteCategory, number>;
  selected: InviteCategory;
  onSelect: (category: InviteCategory) => void;
};

/**
 * A small "Filter" label over one chip per list. The pressed chip, the list shown, carries a
 * check mark; a list holding invites shows their number in a badge, an empty one shows none.
 */
export function InviteFilterChips({ counts, selected, onSelect }: InviteFilterChipsProps) {
  const { t } = useTranslation();
  const labelId = useId();
  return (
    <Box direction="Column" gap="200">
      <Text id={labelId} size="L400" priority="300">
        {t('sharedUi.invites.filter')}
      </Text>
      <Box gap="200" wrap="Wrap" role="group" aria-labelledby={labelId}>
        {INVITE_CATEGORIES.map((category) => {
          const pressed = category === selected;
          const count = counts[category];
          return (
            <Chip
              key={category}
              radii="Pill"
              variant={pressed ? 'Primary' : 'SurfaceVariant'}
              outlined={!pressed}
              aria-pressed={pressed}
              onClick={() => onSelect(category)}
              before={pressed ? <Icon size="50" src={Icons.Check} /> : undefined}
              after={
                count > 0 ? (
                  <Badge
                    variant={pressed ? 'Primary' : 'Secondary'}
                    fill={pressed ? 'Solid' : 'Soft'}
                    radii="Pill"
                    size="400"
                  >
                    <Text as="span" size="L400">
                      {count}
                    </Text>
                  </Badge>
                ) : undefined
              }
            >
              <Text size="T200">{t(INVITE_CATEGORY_LABEL_KEYS[category])}</Text>
            </Chip>
          );
        })}
      </Box>
    </Box>
  );
}
