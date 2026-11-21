import { Box, Button, Text, config } from 'folds';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../ui/glass/GlassPrimitives';

function ExploreTopic({ name, topic, close }: { name: string; topic: string; close: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog role="dialog" aria-label={name}>
      <Box direction="Column" gap="300" style={{ padding: config.space.S400 }}>
        <Text size="T300">{topic}</Text>
        <Button onClick={close}>{t('featureUi.settings.emojisStickers.globalPacks.close')}</Button>
      </Box>
    </Dialog>
  );
}

/** The room card's full topic in the dialog opened by the card. */
export const renderTopicText = (name: string, topic: string, close: () => void) => (
  <ExploreTopic name={name} topic={topic} close={close} />
);
