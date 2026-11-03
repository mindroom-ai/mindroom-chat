import React from 'react';
import { Button, Chip, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { JoinRule } from 'matrix-js-sdk';
import { RoomAccessControl } from '../../components/room-access';
import { Membership } from '../../../types/matrix/room';
import type { LobbyItemAccess } from './access';

type LobbyAccessButtonProps = {
  roomId: string;
  roomName: string;
  access: LobbyItemAccess;
  membership?: string;
  viaServers?: string[];
  /** Renders a header chip (spaces) instead of a button (rooms). */
  chipClassName?: string;
};

/** Join or request-to-join for a lobby item the user is not in. */
export function LobbyAccessButton({
  roomId,
  roomName,
  access,
  membership,
  viaServers,
  chipClassName,
}: LobbyAccessButtonProps) {
  const { t } = useTranslation();

  if (access.kind === 'unavailable' || access.kind === 'unknown') {
    return (
      <Text size="T200" priority="300">
        {t('featureUi.lobby.accessUnavailable')}
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
            ? t('featureUi.lobby.requestSent')
            : t('featureUi.lobby.requestToJoin')
          : t('featureUi.lobby.join');
        const disabled = knock ? !!control.requested : !!control.succeeded;
        if (chipClassName) {
          return (
            <Chip
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
          );
        }
        return (
          <Button
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
        );
      }}
    </RoomAccessControl>
  );
}

export const isJoinRuleKnock = (joinRule: JoinRule): boolean =>
  joinRule === JoinRule.Knock || joinRule === ('knock_restricted' as JoinRule);
