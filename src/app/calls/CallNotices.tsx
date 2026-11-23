import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import { Box, Button, Icon, IconButton, Icons, Text } from 'folds';
import classNames from 'classnames';
import { useSelectedRoom } from '../navigation/useSelectedRoom';
import { coverNoticeSlotAtom, pageNoticeSlotAtom } from '../ui/noticeSlots';
import { callPanelRoomAtom, isActiveCallShownIn, useActiveCall, useCallState } from './callStore';
import type { CallState, RoomCall } from './RoomCall';
import { useCallViewFloats } from './window/callWindowState';
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

/** Actionable notices for an interrupted screen share or dead local mic/camera. */
export function CallStopNotices({ call, state }: { call: RoomCall; state: CallState }) {
  const { t } = useTranslation();
  return (
    <>
      {state.screenShareStoppedInBackground && (
        <ActionNotice
          message={t('featureUi.calls.panel.screenShareStoppedInBackground')}
          actionLabel={t('featureUi.calls.panel.shareAgain')}
          // A rejoin drops a share started meanwhile, and the picker needs this click.
          disabled={state.phase !== 'connected'}
          onAction={() => void call.setScreenShare(true)}
          onDismiss={() => call.dismissScreenShareNotice()}
        />
      )}
      {state.microphoneStopped && (
        <ActionNotice
          message={t('featureUi.calls.panel.microphoneStopped')}
          actionLabel={t('featureUi.calls.panel.turnBackOn')}
          onAction={() => void call.setMicrophone(true)}
          onDismiss={() => call.dismissStoppedInput('microphone')}
        />
      )}
      {state.cameraStopped && (
        <ActionNotice
          message={t('featureUi.calls.panel.cameraStopped')}
          actionLabel={t('featureUi.calls.panel.turnBackOn')}
          onAction={() => void call.setCamera(true)}
          onDismiss={() => call.dismissStoppedInput('camera')}
        />
      )}
    </>
  );
}

/**
 * The stop notices while the active call's view shows nowhere (closed, or docked in a room that is
 * not on the page), on every layout: in the app's notice place (ui/noticeSlots.tsx) inside what
 * covers the page (a phone's drawer or sheet, a dialog), else in the page's.
 */
export function CallStopNoticesOutOfView() {
  const active = useActiveCall();
  const state = useCallState(active?.call);
  const panelRoomId = useAtomValue(callPanelRoomAtom);
  const here = useSelectedRoom();
  const floats = useCallViewFloats();
  const pageSlot = useAtomValue(pageNoticeSlotAtom);
  const slot = useAtomValue(coverNoticeSlotAtom) ?? pageSlot;
  const inView =
    !!panelRoomId && isActiveCallShownIn(active, panelRoomId) && (floats || here === panelRoomId);
  if (!active || inView || !slot) return null;
  return createPortal(<CallStopNotices call={active.call} state={state} />, slot);
}
