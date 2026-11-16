import { useContext, useEffect, useState } from 'react';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { revokeBlobUrl } from '../../lib/hooks/useBlobUrlCleanup';
import { useLatestRef } from '../../lib/hooks/useLatestRef';
import { ImageOverlay } from './ImageOverlay';
import { ImageSlidesContext, type ImageSlide } from './imageSlides';
import { loadImageOriginal } from './imageOriginal';

type ImageGalleryProps = {
  /** The picture the viewer opens on. */
  slide: ImageSlide;
  requestClose: () => void;
};

/** A slide's loaded original, for the slide `key` names. */
type Original = { key: string; src?: string; failed?: boolean };

/** What a slide's original is loaded from: its event's revision and its file. */
const slideKey = ({ eventId, owner, url, encInfo }: ImageSlide): string =>
  [eventId, owner?.revisionTs ?? '', url, encInfo?.iv ?? ''].join('|');

/**
 * One open image viewer, paging through the conversation's pictures (`ImageSlidesContext`) from
 * the one clicked; outside a conversation, or when that picture is not among its pictures, it
 * shows that one alone. It reads them when it opens and on each step, not on each timeline
 * update, so its counter can lag until the next step. It loads the shown picture's original and
 * lets go of the one before; a failed load or decode offers Retry in place. A step that finds the
 * shown picture gone from the conversation (redacted) closes the viewer.
 */
export function ImageGallery({ slide: origin, requestClose }: ImageGalleryProps) {
  const mx = useMatrixClient();
  const getSlides = useContext(ImageSlidesContext);
  const [currentId, setCurrentId] = useState(origin.eventId);
  const [attempt, setAttempt] = useState(0);
  const [original, setOriginal] = useState<Original>();

  const readSlides = (): readonly ImageSlide[] => {
    const listed = getSlides?.();
    return listed?.some((slide) => slide.eventId === origin.eventId) ? listed : [origin];
  };
  const [slides, setSlides] = useState(readSlides);
  const index = slides.findIndex((slide) => slide.eventId === currentId);
  const current = slides[index];

  const requestCloseRef = useLatestRef(requestClose);
  const gone = !current;
  useEffect(() => {
    if (gone) requestCloseRef.current();
  }, [gone, requestCloseRef]);

  const key = current ? slideKey(current) : '';
  const currentRef = useLatestRef(current);
  useEffect(() => {
    const target = currentRef.current;
    if (!target) return undefined;
    let live = true;
    let objectUrl: string | undefined;
    loadImageOriginal(mx, target).then(
      (url) => {
        if (!live) {
          revokeBlobUrl(url);
          return;
        }
        objectUrl = url;
        setOriginal({ key, src: url });
      },
      () => {
        if (live) setOriginal({ key, failed: true });
      }
    );
    return () => {
      live = false;
      if (objectUrl) revokeBlobUrl(objectUrl);
      // Coming back to this picture loads it again rather than show the revoked URL.
      setOriginal(undefined);
    };
  }, [mx, key, attempt, currentRef]);

  if (!current) return null;
  const shown = original?.key === key ? original : undefined;

  const step = (delta: -1 | 1) => {
    const fresh = readSlides();
    setSlides(fresh);
    const at = fresh.findIndex((slide) => slide.eventId === currentId);
    // A shown picture that is gone closes the viewer (the effect above); at an end nothing moves.
    const next = at < 0 ? undefined : fresh[at + delta];
    if (next) setCurrentId(next.eventId);
  };
  const retry = () => setAttempt((count) => count + 1);
  const failDecode = () => setOriginal({ key, failed: true });

  return (
    <ImageOverlay
      openWhileLoading
      src={shown?.src}
      alt={current.body}
      requestClose={requestClose}
      onRetry={shown?.failed ? retry : undefined}
      onImageError={failDecode}
      position={{ index, count: slides.length }}
      onStep={step}
    />
  );
}
