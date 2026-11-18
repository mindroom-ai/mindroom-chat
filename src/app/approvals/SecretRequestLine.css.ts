import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';
import { Panel } from '../ui/ThreadActivity.css';

/** A temporary secret's variable as its name, in code type as the agent's commands see it. */
export const Mono = style({ fontFamily: 'var(--font-mono)', fontWeight: 500 });

/** The request read-only, under its line. */
export const Card = style([
  Panel,
  {
    display: 'flex',
    flexDirection: 'column',
    gap: config.space.S200,
    padding: config.space.S300,
    color: color.SurfaceVariant.OnContainer,
  },
]);

/** The read-only card's header: lock, name, and the status chip at the end. */
export const Header = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  minWidth: 0,
});

export const HeaderName = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontWeight: config.fontWeight.W600,
});
