import { useEffect, useState } from 'react';
import classNames from 'classnames';
import { Box, Button, Spinner, Text, color } from 'folds';
import { useSetAtom } from 'jotai';
import type { DesktopAccessSnapshot } from '../lib/desktopBridge';
import { errorMessage } from '../lib/errorMessage';
import { isDesktopAccessAvailable } from '../lib/nativeShell';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { desktopAccessModalAtom } from '../navigation/desktopAccessModal';
import { SettingTile } from '../ui/SettingTile';
import { AdvancedFold } from '../ui/settings/AdvancedFold';
import { SettingsPageFrame, type SettingsPageProps } from '../ui/settings/SettingsPageFrame';
import { SettingsSection } from '../ui/settings/SettingsSection';
import {
  disconnectAgentFromThisMac,
  requireDesktopAccess,
  unwrapDesktopResult,
  useDesktopAccessSnapshot,
} from './desktopAccessController';
import {
  escapeShellDisplay,
  extractAgentName,
  isControllerFullAccess,
  useDesktopT,
} from './desktopAccessHelpers';
import { PermissionsRow } from './PermissionsRow';
import * as css from './desktopAccess.css';

type StatusPillInfo = {
  label: string;
  tone: keyof typeof css.StatusPillTone;
};

/** Settings -> This Mac: live status, paired agents, macOS permissions, active shell handles, and kill switch. */
export function ThisMacSettingsPage({ requestClose }: SettingsPageProps) {
  const dt = useDesktopT();
  const mx = useMatrixClient();
  const setModalRequest = useSetAtom(desktopAccessModalAtom);
  const desktopAvailable = isDesktopAccessAvailable();
  const { snapshot: liveSnapshot, error: loadError } = useDesktopAccessSnapshot({
    pollAccessibility: desktopAvailable,
  });

  const [snapshotOverride, setSnapshotOverride] = useState<DesktopAccessSnapshot | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setSnapshotOverride(null);
  }, [liveSnapshot]);

  const snapshot = snapshotOverride ?? liveSnapshot;
  const available =
    desktopAvailable && (snapshot === null || snapshot.availability === 'available');
  const controllers = snapshot?.status?.config.controllers ?? [];
  const handles = snapshot?.status?.shell.handles ?? [];
  const bridgeState = snapshot?.status?.bridge.state ?? 'stopped';
  const bridgeActive = bridgeState === 'observe_only' || bridgeState === 'control';
  const hasAnyFullConsent = controllers.some((ctrl) =>
    isControllerFullAccess(snapshot, ctrl.controller_key)
  );
  const guiReady = snapshot?.permissions.gui_permissions_ready ?? false;
  const canRevoke =
    available &&
    (controllers.length > 0 || bridgeActive || Object.keys(snapshot?.consent ?? {}).length > 0);

  const statusPill: StatusPillInfo = !available
    ? {
        label: dt(
          'featureUi.desktopAccess.settings.statusUnavailable',
          'Not available on this Mac'
        ),
        tone: 'neutral',
      }
    : bridgeActive && hasAnyFullConsent && guiReady
      ? {
          label: dt('featureUi.desktopAccess.status.fullAccessActive', 'Full Access active'),
          tone: 'active',
        }
      : bridgeActive
        ? {
            label: dt('featureUi.desktopAccess.settings.statusActive', 'Active'),
            tone: hasAnyFullConsent && !guiReady ? 'waiting' : 'active',
          }
        : {
            label: dt('featureUi.desktopAccess.settings.statusStopped', 'Stopped'),
            tone: 'neutral',
          };

  const runAction = async (key: string, fn: () => Promise<DesktopAccessSnapshot>) => {
    setBusyKey(key);
    setActionError(null);
    try {
      setSnapshotOverride(await fn());
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setBusyKey(null);
    }
  };

  const lastError = snapshot?.helperError ?? snapshot?.status?.bridge.last_error ?? null;
  const pairing = snapshot?.status?.pairing;
  const displayError = actionError ?? loadError;

  return (
    <SettingsPageFrame
      title={dt('featureUi.desktopAccess.settings.title', 'This Mac')}
      requestClose={requestClose}
    >
      <SettingsSection>
        <SettingTile
          title={dt('featureUi.desktopAccess.settings.statusTitle', 'Mac Computer Access')}
          description={
            available
              ? dt(
                  'featureUi.desktopAccess.settings.statusDescription',
                  'Control which MindRoom agents can see and control this Mac.'
                )
              : (snapshot?.helperError ??
                dt(
                  'featureUi.desktopAccess.settings.unavailableDescription',
                  'Mac Computer Access requires MindRoom Chat for Mac on Apple Silicon.'
                ))
          }
          after={
            <Box alignItems="Center" gap="200" wrap="Wrap">
              <span className={classNames(css.StatusPill, css.StatusPillTone[statusPill.tone])}>
                <span className={classNames(css.StatusDot, css.StatusDotTone[statusPill.tone])} />
                <Text as="span" size="T200">
                  {statusPill.label}
                </Text>
              </span>
              {canRevoke && (
                <Button
                  type="button"
                  size="300"
                  radii="300"
                  variant="Critical"
                  fill="Soft"
                  disabled={busyKey !== null}
                  before={busyKey === 'revokeAll' ? <Spinner size="100" /> : undefined}
                  onClick={() =>
                    void runAction('revokeAll', async () =>
                      unwrapDesktopResult(await requireDesktopAccess().revokeAll())
                    )
                  }
                >
                  <Text size="B300">
                    {dt('featureUi.desktopAccess.settings.revokeAll', 'Revoke All Access')}
                  </Text>
                </Button>
              )}
            </Box>
          }
        >
          {displayError && (
            <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
              {displayError}
            </Text>
          )}
        </SettingTile>
      </SettingsSection>

      {available && (
        <>
          <SettingsSection
            title={dt('featureUi.desktopAccess.settings.pairedAgentsTitle', 'Paired agents')}
          >
            {controllers.length === 0 ? (
              <SettingTile
                title={dt(
                  'featureUi.desktopAccess.settings.noPairedAgentsTitle',
                  'No agents paired yet'
                )}
                description={dt(
                  'featureUi.desktopAccess.settings.noPairedAgentsDescription',
                  'Open a room with an agent and choose Give Mac Access to connect it.'
                )}
              />
            ) : (
              controllers.map((ctrl) => {
                const names =
                  ctrl.allowed_agent_names.length > 0
                    ? ctrl.allowed_agent_names
                    : [extractAgentName(ctrl.user_id)];
                const primaryName = names[0] ?? extractAgentName(ctrl.user_id);
                const full = isControllerFullAccess(snapshot, ctrl.controller_key);
                const disconnectKey = `disconnect:${ctrl.controller_key}`;
                return (
                  <SettingTile
                    key={ctrl.controller_key}
                    title={names.join(', ')}
                    description={ctrl.user_id}
                    after={
                      <Box alignItems="Center" gap="200" wrap="Wrap">
                        <span
                          className={classNames(
                            css.StatusPill,
                            full ? css.StatusPillTone.active : css.StatusPillTone.neutral
                          )}
                        >
                          <Text as="span" size="T200">
                            {full
                              ? dt('featureUi.desktopAccess.status.fullAccess', 'Full Access')
                              : dt('featureUi.desktopAccess.status.restricted', 'Restricted')}
                          </Text>
                        </span>
                        <Button
                          type="button"
                          size="300"
                          radii="300"
                          variant="Secondary"
                          fill="Soft"
                          disabled={busyKey !== null}
                          onClick={() =>
                            setModalRequest({ agentUserId: ctrl.user_id, agentName: primaryName })
                          }
                        >
                          <Text size="B300">
                            {dt('featureUi.desktopAccess.settings.manage', 'Manage')}
                          </Text>
                        </Button>
                        <Button
                          type="button"
                          size="300"
                          radii="300"
                          variant="Critical"
                          fill="None"
                          disabled={busyKey !== null}
                          before={busyKey === disconnectKey ? <Spinner size="100" /> : undefined}
                          onClick={() =>
                            void runAction(disconnectKey, () =>
                              disconnectAgentFromThisMac(
                                mx,
                                ctrl.controller_key,
                                ctrl.user_id,
                                primaryName
                              )
                            )
                          }
                        >
                          <Text size="B300">
                            {dt('featureUi.desktopAccess.actions.disconnect', 'Disconnect')}
                          </Text>
                        </Button>
                      </Box>
                    }
                  />
                );
              })
            )}
          </SettingsSection>

          {snapshot && (
            <SettingsSection
              title={dt('featureUi.desktopAccess.settings.permissionsTitle', 'macOS Permissions')}
            >
              <PermissionsRow
                snapshot={snapshot}
                showWhenAllGranted
                onSnapshot={setSnapshotOverride}
              />
            </SettingsSection>
          )}

          {handles.length > 0 && (
            <SettingsSection
              title={dt(
                'featureUi.desktopAccess.settings.runningShellTitle',
                'Running shell commands'
              )}
            >
              {handles.map((handle) => {
                const killKey = `kill:${handle.handle}`;
                return (
                  <SettingTile
                    key={handle.handle}
                    title={
                      <span className={css.MonospaceText}>
                        {escapeShellDisplay(handle.command)}
                      </span>
                    }
                    description={`${handle.state} (${handle.handle})`}
                    after={
                      <Button
                        type="button"
                        size="300"
                        radii="300"
                        variant="Critical"
                        fill="Soft"
                        disabled={busyKey !== null}
                        before={busyKey === killKey ? <Spinner size="100" /> : undefined}
                        onClick={() =>
                          void runAction(killKey, async () =>
                            unwrapDesktopResult(
                              await requireDesktopAccess().killShellHandle(handle.handle)
                            )
                          )
                        }
                      >
                        <Text size="B300">
                          {dt('featureUi.desktopAccess.settings.stopCommand', 'Stop')}
                        </Text>
                      </Button>
                    }
                  />
                );
              })}
            </SettingsSection>
          )}

          <AdvancedFold>
            <SettingsSection>
              <SettingTile
                title={dt('featureUi.desktopAccess.settings.helperVersion', 'Helper version')}
                description={
                  snapshot?.status?.helper.version ??
                  dt('featureUi.desktopAccess.settings.unknown', 'Unknown')
                }
              />
              <SettingTile
                title={dt('featureUi.desktopAccess.settings.bridgeState', 'Bridge state')}
                description={bridgeState}
              />
              <SettingTile
                title={dt('featureUi.desktopAccess.settings.savedSession', 'Saved Matrix session')}
                description={
                  pairing?.user_id ??
                  dt('featureUi.desktopAccess.settings.notSignedIn', 'Not signed in')
                }
              >
                {pairing?.device_id && (
                  <Text size="T200" priority="300" className={css.MonospaceText}>
                    {pairing.device_id}
                  </Text>
                )}
              </SettingTile>
              {lastError && (
                <SettingTile
                  title={dt('featureUi.desktopAccess.settings.lastError', 'Last error')}
                  description={lastError}
                />
              )}
            </SettingsSection>
          </AdvancedFold>
        </>
      )}
    </SettingsPageFrame>
  );
}
