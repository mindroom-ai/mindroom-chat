import { useTranslation } from 'react-i18next';
import { Box, color } from 'folds';
import { getEmojiByUnicode, SKIN_TONES, type SkinTone, withSkinTone } from '../../emoji';
import * as css from './styles.css';

const TONE_LABEL_KEYS = {
  0: 'sharedUi.emojiBoard.skinTones.default',
  1: 'sharedUi.emojiBoard.skinTones.light',
  2: 'sharedUi.emojiBoard.skinTones.mediumLight',
  3: 'sharedUi.emojiBoard.skinTones.medium',
  4: 'sharedUi.emojiBoard.skinTones.mediumDark',
  5: 'sharedUi.emojiBoard.skinTones.dark',
} as const satisfies Record<SkinTone, string>;

// A raised hand shows each tone, as person emoji take it.
const RAISED_HAND = '✋';

/** The raised hand in `tone`. */
const toneSample = (tone: SkinTone): string => {
  const hand = getEmojiByUnicode(RAISED_HAND);
  return hand ? withSkinTone(hand, tone).unicode : RAISED_HAND;
};

type SkinToneButtonProps = {
  tone: SkinTone;
  onPress: () => void;
};

/** The current tone as a raised hand; pressing it shows the tones in its place. */
export function SkinToneButton({ tone, onPress }: SkinToneButtonProps) {
  const { t } = useTranslation();
  const label = t('sharedUi.emojiBoard.skinTone');
  return (
    <button
      type="button"
      className={css.EmojiItem}
      title={`${label}: ${t(TONE_LABEL_KEYS[tone])}`}
      aria-label={label}
      onClick={onPress}
    >
      {toneSample(tone)}
    </button>
  );
}

type SkinToneOptionsProps = {
  tone: SkinTone;
  onChoose: (tone: SkinTone) => void;
};

/** The six tones in a row, the current one pressed and focused. */
export function SkinToneOptions({ tone, onChoose }: SkinToneOptionsProps) {
  const { t } = useTranslation();
  return (
    <Box role="group" aria-label={t('sharedUi.emojiBoard.skinTone')} grow="Yes">
      {SKIN_TONES.map((option) => (
        <button
          key={option}
          type="button"
          className={css.EmojiItem}
          title={t(TONE_LABEL_KEYS[option])}
          aria-label={t(TONE_LABEL_KEYS[option])}
          aria-pressed={option === tone}
          // The row replaces the button that opened it, so focus moves to the current tone.
          autoFocus={option === tone}
          style={
            option === tone ? { backgroundColor: color.SurfaceVariant.ContainerActive } : undefined
          }
          onClick={() => onChoose(option)}
        >
          {toneSample(option)}
        </button>
      ))}
    </Box>
  );
}
