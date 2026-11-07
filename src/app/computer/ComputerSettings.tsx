import { ChangeEvent, useState } from 'react';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Box, Button, Input, Text, color } from 'folds';
import { SequenceCard } from '../ui/SequenceCard';
import { SettingTile } from '../ui/SettingTile';
import { useClientConfig } from '../config/useClientConfig';
import { resolveComputerApiUrl } from './api';
import { computerServicePreferenceAtom } from './computerServiceSettings';
import { useAgentServerUrls } from './useAgentServers';

type Feedback = 'saved' | 'invalid' | 'storageFailed';

/** A save is confirmed politely; a rejected address or a failed write is an alert. */
const FEEDBACK = {
  saved: { role: 'status', textKey: 'settings.general.computers.saved' },
  invalid: { role: 'alert', textKey: 'settings.general.computers.invalidUrl' },
  storageFailed: { role: 'alert', textKey: 'settings.general.computers.saveFailed' },
} as const satisfies Record<Feedback, { role: 'status' | 'alert'; textKey: string }>;

const isPlainHttp = (value: string): boolean =>
  resolveComputerApiUrl(value)?.startsWith('http:') ?? false;

/**
 * Settings → General → Computers: which MindRoom server this device uses for agents' computers
 * (and Connections). It follows the deployment, or the server the room agents publish, until
 * the user saves an origin here; an empty value turns computers off on this device.
 */
export function ComputerSettings({ className }: { className?: string }) {
  const { t } = useTranslation();
  const deploymentUrl = useClientConfig().mindroom?.computers?.apiUrl || undefined;
  const discoveredUrls = useAgentServerUrls();
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

  // Stores the preference on this device; on failure the alert says so and nothing changes.
  const persist = (next: string | null): boolean => {
    const stored = setPreference(next);
    if (!stored) setFeedback('storageFailed');
    return stored;
  };

  const save = () => {
    const origin = draft.trim() === '' ? '' : resolveComputerApiUrl(draft);
    if (origin === undefined) {
      setFeedback('invalid');
    } else if (persist(origin)) {
      setDraft(origin);
      setFeedback('saved');
    }
  };

  const followDefault = () => {
    if (!persist(null)) return;
    setFeedback(undefined);
    setDraft(deploymentUrl ?? '');
  };

  const fieldLabel = t('settings.general.computers.apiUrl');
  const shownFeedback = feedback && FEEDBACK[feedback];

  return (
    <Box gap="100" direction="Column">
      <Text size="L400" data-settings-heading="">
        {t('settings.general.computers.sectionTitle')}
      </Text>
      <SequenceCard direction="Column" gap="400" variant="SurfaceVariant" className={className}>
        <SettingTile
          focusId="computerServer"
          title={fieldLabel}
          description={t('settings.general.computers.description')}
        >
          <Box gap="200" direction="Column">
            <Input
              aria-label={fieldLabel}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder={placeholder}
              value={draft}
              onChange={handleChange}
              variant="Background"
              size="400"
              radii="300"
            />
            <Box wrap="Wrap" gap="200">
              <Button onClick={save} variant="Primary" fill="Soft" size="300" radii="300">
                <Text size="B300">{t('settings.general.computers.save')}</Text>
              </Button>
              <Button
                onClick={followDefault}
                variant="Secondary"
                fill="Soft"
                size="300"
                radii="300"
              >
                <Text size="B300">{t('settings.general.computers.reset')}</Text>
              </Button>
            </Box>
            {isPlainHttp(draft) && (
              <Text size="T200" role="note">
                {t('settings.general.computers.httpNotice')}
              </Text>
            )}
            {shownFeedback && (
              <Text
                size="T200"
                role={shownFeedback.role}
                style={shownFeedback.role === 'alert' ? { color: color.Critical.Main } : undefined}
              >
                {t(shownFeedback.textKey)}
              </Text>
            )}
          </Box>
        </SettingTile>
      </SequenceCard>
    </Box>
  );
}
