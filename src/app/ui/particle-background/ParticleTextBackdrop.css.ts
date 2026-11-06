import { style } from '@vanilla-extract/css';
import { particleBackgroundColorVar } from './particleBackgroundTheme.css';

const clearing = `color-mix(in srgb, ${particleBackgroundColorVar} 90%, transparent)`;

/**
 * A soft clearing in the particle art behind a short line of small text: the art's own base color,
 * nearly opaque, with blurred edges, so the line keeps 4.5:1 wherever the particles fall. Plain
 * lengths (2 px by 8 px, a pill) keep it free of the theme module, which tests replace.
 */
export const ParticleTextBackdrop = style({
  paddingBlock: '0.125rem',
  paddingInline: '0.5rem',
  borderRadius: '999px',
  backgroundColor: clearing,
  boxShadow: `0 0 0.5rem 0.25rem ${clearing}`,
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
});

/**
 * Quieter text on such a clearing, such as the splash's app name: the tone comes from the color,
 * so the clearing under it stays as opaque as the others.
 */
export const ParticleTextQuiet = style({
  color: 'color-mix(in srgb, currentColor 90%, transparent)',
});
