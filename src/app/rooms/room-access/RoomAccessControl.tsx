import {
  FormEventHandler,
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
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
import { Dialog, Header } from '../../ui/glass/GlassPrimitives';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { JoinRule as RoomJoinRule, Membership } from '../../matrix/types/room';
import { isRoomId } from '../../matrix/matrix';
import { matchesEnum } from '../../lib/matchesEnum';
import { describeKnownError } from '../../lib/describeError';
import { ErrorDetail } from '../../ui/ErrorDetail';

/** The join rules access can be decided from. */
export type RoomAccessJoinRule = JoinRule;

type RoomAccessKind = 'join' | 'knock';

type RoomAccess = {
  /** Join directly, or ask to join (knock). */
  kind: RoomAccessKind;
  /** Joins, or opens the request dialog. */
  activate: () => void;
  loading: boolean;
  /** A request to join is pending with the room's moderators. */
  requested: boolean;
  /** The join went through (sync may not have caught up yet). */
  succeeded: boolean;
  /** Why the last join failed; cleared by the next attempt. */
  joinError?: unknown;
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

// An error this client cannot translate keeps its own text here, as the ported tests expect.
const errorMessage = (error: unknown): string | undefined =>
  error instanceof Error && error.message ? error.message : undefined;

/**
 * Decides how the user can get into a room they are not in: join, accept an invite, or ask to
 * join (knock) with an optional message. Only a server-confirmed room ID is trusted, so a cached
 * room claiming an alias cannot redirect a join. Live membership from sync overrides earlier
 * answers, and a stale request result never undoes what sync reported later.
 */
function RoomAccessSession({
  roomName,
  roomIdOrAlias,
  roomId,
  joinRule,
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
      if (matchesEnum(next, Membership.Join)) {
        setAttempt(undefined);
        setDialogOpen(false);
        return;
      }
      if (matchesEnum(next, Membership.Knock)) {
        if (current?.kind === 'knock') setAttempt({ ...current, status: 'succeeded' });
        setDialogOpen(false);
        return;
      }
      // A repeated invite leaves an accepted invite pending; anything else ends the attempt.
      if (current && !(current.kind === 'join' && matchesEnum(next, Membership.Invite))) {
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
    const isTarget = (roomId: string | undefined) =>
      !!targetRef.current && roomId === targetRef.current;
    // Both our own member state event and the membership event report a change in the target.
    const onMemberState = (event: MatrixEvent) => {
      const ownMemberEvent =
        matchesEnum(event.getType(), EventType.RoomMember) &&
        event.getStateKey() === mx.getUserId();
      if (!ownMemberEvent || !isTarget(event.getRoomId())) return;
      const membership: unknown = event.getContent().membership;
      if (typeof membership === 'string') signal(membership);
    };
    const onMyMembership = (room: Room, membership: string) => {
      if (isTarget(room.roomId)) signal(membership);
    };

    mx.on(RoomStateEvent.Events, onMemberState);
    mx.on(RoomEvent.MyMembership, onMyMembership);
    return () => {
      mx.removeListener(RoomStateEvent.Events, onMemberState);
      mx.removeListener(RoomEvent.MyMembership, onMyMembership);
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

  /** Awaits the request, so a client that answers without a promise settles the attempt too. */
  const runAttempt = async (attemptKind: RoomAccessKind, request: () => unknown) => {
    const started = startAttempt(attemptKind);
    try {
      await request();
    } catch (error) {
      settle(started, 'failed', error);
      return;
    }
    settle(started, 'succeeded');
  };

  const join = () => {
    void runAttempt('join', () => mx.joinRoom(joinTarget, { viaServers }));
  };

  const knock = (reason: string | undefined) => {
    void runAttempt('knock', () => mx.knockRoom(joinTarget, { reason, viaServers }));
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
        joinError:
          attempt?.kind === 'join' && attempt.status === 'failed' ? attempt.error : undefined,
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
          fallbackErrorMessage={t('sharedUi.roomAccessControl.failedToSendRequest')}
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
    if (typeof document === 'undefined') return undefined;
    // Test environments can provide a document without the DOM element classes.
    const active: unknown = document.activeElement;
    const trigger =
      typeof HTMLElement !== 'undefined' && active instanceof HTMLElement ? active : null;
    (messageRef.current ?? dialogRef.current)?.focus();
    return () => {
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
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

  const knownError = describeKnownError(t, error);
  const shownError =
    error === undefined ? undefined : knownError ?? errorMessage(error) ?? fallbackErrorMessage;

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        {/* Only keeps Tab inside the dialog: the effects above own focus, Escape and outside
            clicks. Nothing in the dialog is hidden, so the visibility check can be skipped. */}
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            fallbackFocus: () => dialogRef.current ?? document.body,
            returnFocusOnDeactivate: false,
            escapeDeactivates: false,
            allowOutsideClick: true,
            tabbableOptions: { displayCheck: 'none' },
          }}
        >
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
                {t('sharedUi.roomAccessControl.requestToJoinValue1', { value1: roomName })}
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
                {t('sharedUi.roomAccessControl.anAdminWillReviewYourRequest')}
              </Text>
              <Box direction="Column" gap="100">
                <Text as="label" htmlFor={messageId} size="L400">
                  {t('sharedUi.roomAccessControl.messageOptional')}
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
                  {knownError !== undefined && <ErrorDetail error={error} />}
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
                  <Text size="B400">{t('sharedUi.roomAccessControl.cancel')}</Text>
                </Button>
                <Button
                  type="submit"
                  variant="Primary"
                  size="400"
                  disabled={loading}
                  before={
                    loading ? <Spinner size="100" variant="Primary" fill="Solid" /> : undefined
                  }
                >
                  <Text size="B400">
                    {loading
                      ? t('sharedUi.roomAccessControl.sendingRequest')
                      : t('sharedUi.roomAccessControl.sendRequest')}
                  </Text>
                </Button>
              </Box>
            </Box>
          </Dialog>
        </FocusTrap>
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
