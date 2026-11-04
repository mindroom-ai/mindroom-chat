import React, { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import { EventTimeline, type MatrixClient, type Room } from 'matrix-js-sdk';
import { Box, Button, Icon, IconButton, Icons, Spinner, Text } from 'folds';
import classNames from 'classnames';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomName } from '../../hooks/useRoomMeta';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { mDirectAtom } from '../../state/mDirectList';
import { StateEvent } from '../../../types/matrix/room';
import { useCallFailureNotice } from '../../mindroom/calls/useCallFailureNotice';
import { useCallFailureDismissal } from '../../mindroom/calls/useCallFailureDismissal';
import type { CallDevices, CallProblem, CallState } from './RoomCall';
import {
  isActiveCallShownIn,
  useActiveCall,
  useCallActions,
  useCallState,
  useRoomCallMembers,
  type ActiveCall,
} from './callStore';
import { callUserIds } from './callMemberships';
import { browserSupportsCalls, useCallSupport } from './callSupport';
import { CallControl, DeviceControl } from './CallControls';
import { CallMemberAvatar, CallTile } from './CallTile';
import * as css from './CallPanel.css';

/** Members need power to publish their call membership (`org.matrix.msc3401.call.member`). */
const useCanJoinCall = (mx: MatrixClient, room: Room): boolean => {
  // Re-read when the room's power levels change.
  usePowerLevelsContext();
  const state = room.getLiveTimeline().getState(EventTimeline.FORWARDS);
  return !!state?.maySendStateEvent(StateEvent.GroupCallMemberPrefix as string, mx.getSafeUserId());
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
      {action}
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

const PROBLEM_KEYS = {
  browser: 'featureUi.call.callView.yourBrowserDoesNotSupportWebrtcWhich',
  homeserver: 'featureUi.call.callView.yourHomeserverDoesNotSupportCalling',
  service: 'featureUi.calls.problems.service',
  connection: 'featureUi.calls.problems.connection',
  device: 'featureUi.calls.problems.device',
} as const satisfies Record<CallProblem, string>;

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

/** The call this device is in: everyone's tiles, notices, and the controls. */
function JoinedCall({ active, onClose }: { active: ActiveCall; onClose: () => void }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const { call } = active;
  const state = useCallState(call);
  const phaseLabel = usePhaseLabel(state);
  const title = useRoomName(call.room);
  const { endCall, dismissCall } = useCallActions(mx);
  const joined = state.phase === 'connected' || state.phase === 'reconnecting';
  // Agents post a notice when they joined but cannot hear or speak ("Voice call error: ...").
  const failure = useCallFailureNotice(call.room, joined, active.startedAfterTs);
  const { visibleFailure, dismissFailure } = useCallFailureDismissal(joined, failure);
  const finished = state.phase === 'failed' || state.phase === 'ended';
  const agentCall = active.kind === 'agent';

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
        onClick={() => call.setMicrophone(!state.microphone)}
      />
      {!agentCall && (
        <CallControl
          label={
            state.camera
              ? t('featureUi.call.controls.stopCamera')
              : t('featureUi.call.controls.startCamera')
          }
          icon={state.camera ? Icons.VideoCamera : Icons.VideoCameraMute}
          off={!state.camera}
          onClick={() => call.setCamera(!state.camera)}
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
      <DeviceControl chosen={state.devices} onChoose={(kind, id) => call.setDevice(kind, id)} />
      <CallControl
        label={t('featureUi.call.callControls.end')}
        icon={Icons.PhoneDown}
        critical
        onClick={() => {
          endCall();
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
          {`${t('featureUi.call.callView.voiceCallError')}: ${visibleFailure.message}`}
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
              onClick={() => call.resumeAudio()}
            >
              <Text size="B300">{t('featureUi.calls.panel.playSound')}</Text>
            </Button>
          }
        >
          {t('featureUi.calls.panel.audioBlocked')}
        </Notice>
      )}
      {!finished && (
        <ul className={css.Tiles} aria-label={t('featureUi.calls.panel.participants')}>
          {state.participants.map((participant) => (
            <CallTile key={participant.key} room={call.room} participant={participant} />
          ))}
        </ul>
      )}
    </PanelShell>
  );
}

/** A room's call before this device joins it: who is in it, and Join. */
function CallPrescreen({ room, onClose }: { room: Room; onClose: () => void }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const active = useActiveCall();
  const title = useRoomName(room);
  const members = useRoomCallMembers(mx, room);
  const people = callUserIds(members);
  const support = useCallSupport(mx);
  const canJoin = useCanJoinCall(mx, room);
  const direct = useAtomValue(mDirectAtom).has(room.roomId);
  const { startCall } = useCallActions(mx);
  const [microphone, setMicrophone] = useState(true);
  const [camera, setCamera] = useState(false);
  const [devices, setDevices] = useState<CallDevices>({});
  const [joining, setJoining] = useState(false);

  // A call running elsewhere is joined through the backend it already uses.
  const supported = people.length > 0 || support === 'supported';
  let blocker: string | undefined;
  if (!browserSupportsCalls())
    blocker = t('featureUi.call.callView.yourBrowserDoesNotSupportWebrtcWhich');
  else if (!supported && support === 'unsupported') {
    blocker = t('featureUi.call.callView.yourHomeserverDoesNotSupportCalling');
  } else if (active) blocker = t('featureUi.call.callView.alreadyInAnotherCallEndTheCurrent');
  else if (!canJoin) blocker = t('featureUi.call.callView.youDonTHavePermissionToJoin');

  const join = () => {
    setJoining(true);
    startCall({
      room,
      kind: 'room',
      microphone,
      video: camera,
      devices,
      // Starting a call rings the other person of a direct chat and notifies a group.
      notify: people.length > 0 ? undefined : direct ? 'ring' : 'notification',
    }).finally(() => setJoining(false));
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
        {blocker ? (
          <Notice>{blocker}</Notice>
        ) : (
          <>
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
                off={!camera}
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
