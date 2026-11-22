import { useId } from 'react';
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
  const messageId = useId();
  const [failures, setFailures] = useAtom(detachedGrantErrorAtom);
  const coverSlot = useAtomValue(coverNoticeSlotAtom);
  const pageSlot = useAtomValue(pageNoticeSlotAtom);
  const slot = coverSlot ?? pageSlot;

  const failure = failures[0];
  if (!failure) return null;
  // One card for the whole queue: a dismissal changes its message and leaves the card, and the
  // Dismiss button that has the focus, in place.
  const card = (
    <Surface
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
          // A new message starts at its first line.
          key={failure.id}
          id={messageId}
          size="T300"
          // Focusable, so the keyboard can scroll a long message where the browser does not make
          // a scrolling box focusable itself (Safari). Its own text is the region's name.
          role="region"
          aria-labelledby={messageId}
          tabIndex={0}
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
