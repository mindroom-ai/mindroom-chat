import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from 'react-error-boundary';
import { Box, Icon, IconButton, Icons, Text, config } from 'folds';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { reportBoundaryError } from '../bug-reports/error-reporting/errorReporting';
import type { RoomSidePanel } from '../plugins/sidePanels';
import { CONVERSATION_MIN_WIDTH, ResizablePanel } from '../ui/panels/ResizablePanel';
import { Header, Panel } from '../ui/panels/SidePanel.css';

/** A plugin's panel opens as wide as the call's, and widens as far. */
const PLUGIN_PANEL_DEFAULT_WIDTH = 400;
const PLUGIN_PANEL_MAX_WIDTH = 1200;

/**
 * A plugin's side panel beside the room (on phones over it): its title and Close above what the
 * plugin shows. A plugin that fails says so in the panel, which can still be closed.
 */
export function PluginSidePanel({
  panel: { id, label, tag, Component },
  roomId,
  mobile,
  onClose,
}: {
  panel: RoomSidePanel;
  roomId: string;
  mobile: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const userId = useMatrixClient().getSafeUserId();
  const closeLabel = t('mindroomUi.plugins.sidePanel.close', { label });
  return (
    <ResizablePanel
      side="end"
      storageKey={`mindroom.panel.width:${userId}:${id}`}
      defaultWidth={PLUGIN_PANEL_DEFAULT_WIDTH}
      minContentWidth={CONVERSATION_MIN_WIDTH}
      maxPanelWidth={PLUGIN_PANEL_MAX_WIDTH}
      passthrough={mobile}
      resizeLabel={t('mindroomUi.plugins.sidePanel.resize', { label })}
      collapseLabel={closeLabel}
      onCollapse={onClose}
      testId="resizable-plugin-panel"
    >
      <section className={Panel} style={{ flexGrow: 1 }} aria-label={label}>
        <header className={Header}>
          <Text as="h2" size="H4" truncate>
            {label}
          </Text>
          <IconButton
            size="300"
            radii="300"
            variant="Surface"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <Icon size="200" src={Icons.Cross} />
          </IconButton>
        </header>
        <Box grow="Yes" direction="Column" style={{ minHeight: 0, overflowY: 'auto' }}>
          <ErrorBoundary
            fallback={
              <Text size="T300" priority="300" style={{ padding: config.space.S400 }}>
                {t('mindroomUi.plugins.sidePanel.failed')}
              </Text>
            }
            resetKeys={[Component, roomId]}
            onError={(thrown: unknown, info) => {
              // eslint-disable-next-line no-console
              console.error(`[plugin ${tag}] its side panel failed`, thrown);
              // A plugin may throw anything, not only an Error.
              const error = thrown instanceof Error ? thrown : new Error(String(thrown));
              reportBoundaryError(
                {
                  name: error.name,
                  message: `[plugin ${tag}] ${error.message}`,
                  stack: error.stack,
                },
                info.componentStack
              );
            }}
          >
            <Component roomId={roomId} />
          </ErrorBoundary>
        </Box>
      </section>
    </ResizablePanel>
  );
}
