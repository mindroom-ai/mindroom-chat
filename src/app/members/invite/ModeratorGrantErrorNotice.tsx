import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAtom, useAtomValue } from 'jotai';
import { Box, Icon, IconButton, Icons, Text, color, toRem } from 'folds';
import { Surface } from '../../ui/glass/GlassPrimitives';
import { coverNoticeSlotAtom, pageNoticeSlotAtom } from '../../ui/noticeSlots';
import { PageSlot, noticeCard } from '../../ui/noticeSlots.css';
import { detachedGrantErrorAtom } from './moderatorInvite';

/** Non-blocking notice when a dialog-submitted moderator grant fails after the dialog closed. */
export function ModeratorGrantErrorNotice() {
  const { t } = useTranslation();
  const [failure, setFailure] = useAtom(detachedGrantErrorAtom);
  const coverSlot = useAtomValue(coverNoticeSlotAtom);
  const pageSlot = useAtomValue(pageNoticeSlotAtom);
  const slot = coverSlot ?? pageSlot;

  if (!failure) return null;
  // `data-cover-notice`: it moves into what covers the page (sidebar/PhoneNavDrawer.tsx).
  const card = (
    <Surface
      variant="Critical"
      role="alert"
      data-cover-notice=""
      style={{ ...noticeCard, maxInlineSize: toRem(440), flexShrink: 0 }}
    >
      <Box alignItems="Center" gap="200">
        <Icon
          size="200"
          src={Icons.Warning}
          style={{ color: color.Critical.Main, flexShrink: 0 }}
        />
        <Text size="T300" style={{ flexGrow: 1, minInlineSize: 0, overflowWrap: 'anywhere' }}>
          {failure.message}
        </Text>
        <IconButton
          size="300"
          radii="300"
          variant="Critical"
          fill="None"
          aria-label={t('mindroomUi.notices.dismiss')}
          onClick={() => setFailure(undefined)}
        >
          <Icon size="100" src={Icons.Cross} />
        </IconButton>
      </Box>
    </Surface>
  );
  return slot ? createPortal(card, slot) : <div className={PageSlot({ phone: false })}>{card}</div>;
}
