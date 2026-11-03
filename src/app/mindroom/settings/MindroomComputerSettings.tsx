import React, { ChangeEvent, useState } from 'react';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Box, Button, Input, Text, color } from 'folds';
import { SequenceCard } from '../../components/sequence-card';
import { SettingTile } from '../../components/setting-tile';
import { useClientConfig } from '../../hooks/useClientConfig';
import { resolveComputerApiUrl } from '../computer/api';
import { computerServicePreferenceAtom } from '../computer/computerServiceSettings';
import { useMindroomServerUrls } from '../server/useMindroomServers';

type Feedback = 'saved' | 'invalid' | 'storageFailed';

const isPlainHttp = (value: string): boolean =>
  resolveComputerApiUrl(value)?.startsWith('http:') ?? false;

/**
 * Settings → General → Computers: which MindRoom server this device uses for agents' computers
 * (and Connections). It follows the deployment, or the server the room agents publish, until
 * the user saves an origin here; an empty value turns computers off on this device.
 */
export function MindroomComputerSettings({ className }: { className?: string }) {
  const { t } = useTranslation();
  const deploymentUrl = useClientConfig().mindroom?.computers?.apiUrl || undefined;
  const discoveredUrls = useMindroomServerUrls();
  const [preference, setPreference] = useAtom(computerServicePreferenceAtom);
  const shownValue = preference ?? deploymentUrl ?? '';
  const [draft, setDraft] = useState(shownValue);
  const [feedback, setFeedback] = useState<Feedback>();

  // While nothing is set, the server found from the agents is what a blank field means.
  const placeholder =
    preference === null && !deploymentUrl && discoveredUrls.length > 0
      ? discoveredUrls[0]
      : undefined;

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setDraft(event.currentTarget.value);
    setFeedback(undefined);
  };

  const save = () => {
    const blank = draft.trim() === '';
    const origin = blank ? '' : resolveComputerApiUrl(draft);
    if (origin === undefined) {
      setFeedback('invalid');
      return;
    }
    if (!setPreference(origin)) {
      setFeedback('storageFailed');
      return;
    }
    setDraft(origin);
    setFeedback('saved');
  };

  const followDefault = () => {
    if (!setPreference(null)) {
      setFeedback('storageFailed');
      return;
    }
    setDraft(deploymentUrl ?? '');
    setFeedback(undefined);
  };

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{t('settings.general.computers.sectionTitle')}</Text>
      <SequenceCard className={className} variant="SurfaceVariant" direction="Column" gap="400">
        <SettingTile
          title={t('settings.general.computers.apiUrl')}
          description={t('settings.general.computers.description')}
        >
          <Box direction="Column" gap="200">
            <Input
              size="400"
              variant="Background"
              radii="300"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              aria-label={t('settings.general.computers.apiUrl')}
              value={draft}
              placeholder={placeholder}
              onChange={handleChange}
            />
            <Box gap="200" wrap="Wrap">
              <Button size="300" variant="Primary" fill="Soft" radii="300" onClick={save}>
                <Text size="B300">{t('settings.general.computers.save')}</Text>
              </Button>
              <Button
                size="300"
                variant="Secondary"
                fill="Soft"
                radii="300"
                onClick={followDefault}
              >
                <Text size="B300">{t('settings.general.computers.reset')}</Text>
              </Button>
            </Box>
            {isPlainHttp(draft) && (
              <Text size="T200" role="note">
                {t('settings.general.computers.httpNotice')}
              </Text>
            )}
            {feedback === 'saved' && (
              <Text size="T200" role="status">
                {t('settings.general.computers.saved')}
              </Text>
            )}
            {(feedback === 'invalid' || feedback === 'storageFailed') && (
              <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
                {feedback === 'invalid'
                  ? t('settings.general.computers.invalidUrl')
                  : t('settings.general.computers.saveFailed')}
              </Text>
            )}
          </Box>
        </SettingTile>
      </SequenceCard>
    </Box>
  );
}
