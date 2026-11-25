import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// Styles for GitHub-flavored Markdown task lists rendered from `<ul>` / `<li>`.

const CHECKMARK_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><path d="M2.25 6.25 4.85 8.85 9.75 3.4" fill="none" stroke="black" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>'
)}")`;

export const TaskList = style({
  listStyle: 'none',
  selectors: {
    // Doubled class outranks `CustomHtml.List`'s `paddingInlineStart` regardless of CSS bundle order.
    '&&': { paddingInlineStart: 0 },
    'li > &&': { marginBlock: 0, paddingInlineStart: toRem(22) },
  },
});

export const TaskListItem = style({
  listStyle: 'none',
  display: 'flex',
  alignItems: 'flex-start',
  gap: config.space.S200,
});

export const TaskItemBody = style({ minWidth: 0, flex: 1 });

// Nested lists inside a task item live under TaskItemBody rather than directly under `<li>`.
globalStyle(`${TaskItemBody} > ul, ${TaskItemBody} > ol`, { marginBlock: 0 });

export const TaskCheckbox = style({
  appearance: 'none',
  WebkitAppearance: 'none',
  flexShrink: 0,
  display: 'inline-grid',
  placeItems: 'center',
  width: toRem(16),
  height: toRem(16),
  margin: 0,
  marginBlockStart: '0.2em',
  border: `${config.borderWidth.B400} solid color-mix(in srgb, ${color.Surface.OnContainer} 60%, ${color.SurfaceVariant.ContainerLine})`,
  borderRadius: config.radii.R300,
  backgroundColor: `color-mix(in srgb, ${color.SurfaceVariant.Container} 60%, transparent)`,
  cursor: 'default',
  opacity: 1,
  selectors: {
    '&:checked': { backgroundColor: color.Primary.Main, borderColor: color.Primary.Main },
    '&:checked::after': {
      content: '""',
      width: toRem(11),
      height: toRem(11),
      backgroundColor: color.Primary.OnMain,
      mask: `${CHECKMARK_MASK} center / contain no-repeat`,
      WebkitMask: `${CHECKMARK_MASK} center / contain no-repeat`,
    },
  },
});
