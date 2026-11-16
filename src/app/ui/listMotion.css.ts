import { globalStyle } from '@vanilla-extract/css';

// A row is a stacking context at rest too. A row that becomes one only while it plays (a move, a
// fade and a raise each make it one) has the browser lay out the whole list when the play starts
// and again when it ends: 20 to 25 ms each time in a list of 600 cards.
globalStyle('[data-motion-row]', { isolation: 'isolate' });
