import {
  CSSProperties,
  ReactNode,
  useCallback,
  useEffect,
  useReducer,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Icon, Icons, Spinner, Text, color, config, toRem } from 'folds';
import {
  VerificationPhase,
  VerificationRequestEvent,
  VerifierEvent,
  canAcceptVerificationRequest,
  type EmojiMapping,
  type ShowSasCallbacks,
  type VerificationRequest,
  type Verifier,
} from 'matrix-js-sdk/lib/crypto-api';
import { SecurityDialog } from './SecurityDialog';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { errorMessage } from '../../utils/errorMessage';

/** Short authentication strings: the seven emoji (spec: "Short Authentication String (SAS) verification"). */
const SAS_VERIFICATION = 'm.sas.v1';

const KEY = 'sharedUi.deviceVerification';

// Requests whose emoji comparison this client already started, and verifiers it already runs:
// both must happen once per request, however often the dialog mounts.
const sasStarted = new WeakSet<VerificationRequest>();
const verifiersRunning = new WeakSet<Verifier>();

/** Re-renders on every change the request reports: phase, accepting, verifier, cancellation. */
const useRequestUpdates = (request: VerificationRequest): void => {
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    request.on(VerificationRequestEvent.Change, refresh);
    return () => {
      request.off(VerificationRequestEvent.Change, refresh);
    };
  }, [request]);
};

/**
 * The emoji the verifier wants compared, once both sides exchanged keys. Running the verifier is
 * what sends our side of the exchange, so this starts it the first time it sees it.
 */
const useShortAuthString = (
  verifier: Verifier | undefined,
  onFailure: (error: unknown) => void
): ShowSasCallbacks | null => {
  const [sas, setSas] = useState<ShowSasCallbacks | null>(null);
  useEffect(() => {
    if (!verifier) return undefined;
    setSas(verifier.getShowSasCallbacks());
    verifier.on(VerifierEvent.ShowSas, setSas);
    if (!verifiersRunning.has(verifier)) {
      verifiersRunning.add(verifier);
      // A cancelled verification rejects here; the request itself reports the cancellation.
      verifier.verify().catch((error: unknown) => {
        if (!verifier.hasBeenCancelled) onFailure(error);
      });
    }
    return () => {
      verifier.off(VerifierEvent.ShowSas, setSas);
    };
  }, [verifier, onFailure]);
  return sas;
};

// Seven cells of 4rem fit four to a row in the dialog, so the string reads as 4 + 3.
const emojiCellWidth = toRem(64);
const emojiGlyphSize = { fontSize: toRem(36), lineHeight: toRem(44) };

function EmojiRow({ emoji }: { emoji: EmojiMapping[] }) {
  const cells = emoji.map(([glyph, name], position) => ({ glyph, name, position }));
  return (
    <Box
      role="list"
      wrap="Wrap"
      justifyContent="Center"
      gap="300"
      style={{ paddingBlock: config.space.S200 }}
    >
      {cells.map((cell) => (
        // The same emoji can appear twice in one string, so the position keys the cell.
        <Box
          key={cell.position}
          role="listitem"
          aria-label={cell.name}
          direction="Column"
          alignItems="Center"
          gap="100"
          style={{ width: emojiCellWidth, textAlign: 'center' }}
        >
          <span aria-hidden style={emojiGlyphSize}>
            {cell.glyph}
          </span>
          <Text size="T200" priority="300">
            {cell.name}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function Waiting({ children }: { children: ReactNode }) {
  return (
    <Box alignItems="Center" gap="200" role="status">
      <Spinner size="200" variant="Secondary" />
      <Text size="T300">{children}</Text>
    </Box>
  );
}

type CompareProps = {
  sas: ShowSasCallbacks;
};

/** Both devices show the same seven emoji only when nobody sits between them. */
function CompareEmoji({ sas }: CompareProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  if (!sas.sas.emoji) {
    return (
      <Text size="T300" style={{ color: color.Critical.Main }}>
        {t(`${KEY}.unexpectedErrorVerificationIsStartedButVerifierIsMissing`)}
      </Text>
    );
  }
  if (confirming) return <Waiting>{t(`${KEY}.waitingForTheResponseFromOtherDevice`)}</Waiting>;

  const confirm = () => {
    setConfirming(true);
    sas.confirm().catch(() => setConfirming(false));
  };

  return (
    <Box direction="Column" gap="400">
      <Text size="T300">{t(`${KEY}.confirmTheEmojiBelowAreDisplayedOnBothDevicesInTheSame`)}</Text>
      <EmojiRow emoji={sas.sas.emoji} />
      <Box gap="200">
        <Button
          style={{ flexGrow: 1 }}
          variant="Primary"
          fill="Solid"
          onClick={confirm}
          before={<Icon size="100" src={Icons.Check} />}
        >
          <Text size="B400">{t(`${KEY}.theyMatch`)}</Text>
        </Button>
        <Button
          style={{ flexGrow: 1 }}
          variant="Critical"
          fill="Soft"
          onClick={() => sas.mismatch()}
          before={<Icon size="100" src={Icons.Cross} />}
        >
          <Text size="B400">{t(`${KEY}.doNotMatch`)}</Text>
        </Button>
      </Box>
    </Box>
  );
}

type StepProps = {
  request: VerificationRequest;
  onClose: () => void;
};

/** What the person sees and can do in the request's current phase. */
function VerificationStep({ request, onClose }: StepProps) {
  const { t } = useTranslation();
  const [failure, setFailure] = useState<string>();
  const [accepting, setAccepting] = useState(false);
  const fail = useCallback((error: unknown) => setFailure(errorMessage(error)), []);
  const { phase, verifier } = request;
  const sas = useShortAuthString(phase === VerificationPhase.Started ? verifier : undefined, fail);

  // The side that sent the request starts the emoji comparison once the other side is ready.
  useEffect(() => {
    if (phase !== VerificationPhase.Ready || !request.initiatedByMe || request.verifier) return;
    if (sasStarted.has(request)) return;
    sasStarted.add(request);
    request.startVerification(SAS_VERIFICATION).catch(fail);
  }, [phase, request, fail]);

  if (failure !== undefined && phase !== VerificationPhase.Cancelled) {
    return (
      <Box direction="Column" gap="400">
        <Text size="T300" style={{ color: color.Critical.Main }}>
          <b>{failure}</b>
        </Text>
        <Button variant="Secondary" fill="Soft" onClick={onClose}>
          <Text size="B400">{t(`${KEY}.close`)}</Text>
        </Button>
      </Box>
    );
  }

  switch (phase) {
    case VerificationPhase.Unsent:
    case VerificationPhase.Requested: {
      if (request.initiatedByMe) {
        return (
          <Box direction="Column" gap="400">
            <Text size="T300">{t(`${KEY}.pleaseAcceptTheRequestFromOtherDevice`)}</Text>
            <Waiting>{t(`${KEY}.waitingForRequestToBeAccepted`)}</Waiting>
          </Box>
        );
      }
      const accept = () => {
        if (!canAcceptVerificationRequest(request)) return;
        setAccepting(true);
        request.accept().catch((error: unknown) => {
          setAccepting(false);
          fail(error);
        });
      };
      return (
        <Box direction="Column" gap="400">
          <Text size="T300">{t(`${KEY}.clickAcceptToStartTheVerificationProcess`)}</Text>
          <Button
            variant="Primary"
            fill="Solid"
            disabled={accepting || request.accepting}
            before={
              accepting || request.accepting ? (
                <Spinner size="100" variant="Primary" fill="Solid" />
              ) : undefined
            }
            onClick={accept}
          >
            <Text size="B400">{t(`${KEY}.accept`)}</Text>
          </Button>
        </Box>
      );
    }
    case VerificationPhase.Ready:
      return request.initiatedByMe ? (
        <Waiting>{t(`${KEY}.startingVerificationUsingEmojiComparison`)}</Waiting>
      ) : (
        <Box direction="Column" gap="400">
          <Text size="T300">{t(`${KEY}.verificationRequestHasBeenAccepted`)}</Text>
          <Waiting>{t(`${KEY}.waitingForTheResponseFromOtherDevice`)}</Waiting>
        </Box>
      );
    case VerificationPhase.Started:
      if (!verifier) {
        return (
          <Text size="T300" style={{ color: color.Critical.Main }}>
            {t(`${KEY}.unexpectedErrorVerificationIsStartedButVerifierIsMissing`)}
          </Text>
        );
      }
      return sas ? (
        <CompareEmoji sas={sas} />
      ) : (
        <Waiting>{t(`${KEY}.waitingForTheResponseFromOtherDevice`)}</Waiting>
      );
    case VerificationPhase.Done:
      return (
        <Box direction="Column" gap="400">
          <Box alignItems="Center" gap="200">
            <Icon src={Icons.ShieldUser} style={{ color: color.Success.Main }} />
            <Text size="T300">{t(`${KEY}.yourDeviceIsVerified`)}</Text>
          </Box>
          <Button variant="Primary" fill="Solid" onClick={onClose}>
            <Text size="B400">{t(`${KEY}.okay`)}</Text>
          </Button>
        </Box>
      );
    case VerificationPhase.Cancelled:
    default:
      return (
        <Box direction="Column" gap="400">
          <Text size="T300">{t(`${KEY}.verificationHasBeenCanceled`)}</Text>
          <Button variant="Secondary" fill="Soft" onClick={onClose}>
            <Text size="B400">{t(`${KEY}.close`)}</Text>
          </Button>
        </Box>
      );
  }
}

/** Ends a request that is still in flight, for both sides; a finished one stays as it is. */
export const cancelPendingVerification = (request: VerificationRequest): void => {
  if (request.pending) request.cancel().catch(() => undefined);
};

/**
 * The other side of the request: the session's name and ID when it is one of ours, so the person
 * can tell which session asked, or the other person's user ID.
 */
function VerificationPeer({ request }: { request: VerificationRequest }) {
  const client = useMatrixClient();
  const { otherUserId, otherDeviceId } = request;
  const [deviceName, setDeviceName] = useState<string>();

  useEffect(() => {
    setDeviceName(undefined);
    const crypto = client.getCrypto();
    if (!crypto || !otherDeviceId) return undefined;
    let current = true;
    crypto.getUserDeviceInfo([otherUserId]).then(
      (devices) => {
        const name = devices.get(otherUserId)?.get(otherDeviceId)?.displayName;
        if (current) setDeviceName(name);
      },
      () => undefined
    );
    return () => {
      current = false;
    };
  }, [client, otherUserId, otherDeviceId]);

  const own = otherUserId === client.getUserId();
  const title = own ? deviceName ?? otherDeviceId : otherUserId;
  if (!title) return null;

  return (
    <Box
      alignItems="Center"
      gap="300"
      className={ContainerColor({ variant: 'SurfaceVariant' })}
      style={PEER_STYLE}
    >
      <Icon src={own ? Icons.Monitor : Icons.User} />
      <Box direction="Column" style={{ minWidth: 0 }}>
        <Text size="T300" truncate>
          {title}
        </Text>
        {otherDeviceId && otherDeviceId !== title && (
          <Text size="T200" priority="300" truncate>
            {otherDeviceId}
          </Text>
        )}
      </Box>
    </Box>
  );
}

const PEER_STYLE: CSSProperties = {
  padding: `${config.space.S200} ${config.space.S300}`,
  borderRadius: config.radii.R400,
};

type VerificationRequestDialogProps = {
  request: VerificationRequest;
  /** Called once the dialog should go away; a request still in flight is cancelled first. */
  onClose: () => void;
};

/**
 * Walks one interactive verification (to-device or in a room) from request to done: waits for or
 * offers acceptance, compares emoji, and reports the outcome. Closing it while the request is
 * pending cancels the request for both sides.
 */
export function VerificationRequestDialog({ request, onClose }: VerificationRequestDialogProps) {
  const { t } = useTranslation();
  useRequestUpdates(request);

  const close = () => {
    cancelPendingVerification(request);
    onClose();
  };

  return (
    <SecurityDialog title={t(`${KEY}.deviceVerification`)} onClose={close}>
      <VerificationPeer request={request} />
      <VerificationStep request={request} onClose={close} />
    </SecurityDialog>
  );
}
