import { type ReactNode, useMemo } from 'react';
import { Box, Spinner, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { SplashScreen } from './SplashScreen';
import { ParticleTextBackdrop } from '../particle-background/ParticleTextBackdrop.css';
import { useLoadedOrCachedClientConfig } from '../../config/ClientConfigLoader';
import { deploymentBranding } from '../branding/deploymentBranding';

/** The loading line when there is no other line with text in it. */
export const DEFAULT_MINDROOM_SPLASH_MESSAGES = ['Loading MindRoom Chat'] as const;

/**
 * One loading line, picked with `random`: from the trimmed `messages` that keep some text, or from
 * the default when none does. A `random` of exactly 1 picks the last line, as 0 picks the first.
 */
export const pickMindRoomSplashMessage = (
  messages: readonly string[] | undefined,
  random: () => number = Math.random
): string => {
  const written = (messages ?? []).map((line) => line.trim()).filter(Boolean);
  const lines: readonly string[] = written.length > 0 ? written : DEFAULT_MINDROOM_SPLASH_MESSAGES;
  const slot = Math.floor(random() * lines.length);
  // A source outside [0, 1] would point past an end of the list; stay on it.
  const index = slot > 0 ? Math.min(slot, lines.length - 1) : 0;
  return lines[index] ?? DEFAULT_MINDROOM_SPLASH_MESSAGES[0];
};

type MindRoomSplashScreenProps = {
  /** Shown under the loading line, in the same centred column. */
  children?: ReactNode;
  /** The deployment's loading lines (`splash.loadingMessages`); the configuration's without. */
  loadingMessages?: readonly string[];
  /** A fixed line, shown instead of a picked one. */
  message?: ReactNode;
  /** Where the pick gets its randomness; tests pass a fixed source. */
  random?: () => number;
};

/**
 * The branded splash while the app starts: the particle background with the app name, and in the
 * middle a spinner over one loading line. The line is `message` when there is one, else a line
 * picked from the loading lines of the configuration (or of the last one this browser loaded),
 * else the translated default with the deployment's name. Before any configuration has loaded the
 * name is unknown, and only the spinner shows. A pick stays while its inputs keep their identity,
 * so the line holds still while the splash is up.
 */
export function MindRoomSplashScreen({
  children,
  loadingMessages,
  message,
  random,
}: MindRoomSplashScreenProps) {
  const { t } = useTranslation();
  const config = useLoadedOrCachedClientConfig();
  const lines = loadingMessages ?? config?.splash?.loadingMessages;
  const name = config && deploymentBranding(config).title;
  const line = useMemo<ReactNode>(() => {
    if (message !== undefined && message !== null) return message;
    if (lines?.some((entry) => entry.trim() !== ''))
      return pickMindRoomSplashMessage(lines, random);
    return name && t('sharedUi.mindRoomSplashScreen.loading', { appName: name });
  }, [lines, message, name, random, t]);

  return (
    <SplashScreen>
      <Box grow="Yes" direction="Column" justifyContent="Center" alignItems="Center" gap="400">
        <Spinner size="600" variant="Secondary" />
        {line !== undefined && line !== null && (
          <Text className={ParticleTextBackdrop}>{line}</Text>
        )}
        {children}
      </Box>
    </SplashScreen>
  );
}
