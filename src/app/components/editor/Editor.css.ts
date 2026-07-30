import { style } from '@vanilla-extract/css';
import { color, config, DefaultReset, toRem } from 'folds';
import { transition } from '../../styles/transition';

export const Editor = style([
  DefaultReset,
  {
    backgroundColor: color.SurfaceVariant.Container,
    color: color.SurfaceVariant.OnContainer,
    boxShadow: `inset 0 0 0 ${config.borderWidth.B300} ${color.SurfaceVariant.ContainerLine}`,
    borderRadius: config.radii.R400,
    overflow: 'hidden',
    transition: transition(['box-shadow']),

    selectors: {
      // Typing into the composer was the one interaction with no visual
      // acknowledgement at all: the caret appeared and the box stayed exactly
      // as it was. The ring is drawn inset rather than outset so it cannot be
      // clipped by an ancestor and cannot move anything, which matters because
      // the composer shares a column with a virtualized timeline.
      '&:focus-within': {
        boxShadow: `inset 0 0 0 ${config.borderWidth.B400} ${color.Primary.Main}`,
      },
    },
  },
]);

export const EditorOptions = style([
  DefaultReset,
  {
    padding: config.space.S200,
  },
]);

export const EditorTextareaScroll = style({});

export const EditorTextarea = style([
  DefaultReset,
  {
    flexGrow: 1,
    height: '100%',
    padding: `${toRem(13)} ${toRem(1)}`,
    selectors: {
      [`${EditorTextareaScroll}:first-child &`]: {
        paddingLeft: toRem(13),
      },
      [`${EditorTextareaScroll}:last-child &`]: {
        paddingRight: toRem(13),
      },
      '&:focus': {
        outline: 'none',
      },
    },
  },
]);

export const EditorPlaceholderContainer = style([
  DefaultReset,
  {
    opacity: config.opacity.Placeholder,
    pointerEvents: 'none',
    userSelect: 'none',
  },
]);

export const EditorPlaceholderTextVisual = style([
  DefaultReset,
  {
    display: 'block',
    paddingTop: toRem(13),
    paddingLeft: toRem(1),
  },
]);

export const EditorToolbarBase = style({
  padding: `0 ${config.borderWidth.B300}`,
});

export const EditorToolbar = style({
  padding: config.space.S100,
});

export const MarkdownBtnBox = style({
  paddingRight: config.space.S100,
});
