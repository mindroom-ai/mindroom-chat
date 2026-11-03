import { useCallback, useEffect, useRef } from 'react';

/**
 * A stable function that tells whether the component is still mounted, so async work can drop
 * results that arrive after unmount. True from the first render, so work started during render
 * or in a layout effect counts as alive.
 */
export const useAlive = (): (() => boolean) => {











