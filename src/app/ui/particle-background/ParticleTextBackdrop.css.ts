import { style } from '@vanilla-extract/css';
import { config, toRem } from 'folds';
import { particleBackgroundColorVar } from './particleBackgroundTheme.css';

const clearing = `color-mix(in srgb, ${particleBackgroundColorVar} 90%, transparent)`;

/**
 * A soft clearing in the particle art behind a short line of small text: the art's own base color,
 * nearly opaque, with blurred edges, so the line keeps 4.5:1 wherever the particles fall.
 */
export const ParticleTextBackdrop = style({
  paddingBlock: toRem(2),
  paddingInline: config.space.S200,
  borderRadius: config.radii.Pill,
  backgroundColor: clearing,
  boxShadow: `0 0 ${toRem(8)} ${toRem(4)} ${clearing}`,
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
});
