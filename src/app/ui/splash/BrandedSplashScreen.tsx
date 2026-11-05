import { type ReactNode, useMemo } from 'react';
import { Box, Spinner, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { SplashScreen } from './SplashScreen';

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
  /** The deployment's loading lines (`splash.loadingMessages` in the client config). */
  loadingMessages?: readonly string[];
  /** A fixed line, shown instead of a picked one. */
  message?: ReactNode;
  /** Where the pick gets its randomness; tests pass a fixed source. */
  random?: () => number;
};

/**
 * The branded splash while the app starts: the particle background with the app name, and in the
 * middle a spinner over one loading line. The line is `message` when there is one, else a line
 * picked from the deployment's `loadingMessages`, else the translated default. A pick stays while
 * its inputs keep their identity, so the line holds still while the splash is up.
 */
export function MindRoomSplashScreen({
  children,
  loadingMessages,
  message,
  random,
}: MindRoomSplashScreenProps) {
  const { t } = useTranslation();
  const line = useMemo<ReactNode>(() => {
    if (message !== undefined && message !== null) return message;
    const configured = loadingMessages?.some((entry) => entry.trim() !== '');
    return pickMindRoomSplashMessage(
      configured ? loadingMessages : [t('sharedUi.mindRoomSplashScreen.loading')],
      random
    );
  }, [loadingMessages, message, random, t]);

  return (
    <SplashScreen>
      <Box grow="Yes" direction="Column" justifyContent="Center" alignItems="Center" gap="400">
        <Spinner size="600" variant="Secondary" />
        <Text>{line}</Text>
        {children}
      </Box>
    </SplashScreen>
  );
}
