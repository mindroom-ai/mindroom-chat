// Ambient types for the noVNC internals that the computer panel and its tests import by path.
// The package itself only declares RFB (see novnc.d.ts). The keysym table stays undeclared:
// computerSoftKeyboard.ts imports it with @ts-expect-error and types it there.

declare module '*/@novnc/novnc/core/util/events.js' {
  export function getPointerEvent(event: Event): Event;
  export function stopEvent(event: Event): void;
  export function setCapture(target: Element): void;
  export function releaseCapture(): void;
}

declare module '*/@novnc/novnc/core/input/keyboard.js' {
  export default class Keyboard {
    constructor(target: Element);

    onkeyevent: (keysym: number, code: string, down: boolean) => void;

    grab(): void;

    ungrab(): void;
  }
}
