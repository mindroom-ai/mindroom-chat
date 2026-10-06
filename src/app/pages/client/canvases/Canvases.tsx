import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Box, Icon, IconButton, Icons, Text } from 'folds';
import { KnownMembership } from 'matrix-js-sdk';
import { Page, PageContent, PageHeader, PageScroll } from '../../../components/page';
import { useAccountData } from '../../../hooks/useAccountData';
import { useAppLanguageCode } from '../../../hooks/useAppLanguageCode';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';
import { getMxIdLocalPart } from '../../../utils/matrix';
import { getMemberDisplayName } from '../../../utils/room';
import {
  canvasSessionId,
  loadCanvasEvent,
  recordCanvasEvent,
} from '../../../mindroom/canvas/canvasIndex';
import {
  listCanvases,
  subscribeCanvasList,
  type CanvasListEntry,
} from '../../../mindroom/canvas/canvasIndexStore';
import { listSavedCanvasIds } from '../../../mindroom/canvas/canvasStateStore';
import {
  PINNED_CANVASES_TYPE,
  readPinnedCanvases,
  writePinnedCanvases,
  type PinnedCanvas,
} from '../../../mindroom/canvas/pinnedCanvases';
import { cancelCanvasOpen, requestCanvasOpen } from '../../../mindroom/canvas/useCanvasOpenRequest';
import * as css from './Canvases.css';

type CanvasList = { entries?: CanvasListEntry[]; savedIds: Set<string> };

/** This session's listed canvases and which hold saved state, re-read after each change. */
const useCanvasList = (sessionId: string): CanvasList => {
  const [list, setList] = useState<CanvasList>({ savedIds: new Set() });
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const load = () =>
      Promise.all([
        listCanvases(sessionId).catch(() => []),
        listSavedCanvasIds(sessionId).catch(() => []),
      ]).then(([entries, savedIds]) => {
        if (alive) setList({ entries, savedIds: new Set(savedIds) });
      });
    load();
    // Sync can list many canvases at once; one read follows each burst.
    const unsubscribe = subscribeCanvasList(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(load, 100);
    });
    return () => {
      alive = false;
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [sessionId]);
  return list;
};

/**
 * Pins from account data, showing a change at once. One write at a time: the SDK settles a write
 * only once it has echoed back, so the next change starts from what the server holds.
 */
const usePinnedCanvases = () => {
  const mx = useMatrixClient();
  const pinEvent = useAccountData(PINNED_CANVASES_TYPE);
  const stored = useMemo(() => readPinnedCanvases(pinEvent?.getContent()), [pinEvent]);
  const [pending, setPending] = useState<PinnedCanvas[]>();
  const pins = pending ?? stored;
  const toggle = (entry: CanvasListEntry) => {
    const next = pins.some((pin) => pin.canvasId === entry.canvasId)
      ? pins.filter((pin) => pin.canvasId !== entry.canvasId)
      : [...pins, { roomId: entry.roomId, canvasId: entry.canvasId }];
    setPending(next);
    writePinnedCanvases(mx, next)
      .catch(() => undefined)
      .finally(() => setPending(undefined));
  };
  return { pins, toggle, writing: !!pending };
};

export function Canvases() {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const mx = useMatrixClient();
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const { entries, savedIds } = useCanvasList(canvasSessionId(mx));
  const { pins, toggle, writing } = usePinnedCanvases();
  // Coming back here abandons a canvas this page asked a room to open.
  useEffect(() => cancelCanvasOpen(), []);

  // A canvas pinned on another device may be missing here; it is fetched and listed once.
  const fetched = useRef(new Set<string>());
  useEffect(() => {
    if (!entries) return;
    pins.forEach((pin) => {
      const room = mx.getRoom(pin.roomId);
      if (!room || fetched.current.has(pin.canvasId)) return;
      if (entries.some((entry) => entry.canvasId === pin.canvasId)) return;
      fetched.current.add(pin.canvasId);
      loadCanvasEvent(mx, room, pin.canvasId)
        .then((event) => event && recordCanvasEvent(mx, event))
        .catch(() => undefined);
    });
  }, [mx, entries, pins]);

  const rows = useMemo(() => {
    const pinOrder = new Map(pins.map((pin, index) => [pin.canvasId, index]));
    return (entries ?? [])
      .filter((entry) => mx.getRoom(entry.roomId)?.getMyMembership() === KnownMembership.Join)
      .sort(
        (a, b) =>
          (pinOrder.get(a.canvasId) ?? Infinity) - (pinOrder.get(b.canvasId) ?? Infinity) ||
          b.updatedTs - a.updatedTs
      );
  }, [mx, entries, pins]);

  const date = useMemo(
    () => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }),
    [language]
  );
  const open = (entry: CanvasListEntry, canvas: boolean) => {
    if (canvas) requestCanvasOpen(entry.roomId, entry.canvasId);
    else cancelCanvasOpen();
    if (entry.threadId) navigateRoomThread(entry.roomId, entry.threadId);
    else navigateRoom(entry.roomId);
  };

  return (
    <Page data-testid="canvases-view">
      <PageHeader outlined>
        <Box grow="Yes" alignItems="Center" gap="200">
          <Icon src={Icons.Category} size="300" />
          <Text as="h1" size="H3" truncate>
            {t('mindroomUi.canvases.title')}
          </Text>
        </Box>
      </PageHeader>
      <PageScroll>
        <PageContent>
          <Text size="T300" priority="300" className={css.Note}>
            {t('mindroomUi.canvases.note')}
          </Text>
          {entries && rows.length === 0 && (
            <Text size="T300" className={css.Empty}>
              {t('mindroomUi.canvases.empty')}
            </Text>
          )}
          {rows.length > 0 && (
            <div className={css.TableScroll}>
              <table className={css.Table}>
                <thead>
                  <tr>
                    <th aria-label={t('mindroomUi.canvases.pinned')} />
                    <th>{t('mindroomUi.canvases.canvas')}</th>
                    <th>{t('mindroomUi.canvases.agent')}</th>
                    <th>{t('mindroomUi.canvases.room')}</th>
                    <th>{t('mindroomUi.canvases.updated')}</th>
                    <th>{t('mindroomUi.canvases.created')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry) => {
                    const room = mx.getRoom(entry.roomId);
                    const pinned = pins.some((pin) => pin.canvasId === entry.canvasId);
                    const agent =
                      (room && getMemberDisplayName(room, entry.agentUserId)) ??
                      getMxIdLocalPart(entry.agentUserId) ??
                      entry.agentUserId;
                    return (
                      <tr key={entry.canvasId}>
                        <td>
                          <IconButton
                            size="300"
                            radii="300"
                            variant={pinned ? 'Primary' : 'Background'}
                            aria-pressed={pinned}
                            disabled={writing}
                            aria-label={t(
                              pinned ? 'mindroomUi.canvases.unpin' : 'mindroomUi.canvases.pin',
                              { title: entry.title }
                            )}
                            onClick={() => toggle(entry)}
                          >
                            <Icon size="100" src={Icons.Pin} filled={pinned} />
                          </IconButton>
                        </td>
                        <td>
                          <Box direction="Column" gap="100" alignItems="Start">
                            <button
                              type="button"
                              className={css.Link}
                              onClick={() => open(entry, true)}
                            >
                              <Text size="T300" as="span">
                                <b>{entry.title}</b>
                              </Text>
                            </button>
                            {(entry.shared || savedIds.has(entry.canvasId)) && (
                              <Box gap="100" wrap="Wrap">
                                {entry.shared && (
                                  <Badge variant="Secondary" fill="Soft" radii="300">
                                    <Text size="L400">{t('mindroomUi.canvases.shared')}</Text>
                                  </Badge>
                                )}
                                {savedIds.has(entry.canvasId) && (
                                  <Badge variant="Secondary" fill="Soft" radii="300">
                                    <Text size="L400">{t('mindroomUi.canvases.saved')}</Text>
                                  </Badge>
                                )}
                              </Box>
                            )}
                          </Box>
                        </td>
                        <td>
                          <Text size="T300">{agent}</Text>
                        </td>
                        <td>
                          <button
                            type="button"
                            className={css.Link}
                            onClick={() => open(entry, false)}
                          >
                            <Text size="T300" as="span">
                              {room?.name ?? entry.roomId}
                            </Text>
                          </button>
                        </td>
                        <td>
                          <Text size="T300">{date.format(entry.updatedTs)}</Text>
                        </td>
                        <td>
                          <Text size="T300">{date.format(entry.createdTs)}</Text>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </PageContent>
      </PageScroll>
    </Page>
  );
}
