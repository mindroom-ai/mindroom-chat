import React from 'react';
import classNames from 'classnames';
import { Box, Text, as } from 'folds';
import { useGlassHighlight } from '../glass/liquid/useLiquidGlass';
import * as css from './UrlPreview.css';

/** A link preview card; the pointer highlight follows the cursor like other inline cards. */
export const UrlPreview = as<'div'>(({ className, ...props }, ref) => {
  const glassRef = useGlassHighlight<HTMLDivElement>(ref);
  return (



















  />
));
