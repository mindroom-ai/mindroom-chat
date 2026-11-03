import React, {
  FormEventHandler,
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { EventType, JoinRule, MatrixEvent, Room, RoomEvent, RoomStateEvent } from 'matrix-js-sdk';
import {
  Box,
  Button,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  TextArea,
  color,
  config,
} from 'folds';
import { Dialog, Header } from '../glass/GlassPrimitives';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { JoinRule as RoomJoinRule, Membership } from '../../../types/matrix/room';
import { isRoomId } from '../../utils/matrix';

/** The join rules access can be decided from. */
export type RoomAccessJoinRule = JoinRule;

export type RoomAccessKind = 'join' | 'knock';

export type RoomAccess = {
  /** Join directly, or ask to join (knock). */
  kind: RoomAccessKind;
  /** Joins, or opens the request dialog. */
  activate: () => void;
  loading: boolean;
  /** A request to join is pending with the room's moderators. */
  requested: boolean;
  /** The join went through (sync may not have caught up yet). */
  succeeded: boolean;
};

type Attempt = {
  id: number;
  kind: RoomAccessKind;
  status: 'loading' | 'succeeded' | 'failed';
  error?: unknown;
};

type RoomAccessControlProps = {
  roomIdOrAlias: string;
  /** The room ID a server confirmed for `roomIdOrAlias`. */
  roomId?: string;
  roomName: string;
  /** The rule a room summary or directory reported. */
  joinRule?: RoomAccessJoinRule;
  /** The user's membership a room summary reported. */
  membership?: Membership;
  viaServers?: string[];
  /** Shown when there is no verified way in. */
  fallback?: ReactNode;
  children: (access: RoomAccess) => ReactNode;
};

const JOINABLE_RULES: ReadonlySet<string> = new Set([RoomJoinRule.Public, RoomJoinRule.Restricted]);
const KNOCKABLE_RULES: ReadonlySet<string> = new Set([
  RoomJoinRule.Knock,
  RoomJoinRule.KnockRestricted,
]);

const errorMessage = (error: unknown): string | undefined =>
  error instanceof Error && error.message ? error.message : undefined;

/**
 * Decides how the user can get into a room they are not in: join, accept an invite, or ask to
 * join (knock) with an optional message. Only a server-confirmed room ID is trusted, so a cached
 * room claiming an alias cannot redirect a join. Live membership from sync overrides earlier
 * answers, and a stale request result never undoes what sync reported later.
 */
function RoomAccessSession({




  membership: summaryMembership,
  viaServers,
  fallback,
  children,
}: RoomAccessControlProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const targetRoomId = roomId ?? (isRoomId(roomIdOrAlias) ? roomIdOrAlias : undefined);
  const cachedRoom: Room | null = targetRoomId ? mx.getRoom(targetRoomId) : null;

  const [liveMembership, setLiveMembership] = useState<string>();
  const [attempt, setAttemptState] = useState<Attempt>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const attemptRef = useRef<Attempt>();
  const attemptIdRef = useRef(0);
  const targetRef = useRef(targetRoomId);
  targetRef.current = targetRoomId;

  const setAttempt = useCallback((next: Attempt | undefined) => {
    attemptRef.current = next;
    setAttemptState(next);
  }, []);

  /** A membership reported by sync or by a newer summary; it settles any attempt it answers. */
  const signal = useCallback(
    (next: string) => {
      setLiveMembership(next);
      const current = attemptRef.current;
      if (next === Membership.Join) {
        setAttempt(undefined);
        setDialogOpen(false);
        return;
      }
      if (next === Membership.Knock) {
        if (current?.kind === 'knock') setAttempt({ ...current, status: 'succeeded' });
        setDialogOpen(false);
        return;
      }
      // A repeated invite leaves an accepted invite pending; anything else ends the attempt.
      if (current && !(current.kind === 'join' && next === Membership.Invite)) {
        setAttempt(undefined);
      }
    },
    [setAttempt]
  );

  const summaryRef = useRef(summaryMembership);
  useEffect(() => {
    if (summaryRef.current === summaryMembership) return;
    summaryRef.current = summaryMembership;
    if (summaryMembership) signal(summaryMembership);
  }, [signal, summaryMembership]);

  useEffect(() => {
    const handleMembership = (room: Room, membership: string) => {
      if (targetRef.current && room.roomId === targetRef.current) signal(membership);
    };
    const handleStateEvent = (event: MatrixEvent) => {
      if (
        targetRef.current &&
        event.getRoomId() === targetRef.current &&
        event.getType() === EventType.RoomMember &&
        event.getStateKey() === mx.getUserId()
      ) {
        const { membership } = event.getContent();
        if (typeof membership === 'string') signal(membership);
      }
    };
    mx.on(RoomEvent.MyMembership, handleMembership);
    mx.on(RoomStateEvent.Events, handleStateEvent);
    return () => {
      mx.removeListener(RoomEvent.MyMembership, handleMembership);
      mx.removeListener(RoomStateEvent.Events, handleStateEvent);
    };
  }, [mx, signal, targetRoomId, cachedRoom]);

  const membership = liveMembership ?? summaryMembership ?? cachedRoom?.getMyMembership();
  const rule = joinRule ?? cachedRoom?.getJoinRule?.();
  const joinable = !!rule && JOINABLE_RULES.has(rule);
  const knockable = !!rule && KNOCKABLE_RULES.has(rule);
  const requested =
    !joinable &&
    (membership === Membership.Knock ||
      (attempt?.kind === 'knock' && attempt.status === 'succeeded'));

  let kind: RoomAccessKind | undefined;
  if (membership === Membership.Invite || joinable) kind = 'join';
  else if (knockable || requested) kind = 'knock';

  const joinTarget = targetRoomId ?? roomIdOrAlias;

  const startAttempt = (attemptKind: RoomAccessKind): Attempt => {
    attemptIdRef.current += 1;
    const next: Attempt = { id: attemptIdRef.current, kind: attemptKind, status: 'loading' };
    setAttempt(next);
    return next;
  };

  const settle = (started: Attempt, status: 'succeeded' | 'failed', error?: unknown) => {
    const current = attemptRef.current;
    // Sync already answered this attempt, or a newer one replaced it.
    if (current?.id !== started.id || current.status !== 'loading') return;
    setAttempt({ ...current, status, error });
    if (status === 'succeeded' && started.kind === 'knock') setDialogOpen(false);
  };

  const join = () => {
    const started = startAttempt('join');
    mx.joinRoom(joinTarget, { viaServers }).then(
      () => settle(started, 'succeeded'),
      (error: unknown) => settle(started, 'failed', error)
    );
  };

  const knock = (reason: string | undefined) => {
    const started = startAttempt('knock');
    mx.knockRoom(joinTarget, { reason, viaServers }).then(
      () => settle(started, 'succeeded'),
      (error: unknown) => settle(started, 'failed', error)
    );
  };

  const loading = attempt?.status === 'loading';
  const knockLoading = loading && attempt?.kind === 'knock';

  const activate = () => {
    if (loading || !kind) return;
    if (kind === 'join') join();
    else if (!requested) setDialogOpen(true);
  };

  const closeDialog = useCallback(() => {
    if (attemptRef.current?.status === 'loading') return;
    setDialogOpen(false);
    if (attemptRef.current?.kind === 'knock' && attemptRef.current.status === 'failed') {
      setAttempt(undefined);
    }
  }, [setAttempt]);

  if (membership === Membership.Join || membership === Membership.Ban) return null;
  if (!kind) return <>{fallback ?? null}</>;

  return (
    <>
      {children({
        kind,
        activate,
        loading,
        requested,
        succeeded: attempt?.kind === 'join' && attempt.status === 'succeeded',
      })}
      {dialogOpen && (
        <RoomAccessRequestDialog
          roomName={roomName}
          loading={knockLoading}
          error={
            attempt?.kind === 'knock' && attempt.status === 'failed' ? attempt.error : undefined
          }
          onSubmit={knock}
          requestClose={closeDialog}
          fallbackErrorMessage={t('sharedUi.roomAccess.requestFailed')}
        />
      )}
    </>
  );
}

type RoomAccessRequestDialogProps = {
  roomName: string;
  loading: boolean;
  error: unknown;
  fallbackErrorMessage: string;
  onSubmit: (reason: string | undefined) => void;
  requestClose: () => void;
};

function RoomAccessRequestDialog({
  roomName,
  loading,
  error,
  fallbackErrorMessage,
  onSubmit,
  requestClose,
}: RoomAccessRequestDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const messageId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (messageRef.current ?? dialogRef.current)?.focus();
    return () => {
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loadingRef.current) {
        event.stopPropagation();
        requestClose();
      }
    };
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!loadingRef.current && target && !dialogRef.current?.contains(target)) requestClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [requestClose]);

  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (loading) return;
    const form = event.target as HTMLFormElement & { reasonInput?: HTMLTextAreaElement };
    const reason = form.reasonInput?.value.trim();
    onSubmit(reason || undefined);
  };

  const shownError = error === undefined ? undefined : errorMessage(error) ?? fallbackErrorMessage;

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <Dialog
          ref={dialogRef}
          variant="Surface"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
        >
          <Header style={{ padding: `0 ${config.space.S400}` }} size="500">
            <Text id={titleId} as="h2" size="H4" truncate>
              {t('sharedUi.roomAccess.requestTitle', { name: roomName })}
            </Text>
          </Header>
          <Box
            as="form"
            direction="Column"
            gap="400"
            style={{ padding: config.space.S400 }}
            onSubmit={handleSubmit}
          >
            <Text size="T300" priority="400">
              {t('sharedUi.roomAccess.requestDescription')}
            </Text>
            <Box direction="Column" gap="100">
              <Text as="label" htmlFor={messageId} size="L400">
                {t('sharedUi.roomAccess.message')}
              </Text>
              <TextArea
                ref={messageRef}
                id={messageId}
                name="reasonInput"
                variant="Background"
                rows={3}
                maxLength={500}
                readOnly={loading}
              />
            </Box>
            {shownError && (
              <Text role="alert" size="T200" style={{ color: color.Critical.Main }}>
                {shownError}
              </Text>
            )}
            <Box gap="200" justifyContent="End">
              <Button
                type="button"
                variant="Secondary"
                fill="Soft"
                size="400"
                disabled={loading}
                onClick={requestClose}
              >
                <Text size="B400">{t('sharedUi.roomAccess.cancel')}</Text>
              </Button>
              <Button
                type="submit"
                variant="Primary"
                size="400"
                disabled={loading}
                before={loading ? <Spinner size="100" variant="Primary" fill="Solid" /> : undefined}
              >
                <Text size="B400">
                  {loading ? t('sharedUi.roomAccess.sending') : t('sharedUi.roomAccess.send')}
                </Text>
              </Button>
            </Box>
          </Box>
        </Dialog>
      </OverlayCenter>
    </Overlay>
  );
}

/** Renders `children` with the user's way into a room, or `fallback` when there is none. */
export function RoomAccessControl(props: RoomAccessControlProps) {
  const { roomIdOrAlias, roomId } = props;
  // A different room starts a fresh session: no attempt or answer carries over.
  return <RoomAccessSession key={`${roomIdOrAlias}|${roomId ?? ''}`} {...props} />;
}
