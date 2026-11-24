import { useCallback, useEffect, useState } from 'react';
import { Box, Button, Icon, Icons, Spinner, Text, color } from 'folds';
import type { DesktopAccessSnapshot } from '../lib/desktopBridge';
import { errorMessage } from '../lib/errorMessage';
import { desktopBridge } from '../lib/nativeShell';
import { unwrapDesktopResult } from './desktopAccessController';
import { escapeShellDisplay, useDesktopT } from './desktopAccessHelpers';
import * as css from './desktopAccess.css';

export { escapeShellDisplay };

const ARMING_DELAY_MS = 1000;
const COUNTDOWN_TICK_MS = 100;
const AUTO_APPROVE_15_MIN_SECONDS = 900;

type ArmingState = {
  commandId: string | null;
  remainingMs: number;
  armedCommandId: string | null;
};

/** Floating non-focus-stealing window view for approving or denying a pending shell command. */
export function ShellApprovalView() {
  const dt = useDesktopT();
  const [snapshot, setSnapshot] = useState<DesktopAccessSnapshot | null>(null);
  const [arming, setArming] = useState<ArmingState>({
    commandId: null,
    remainingMs: ARMING_DELAY_MS,
    armedCommandId: null,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const approval = desktopBridge()?.shellApproval;
    if (!approval) return;
    try {
      setSnapshot(unwrapDesktopResult(await approval.status()));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const bridge = desktopBridge();
    return bridge?.onShellEvent((event) => {
      if (event.type === 'desktop-access-status') void refresh();
    });
  }, [refresh]);

  const pending = snapshot?.status?.shell.pending ?? null;
  const commandId = pending?.command_id ?? null;

  useEffect(() => {
    if (commandId === null) {
      setArming({ commandId: null, remainingMs: ARMING_DELAY_MS, armedCommandId: null });
      return undefined;
    }
    const deadline = Date.now() + ARMING_DELAY_MS;
    setArming({ commandId, remainingMs: ARMING_DELAY_MS, armedCommandId: null });
    setError(null);

    const interval = setInterval(() => {
      const remaining = Math.max(0, deadline - Date.now());
      setArming((prev) =>
        prev.commandId === commandId ? { ...prev, remainingMs: remaining } : prev
      );
    }, COUNTDOWN_TICK_MS);
    const done = setTimeout(() => {
      setArming({ commandId, remainingMs: 0, armedCommandId: commandId });
      clearInterval(interval);
    }, ARMING_DELAY_MS);

    return () => {
      clearInterval(interval);
      clearTimeout(done);
    };
  }, [commandId]);

  const isArmed =
    commandId !== null && arming.armedCommandId === commandId && arming.remainingMs === 0;
  const effectiveRemainingMs =
    commandId !== null && arming.commandId === commandId ? arming.remainingMs : ARMING_DELAY_MS;
  const countdownText = `${(effectiveRemainingMs / 1000).toFixed(1)}s`;

  const decide = async (approved: boolean, autoApproveSeconds?: number) => {
    const approval = desktopBridge()?.shellApproval;
    if (!approval || !pending || submitting) return;
    if (approved && !isArmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const next = unwrapDesktopResult(
        await approval.decideShell({
          commandId: pending.command_id,
          approved,
          ...(autoApproveSeconds !== undefined ? { autoApproveSeconds } : {}),
        })
      );
      setSnapshot(next);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const actor = pending
    ? [pending.agent_name, pending.requester_id]
        .filter((part): part is string => Boolean(part))
        .map(escapeShellDisplay)
        .join(' · ')
    : '';

  return (
    <div className={css.ShellApprovalRoot}>
      <div className={css.ShellApprovalCard} role="main">
        <Box alignItems="Center" justifyContent="SpaceBetween" gap="200">
          <Box alignItems="Center" gap="200" style={{ minWidth: 0 }}>
            <Icon size="200" src={Icons.Terminal} />
            <Text as="h1" size="H5" truncate>
              {dt('featureUi.desktopAccess.shellApproval.title', 'Approve shell command?')}
            </Text>
          </Box>
          {actor && (
            <Text size="T200" priority="300" truncate data-testid="shell-approval-actor">
              {actor}
            </Text>
          )}
        </Box>

        {!pending ? (
          <Box grow="Yes" alignItems="Center" justifyContent="Center">
            <Text size="T300" priority="300">
              {dt(
                'featureUi.desktopAccess.shellApproval.empty',
                'No shell command is waiting for approval.'
              )}
            </Text>
          </Box>
        ) : (
          <>
            <Box direction="Column" gap="100" grow="Yes" style={{ minHeight: 0 }}>
              <Text size="T200" priority="300">
                {dt('featureUi.desktopAccess.shellApproval.cwdLabel', 'Working directory')}
                {': '}
                <code className={css.MonospaceText} data-testid="shell-approval-cwd">
                  {escapeShellDisplay(pending.cwd)}
                </code>
              </Text>
              <pre className={css.ShellCommandBox} data-testid="shell-approval-command">
                <code>{escapeShellDisplay(pending.command)}</code>
              </pre>
            </Box>

            {error && (
              <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
                {error}
              </Text>
            )}

            <Box alignItems="Center" justifyContent="End" gap="200" wrap="Wrap">
              <Button
                type="button"
                size="300"
                radii="300"
                variant="Critical"
                fill="Soft"
                disabled={submitting}
                onClick={() => void decide(false)}
              >
                <Text size="B300">{dt('featureUi.desktopAccess.shellApproval.deny', 'Deny')}</Text>
              </Button>
              <Button
                type="button"
                size="300"
                radii="300"
                variant="Secondary"
                fill="Soft"
                disabled={!isArmed || submitting}
                onClick={() => void decide(true, AUTO_APPROVE_15_MIN_SECONDS)}
              >
                <Text size="B300">
                  {isArmed
                    ? dt(
                        'featureUi.desktopAccess.shellApproval.autoApprove15m',
                        'Auto-approve 15 min'
                      )
                    : dt(
                        'featureUi.desktopAccess.shellApproval.autoApprove15mCountdown',
                        'Auto-approve 15 min ({{seconds}})',
                        { seconds: countdownText }
                      )}
                </Text>
              </Button>
              <Button
                type="button"
                size="300"
                radii="300"
                variant="Primary"
                fill="Solid"
                disabled={!isArmed || submitting}
                before={submitting ? <Spinner size="100" /> : undefined}
                onClick={() => void decide(true)}
              >
                <Text size="B300">
                  {isArmed
                    ? dt('featureUi.desktopAccess.shellApproval.approveOnce', 'Approve once')
                    : dt(
                        'featureUi.desktopAccess.shellApproval.approveOnceCountdown',
                        'Approve once ({{seconds}})',
                        { seconds: countdownText }
                      )}
                </Text>
              </Button>
            </Box>
          </>
        )}
      </div>
    </div>
  );
}
