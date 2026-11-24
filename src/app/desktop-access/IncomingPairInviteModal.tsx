import { useEffect, useState } from 'react';
import classNames from 'classnames';
import { Button, Icon, Icons, Spinner, Text, color } from 'folds';
import { useAtomValue } from 'jotai';
import {
  AuthenticationCancelled,
  useAuthenticatedAction,
} from '../account/uia/useAuthenticatedAction';
import type { DesktopAccessMode, DesktopAccessSnapshot } from '../lib/desktopBridge';
import { errorMessage } from '../lib/errorMessage';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { DialogCloseButton } from '../ui/DialogChrome';
import { Modal500 } from '../ui/Modal500';
import { Dialog } from '../ui/glass/GlassPrimitives';
import { ChooseLimitsForm, type ChooseLimitsResult } from './ChooseLimitsForm';
import { useDesktopAccessSnapshot, type DesktopAccessLimits } from './desktopAccessController';
import { useDesktopT } from './desktopAccessHelpers';
import {
  approveIncomingPairInvite,
  declineIncomingPairInvite,
  incomingPairInviteAtom,
} from './macPairInvite';
import { PermissionsRow } from './PermissionsRow';
import * as css from './desktopAccess.css';

type InviteOutcome =
  | { kind: 'paired'; agentName: string; mode: DesktopAccessMode; snapshot: DesktopAccessSnapshot }
  | { kind: 'error'; agentName: string; message: string };

/** Local Mac consent sheet for a verified browser-to-Mac pairing invite (`pair_invite.v1`). */
export function IncomingPairInviteModal() {
  const dt = useDesktopT();
  const mx = useMatrixClient();
  const incoming = useAtomValue(incomingPairInviteAtom);
  const { run: runUia, prompt: uiaPrompt } = useAuthenticatedAction();
  const [showLimits, setShowLimits] = useState(false);
  const [busyAction, setBusyAction] = useState<'approve' | 'decline' | null>(null);
  const [outcome, setOutcome] = useState<InviteOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { snapshot: liveSnapshot } = useDesktopAccessSnapshot({
    pollAccessibility: outcome?.kind === 'paired',
  });
  const [snapshotOverride, setSnapshotOverride] = useState<DesktopAccessSnapshot | null>(null);

  useEffect(() => {
    setSnapshotOverride(null);
  }, [liveSnapshot]);

  const inviteNonce = incoming?.invite.nonce;
  useEffect(() => {
    if (!inviteNonce) return;
    setShowLimits(false);
    setOutcome(null);
    setError(null);
  }, [inviteNonce]);

  if (!incoming && !outcome) return uiaPrompt;

  const busy = busyAction !== null;

  const handleDecline = async () => {
    if (!incoming || busy) return;
    setBusyAction('decline');
    setError(null);
    try {
      await declineIncomingPairInvite(mx, incoming);
      setShowLimits(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyAction(null);
    }
  };

  const handleApprove = async (mode: DesktopAccessMode, limits?: DesktopAccessLimits) => {
    if (!incoming || busy) return;
    const { agent_name: agentName } = incoming.invite;
    setBusyAction('approve');
    setError(null);
    try {
      const next = await approveIncomingPairInvite(mx, incoming, runUia, mode, limits);
      setShowLimits(false);
      setSnapshotOverride(next);
      setOutcome({ kind: 'paired', agentName, mode, snapshot: next });
    } catch (cause) {
      if (cause instanceof AuthenticationCancelled) return;
      setShowLimits(false);
      setOutcome({ kind: 'error', agentName, message: errorMessage(cause) });
    } finally {
      setBusyAction(null);
    }
  };

  const handleClose = () => {
    if (outcome) {
      setOutcome(null);
      setSnapshotOverride(null);
      return;
    }
    void handleDecline();
  };

  const renderContent = () => {
    if (outcome?.kind === 'error') {
      return (
        <>
          <div className={css.ModalHeader}>
            <Text as="h2" size="H4" data-dialog-title="">
              {dt('featureUi.desktopAccess.incoming.failedTitle', 'Could not pair {{agent}}', {
                agent: outcome.agentName,
              })}
            </Text>
            <DialogCloseButton
              label={dt('featureUi.desktopAccess.actions.close', 'Close')}
              iconSize="100"
              onClick={handleClose}
            />
          </div>
          <div className={css.ModalBody}>
            <Text size="T300" role="alert" style={{ color: color.Critical.Main }}>
              {outcome.message}
            </Text>
          </div>
          <div className={css.ModalFooter}>
            <Button
              type="button"
              size="400"
              radii="300"
              variant="Primary"
              fill="Solid"
              onClick={handleClose}
            >
              <Text size="B400">{dt('featureUi.desktopAccess.actions.close', 'Close')}</Text>
            </Button>
          </div>
        </>
      );
    }

    if (outcome?.kind === 'paired') {
      const activeSnapshot = snapshotOverride ?? liveSnapshot ?? outcome.snapshot;
      const guiReady = activeSnapshot.permissions.gui_permissions_ready;
      const shellReady = Boolean(activeSnapshot.status?.shell.ready);
      return (
        <>
          <div className={css.ModalHeader}>
            <Text as="h2" size="H4" data-dialog-title="">
              {dt('featureUi.desktopAccess.title.manageAgent', '{{agent}} on this Mac', {
                agent: outcome.agentName,
              })}
            </Text>
            <DialogCloseButton
              label={dt('featureUi.desktopAccess.actions.close', 'Close')}
              iconSize="100"
              onClick={handleClose}
            />
          </div>
          <div className={css.ModalBody}>
            <div
              className={classNames(
                css.StatusBanner,
                guiReady ? css.StatusBannerTone.active : css.StatusBannerTone.waiting
              )}
            >
              <Icon size="100" src={guiReady ? Icons.Check : Icons.Warning} />
              <Text size="T300">
                {!guiReady
                  ? shellReady
                    ? dt(
                        'featureUi.desktopAccess.banner.shellReadyWaitingPermissions',
                        'Shell ready - Waiting for macOS screen & input permissions'
                      )
                    : dt(
                        'featureUi.desktopAccess.banner.waitingPermissions',
                        'Waiting for macOS screen & input permissions'
                      )
                  : outcome.mode === 'full'
                    ? dt('featureUi.desktopAccess.status.fullAccessActive', 'Full Access active')
                    : dt(
                        'featureUi.desktopAccess.banner.restrictedActive',
                        'Restricted access active on this Mac.'
                      )}
              </Text>
            </div>
            <PermissionsRow snapshot={activeSnapshot} onSnapshot={setSnapshotOverride} />
          </div>
          <div className={css.ModalFooter}>
            <Button
              type="button"
              size="400"
              radii="300"
              variant="Primary"
              fill="Solid"
              onClick={handleClose}
            >
              <Text size="B400">{dt('featureUi.desktopAccess.actions.done', 'Done')}</Text>
            </Button>
          </div>
        </>
      );
    }

    if (!incoming) return null;
    const {
      agent_name: agentName,
      requester_label: requesterLabel,
      sas_code: sasCode,
    } = incoming.invite;

    return (
      <>
        <div className={css.ModalHeader}>
          <Text as="h2" size="H4" data-dialog-title="">
            {showLimits
              ? dt('featureUi.desktopAccess.title.chooseLimits', 'Choose limits for {{agent}}', {
                  agent: agentName,
                })
              : dt('featureUi.desktopAccess.incoming.title', 'Pair {{agent}} from {{requester}}?', {
                  agent: agentName,
                  requester: requesterLabel,
                })}
          </Text>
          <DialogCloseButton
            label={dt('featureUi.desktopAccess.actions.close', 'Close')}
            iconSize="100"
            onClick={handleClose}
          />
        </div>

        {showLimits ? (
          <div className={css.ModalBody}>
            <ChooseLimitsForm
              agentName={agentName}
              snapshot={liveSnapshot}
              busy={busy}
              onSave={(result: ChooseLimitsResult) =>
                void handleApprove(result.mode, result.limits)
              }
              onCancel={() => setShowLimits(false)}
            />
          </div>
        ) : (
          <>
            <div className={css.ModalBody}>
              <div className={css.SasCodeBox}>
                <Text size="T200" priority="300">
                  {dt('featureUi.desktopAccess.sas.label', 'Verification code')}
                </Text>
                <Text as="span" className={css.SasCodeDigits} data-testid="incoming-sas-code">
                  {sasCode}
                </Text>
              </div>
              <Text size="T200" priority="300">
                {dt(
                  'featureUi.desktopAccess.incoming.sasHint',
                  'Make sure this 6-digit code matches {{requester}} before approving.',
                  { requester: requesterLabel }
                )}
              </Text>
              <div className={css.DisclosureBox}>
                <Text size="T300">
                  {dt(
                    'featureUi.desktopAccess.consent.fullDisclosure',
                    '{{agent}} can see your screen, control every app, and run shell commands as your macOS user without asking, including after restart. Stop anytime from the menu bar.',
                    { agent: agentName }
                  )}
                </Text>
              </div>
              {error && (
                <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
                  {error}
                </Text>
              )}
            </div>
            <div className={css.ModalFooter}>
              <Button
                type="button"
                size="400"
                radii="300"
                variant="Secondary"
                fill="None"
                disabled={busy}
                onClick={() => void handleDecline()}
              >
                <Text size="B400">{dt('featureUi.desktopAccess.incoming.decline', 'Decline')}</Text>
              </Button>
              <Button
                type="button"
                size="400"
                radii="300"
                variant="Secondary"
                fill="Soft"
                disabled={busy}
                onClick={() => setShowLimits(true)}
              >
                <Text size="B400">
                  {dt('featureUi.desktopAccess.actions.chooseLimits', 'Choose limits...')}
                </Text>
              </Button>
              <Button
                type="button"
                size="400"
                radii="300"
                variant="Primary"
                fill="Solid"
                disabled={busy}
                before={busyAction === 'approve' ? <Spinner size="100" /> : undefined}
                onClick={() => void handleApprove('full')}
              >
                <Text size="B400">
                  {dt('featureUi.desktopAccess.actions.allowFullAccess', 'Allow Full Access')}
                </Text>
              </Button>
            </div>
          </>
        )}
      </>
    );
  };

  return (
    <>
      <Modal500 requestClose={handleClose} fitContent narrow>
        <Dialog variant="Surface" className={css.ModalSurface}>
          {renderContent()}
        </Dialog>
      </Modal500>
      {uiaPrompt}
    </>
  );
}
