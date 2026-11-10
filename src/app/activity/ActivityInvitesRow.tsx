import { Avatar, Icon, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { getMxIdLocalPart } from '../matrix/matrix';
import { getMemberRawDisplayName } from '../matrix/room';
import { revealDirectionControls } from '../ui/directional';
import type { ActivityRow } from './activityRows';
import * as css from './ActivityList.css';

/** Pending invites from this many on show as one row that leads to the invite list. */
export const INVITES_GATHERED_FROM = 3;

/**
 * Several pending invites as one row: how many, who sent them, and the way to the invite list,
 * which answers them with its spam filter and Accept All. Stale bridge invites would otherwise
 * fill the top of Activity one card each.
 */
export function ActivityInvitesRow({
  invites,
  onOpen,
}: {
  invites: Extract<ActivityRow, { type: 'invite' }>[];
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const inviters = [
    ...new Set(
      invites.flatMap(({ roomId, inviterId }) => {
        if (!inviterId) return [];
        const room = mx.getRoom(roomId);
        return [(room && getMemberRawDisplayName(room, inviterId)) ?? getMxIdLocalPart(inviterId)];
      })
    ),
  ].filter((name): name is string => !!name);
  return (
    <div data-activity-row="invites" className={`${css.Row} ${css.RowNeedsYou}`}>
      <div className={css.AvatarSlot}>
        <Avatar size="300" radii="Pill">
          <Icon size="100" src={Icons.Mail} />
        </Avatar>
      </div>
      <div className={css.Body}>
        <button type="button" className={css.OpenButton} onClick={onOpen}>
          <span className={css.Line}>
            <Text as="span" size="T300" className={css.Sentence}>
              <b>{t('activity.invitesSummary', { count: invites.length })}</b>
            </Text>
            <span className={css.UnreadDot} aria-hidden />
          </span>
          {inviters.length > 0 && (
            <Text as="span" size="T200" priority="400" truncate>
              {revealDirectionControls(inviters.join(', '))}
            </Text>
          )}
        </button>
      </div>
    </div>
  );
}
