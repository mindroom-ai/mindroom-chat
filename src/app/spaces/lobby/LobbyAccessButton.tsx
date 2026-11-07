import { Button, Chip, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { RoomAccessControl } from '../../rooms/RoomAccessControl';
import { ReportJoinFailure } from '../../rooms/JoinFailure';
import { cardActionProps } from '../../lib/cardAction';
import { Membership } from '../../matrix/types/room';
import type { LobbyItemAccess } from './access';

type LobbyAccessButtonProps = {
  roomId: string;
  roomName: string;
  access: LobbyItemAccess;
  membership?: string;
  viaServers?: string[];
  /** Renders a header chip (spaces) instead of a button (rooms). */
  chipClassName?: string;
  /** Why the last join failed, for the card to show; undefined once it no longer applies. */
  onJoinFailure: (error: unknown) => void;
};

/**
 * Join or request-to-join for a lobby item the user is not in; a click elsewhere on the item's card
 * presses it. A join the server refuses is handed to the card (`onJoinFailure`), which says why.
 */
export function LobbyAccessButton({
  roomId,
  roomName,
  access,
  membership,
  viaServers,
  chipClassName,
  onJoinFailure,
}: LobbyAccessButtonProps) {
  const { t } = useTranslation();

  if (access.kind === 'unavailable' || access.kind === 'unknown') {
    return (
      <Text size="T200" priority="300">
        {t('featureUi.lobby.roomItem.accessUnavailable')}
      </Text>
    );
  }

  const knock = access.kind === 'knock';
  return (
    <RoomAccessControl
      key={roomId}
      roomIdOrAlias={roomId}
      roomId={roomId}
      roomName={roomName}
      joinRule={access.joinRule}
      membership={
        knock || membership !== Membership.Knock
          ? (membership as Membership | undefined)
          : undefined
      }
      viaServers={viaServers}
    >
      {(control) => {
        const label = knock
          ? control.requested
            ? t('featureUi.lobby.roomItem.requestSent')
            : t('featureUi.lobby.roomItem.requestToJoin')
          : t('featureUi.lobby.roomItem.join');
        const disabled = knock ? !!control.requested : !!control.succeeded;
        const failure = <ReportJoinFailure error={control.joinError} onChange={onJoinFailure} />;
        if (chipClassName) {
          return (
            <>
              {failure}
              <Chip
                {...cardActionProps}
                className={chipClassName}
                variant={knock ? 'Secondary' : 'Primary'}
                radii="Pill"
                disabled={disabled}
                onClick={control.activate}
              >
                <Text size="T200" truncate>
                  {label}
                </Text>
              </Chip>
            </>
          );
        }
        return (
          <>
            {failure}
            <Button
              {...cardActionProps}
              variant={knock ? 'Secondary' : 'Primary'}
              fill="Soft"
              radii="300"
              size="300"
              disabled={disabled}
              onClick={control.activate}
            >
              <Text size="B300" truncate>
                {label}
              </Text>
            </Button>
          </>
        );
      }}
    </RoomAccessControl>
  );
}
