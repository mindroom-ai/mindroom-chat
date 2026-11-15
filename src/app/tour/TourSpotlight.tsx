import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TourPart } from './tourScenes';
import * as css from './TourStage.css';

/** How many px the ring stands off the part it marks. */
export const SPOTLIGHT_GAP = 4;

type Box = { x: number; y: number; width: number; height: number };

/**
 * Where an element lies inside the stage, by its layout offsets. They say where the element
 * rests, so a card that is still gliding to its place is ringed where it will be. An offset
 * counts from inside the border of the box it is measured in, so the border of each box on the
 * way to the stage is added. Nothing for an element that is not laid out inside the stage.
 */
const boxWithin = (element: HTMLElement, stage: HTMLElement): Box | undefined => {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = element;
  while (node && node !== stage) {
    x += node.offsetLeft;
    y += node.offsetTop;
    const parent: Element | null = node.offsetParent;
    node = parent instanceof HTMLElement ? parent : null;
    // The ring's own place counts from inside the stage's border, as the last offset does.
    if (node && node !== stage) {
      x += node.clientLeft;
      y += node.clientTop;
    }
  }
  const { offsetWidth: width, offsetHeight: height } = element;
  if (node !== stage || !width || !height) return undefined;
  return { x, y, width, height };
};

const sameBox = (a: Box | undefined, b: Box | undefined): boolean =>
  a === b ||
  (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);

type TourSpotlightProps = {
  /** The part to ring: the element with this `data-tour-part` in the stage. */
  part: TourPart | undefined;
};

/**
 * The ring around the part a step is about, for the stage it is rendered in: its parent element,
 * which must be positioned. The ring stands a little outside the part, dims the rest of the
 * stage and glides when the part changes. It measures after every render of the stage and when
 * the stage is resized. Without a part, or with one that is not in the stage, there is no ring.
 */
export function TourSpotlight({ part }: TourSpotlightProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box>();

  const measure = () => {
    const stage = layerRef.current?.parentElement;
    const element =
      part && stage ? stage.querySelector<HTMLElement>(`[data-tour-part="${part}"]`) : null;
    const next = element && stage ? boxWithin(element, stage) : undefined;
    setBox((shown) => (sameBox(shown, next) ? shown : next));
  };

  // Every render of the stage may have moved the part.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(measure);

  useEffect(() => {
    const stage = layerRef.current?.parentElement;
    if (!stage || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
    // `measure` reads the stage and the part anew each time it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [part]);

  return (
    // Left to right whatever the language, so the ring's place counts from the stage's left edge
    // as the layout offsets do.
    <div ref={layerRef} className={css.SpotlightLayer}>
      {box && (
        <div
          className={css.Spotlight}
          data-tour-spotlight={part}
          style={{
            transform: `translate(${box.x - SPOTLIGHT_GAP}px, ${box.y - SPOTLIGHT_GAP}px)`,
            width: box.width + 2 * SPOTLIGHT_GAP,
            height: box.height + 2 * SPOTLIGHT_GAP,
          }}
        />
      )}
    </div>
  );
}
