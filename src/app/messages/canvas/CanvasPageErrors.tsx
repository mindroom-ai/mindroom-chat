import type { Room } from 'matrix-js-sdk';
import { Box, Button, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { FailedSendActions } from '../FailedSendActions';
import type { CanvasHost } from './useCanvasHost';
import * as css from './canvasHost.css';

/** The errors the page reported, which the user may tell the agent about, and that report's status. */
export function CanvasPageErrors({
  host,
  room,
  agentName,
}: {
  host: CanvasHost;
  room: Room;
  agentName: string;
}) {
  const { t } = useTranslation();
  const { pageErrors, reportState, reportOpen } = host;
  if (pageErrors.errors.length === 0 && !pageErrors.report) return null;
  return (
    <div
      className={css.Notice}
      role={pageErrors.errors.length > 0 || reportState === 'failed' ? 'alert' : 'status'}
    >
      <div className={css.Staged}>
        {pageErrors.report &&
          (reportState === 'failed' && pageErrors.report.echo ? (
            <FailedSendActions
              room={room}
              event={pageErrors.report.echo}
              message={t('mindroomUi.canvas.errorsNotSent', { agent: agentName })}
            />
          ) : (
            <Text size="T300">
              {reportState === 'sending'
                ? t('mindroomUi.canvas.sending', { agent: agentName })
                : t('mindroomUi.canvas.errorsSent', { agent: agentName })}
            </Text>
          ))}
        {pageErrors.errors.length > 0 && (
          <>
            <Text size="T300">{t('mindroomUi.canvas.pageError')}</Text>
            <pre className={css.Data}>{pageErrors.errors.join('\n')}</pre>
            <Box>
              <Button
                size="300"
                variant="Secondary"
                disabled={reportOpen}
                onClick={host.report}
                data-canvas-report
                fill="Soft"
                outlined
                radii="300"
              >
                <Text size="B300" truncate>
                  {t('mindroomUi.canvas.tellAgent', { agent: agentName })}
                </Text>
              </Button>
            </Box>
          </>
        )}
      </div>
    </div>
  );
}
