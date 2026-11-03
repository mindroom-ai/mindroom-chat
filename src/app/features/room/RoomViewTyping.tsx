import React from 'react';
import { Icon, IconButton, Icons, Text } from 'folds';
import { Trans, useTranslation } from 'react-i18next';
import { useSetAtom } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomTypingMember } from '../../hooks/useRoomTypingMembers';
import { IconTooltip } from '../../mindroom/tooltip/IconTooltip';
import { roomIdToTypingMembersAtom } from '../../state/typingMembers';
import { getMemberDisplayName } from '../../utils/room';
import { getMxIdLocalPart } from '../../utils/matrix';
import * as css from './RoomViewTyping.css';

type RoomViewTypingProps = {
  room: Room;
};

const NAME = <b />;

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
  const [first, second, third] = names;
  const components = { name: NAME, first: NAME, second: NAME, third: NAME, others: NAME };
  let message: React.ReactNode;
  if (names.length === 1) {
    message = (
      <Trans i18nKey="featureUi.room.typing.one" values={{ name: first }} components={components} />
    );
  } else if (names.length === 2) {
    message = (
      <Trans
        i18nKey="featureUi.room.typing.two"
        values={{ first, second }}
        components={components}
      />
    );
  } else if (names.length === 3) {
    message = (
      <Trans
        i18nKey="featureUi.room.typing.three"
        values={{ first, second, third }}
        components={components}
      />
    );
  } else {
    message = (
      <Trans
        i18nKey={names.length === 4 ? 'featureUi.room.typing.four' : 'featureUi.room.typing.many'}
        values={{ first, second, third, count: names.length - 3 }}
        components={components}
      />
    );
  }

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
