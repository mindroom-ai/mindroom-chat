import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { color, config, toRem } from 'folds';

// Styles for GitHub-style alert callouts rendered from blockquotes.

type AccentTone = {
  Main: string;
  Container: string;
  ContainerLine: string;
  OnContainer: string;
};

// Keeps tinted containers subtle so body text (Surface.OnContainer) and search highlights
// (Warning.Container) stay legible across all 23 light and dark palettes.
const calloutTone = (tone: AccentTone) => {
  const hairline = `${config.borderWidth.B300} solid color-mix(in srgb, ${tone.ContainerLine} 70%, transparent)`;
  return {
    borderBlock: hairline,
    borderInlineEnd: hairline,
    borderInlineStart: `${config.borderWidth.B700} solid ${tone.Main}`,
    backgroundColor: `color-mix(in srgb, ${tone.Container} 40%, transparent)`,
  };
};

// Blends the accent foreground toward Surface.OnContainer so titles keep >= 4.5:1 contrast
// even inside 75%-opacity m.notice messages (including Tip on Silver and Gruvbox Light).
const headerTone = (tone: AccentTone) => ({
  color: `color-mix(in srgb, ${tone.OnContainer} 40%, ${color.Surface.OnContainer})`,
});

export const Callout = recipe({
  base: {
    display: 'flex',
    flexDirection: 'column',
    gap: config.space.S100,
    minWidth: 0,
    maxWidth: '100%',
    paddingBlock: config.space.S200,
    paddingInline: config.space.S300,
    borderRadius: config.radii.R400,
    color: color.Surface.OnContainer,
  },
  variants: {
    tone: {
      note: calloutTone(color.Primary),
      tip: calloutTone(color.Success),
      important: calloutTone(color.Secondary),
      warning: calloutTone(color.Warning),
      caution: calloutTone(color.Critical),
    },
  },
});

export const Header = recipe({
  base: {
    display: 'flex',
    alignItems: 'center',
    gap: toRem(6),
    fontWeight: config.fontWeight.W600,
    lineHeight: 1.4,
  },
  variants: {
    tone: {
      note: headerTone(color.Primary),
      tip: headerTone(color.Success),
      important: headerTone(color.Secondary),
      warning: headerTone(color.Warning),
      caution: headerTone(color.Critical),
    },
  },
});

export const Icon = style({
  flexShrink: 0,
});

export const Body = style({
  minWidth: 0,
});
