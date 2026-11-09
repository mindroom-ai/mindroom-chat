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
import type { CallParticipant, CallProblem, CallState } from './RoomCall';
import {
  callHomeRoomId,
  callPanelRoomAtom,
  callStartProblemAtom,
  isActiveCallShownIn,
  noteCallStart,
  useActiveCall,
  useCallActions,
  useCallState,
  useCallViewState,
  useRoomCallMembers,
  type ActiveCall,
  type PrescreenChoices,
} from './callStore';
import { callUserIds } from './callMemberships';
import { browserSharesScreens, browserSupportsCalls, useCallSupport } from './callSupport';
import { allowMembersToCall, readCallAccess, type CallAccess } from './callAccess';
import { CallControl, DeviceControl } from './CallControls';
import { CallMemberAvatar } from './CallTile';
import { CallStage } from './CallStage';
import { hasVideo, pickScope, type StageView } from './stageLayout';
import {
  BarFaces,
  CallViewChrome,
  ConversationButton,
  TitleButton,
  type BarContent,
} from './CallViewChrome';
import { useCallWindowFrame } from './window/callWindowFrame';
import { WindowTranscript } from './window/WindowTranscript';
import { TranscriptionControls, TranscriptionStatus } from './transcription/TranscriptionControls';
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

/** Whether the primary pointer is a finger, which the bar's call controls are bigger for. */
const coarsePointer = (): boolean => globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;

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
  const frame = useCallWindowFrame();
  const inWindow = !!frame;
  const access = useCallAccess(mx, call.room, !agentCall && !finished);
  // The notices to act on show in the expanded view only, so a window minimized to its bar
  // expands when one comes up: the agent cannot hear or speak, or the browser blocked the sound.
  // Minimized again while it stands, the window stays a bar.
  const expandWindow = frame?.expand;
  const failureId = visibleFailure?.eventId;
  useEffect(() => {
    if (failureId || state.audioBlocked) expandWindow?.();
  }, [expandWindow, failureId, state.audioBlocked]);
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
  // Who the bar's faces show: everyone in the call and, as on the stage, the agent it waits for.
  const shownPeople = awaitedAgent ? [...state.participants, awaitedAgent] : state.participants;
  // The person's pick of speaker view or the grid, for the call and, while someone else shares a
  // screen, for the screens shared then: new shares open at the stage's default (speaker view for
  // someone else's one screen) until picked again. Kept with the call, so it stays wherever the
  // view moves. The stage says what it shows, which the switch shows, and holds it there while
  // tiles would be too small for the grid.
  const [picks, changePicks] = useCallViewState(callHomeRoomId(active));
  const scope = pickScope(state.participants);
  const screensPick = picks.screens?.scope === scope ? picks.screens.speaker : undefined;
  const screensChanged = !!picks.screens && screensPick === undefined;
  useEffect(() => {
    if (screensChanged) changePicks((last) => ({ ...last, screens: undefined }));
  }, [changePicks, screensChanged]);
  const speakerView = scope ? screensPick : picks.speaker;
  const [stageView, setStageView] = useState<StageView>({ speaker: false, held: false });
  const toggleSpeakerView = () => {
    const speaker = !stageView.speaker;
    changePicks((last) =>
      scope ? { ...last, screens: { scope, speaker } } : { ...last, speaker }
    );
  };
  const video = !finished && hasVideo(state.participants);

  const microphoneLabel = state.microphone
    ? t('featureUi.call.controls.turnOffMicrophone')
    : t('featureUi.call.controls.turnOnMicrophone');
  const microphoneIcon = state.microphone ? Icons.Mic : Icons.MicMute;
  const toggleMicrophone = () => void call.setMicrophone(!state.microphone);
  const leaveLabel = t('featureUi.call.callControls.end');
  const barControlSize = coarsePointer() ? '400' : '300';
  const leave = () => {
    // The call is over for this device either way; a failed leave leaves nothing to do.
    endCall().catch(() => undefined);
  };

  const dismissLabel = t('featureUi.calls.panel.dismiss');
  const controls = finished ? (
    <div className={css.ControlBar}>
      <div className={css.Controls}>
        <Button size="400" radii="Pill" variant="Secondary" fill="Soft" onClick={dismissCall}>
          <Text size="B400">{dismissLabel}</Text>
        </Button>
      </div>
    </div>
  ) : (
    <div className={css.ControlBar}>
      {/* Who paused the transcript, or that transcripts are unavailable (the call goes on). */}
      {!agentCall && <TranscriptionStatus room={call.room} />}
      <div className={css.Controls} role="toolbar" aria-label={title}>
        <CallControl
          label={microphoneLabel}
          icon={microphoneIcon}
          off={!state.microphone}
          onClick={toggleMicrophone}
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
        {!agentCall && <TranscriptionControls room={call.room} />}
        <DeviceControl
          chosen={state.devices}
          onChoose={(kind, id) => void call.setDevice(kind, id)}
        />
        <CallControl label={leaveLabel} icon={Icons.PhoneDown} critical onClick={leave} />
      </div>
    </div>
  );

  const actions = (
    <>
      {video && (
        <TitleButton
          className={css.SpeakerSwitch}
          label={t('featureUi.calls.window.speakerView')}
          icon={Icons.User}
          pressed={stageView.speaker}
          held={stageView.held}
          onClick={toggleSpeakerView}
        />
      )}
      {active.origin && <ConversationButton origin={active.origin} onClose={onClose} />}
    </>
  );
  const stage = !finished && (
    <CallStage
      room={call.room}
      participants={state.participants}
      awaited={awaitedAgent}
      speakerView={speakerView}
      microphone={state.microphone}
      onViewChange={setStageView}
    />
  );
  // In the floating window the live transcript can show with the stage; agent calls have none.
  const transcribable = stage && inWindow && !agentCall;
  const stageArea = transcribable ? (
    <WindowTranscript room={call.room}>{stage}</WindowTranscript>
  ) : (
    stage
  );
  const problem = state.problem && t(PROBLEM_KEYS[state.problem]);
  const bar: BarContent = {
    faces: <BarFaces room={call.room} people={shownPeople} />,
    // A finished call stays until it is closed: a failed one answers every new start busy till
    // then. The bar says what went wrong as the expanded view's notice does: why the call stopped,
    // or why the microphone it just turned on stays off.
    status: problem,
    closes: finished,
    controls: finished ? (
      <Button size="300" radii="300" variant="Secondary" fill="Soft" onClick={dismissCall}>
        <Text size="B300">{dismissLabel}</Text>
      </Button>
    ) : (
      <>
        <TitleButton
          label={microphoneLabel}
          icon={microphoneIcon}
          variant={state.microphone ? 'Surface' : 'Critical'}
          onClick={toggleMicrophone}
          size={barControlSize}
          above
        />
        <TitleButton
          label={leaveLabel}
          icon={Icons.PhoneDown}
          variant="Critical"
          size={barControlSize}
          onClick={leave}
          above
        />
      </>
    ),
  };

  return (
    <CallViewChrome
      title={title}
      subtitle={phaseLabel}
      onClose={onClose}
      footer={controls}
      home={{ roomId: callHomeRoomId(active), threadId: active.origin?.threadId }}
      actions={actions}
      bar={bar}
    >
      {problem && <Notice critical={state.phase === 'failed'}>{problem}</Notice>}
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
      {stageArea}
    </CallViewChrome>
  );
}

/** The prescreen's microphone, camera and devices until they are picked: the microphone on. */
const FIRST_CHOICES: PrescreenChoices = { microphone: true, camera: false, devices: {} };

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
  // Kept with the room's call view, so they stay as picked wherever the prescreen mounts anew.
  const [view, changeView] = useCallViewState(room.roomId);
  const { microphone, camera, devices } = view.prescreen ?? FIRST_CHOICES;
  const choose = (change: (last: PrescreenChoices) => Partial<PrescreenChoices>) =>
    changeView((last) => {
      const from = last.prescreen ?? FIRST_CHOICES;
      return { ...last, prescreen: { ...from, ...change(from) } };
    });
  const [joining, setJoining] = useState(false);
  // Why the last Join (or Answer on a ring) did not start the call: this session's other tab is
  // in a call (it shares this device), or the call could not start at all.
  const [lastStart, setLastStart] = useAtom(callStartProblemAtom);
  const startProblem = lastStart?.roomId === room.roomId ? lastStart.result : undefined;
  // It belongs to this opening of the call view: closed and opened again, the view starts
  // afresh. A prescreen that only moves (Dock, Float) unmounts with the view still open.
  useEffect(
    () => () => {
      if (store.get(callPanelRoomAtom) === room.roomId) return;
      setLastStart((last) => (last?.roomId === room.roomId ? undefined : last));
    },
    [room.roomId, setLastStart, store]
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
    <CallViewChrome
      title={title}
      subtitle={
        people.length > 0 ? t('featureUi.calls.panel.inCall', { count: people.length }) : undefined
      }
      onClose={onClose}
      home={{ roomId: room.roomId }}
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
                onClick={() => choose((last) => ({ microphone: !last.microphone }))}
              />
              <CallControl
                label={
                  camera
                    ? t('featureUi.call.controls.stopCamera')
                    : t('featureUi.call.controls.startCamera')
                }
                icon={camera ? Icons.VideoCamera : Icons.VideoCameraMute}
                pressed={camera}
                onClick={() => choose((last) => ({ camera: !last.camera }))}
              />
              <DeviceControl
                chosen={devices}
                onChoose={(kind, id) =>
                  choose((last) => ({ devices: { ...last.devices, [kind]: id } }))
                }
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
    </CallViewChrome>
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
