import { globalStyle, style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { color, config, toRem } from 'folds';

// Styles for message HTML (`org.matrix.custom.html`) as the custom HTML parser renders it.






    '&:last-child': { marginBottom: 0 },
  },
});

export const Paragraph = style([MarginSpaced]);

export const Heading = style([
  MarginSpaced,
  {
    marginTop: config.space.S300,


















  },
]);

const codeFont = "'JetBrains Mono', 'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace";

export const Code = style({





  fontFamily: codeFont,
  fontSize: '0.9em',
  whiteSpace: 'pre-wrap',















  },
]);

/** A code block inside a message bubble, which has its own padding. */
export const MessageCodeBlock = style({
  width: '100%',
});

export const CodeBlockHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: config.space.S200,
  padding: `${config.space.S100} ${config.space.S200}`,
  borderBottom: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

export const CodeBlockLabel = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  minWidth: 0,
});

export const CodeBlockLabelText = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontFamily: codeFont,
  fontSize: toRem(12),
  opacity: 0.8,
});

export const CodeBlockLanguageIcon = style({



});

export const CodeBlockActions = style({
  display: 'flex',



});

export const CodeBlockAction = style({



});

export const CodeBlockActionIcon = style({
  width: toRem(16),
  height: toRem(16),
});

export const CodeBlockScroll = style({
  overflow: 'auto',
  maxHeight: toRem(480),
});




  fontFamily: codeFont,
  fontSize: toRem(13),
  lineHeight: 1.5,
  whiteSpace: 'pre',
  tabSize: 4,
});





  marginTop: `calc(-1 * ${toRem(24)})`,
  pointerEvents: 'none',
  background: `linear-gradient(transparent, ${color.SurfaceVariant.Container})`,
});

export const Mention = recipe({
  base: {
    display: 'inline',






    textDecoration: 'none',













      },
    },
  },
});








    selectors: {
      '& *': { visibility: 'hidden' },
    },
  },
  variants: {
    active: {
      true: {
        color: 'inherit',
        cursor: 'auto',
        selectors: {
          '& *': { visibility: 'visible' },
        },
      },
    },
  },
});

export const EmoticonBase = style({









    height: '1.25em',
    minWidth: '1.25em',
    fontSize: '1.33em',
    lineHeight: 1,
    verticalAlign: '-0.3em',
  },
  variants: {
    jumbo: {
      true: {
        fontSize: '2.5em',
      },
    },
  },
});

export const highlightText = style({



});

export const Table = style([
  MarginSpaced,
  {
    borderCollapse: 'collapse',
  },
]);

globalStyle(`${Table} th, ${Table} td`, {
  padding: `${config.space.S100} ${config.space.S200}`,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  textAlign: 'start',
});

globalStyle(`${Table} th`, {
  fontWeight: config.fontWeight.W600,
  backgroundColor: color.SurfaceVariant.Container,
});
