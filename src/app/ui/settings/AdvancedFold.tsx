import { ReactNode, useEffect, useId, useState } from 'react';
import { Box, Button, Icon, Icons, Text, config } from 'folds';
import { useTranslation } from 'react-i18next';
import { getSettingDefinition } from '../../preferences/settingsRegistry';
import { useSettingsTarget } from '../../preferences/settingsTarget';
import { LoneTouchTarget } from '../styles/TouchTarget.css';

// The button's own 8 px and these 8 px make the 16 px of the section headings.
const FOLD_ROW_STYLE = { paddingInlineStart: config.space.S200 };

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
      {/* The chevron starts where the section headings and the cards' rows do. */}
      <Box style={FOLD_ROW_STYLE}>
        <Button
          variant="Secondary"
          fill="None"
          size="300"
          radii="300"
          className={LoneTouchTarget}
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
