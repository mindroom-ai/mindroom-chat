import { type AnimationEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAtomValue } from 'jotai';
import { Icon, Icons, Spinner, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { ClientEvent, SyncState, type MatrixClient, type SyncStateData } from 'matrix-js-sdk';
import { useHomeserverUnreachable } from '../matrix/client/homeserverReachability';
import { useSyncStalled } from '../matrix/client/syncStall';
import { useCloudflareAccessSignInRequired } from '../native/cloudflareAccess';
import { hostOf } from '../lib/httpUrl';
import { NOTICE_LEAVE_MS, pageNoticeSlotAtom } from '../ui/noticeSlots';
import { PageSlot } from '../ui/noticeSlots.css';
import { Surface } from '../ui/glass/GlassPrimitives';
import * as css from './SyncStatus.css';

type SyncStatusProps = {
  mx: MatrixClient;
  /** Whether the sync loop has reported a state yet; until then the client is catching up. */
  reported?: boolean;
};

type SyncSnapshot = {
  current: SyncState | null;
  catchingUp: boolean;
};

/** Startup (Prepared) and reconnects (Catchup) catch up until a sync says the SDK has. */
const nextSnapshot = (
  previous: SyncSnapshot,
  current: SyncState | null,
  data?: SyncStateData
): SyncSnapshot => {
  if (current === SyncState.Prepared || current === SyncState.Catchup) {
    return { current, catchingUp: true };
  }
  if (current === SyncState.Syncing && previous.catchingUp) {
    return { current, catchingUp: data?.catchingUp === true };
  }
  return { current, catchingUp: current === SyncState.Syncing ? false : previous.catchingUp };
};

const readInitialSnapshot = (mx: MatrixClient): SyncSnapshot => {
  const current = typeof mx.getSyncState === 'function' ? mx.getSyncState() : null;
  const data =
    typeof mx.getSyncStateData === 'function' ? mx.getSyncStateData() ?? undefined : undefined;
  return nextSnapshot({ current: null, catchingUp: false }, current, data);
};

/**
 * How the connection is, while that needs saying: a lost connection (failed requests, an
 * unanswered /sync, or the sync loop's error), a needed organization sign-in, or catching up,
 * also before the sync loop has reported at all (`reported` false). Read out from the client
 * root's polite status region, which stays mounted, and shown as a pill in the page's notice place
 * (ui/noticeSlots.tsx), over the page without moving it; before the layout offers that place, over
 * the top of the app from the status region.
 */
export function SyncStatus({ mx, reported = true }: SyncStatusProps) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<SyncSnapshot>(() => readInitialSnapshot(mx));
  const unreachable = useHomeserverUnreachable(mx);
  const stalled = useSyncStalled(mx);
  const baseUrl = mx.getHomeserverUrl();
  const signInRequired = useCloudflareAccessSignInRequired(baseUrl);

  useEffect(() => {
    const handleSync = (current: SyncState, _previous: SyncState | null, data?: SyncStateData) => {
      setSnapshot((previous) => nextSnapshot(previous, current, data));
    };
    mx.on(ClientEvent.Sync, handleSync);
    return () => {
      mx.removeListener(ClientEvent.Sync, handleSync);
    };
  }, [mx]);

  const syncFailed = snapshot.current === SyncState.Error;
  let status: Status | undefined;
  if (!reported) {
    status = { message: t('sharedUi.clientRoot.catchingUp'), critical: false };
  } else if (signInRequired && syncFailed) {
    status = {
      message: t('mindroomUi.native.cloudflareAccess.signInRequired', { value1: hostOf(baseUrl) }),
      critical: true,
    };
  } else if (unreachable || stalled || syncFailed) {
    status = {
      message:
        snapshot.current === SyncState.Reconnecting
          ? t('sharedUi.syncStatus.connectionLostReconnecting')
          : t('sharedUi.syncStatus.connectionLost'),
      critical: true,
    };
  } else if (snapshot.catchingUp) {
    status = { message: t('sharedUi.syncStatus.catchingUp'), critical: false };
  }

  return (
    <>
      <span className={css.Announcement} data-sync-status-announcement>
        {status?.message}
      </span>
      <SyncStatusPill status={status} />
    </>
  );
}

type Status = { message: string; critical: boolean };

/**
 * The pill: it comes in when there is something to say, changes in place, and plays its way out
 * once there is nothing (NOTICE_LEAVE_MS), from the place it was in.
 */
function SyncStatusPill({ status }: { status: Status | undefined }) {
  const pageSlot = useAtomValue(pageNoticeSlotAtom);
  const [shown, setShown] = useState(status);
  if (status && (status.message !== shown?.message || status.critical !== shown.critical)) {
    setShown(status);
  }
  // It comes in once a time: rebuilt in the page's place after showing over the start, it stays.
  const cameIn = useRef(false);
  const leaving = !status && shown !== undefined;
  useEffect(() => {
    if (!leaving) return undefined;
    const timer = setTimeout(() => {
      setShown(undefined);
      cameIn.current = false;
    }, NOTICE_LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  if (!shown) return null;
  const pill = (
    <Surface
      className={css.Pill}
      variant={shown.critical ? 'Critical' : 'Surface'}
      aria-hidden
      data-testid="client-sync-status"
      data-leaving={leaving || undefined}
      data-settled={cameIn.current || undefined}
      onAnimationEnd={(event: AnimationEvent<HTMLElement>) => {
        if (event.target === event.currentTarget && !leaving) cameIn.current = true;
      }}
    >
      {shown.critical ? (
        <Icon src={Icons.Warning} size="100" filled />
      ) : (
        <Spinner size="100" variant="Secondary" />
      )}
      <Text as="span" size="L400" className={css.PillText}>
        {shown.message}
      </Text>
    </Surface>
  );
  return pageSlot ? (
    createPortal(pill, pageSlot)
  ) : (
    <div className={PageSlot({ phone: false })}>{pill}</div>
  );
}
