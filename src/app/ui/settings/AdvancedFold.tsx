import { ReactNode, useEffect, useId, useState } from 'react';
import { Box, Button, Icon, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { getSettingDefinition } from '../../preferences/settingsRegistry';
import { useSettingsTarget } from '../../preferences/settingsTarget';

type AdvancedFoldProps = {
  children: ReactNode;
};

/**
 * The closed "Advanced" fold at the bottom of a settings page, for the settings the registry
 * marks `advanced`; the button opens and closes it. A search result inside it opens it.
 */
export function AdvancedFold({ children }: AdvancedFoldProps) {
  const { t } = useTranslation();
  const contentId = useId();
  // Only the target's page is open, so an advanced target is in this fold.
  const target = useSettingsTarget();
  const targetInside = !!target && !!getSettingDefinition(target.id)?.advanced;
  const [open, setOpen] = useState(targetInside);

  useEffect(() => {
    if (targetInside) setOpen(true);
  }, [target, targetInside]);

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
