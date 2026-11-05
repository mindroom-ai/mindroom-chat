import { type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import type { Options as FocusTrapOptions } from 'focus-trap';
import {
  Box,
  Icon,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
  config,
  toRem,
} from 'folds';
import { Header, IconButton, Modal } from '../../ui/glass/GlassPrimitives';
import { PageScroll } from '../../ui/page/PageScroll';
import { stopPropagation } from '../../lib/keyboard';

type RoomTopicViewerProps = {
  name: string;
  topic: string;
  requestClose: () => void;
};

const VIEWER_STYLE: CSSProperties = {
  display: 'flex',
  width: `min(calc(100vw - 2 * ${config.space.S400}), ${toRem(440)})`,
  maxHeight: `calc(100dvh - 2 * ${config.space.S400})`,
};
// Paragraphs and line breaks as the room's members wrote them; long links wrap.
const TOPIC_STYLE: CSSProperties = {
  margin: 0,
  padding: `${config.space.S200} ${config.space.S400} ${config.space.S400}`,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
};

// The viewer closes on Escape, which it keeps from the room behind it, or a click outside.
// Focus goes back to the topic line that opened it.
const dismissOnEscapeOrOutside = (onDismiss: () => void): FocusTrapOptions => ({
  initialFocus: false,
  returnFocusOnDeactivate: true,
  clickOutsideDeactivates: true,
  escapeDeactivates: stopPropagation,
  onDeactivate: onDismiss,
});

/**
 * The whole topic of a room, which its header shows on one line. A short topic gets a small
 * dialog; a long one scrolls beneath the room's name.
 */
export function RoomTopicViewer({ name, topic, requestClose }: RoomTopicViewerProps) {
  const { t } = useTranslation();
  const closeLabel = t('sharedUi.textViewer.close');
  const title = (
    <Header
      size="500"
      style={{ paddingBlock: 0, paddingInline: `${config.space.S400} ${config.space.S200}` }}
    >
      <Box grow="Yes" style={{ minWidth: 0 }}>
        <Text size="H4" truncate>
          {name}
        </Text>
      </Box>
      <IconButton aria-label={closeLabel} onClick={requestClose} radii="300" size="300">
        <Icon src={Icons.Cross} size="100" />
      </IconButton>
    </Header>
  );

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap focusTrapOptions={dismissOnEscapeOrOutside(requestClose)}>
          <Modal size="300" flexHeight role="dialog" aria-label={name} style={VIEWER_STYLE}>
            <PageScroll header={title}>
              <Text size="T300" priority="400" style={TOPIC_STYLE}>
                {topic}
              </Text>
            </PageScroll>
          </Modal>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
