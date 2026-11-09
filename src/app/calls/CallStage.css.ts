import {
  createContainer,
  createVar,
  fallbackVar,
  globalStyle,
  keyframes,
  style,
  styleVariants,
  type StyleRule,
} from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { STAGE_PADDING, TILE_GAP } from './stageLayout';

// The stage answers its own height: a short window drops the voice stage's status line first,
// then the names, then the bars, so the faces keep their room. Each height is what the voice
// stage needs with that part (a 64 px face with a line under it, 24 px bars, 12 px gaps). Shorter
// still, the faces shrink to the stage's height, down to FACE_MIN.
const stage = createContainer();
const HIDES_STATUS = `${stage} (max-height: 160px)`;
const HIDES_NAMES = `${stage} (max-height: 128px)`;
const HIDES_BARS = `${stage} (max-height: 100px)`;
const hiddenWhen = (query: string): StyleRule => ({
  '@container': { [query]: { display: 'none' } },
});

/** The smallest a voice stage's face gets in a short stage. */
const FACE_MIN = 24;
/** Even a body crowded with notices leaves the stage the smallest face's height. */
const STAGE_MIN_HEIGHT = toRem(FACE_MIN + 2 * STAGE_PADDING);
/** Speaker view's faces sit inside the tile in focus as far as that tile sits inside the stage. */
const FACE_EDGE = toRem(STAGE_PADDING);
/** The inset is measured from the stage, so twice as far: inside the tile in focus by as much. */
const INSET_EDGE = toRem(STAGE_PADDING * 2);
const INSET_MIN_WIDTH = toRem(96);
const INSET_MAX_WIDTH = toRem(160);
const INSET_SHADOW = `0 ${toRem(4)} ${toRem(12)} ${color.Other.Shadow}`;
const VOICE_FACES_GAP = toRem(20);
/** A name under a face stops at this width, the waiting line wraps there. */
const FACE_MAX_WIDTH = toRem(160);
/** Stands for the space between a name and the user ID after it, which wraps under it. */
const NAME_ID_GAP = toRem(4);
/** Grid tiles before the stage was measured and tiles under shared screens: this wide at least. */
const FLOW_TILE = toRem(160);
const BADGE_OFFSET = toRem(-2);
const BAR_WIDTH = toRem(4);
const BAR_REST = 'scaleY(0.35)';
const ONE_PIXEL = toRem(1);
const MORE_COUNT_LONG = toRem(10);

const bareList = { margin: 0, padding: 0, listStyle: 'none' } as const;

/** A flex line with its children centred across it, `gap` apart. */
const centredFlow = (flexFlow: string, gap: string): StyleRule => ({
  display: 'flex',
  flexFlow,
  alignItems: 'center',
  gap,
});

/** A ring around a round element, drawn outside it. */
const ring = (width: number, ringColor: string) => `0 0 0 ${toRem(width)} ${ringColor}`;

/**
 * Room the stage keeps at its end for what lies over it there (the floating window's subtitle):
 * its tiles, its voice stage and the own camera's inset sit above it, and its container queries
 * see only the height left.
 */
export const stageEndRoom = createVar();
const endRoom = fallbackVar(stageEndRoom, '0px');

export const Stage = style({
  containerType: 'size',
  containerName: stage,
  position: 'relative',
  flex: '1 1 0',
  minHeight: STAGE_MIN_HEIGHT,
  padding: toRem(STAGE_PADDING),
  paddingBlockEnd: `calc(${toRem(STAGE_PADDING)} + ${endRoom})`,
  overflow: 'hidden',
});

// Tiles at the size `fitTiles` gives them, set on the grid; until the stage was measured they
// share its width as they fit.
export const Grid = style({
  ...bareList,
  gap: toRem(TILE_GAP),
  height: '100%',
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fit, minmax(${FLOW_TILE}, 1fr))`,
  placeContent: 'center',
});

// A grid cell sets the tile's shape, between square and 16:9, in place of its own 4:3.
globalStyle(`${Grid} > li`, { aspectRatio: 'auto', minWidth: 0 });

// The grid while screens are shared: each fills a row (a screen tile spans the columns), everyone's tiles
// follow at their 4:3 under them, and the list scrolls from its first row once they outgrow it.
export const Screens = style({
  ...bareList,
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fill, minmax(${FLOW_TILE}, 1fr))`,
  height: '100%',
  gap: toRem(TILE_GAP),
  overflowY: 'auto',
  alignContent: 'safe center',
});

export const Speaker = style({ ...bareList, position: 'relative', height: '100%' });

// The tile in focus, always the list's first, fills the stage.
globalStyle(`${Speaker} > li:first-child`, { position: 'absolute', inset: 0, aspectRatio: 'auto' });

// The others overlap in a row from the top end corner of the tile in focus (each face's inline
// offset is its own); the speaking one comes forward.
export const SpeakerFace = style({
  position: 'absolute',
  insetBlockStart: FACE_EDGE,
  display: 'flex',
  borderRadius: '50%',
  boxShadow: ring(2, color.Surface.Container),
  selectors: {
    '&[data-speaking="true"]': { zIndex: 1, boxShadow: ring(2, color.Success.Main) },
  },
});

// The count of the faces a long row leaves out sits on the tiles' own fill: the circle is over the
// video or screen in focus, where a see-through one would not read.
export const MoreFaces = style({
  background: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
});

// "+12" in the folds label size nearly touches the 24 px circle's sides; two digits step down.
export const MoreCount = styleVariants({
  short: {},
  long: { selectors: { '&&': { fontSize: MORE_COUNT_LONG } } },
});

// The own camera, small in the bottom end corner over the tile in focus.
export const Inset = style({
  ...bareList,
  position: 'absolute',
  insetInlineEnd: INSET_EDGE,
  insetBlockEnd: `calc(${INSET_EDGE} + ${endRoom})`,
  zIndex: 2,
  width: '26%',
  minWidth: INSET_MIN_WIDTH,
  maxWidth: INSET_MAX_WIDTH,
  borderRadius: config.radii.R400,
  boxShadow: INSET_SHADOW,
});

// Faces that do not fit scroll, from the first row (a plain centre would cut off the top).
export const Voice = style([
  centredFlow('column nowrap', toRem(12)),
  { height: '100%', justifyContent: 'safe center', overflowY: 'auto', textAlign: 'center' },
]);

export const VoiceFaces = style({
  ...bareList,
  display: 'flex',
  flexFlow: 'row wrap',
  gap: VOICE_FACES_GAP,
  justifyContent: 'center',
  maxWidth: '100%',
});

export const VoiceFace = style([
  centredFlow('column nowrap', toRem(6)),
  {
    minWidth: 0,
    maxWidth: FACE_MAX_WIDTH,
    selectors: { '&[data-connected="false"]': { opacity: 0.7 } },
  },
]);

export const VoiceAvatarFrame = style({ position: 'relative', display: 'flex' });

const faceAvatar = style({
  transition: 'box-shadow 120ms ease',
  selectors: {
    [`${VoiceFace}[data-speaking="true"] &`]: { boxShadow: ring(3, color.Success.Main) },
  },
});

/** A face `size` px across, smaller in a stage shorter than that, but not under FACE_MIN. */
const faceSize = (size: number): StyleRule => {
  const side = `clamp(${toRem(FACE_MIN)}, 100cqh, ${toRem(size)})`;
  return { selectors: { '&&': { width: side, height: side } } };
};

// 64 px for the one other person, 48 px each for more; folds sizes stop short of both.
export const VoiceAvatar = styleVariants({
  solo: [faceAvatar, faceSize(64)],
  group: [faceAvatar, faceSize(48)],
});

// A muted microphone, in the red of the microphone control while off.
export const VoiceMuted = style({
  display: 'flex',
  position: 'absolute',
  insetInlineEnd: BADGE_OFFSET,
  insetBlockEnd: BADGE_OFFSET,
  padding: toRem(3),
  borderRadius: '50%',
  boxShadow: ring(1, color.Surface.ContainerLine),
  background: color.Surface.Container,
  color: color.Critical.Main,
});

// A name and the user ID after it (`NameWithUserId`) are two items of a wrapping row: on a narrow
// line the ID moves under the name, which an ellipsis may cut, and stays whole.
const nameLine: StyleRule = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  columnGap: NAME_ID_GAP,
  maxWidth: '100%',
  textAlign: 'center',
};

export const VoiceName = style([nameLine, hiddenWhen(HIDES_NAMES)]);

const barRise = keyframes({
  '0%, 100%': { transform: BAR_REST },
  '50%': { transform: 'scaleY(1)' },
});

export const VoiceBars = style([
  centredFlow('row nowrap', toRem(4)),
  { height: toRem(24) },
  hiddenWhen(HIDES_BARS),
]);

const speakingBars = `${VoiceBars}[data-speaking="true"] &`;

// Still and grey while nobody talks; green and moving while anyone does (still under reduced
// motion, where green alone tells it).
export const VoiceBar = style({
  width: BAR_WIDTH,
  height: '100%',
  borderRadius: toRem(2),
  transform: BAR_REST,
  background: color.SurfaceVariant.ContainerLine,
  selectors: {
    [speakingBars]: {
      background: color.Success.Main,
      animation: `${barRise} 900ms ease-in-out infinite`,
    },
    '&:nth-child(2)': { animationDelay: '-300ms' },
    '&:nth-child(3)': { animationDelay: '-600ms' },
  },
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      selectors: { [speakingBars]: { animation: 'none', transform: 'none' } },
    },
  },
});

export const VoiceStatus = style([nameLine, hiddenWhen(HIDES_STATUS)]);

// This device's own entry in the people list: read out, not shown, as the stage shows the others.
export const OffStage = style({
  position: 'absolute',
  overflow: 'hidden',
  inlineSize: ONE_PIXEL,
  clipPath: 'inset(50%)',
  blockSize: ONE_PIXEL,
  whiteSpace: 'nowrap',
});
