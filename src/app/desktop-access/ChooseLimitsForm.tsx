import { useEffect, useId, useMemo, useState } from 'react';
import classNames from 'classnames';
import { Box, Button, Checkbox, Icon, Icons, Spinner, Switch, Text, color } from 'folds';
import type {
  DesktopAccessMode,
  DesktopAccessSnapshot,
  InstalledMacApp,
} from '../lib/desktopBridge';
import { errorMessage } from '../lib/errorMessage';
import { desktopBridge } from '../lib/nativeShell';
import {
  requireDesktopAccess,
  unwrapDesktopResult,
  type DesktopAccessLimits,
} from './desktopAccessController';
import { isControllerFullAccess, useDesktopT } from './desktopAccessHelpers';
import * as css from './desktopAccess.css';

export type GuiControlChoice = 'observe' | '15m' | '1h' | 'full';
export type ShellApprovalChoice = 'ask' | '15m' | '1h' | 'until_revoked';

export type ChooseLimitsResult = {
  mode: DesktopAccessMode;
  limits: DesktopAccessLimits;
};

type ChooseLimitsFormProps = {
  agentName: string;
  snapshot: DesktopAccessSnapshot | null;
  controllerKey?: string;
  busy?: boolean;
  submitLabel?: string;
  onSave: (result: ChooseLimitsResult) => void;
  onCancel: () => void;
};

const PRIMARY_SCREEN = 'primary-screen';
const FIFTEEN_MINUTES = 900;
const ONE_HOUR = 3600;

const initialGuiChoice = (
  snapshot: DesktopAccessSnapshot | null,
  controllerKey?: string
): GuiControlChoice => {
  if (!controllerKey) return 'observe';
  if (isControllerFullAccess(snapshot, controllerKey)) return 'full';
  const auth = snapshot?.status?.authority.controllers[controllerKey];
  if (auth?.control_available && auth.lease_remaining_seconds > 1200) return '1h';
  if (auth?.control_available && auth.lease_remaining_seconds > 0) return '15m';
  return 'observe';
};

const initialShellApproval = (
  snapshot: DesktopAccessSnapshot | null,
  controllerKey?: string
): ShellApprovalChoice => {
  if (!controllerKey) return 'ask';
  if (isControllerFullAccess(snapshot, controllerKey)) return 'until_revoked';
  const shellCtrl = snapshot?.status?.shell.controllers[controllerKey];
  if (shellCtrl?.auto_approve_until_revoked) return 'until_revoked';
  if ((shellCtrl?.auto_approve_remaining_seconds ?? 0) > 1200) return '1h';
  if ((shellCtrl?.auto_approve_remaining_seconds ?? 0) > 0) return '15m';
  return 'ask';
};

const buildResult = (
  guiChoice: GuiControlChoice,
  shellApproval: ShellApprovalChoice,
  shellEnabled: boolean,
  fullScreen: boolean,
  selectedAppIds: string[],
  fileRoots: string[]
): ChooseLimitsResult => {
  const allowedAppIds = [
    ...(fullScreen || guiChoice === 'full' ? [PRIMARY_SCREEN] : []),
    ...selectedAppIds,
  ];
  if (guiChoice === 'full') {
    return {
      mode: 'full',
      limits: { allowedAppIds, fileRoots, shellEnabled: true, shellAutoApproveUntilRevoked: true },
    };
  }
  const controlDurationSeconds =
    guiChoice === '15m' ? FIFTEEN_MINUTES : guiChoice === '1h' ? ONE_HOUR : undefined;
  const shellAutoApproveSeconds =
    shellEnabled && shellApproval === '15m'
      ? FIFTEEN_MINUTES
      : shellEnabled && shellApproval === '1h'
        ? ONE_HOUR
        : undefined;
  return {
    mode: 'restricted',
    limits: {
      allowedAppIds,
      fileRoots,
      shellEnabled,
      ...(controlDurationSeconds !== undefined ? { controlDurationSeconds } : {}),
      ...(shellAutoApproveSeconds !== undefined ? { shellAutoApproveSeconds } : {}),
      ...(shellEnabled && shellApproval === 'until_revoked'
        ? { shellAutoApproveUntilRevoked: true }
        : {}),
    },
  };
};

function ChoiceGroup<V extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: V;
  options: Array<{ value: V; label: string }>;
  disabled: boolean;
  onChange: (value: V) => void;
}) {
  return (
    <Box direction="Column" gap="100">
      <Text size="T200" priority="300">
        {label}
      </Text>
      <Box direction="Column" gap="100" role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              className={classNames(css.LimitsOptionButton, selected && css.LimitsOptionSelected)}
              onClick={() => onChange(option.value)}
            >
              <Text size="T300">{option.label}</Text>
              {selected && <Icon size="100" src={Icons.Check} />}
            </button>
          );
        })}
      </Box>
    </Box>
  );
}

/** Granular per-agent control/shell approval limits and Mac-wide shared apps, folders & shell toggles. */
export function ChooseLimitsForm({
  agentName,
  snapshot,
  controllerKey,
  busy = false,
  submitLabel,
  onSave,
  onCancel,
}: ChooseLimitsFormProps) {
  const dt = useDesktopT();
  const fullScreenLabelId = useId();
  const shellEnabledLabelId = useId();
  const config = snapshot?.status?.config;
  const savedApps = config?.allowed_app_ids ?? [];
  const otherHasFullAccess = Object.keys(snapshot?.consent ?? {}).some(
    (key) => key !== controllerKey
  );

  const [guiChoice, setGuiChoice] = useState<GuiControlChoice>(() =>
    initialGuiChoice(snapshot, controllerKey)
  );
  const [shellApproval, setShellApproval] = useState<ShellApprovalChoice>(() =>
    initialShellApproval(snapshot, controllerKey)
  );
  const [shellEnabled, setShellEnabled] = useState<boolean>(
    () => snapshot?.status?.config.shell_enabled ?? true
  );
  const [fullScreen, setFullScreen] = useState<boolean>(() =>
    savedApps.length > 0
      ? savedApps.includes(PRIMARY_SCREEN)
      : config?.state !== 'ready' || !config.enabled
  );
  const [selectedAppIds, setSelectedAppIds] = useState<string[]>(() =>
    savedApps.filter((id) => id !== PRIMARY_SCREEN)
  );
  const [fileRoots, setFileRoots] = useState<string[]>(() => [
    ...(snapshot?.status?.config.file_roots ?? []),
  ]);
  const [installedApps, setInstalledApps] = useState<InstalledMacApp[]>([]);
  const [loadingApps, setLoadingApps] = useState(true);
  const [pickerError, setPickerError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const access = desktopBridge()?.desktopAccess;
    if (!access) {
      setLoadingApps(false);
      return undefined;
    }
    void access
      .listInstalledApps()
      .then((res) => {
        if (active) setInstalledApps(unwrapDesktopResult(res));
      })
      .catch((cause) => {
        if (active) setPickerError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoadingApps(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const appEntries = useMemo<InstalledMacApp[]>(() => {
    const known = new Set(installedApps.map((app) => app.bundleId));
    const extras = selectedAppIds
      .filter((id) => !known.has(id))
      .map((bundleId) => ({ bundleId, name: bundleId, path: '' }));
    return [...installedApps, ...extras];
  }, [installedApps, selectedAppIds]);

  const handleGuiChange = (next: GuiControlChoice) => {
    setGuiChoice(next);
    if (next === 'full') {
      setShellEnabled(true);
      setShellApproval('until_revoked');
      setFullScreen(true);
    }
  };

  const handleShellApprovalChange = (next: ShellApprovalChoice) => {
    setShellApproval(next);
    if (guiChoice === 'full' && next !== 'until_revoked') setGuiChoice('1h');
  };

  const handleShellEnabledChange = (next: boolean) => {
    setShellEnabled(next);
    if (guiChoice === 'full' && !next) setGuiChoice('1h');
  };

  const handleFullScreenChange = (next: boolean) => {
    setFullScreen(next);
    if (!next) {
      if (selectedAppIds.length === 0) setGuiChoice('observe');
      else if (guiChoice === 'full') setGuiChoice('1h');
    }
  };

  const toggleApp = (bundleId: string) => {
    const next = selectedAppIds.includes(bundleId)
      ? selectedAppIds.filter((id) => id !== bundleId)
      : [...selectedAppIds, bundleId];
    setSelectedAppIds(next);
    if (!fullScreen && next.length === 0 && guiChoice !== 'observe') {
      setGuiChoice('observe');
    }
  };

  const addFolder = async () => {
    setPickerError(null);
    try {
      const picked = unwrapDesktopResult(await requireDesktopAccess().pickFolder());
      if (picked) setFileRoots((prev) => (prev.includes(picked) ? prev : [...prev, picked]));
    } catch (cause) {
      setPickerError(errorMessage(cause));
    }
  };

  const guiOptions: Array<{ value: GuiControlChoice; label: string }> = [
    { value: 'observe', label: dt('featureUi.desktopAccess.limits.guiObserve', 'Observe only') },
    {
      value: '15m',
      label: dt('featureUi.desktopAccess.limits.gui15m', 'Allow control for 15 min'),
    },
    {
      value: '1h',
      label: dt('featureUi.desktopAccess.limits.gui1h', 'Allow control for 1 hour'),
    },
    {
      value: 'full',
      label: dt('featureUi.desktopAccess.limits.guiFull', 'Full Access until revoked'),
    },
  ];

  const shellApprovalOptions: Array<{ value: ShellApprovalChoice; label: string }> = [
    {
      value: 'ask',
      label: dt('featureUi.desktopAccess.limits.shellAsk', 'Ask before each command'),
    },
    {
      value: '15m',
      label: dt('featureUi.desktopAccess.limits.shell15m', 'Auto-approve for 15 min'),
    },
    {
      value: '1h',
      label: dt('featureUi.desktopAccess.limits.shell1h', 'Auto-approve for 1 hour'),
    },
    {
      value: 'until_revoked',
      label: dt('featureUi.desktopAccess.limits.shellUntilRevoked', 'Auto-approve until revoked'),
    },
  ];

  const hasCapability =
    guiChoice === 'full' ||
    fullScreen ||
    selectedAppIds.length > 0 ||
    fileRoots.length > 0 ||
    shellEnabled;

  return (
    <Box direction="Column" gap="400">
      <div className={css.LimitsSection} data-testid="limits-per-agent-section">
        <Text size="L400" style={{ fontWeight: 600 }}>
          {dt(
            'featureUi.desktopAccess.limits.perAgentHeading',
            'Control & shell approval for {{agent}} (per-agent)',
            { agent: agentName }
          )}
        </Text>
        <ChoiceGroup
          label={dt('featureUi.desktopAccess.limits.guiLabel', 'Screen & input control')}
          value={guiChoice}
          options={guiOptions}
          disabled={busy}
          onChange={handleGuiChange}
        />
        {guiChoice === 'full' && (
          <Text size="T200" priority="300">
            {dt(
              'featureUi.desktopAccess.limits.fullNote',
              'Full Access until revoked enables full-screen control and auto-approved shell until revoked.'
            )}
          </Text>
        )}
        <ChoiceGroup
          label={dt('featureUi.desktopAccess.limits.shellApprovalLabel', 'Shell approval')}
          value={shellApproval}
          options={shellApprovalOptions}
          disabled={busy || !shellEnabled}
          onChange={handleShellApprovalChange}
        />
        {!shellEnabled && (
          <Text size="T200" priority="300">
            {dt(
              'featureUi.desktopAccess.limits.shellDisabledHint',
              'Turn on "Allow shell commands on this Mac" below to configure shell approval.'
            )}
          </Text>
        )}
      </div>

      <div className={css.LimitsSection} data-testid="limits-shared-section">
        <Box direction="Column" gap="100">
          <Text size="L400" style={{ fontWeight: 600 }}>
            {dt(
              'featureUi.desktopAccess.limits.sharedHeading',
              'Shared apps, folders & shell on this Mac (applies to all paired agents)'
            )}
          </Text>
          {otherHasFullAccess && (
            <Text size="T200" priority="300">
              {dt(
                'featureUi.desktopAccess.limits.sharedWithOthersHint',
                'Shared with other paired agents on this Mac'
              )}
            </Text>
          )}
        </Box>

        <Box alignItems="Center" justifyContent="SpaceBetween" gap="200">
          <Text id={shellEnabledLabelId} size="T300">
            {dt(
              'featureUi.desktopAccess.limits.allowShellOnMac',
              'Allow shell commands on this Mac'
            )}
          </Text>
          <Switch
            variant="Primary"
            aria-labelledby={shellEnabledLabelId}
            value={shellEnabled}
            disabled={busy}
            onChange={handleShellEnabledChange}
          />
        </Box>

        <Box alignItems="Center" justifyContent="SpaceBetween" gap="200">
          <Text id={fullScreenLabelId} size="T300">
            {dt('featureUi.desktopAccess.limits.fullScreen', 'Full screen (primary-screen)')}
          </Text>
          <Switch
            variant="Primary"
            aria-labelledby={fullScreenLabelId}
            value={fullScreen}
            disabled={busy}
            onChange={handleFullScreenChange}
          />
        </Box>

        <Box direction="Column" gap="100">
          <Text size="T200" priority="300">
            {dt('featureUi.desktopAccess.limits.installedApps', 'Allowed Mac apps')}
          </Text>
          {loadingApps ? (
            <Box alignItems="Center" gap="200">
              <Spinner size="100" />
              <Text size="T200" priority="300">
                {dt('featureUi.desktopAccess.limits.loadingApps', 'Loading installed apps...')}
              </Text>
            </Box>
          ) : appEntries.length === 0 ? (
            <Text size="T200" priority="300">
              {dt('featureUi.desktopAccess.limits.noAppsFound', 'No installed Mac apps found.')}
            </Text>
          ) : (
            <div className={css.ChecklistBox}>
              {appEntries.map((app) => (
                <Box as="label" key={app.bundleId} className={css.ChecklistRow}>
                  <Checkbox
                    variant="Primary"
                    size="200"
                    checked={selectedAppIds.includes(app.bundleId)}
                    aria-label={app.name}
                    readOnly
                    disabled={busy}
                    onClick={() => toggleApp(app.bundleId)}
                  />
                  <Box direction="Column" grow="Yes" style={{ minWidth: 0 }}>
                    <Text size="T300" truncate>
                      {app.name}
                    </Text>
                    <Text size="T200" priority="300" truncate>
                      {app.bundleId}
                    </Text>
                  </Box>
                </Box>
              ))}
            </div>
          )}
        </Box>

        <Box direction="Column" gap="100">
          <Box alignItems="Center" justifyContent="SpaceBetween" gap="200">
            <Text size="T200" priority="300">
              {dt('featureUi.desktopAccess.limits.foldersLabel', 'Read-only folders')}
            </Text>
            <Button
              type="button"
              size="300"
              radii="300"
              variant="Secondary"
              fill="Soft"
              disabled={busy}
              onClick={() => void addFolder()}
            >
              <Text size="B300">
                {dt('featureUi.desktopAccess.limits.addFolder', 'Add folder...')}
              </Text>
            </Button>
          </Box>
          {fileRoots.length === 0 ? (
            <Text size="T200" priority="300">
              {dt('featureUi.desktopAccess.limits.noFolders', 'No read-only folders added.')}
            </Text>
          ) : (
            <Box direction="Column" gap="100">
              {fileRoots.map((folder) => (
                <div key={folder} className={css.FolderRow}>
                  <Text size="T200" className={css.MonospaceText}>
                    {folder}
                  </Text>
                  <Button
                    type="button"
                    size="300"
                    radii="300"
                    variant="Secondary"
                    fill="None"
                    disabled={busy}
                    onClick={() => setFileRoots((prev) => prev.filter((item) => item !== folder))}
                  >
                    <Text size="B300">
                      {dt('featureUi.desktopAccess.limits.removeFolder', 'Remove')}
                    </Text>
                  </Button>
                </div>
              ))}
            </Box>
          )}
        </Box>
      </div>

      {pickerError && (
        <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
          {pickerError}
        </Text>
      )}
      {!hasCapability && (
        <Text size="T200" priority="300">
          {dt(
            'featureUi.desktopAccess.limits.needCapability',
            'Enable full screen, at least one app, a folder, or shell commands.'
          )}
        </Text>
      )}

      <Box justifyContent="End" gap="200">
        <Button
          type="button"
          size="400"
          radii="300"
          variant="Secondary"
          fill="None"
          disabled={busy}
          onClick={onCancel}
        >
          <Text size="B400">{dt('featureUi.desktopAccess.actions.cancel', 'Cancel')}</Text>
        </Button>
        <Button
          type="button"
          size="400"
          radii="300"
          variant="Primary"
          fill="Solid"
          disabled={busy || !hasCapability}
          before={busy ? <Spinner size="100" /> : undefined}
          onClick={() =>
            hasCapability &&
            onSave(
              buildResult(
                guiChoice,
                shellApproval,
                shellEnabled,
                fullScreen,
                selectedAppIds,
                fileRoots
              )
            )
          }
        >
          <Text size="B400">
            {submitLabel ?? dt('featureUi.desktopAccess.limits.save', 'Allow with limits')}
          </Text>
        </Button>
      </Box>
    </Box>
  );
}
