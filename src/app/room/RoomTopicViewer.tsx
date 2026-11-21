import { type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
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
import { Header, IconButton, Modal } from '../ui/glass/GlassPrimitives';
import { PageScroll } from '../ui/page/PageScroll';
import { headerDismissTrap } from '../ui/useHeaderPopup';
import { TOPIC_TEXT_STYLE } from '../ui/styles/topicText';

type RoomTopicViewerProps = {
  name: string;
  topic: string;
  requestClose: (dismissed?: boolean) => void;
};

const VIEWER_STYLE: CSSProperties = {
  display: 'flex',
  width: `min(calc(100vw - 2 * ${config.space.S400}), ${toRem(440)})`,
  maxHeight: `calc(100dvh - 2 * ${config.space.S400})`,
};
const TOPIC_STYLE: CSSProperties = {
  margin: 0,
  padding: `${config.space.S200} ${config.space.S400} ${config.space.S400}`,
  ...TOPIC_TEXT_STYLE,
};

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
      <IconButton aria-label={closeLabel} onClick={() => requestClose(true)} radii="300" size="300">
        <Icon src={Icons.Cross} size="100" />
      </IconButton>
    </Header>
  );

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap focusTrapOptions={headerDismissTrap(requestClose)}>
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
