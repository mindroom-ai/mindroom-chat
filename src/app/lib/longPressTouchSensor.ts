import { type PointerSensorProps, TouchSensor } from '@dnd-kit/core';
import { LONG_PRESS_MS, LONG_PRESS_SLOP } from './hooks/useLongPress';

/**
 * A touch sensor whose drag starts only when the finger moves on after a long press (`useLongPress`
 * timing): a finger that moves sooner scrolls, and one that stays put is left to the long press,
 * which opens a menu. The drag library starts at the end of the long press, as its delay says; this
 * sensor holds that start back until the finger has moved more than the long press's slop, and from
 * then on passes every move. Its activation constraint is its own; `useSensor` options set none.
 */
export class LongPressTouchSensor extends TouchSensor {
  constructor(props: PointerSensorProps) {
    let held: { x: number; y: number } | undefined;
    let dragging = false;
    super({
      ...props,
      options: {
        ...props.options,
        activationConstraint: { delay: LONG_PRESS_MS, tolerance: LONG_PRESS_SLOP },
      },
      onStart: (at) => {
        held = at;
      },
      onMove: (to) => {
        if (!dragging && held && Math.hypot(to.x - held.x, to.y - held.y) > LONG_PRESS_SLOP) {
          dragging = true;
          props.onStart(held);
        }
        if (dragging) props.onMove(to);
      },
    });
  }
}
