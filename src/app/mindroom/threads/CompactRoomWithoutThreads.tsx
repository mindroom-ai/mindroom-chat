import type { CSSProperties } from 'react';
import { Box, Text, color, config } from 'folds';
import { useTranslation } from 'react-i18next';

// The look of the cards' own "No threads" box (CompactRoomView.css EmptyState), inline because
// the room timeline's unit tests load this file without the vanilla-extract transform.
const boxStyle: CSSProperties = {
  minHeight: '8rem',
  padding: config.space.S400,
  borderRadius: config.radii.R400,
  border: `${config.borderWidth.B300} dashed ${color.SurfaceVariant.ContainerLine}`,
  color: color.SurfaceVariant.OnContainer,
};

/**
 * The start of a Compact room that has no thread at all, where its cards would begin: the same
 * "No threads" box the cards show when a filter hides them all. It stands in for the room's
 * intro, whose name and topic the header above already shows.
 */
export function CompactRoomWithoutThreads() {
  const { t } = useTranslation();
  return (
    <div data-compact-room-without-threads="" style={{ paddingInline: config.space.S300 }}>
      <Box alignItems="Center" justifyContent="Center" style={boxStyle}>
        <Text size="T300" priority="300">
          {t('mindroomUi.threads.compactRoomView.noThreads')}
        </Text>
      </Box>
    </div>
  );
}
