import type { NavigateOptions, To } from 'react-router';

/**
 * `navigate` as the app calls it: for a step, never awaited. React Router 7 types its result
 * `void | Promise<void>` (the data router's promise settles when the navigation has finished),
 * which made every call a floating promise; its docs suggest this augmentation.
 */
declare module 'react-router' {
  interface NavigateFunction {
    (to: To, options?: NavigateOptions): void;
    (delta: number): void;
  }
}
