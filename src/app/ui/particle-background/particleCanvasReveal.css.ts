import { globalStyle } from '@vanilla-extract/css';
import { ParticleCanvas } from './ParticleBackground.css';

// The particle canvas has an opaque WebGL context, which is black until the renderer first clears
// it with the theme's colour. The renderer sizes the canvas (setting its width attribute) in the
// same step as that first clear, after the logo image loaded, so until then the canvas stays
// hidden and the theme's gradient behind it shows instead of a black screen.
globalStyle(`${ParticleCanvas}:not([width])`, { visibility: 'hidden' });
