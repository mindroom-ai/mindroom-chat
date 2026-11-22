import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAtom, useAtomValue } from 'jotai';
import { Box, Icon, IconButton, Icons, Text, color } from 'folds';
import { Surface } from '../../ui/glass/GlassPrimitives';
import { coverNoticeSlotAtom, pageNoticeSlotAtom } from '../../ui/noticeSlots';
import { PageSlot } from '../../ui/noticeSlots.css';
import { detachedGrantErrorAtom } from './moderatorInvite';
import * as css from '../MembersDrawer.css';

const SHOWN_MS = 12_000;

/**
 * Non-blocking notice for a moderator grant that failed after the Invite dialog had closed.
 * Renders in the app's existing notice slot (`ui/noticeSlots.tsx`) until dismissed or timed out.
 */
export function ModeratorGrantErrorNotice() {
  const { t } = useTranslation();
  const [failure, setFailure] = useAtom(detachedGrantErrorAtom);
  const coverSlot = useAtomValue(coverNoticeSlotAtom);
  const pageSlot = useAtomValue(pageNoticeSlotAtom);

  useEffect(() => {
    if (!failure) return undefined;
    const timer = window.setTimeout(
      () => setFailure((current) => (current?.id === failure.id ? undefined : current)),
      SHOWN_MS
    );
    return () => window.clearTimeout(timer);
  }, [failure, setFailure]);

  if (!failure) return null;
  const card = (
    <Surface className={css.GrantErrorNotice} variant="Critical" role="alert">
      <Box alignItems="Center" gap="200">
        <Icon size="200" src={Icons.Warning} style={{ color: color.Critical.Main, flexShrink: 0 }} />
        <Text size="T300" style={{ flexGrow: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
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

  const slot = coverSlot ?? pageSlot;
  return slot ? createPortal(card, slot) : <div className={PageSlot({ phone: false })}>{card}</div>;
}
