import React, {
  FormEventHandler,
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { JoinRule, MatrixError, Room, RoomEvent } from 'matrix-js-sdk';
import {
  Box,
  Button,
  Dialog,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  TextArea,
  color,
  config,
} from 'folds';
import FocusTrap from 'focus-trap-react';

import { Membership } from '../../../types/matrix/room';
import { AsyncState, AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useAlive } from '../../hooks/useAlive';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { stopPropagation } from '../../utils/keyboard';

export type RoomAccessJoinRule = JoinRule | 'knock_restricted';
export type RoomAccessKind = 'join' | 'knock';
type RoomAccessResult = Room | { room_id: string };

export const isRoomAccessJoinRule = (
  joinRule: unknown,
  membership?: string
): joinRule is RoomAccessJoinRule =>
  joinRule === JoinRule.Public ||
  joinRule === JoinRule.Restricted ||
  joinRule === JoinRule.Knock ||
  joinRule === 'knock_restricted' ||
  (joinRule === JoinRule.Invite && membership === Membership.Invite);

export type RoomAccessView = {
  kind: RoomAccessKind;
  state: AsyncState<RoomAccessResult, MatrixError>;
  loading: boolean;
  requested: boolean;
  succeeded: boolean;
  activate: () => void;
};

type RoomAccessControlProps = {
  roomIdOrAlias: string;
  roomId?: string;
  roomName: string;
  joinRule?: RoomAccessJoinRule;
  membership?: string;
  viaServers?: string[];
  children: (view: RoomAccessView) => ReactNode;
};

type RoomAccessSessionProps = RoomAccessControlProps & {
  accessRoomId: string;
  kind: RoomAccessKind;
};

function RoomAccessSession({
  roomIdOrAlias,
  roomName,
  membership,
  viaServers,
  children,
  accessRoomId,
  kind,
}: RoomAccessSessionProps) {
  const mx = useMatrixClient();
  const alive = useAlive();
  const dialogRef = useRef<HTMLDivElement>(null);
  const reasonInputRef = useRef<HTMLTextAreaElement>(null);
  const dialogTitleId = useId();
  const reasonInputId = useId();

  const [accessState, access] = useAsyncCallback<
    RoomAccessResult,
    MatrixError,
    [string | undefined]
  >(
    useCallback(
      (reason) =>
        kind === 'knock'
          ? mx.knockRoom(roomIdOrAlias, { reason, viaServers })
          : mx.joinRoom(roomIdOrAlias, { viaServers }),
      [kind, mx, roomIdOrAlias, viaServers]
    )
  );
  const [roomMembership, setRoomMembership] = useState(
    () => (mx.getRoom(accessRoomId)?.getMyMembership() ?? membership) as Membership | undefined
  );
  const [requestInvalidated, setRequestInvalidated] = useState(false);
  useEffect(() => {
    setRoomMembership(
      (mx.getRoom(accessRoomId)?.getMyMembership() ?? membership) as Membership | undefined
    );
  }, [accessRoomId, membership, mx]);

  useEffect(() => {
    setRequestInvalidated(false);
    const handleMembership = (room: Room, membership: string) => {
      if (room.roomId === accessRoomId) {
        setRoomMembership(membership as Membership);
        if (kind === 'knock') {
          setRequestInvalidated(membership !== Membership.Knock);
        }
      }
    };

    mx.on(RoomEvent.MyMembership, handleMembership);
    return () => {
      mx.removeListener(RoomEvent.MyMembership, handleMembership);
    };
  }, [accessRoomId, kind, mx]);

  const loading = accessState.status === AsyncStatus.Loading;
  const succeeded =
    accessState.status === AsyncStatus.Success && !(kind === 'knock' && requestInvalidated);
  const requested = kind === 'knock' && (succeeded || roomMembership === Membership.Knock);
  const [viewKnock, setViewKnock] = useState(false);
  const closeKnock = () => setViewKnock(false);
  const activate = () => {
    if (loading || requested || succeeded) return;

    if (kind === 'knock') {
      setViewKnock(true);
      return;
    }

    access(undefined).catch(() => undefined);
  };
  const handleKnockSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    if (loading || requested) return;

    const target = evt.target as HTMLFormElement | undefined;
    const reasonInput = target?.reasonInput as HTMLTextAreaElement | undefined;
    const reason = reasonInput?.value.trim() || undefined;

    setRequestInvalidated(false);
    access(reason)
      .then(() => {
        if (alive()) {
          closeKnock();
        }
      })
      .catch(() => undefined);
  };

  return (
    <>
      {children({ kind, state: accessState, loading, requested, succeeded, activate })}
      {kind === 'knock' && (
        <Overlay open={viewKnock} backdrop={<OverlayBackdrop />}>
          <OverlayCenter>
            <FocusTrap
              focusTrapOptions={{
                initialFocus: () => reasonInputRef.current ?? dialogRef.current ?? document.body,
                clickOutsideDeactivates: !loading,
                onDeactivate: closeKnock,
                escapeDeactivates: stopPropagation,
                fallbackFocus: () => dialogRef.current ?? document.body,
              }}
            >
              <Dialog
                ref={dialogRef}
                variant="Surface"
                role="dialog"
                aria-modal="true"
                aria-labelledby={dialogTitleId}
                tabIndex={-1}
              >
                <Box
                  as="form"
                  onSubmit={handleKnockSubmit}
                  style={{ padding: config.space.S400 }}
                  direction="Column"
                  gap="400"
                >
                  <Box direction="Column" gap="100">
                    <Text
                      as="h2"
                      id={dialogTitleId}
                      size="H4"
                    >{`Request to join ${roomName}`}</Text>
                    <Text size="T300" priority="400">
                      An admin will review your request.
                    </Text>
                  </Box>
                  <Box direction="Column" gap="100">
                    <Text as="label" htmlFor={reasonInputId} size="L400">
                      Message (optional)
                    </Text>
                    <TextArea
                      ref={reasonInputRef}
                      id={reasonInputId}
                      name="reasonInput"
                      variant="Background"
                      size="500"
                      rows={3}
                      resize="None"
                      disabled={loading}
                    />
                  </Box>
                  {accessState.status === AsyncStatus.Error && (
                    <Text role="alert" size="T200" style={{ color: color.Critical.Main }}>
                      {accessState.error.message || 'Failed to send request.'}
                    </Text>
                  )}
                  <Box gap="200" justifyContent="End">
                    <Button
                      type="button"
                      variant="Secondary"
                      fill="Soft"
                      onClick={closeKnock}
                      disabled={loading}
                    >
                      <Text size="B400">Cancel</Text>
                    </Button>
                    <Button
                      type="submit"
                      disabled={loading}
                      before={loading && <Spinner size="200" variant="Primary" fill="Solid" />}
                    >
                      <Text size="B400">{loading ? 'Sending request' : 'Send request'}</Text>
                    </Button>
                  </Box>
                </Box>
              </Dialog>
            </FocusTrap>
          </OverlayCenter>
        </Overlay>
      )}
    </>
  );
}

export function RoomAccessControl({
  roomIdOrAlias,
  roomId,
  joinRule,
  membership,
  ...props
}: RoomAccessControlProps) {
  if (!isRoomAccessJoinRule(joinRule, membership)) return null;

  const accessRoomId = roomId ?? roomIdOrAlias;
  const kind: RoomAccessKind =
    joinRule === JoinRule.Knock || joinRule === 'knock_restricted' ? 'knock' : 'join';

  return (
    <RoomAccessSession
      key={`${kind}:${accessRoomId}`}
      {...props}
      roomIdOrAlias={roomIdOrAlias}
      roomId={roomId}
      joinRule={joinRule}
      membership={membership}
      accessRoomId={accessRoomId}
      kind={kind}
    />
  );
}
