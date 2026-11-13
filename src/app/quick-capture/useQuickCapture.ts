import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { isComposingKey } from '../shortcuts/shortcuts';
import {
  createCaptureClient,
  openCaptureChannel,
  type CaptureChannel,
  type CaptureClient,
  type CaptureClientSnapshot,
} from './captureChannel';

const CONNECTING: CaptureClientSnapshot = { status: 'connecting' };
const ABSENT: CaptureClientSnapshot = { status: 'absent' };
const subscribeToNothing = () => () => undefined;

/**
 * The widget's client of the host (`channel`, else the page's own), saying hello while the page
 * shows. Without `BroadcastChannel` no host can answer, so the widget is absent at once.
 */
export const useQuickCapture = (channel: CaptureChannel | undefined) => {
  // Undefined until the effect runs; null where no channel opens.
  const [client, setClient] = useState<CaptureClient | null>();
  useEffect(() => {
    const opened = channel ?? openCaptureChannel();
    if (!opened) {
      setClient(null);
      return undefined;
    }
    const started = createCaptureClient(opened);
    setClient(started);
    started.start();
    return () => {
      started.stop();
      if (!channel) opened.close();
    };
  }, [channel]);
  const fallback = client === null ? ABSENT : CONNECTING;
  const snapshot = useSyncExternalStore(
    client?.subscribe ?? subscribeToNothing,
    client?.getSnapshot ?? (() => fallback)
  );
  return { client, snapshot };
};

/**
 * Calls `onEscape` for an Escape that nothing in the widget took (each part takes the keys it
 * acts on), wherever the focus is, the page itself included.
 */
export const useCaptureEscape = (onEscape: () => void) => {
  const latest = useLatestRef(onEscape);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isComposingKey(event) || event.key !== 'Escape') return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [latest]);
};
