import { ReactNode, useId, useState } from 'react';
import { Box, Button, Icon, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';

type AdvancedFoldProps = {
  children: ReactNode;
};

/**
 * The closed "Advanced" fold at the bottom of a settings page, for the settings the registry
 * marks `advanced`; the button opens and closes it.
 */
export function AdvancedFold({ children }: AdvancedFoldProps) {
  const { t } = useTranslation();
  const contentId = useId();
  const [open, setOpen] = useState(false);

  return (
    <Box direction="Column" gap="300">
      <Box>
        <Button
          variant="Secondary"
          fill="None"
          size="300"
          radii="300"
          aria-expanded={open}
          aria-controls={contentId}
          before={
            <Icon
              size="100"
              src={open ? Icons.ChevronBottom : Icons.ChevronRight}
              data-directional={open ? undefined : true}
            />
          }
          onClick={() => setOpen((shown) => !shown)}
        >
          <Text size="B300">{t('featureUi.settings.advanced')}</Text>
        </Button>
      </Box>
      {open && (
        <Box id={contentId} direction="Column" gap="700">
          {children}
        </Box>
      )}
    </Box>
  );
}
