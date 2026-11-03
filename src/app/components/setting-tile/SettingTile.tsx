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

/** A leading or trailing slot that keeps its content at natural size; empty slots vanish. */
function FixedSlot({ children }: { children?: ReactNode }) {
  return children ? <Box shrink="No">{children}</Box> : null;
}

/** One setting: title and description with an optional control beside them. */
export function SettingTile(props: SettingTileProps) {
  const { focusId, before, after, title, description, children } = props;
  const descriptionText = description ? (
    <Text priority="300" size="T200">
      {description}
    </Text>
  ) : null;

  return (
    <Box id={focusId} gap="300" alignItems="Center">
      <FixedSlot>{before}</FixedSlot>
      <Box style={{ minWidth: 0 }} gap="100" direction="Column" grow="Yes">
        {title ? <Text size="T300">{title}</Text> : null}
        {descriptionText}
        {children}
      </Box>
      <FixedSlot>{after}</FixedSlot>
    </Box>
  );
}
