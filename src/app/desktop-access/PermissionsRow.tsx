import { useState } from 'react';
import classNames from 'classnames';
import { Box, Button, Icon, Icons, Spinner, Text, color } from 'folds';
import type { DesktopAccessSnapshot } from '../lib/desktopBridge';
import { errorMessage } from '../lib/errorMessage';
import { requireDesktopAccess, unwrapDesktopResult } from './desktopAccessController';
import { useDesktopT } from './desktopAccessHelpers';
import * as css from './desktopAccess.css';

type PermissionsRowProps = {
  snapshot: DesktopAccessSnapshot;
  /** Always render live permission statuses (for Settings -> This Mac). Defaults to hiding when all granted. */
  showWhenAllGranted?: boolean;
  onSnapshot?: (snapshot: DesktopAccessSnapshot) => void;
};

/** Zero-nag macOS Accessibility and Screen Recording permission controls. */
export function PermissionsRow({
  snapshot,
  showWhenAllGranted = false,
  onSnapshot,
}: PermissionsRowProps) {
  const dt = useDesktopT();
  const [busyAction, setBusyAction] = useState<'accessibility' | 'screen_recording' | 'relaunch'>();
  const [error, setError] = useState<string | null>(null);

  const accessibilityGranted = snapshot.permissions.accessibility === 'granted';
  const screenRecordingGranted = snapshot.permissions.screen_recording === 'granted';

  if (
    !showWhenAllGranted &&
    accessibilityGranted &&
    screenRecordingGranted &&
    !snapshot.relaunchRequired
  ) {
    return null;
  }

  const requestPermission = async (permission: 'accessibility' | 'screen_recording') => {
    setBusyAction(permission);
    setError(null);
    try {
      const next = unwrapDesktopResult(await requireDesktopAccess().requestPermission(permission));
      onSnapshot?.(next);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyAction(undefined);
    }
  };

  const relaunchApp = async () => {
    setBusyAction('relaunch');
    setError(null);
    try {
      unwrapDesktopResult(await requireDesktopAccess().relaunch());
    } catch (cause) {
      setError(errorMessage(cause));
      setBusyAction(undefined);
    }
  };

  return (
    <Box direction="Column" gap="200">
      <div className={css.PermissionList}>
        <div className={css.PermissionItem}>
          <Box direction="Column" gap="100" grow="Yes" style={{ minWidth: 0 }}>
            <Text size="T300" style={{ fontWeight: 600 }}>
              {dt('featureUi.desktopAccess.permissions.accessibility', 'Accessibility')}
            </Text>
            <Text size="T200" priority="300">
              {accessibilityGranted
                ? dt(
                    'featureUi.desktopAccess.permissions.accessibilityGrantedHint',
                    'Keyboard and mouse control allowed.'
                  )
                : dt(
                    'featureUi.desktopAccess.permissions.accessibilityMissingHint',
                    'Allows keyboard and mouse control. Updates automatically once enabled.'
                  )}
            </Text>
          </Box>
          {accessibilityGranted ? (
            <span className={classNames(css.StatusPill, css.StatusPillTone.active)}>
              <Icon size="50" src={Icons.Check} />
              <Text as="span" size="T200">
                {dt('featureUi.desktopAccess.permissions.allowed', 'Allowed')}
              </Text>
            </span>
          ) : (
            <Button
              type="button"
              size="300"
              radii="300"
              variant="Primary"
              fill="Soft"
              disabled={busyAction !== undefined}
              before={busyAction === 'accessibility' ? <Spinner size="100" /> : undefined}
              onClick={() => void requestPermission('accessibility')}
            >
              <Text size="B300">
                {dt(
                  'featureUi.desktopAccess.permissions.allowAccessibility',
                  'Allow Accessibility'
                )}
              </Text>
            </Button>
          )}
        </div>

        <div className={css.PermissionItem}>
          <Box direction="Column" gap="100" grow="Yes" style={{ minWidth: 0 }}>
            <Text size="T300" style={{ fontWeight: 600 }}>
              {dt('featureUi.desktopAccess.permissions.screenRecording', 'Screen Recording')}
            </Text>
            <Text size="T200" priority="300">
              {screenRecordingGranted
                ? dt(
                    'featureUi.desktopAccess.permissions.screenRecordingGrantedHint',
                    'Screen viewing allowed.'
                  )
                : snapshot.relaunchRequired
                  ? dt(
                      'featureUi.desktopAccess.permissions.screenRecordingRelaunchHint',
                      'Relaunch MindRoom Chat once so macOS activates Screen Recording.'
                    )
                  : dt(
                      'featureUi.desktopAccess.permissions.screenRecordingMissingHint',
                      'Allows paired agents to see your screen.'
                    )}
            </Text>
          </Box>
          {screenRecordingGranted ? (
            <span className={classNames(css.StatusPill, css.StatusPillTone.active)}>
              <Icon size="50" src={Icons.Check} />
              <Text as="span" size="T200">
                {dt('featureUi.desktopAccess.permissions.allowed', 'Allowed')}
              </Text>
            </span>
          ) : snapshot.relaunchRequired ? (
            <Button
              type="button"
              size="300"
              radii="300"
              variant="Warning"
              fill="Solid"
              disabled={busyAction !== undefined}
              before={
                busyAction === 'relaunch' ? (
                  <Spinner size="100" />
                ) : (
                  <Icon size="100" src={Icons.Reload} />
                )
              }
              onClick={() => void relaunchApp()}
            >
              <Text size="B300">
                {dt(
                  'featureUi.desktopAccess.permissions.relaunchToActivate',
                  'Relaunch to activate screen control'
                )}
              </Text>
            </Button>
          ) : (
            <Button
              type="button"
              size="300"
              radii="300"
              variant="Primary"
              fill="Soft"
              disabled={busyAction !== undefined}
              before={busyAction === 'screen_recording' ? <Spinner size="100" /> : undefined}
              onClick={() => void requestPermission('screen_recording')}
            >
              <Text size="B300">
                {dt(
                  'featureUi.desktopAccess.permissions.allowScreenRecording',
                  'Allow Screen Recording'
                )}
              </Text>
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
          {error}
        </Text>
      )}
    </Box>
  );
}
