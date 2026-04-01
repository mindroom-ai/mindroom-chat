import { style, globalStyle } from '@vanilla-extract/css';
import { config, color } from 'folds';

export const Banner = style({
  padding: `${config.space.S400} ${config.space.S400}`,
  backgroundColor: color.SurfaceVariant.Container,
  borderBottom: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

export const TitleRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S300,
  minHeight: '1.5rem',
});

export const TagsRow = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.3rem',
  flexWrap: 'nowrap',
  overflow: 'hidden',
});

export const SubtitleRow = style({
  marginTop: config.space.S100,
});

export const ResolveChip = style({
  marginLeft: 'auto',
  flexShrink: 0,
});

export const OverflowChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  fontSize: '0.65rem',
  fontWeight: 500,
  padding: '0.1rem 0.4rem',
  borderRadius: '0.5rem',
  background: 'rgba(128, 128, 128, 0.2)',
  cursor: 'default',
  border: 'none',
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
  verticalAlign: 'middle',
});

/* Show remove button on pill hover */
globalStyle('.thread-tag-pill:hover .thread-tag-pill-remove', {
  opacity: 1,
});

/**
 * Desktop: tags inline on title row (hidden below).
 * Mobile (<480px): tags hidden on title row, shown in a dedicated row below.
 */
export const DesktopOnlyTags = style({
  '@media': {
    '(max-width: 480px)': {
      display: 'none',
    },
  },
});

export const MobileOnlyTags = style({
  display: 'none',
  '@media': {
    '(max-width: 480px)': {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '0.3rem',
      marginTop: config.space.S100,
    },
  },
});

export const BannerDisabled = style({
  opacity: 0.6,
  pointerEvents: 'none',
});
