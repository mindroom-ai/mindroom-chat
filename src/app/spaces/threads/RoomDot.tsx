import * as css from './SpaceThreads.css';

export function RoomDot({ color }: { color: string }) {
  return <span className={css.RoomDot} style={{ backgroundColor: color }} aria-hidden="true" />;
}
