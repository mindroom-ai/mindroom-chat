import { ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Icon, Icons, Text, config } from 'folds';
import { Dialog, Header, IconButton } from '../../ui/glass/GlassPrimitives';

type SecurityDialogProps = {
  title: string;
  onClose: () => void;
  /** `alertdialog` for a confirmation of something that cannot be undone. */
  role?: 'dialog' | 'alertdialog';
  children: ReactNode;
};

/** The frame every verification and key dialog shares: title, close button, padded column. */
export function SecurityDialog({ title, onClose, role = 'dialog', children }: SecurityDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const bodyId = useId();
  const closeButton = (
    <IconButton
      onClick={onClose}
      aria-label={t('sharedUi.deviceVerification.close')}
      radii="300"
      size="300"
    >
      <Icon src={Icons.Cross} />
    </IconButton>
  );

  return (
    <Dialog
      role={role}
      aria-labelledby={titleId}
      // An alert dialog's warning is read with its title as it takes focus.
      aria-describedby={role === 'alertdialog' ? bodyId : undefined}
      aria-modal="true"
      variant="Surface"
    >
      <Header size="500" style={{ paddingInline: `${config.space.S400} ${config.space.S200}` }}>
        <Text as="h2" id={titleId} size="H4" style={{ flexGrow: 1, margin: 0 }}>
          {title}
        </Text>
        {closeButton}
      </Header>
      <Box id={bodyId} direction="Column" gap="400" style={{ padding: config.space.S400 }}>
        {children}
      </Box>
    </Dialog>
  );
}
