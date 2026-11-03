import React, { ReactNode } from 'react';
import { Box, Text } from 'folds';

type SettingTileProps = {
  title?: ReactNode;
  description?: ReactNode;
  /** Leading icon or avatar. */
  before?: ReactNode;
  /** Trailing control: a switch, button, or select. */
  after?: ReactNode;
  /** Extra content under the description. */
  children?: ReactNode;
  /** Lets settings search scroll to this tile. */
  focusId?: string;
};

/** One setting: title and description with an optional control beside them. */
export function SettingTile({
  title,
  description,
  before,
  after,
  children,
  focusId,
}: SettingTileProps) {
  return (
    <Box alignItems="Center" gap="300" id={focusId}>
      {before && <Box shrink="No">{before}</Box>}
      <Box grow="Yes" direction="Column" gap="100" style={{ minWidth: 0 }}>
        {title && <Text size="T300">{title}</Text>}











