import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { Icon, IconButton, Icons } from 'folds';
import { useInert } from '../lib/hooks/useInert';
import { IconTooltip } from '../ui/IconTooltip';
import { VIEW_FADE_MS, prefersReducedMotion } from './tourMotion';
import type { TourScene } from './tourScenes';
import { TourSpotlight } from './TourSpotlight';
import * as css from './TourStage.css';
import { TourStageActivity, TourStageRoom } from './TourStageRoom';

/**
 * How tall the room is drawn before it is scaled to the frame: on a wider screen the header,
 * four cards and the composer; on a phone four cards alone, or the header, three cards and the
 * composer.
 */
const ROOM_HEIGHT = { wide: 490, phone: 392 };

/** The room is never drawn smaller than this share of its size: below it the text cannot be read. */
const SMALLEST_SCALE = 0.6;

/** How much the room is scaled down to fit its frame's height; 1 where the frame is tall enough. */
const useStageScale = (frameRef: RefObject<HTMLElement>, phone: boolean): number => {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const measure = () => {
      const height = frame.clientHeight;
      const fit = height / (phone ? ROOM_HEIGHT.phone : ROOM_HEIGHT.wide);
      // A frame without a height is not laid out (a test, a hidden page): the room keeps its size.
      const next = height > 0 ? Math.min(1, Math.max(SMALLEST_SCALE, fit)) : 1;
      setScale(Math.round(next * 1000) / 1000);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frameRef, phone]);
  return scale;
};

/**
 * Names what a scene's view is made of. Scenes with the same name change in place (a card moves,
 * a menu opens); a scene with another name fades in over the one before it.
 */
const viewOf = (scene: TourScene): string =>
  [scene.view, scene.header, scene.composer, scene.bell].join(':');

type View = { name: string; scene: TourScene };

/**
 * The view that is fading out under the current one, if any: the last scene of the view before,
 * kept for the length of the fade. None with reduced motion, where the view just changes.
 */
const useLeavingView = (scene: TourScene): View | undefined => {
  const name = viewOf(scene);
  const committed = useRef<View>({ name, scene });
  const [shown, setShown] = useState<{ name: string; leaving?: View }>({ name });
  let { leaving } = shown;
  if (shown.name !== name) {
    leaving = prefersReducedMotion() ? undefined : committed.current;
    setShown({ name, leaving });
  }
  useEffect(() => {
    committed.current = { name, scene };
  });
  useEffect(() => {
    if (!leaving) return undefined;
    const timer = setTimeout(
      () => setShown((now) => (now.leaving === leaving ? { name: now.name } : now)),
      VIEW_FADE_MS
    );
    return () => clearTimeout(timer);
  }, [leaving]);
  return leaving;
};

type TourStageProps = {
  /** What the stage shows now. */
  scene: TourScene;
  /** Draws a phone's room instead of a wider screen's. */
  phone: boolean;
  /** The phase of the step's scene, for tests and screenshots. */
  phase: number;
  /** Whether the scene has reached its last phase. */
  settled: boolean;
  /** Plays the scene again; the Replay button shows while this is given. */
  onReplay?: () => void;
  className?: string;
};

/**
 * The tour's stage: a small sample room that plays the scene of the current step, with a
 * spotlight on the part the step is about. The room is inert and hidden from assistive
 * technology, since the step's text says what it shows; only Replay, in the frame's corner, can
 * be pressed.
 */
export function TourStage({ scene, phone, phase, settled, onReplay, className }: TourStageProps) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<HTMLDivElement>(null);
  useInert(roomRef, true);
  const scale = useStageScale(frameRef, phone);
  // One clock for the whole tour, so a card's age does not change from scene to scene.
  const [now] = useState(() => Date.now());
  const name = viewOf(scene);
  const leaving = useLeavingView(scene);
  const replayLabel = t('tour.dialog.replay');

  return (
    <div
      ref={frameRef}
      className={classNames(css.Frame, className)}
      style={{ [css.STAGE_SCALE]: scale } as CSSProperties}
    >
      <div
        ref={roomRef}
        className={css.Room}
        data-tour-stage=""
        data-tour-phase={phase}
        data-tour-settled={settled ? '' : undefined}
      >
        {/* Keyed by its view, so the view that leaves keeps its elements while it fades. */}
        {leaving && leaving.name !== name && (
          <div key={leaving.name} className={classNames(css.View, css.ViewEntering)}>
            <TourStageRoom scene={leaving.scene} phone={phone} live={false} now={now} />
          </div>
        )}
        <div key={name} className={classNames(css.View, css.ViewEntering)} data-tour-view={name}>
          <TourStageRoom scene={scene} phone={phone} live now={now} />
        </div>
        <TourSpotlight part={scene.spotlight} />
        {scene.activity && <TourStageActivity phone={phone} now={now} />}
      </div>
      {onReplay && (
        <IconTooltip label={replayLabel} position="Top">
          {(triggerRef) => (
            <IconButton
              ref={triggerRef}
              className={css.Replay}
              size="300"
              radii="Pill"
              variant="Secondary"
              fill="Soft"
              outlined
              aria-label={replayLabel}
              data-tour-action="replay"
              onClick={onReplay}
            >
              <Icon size="100" src={Icons.Reload} />
            </IconButton>
          )}
        </IconTooltip>
      )}
    </div>
  );
}
