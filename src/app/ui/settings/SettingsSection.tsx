import { ReactNode } from 'react';
import { Box, Text } from 'folds';
import { SettingsCard } from './SettingsCard';

type SettingsSectionProps = {
  /** The heading over the card; a card in an Advanced fold may go without. */
  title?: string;
  children: ReactNode;
};

/** A titled card of setting tiles, the unit every settings page is built from. */
export function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <Box direction="Column" gap="100">
      {title && (
        <Text size="L400" data-settings-heading="">
          {title}
        </Text>
      )}
      <SettingsCard>{children}</SettingsCard>
    </Box>
  );
}
