import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

const { space, radii, borderWidth } = config;
const AVATAR = toRem(24);

export const HeaderActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: space.S100,
  flexShrink: 0,
});

// "This call is transcribed.": a quiet line at the top, with its icon.
export const Transcribed = style({
  display: 'flex',
  alignItems: 'center',
  gap: space.S200,
  color: color.SurfaceVariant.OnContainer,
});

export const Members = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: space.S200,
  margin: 0,
  padding: 0,
  listStyle: 'none',
});

export const Member = style({
  display: 'flex',
  alignItems: 'center',
  gap: space.S100,
  minWidth: 0,
  maxWidth: '100%',
});

export const Lines = style({
  display: 'flex',
  flexDirection: 'column',
  gap: space.S300,
  margin: 0,
  padding: 0,
  listStyle: 'none',
  paddingBlockStart: space.S300,
  borderBlockStart: `${borderWidth.B300} solid ${color.Background.ContainerLine}`,
  // Before anyone speaks the log around it says so; the list shows with the first line.
  selectors: { '&:empty': { display: 'none' } },
});

/** One speaker's run of lines: the avatar, then the name over the lines' text. */
export const Group = style({
  display: 'grid',
  gridTemplateColumns: `${AVATAR} minmax(0, 1fr)`,
  columnGap: space.S200,
  alignItems: 'start',
  minWidth: 0,
});

export const GroupBody = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: toRem(2),
  minWidth: 0,
});

export const Name = style({ fontWeight: 600, maxWidth: '100%' });

/** A name and the user ID that may follow it: the ID wraps onto the next line, never cut. */
export const NameRow = style({
  display: 'flex',
  flexWrap: 'wrap',
  columnGap: space.S100,
  minWidth: 0,
  maxWidth: '100%',
});

/** Spoken text keeps its line breaks and wraps anywhere rather than overflow the panel. */
export const Text = style({
  margin: 0,
  maxWidth: '100%',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});

/** A gap ("Paused", "Not transcribed"): a quiet note between the lines, in the middle. */
export const Gap = style({
  alignSelf: 'center',
  paddingBlock: toRem(2),
  paddingInline: space.S200,
  borderRadius: radii.R300,
  background: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
});
