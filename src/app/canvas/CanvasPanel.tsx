import { useState } from 'react';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { Box, Button, Icon, IconButton, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import {
  buildCanvasDocument,
  CANVAS_PERMISSIONS,
  CANVAS_WRAPPER_SANDBOX,
  RAW_COLOR_SCHEME,
  type CanvasColorScheme,
  type CanvasSaved,
} from '../messages/canvas/canvasDocument';
import type { CanvasTheme } from '../messages/canvas/canvasTheme';
import { useCanvasHost, type CanvasView } from '../messages/canvas/useCanvasHost';
import { CanvasAnswerBar } from '../messages/canvas/CanvasAnswerBar';
import { CanvasPageErrors } from '../messages/canvas/CanvasPageErrors';
import { CanvasUpdateNotice } from '../messages/canvas/CanvasUpdateNotice';
import * as css from './CanvasPanel.css';
import { IconTooltip } from '../ui/IconTooltip';
import { ExpandIcon, ShrinkIcon } from '../ui/panels/panelIcons';
import { ownDirectionLine } from '../ui/directional';

export { CANVAS_SEND_ARM_DELAY_MS } from '../messages/canvas/useCanvasHost';

export type CanvasPanelProps = {
  mx: MatrixClient;
  room: Room;
  canvas: CanvasView;
  agentName: string;
  colorScheme: CanvasColorScheme;
  theme: CanvasTheme;
  /** The deployment lets pages load libraries from the library source. */
  libraries?: boolean;
  /** The deployment lets pages load remote assets. */
  remote?: boolean;
  onClose: () => void;
  onRetry?: () => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  /** Which of the canvas's versions is shown, when it has more than one. */
  version?: { current: number; total: number };
  /** The canvas's saved state, read whenever a page loads, so it holds what the previous page saved. */
  savedState?: () => CanvasSaved;
  /** `byUser` is false for what the page saves before the user has worked in it. */
  onSaveState?: (change: CanvasSaved, byUser: boolean) => void;
  /** The agent can read what the user does in the page, so the panel says so. */
  shared?: boolean;
  onSelectVersion?: (current: number) => void;
};

export function CanvasPanel({
  mx,
  room,
  canvas,
  agentName,
  colorScheme,
  theme,
  libraries = false,
  remote = false,
  onClose,
  onRetry,
  expanded = false,
  onToggleExpanded,
  version,
  onSelectVersion,
  savedState,
  onSaveState,
  shared = false,
}: CanvasPanelProps) {
  const { t } = useTranslation();
  const [reloads, setReloads] = useState(0);
  const host = useCanvasHost({
    mx,
    room,
    canvas,
    agentName,
    colorScheme,
    theme,
    build: (shown) =>
      buildCanvasDocument(
        shown.html,
        shown.colorScheme,
        shown.theme,
        shown.title,
        libraries,
        savedState?.(),
        { raw: shown.raw === true, remote }
      ),
    buildKey: `${libraries}:${remote}:${reloads}`,
    onSaveState,
  });
  const { displayed, doc, frameKey, frameRef, escaped } = host;

  // While an update waits behind Load update, the numbers describe that update, not the page shown.
  const versions = host.updateAvailable ? undefined : version;
  const selectVersion = (current: number) => {
    // Picking a version is the user's choice, like Load update, so it replaces the page at once.
    host.chosen();
    onSelectVersion?.(current);
  };

  return (
    <aside className={css.Panel} aria-label={t('mindroomUi.canvas.panelLabel')}>
      <div className={css.Header}>
        <Box className={css.TitleGroup} alignItems="Center" gap="200">
          <Icon size="300" src={Icons.Category} />
          <div className={css.Title}>
            <Text size="H4" truncate {...ownDirectionLine}>
              {displayed.title}
            </Text>
            <Text size="T200" priority="300" truncate>
              {t('mindroomUi.canvas.fromAgent', { agent: agentName })}
            </Text>
          </div>
        </Box>
        <Box className={css.Controls} alignItems="Center" gap="100">
          {versions && onSelectVersion && (
            <Box alignItems="Center" gap="100">
              <IconTooltip label={t('mindroomUi.canvas.previousVersion')}>
                {(triggerRef) => (
                  <IconButton
                    ref={triggerRef}
                    onClick={() => selectVersion(versions.current - 1)}
                    aria-label={t('mindroomUi.canvas.previousVersion')}
                    disabled={host.locked || versions.current <= 1}
                    size="300"
                  >
                    <Icon size="300" src={Icons.ChevronLeft} />
                  </IconButton>
                )}
              </IconTooltip>
              <Text className={css.Version} size="T200" priority="300">
                {t('mindroomUi.canvas.version', {
                  current: versions.current,
                  total: versions.total,
                })}
              </Text>
              <IconTooltip label={t('mindroomUi.canvas.nextVersion')}>
                {(triggerRef) => (
                  <IconButton
                    ref={triggerRef}
                    onClick={() => selectVersion(versions.current + 1)}
                    aria-label={t('mindroomUi.canvas.nextVersion')}
                    disabled={host.locked || versions.current >= versions.total}
                    size="300"
                  >
                    <Icon size="300" src={Icons.ChevronRight} />
                  </IconButton>
                )}
              </IconTooltip>
            </Box>
          )}
          {onToggleExpanded && (
            <IconTooltip label={t('mindroomUi.canvas.expand')}>
              {(triggerRef) => (
                <IconButton
                  ref={triggerRef}
                  onClick={onToggleExpanded}
                  aria-label={t('mindroomUi.canvas.expand')}
                  aria-pressed={expanded}
                  size="300"
                >
                  <Icon size="300" src={expanded ? ShrinkIcon : ExpandIcon} />
                </IconButton>
              )}
            </IconTooltip>
          )}
          <IconButton onClick={onClose} aria-label={t('mindroomUi.canvas.close')} size="300">
            <Icon size="300" src={Icons.Cross} />
          </IconButton>
        </Box>
      </div>

      <CanvasUpdateNotice host={host} agentName={agentName} />

      {versions && onSelectVersion && versions.current < versions.total && (
        <div className={css.Notice} role="status">
          <Text size="T300">{t('mindroomUi.canvas.earlierVersion')}</Text>
          <Button
            size="300"
            variant="Secondary"
            disabled={host.locked}
            onClick={() => selectVersion(versions.total)}
            fill="Soft"
            outlined
            radii="300"
          >
            <Text size="B300">{t('mindroomUi.canvas.showLatest')}</Text>
          </Button>
        </div>
      )}

      <CanvasPageErrors host={host} room={room} agentName={agentName} />

      {displayed.status && (
        <Box grow="Yes" direction="Column" alignItems="Center" justifyContent="Center" gap="300">
          <Text
            className={displayed.status === 'failed' ? css.Error : undefined}
            size="T300"
            role={displayed.status === 'failed' ? 'alert' : 'status'}
          >
            {displayed.status === 'loading'
              ? t('mindroomUi.canvas.loading')
              : t('mindroomUi.canvas.loadFailed')}
          </Text>
          {displayed.status === 'failed' && onRetry && (
            <Button
              size="300"
              variant="Secondary"
              onClick={onRetry}
              fill="Soft"
              outlined
              radii="300"
            >
              <Text size="B300">{t('mindroomUi.canvas.retry')}</Text>
            </Button>
          )}
        </Box>
      )}
      {!displayed.status && escaped && (
        <Box grow="Yes" direction="Column" alignItems="Center" justifyContent="Center" gap="300">
          <Text className={css.Error} size="T300" role="alert">
            {t('mindroomUi.canvas.escaped')}
          </Text>
          <Button
            size="300"
            variant="Secondary"
            data-canvas-reload
            onClick={() => setReloads((count) => count + 1)}
            fill="Soft"
            outlined
            radii="300"
          >
            <Text size="B300">{t('mindroomUi.canvas.reload')}</Text>
          </Button>
        </Box>
      )}
      {!displayed.status && !escaped && (
        <iframe
          key={frameKey}
          ref={frameRef}
          className={css.Frame}
          title={displayed.title}
          sandbox={CANVAS_WRAPPER_SANDBOX}
          allow={CANVAS_PERMISSIONS}
          srcDoc={doc}
          referrerPolicy="no-referrer"
          onLoad={host.handleLoad}
          // A raw page is a page in a browser: white, in the browser's color scheme.
          style={displayed.raw ? { background: '#fff', colorScheme: RAW_COLOR_SCHEME } : undefined}
        />
      )}

      <div className={css.Footer}>
        <CanvasAnswerBar host={host} room={room} agentName={agentName} shared={shared} />
      </div>
    </aside>
  );
}
