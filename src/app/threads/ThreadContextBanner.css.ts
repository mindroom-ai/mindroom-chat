import { globalStyle, keyframes, style, type CSSProperties } from '@vanilla-extract/css';
import { config, color, toRem } from 'folds';
import { glassDenseOverBackdrop, glassFloating, glassSurface } from '../ui/styles/Glass.css';
import { shortViewport } from '../ui/styles/shortViewport';
import { toolbarButtonRestFill } from '../messages/styles.css';

// Collapsed, the banner shrinks to a pill with back and Show details at the
// start of the row, so the messages show beside it.
export const Collapsed = style({});

// Short screens keep one row: back, title and the actions menu, which already
// offers tags, pinning and resolving. Doubled to beat single-class rules
// regardless of stylesheet order. Spread it only into styles without media
// queries of their own.
const whenCompact = (compact: CSSProperties) => ({
  '@media': { [shortViewport]: { selectors: { '&&': compact } } },
});

// Flush under the room header: a strip between them would show the scrolled messages, cut in half.
const BannerLayout = style({
  margin: `0 ${config.space.S300} ${config.space.S200}`,
  padding: config.space.S300,
  borderRadius: config.radii.R500,
  position: 'relative',
  pointerEvents: 'auto',
  selectors: { [`&${Collapsed}`]: { width: 'fit-content', padding: config.space.S100 } },
  '@media': { [shortViewport]: { padding: config.space.S200 } },
});

export const CompactHidden = style(whenCompact({ display: 'none' }));

export const Banner = style([
  BannerLayout,
  glassSurface({ level: 'control', variant: 'SurfaceVariant' }),
  glassFloating,
  glassDenseOverBackdrop,
]);

// Back, title and actions.
export const TitleRow = style({
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
  alignItems: 'center',
  columnGap: config.space.S300,
  minHeight: '1.5rem',
});

// Holds the eyebrow, the approvals chip and the tags; often none of them.
export const EyebrowRow = style({
  flexShrink: 0,
  selectors: { '&:empty': { display: 'none' } },
  '@media': {
    [shortViewport]: {
      // Beside the title, the status chips keep to the room left of the thread actions.
      flexShrink: 1,
      minWidth: 0,
      selectors: { [`&:not(:has(> :not(${CompactHidden})))`]: { display: 'none' } },
    },
  },
});

// "Thread View" is chrome, not content: it says the same thing on every
// thread the user opens, so it shows only while the thread has no title and
// gives way to a status chip. It uses the same uppercase/12px/W500 treatment
// the sidebar category headers and the SHOW MORE pill already use for that role.
export const ViewLabel = style({
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  fontWeight: config.fontWeight.W500,
  whiteSpace: 'nowrap',
  selectors: { [`${EyebrowRow}:has(> [data-thread-status-chip]) > &`]: { display: 'none' } },
});

// On short screens the approvals chip that stays in view sits beside the title.
// A size container, so the byline can wrap by the room the title has: a tablet
// with the room list open leaves as little as a phone.
export const TitleColumn = style({
  containerType: 'inline-size',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  gap: 0,
  ...whenCompact({ flexDirection: 'row', alignItems: 'center', columnGap: config.space.S200 }),
});

// The tags take the room the status chips leave, and wrap onto another line where they do not
// fit (a tablet with the members panel), so "+ tag" and the count stay beside the actions.
export const TagsRow = style({
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  gap: '0.3rem',
  flexWrap: 'wrap',
  overflow: 'hidden',
});

// On short screens the title and a scheduled task share one line and truncate together; they take the room the
// status chips leave, down to a short stub.
export const SubtitleRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  marginTop: config.space.S100,
  minWidth: 0,
  flexWrap: 'wrap',
  selectors: {
    [`${EyebrowRow}:empty + &`]: { marginTop: 0 },
  },
  '@media': {
    [shortViewport]: { marginTop: 0, flexWrap: 'nowrap', flex: '1 1 0', minWidth: '4rem' },
  },
});

// Who resolved the thread follows the title like the schedule does; below
// the chip it made that column taller than the buttons beside it. Where the
// title column is narrow (phones, tablets with the room list) the byline would
// squeeze the title to an ellipsis, so it takes a line of its own there.
const narrowTitle = '(max-width: 26rem)';
export const ResolutionByline = style({
  display: 'inline-flex',
  minWidth: 0,
  flexShrink: 0,
  '@container': { [narrowTitle]: { flexBasis: '100%' } },
});

// The separator only makes sense beside the title.
export const ResolutionBylineDot = style({
  '@container': { [narrowTitle]: { display: 'none' } },
});

export const ResolverName = style({
  minWidth: 0,
  maxWidth: '10rem',
  '@container': { [narrowTitle]: { maxWidth: 'none' } },
});

// Resolved, the check fills like a set pin: solid green, as the chip was.
export const ResolvedButton = style({
  vars: { [toolbarButtonRestFill]: color.Success.Main },
  backgroundColor: color.Success.Main,
  color: color.Success.OnMain,
  selectors: {
    '&:hover, &:focus-visible': { backgroundColor: color.Success.MainHover },
    '&:active': { backgroundColor: color.Success.MainActive },
  },
});

// The grey this used to hardcode (rgba(128,128,128,0.2)) is the same slab in
// every theme, so it read as a hole in butter and as a smudge in midnight.
// On the container tokens it tracks the tag pills it sits next to.
export const OverflowChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  fontSize: '0.65rem',
  fontWeight: config.fontWeight.W500,
  padding: '0.1rem 0.4rem',
  borderRadius: config.radii.Pill,
  border: `solid ${config.borderWidth.B300} ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  userSelect: 'none',
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
  verticalAlign: 'middle',
});

// The thread title is the one thing in this bar that differs per thread, so
// it carries the weight the "Thread View" eyebrow used to take.
export const SummaryText = style({
  display: 'block',
  fontWeight: config.fontWeight.W500,
  minWidth: 0,
  // Fills the row only as far as the title is long, so a schedule or a
  // byline follows it instead of the far end of the row.
  maxWidth: 'max-content',
  overflow: 'hidden',
  flex: '1 1 0px',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  ...whenCompact({ flexBasis: 'auto' }),
});

const SummaryChangedTint = keyframes({
  from: {
    backgroundColor: color.Primary.Container,
    boxShadow: `0 0 0 ${config.space.S100} ${color.Primary.Container}`,
  },
  to: {
    backgroundColor: 'transparent',
    boxShadow: `0 0 0 ${config.space.S100} transparent`,
  },
});

export const SummaryTextChanged = style({
  borderRadius: config.radii.R300,
  animation: `${SummaryChangedTint} 2.4s ease-out`,
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animation: 'none',
    },
  },
});

// A narrow title column gives the schedule a line of its own, as it does the byline: beside the
// title it took all but a letter of the title's room. Short screens keep the one line.
export const ScheduledWrap = style({
  display: 'inline-flex',
  alignItems: 'center',
  minInlineSize: 0,
  flexShrink: 0,
  whiteSpace: 'nowrap',
  '@container': { [narrowTitle]: { flexBasis: '100%' } },
  ...whenCompact({ flexShrink: 1, flexBasis: 'auto' }),
});

export const ScheduledDot = style({
  '@container': { [narrowTitle]: { display: 'none' } },
  ...whenCompact({ display: 'inline' }),
});

export const MetadataDot = style({
  flexShrink: 0,
});

export const ScheduledIndicator = style({
  minWidth: 0,
  maxWidth: '14rem',
  flexShrink: 0,
  overflow: 'hidden',
  color: 'currentColor',
  whiteSpace: 'nowrap',
  ...whenCompact({ flexShrink: 1 }),
});

export const BannerResolved = style([
  BannerLayout,
  glassSurface({ level: 'control', variant: 'Success' }),
  glassFloating,
  glassDenseOverBackdrop,
  { color: color.Success.OnContainer },
]);

export const BannerDisabled = style({
  opacity: 0.6,
  pointerEvents: 'none',
});

export const TagPickerInputContainer = style({
  borderBottom: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  padding: `0 ${config.space.S100}`,
});

export const TagPickerInput = style({
  width: '100%',
  display: 'block',
  padding: `${config.space.S200} ${config.space.S300}`,
  border: 'none',
  outline: 'none',
  font: 'inherit',
  fontSize: '0.8rem',
  lineHeight: 1.4,
  background: 'transparent',
  color: color.SurfaceVariant.OnContainer,
  caretColor: color.SurfaceVariant.OnContainer,
  selectors: {
    '&::placeholder': {
      color: color.SurfaceVariant.OnContainer,
      opacity: '0.5',
    },
    '&:focus::placeholder': {
      opacity: '0',
    },
  },
});

// A phone's thread bar: back, then the title over the thread's state (or room), its tags and its
// status chips. It fills the room header's row, flat on its surface; the title follows the back
// chevron's touch target directly, and the room menu follows the title a gap away, so their touch
// targets do not meet.
export const PhoneBar = style({
  flexGrow: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  paddingInlineEnd: config.space.S100,
  outline: 'none',
});

// The title's two lines; the title's button reaches over both (its ::after), for a finger.
export const PhoneBarText = style({
  position: 'relative',
  flexGrow: 1,
  minWidth: 0,
  minHeight: toRem(44),
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  paddingInline: config.space.S100,
});

export const PhoneBarHeading = style({
  margin: 0,
  minWidth: 0,
  display: 'flex',
  font: 'inherit',
});

// As wide as the line, so a first message's title, cut at a word, fits again when the bar widens;
// the chevron still follows the title, which takes only its own width.
const phoneBarFocusRing = `${toRem(2)} solid ${color.Primary.Main}`;
export const PhoneBarTitle = style([
  { flexGrow: 1, minWidth: 0, maxWidth: '100%', display: 'flex', alignItems: 'center' },
  // A plain button: the text it holds, nothing of its own around it.
  { gap: config.space.S100, padding: 0, border: 0, background: 'none' },
  { color: 'inherit', font: 'inherit', textAlign: 'start', cursor: 'pointer' },
  {
    selectors: {
      // Square, so its corners take a finger too; rounded only for the focus ring.
      '&::after': { content: '""', position: 'absolute', inset: 0 },
      '&:disabled': { cursor: 'default' },
      '&:focus-visible': { outline: 'none' },
      '&:focus-visible::after': {
        borderRadius: config.radii.R300,
        outline: phoneBarFocusRing,
        outlineOffset: 0,
      },
    },
  },
]);

export const PhoneBarTitleText = style({ minWidth: 0, flexShrink: 1 });

// Says the title opens something; it keeps its place after a cut title.
export const PhoneBarChevron = style({ flexShrink: 0, opacity: 0.6 });

// The state (or the room), the tags and the status chips: the state gives way first, down to a
// short stub.
export const PhoneBarDetails = style([
  { display: 'flex', alignItems: 'center', gap: config.space.S200 },
  { minWidth: 0, whiteSpace: 'nowrap' },
]);

// The state and the tags: what the status chips leave (a zero basis, so the chips keep their width
// while this gives way), cut where it runs out.
export const PhoneBarSummary = style([
  { flex: '1 1 0', minWidth: 0, overflow: 'hidden' },
  { display: 'flex', alignItems: 'center', gap: config.space.S200 },
]);

// Auto-approval and an active permissions grant stay in view, above the title's reach. Only once
// the state and the tags are gone do they give way, cut rather than running under the room menu.
export const PhoneBarChips = style([
  { position: 'relative', zIndex: 1 },
  { display: 'inline-flex', alignItems: 'center', gap: config.space.S100 },
  { flexShrink: 1, minWidth: 0, overflow: 'hidden' },
  { selectors: { '&:empty': { display: 'none' } } },
]);
const cutToFit = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;
globalStyle(`${PhoneBarChips} > *`, { ...cutToFit, minWidth: 0, flexShrink: 1 });

export const PhoneBarStatus = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(3),
  minWidth: '3em',
  flex: '0 1 auto',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

export const PhoneBarResolvedIcon = style({ color: color.Success.Main });

export const PhoneBarScheduled = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(3),
  minWidth: 0,
});

// The tags' pastel would outshine the title on the dark bar, so they are toned down.
export const PhoneBarTags = style({
  display: 'flex',
  alignItems: 'center',
  gap: '0.3rem',
  minWidth: 0,
  flex: '0 1 auto',
  overflow: 'hidden',
  opacity: 0.85,
});

export const PhoneMenuHeader = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  paddingBlock: `${config.space.S300} ${config.space.S200}`,
  paddingInline: config.space.S300,
});

export const PhoneMenuHeaderTitle = style({
  margin: 0,
  fontWeight: config.fontWeight.W600,
  overflowWrap: 'anywhere',
});

export const PhoneMenuHeaderDetails = style({ margin: 0, overflowWrap: 'anywhere' });

// A thread menu's note that its last change failed.
export const MenuAlert = style({
  display: 'block',
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
});
