import { useEffect, useId, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Box, Button, Icon, Icons, Spinner, Text, as } from 'folds';
import { Header, IconButton } from '../../ui/glass/GlassPrimitives';
import { useZoom } from '../../lib/hooks/useZoom';
import { usePan } from '../../lib/hooks/usePan';
import { downloadMedia } from '../../matrix/matrix';
import { saveFile } from '../../native/nativeFileSave';
import { DOWNLOAD_MIME_TYPE } from '../content/attachmentDownload';
import { documentIsRightToLeft, revealDirectionControls } from '../../ui/directional';
import { isMacOS } from '../../lib/user-agent';
import { KeySymbol } from '../../lib/key-symbol';
import { EDGE_START_MAX_X, useEdgeSwipe } from '../../navigation/useEdgeSwipe';
import * as css from './ImageViewer.css';

const ZOOM_STEP = 0.2;
// The zoom percentage switches between fitting the image and this closer look.
const CLOSE_LOOK_ZOOM = 2;
// How far one finger must move sideways, more than up or down, to page to the next picture.
const SWIPE_MIN_PX = 72;

type DownloadState = 'idle' | 'saving' | 'failed';

/**
 * Downloads `src` once and saves it as `fileName`. A failed save keeps the downloaded blob, so
 * Retry only saves again. The state belongs to the picture it was for: another picture starts
 * at a plain Download.
 */
const useSaveMedia = (src: string, fileName: string) => {
  const [saved, setSaved] = useState<{ src: string; state: DownloadState }>();
  const blobRef = useRef<{ src: string; blob: Blob }>();
  const state = saved?.src === src ? saved.state : 'idle';

  const save = async () => {
    if (state === 'saving') return;
    // A save that ends after another picture's started leaves that one's state alone.
    const finish = (next: DownloadState) =>
      setSaved((prev) => (prev?.src === src ? { src, state: next } : prev));
    setSaved({ src, state: 'saving' });
    try {
      if (blobRef.current?.src !== src) {
        blobRef.current = { src, blob: await downloadMedia(src) };
      }
      await saveFile(new Blob([blobRef.current.blob], { type: DOWNLOAD_MIME_TYPE }), fileName);
      finish('idle');
    } catch {
      finish('failed');
    }
  };

  return [state, save] as const;
};

type StepDelta = -1 | 1;

type ImageViewerProps = {
  alt: string;
  /** The picture; until it is there the image area shows a spinner. */
  src?: string;
  requestClose: () => void;
  /** Set when the picture failed to load: the image area offers Retry in its place. */
  onRetry?: () => void;
  /** The picture downloaded but does not decode. */
  onImageError?: () => void;
  /** Where the picture sits among the conversation's; with more than one the viewer pages. */
  position?: { index: number; count: number };
  /**
   * A key or a swipe asks for every step, past the ends `position` knows of too, since a picture
   * may have arrived since: the owner stops at the real ends. The arrows stop at the known ones.
   */
  onStep?: (delta: StepDelta) => void;
  /** On phones, the viewer's screen: a swipe from its left edge closes the viewer at fit. */
  edgeSwipeArea?: RefObject<Element>;
};

// Keys typed into a field, or into another dialog over the viewer (Settings), are not for it.
const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

const keyIsElsewhere = (target: EventTarget | null, viewer: Element | null): boolean => {
  if (!(target instanceof Element)) return false;
  if (target.closest(EDITABLE)) return true;
  const dialog = target.closest('[role="dialog"]');
  return !!dialog && !dialog.contains(viewer);
};

/**
 * The step of the right arrow key (`rightward`) or the left one, which follow the reading
 * direction. A swipe to the left steps as the right arrow does.
 */
const arrowStep = (rightward: boolean): StepDelta =>
  rightward !== documentIsRightToLeft() ? 1 : -1;

/**
 * A one-finger sideways swipe across the image area, `onSwipe(leftward)`. A second finger (a
 * pinch) cancels it until every finger is up. While `edgeCloses`, a touch from the left edge is
 * the edge close's, not a step back.
 */
const useSwipe = (enabled: boolean, edgeCloses: boolean, onSwipe: (leftward: boolean) => void) => {
  const pointersRef = useRef(new Set<number>());
  const startRef = useRef<{ pointerId: number; x: number; y: number }>();

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const pointers = pointersRef.current;
    pointers.add(event.pointerId);
    const fromEdge =
      edgeCloses && event.pointerType !== 'mouse' && event.clientX <= EDGE_START_MAX_X;
    startRef.current =
      pointers.size === 1 && !fromEdge
        ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
        : undefined;
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    if (!pointersRef.current.delete(event.pointerId)) return;
    const start = startRef.current;
    startRef.current = undefined;
    if (!enabled || start?.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(event.clientY - start.y)) {
      onSwipe(dx < 0);
    }
  };
  const onPointerCancel = (event: PointerEvent<HTMLElement>) => {
    if (pointersRef.current.delete(event.pointerId)) startRef.current = undefined;
  };
  return { onPointerDown, onPointerUp, onPointerCancel };
};

const DOWNLOAD_LABEL_KEY = {
  idle: 'sharedUi.imageViewer.download',
  saving: 'sharedUi.imageViewer.saving',
  failed: 'sharedUi.imageViewer.retryDownload',
} as const satisfies Record<DownloadState, string>;

/** Highlights a zoom control while the image is zoomed in its direction. */
const zoomTone = (active: boolean): 'Success' | 'Surface' => (active ? 'Success' : 'Surface');

/**
 * Shows an image full size with zoom, pan, and a download that can be retried. Given a
 * `position` among several pictures, its arrows, the arrow keys and a swipe at fit step to the
 * previous or next one; the ends stop. Given an `edgeSwipeArea`, a swipe from its left edge at fit
 * closes it.
 */
export const ImageViewer = as<'div', ImageViewerProps>(
  (
    {
      requestClose,
      alt,
      src,
      onRetry,
      onImageError,
      position,
      onStep,
      edgeSwipeArea,
      className,
      ...props
    },
    ref
  ) => {
    const { t } = useTranslation();
    const [downloadState, download] = useSaveMedia(src ?? '', alt);
    // The name shows its direction controls; the download keeps it as it is.
    const shownAlt = revealDirectionControls(alt);
    const imageRef = useRef<HTMLImageElement>(null);
    const hintId = useId();
    // A wheel or pinch zoom keeps the picture under the cursor or fingers still. Only events
    // call it, so `panning` is set by then.
    const { zoom, zoomIn, zoomOut, setZoom, zoomTargetRef, isZooming, aimed } = useZoom(
      ZOOM_STEP,
      undefined,
      undefined,
      (step) => {
        const image = imageRef.current;
        panning.zoomAround(
          step,
          image ? { width: image.offsetWidth, height: image.offsetHeight } : undefined
        );
      }
    );
    const panning = usePan(zoom !== 1);
    const { pan, cursor, isPanning } = panning;
    const saving = downloadState === 'saving';

    // Another picture starts at fit; usePan recenters with it.
    useEffect(() => setZoom(1), [src, setZoom]);

    const paging = !!position && position.count > 1;
    const canStep = (delta: StepDelta) =>
      !!position && position.index + delta >= 0 && position.index + delta < position.count;
    const stepRef = useRef(onStep);
    stepRef.current = onStep;
    const stageRef = useRef<HTMLDivElement>(null);

    // On the window, before anything under the viewer sees them: focus may still sit on the
    // timeline's picture, and the arrows must not scroll it.
    useEffect(() => {
      if (!paging) return undefined;
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        if (keyIsElsewhere(event.target, stageRef.current)) return;
        event.preventDefault();
        event.stopPropagation();
        stepRef.current?.(arrowStep(event.key === 'ArrowRight'));
      };
      window.addEventListener('keydown', handleKeyDown, true);
      return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [paging]);

    const atFit = zoom === 1 && !isZooming;
    // Zoomed in, a drag from the edge pans.
    const edgeCloses = !!edgeSwipeArea && atFit;
    useEdgeSwipe({
      direction: 'back',
      enabled: edgeCloses,
      onSwipe: requestClose,
      within: edgeSwipeArea,
    });
    const swipe = useSwipe(paging && atFit, edgeCloses, (leftward) =>
      stepRef.current?.(arrowStep(leftward))
    );

    let downloadIcon = <Icon size="50" src={Icons.Download} />;
    if (saving) downloadIcon = <Spinner size="50" variant="Primary" fill="Solid" />;
    else if (downloadState === 'failed') downloadIcon = <Icon size="50" src={Icons.Warning} />;

    const imageTransform = `translate(${pan.translateX}px, ${pan.translateY}px) scale(${zoom})`;

    // `data-image-viewer` marks the open viewer for the e2e media spec; the Modal that holds the
    // viewer marks it as a pinch surface (content/ImageOverlay.tsx).
    return (
      <Box
        data-image-viewer="true"
        direction="Column"
        className={classNames(css.ImageViewer, className)}
        {...props}
        ref={ref}
      >
        <Header size="400" className={css.ImageViewerHeader}>
          <IconButton
            aria-label={t('sharedUi.imageViewer.close')}
            onClick={requestClose}
            radii="300"
            size="300"
          >
            <Icon src={Icons.ArrowLeft} size="50" data-directional />
          </IconButton>
          <Box grow="Yes" alignItems="Center" gap="200" style={{ minWidth: 0 }}>
            <Text truncate size="T300">
              {shownAlt}
            </Text>
            {paging && (
              <Text size="T300" priority="300" aria-live="polite" style={{ flexShrink: 0 }}>
                {`${position.index + 1} / ${position.count}`}
              </Text>
            )}
          </Box>
          <Box alignItems="Center" shrink="No" gap="200">
            <IconButton
              aria-label={t('sharedUi.imageViewer.zoomOut')}
              aria-describedby={hintId}
              onClick={zoomOut}
              variant={zoomTone(zoom < 1)}
              radii="Pill"
              size="300"
            >
              <Icon src={Icons.Minus} size="50" />
            </IconButton>
            <Button
              type="button"
              onClick={() => setZoom(zoom === 1 ? CLOSE_LOOK_ZOOM : 1)}
              variant={zoom === 1 ? 'Secondary' : 'Success'}
              fill="Soft"
              radii="Pill"
              size="300"
            >
              <Text as="span" size="B300">{`${Math.round(zoom * 100)}%`}</Text>
            </Button>
            <IconButton
              aria-label={t('sharedUi.imageViewer.zoomIn')}
              aria-describedby={hintId}
              onClick={zoomIn}
              variant={zoomTone(zoom > 1)}
              radii="Pill"
              size="300"
            >
              <Icon src={Icons.Plus} size="50" />
            </IconButton>
            <Button
              type="button"
              before={downloadIcon}
              disabled={saving || !src}
              onClick={() => void download()}
              variant={downloadState === 'failed' ? 'Critical' : 'Primary'}
              fill="Solid"
              radii="300"
              size="300"
            >
              <Text as="span" size="B300">
                {t(DOWNLOAD_LABEL_KEY[downloadState])}
              </Text>
            </Button>
          </Box>
        </Header>
        <Box ref={stageRef} className={css.ImageViewerStage}>
          {onRetry ? (
            // Outside the gesture area, whose pointer capture would take Retry's click.
            <Box className={css.ImageViewerContent} direction="Column" gap="300">
              <Text size="T300">{t('sharedUi.imageContent.failedToLoadImage')}</Text>
              <Button
                type="button"
                variant="Critical"
                fill="Soft"
                radii="300"
                size="300"
                onClick={onRetry}
                before={<Icon size="50" src={Icons.Warning} />}
              >
                <Text as="span" size="B300">
                  {t('sharedUi.imageContent.retry')}
                </Text>
              </Button>
            </Box>
          ) : (
            <Box
              ref={zoomTargetRef}
              className={css.ImageViewerContent}
              style={{ cursor }}
              onPointerDown={(event: PointerEvent<HTMLElement>) => {
                panning.onPointerDown(event);
                swipe.onPointerDown(event);
              }}
              onPointerMove={panning.onPointerMove}
              onPointerUp={(event: PointerEvent<HTMLElement>) => {
                panning.onPointerUp(event);
                swipe.onPointerUp(event);
              }}
              onPointerCancel={(event: PointerEvent<HTMLElement>) => {
                panning.onPointerCancel(event);
                swipe.onPointerCancel(event);
              }}
              onLostPointerCapture={panning.onLostPointerCapture}
            >
              {src ? (
                <img
                  ref={imageRef}
                  className={css.ImageViewerImg}
                  data-gesture={isZooming || isPanning || aimed}
                  style={{ transform: imageTransform }}
                  src={src}
                  alt={shownAlt}
                  draggable={false}
                  onError={onImageError}
                />
              ) : (
                <Spinner variant="Secondary" size="400" />
              )}
            </Box>
          )}
          {src && !onRetry && (
            // Only with a mouse or trackpad (the CSS), and it fades after a few seconds. The zoom
            // buttons keep it as their description.
            <Text
              id={hintId}
              as="p"
              size="T200"
              aria-hidden
              className={css.ImageViewerZoomHint}
              data-zoomed={zoom !== 1}
            >
              {t('sharedUi.imageViewer.wheelZoomHint', {
                key: isMacOS() ? KeySymbol.Command : 'Ctrl',
              })}
            </Text>
          )}
          {paging &&
            ([-1, 1] as const).map((delta) => (
              // Siblings of the gesture area, for the same reason as Retry. At an end the arrow
              // stays, focusable, so focus does not fall out of the viewer.
              <IconButton
                key={delta}
                className={css.ImageViewerStep}
                data-edge={delta < 0 ? 'start' : 'end'}
                aria-label={t(
                  delta < 0 ? 'sharedUi.imageViewer.previous' : 'sharedUi.imageViewer.next'
                )}
                aria-disabled={!canStep(delta)}
                onClick={() => {
                  if (canStep(delta)) onStep?.(delta);
                }}
                variant="Surface"
                radii="Pill"
                size="300"
              >
                <Icon
                  src={delta < 0 ? Icons.ChevronLeft : Icons.ChevronRight}
                  size="50"
                  data-directional
                />
              </IconButton>
            ))}
        </Box>
      </Box>
    );
  }
);
