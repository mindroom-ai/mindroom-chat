import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { Box, Button, Icon, IconButton, Icons, Spinner, Text, type IconSrc } from 'folds';
import classNames from 'classnames';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useRoomName } from '../matrix/hooks/useRoomMeta';
import { usePowerLevelsContext } from '../matrix/hooks/usePowerLevels';
import { useRoomMembers } from '../matrix/hooks/useRoomMembers';
import { mDirectAtom } from '../matrix/state/mDirectList';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { IconTooltip } from '../ui/IconTooltip';
import { ExpandIcon } from '../ui/panels/panelIcons';
import { useCallFailureNotice } from './agent/useCallFailureNotice';
import { useCallFailureDismissal } from './agent/useCallFailureDismissal';
import type { CallDevices, CallParticipant, CallProblem, CallState } from './RoomCall';
import {
  callHomeRoomId,
  callPanelRoomAtom,
  callStartProblemAtom,
  isActiveCallShownIn,
  noteCallStart,
  useActiveCall,
  useCallActions,
  useCallState,
  useRoomCallMembers,
  type ActiveCall,
  type CallOrigin,
} from './callStore';
import { callUserIds } from './callMemberships';
import { browserSharesScreens, browserSupportsCalls, useCallSupport } from './callSupport';
import { allowMembersToCall, readCallAccess, type CallAccess } from './callAccess';
import { CallControl, DeviceControl } from './CallControls';
import { CallMemberAvatar, useCallMemberProfile } from './CallTile';
import { CallStage } from './CallStage';
import { hasVideo } from './stageLayout';
import { useCallWindowFrame } from './window/callWindowFrame';
import { useCallWindowSettings } from './window/callWindowState';
import { DockIcon, FloatIcon } from './window/windowIcons';
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

/** How many of the others the minimized window's line shows. */
const BAR_FACES = 3;

type TitleButtonProps = {
  label: string;
  icon: IconSrc;
  onClick: () => void;
  variant?: 'Surface' | 'Critical';
  /** The icon points to an end of the line, so it mirrors in right-to-left languages. */
  directional?: boolean;
  className?: string;
  /** The window's line sits low on the screen by default, so its names show above it. */
  above?: boolean;
};

/** A small icon button of the title bar or the window's line, named in a tooltip. */
function TitleButton(props: TitleButtonProps) {
  const { label, icon, onClick, variant = 'Surface', directional, className, above } = props;
  return (
    <IconTooltip label={label} position={above ? 'Top' : 'Bottom'}>
      {(tipAnchor) => (
        <IconButton
          ref={tipAnchor}
          className={className}
          size="300"
          radii="300"
          variant={variant}
          aria-label={label}
          onClick={onClick}
        >
          <Icon size="200" src={icon} data-directional={directional || undefined} />
        </IconButton>
      )}
    </IconTooltip>
  );
}

/**
 * Dock, in the floating window: the call view moves into the side panel of the room it belongs to
 * (`home`), and the person goes there (to an agent call's thread) so the docked panel is seen.
 */
function DockButton({ home }: { home: CallOrigin }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useCallWindowSettings();
  const setPanelRoom = useSetAtom(callPanelRoomAtom);
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const dock = () => {
    setSettings({ ...settings, mode: 'docked' });
    // The docked panel shows in the room whose call view is open.
    setPanelRoom(home.roomId);
    if (home.threadId) navigateRoomThread(home.roomId, home.threadId);
    else navigateRoom(home.roomId);
  };
  const label = t('featureUi.calls.window.dock');
  return <TitleButton label={label} icon={DockIcon} directional onClick={dock} />;
}

/** Float, in the docked panel: the call view goes back to the floating window, where it was. */
function FloatButton() {
  const { t } = useTranslation();
  const [settings, setSettings] = useCallWindowSettings();
  const float = () => setSettings({ ...settings, mode: 'floating' });
  const label = t('featureUi.calls.window.float');
  return <TitleButton label={label} icon={FloatIcon} directional onClick={float} />;
}

/**
 * Back to the conversation an agent call started from. On phones the call view covers that
 * conversation, so it closes there (the call goes on, and the rail's call button brings it back).
 */
function ConversationButton({ origin, onClose }: { origin: CallOrigin; onClose: () => void }) {
  const { t } = useTranslation();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const open = () => {
    if (origin.threadId) navigateRoomThread(origin.roomId, origin.threadId);
    else navigateRoom(origin.roomId);
    if (phone) onClose();
  };
  return (
    <TitleButton
      label={t('featureUi.calls.window.openConversation')}
      icon={Icons.Message}
      onClick={open}
    />
  );
}

/** What the window's one-line bar shows between the title and Expand. */
type BarContent = { faces?: ReactNode; controls?: ReactNode };

/**
 * The panel's frame: a title with the call's status under it, the body, and a control bar. In the
 * floating window its title bar moves the window, and minimized the window shows one line: the
 * others' faces, the title and status, `bar.controls`, and Expand.
 */
type PanelShellProps = {
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  /** The room (and thread) the call view docks into. */
  home: CallOrigin;
  /** The title bar's buttons before the window's own: speaker view, the conversation. */
  actions?: ReactNode;
  bar?: BarContent;
};

function PanelShell(props: PanelShellProps) {
  const { title, subtitle, footer, children, onClose, home, actions, bar } = props;
  const { t } = useTranslation();
  const frame = useCallWindowFrame();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  // A call not joined yet shows only its title and Expand in the window's line.
  const status = frame?.bar && !bar ? undefined : subtitle;
  const heading = (
    <div className={css.HeaderTitle}>
      <Text as="h2" size="H4" truncate>
        {title}
      </Text>
      {status && (
        <Text size="T200" priority="300" truncate aria-live="polite">
          {status}
        </Text>
      )}
    </div>
  );
  const panelClass = classNames(css.Panel, frame && css.InWindow);

  // Minimize and Expand go with the line they are on; the focus they had moves to the handle that
  // takes their place rather than to the page.
  const sectionRef = useRef<HTMLElement>(null);
  const inBar = !!frame?.bar;
  const wasBar = useRef(inBar);
  useEffect(() => {
    if (wasBar.current === inBar) return;
    wasBar.current = inBar;
    if (document.activeElement && document.activeElement !== document.body) return;
    sectionRef.current?.querySelector<HTMLElement>('[data-call-window-handle]')?.focus();
  }, [inBar]);

  if (frame?.bar) {
    return (
      <section ref={sectionRef} className={panelClass} aria-label={title} data-testid="call-panel">
        <div className={css.Bar} {...frame.handleProps}>
          {bar?.faces}
          {heading}
          {bar?.controls}
          <TitleButton
            label={t('featureUi.calls.window.expand')}
            icon={ExpandIcon}
            onClick={frame.expand}
            above
          />
        </div>
      </section>
    );
  }
  return (
    <section ref={sectionRef} className={panelClass} aria-label={title} data-testid="call-panel">
      <header className={classNames(css.Header, frame && css.WindowHeader)} {...frame?.handleProps}>
        {heading}
        <div className={css.HeaderButtons}>
          {actions}
          {/* Phones show the call view in the room's side panel only. */}
          {!phone && (frame ? <DockButton home={home} /> : <FloatButton />)}
          {frame && (
            <TitleButton
              label={t('featureUi.calls.window.minimize')}
              icon={Icons.Minus}
              onClick={frame.minimize}
            />
          )}
          <TitleButton
            label={t('featureUi.calls.panel.close')}
            icon={Icons.Cross}
            onClick={onClose}
          />
        </div>
      </header>
      <div className={css.Body}>{children}</div>
      {footer}
    </section>
  );
}

/** One of the others in the window's line, ringed while they talk. */
function BarFace({ room, userId, speaking }: { room: Room; userId: string; speaking: boolean }) {
  const { name } = useCallMemberProfile(room, userId);
  return (
    <li className={css.BarFace} data-speaking={speaking} aria-label={name}>
      <CallMemberAvatar room={room} userId={userId} size="200" />
    </li>
  );
}

/** The first few others in the call, one face per person whatever their devices. */
const barFaces = (participants: CallParticipant[]) => {
  const speaking = new Map<string, boolean>();
  participants.forEach(({ local, userId, speaking: talks }) => {
    if (!local) speaking.set(userId, (speaking.get(userId) ?? false) || talks);
  });
  return [...speaking].slice(0, BAR_FACES).map(([userId, talks]) => ({ userId, talks }));
};

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
  // The person's pick; a shared screen or tiles too small for the grid show speaker view anyway.
  const [speakerView, setSpeakerView] = useState(false);
  const video = !finished && hasVideo(state.participants);

  const microphoneLabel = state.microphone
    ? t('featureUi.call.controls.turnOffMicrophone')
    : t('featureUi.call.controls.turnOnMicrophone');
  const microphoneIcon = state.microphone ? Icons.Mic : Icons.MicMute;
  const toggleMicrophone = () => void call.setMicrophone(!state.microphone);
  const leaveLabel = t('featureUi.call.callControls.end');
  const leave = () => {
    // The call is over for this device either way; a failed leave leaves nothing to do.
    endCall().catch(() => undefined);
  };

  const controls = finished ? (
    <div className={css.Controls}>
      <Button size="400" radii="Pill" variant="Secondary" fill="Soft" onClick={dismissCall}>
        <Text size="B400">{t('featureUi.calls.panel.dismiss')}</Text>
      </Button>
    </div>
  ) : (
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
      <DeviceControl
        chosen={state.devices}
        onChoose={(kind, id) => void call.setDevice(kind, id)}
      />
      <CallControl label={leaveLabel} icon={Icons.PhoneDown} critical onClick={leave} />
    </div>
  );

  const actions = (
    <>
      {video && (
        <TitleButton
          className={css.SpeakerSwitch}
          label={
            speakerView
              ? t('featureUi.calls.window.gridView')
              : t('featureUi.calls.window.speakerView')
          }
          icon={speakerView ? Icons.Category : Icons.User}
          onClick={() => setSpeakerView((picked) => !picked)}
        />
      )}
      {active.origin && <ConversationButton origin={active.origin} onClose={onClose} />}
    </>
  );
  const bar: BarContent = {
    faces: (
      <ul className={css.BarFaces} aria-label={t('featureUi.calls.panel.participants')}>
        {barFaces(state.participants).map(({ userId, talks }) => (
          <BarFace key={userId} room={call.room} userId={userId} speaking={talks} />
        ))}
      </ul>
    ),
    controls: !finished && (
      <>
        <TitleButton
          label={microphoneLabel}
          icon={microphoneIcon}
          variant={state.microphone ? 'Surface' : 'Critical'}
          onClick={toggleMicrophone}
          above
        />
        <TitleButton
          label={leaveLabel}
          icon={Icons.PhoneDown}
          variant="Critical"
          onClick={leave}
          above
        />
      </>
    ),
  };

  return (
    <PanelShell
      title={title}
      subtitle={phaseLabel}
      onClose={onClose}
      footer={controls}
      home={{ roomId: callHomeRoomId(active), threadId: active.origin?.threadId }}
      actions={actions}
      bar={bar}
    >
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
          speakerView={speakerView}
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
