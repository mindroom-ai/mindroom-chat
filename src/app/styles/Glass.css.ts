import { createVar, style, StyleRule } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { ContainerColor, color } from 'folds';

const surfaceContainer = createVar();
const surfaceHover = createVar();
const surfaceActive = createVar();
const surfaceTint = createVar();
const surfaceBlur = createVar();
const highlight = createVar();
const rimHighlight = createVar();
const rimShade = createVar();
const rimReflection = createVar();
export const glassShadow = createVar();

const maskedRimSupport =
  '((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) and ((mask-composite: exclude) or (-webkit-mask-composite: xor))';

const variantStyle = (variant: ContainerColor): StyleRule => ({
  vars: {
    [surfaceContainer]: color[variant].Container,
    [surfaceHover]: color[variant].ContainerHover,
    [surfaceActive]: color[variant].ContainerActive,
  },
});

const material = (tint: number, blur: number, shadow: string, elevation: string): StyleRule => ({
  vars: {
    [glassShadow]: '0 0 0 transparent',
    [surfaceTint]: `${tint}%`,
    [surfaceBlur]: `${blur}px`,
    [highlight]: 'rgb(255 255 255 / 22%)',
    [rimHighlight]: 'rgb(255 255 255 / 32%)',
    [rimShade]: 'rgb(65 70 90 / 24%)',
    [rimReflection]: 'rgb(255 255 255 / 90%)',
  },
  selectors: {
    '&&': {
      backgroundColor: surfaceContainer,
      backgroundImage: 'none',
    },
    ':is(.dark-theme, .midnight-theme, .butter-theme) &&': {
      vars: {
        [surfaceTint]: '72%',
        [highlight]: 'rgb(255 255 255 / 4%)',
        [rimHighlight]: 'rgb(255 255 255 / 14%)',
        [rimShade]: 'rgb(255 255 255 / 3%)',
        [rimReflection]: 'rgb(255 255 255 / 32%)',
      },
    },
    'button&&:hover, button&&:focus-visible': {
      vars: { [surfaceContainer]: surfaceHover },
    },
    'button&&:active, button&&[aria-pressed="true"]': {
      vars: { [surfaceContainer]: surfaceActive },
    },
  },
  '@supports': {
    [maskedRimSupport]: {
      // Backdrop-filter establishes the containing block, even on static
      // surfaces. Leave positioning and stacking decisions with the caller.
      // Reserve ::before for the rim; sidebar drag indicators use ::after.
      selectors: {
        '&&': { vars: { [glassShadow]: elevation } },
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          padding: 1,
          pointerEvents: 'none',
          backgroundColor: rimShade,
          backgroundImage: `linear-gradient(135deg, ${rimReflection}, transparent 45%, transparent 65%, ${rimHighlight})`,
          WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
        },
      },
    },
    '(backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))': {
      vars: { [glassShadow]: shadow },
      selectors: {
        '&&': {
          backgroundColor: `color-mix(in srgb, ${surfaceContainer} ${surfaceTint}, transparent)`,
          backgroundImage: `radial-gradient(circle 90px at var(--liquid-glass-light-x, 0%) var(--liquid-glass-light-y, 0%), ${highlight}, transparent)`,
          backdropFilter: `blur(${surfaceBlur}) saturate(160%)`,
          WebkitBackdropFilter: `blur(${surfaceBlur}) saturate(160%)`,
        },
        '&&[data-liquid-glass="active"]': {
          backdropFilter: 'var(--liquid-glass-filter) saturate(145%)',
          WebkitBackdropFilter: 'var(--liquid-glass-filter) saturate(145%)',
        },
      },
    },
  },
  '@media': {
    '(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)': {
      selectors: {
        '&&::before': { display: 'none' },
        '&&&': {
          vars: { [glassShadow]: '0 0 0 transparent' },
          backgroundColor: surfaceContainer,
          backgroundImage: 'none',
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
        },
      },
    },
  },
});

// Keep floating chrome as lightly blurred as the Chromium optical filter.
export const glassFloating = style({
  selectors: {
    '&&&': {
      vars: { [surfaceBlur]: '3px' },
    },
  },
});

// Full-width room chrome keeps the material without raised edges or highlights.
export const glassFlat = style({
  selectors: {
    '&&&::before': { display: 'none' },
    '&&&': {
      border: 0,
      boxShadow: 'none',
      backgroundImage: 'none',
    },
  },
});

// Modal500 already dims the page through OverlayBackdrop. Its glass needs less
// tint than a floating menu over an undimmed page, especially in dark themes.
export const glassOverBackdrop = style({
  selectors: {
    '.silver-theme &&&': { vars: { [surfaceTint]: '64%' } },
    ':is(.dark-theme, .midnight-theme, .butter-theme) &&&': {
      vars: { [surfaceTint]: '28%' },
    },
  },
});

export const glassSurface = recipe({
  base: {
    boxShadow: glassShadow,
    selectors: {
      'button&': { transition: 'scale 180ms cubic-bezier(0.2, 0.8, 0.2, 1)' },
      'button&:hover:not(:disabled)': { scale: '1.025' },
      'button&:active:not(:disabled)': { scale: '0.98' },
    },
    '@media': {
      '(prefers-reduced-motion: reduce)': {
        selectors: { 'button&&': { scale: 'none', transition: 'none' } },
      },
    },
  },
  variants: {
    level: {
      overlay: [
        // Equal horizontal/vertical offsets light the rim from the upper left at 45°.
        material(
          60,
          12,
          `inset 1px 1px 0 ${rimHighlight}, inset -1px -1px 0 rgb(255 255 255 / 6%), 0 16px 48px rgb(0 0 0 / 18%), 0 2px 8px rgb(0 0 0 / 8%)`,
          '0 16px 48px rgb(0 0 0 / 18%), 0 2px 8px rgb(0 0 0 / 8%)'
        ),
        { selectors: { '&&': { boxShadow: glassShadow } } },
      ],
      panel: material(60, 10, 'inset 1px 1px 0 rgb(255 255 255 / 16%)', '0 0 0 transparent'),
      control: material(
        58,
        8,
        `inset 1px 1px 0 ${rimHighlight}, 0 2px 8px rgb(0 0 0 / 5%)`,
        '0 2px 8px rgb(0 0 0 / 5%)'
      ),
    },
    variant: {
      Background: variantStyle('Background'),
      Surface: variantStyle('Surface'),
      SurfaceVariant: variantStyle('SurfaceVariant'),
      Primary: variantStyle('Primary'),
      Secondary: variantStyle('Secondary'),
      Success: variantStyle('Success'),
      Warning: variantStyle('Warning'),
      Critical: variantStyle('Critical'),
    },
  },
  defaultVariants: { level: 'panel', variant: 'Surface' },
});
