import { Box, Chip, Text } from 'folds';
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

const LABEL_KEYS = {
  primary: 'sharedUi.invites.primary',
  public: 'sharedUi.invites.public',
  spam: 'sharedUi.invites.spam',
} as const;

type InviteFilterChipsProps = {
  counts: Record<InviteCategory, number>;
  selected: InviteCategory;
  onSelect: (category: InviteCategory) => void;
};

/** One chip per list with its size; the pressed one is the list shown. */
export function InviteFilterChips({ counts, selected, onSelect }: InviteFilterChipsProps) {
  const { t } = useTranslation();
  return (
    <Box gap="200" wrap="Wrap" role="group" aria-label={t('sharedUi.invites.filter')}>
      {INVITE_CATEGORIES.map((category) => {
        const pressed = category === selected;
        return (
          <Chip
            key={category}
            radii="Pill"
            variant={pressed ? 'Primary' : 'SurfaceVariant'}
            aria-pressed={pressed}
            onClick={() => onSelect(category)}
          >
            <Text size="T200">{`${t(LABEL_KEYS[category])} ${counts[category]}`}</Text>
          </Chip>
        );
      })}
    </Box>
  );
}
