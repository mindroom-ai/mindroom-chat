import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { BAR_GAP, BAR_STEP, GLIDE_MAX_STEPS } from './waveformGeometry';

export const Waveform = style([
  DefaultReset,
  {
    display: 'block',
    direction: 'ltr',
    width: '100%',
    minWidth: `min(${toRem(96)}, 100%)`,
    height: toRem(32),
    color: color.SurfaceVariant.OnContainer,
  },
]);

export const WaveformSeek = style({
  position: 'relative',
  userSelect: 'none',
  borderRadius: config.radii.R300,
  ':focus-within': {
    outline: `${config.borderWidth.B300} solid ${color.Primary.Main}`,
    outlineOffset: config.space.S100,
  },
});

// Native range supplies pointer capture, touch scrubbing and slider semantics.
export const SeekInput = style({
  position: 'absolute',
  inset: '50% 0 auto',
  width: '100%',
  height: toRem(44),
  margin: 0,
  translate: '0 -50%',
  opacity: 0,
  cursor: 'pointer',
  ':disabled': { cursor: 'default' },
});

export const WaveformDimmed = style({
  opacity: config.opacity.P500,
});

export const WaveformCompact = style({
  overflow: 'hidden',
  position: 'relative',
});

// The recording's bars and the dotted line before them, which glide left together as samples
// come in (VoiceWaveform.tsx). The dots repeat at the bars' px step, so a glide of whole steps
// ends where it began; the strip reaches past its start as far as a glide can begin.
export const CompactStrip = style({
  position: 'absolute',
  insetBlock: 0,
  insetInlineEnd: 0,
  inlineSize: `calc(100% + ${GLIDE_MAX_STEPS * BAR_STEP}px)`,
  backgroundImage: `linear-gradient(to right, transparent 0 ${BAR_GAP}px, ${color.SurfaceVariant.ContainerLine} ${BAR_GAP}px ${BAR_STEP}px)`,
  // eslint-disable-next-line no-restricted-syntax -- Waveform lays out left to right in every language, so the bars sit at the right
  backgroundPosition: 'right center',
  backgroundRepeat: 'repeat-x',
  backgroundSize: `${BAR_STEP}px ${toRem(3)}`,
});

export const Svg = style({
  display: 'block',
  width: '100%',
  height: '100%',
});

export const SvgCompact = style({
  position: 'absolute',
  insetBlockStart: 0,
  insetInlineEnd: 0,
  flex: '0 0 auto',
  width: 'auto',
  maxWidth: 'none',
});

export const Bar = style({
  fill: color.SurfaceVariant.OnContainer,
  opacity: config.opacity.P400,
});

export const BarCompact = style({
  fill: color.Surface.OnContainer,
  opacity: 1,
});

export const BarActive = style({
  fill: color.Primary.Main,
  opacity: 1,
});

export const BarCompactUnrecorded = style({
  fill: color.SurfaceVariant.ContainerLine,
  opacity: 1,
});
