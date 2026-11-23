import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import { Box, Button, Icon, IconButton, Icons, Text } from 'folds';
import classNames from 'classnames';
import { coverNoticeSlotAtom, pageNoticeSlotAtom } from '../ui/noticeSlots';
import { callNoticesInViewAtom, useActiveCall, useCallState } from './callStore';
import type { CallState, RoomCall } from './RoomCall';
import * as css from './CallPanel.css';

export function Notice({
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

export function ActionNotice({
  message,
  actionLabel,
  onAction,
  onDismiss,
  disabled,
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
  onDismiss?: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Notice
      action={
        <Box gap="100" alignItems="Center">
          <Button
            size="300"
            radii="300"
            variant="Warning"
            fill="Solid"
            disabled={disabled}
            onClick={onAction}
          >
            <Text size="B300">{actionLabel}</Text>
          </Button>
          {onDismiss && (
            <IconButton
              size="300"
              radii="300"
              variant="Warning"
              aria-label={t('mindroomUi.notices.dismiss')}
              onClick={onDismiss}
            >
              <Icon size="100" src={Icons.Cross} />
            </IconButton>
          )}
        </Box>
      }
    >
      {message}
    </Notice>
  );
}

// The stop notices in the order they show, each under the name of its text. `act` runs in the
// click itself: the screen picker needs the gesture.
const STOP_NOTICES = [
  {
    flag: 'microphoneStopped',
    act: (call: RoomCall) => call.setMicrophone(true),
    dismiss: (call: RoomCall) => call.dismissStoppedInput('microphone'),
  },
  {
    flag: 'cameraStopped',
    act: (call: RoomCall) => call.setCamera(true),
    dismiss: (call: RoomCall) => call.dismissStoppedInput('camera'),
  },
  {
    flag: 'screenShareStoppedInBackground',
    act: (call: RoomCall) => call.setScreenShare(true),
    dismiss: (call: RoomCall) => call.dismissScreenShareNotice(),
  },
] as const;

/** Actionable notices for an interrupted screen share or dead local mic/camera. */
export function CallStopNotices({ call, state }: { call: RoomCall; state: CallState }) {
  const { t } = useTranslation();
  return STOP_NOTICES.filter(({ flag }) => state[flag]).map(({ flag, act, dismiss }) => {
    const share = flag === 'screenShareStoppedInBackground';
    return (
      <ActionNotice
        key={flag}
        message={t(`featureUi.calls.panel.${flag}`)}
        actionLabel={t(`featureUi.calls.panel.${share ? 'shareAgain' : 'turnBackOn'}`)}
        // A rejoin drops a share started meanwhile.
        disabled={share && state.phase !== 'connected'}
        onAction={() => void act(call)}
        onDismiss={() => dismiss(call)}
      />
    );
  });
}

/**
 * The stop notices while no call view shows them (closed, in another room, minimized, folded, or
 * under what covers the page): in the app's notice place (ui/noticeSlots.tsx) inside that cover,
 * else the page's.
 */
export function CallStopNoticesOutOfView() {
  const active = useActiveCall();
  const state = useCallState(active?.call);
  const inView = useAtomValue(callNoticesInViewAtom);
  const pageSlot = useAtomValue(pageNoticeSlotAtom);
  const slot = useAtomValue(coverNoticeSlotAtom) ?? pageSlot;
  if (!active || inView || !slot) return null;
  return createPortal(<CallStopNotices call={active.call} state={state} />, slot);
}
