import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

export const RoomsInfoCard = style({
  padding: `${config.space.S500} ${config.space.S400}`,
});

export const PublicRoomsError = style({
  color: color.Critical.OnContainer,
  background: color.Critical.Container,
  border: `${config.borderWidth.B300} solid ${color.Critical.ContainerLine}`,
  borderRadius: config.radii.R400,
  padding: config.space.S400,
});
