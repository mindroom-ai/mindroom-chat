import classNames from 'classnames';
import { as } from 'folds';
import React from 'react';
import { useLiquidGlass } from '../glass/liquid/useLiquidGlass';
import * as css from './Sidebar.css';

export const Sidebar = as<'div'>(({ as: AsSidebar = 'div', className, ...props }, ref) => {
  const glassRef = useLiquidGlass(ref);
  return <AsSidebar className={classNames(css.Sidebar, className)} {...props} ref={glassRef} />;
});
