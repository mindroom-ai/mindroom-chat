import { createVar, style, StyleRule } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { ContainerColor, color } from 'folds';
import { DARK_THEMES } from '../../preferences/themeNames';

const surfaceContainer = createVar();
const surfaceHover = createVar();
const surfaceActive = createVar();
const surfaceLine = createVar();
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
    [surfaceLine]: color[variant].ContainerLine,
  },
});

// Preserve optional outlines without painting over the directional glass rim.
export const glassOutline = style({
  selectors: { '&&': { boxShadow: `inset 0 0 0 1px ${surfaceLine}` } },
  '@supports': {
    [maskedRimSupport]: { selectors: { '&&': { boxShadow: glassShadow } } },
  },
  '@media': {
    '(prefers-reduced-transparency: reduce), (prefers-contrast: more)': {
      selectors: { '&&&': { boxShadow: `inset 0 0 0 1px ${surfaceLine}` } },
    },
    '(forced-colors: active)': {
      selectors: {
        '&&&': { outline: '1px solid CanvasText', outlineOffset: '-1px' },
        '&&&:focus-visible': { outline: '2px solid Highlight', outlineOffset: '2px' },
      },
    },
  },
});

const material = (
  tint: number,
  blur: number,
  shadow: string,
  elevation: string,
  darkTint = 72
): StyleRule => ({
  vars: {
    [glassShadow]: '0 0 0 transparent',
    [surfaceTint]: `${tint}%`,
    [surfaceBlur]: `${blur}px`,
    [highlight]: 'rgb(255 255 255 / 22%)',
    [rimHighlight]: 'rgb(255 255 255 / 32%)',
    [rimShade]: 'rgb(65 70 90 / 24%)',
    // Let the shaded rim show through so the top stays visible on white backgrounds.
    [rimReflection]: 'rgb(255 255 255 / 50%)',
  },
  selectors: {
    '&&': {
      backgroundColor: surfaceContainer,
      backgroundImage: 'none',
    },
    [`${DARK_THEMES} &&`]: {
      vars: {
        [surfaceTint]: `${darkTint}%`,
        [highlight]: 'rgb(255 255 255 / 4%)',
        [rimHighlight]: 'rgb(255 255 255 / 14%)',
        [rimShade]: 'rgb(255 255 255 / 3%)',
        [rimReflection]: 'rgb(255 255 255 / 32%)',
      },
    },
    'button&&:focus-visible': {
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
          backgroundImage: `linear-gradient(180deg, ${rimReflection}, transparent 45%, transparent 65%, ${rimHighlight})`,
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
    // A touch screen keeps :hover on the button tapped last; only a pointer that can hover tints it.
    '(hover: hover)': {
      selectors: {
        'button&&:hover:not(:active):not([aria-pressed="true"])': {
          vars: { [surfaceContainer]: surfaceHover },
        },
      },
    },
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

// Text over moving content (dialogs, approval review, the chrome content scrolls beneath) is
// tinted nearly opaque, so what passes behind never competes with it, even where no blur is drawn
// (Playwright's WebKit leaves backdrop filters out of its screenshots).
const denseTint = { light: '94%', dark: '90%' };

// Full-width chrome keeps the material without raised edges or highlights. Content scrolls beneath
// it (a room's timeline under its header), so its tint is dense: a lighter one let the messages
// read through beside the title.
export const glassFlat = style({
  selectors: {
    '&&&::before': { display: 'none' },
    '&&&': {
      vars: { [surfaceTint]: denseTint.light },
      border: 0,
      boxShadow: 'none',
      backgroundImage: 'none',
    },
    [`${DARK_THEMES} &&&`]: {
      vars: { [surfaceTint]: denseTint.dark },
    },
  },
});

// Nested chrome (a settings page's title) takes its panel's own color. At rest the panel's tint
// lies behind it and it adds none, so it shows as no band across the panel; once its list scrolls,
// content passes beneath it and it takes the dense tint (useScrolledBeneath marks it).
// Opaque accessibility/no-backdrop fallbacks use the panel's color too.
export const glassInheritTint = style({
  selectors: {
    '&&&&&': { vars: { [surfaceContainer]: 'inherit', [surfaceTint]: '0%' } },
    '&&&&&[data-scrolled-beneath]': { vars: { [surfaceTint]: denseTint.light } },
    [`${DARK_THEMES} &&&&&[data-scrolled-beneath]`]: {
      vars: { [surfaceTint]: denseTint.dark },
    },
  },
});

// The sign-in card over the particle art keeps a light tint, so the art shows through it.
export const glassOverBackdrop = style({
  selectors: {
    '&&&': { vars: { [surfaceTint]: '60%' } },
    '.silver-theme &&&': { vars: { [surfaceTint]: '64%' } },
    [`${DARK_THEMES} &&&`]: {
      vars: { [surfaceTint]: '28%' },
    },
  },
});

// Approval review, large dialogs and floating chrome over the timeline (the thread banner, the
// thread filter bar) hold dense text: keep the rim and blur, but tint them nearly opaque so the
// page behind does not compete with what they say.
export const glassDenseOverBackdrop = style({
  selectors: {
    '&&&': { vars: { [surfaceTint]: denseTint.light } },
    [`${DARK_THEMES} &&&`]: {
      vars: { [surfaceTint]: denseTint.dark },
    },
  },
});

export const glassSurface = recipe({
  base: {
    boxShadow: glassShadow,
    selectors: {
      'button&': { transition: 'scale 180ms cubic-bezier(0.2, 0.8, 0.2, 1)' },
      'button&:active:not(:disabled)': { scale: '0.98' },
    },
    '@media': {
      '(hover: hover)': {
        selectors: { 'button&:hover:not(:disabled):not(:active)': { scale: '1.025' } },
      },
      '(prefers-reduced-motion: reduce)': {
        selectors: { 'button&&': { scale: 'none', transition: 'none' } },
      },
    },
  },
  variants: {
    level: {
      overlay: [
        // Vertical lighting catches the top and bottom while the sides recede. Menus, popovers
        // and dialogs hold text over the page, so their glass is tinted nearly opaque.
        material(
          88,
          12,
          `inset 0 1px 0 ${rimHighlight}, inset 0 -1px 0 rgb(255 255 255 / 6%), 0 16px 48px rgb(0 0 0 / 18%), 0 2px 8px rgb(0 0 0 / 8%)`,
          '0 16px 48px rgb(0 0 0 / 18%), 0 2px 8px rgb(0 0 0 / 8%)',
          88
        ),
        { selectors: { '&&': { boxShadow: glassShadow } } },
      ],
      panel: material(
        60,
        10,
        'inset 0 1px 0 rgb(255 255 255 / 16%), inset 0 -1px 0 rgb(255 255 255 / 6%)',
        '0 0 0 transparent'
      ),
      control: material(
        58,
        8,
        `inset 0 1px 0 ${rimHighlight}, inset 0 -1px 0 rgb(255 255 255 / 6%), 0 2px 8px rgb(0 0 0 / 5%)`,
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

// Keep a scrolling header's blur, and any frame, outside the panel's backdrop-filter tree.
// Nested backdrop filters otherwise repaint the panel tint beneath the header. A frame drawn by
// another process (the browser's PDF viewer, a cross-origin page) makes Chromium run the panel's
// whole content through its backdrop filter, so the frame and the panel's text come out blurred.
// The sibling paint layer preserves refraction without filtering foreground text.
const layeredContent = ':has([data-glass-flat="true"], iframe)';
export const glassScrollPanel = style({
  '@supports': {
    '(backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))': {
      selectors: {
        [`&&&${layeredContent}`]: {
          position: 'relative',
          isolation: 'isolate',
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
        },
        // PageScroll's sticky title (z-index 1) would otherwise paint over the rim,
        // and Chromium's title blur smears the 1px rim into a band along the edge.
        [`&${layeredContent}::before`]: { zIndex: 2 },
        [`&${layeredContent}::after`]: {
          content: '""',
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          pointerEvents: 'none',
          zIndex: -1,
          backdropFilter: `blur(${surfaceBlur}) saturate(160%)`,
          WebkitBackdropFilter: `blur(${surfaceBlur}) saturate(160%)`,
        },
        [`&[data-liquid-glass="active"]${layeredContent}::after`]: {
          backdropFilter: 'var(--liquid-glass-filter) saturate(145%)',
          WebkitBackdropFilter: 'var(--liquid-glass-filter) saturate(145%)',
        },
      },
    },
  },
  '@media': {
    '(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)': {
      selectors: { '&&&::after': { display: 'none' } },
    },
  },
});
