import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from 'react-error-boundary';
import { Box, Icon, IconButton, Icons, Text, config } from 'folds';
import { reportBoundaryError } from '../bug-reports/error-reporting/errorReporting';
import { pluginFailure } from '../plugins/pluginFailure';
import type { RoomSidePanel } from '../plugins/sidePanels';
import { Header, Panel } from '../ui/panels/SidePanel.css';

/**
 * A plugin's side panel: its title and Close above what the plugin shows, for `request`. A plugin
 * that fails says so in the panel, which can still be closed, until another request comes.
 */
export function PluginSidePanel({
  panel: { label, tag, Component },
  roomId,
  request,
  onClose,
}: {
  panel: RoomSidePanel;
  roomId: string;
  request: unknown;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className={Panel} style={{ flexGrow: 1 }} aria-label={label}>
      <header className={Header}>
        <Text as="h2" size="H4" truncate>
          {label}
        </Text>
        <IconButton
          size="300"
          radii="300"
          variant="Surface"
          aria-label={t('mindroomUi.plugins.sidePanel.close', { label })}
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
          resetKeys={[Component, roomId, request]}
          onError={(thrown: unknown, info) => {
            // eslint-disable-next-line no-console
            console.error(`[plugin ${tag}] its side panel failed`, thrown);
            reportBoundaryError(pluginFailure(tag, thrown), info.componentStack);
          }}
        >
          {/* A component that loads its code waits here, not in place of the page. */}
          <Suspense fallback={null}>
            <Component roomId={roomId} request={request} />
          </Suspense>
        </ErrorBoundary>
      </Box>
    </section>
  );
}
