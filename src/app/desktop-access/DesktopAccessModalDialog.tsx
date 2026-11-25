import { useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { Box, Button, Icon, Icons, Spinner, Text, color } from 'folds';
import { useAtomValue, useSetAtom } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import {
  AuthenticationCancelled,
  useAuthenticatedAction,
} from '../account/uia/useAuthenticatedAction';
import type { UiaRunner } from '../account/watch/connectWatch';
import type { DesktopAccessSnapshot } from '../lib/desktopBridge';
import { errorMessage } from '../lib/errorMessage';
import { isDesktopAccessAvailable } from '../lib/nativeShell';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { desktopAccessModalAtom } from '../navigation/desktopAccessModal';
import { DialogCloseButton } from '../ui/DialogChrome';
import { Modal500 } from '../ui/Modal500';
import { BrowserPairSection } from './BrowserPairSection';
import { ChooseLimitsForm, type ChooseLimitsResult } from './ChooseLimitsForm';
import {
  disconnectAgentFromThisMac,
  pairAgentOnThisMac,
  requireDesktopAccess,
  unwrapDesktopResult,
  useDesktopAccessSnapshot,
  type DesktopPairingStep,
} from './desktopAccessController';
import {
  extractAgentName,
  findPairedController,
  getRoomMindroomAgents,
  isControllerFullAccess,
  resolveMemberDisplayName,
  useDesktopT,
  type DesktopT,
  type RoomMindroomAgent,
} from './desktopAccessHelpers';
import { PermissionsRow } from './PermissionsRow';
import * as css from './desktopAccess.css';

export { extractAgentName, getRoomMindroomAgents };

export type DesktopAccessModalProps = {
  mx: MatrixClient;
  agents: RoomMindroomAgent[];
  runUia: UiaRunner;
  onClose: () => void;
  onLimitsOpenChange?: (open: boolean) => void;
};

const stepLabel = (dt: DesktopT, step: DesktopPairingStep, agentName: string): string => {
  const labels: Record<DesktopPairingStep, string> = {
    requesting_offer: dt(
      'featureUi.desktopAccess.steps.requestingOffer',
      'Contacting {{agent}}...',
      {
        agent: agentName,
      }
    ),
    signing_in: dt('featureUi.desktopAccess.steps.signingIn', 'Signing in on this Mac...'),
    pairing: dt('featureUi.desktopAccess.steps.pairing', 'Pairing with {{agent}}...', {
      agent: agentName,
    }),
    confirming: dt('featureUi.desktopAccess.steps.confirming', 'Confirming pairing...'),
    finishing: dt('featureUi.desktopAccess.steps.finishing', 'Activating access...'),
  };
  return labels[step];
};

/** 2-click Mac Computer Access consent sheet, multi-agent picker, limits editor, and browser relay. */
export function DesktopAccessModal({
  mx,
  agents,
  runUia,
  onClose,
  onLimitsOpenChange,
}: DesktopAccessModalProps) {
  const dt = useDesktopT();
  const desktopAvailable = isDesktopAccessAvailable();
  const { snapshot: liveSnapshot } = useDesktopAccessSnapshot({
    pollAccessibility: desktopAvailable,
  });

  const [snapshotOverride, setSnapshotOverride] = useState<DesktopAccessSnapshot | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<RoomMindroomAgent | null>(() =>
    agents.length === 1 ? (agents[0] ?? null) : null
  );
  const [showLimits, setShowLimits] = useState(false);
  const [justPaired, setJustPaired] = useState(false);
  const [step, setStep] = useState<DesktopPairingStep | null>(null);
  const [busyAction, setBusyAction] = useState<'pair' | 'update' | 'disconnect' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setSnapshotOverride(null);
  }, [liveSnapshot]);

  useEffect(() => {
    onLimitsOpenChange?.(showLimits);
  }, [onLimitsOpenChange, showLimits]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  const snapshot = snapshotOverride ?? liveSnapshot;
  const requesterId = mx.getUserId() ?? undefined;
  const pairedController = selectedAgent
    ? findPairedController(snapshot, selectedAgent.userId, requesterId)
    : undefined;
  const isFullAccess =
    pairedController !== undefined &&
    isControllerFullAccess(snapshot, pairedController.controller_key);
  const guiReady = snapshot?.permissions.gui_permissions_ready ?? false;
  const shellReady = Boolean(snapshot?.status?.shell.ready);
  const busy = busyAction !== null;

  const handleClose = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    onClose();
  };

  const runPair = async (mode: 'full' | 'restricted', limits?: ChooseLimitsResult['limits']) => {
    if (!selectedAgent) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusyAction('pair');
    setError(null);
    setStep('requesting_offer');
    try {
      const next = await pairAgentOnThisMac(
        mx,
        {
          agentUserId: selectedAgent.userId,
          agentName: selectedAgent.agentName,
          mode,
          ...(limits ? { limits } : {}),
        },
        runUia,
        setStep,
        controller.signal
      );
      setSnapshotOverride(next);
      setShowLimits(false);
      setJustPaired(true);
    } catch (cause) {
      if (cause instanceof AuthenticationCancelled || controller.signal.aborted) return;
      setError(errorMessage(cause));
    } finally {
      setStep(null);
      setBusyAction(null);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const runMutation = async (
    kind: 'update' | 'disconnect',
    fn: () => Promise<DesktopAccessSnapshot>,
    onSuccess?: () => void
  ) => {
    setBusyAction(kind);
    setError(null);
    try {
      setSnapshotOverride(await fn());
      onSuccess?.();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveLimits = (result: ChooseLimitsResult) => {
    if (!selectedAgent) return;
    if (!pairedController) {
      void runPair(result.mode, result.limits);
      return;
    }
    void runMutation(
      'update',
      async () =>
        unwrapDesktopResult(
          await requireDesktopAccess().updateLimits({
            controllerKey: pairedController.controller_key,
            agentName: selectedAgent.agentName,
            mode: result.mode,
            ...result.limits,
          })
        ),
      () => setShowLimits(false)
    );
  };

  const title =
    agents.length === 0
      ? dt('featureUi.desktopAccess.title.default', 'Mac Computer Access')
      : !selectedAgent
        ? dt('featureUi.desktopAccess.title.pickAgent', 'Give an agent access to this Mac')
        : !desktopAvailable
          ? dt('featureUi.desktopAccess.title.browserPair', 'Give {{agent}} access to your Mac', {
              agent: selectedAgent.displayName,
            })
          : showLimits
            ? pairedController
              ? dt('featureUi.desktopAccess.title.editLimits', 'Edit limits for {{agent}}', {
                  agent: selectedAgent.displayName,
                })
              : dt('featureUi.desktopAccess.title.chooseLimits', 'Choose limits for {{agent}}', {
                  agent: selectedAgent.displayName,
                })
            : pairedController
              ? dt('featureUi.desktopAccess.title.manageAgent', '{{agent}} on this Mac', {
                  agent: selectedAgent.displayName,
                })
              : dt(
                  'featureUi.desktopAccess.title.allowFull',
                  'Allow {{agent}} full access to this Mac?',
                  { agent: selectedAgent.displayName }
                );

  const renderContent = () => {
    if (agents.length === 0) {
      return (
        <>
          <div className={css.ModalBody}>
            <Text size="T300" priority="300">
              {dt(
                'featureUi.desktopAccess.empty.noAgents',
                'No MindRoom agents found in this room.'
              )}
            </Text>
          </div>
          <div className={css.ModalFooter}>
            <Button
              type="button"
              size="400"
              radii="300"
              variant="Secondary"
              fill="Soft"
              onClick={handleClose}
            >
              <Text size="B400">{dt('featureUi.desktopAccess.actions.close', 'Close')}</Text>
            </Button>
          </div>
        </>
      );
    }

    if (!selectedAgent) {
      return (
        <>
          <div className={css.ModalBody}>
            <Text size="T300" priority="300">
              {dt(
                'featureUi.desktopAccess.picker.subtitle',
                'Choose which agent in this room should connect to this Mac.'
              )}
            </Text>
            <Box direction="Column" gap="200">
              {agents.map((agent) => {
                const existing = findPairedController(snapshot, agent.userId, requesterId);
                const full = existing
                  ? isControllerFullAccess(snapshot, existing.controller_key)
                  : false;
                return (
                  <button
                    key={agent.userId}
                    type="button"
                    className={css.AgentPickerButton}
                    onClick={() => {
                      setSelectedAgent(agent);
                      setError(null);
                      setShowLimits(false);
                      setJustPaired(false);
                    }}
                  >
                    <Box alignItems="Center" gap="200" style={{ minWidth: 0 }}>
                      {existing && (
                        <span className={classNames(css.StatusDot, css.StatusDotTone.active)} />
                      )}
                      <Box direction="Column" style={{ minWidth: 0 }}>
                        <Text size="T300" style={{ fontWeight: 600 }} truncate>
                          {agent.displayName}
                        </Text>
                        <Text size="T200" priority="300" truncate>
                          {agent.userId}
                        </Text>
                      </Box>
                    </Box>
                    {existing && (
                      <span
                        className={classNames(
                          css.StatusPill,
                          full && guiReady ? css.StatusPillTone.active : css.StatusPillTone.waiting
                        )}
                      >
                        <Text as="span" size="T200">
                          {full && guiReady
                            ? dt(
                                'featureUi.desktopAccess.status.fullAccessActive',
                                'Full Access active'
                              )
                            : full
                              ? shellReady
                                ? dt('featureUi.desktopAccess.status.shellReady', 'Shell ready')
                                : dt(
                                    'featureUi.desktopAccess.status.permissionsNeeded',
                                    'Permissions needed'
                                  )
                              : dt('featureUi.desktopAccess.status.restricted', 'Restricted')}
                        </Text>
                      </span>
                    )}
                  </button>
                );
              })}
            </Box>
          </div>
          <div className={css.ModalFooter}>
            <Button
              type="button"
              size="400"
              radii="300"
              variant="Secondary"
              fill="None"
              onClick={handleClose}
            >
              <Text size="B400">{dt('featureUi.desktopAccess.actions.cancel', 'Cancel')}</Text>
            </Button>
          </div>
        </>
      );
    }

    if (!desktopAvailable) {
      return <BrowserPairSection mx={mx} agent={selectedAgent} onClose={handleClose} />;
    }

    if (snapshot && snapshot.availability !== 'available') {
      return (
        <>
          <div className={css.ModalBody}>
            <div className={classNames(css.StatusBanner, css.StatusBannerTone.waiting)}>
              <Icon size="100" src={Icons.Warning} />
              <Text size="T300">
                {snapshot.helperError ??
                  dt(
                    'featureUi.desktopAccess.unavailable.description',
                    'Mac Computer Access is not available on this device.'
                  )}
              </Text>
            </div>
          </div>
          <div className={css.ModalFooter}>
            <Button
              type="button"
              size="400"
              radii="300"
              variant="Secondary"
              fill="Soft"
              onClick={handleClose}
            >
              <Text size="B400">{dt('featureUi.desktopAccess.actions.close', 'Close')}</Text>
            </Button>
          </div>
        </>
      );
    }

    if (showLimits) {
      return (
        <ChooseLimitsForm
          agentName={selectedAgent.displayName}
          snapshot={snapshot}
          controllerKey={pairedController?.controller_key}
          busy={busy}
          error={error}
          submitLabel={
            pairedController
              ? dt('featureUi.desktopAccess.limits.saveChanges', 'Save limits')
              : dt('featureUi.desktopAccess.limits.save', 'Allow with limits')
          }
          onSave={handleSaveLimits}
          onCancel={() => {
            setShowLimits(false);
            setError(null);
          }}
        />
      );
    }

    if (pairedController && snapshot) {
      return (
        <>
          <div className={css.ModalBody}>
            {!isFullAccess && !guiReady && (
              <Box alignItems="Center" gap="200" wrap="Wrap">
                <span className={classNames(css.StatusPill, css.StatusPillTone.waiting)}>
                  <span className={classNames(css.StatusDot, css.StatusDotTone.waiting)} />
                  <Text as="span" size="T200">
                    {dt('featureUi.desktopAccess.status.restricted', 'Restricted')}
                  </Text>
                </span>
              </Box>
            )}

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
                  : isFullAccess
                    ? dt('featureUi.desktopAccess.status.fullAccessActive', 'Full Access active')
                    : dt(
                        'featureUi.desktopAccess.banner.restrictedActive',
                        'Restricted access active on this Mac.'
                      )}
              </Text>
            </div>

            <PermissionsRow snapshot={snapshot} onSnapshot={setSnapshotOverride} />
            {!justPaired && !isFullAccess && (
              <div className={css.DisclosureBox}>
                <Box direction="Column" gap="100">
                  <Text size="T200" style={{ fontWeight: 600 }}>
                    {dt(
                      'featureUi.desktopAccess.consent.upgradeHeading',
                      'Switching to Full Access'
                    )}
                  </Text>
                  <Text size="T300">
                    {dt(
                      'featureUi.desktopAccess.consent.fullDisclosure',
                      '{{agent}} can see your screen, control every app, and run shell commands as your macOS user without asking, including after restart. Stop anytime from the menu bar.',
                      { agent: selectedAgent.displayName }
                    )}
                  </Text>
                </Box>
              </div>
            )}
            {error && (
              <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
                {error}
              </Text>
            )}
          </div>

          <div className={css.ModalFooter}>
            {!justPaired && (
              <>
                <Button
                  type="button"
                  size="400"
                  radii="300"
                  variant="Critical"
                  fill="None"
                  disabled={busy}
                  before={busyAction === 'disconnect' ? <Spinner size="100" /> : undefined}
                  onClick={() =>
                    void runMutation(
                      'disconnect',
                      () =>
                        disconnectAgentFromThisMac(
                          mx,
                          pairedController.controller_key,
                          selectedAgent.userId,
                          pairedController.allowed_agent_names[0] ?? selectedAgent.agentName
                        ),
                      () => setJustPaired(false)
                    )
                  }
                >
                  <Text size="B400">
                    {dt('featureUi.desktopAccess.actions.disconnect', 'Disconnect')}
                  </Text>
                </Button>
                <Button
                  type="button"
                  size="400"
                  radii="300"
                  variant="Secondary"
                  fill="Soft"
                  disabled={busy}
                  onClick={() => {
                    setShowLimits(true);
                    setError(null);
                  }}
                >
                  <Text size="B400">
                    {dt('featureUi.desktopAccess.actions.editLimits', 'Edit limits...')}
                  </Text>
                </Button>
                {!isFullAccess && (
                  <Button
                    type="button"
                    size="400"
                    radii="300"
                    variant="Primary"
                    fill="Soft"
                    disabled={busy}
                    before={busyAction === 'update' ? <Spinner size="100" /> : undefined}
                    onClick={() =>
                      void runMutation('update', async () =>
                        unwrapDesktopResult(
                          await requireDesktopAccess().updateLimits({
                            controllerKey: pairedController.controller_key,
                            agentName: selectedAgent.agentName,
                            mode: 'full',
                          })
                        )
                      )
                    }
                  >
                    <Text size="B400">
                      {dt('featureUi.desktopAccess.actions.switchToFull', 'Switch to Full Access')}
                    </Text>
                  </Button>
                )}
              </>
            )}
            <Button
              type="button"
              size="400"
              radii="300"
              variant="Primary"
              fill="Solid"
              disabled={busy}
              onClick={handleClose}
            >
              <Text size="B400">{dt('featureUi.desktopAccess.actions.done', 'Done')}</Text>
            </Button>
          </div>
        </>
      );
    }

    return (
      <>
        <div className={css.ModalBody}>
          <div className={css.DisclosureBox}>
            <Text size="T300">
              {dt(
                'featureUi.desktopAccess.consent.fullDisclosure',
                '{{agent}} can see your screen, control every app, and run shell commands as your macOS user without asking, including after restart. Stop anytime from the menu bar.',
                { agent: selectedAgent.displayName }
              )}
            </Text>
          </div>
          {step && (
            <Box alignItems="Center" gap="200">
              <Spinner size="100" />
              <Text size="T200" priority="300">
                {stepLabel(dt, step, selectedAgent.displayName)}
              </Text>
            </Box>
          )}
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
            onClick={handleClose}
          >
            <Text size="B400">{dt('featureUi.desktopAccess.actions.cancel', 'Cancel')}</Text>
          </Button>
          <Button
            type="button"
            size="400"
            radii="300"
            variant="Secondary"
            fill="Soft"
            disabled={busy}
            onClick={() => {
              setShowLimits(true);
              setError(null);
            }}
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
            before={busyAction === 'pair' ? <Spinner size="100" /> : undefined}
            onClick={() => void runPair('full')}
          >
            <Text size="B400">
              {dt('featureUi.desktopAccess.actions.allowFullAccess', 'Allow Full Access')}
            </Text>
          </Button>
        </div>
      </>
    );
  };

  return (
    <>
      <div className={css.ModalHeader}>
        <Text as="h2" size="H4" data-dialog-title="">
          {title}
        </Text>
        <DialogCloseButton
          label={dt('featureUi.desktopAccess.actions.close', 'Close')}
          iconSize="100"
          onClick={handleClose}
        />
      </div>
      {renderContent()}
    </>
  );
}

/** Mounts `DesktopAccessModal` inside `Modal500` whenever `desktopAccessModalAtom` is set. */
export function DesktopAccessModalDialog() {
  const request = useAtomValue(desktopAccessModalAtom);
  const setRequest = useSetAtom(desktopAccessModalAtom);
  const mx = useMatrixClient();
  const { run: runUia, prompt: uiaPrompt } = useAuthenticatedAction();
  const [limitsOpen, setLimitsOpen] = useState(false);

  const modalKey = request
    ? `${request.roomId ?? ''}:${request.agentUserId ?? ''}:${request.agentName ?? ''}`
    : '';

  useEffect(() => {
    setLimitsOpen(false);
  }, [modalKey]);

  const agents = useMemo<RoomMindroomAgent[]>(() => {
    if (!request) return [];
    if (request.agentUserId) {
      const agentName = request.agentName ?? extractAgentName(request.agentUserId);
      const roomAgent = request.roomId
        ? getRoomMindroomAgents(mx, request.roomId).find(
            (agent) => agent.userId === request.agentUserId
          )
        : undefined;
      const roomMember =
        !roomAgent && request.roomId
          ? mx.getRoom(request.roomId)?.getMember?.(request.agentUserId)
          : undefined;
      const userDisplayName = mx.getUser?.(request.agentUserId)?.displayName?.trim();
      const displayName =
        roomAgent?.displayName ??
        (roomMember ? resolveMemberDisplayName(roomMember, agentName) : undefined) ??
        (userDisplayName && userDisplayName !== request.agentUserId
          ? userDisplayName
          : undefined) ??
        agentName;
      return [{ userId: request.agentUserId, agentName, displayName }];
    }
    if (request.roomId) return getRoomMindroomAgents(mx, request.roomId);
    return [];
  }, [mx, request]);

  if (!request) return uiaPrompt;

  const close = () => setRequest(null);

  return (
    <>
      <Modal500
        requestClose={close}
        fitContent
        narrow={!limitsOpen}
        className={classNames(css.ModalDialog, limitsOpen && css.ModalDialogLimits)}
      >
        <DesktopAccessModal
          key={modalKey}
          mx={mx}
          agents={agents}
          runUia={runUia}
          onClose={close}
          onLimitsOpenChange={setLimitsOpen}
        />
      </Modal500>
      {uiaPrompt}
    </>
  );
}
