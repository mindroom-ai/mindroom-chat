import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom, useAtomValue, useStore } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { Box, Button, Icon, IconButton, Icons, Spinner, Text } from 'folds';
import classNames from 'classnames';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useRoomName } from '../matrix/hooks/useRoomMeta';
import { usePowerLevelsContext } from '../matrix/hooks/usePowerLevels';
import { useRoomMembers } from '../matrix/hooks/useRoomMembers';
import { mDirectAtom } from '../matrix/state/mDirectList';
import { useCallFailureNotice } from './agent/useCallFailureNotice';
import { useCallFailureDismissal } from './agent/useCallFailureDismissal';
import type { CallDevices, CallParticipant, CallProblem, CallState } from './RoomCall';
import {
  callStartProblemAtom,
  isActiveCallShownIn,
  noteCallStart,
  useActiveCall,
  useCallActions,
  useCallState,
  useRoomCallMembers,
  type ActiveCall,
} from './callStore';
import { callUserIds } from './callMemberships';
import { browserSharesScreens, browserSupportsCalls, useCallSupport } from './callSupport';
import { allowMembersToCall, readCallAccess, type CallAccess } from './callAccess';
import { CallControl, DeviceControl } from './CallControls';
import { CallMemberAvatar } from './CallTile';
import { CallStage } from './CallStage';
import * as css from './CallPanel.css';
import { revealDirectionControls } from '../ui/directional';

/** The access of a call this device is in, where it shows no access notice (agent calls). */
const NOT_READ: CallAccess = { canJoin: true, canLetMembersIn: false };

/**
 * Members need power to publish their call membership (`org.matrix.msc3401.call.member`). Read
 * again only when the room's power levels or members change, not on every change of the call
 * (active speakers change several times a second).
 */
const useCallAccess = (mx: MatrixClient, room: Room, needed = true): CallAccess => {
  // Followed for its changes only: the checks read the levels from the room's state.
  const levels = usePowerLevelsContext();
  const knownMembers = useRoomMembers(mx, room.roomId);
  return useMemo(() => {
    void levels;
    if (!needed) return NOT_READ;
    return readCallAccess(room, mx.getSafeUserId(), knownMembers);
  }, [levels, knownMembers, mx, needed, room]);
};

function Notice({
  children,
  critical,
  action,
}: {
  children: ReactNode;
  critical?: boolean;
  action?: ReactNode;
}) {
  return (
    <div
      className={classNames(css.Notice, critical && css.NoticeCritical)}
      role={critical ? 'alert' : 'status'}
    >
      <Icon size="200" src={Icons.Warning} />
      <Text className={css.NoticeText} size="T300">
        {children}
      </Text>
      {action && <span className={css.NoticeAction}>{action}</span>}
    </div>
  );
}

/** The panel's frame: a title with the call's status under it, the body, and a control bar. */
type PanelShellProps = {
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  children: ReactNode;
  onClose: () => void;
};

function PanelShell(props: PanelShellProps) {
  const { title, subtitle, footer, children, onClose } = props;
  const closeLabel = useTranslation().t('featureUi.calls.panel.close');
  return (
    <section className={css.Panel} aria-label={title} data-testid="call-panel">
      <header className={css.Header}>
        <div className={css.HeaderTitle}>
          <Text as="h2" size="H4" truncate>
            {title}
          </Text>
          {subtitle && (
            <Text size="T200" priority="300" truncate aria-live="polite">
              {subtitle}
            </Text>
          )}
        </div>
        <IconButton
          size="300"
          radii="300"
          variant="Surface"
          aria-label={closeLabel}
          onClick={onClose}
        >
          <Icon size="200" src={Icons.Cross} />
        </IconButton>
      </header>
      <div className={css.Body}>{children}</div>
      {footer}
    </section>
  );
}

/**
 * For those who may change it: members of the room cannot join its calls (rooms made with the
 * `private_chat` preset keep call membership at the moderator level), and one click lets them.
 */
function MembersCannotCallNotice({ room }: { room: Room }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const allow = () => {
    setSaving(true);
    setFailed(false);
    allowMembersToCall(mx, room)
      .catch(() => setFailed(true))
      .finally(() => setSaving(false));
  };
  return (
    <Notice
      action={
        <Button
          size="300"
          radii="300"
          variant="Warning"
          fill="Solid"
          disabled={saving}
          onClick={allow}
        >
          <Text size="B300">{t('featureUi.calls.access.allowMembers')}</Text>
        </Button>
      }
    >
      {failed
        ? t(
            'featureUi.commonSettings.permissions.permissionGroups.failedToApplyChangesPleaseTryAgain'
          )
        : t('featureUi.calls.access.membersCannotJoin')}
    </Notice>
  );
}

const PROBLEM_KEYS = {
  browser: 'featureUi.call.callView.yourBrowserDoesNotSupportWebrtcWhich',
  homeserver: 'featureUi.call.callView.yourHomeserverDoesNotSupportCalling',
  untrustedService: 'featureUi.calls.problems.untrustedService',
  service: 'featureUi.calls.problems.service',
  connection: 'featureUi.calls.problems.connection',
  device: 'featureUi.calls.problems.device',
} as const satisfies Record<CallProblem, string>;

/** MindRoom starts its notices with "Voice call error:"; the panel names the error itself. */
const withoutErrorPrefix = (message: string) => message.replace(/^voice call error:\s*/i, '');

/** The panel's status line: how the connection goes, then how many people are in. */
const usePhaseLabel = (state: CallState): string | undefined => {
  const { t } = useTranslation();
  if (state.phase === 'connecting') return t('featureUi.calls.panel.connecting');
  if (state.phase === 'reconnecting') return t('featureUi.calls.panel.reconnecting');
  if (state.phase === 'ended') return t('featureUi.calls.panel.ended');
  if (state.phase === 'failed') return undefined;
  const people = new Set(state.participants.map((participant) => participant.userId)).size;
  return t('featureUi.calls.panel.inCall', { count: people });
};

/** The call this device is in: notices, the stage, and the controls. */
function JoinedCall({ active, onClose }: { active: ActiveCall; onClose: () => void }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const { call } = active;
  const state = useCallState(call);
  const phaseLabel = usePhaseLabel(state);
  const title = revealDirectionControls(useRoomName(call.room));
  const { endCall, dismissCall } = useCallActions(mx);
  const joined = state.phase === 'connected' || state.phase === 'reconnecting';
  // Agents post a notice when they joined but cannot hear or speak ("Voice call error: ...").
  const failure = useCallFailureNotice(call.room, joined, active.startedAfterTs);
  const { visibleFailure, dismissFailure } = useCallFailureDismissal(joined, failure);
  const finished = state.phase === 'failed' || state.phase === 'ended';
  const agentCall = active.kind === 'agent';
  const access = useCallAccess(mx, call.room, !agentCall && !finished);
  // The called agent shows from the start, waiting until it joins: a call in which nobody seems
  // to be coming gets ended before the agent arrives.
  const { agentUserId } = active;
  const awaitedAgent: CallParticipant | undefined =
    agentCall && agentUserId && !state.participants.some(({ userId }) => userId === agentUserId)
      ? {
          key: `awaited:${agentUserId}`,
          userId: agentUserId,
          deviceId: '',
          local: false,
          connected: false,
          speaking: false,
          microphone: true,
        }
      : undefined;

  const controls = finished ? (
    <div className={css.Controls}>
      <Button size="400" radii="Pill" variant="Secondary" fill="Soft" onClick={dismissCall}>
        <Text size="B400">{t('featureUi.calls.panel.dismiss')}</Text>
      </Button>
    </div>
  ) : (
    <div className={css.Controls} role="toolbar" aria-label={title}>
      <CallControl
        label={
          state.microphone
            ? t('featureUi.call.controls.turnOffMicrophone')
            : t('featureUi.call.controls.turnOnMicrophone')
        }
        icon={state.microphone ? Icons.Mic : Icons.MicMute}
        off={!state.microphone}
        onClick={() => void call.setMicrophone(!state.microphone)}
      />
      <CallControl
        label={
          state.camera
            ? t('featureUi.call.controls.stopCamera')
            : t('featureUi.call.controls.startCamera')
        }
        icon={state.camera ? Icons.VideoCamera : Icons.VideoCameraMute}
        onClick={() => void call.setCamera(!state.camera)}
      />
      {browserSharesScreens() && (
        <CallControl
          label={
            state.screenShare
              ? t('featureUi.call.controls.stopScreenshare')
              : t('featureUi.call.controls.startScreenshare')
          }
          icon={Icons.ScreenShare}
          pressed={state.screenShare}
          onClick={() => void call.setScreenShare(!state.screenShare)}
        />
      )}
      <CallControl
        label={
          state.sound
            ? t('featureUi.call.controls.turnOffSound')
            : t('featureUi.call.controls.turnOnSound')
        }
        icon={state.sound ? Icons.Headphone : Icons.HeadphoneMute}
        off={!state.sound}
        onClick={() => call.setSound(!state.sound)}
      />
      <DeviceControl
        chosen={state.devices}
        onChoose={(kind, id) => void call.setDevice(kind, id)}
      />
      <CallControl
        label={t('featureUi.call.callControls.end')}
        icon={Icons.PhoneDown}
        critical
        onClick={() => {
          // The call is over for this device either way; a failed leave leaves nothing to do.
          endCall().catch(() => undefined);
        }}
      />
    </div>
  );

  return (
    <PanelShell title={title} subtitle={phaseLabel} onClose={onClose} footer={controls}>
      {state.problem && (
        <Notice critical={state.phase === 'failed'}>{t(PROBLEM_KEYS[state.problem])}</Notice>
      )}
      {visibleFailure && (
        <Notice
          critical
          action={
            <IconButton
              size="300"
              radii="300"
              variant="Critical"
              aria-label={t('featureUi.call.callView.dismissVoiceCallError')}
              onClick={dismissFailure}
            >
              <Icon size="100" src={Icons.Cross} />
            </IconButton>
          }
        >
          {`${t('featureUi.call.callView.voiceCallError')}: ${withoutErrorPrefix(
            visibleFailure.message
          )}`}
        </Notice>
      )}
      {state.audioBlocked && (
        <Notice
          action={
            <Button
              size="300"
              radii="300"
              variant="Warning"
              fill="Solid"
              onClick={() => void call.resumeAudio()}
            >
              <Text size="B300">{t('featureUi.calls.panel.playSound')}</Text>
            </Button>
          }
        >
          {t('featureUi.calls.panel.audioBlocked')}
        </Notice>
      )}
      {access.canLetMembersIn && <MembersCannotCallNotice room={call.room} />}
      {!finished && (
        <CallStage
          room={call.room}
          participants={state.participants}
          awaited={awaitedAgent}
          speakerView={false}
          microphone={state.microphone}
        />
      )}
    </PanelShell>
  );
}

/** A room's call before this device joins it: who is in it, and Join. */
function CallPrescreen({ room, onClose }: { room: Room; onClose: () => void }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const active = useActiveCall();
  const title = revealDirectionControls(useRoomName(room));
  const members = useRoomCallMembers(mx, room);
  const people = callUserIds(members);
  const support = useCallSupport(mx);
  const access = useCallAccess(mx, room);
  const direct = useAtomValue(mDirectAtom).has(room.roomId);
  const store = useStore();
  const { startCall } = useCallActions(mx);
  const [microphone, setMicrophone] = useState(true);
  const [camera, setCamera] = useState(false);
  const [devices, setDevices] = useState<CallDevices>({});
  const [joining, setJoining] = useState(false);
  // Why the last Join (or Answer on a ring) did not start the call: this session's other tab is
  // in a call (it shares this device), or the call could not start at all.
  const [lastStart, setLastStart] = useAtom(callStartProblemAtom);
  const startProblem = lastStart?.roomId === room.roomId ? lastStart.result : undefined;
  // It belongs to this opening of the panel: closed and opened again, the panel starts afresh.
  useEffect(
    () => () => setLastStart((last) => (last?.roomId === room.roomId ? undefined : last)),
    [room.roomId, setLastStart]
  );

  let blocker: string | undefined;
  if (!browserSupportsCalls())
    blocker = t('featureUi.call.callView.yourBrowserDoesNotSupportWebrtcWhich');
  // Calls run only on this deployment's own backend, also one someone else started there
  // (RoomCall.join refuses a backend a room member named).
  else if (support === 'unsupported') {
    blocker = t('featureUi.call.callView.yourHomeserverDoesNotSupportCalling');
  } else if (active) blocker = t('featureUi.call.callView.alreadyInAnotherCallEndTheCurrent');
  else if (!access.canJoin) blocker = t('featureUi.call.callView.youDonTHavePermissionToJoin');

  const join = () => {
    setJoining(true);
    setLastStart(undefined);
    void startCall({
      room,
      kind: 'room',
      microphone,
      video: camera,
      devices,
      // Starting a call rings the other person of a direct chat and notifies a group.
      notify: people.length > 0 ? undefined : direct ? 'ring' : 'notification',
    })
      .then((result) => {
        noteCallStart(store, mx, room.roomId, result);
      })
      .finally(() => setJoining(false));
  };

  return (
    <PanelShell
      title={title}
      subtitle={
        people.length > 0 ? t('featureUi.calls.panel.inCall', { count: people.length }) : undefined
      }
      onClose={onClose}
    >
      <div className={css.Prescreen}>
        {people.length > 0 ? (
          <div
            className={css.Faces}
            aria-label={t('featureUi.calls.panel.participants')}
            role="list"
          >
            {people.map((userId) => (
              <div key={userId} role="listitem">
                <CallMemberAvatar room={room} userId={userId} size="400" />
              </div>
            ))}
          </div>
        ) : (
          <Icon size="600" src={Icons.Phone} />
        )}
        <Text size="T400" priority="400">
          {people.length > 0
            ? t('featureUi.calls.panel.inCall', { count: people.length })
            : t('featureUi.call.callView.voiceChatSEmptyBeTheFirst')}
        </Text>
        {!blocker && access.canLetMembersIn && <MembersCannotCallNotice room={room} />}
        {blocker ? (
          <Notice>{blocker}</Notice>
        ) : (
          <>
            {startProblem && (
              <Notice>
                {startProblem === 'busy'
                  ? t('featureUi.call.callView.alreadyInAnotherCallEndTheCurrent')
                  : t(PROBLEM_KEYS.service)}
              </Notice>
            )}
            <Box gap="200" alignItems="Center" justifyContent="Center" wrap="Wrap">
              <CallControl
                label={
                  microphone
                    ? t('featureUi.call.controls.turnOffMicrophone')
                    : t('featureUi.call.controls.turnOnMicrophone')
                }
                icon={microphone ? Icons.Mic : Icons.MicMute}
                off={!microphone}
                pressed={microphone}
                onClick={() => setMicrophone((on) => !on)}
              />
              <CallControl
                label={
                  camera
                    ? t('featureUi.call.controls.stopCamera')
                    : t('featureUi.call.controls.startCamera')
                }
                icon={camera ? Icons.VideoCamera : Icons.VideoCameraMute}
                pressed={camera}
                onClick={() => setCamera((on) => !on)}
              />
              <DeviceControl
                chosen={devices}
                onChoose={(kind, id) => setDevices((chosen) => ({ ...chosen, [kind]: id }))}
              />
            </Box>
            <Button
              size="400"
              radii="Pill"
              variant="Success"
              fill="Solid"
              disabled={joining || support === 'checking'}
              before={
                joining ? (
                  <Spinner size="100" variant="Success" fill="Solid" />
                ) : (
                  <Icon size="100" src={Icons.Phone} />
                )
              }
              onClick={join}
            >
              <Text size="B400">{t('featureUi.call.prescreenControls.join')}</Text>
            </Button>
          </>
        )}
      </div>
    </PanelShell>
  );
}

/**
 * The room's call panel. It shows the call this device is in when that call belongs here (the
 * room's own call, or an agent call started from this room), and otherwise the room's call to join.
 */
export function CallPanel({ room, onClose }: { room: Room; onClose: () => void }) {
  const active = useActiveCall();
  if (active && isActiveCallShownIn(active, room.roomId)) {
    return <JoinedCall active={active} onClose={onClose} />;
  }
  return <CallPrescreen room={room} onClose={onClose} />;
}
