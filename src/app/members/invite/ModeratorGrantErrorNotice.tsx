import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAtom, useAtomValue } from 'jotai';
import { Box, Icon, IconButton, Icons, Text, color, config, toRem } from 'folds';
import { Surface } from '../../ui/glass/GlassPrimitives';
import { coverNoticeSlotAtom, pageNoticeSlotAtom } from '../../ui/noticeSlots';
import { PageSlot } from '../../ui/noticeSlots.css';
import { detachedGrantErrorAtom } from './moderatorInvite';

const SHOWN_MS = 12_000;

/** Non-blocking notice when a dialog-submitted moderator grant fails after the dialog closed. */
export function ModeratorGrantErrorNotice() {
  const { t } = useTranslation();
  const [failure, setFailure] = useAtom(detachedGrantErrorAtom);
  const slot = useAtomValue(coverNoticeSlotAtom) ?? useAtomValue(pageNoticeSlotAtom);

  useEffect(() => {
    if (!failure) return undefined;
    const timer = window.setTimeout(
      () => setFailure((cur) => (cur?.id === failure.id ? undefined : cur)),
      SHOWN_MS
    );
    return () => window.clearTimeout(timer);
  }, [failure, setFailure]);

  if (!failure) return null;
  const card = (
    <Surface
      variant="Critical"
      role="alert"
      style={{
        padding: config.space.S300,
        borderRadius: config.radii.R500,
        pointerEvents: 'auto',
        maxInlineSize: toRem(440),
        flexShrink: 0,
      }}
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
