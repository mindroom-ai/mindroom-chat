import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Icon, IconButton, Icons, Text } from 'folds';
import classNames from 'classnames';
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
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  const actionButton = (
    <Button size="300" radii="300" variant="Warning" fill="Solid" onClick={onAction}>
      <Text size="B300">{actionLabel}</Text>
    </Button>
  );
  return (
    <Notice
      action={
        onDismiss ? (
          <Box gap="100" alignItems="Center">
            {actionButton}
            <IconButton
              size="300"
              radii="300"
              variant="Warning"
              aria-label={t('mindroomUi.notices.dismiss')}
              onClick={onDismiss}
            >
              <Icon size="100" src={Icons.Cross} />
            </IconButton>
          </Box>
        ) : (
          actionButton
        )
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
