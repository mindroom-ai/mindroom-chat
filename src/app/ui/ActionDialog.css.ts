import { globalStyle, style } from '@vanilla-extract/css';

/** The dialog's content: it scrolls when the window is too low for it. */
export const Body = style({ minHeight: 0, overflowY: 'auto' });

// A part of the content keeps its height rather than being squeezed; one that scrolls on its own
// asks to shrink (`flexShrink: 1`), and then gives way before the whole content scrolls.
globalStyle(`${Body} > *`, { flexShrink: 0 });
