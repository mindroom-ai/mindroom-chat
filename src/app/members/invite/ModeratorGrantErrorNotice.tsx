import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAtom, useAtomValue } from 'jotai';
import { Box, Icon, IconButton, Icons, Text, color, toRem } from 'folds';
import { Surface } from '../../ui/glass/GlassPrimitives';
import { coverNoticeSlotAtom, pageNoticeSlotAtom } from '../../ui/noticeSlots';
import { PageSlot, noticeCard } from '../../ui/noticeSlots.css';
import { detachedGrantErrorAtom } from './moderatorInvite';

/** Non-blocking notices when dialog-submitted moderator grants fail after the dialog closed. */
export function ModeratorGrantErrorNotice() {
  const { t } = useTranslation();
  const [failures, setFailures] = useAtom(detachedGrantErrorAtom);
  const coverSlot = useAtomValue(coverNoticeSlotAtom);
  const pageSlot = useAtomValue(pageNoticeSlotAtom);
  const slot = coverSlot ?? pageSlot;

  if (failures.length === 0) return null;
  const cards = failures.map((failure) => (
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
        <Text size="T300" style={{ flexGrow: 1, minInlineSize: 0, overflowWrap: 'anywhere' }}>
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
  ));
  return slot ? (
    createPortal(cards, slot)
  ) : (
    <div className={PageSlot({ phone: false })}>{cards}</div>
  );
}
