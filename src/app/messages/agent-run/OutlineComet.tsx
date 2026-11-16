import * as css from './OutlineComet.css';

// A dash of the outline that ends where the outline does, so dashes of any length share a head.
const cometDash = (length: number) => `0 ${100 - length} ${length} 0`;

type OutlineCometProps = {
  /** The icon's outline, in its 24-unit box. */
  outline: string;
  /** The comet's width: the icon's rim, in the units of `transform`. */
  width: number;
  /** Moves the outline onto the middle of the icon's rim. */
  transform?: string;
};

/**
 * A glowing comet that laps an icon's outline, as long as it is shown: the tool-call cog's while a
 * call runs, the reasoning bulb's while the model thinks. It covers its parent, the icon's box,
 * which places it.
 */
export function OutlineComet({ outline, width, transform }: OutlineCometProps) {
  return (
    <span className={css.Glow}>
      <svg className={css.Outline} viewBox="0 0 24 24" fill="none">
        <g className={css.Comet} strokeWidth={width} transform={transform}>
          <path d={outline} pathLength={100} strokeDasharray={cometDash(40)} strokeOpacity={0.32} />
          <path d={outline} pathLength={100} strokeDasharray={cometDash(24)} strokeOpacity={0.65} />
          <path
            className={css.CometHead}
            d={outline}
            pathLength={100}
            strokeDasharray={cometDash(10)}
          />
        </g>
      </svg>
    </span>
  );
}
