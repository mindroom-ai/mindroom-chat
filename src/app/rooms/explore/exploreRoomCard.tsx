import type { Ref } from 'react';
import { Box, Button, Text, config } from 'folds';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../ui/glass/GlassPrimitives';

type ExploreTopicProps = {
  name: string;
  topic: string;
  close: () => void;
  ref?: Ref<HTMLDivElement>;
};

// The card's focus trap holds the dialog by this ref: without it, Escape and a press outside
// would not close the topic.
function ExploreTopic({ name, topic, close, ref }: ExploreTopicProps) {
  const { t } = useTranslation();
  return (
    <Dialog ref={ref} role="dialog" aria-label={name}>
      <Box direction="Column" gap="300" style={{ padding: config.space.S400 }}>
        <Text size="T300">{topic}</Text>
        <Button onClick={close}>{t('sharedUi.textViewer.close')}</Button>
      </Box>
    </Dialog>
  );
}

/** The room card's full topic in the dialog opened by the card. */
export const renderTopicText = (name: string, topic: string, close: () => void) => (
  <ExploreTopic name={name} topic={topic} close={close} />
);
