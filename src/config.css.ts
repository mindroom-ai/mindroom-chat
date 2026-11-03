import { style } from '@vanilla-extract/css';
import { config } from 'folds';

// Rounder corners than folds' defaults, as MindRoom's surfaces use; applied on the root element.
export const roundedRadii = style({
  vars: {
    [config.radii.R300]: '0.375rem',
    [config.radii.R400]: '0.625rem',
    [config.radii.R500]: '1rem',
  },
});
