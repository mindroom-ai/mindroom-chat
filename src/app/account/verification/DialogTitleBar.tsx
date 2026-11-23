import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, config } from 'folds';
import { DialogCloseButton } from '../../ui/DialogChrome';
import { Header } from '../../ui/glass/GlassPrimitives';

const TITLE_BAR_STYLE = {
  paddingBlock: 0,
  paddingInline: `${config.space.S400} ${config.space.S200}`,
};

type DialogTitleBarProps = {
  /** Without it the bar has no close button. */
  onClose?: () => void;
  /** The title, before the close button. */
  children?: ReactNode;
};

/** The title bar of a security dialog whose close button goes while closing would lose something. */
export function DialogTitleBar({ onClose, children }: DialogTitleBarProps) {
  const { t } = useTranslation();
  return (
    <Header size="500" style={TITLE_BAR_STYLE}>
      <Box grow="Yes">{children}</Box>
      {onClose && (
        <DialogCloseButton label={t('sharedUi.deviceVerification.close')} onClick={onClose} />
      )}
    </Header>
  );
}
