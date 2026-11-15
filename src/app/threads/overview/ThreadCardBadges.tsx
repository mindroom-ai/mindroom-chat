import { ErrorBoundary } from 'react-error-boundary';
import { useOptionalClientConfig } from '../../config/useClientConfig';
import { reportBoundaryError } from '../../bug-reports/error-reporting/errorReporting';
import { pluginFailure } from '../../plugins/pluginFailure';
import { registeredPlugins, type RegisteredPlugin } from '../../plugins/registry';
import { enabledThreadCardBadges, type ThreadCardBadgeProps } from '../../plugins/threadCardBadges';

const reportFailure = (tag: string, thrown: unknown, componentStack?: string | null) => {
  // eslint-disable-next-line no-console
  console.error(`[plugin ${tag}] failed to render on a thread card`, thrown);
  reportBoundaryError(pluginFailure(tag, thrown), componentStack);
};

/**
 * The marks client plugins draw on a thread's card (docs/client-plugins.md "Thread card badges"):
 * the badges of each plugin config.json leaves on, in build order, each given the thread's room and
 * the ID of its root event, and nothing at all while there is none. A badge that throws shows
 * nothing and is reported under its plugin's tag, and the card keeps the others. `plugins` defaults
 * to the plugins of this build.
 */
export function ThreadCardBadges({
  room,
  threadId,
  plugins = registeredPlugins,
}: ThreadCardBadgeProps & { plugins?: readonly RegisteredPlugin[] }) {
  const config = useOptionalClientConfig();
  const badges = enabledThreadCardBadges(plugins, config);
  if (badges.length === 0) return null;
  return (
    <>
      {badges.map(({ key, tag, Component }) => (
        <ErrorBoundary
          key={key}
          fallback={null}
          onError={(thrown: unknown, info) => reportFailure(tag, thrown, info.componentStack)}
        >
          <Component room={room} threadId={threadId} />
        </ErrorBoundary>
      ))}
    </>
  );
}
