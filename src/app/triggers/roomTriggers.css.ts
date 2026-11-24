import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import * as schedCss from '../schedules/roomSchedules.css';

const neutral = {
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
} as const;
const cardPad = { display: 'flex', minWidth: 0, paddingInline: config.space.S300 } as const;

export const TriggerCard = style({
  selectors: {
    '&[data-highlighted="true"]': {
      borderColor: color.Primary.Main,
      backgroundColor: `color-mix(in srgb, ${color.Primary.Container} 45%, transparent)`,
    },
    '&:focus-visible': { outline: `2px solid ${color.Primary.Main}`, outlineOffset: toRem(2) },
  },
});

export const CardHeader = style({
  ...cardPad,
  alignItems: 'flex-start',
  gap: config.space.S300,
  paddingBlock: `${config.space.S300} ${config.space.S200}`,
  color: color.Surface.OnContainer,
});

export const CardBody = style({
  ...cardPad,
  flexDirection: 'column',
  gap: config.space.S200,
  paddingBlockEnd: config.space.S300,
});

export const IconTileNeutral = style([schedCss.IconTile.primary, neutral]);
export const StatusPillNeutral = style([
  schedCss.StatusPill.success,
  { ...neutral, borderColor: color.SurfaceVariant.ContainerLine },
]);
