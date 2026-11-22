import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAtom, useAtomValue } from 'jotai';
import { Box, Icon, IconButton, Icons, Text, color, config, toRem } from 'folds';
import { Surface } from '../../ui/glass/GlassPrimitives';
import { coverNoticeSlotAtom, pageNoticeSlotAtom } from '../../ui/noticeSlots';
import { PageSlot, noticeCard } from '../../ui/noticeSlots.css';
import { detachedGrantErrorAtom } from './moderatorInvite';

/**
 * A non-blocking notice when a moderator grant submitted from the invite dialog fails after the
 * dialog closed. Failures queue: one shows at a time, and dismissing it shows the next, so a row
 * of them never crowds what the notice sits in (a short dialog, say).
 */
export function ModeratorGrantErrorNotice() {
  const { t } = useTranslation();
  const [failures, setFailures] = useAtom(detachedGrantErrorAtom);
  const coverSlot = useAtomValue(coverNoticeSlotAtom);
  const pageSlot = useAtomValue(pageNoticeSlotAtom);
  const slot = coverSlot ?? pageSlot;

  const failure = failures[0];
  if (!failure) return null;
  const card = (
    <Surface
      key={failure.id}
      variant="Critical"
      role="alert"
      style={{ ...noticeCard, maxInlineSize: toRem(440), flexShrink: 0 }}
    >
      <Box alignItems="Center" gap="200">
        <Icon
          size="200"
          src={Icons.Warning}
          style={{ color: color.Critical.Main, flexShrink: 0 }}
        />
        <Text
          size="T300"
          style={{
            flexGrow: 1,
            minInlineSize: 0,
            overflowWrap: 'anywhere',
            // Three lines at most, the rest by scrolling: a long error keeps the card low.
            maxBlockSize: `calc(3 * ${config.lineHeight.T300})`,
            overflowY: 'auto',
            overscrollBehavior: 'contain',
          }}
        >
          {failure.message}
        </Text>
        <IconButton
          size="300"
          radii="300"
          variant="Critical"
          fill="None"
          aria-label={t('mindroomUi.notices.dismiss')}
          onClick={() => setFailures((current) => current.filter((item) => item.id !== failure.id))}
        >
          <Icon size="100" src={Icons.Cross} />
        </IconButton>
      </Box>
    </Surface>
  );
  return slot ? createPortal(card, slot) : <div className={PageSlot({ phone: false })}>{card}</div>;
}
