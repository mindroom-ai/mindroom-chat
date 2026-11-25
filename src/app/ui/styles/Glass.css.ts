import { createVar, style, StyleRule } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { ContainerColor, color } from 'folds';
import { DARK_THEMES } from '../../preferences/themeNames';

// The surface's own opaque color, for an opaque surface (a phone's full-screen dialog).
export const surfaceContainer = createVar();
const surfaceHover = createVar();
const surfaceActive = createVar();
const surfaceLine = createVar();
const surfaceTint = createVar();
const surfaceBlur = createVar();
const rimTop = createVar();
const rimSide = createVar();
const rimBottom = createVar();
const rimCornerTop = createVar();
const rimCornerBottom = createVar();
const rimGlint = createVar();
const outerHairline = createVar();
export const glassShadow = createVar();

const backdropSupport = '(backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))';
const maskedRimSupport = `(${backdropSupport}) and ((mask-composite: exclude) or (-webkit-mask-composite: xor))`;
const opaqueGlassMedia =
  '(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)';
const backdropTint = `color-mix(in srgb, ${surfaceContainer} ${surfaceTint}, transparent)`;
const backdropBlur = {
  backdropFilter: `blur(${surfaceBlur}) saturate(175%)`,
  WebkitBackdropFilter: `blur(${surfaceBlur}) saturate(175%)`,
};

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
    [rimTop]: 'rgb(255 255 255 / 78%)',
    [rimSide]: 'rgb(55 62 82 / 12%)',
    [rimBottom]: 'rgb(255 255 255 / 44%)',
    [rimCornerTop]: 'rgb(255 255 255 / 96%)',
    [rimCornerBottom]: 'rgb(255 255 255 / 54%)',
    [rimGlint]: 'rgb(255 255 255 / 95%)',
    [outerHairline]: 'rgb(15 23 42 / 13%)',
  },
  selectors: {
    '&&': {
      // Reset pointer coordinates so nested glass controls never inherit an enclosing surface's glint.
      vars: {
        '--liquid-glass-light-x': 'initial',
        '--liquid-glass-light-y': 'initial',
      },
      backgroundColor: surfaceContainer,
      backgroundImage: 'none',
    },
    [`${DARK_THEMES} &&`]: {
      vars: {
        [surfaceTint]: `${darkTint}%`,
        [rimTop]: 'rgb(255 255 255 / 26%)',
        [rimSide]: 'rgb(255 255 255 / 6%)',
        [rimBottom]: 'rgb(255 255 255 / 13%)',
        [rimCornerTop]: 'rgb(255 255 255 / 46%)',
        [rimCornerBottom]: 'rgb(255 255 255 / 24%)',
        [rimGlint]: 'rgb(255 255 255 / 80%)',
        [outerHairline]: 'rgb(0 0 0 / 52%)',
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
        '&&': {
          isolation: 'isolate',
          vars: { [glassShadow]: elevation },
        },
        // Keep the 1px specular rim above relative children (hovered rows, badges, sticky titles).
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          zIndex: 2,
          borderRadius: 'inherit',
          padding: 1,
          pointerEvents: 'none',
          backgroundImage: [
            `radial-gradient(circle 120px at var(--liquid-glass-light-x, -999px) var(--liquid-glass-light-y, -999px), ${rimGlint}, transparent 72%)`,
            `linear-gradient(135deg, ${rimCornerTop} 0%, transparent 26%, transparent 74%, ${rimCornerBottom} 100%)`,
            `linear-gradient(180deg, ${rimTop} 0%, ${rimSide} 36%, ${rimSide} 68%, ${rimBottom} 100%)`,
          ].join(', '),
          WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
        },
      },
    },
    [backdropSupport]: {
      vars: { [glassShadow]: shadow },
      selectors: {
        '&&': {
          backgroundColor: backdropTint,
          ...backdropBlur,
        },
        '&&[data-liquid-glass="active"]': {
          backdropFilter: 'var(--liquid-glass-filter) saturate(175%)',
          WebkitBackdropFilter: 'var(--liquid-glass-filter) saturate(175%)',
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
    [opaqueGlassMedia]: {
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

// A glass button whose menu or dialog is open looks pressed, as a composer toggle that is on does,
// while pointed at too. Folds' hover colour outweighs the material's background, so this paints
// the pressed tint itself in each of the material's cases; the repeated class outweighs both and
// the material's hover rule, which comes later in its media query.
const expanded = 'button&&&&&&[aria-expanded="true"]';
export const glassExpanded = style({
  selectors: {
    [expanded]: { vars: { [surfaceContainer]: surfaceActive }, backgroundColor: surfaceActive },
  },
  '@supports': {
    [backdropSupport]: {
      selectors: {
        [expanded]: {
          backgroundColor: `color-mix(in srgb, ${surfaceActive} ${surfaceTint}, transparent)`,
        },
      },
      // Nested: vanilla-extract emits a top-level media query before this one, where it would lose.
      '@media': {
        [opaqueGlassMedia]: { selectors: { [expanded]: { backgroundColor: surfaceActive } } },
      },
    },
  },
});

// Match frosted floating pills, menus, and banners to the native 12px blur.
const floatingBlur = '12px';
export const glassFloating = style({
  selectors: {
    '&&&': {
      vars: { [surfaceBlur]: floatingBlur },
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

const fadeMask = 'linear-gradient(to bottom, #000, transparent)';
const maskedFadeSupport = `(${backdropSupport}) and ((mask-image: ${fadeMask}) or (-webkit-mask-image: ${fadeMask}))`;
const tintSupport = '(background-color: color-mix(in srgb, #000, transparent))';
const fadeSupport = `${maskedFadeSupport} and ${tintSupport}`;

// Continue the flat chrome behind the controls without making their slot a backdrop root.
export const glassFadeDown = style({
  '@supports': {
    [fadeSupport]: {
      selectors: {
        '&::before': {
          content: '""',
          position: 'absolute',
          // A pixel up, under the chrome above, so no sharp line of content shows between the
          // two. The slot stands at the chrome's height rounded to a whole pixel, and on an
          // iPhone one row of device pixels between them showed the content sharp.
          inset: '-1px 0 0',
          zIndex: -1,
          pointerEvents: 'none',
          vars: {
            [surfaceContainer]: color.Surface.Container,
            [surfaceTint]: denseTint.light,
            [surfaceBlur]: floatingBlur,
          },
          backgroundColor: backdropTint,
          ...backdropBlur,
          WebkitMaskImage: fadeMask,
          maskImage: fadeMask,
        },
        [`${DARK_THEMES} &::before`]: { vars: { [surfaceTint]: denseTint.dark } },
      },
    },
  },
  '@media': { [opaqueGlassMedia]: { selectors: { '&::before': { display: 'none' } } } },
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

// Approval review, large dialogs and the thread banner hold dense text: keep the rim and blur,
// but tint them nearly opaque so the page behind does not compete with what they say.
export const glassDenseOverBackdrop = style({
  selectors: {
    '&&&': { vars: { [surfaceTint]: denseTint.light } },
    [`${DARK_THEMES} &&&`]: {
      vars: { [surfaceTint]: denseTint.dark },
    },
  },
});

// A lighter tint over the fade lets as much through at the bar's middle as through the header.
export const glassOverFadingBackdrop = style([
  glassDenseOverBackdrop,
  {
    '@supports': {
      [fadeSupport]: {
        selectors: {
          [`${glassFadeDown} > &&&`]: { vars: { [surfaceTint]: '89%' } },
          [`${DARK_THEMES} ${glassFadeDown} > &&&`]: { vars: { [surfaceTint]: '82%' } },
        },
      },
    },
  },
]);

export const glassSurface = recipe({
  base: {
    boxShadow: glassShadow,
    '@media': {
      '(prefers-reduced-motion: no-preference)': {
        selectors: {
          'button&': { transition: 'scale 180ms cubic-bezier(0.2, 0.8, 0.2, 1)' },
          'button&:active:not(:disabled)': { scale: '0.98' },
        },
      },
      '(hover: hover) and (prefers-reduced-motion: no-preference)': {
        selectors: { 'button&:hover:not(:disabled):not(:active)': { scale: '1.025' } },
      },
    },
  },
  variants: {
    level: {
      overlay: [
        // Vertical lighting and 45° corner gleams catch the edge while the sides recede. Menus,
        // popovers and dialogs hold text over the page, so their glass is tinted nearly opaque.
        material(
          88,
          16,
          `inset 0 1px 0 ${rimTop}, inset 0 -1px 0 ${rimBottom}, 0 0 0 0.5px ${outerHairline}, 0 16px 48px rgb(0 0 0 / 18%), 0 2px 8px rgb(0 0 0 / 8%)`,
          `0 0 0 0.5px ${outerHairline}, 0 16px 48px rgb(0 0 0 / 18%), 0 2px 8px rgb(0 0 0 / 8%)`,
          88
        ),
        { selectors: { '&&': { boxShadow: glassShadow } } },
      ],
      panel: material(
        60,
        12,
        `inset 0 1px 0 ${rimTop}, inset 0 -1px 0 ${rimBottom}, 0 0 0 0.5px ${outerHairline}`,
        `0 0 0 0.5px ${outerHairline}`
      ),
      control: material(
        58,
        12,
        `inset 0 1px 0 ${rimTop}, inset 0 -1px 0 ${rimBottom}, 0 0 0 0.5px ${outerHairline}, 0 2px 8px rgb(0 0 0 / 5%)`,
        `0 0 0 0.5px ${outerHairline}, 0 2px 8px rgb(0 0 0 / 5%)`
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
    [backdropSupport]: {
      selectors: {
        [`&&&${layeredContent}`]: {
          position: 'relative',
          isolation: 'isolate',
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
        },
        [`&${layeredContent}::after`]: {
          content: '""',
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          pointerEvents: 'none',
          zIndex: -1,
          ...backdropBlur,
        },
        [`&[data-liquid-glass="active"]${layeredContent}::after`]: {
          backdropFilter: 'var(--liquid-glass-filter) saturate(175%)',
          WebkitBackdropFilter: 'var(--liquid-glass-filter) saturate(175%)',
        },
      },
    },
  },
  '@media': {
    [opaqueGlassMedia]: {
      selectors: { '&&&::after': { display: 'none' } },
    },
  },
});
