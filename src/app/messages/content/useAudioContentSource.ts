import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import type { EventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { downloadCachedAttachment } from '../../event-store/cache/attachmentRepository';
import { AsyncState, AsyncStatus } from '../../lib/hooks/useAsyncCallback';
import { revokeBlobUrl, useBlobUrlCleanup } from '../../lib/hooks/useBlobUrlCleanup';

type AudioSource = {
  /** The event that carries the attachment; the attachment cache files the download under it. */
  owner?: EventAttachmentOwner;
  mimeType: string;
  /** The `mxc://` URI of the file. */
  url: string;
  /** The key of an attachment in an encrypted room. */
  encInfo?: EncryptedAttachmentInfo;
};

const REPLACED_MESSAGE = 'AudioContentSource: Request replaced!';

const IDLE: AsyncState<string> = { status: AsyncStatus.Idle };

/**
 * Names one piece of audio: equal for equal sources, different when the event or its revision,
 * the type, the media URI or the encryption key changes. Held in memory only, never stored.
 */
export const getAudioContentSourceIdentity = ({
  owner,
  mimeType,
  url,
  encInfo,
}: AudioSource): string =>
  JSON.stringify({
    roomId: owner?.roomId,
    eventId: owner?.eventId,
    revisionTs: owner?.revisionTs,
    revisionId: owner?.revisionId,
    redacted: owner?.redacted,
    mimeType,
    url,
    v: encInfo?.v ?? '',
    iv: encInfo?.iv ?? '',
    sha256: encInfo?.hashes?.sha256 ?? '',
    k: encInfo?.key?.k ?? '',
  });

/** What the hook remembers between renders outside React state. */
type Ledger = {
  /** The media of the latest commit; a load function made for other media is stale. */
  identity: string;
  /** Raised by every load, media change and unmount; a load is current while nothing raised it. */
  generation: number;
  mounted: boolean;
  /**
   * Object URLs made here whose success state has not rendered. Nothing else revokes them until
   * it renders; from then on `useBlobUrlCleanup` does.
   */
  unrendered: string[];
  /** The newest of them, while no later load or media change has replaced its success state. */
  awaited?: string;
};

/**
 * Downloads an audio attachment on demand and serves it to an `<audio>` element as a `blob:` URL.
 * Nothing loads until the load function runs; the state then goes loading, then success with the
 * URL, or error. A change of media (see `getAudioContentSourceIdentity`) returns the state to idle
 * at once and drops every load in flight.
 *
 * Every URL is revoked exactly once: here while its success state has not rendered, by
 * `useBlobUrlCleanup` after. The load's promise resolves before that render, so a newer load or
 * an unmount can revoke the URL it resolved with: render from the state, not from the promise.
 */
export function useAudioContentSource(
  source: AudioSource
): [AsyncState<string>, () => Promise<string>] {
  const { owner, mimeType, url, encInfo } = source;
  const mx = useMatrixClient();
  const identity = getAudioContentSourceIdentity(source);
  const [slot, setSlot] = useState(() => ({ identity, state: IDLE }));
  // The previous media's state reads as idle until the commit below replaces it.
  const state = slot.identity === identity ? slot.state : IDLE;
  const ledgerRef = useRef<Ledger>({ identity, generation: 0, mounted: true, unrendered: [] });

  useBlobUrlCleanup(state);

  useLayoutEffect(() => {
    const ledger = ledgerRef.current;
    // Mounted again after a StrictMode check.
    ledger.mounted = true;
    return () => {
      ledger.mounted = false;
      ledger.generation += 1;
      ledger.awaited = undefined;
      ledger.unrendered.forEach(revokeBlobUrl);
      ledger.unrendered = [];
    };
  }, []);

  // After each commit of new media or a new state (every update makes a new state object): start
  // over when the media changed, then settle who revokes each URL. A layout effect, so a load
  // started after this commit never revokes a URL the committed state holds.
  useLayoutEffect(() => {
    const ledger = ledgerRef.current;
    if (ledger.identity !== identity) {
      ledger.identity = identity;
      ledger.generation += 1;
      ledger.awaited = undefined;
      setSlot({ identity, state: IDLE });
    }
    const rendered = state.status === AsyncStatus.Success ? state.data : undefined;
    ledger.unrendered = ledger.unrendered.filter((objectUrl) => {
      if (objectUrl === rendered) return false;
      if (objectUrl === ledger.awaited) return true;
      // Replaced before its success state ever rendered.
      revokeBlobUrl(objectUrl);
      return false;
    });
  }, [identity, state]);

  const load = useCallback(async (): Promise<string> => {
    const ledger = ledgerRef.current;
    // A load function kept from before a media change or from before unmount changes nothing.
    if (!ledger.mounted || ledger.identity !== identity) throw new Error(REPLACED_MESSAGE);
    ledger.generation += 1;
    const generation = ledger.generation;
    const isCurrent = () => ledger.generation === generation;
    ledger.awaited = undefined;
    setSlot({ identity, state: { status: AsyncStatus.Loading } });

    let blob: Blob;
    try {
      blob = await downloadCachedAttachment(mx, {
        owner,
        mxcUri: url,
        mimeType,
        ...(encInfo ? { encryptedFile: { ...encInfo, url } } : {}),
      });
    } catch (error) {
      if (isCurrent()) setSlot({ identity, state: { status: AsyncStatus.Error, error } });
      throw error;
    }
    // Replaced while downloading: the download finished for nothing, and makes no URL.
    if (!isCurrent()) throw new Error(REPLACED_MESSAGE);

    const objectUrl = URL.createObjectURL(blob);
    ledger.unrendered.push(objectUrl);
    ledger.awaited = objectUrl;
    setSlot({ identity, state: { status: AsyncStatus.Success, data: objectUrl } });
    return objectUrl;
  }, [mx, identity, owner, mimeType, url, encInfo]);

  return [state, load];
}
