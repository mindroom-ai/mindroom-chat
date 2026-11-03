// Ambient types for the noVNC internals that the computer panel and its tests import by path.
// The package itself only declares RFB (see novnc.d.ts).

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

declare module '*/@novnc/novnc/core/input/keysymdef.js' {
  const keysyms: { lookup(codePoint: number): number };
  export default keysyms;
}
