import { ConnectionsPage } from '../../../mindroom/connections/ConnectionsPage';
import * as css from './ConnectionsRoute.css';

/** `/connections`: the Connections portal hand-off, whose fallback card looks like the one in Settings. */
export function ConnectionsRoute() {
  return (
    <div className={css.ConnectionsRoute}>
      <ConnectionsPage />
    </div>
  );
}
