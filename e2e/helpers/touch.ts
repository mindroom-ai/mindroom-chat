import type { Locator } from '@playwright/test';

// One finger, driven by touch events the test sends itself: Playwright has no long press or touch
// drag. Real TouchEvents where the engine can build them; elsewhere (Playwright's WebKit) events
// that carry the same fields, and the point itself, where a drag library looks when the event is
// no TouchEvent.

export type Step =
  | { type: 'start' | 'end' }
  | { type: 'move'; dx: number; dy: number }
  | { type: 'wait'; ms: number }
  | { type: 'scroll'; by: number };

/**
 * One finger on the middle of `target`, or 8 px into its start (`spot: 'start'`, on the element
 * there), driven through `steps`; `scroll` scrolls the nearest scrolling ancestor, as the browser
 * would under a moving finger. Answers whether the lift's default was prevented and whether the
 * engine built real TouchEvents.
 */
export const touch = async (
  target: Locator,
  steps: Step[],
  spot: 'middle' | 'start' = 'middle'
) => {
  const box = await target.boundingBox();
  if (!box) throw new Error('nothing to touch');
  return target.evaluate(
    async (element, { x, y, plan, start }) => {
      let real = true;
      const hit = (start && document.elementFromPoint(x, y)) || element;
      const fire = (type: string, dx: number, dy: number, lifted: boolean) => {
        const point = { clientX: x + dx, clientY: y + dy };
        let event: Event;
        try {
          const finger = new Touch({
            identifier: 1,
            target: hit,
            ...point,
            pageX: point.clientX + window.scrollX,
            pageY: point.clientY + window.scrollY,
            screenX: point.clientX,
            screenY: point.clientY,
          });
          event = new TouchEvent(type, {
            touches: lifted ? [] : [finger],
            targetTouches: lifted ? [] : [finger],
            changedTouches: [finger],
            bubbles: true,
            cancelable: true,
            composed: true,
          });
        } catch {
          // An engine that cannot build a Touch gets an event that carries the same fields, and
          // the point itself, where a drag library looks when the event is no TouchEvent.
          real = false;
          event = new Event(type, { bubbles: true, cancelable: true, composed: true });
          const finger = { identifier: 1, target: hit, ...point };
          const list = lifted ? [] : [finger];
          Object.defineProperties(event, {
            touches: { value: list },
            targetTouches: { value: list },
            changedTouches: { value: [finger] },
            clientX: { value: point.clientX },
            clientY: { value: point.clientY },
          });
        }
        return hit.dispatchEvent(event);
      };
      let liftAllowed = true;
      let at = { dx: 0, dy: 0 };
      for (const step of plan) {
        if (step.type === 'wait') {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => {
            setTimeout(resolve, step.ms);
          });
        } else if (step.type === 'scroll') {
          let scroller: Element | null = element;
          while (scroller && scroller.scrollHeight <= scroller.clientHeight + 1) {
            scroller = scroller.parentElement;
          }
          scroller?.scrollBy(0, step.by);
        } else if (step.type === 'move') {
          at = { dx: step.dx, dy: step.dy };
          fire('touchmove', at.dx, at.dy, false);
          // One move per frame, as a finger reports them.
          // eslint-disable-next-line no-await-in-loop
          await new Promise(requestAnimationFrame);
        } else if (step.type === 'start') {
          fire('touchstart', 0, 0, false);
        } else {
          liftAllowed = fire('touchend', at.dx, at.dy, true);
        }
      }
      return { liftAllowed, real };
    },
    {
      x: spot === 'start' ? box.x + 8 : box.x + box.width / 2,
      y: box.y + box.height / 2,
      plan: steps,
      start: spot === 'start',
    }
  );
};
