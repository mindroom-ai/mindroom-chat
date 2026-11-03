import React, { ComponentProps } from 'react';
import classNames from 'classnames';
import { Box, ContainerColor as ContainerColorName, as } from 'folds';
import { ContainerColor } from '../../styles/ContainerColor.css';
import * as css from './SequenceCard.css';

type BoxLayoutProps = Pick<
  ComponentProps<typeof Box>,
  'direction' | 'gap' | 'alignItems' | 'justifyContent' | 'grow' | 'shrink' | 'wrap'
>;

type SequenceCardProps = BoxLayoutProps & {
  variant?: ContainerColorName;
  outlined?: boolean;
};

/** A settings card; consecutive cards read as one rounded group. */
export const SequenceCard = as<'div', SequenceCardProps>(
  ({ as: AsCard = 'div', className, variant = 'SurfaceVariant', outlined, ...props }, ref) => (
    <Box
      as={AsCard}
      className={classNames(ContainerColor({ variant }), css.SequenceCard({ outlined }), className)}
      {...props}
      ref={ref}
    />
  )
);
