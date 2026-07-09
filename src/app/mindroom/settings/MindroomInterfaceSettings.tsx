import React, { useState } from 'react';
import { Box, Switch, Text } from 'folds';
import { SequenceCard } from '../../components/sequence-card';
import { SettingTile } from '../../components/setting-tile';
import {
  useMindroomAccountSettings,
  useSetMindroomAccountSettings,
} from './useMindroomAccountSettings';

type MindroomInterfaceSettingsProps = {
  className?: string;
};

/**
 * The "Interface" group at the top of Settings → General. Hosts the Simple
 * Mode switch backed by `io.mindroom.settings` account data. This group must
 * stay visible while simple mode is ON — it is the way back out.
 */
export function MindroomInterfaceSettings({ className }: MindroomInterfaceSettingsProps) {
  const { simpleMode } = useMindroomAccountSettings();
  const setAccountSettings = useSetMindroomAccountSettings();
  // setAccountData only resolves once the change echoes back over sync, so
  // show the requested value immediately and hand back to the store when the
  // write settles (echo arrived, or failed and the stored value still rules).
  const [pending, setPending] = useState<boolean>();

  const handleSimpleMode = (next: boolean) => {
    setPending(next);
    setAccountSettings({ simpleMode: next })
      .catch(() => undefined)
      .finally(() => setPending(undefined));
  };

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Interface</Text>
      <SequenceCard className={className} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Simple Mode"
          description="Hide advanced features like spaces, the command palette and thread filters. Synced across your devices."
          after={
            <Switch variant="Primary" value={pending ?? simpleMode} onChange={handleSimpleMode} />
          }
        />
      </SequenceCard>
    </Box>
  );
}
