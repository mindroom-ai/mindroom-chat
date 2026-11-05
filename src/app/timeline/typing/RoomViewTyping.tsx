import { Icon, IconButton, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useSetAtom } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRoomTypingMember } from './useRoomTypingMembers';
import { IconTooltip } from '../../ui/IconTooltip';
import { roomIdToTypingMembersAtom } from '../../matrix/state/typingMembers';
import { getMemberDisplayName } from '../../matrix/room';
import { getMxIdLocalPart } from '../../matrix/matrix';
import { NamesSentence } from './NamesSentence';
import * as css from './RoomViewTyping.css';

type RoomViewTypingProps = {
  room: Room;
};

// Sentences for one to four typing members; five and more share the last one.
const TYPING_KEYS = [
  'featureUi.room.typing.one',
  'featureUi.room.typing.two',
  'featureUi.room.typing.three',
  'featureUi.room.typing.four',
  'featureUi.room.typing.many',
] as const;

/** Three dots that take turns rising, the usual sign that someone is writing. */
function TypingDots() {
  return (
    <span className={css.TypingDots} aria-hidden>
      <span className={css.TypingDot} />
      <span className={css.TypingDot} />
      <span className={css.TypingDot} />
    </span>
  );
}

/**
 * Names the other members who are typing in the room, in a strip above the composer. Dropping
 * the status hides it until the next typing update arrives for that member.
 */
export function RoomViewTyping({ room }: RoomViewTypingProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const updateTyping = useSetAtom(roomIdToTypingMembersAtom);
  const myUserId = mx.getUserId();
  const typing = useRoomTypingMember(room.roomId).filter(
    (receipt) => receipt.userId !== myUserId && receipt.isTyping()
  );

  if (typing.length === 0) return null;

  const names = typing.map(
    ({ userId }) => getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId
  );
  const message = <NamesSentence keys={TYPING_KEYS} names={names} />;

  const dropLabel = t('featureUi.room.typing.dropTypingStatus');
  const dropTyping = () =>
    typing.forEach(({ userId }) => updateTyping({ type: 'DELETE', roomId: room.roomId, userId }));

  return (
    <div className={css.TypingStrip} role="status" aria-live="polite">
      <TypingDots />
      <Text className={css.TypingText} size="T200" priority="300" truncate>
        {message}
      </Text>
      <IconTooltip label={dropLabel} position="Top">
        {(triggerRef) => (
          <IconButton
            ref={triggerRef}
            size="300"
            radii="Pill"
            variant="SurfaceVariant"
            fill="None"
            aria-label={dropLabel}
            onClick={dropTyping}
          >
            <Icon size="50" src={Icons.Cross} />
          </IconButton>
        )}
      </IconTooltip>
    </div>
  );
}
