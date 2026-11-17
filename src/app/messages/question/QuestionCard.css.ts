import { keyframes, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

const reducedMotion = '(prefers-reduced-motion: reduce)';
const ease = 'cubic-bezier(.2, .8, .2, 1)';

const accentLine = `color-mix(in srgb, ${color.Primary.Main} 55%, transparent)`;
const answeredLine = `color-mix(in srgb, ${color.Success.Main} 45%, ${color.SurfaceVariant.ContainerLine})`;

/** An agent's question in its reply: a small card that folds to the chosen option. */
export const Card = style({
  display: 'flex',
  flexDirection: 'column',
  boxSizing: 'border-box',
  width: 'fit-content',
  minWidth: 0,
  maxWidth: `min(100%, ${toRem(440)})`,
  marginBlock: config.space.S100,
  paddingBlock: toRem(10),
  paddingInline: toRem(12),
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: toRem(12),
  backgroundColor: `color-mix(in srgb, ${color.SurfaceVariant.Container} 60%, transparent)`,
  color: color.SurfaceVariant.OnContainer,
  overflowWrap: 'anywhere',
  transition: 'border-color .3s, background-color .3s',
  selectors: {
    '&[data-question-card="answered"]': {
      borderColor: answeredLine,
      backgroundColor: 'transparent',
    },
  },
});

export const Top = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: toRem(9),
  minWidth: 0,
});

const pulse = keyframes({ '50%': { opacity: 0.3 } });
const pop = keyframes({ from: { opacity: 0, transform: 'scale(.4)' } });

/** Left of the question: a pulsing dot while it waits, a check once answered. */
export const Mark = style({
  display: 'grid',
  placeItems: 'center',
  flexShrink: 0,
  width: toRem(16),
  height: toRem(16),
  // Centers the mark on the question's first line.
  marginBlockStart: toRem(3),
  borderRadius: '50%',
  selectors: {
    '&::before': {
      content: '""',
      width: toRem(7),
      height: toRem(7),
      borderRadius: '50%',
      backgroundColor: color.SurfaceVariant.ContainerLine,
    },
  },
});

export const MarkWaiting = style({
  selectors: {
    '&::before': {
      backgroundColor: color.Warning.Main,
      animation: `${pulse} 1.6s infinite`,
    },
  },
  '@media': { [reducedMotion]: { selectors: { '&::before': { animation: 'none' } } } },
});

export const MarkAnswered = style({
  backgroundColor: color.Success.Main,
  color: color.Success.OnMain,
  selectors: { '&::before': { display: 'none' } },
});

/** The check of an answer that arrived while the card was shown. */
export const MarkPop = style({
  animation: `${pop} .35s .1s ${ease} both`,
  '@media': { [reducedMotion]: { animation: 'none' } },
});

export const Question = style({
  minWidth: 0,
  fontWeight: config.fontWeight.W600,
  whiteSpace: 'pre-wrap',
  transition: 'color .3s',
});

export const QuestionAnswered = style({
  fontSize: toRem(13.5),
  fontWeight: config.fontWeight.W500,
  color: color.SurfaceVariant.OnContainer,
  opacity: config.opacity.P300,
});

export const Options = style({
  display: 'flex',
  flexDirection: 'column',
  marginBlockStart: toRem(4),
});

/** One option: a compact row with its emoji, label and, once chosen, who chose it. */
export const Option = style({
  display: 'flex',
  alignItems: 'center',
  gap: toRem(8),
  boxSizing: 'border-box',
  width: '100%',
  // A margin rather than the list's gap, so a row that folds away takes its space with it.
  marginBlockStart: toRem(6),
  paddingBlock: toRem(6),
  paddingInline: toRem(10),
  border: `${config.borderWidth.B300} solid transparent`,
  borderRadius: toRem(8),
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
  font: 'inherit',
  lineHeight: 1.4,
  textAlign: 'start',
  cursor: 'pointer',
  overflow: 'hidden',
  transition: 'background-color .25s, border-color .25s, opacity .25s',
  selectors: {
    '&:hover:not(:disabled), &:focus-visible': {
      borderColor: accentLine,
    },
    '&:focus-visible': {
      outline: `${toRem(2)} solid ${color.Primary.Main}`,
      outlineOffset: toRem(2),
    },
    '&:disabled': { cursor: 'default' },
  },
});

export const OptionChosen = style({
  selectors: {
    '&&': {
      borderColor: accentLine,
      backgroundColor: color.Primary.Container,
      color: color.Primary.OnContainer,
    },
  },
});

const fadeIn = keyframes({ from: { opacity: 0 } });

/** Another option, shown again when the chosen one is clicked. */
export const OptionPeek = style({
  opacity: 0.45,
  animation: `${fadeIn} .2s both`,
  '@media': { [reducedMotion]: { animation: 'none' } },
});

export const Emoji = style({ flexShrink: 0, width: toRem(20), textAlign: 'center' });

export const Label = style({ flexGrow: 1, minWidth: 0 });

export const Chosen = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(4),
  flexShrink: 1,
  minWidth: 0,
  maxWidth: '50%',
  fontSize: toRem(12),
  fontWeight: config.fontWeight.W600,
});

/** A long answerer name ends in an ellipsis rather than squeezing the option's label. */
export const ChosenText = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const Failed = style({ marginBlockStart: toRem(6), color: color.Critical.Main });

// The status the dot shows, for screen readers.
export const VisuallyHidden = style({
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
});
