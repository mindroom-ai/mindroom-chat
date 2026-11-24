import { useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { Box, Button, Icon, Icons, Spinner, Text, color } from 'folds';
import type { MatrixClient } from 'matrix-js-sdk';
import { copyToClipboard } from '../lib/dom';
import { errorMessage } from '../lib/errorMessage';
import { MAC_APP_BREW_COMMAND, useMacAppDownloadUrl } from '../native/macApp';
import { IconButton } from '../ui/glass/GlassPrimitives';
import { relayPairToMac, useRegisteredMacDevices, type RelayPairState } from './browserPairRelay';
import { useDesktopT, type RoomMindroomAgent } from './desktopAccessHelpers';
import * as css from './desktopAccess.css';

type BrowserPairSectionProps = {
  mx: MatrixClient;
  agent: RoomMindroomAgent;
  onClose: () => void;
};

/** Browser-to-Mac pairing relay (with 6-digit SAS verification) or Mac app download prompt. */
export function BrowserPairSection({ mx, agent, onClose }: BrowserPairSectionProps) {
  const dt = useDesktopT();
  const macDevices = useRegisteredMacDevices(mx);
  const downloadUrl = useMacAppDownloadUrl(macDevices.length === 0);

  const [selectedDeviceId, setSelectedDeviceId] = useState<string>();
  const [relayState, setRelayState] = useState<RelayPairState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>();
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  const selectedMac =
    macDevices.find((device) => device.device_id === selectedDeviceId) ?? macDevices[0];

  const handleCancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    onClose();
  };

  const handleSendToMac = async () => {
    if (!selectedMac) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setRelayState({ phase: 'requesting_offer' });
    try {
      await relayPairToMac(
        mx,
        selectedMac,
        agent.userId,
        agent.agentName,
        setRelayState,
        controller.signal
      );
    } catch (cause) {
      if (controller.signal.aborted) return;
      setRelayState(null);
      setError(errorMessage(cause));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  if (!selectedMac) {
    return (
      <>
        <div className={css.ModalBody}>
          <Text size="T300">
            {dt(
              'featureUi.desktopAccess.browser.noMacDescription',
              'To give {{agent}} access to your Mac, sign in with this account in MindRoom Chat for Mac.',
              { agent: agent.agentName }
            )}
          </Text>

          <Box direction="Column" alignItems="Start" gap="300">
            <Button
              as="a"
              href={downloadUrl}
              target="_blank"
              rel="noreferrer noopener"
              size="400"
              radii="300"
              variant="Primary"
              fill="Solid"
              before={<Icon size="100" src={Icons.Download} />}
            >
              <Text size="B400">
                {dt(
                  'featureUi.desktopAccess.browser.downloadMacApp',
                  'Download MindRoom Chat for Mac'
                )}
              </Text>
            </Button>

            <Box direction="Column" gap="100" style={{ maxWidth: '100%' }}>
              <Text size="T200" priority="300">
                {dt('featureUi.desktopAccess.browser.brewHint', 'Or install with Homebrew:')}
              </Text>
              <div className={css.CodeCopyBox}>
                <Text as="code" size="T200" className={css.MonospaceText}>
                  {MAC_APP_BREW_COMMAND}
                </Text>
                <IconButton
                  type="button"
                  size="300"
                  radii="300"
                  variant="Background"
                  aria-label={dt('featureUi.desktopAccess.browser.copyCommand', 'Copy command')}
                  onClick={() => {
                    setCopied(undefined);
                    void copyToClipboard(MAC_APP_BREW_COMMAND).then(setCopied);
                  }}
                >
                  <Icon size="100" src={copied ? Icons.Check : Icons.Code} />
                </IconButton>
              </div>
              <Text
                as="span"
                size="T200"
                aria-live="polite"
                style={copied === false ? { color: color.Critical.Main } : undefined}
              >
                {copied === undefined
                  ? ''
                  : copied
                    ? dt('featureUi.desktopAccess.browser.copied', 'Copied')
                    : dt('featureUi.desktopAccess.browser.copyFailed', 'Copy failed')}
              </Text>
            </Box>
          </Box>
        </div>

        <div className={css.ModalFooter}>
          <Button
            type="button"
            size="400"
            radii="300"
            variant="Secondary"
            fill="Soft"
            onClick={onClose}
          >
            <Text size="B400">{dt('featureUi.desktopAccess.actions.close', 'Close')}</Text>
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className={css.ModalBody}>
        {relayState === null && (
          <>
            <Text size="T300">
              {dt(
                'featureUi.desktopAccess.browser.relayDescription',
                'Send a pairing request to {{mac}}. You will confirm the 6-digit code and choose Full Access or limits on your Mac.',
                { mac: selectedMac.label }
              )}
            </Text>

            {macDevices.length > 1 && (
              <Box
                direction="Column"
                gap="100"
                role="radiogroup"
                aria-label={dt('featureUi.desktopAccess.browser.selectMac', 'Choose a Mac')}
              >
                {macDevices.map((device) => {
                  const selected = device.device_id === selectedMac.device_id;
                  return (
                    <button
                      key={device.device_id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={classNames(
                        css.LimitsOptionButton,
                        selected && css.LimitsOptionSelected
                      )}
                      onClick={() => setSelectedDeviceId(device.device_id)}
                    >
                      <Text size="T300">{device.label}</Text>
                      {selected && <Icon size="100" src={Icons.Check} />}
                    </button>
                  );
                })}
              </Box>
            )}
          </>
        )}

        {relayState?.phase === 'requesting_offer' && (
          <Box alignItems="Center" gap="200">
            <Spinner size="100" />
            <Text size="T300">
              {dt('featureUi.desktopAccess.steps.requestingOffer', 'Contacting {{agent}}...', {
                agent: agent.agentName,
              })}
            </Text>
          </Box>
        )}

        {relayState?.phase === 'awaiting_mac' && (
          <Box direction="Column" gap="300">
            <div className={css.SasCodeBox}>
              <Text size="T200" priority="300">
                {dt('featureUi.desktopAccess.sas.label', 'Verification code')}
              </Text>
              <Text as="span" className={css.SasCodeDigits} data-testid="desktop-sas-code">
                {relayState.sasCode}
              </Text>
            </div>
            <Text size="T300">
              {dt(
                'featureUi.desktopAccess.browser.confirmOnMac',
                'Confirm this code on {{mac}} to approve access.',
                { mac: selectedMac.label }
              )}
            </Text>
            <Box alignItems="Center" gap="200">
              <Spinner size="100" />
              <Text size="T200" priority="300">
                {dt(
                  'featureUi.desktopAccess.browser.waitingOnMac',
                  'Waiting for confirmation on {{mac}}...',
                  { mac: selectedMac.label }
                )}
              </Text>
            </Box>
          </Box>
        )}

        {relayState?.phase === 'confirming' && (
          <Box alignItems="Center" gap="200">
            <Spinner size="100" />
            <Text size="T300">
              {dt('featureUi.desktopAccess.steps.confirming', 'Confirming pairing...')}
            </Text>
          </Box>
        )}

        {relayState?.phase === 'paired' && (
          <div className={classNames(css.StatusBanner, css.StatusBannerTone.active)}>
            <Icon size="100" src={Icons.Check} />
            <Text size="T300">
              {dt(
                'featureUi.desktopAccess.browser.paired',
                '{{agent}} is now paired with {{mac}}.',
                { agent: agent.agentName, mac: selectedMac.label }
              )}
            </Text>
          </div>
        )}

        {error && (
          <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
            {error}
          </Text>
        )}
      </div>

      <div className={css.ModalFooter}>
        {relayState?.phase === 'paired' ? (
          <Button
            type="button"
            size="400"
            radii="300"
            variant="Primary"
            fill="Solid"
            onClick={onClose}
          >
            <Text size="B400">{dt('featureUi.desktopAccess.actions.done', 'Done')}</Text>
          </Button>
        ) : (
          <>
            <Button
              type="button"
              size="400"
              radii="300"
              variant="Secondary"
              fill="None"
              onClick={handleCancel}
            >
              <Text size="B400">{dt('featureUi.desktopAccess.actions.cancel', 'Cancel')}</Text>
            </Button>
            {relayState === null && (
              <Button
                type="button"
                size="400"
                radii="300"
                variant="Primary"
                fill="Solid"
                onClick={() => void handleSendToMac()}
              >
                <Text size="B400">
                  {dt('featureUi.desktopAccess.browser.allowOnMac', 'Allow on {{mac}}', {
                    mac: selectedMac.label,
                  })}
                </Text>
              </Button>
            )}
          </>
        )}
      </div>
    </>
  );
}
