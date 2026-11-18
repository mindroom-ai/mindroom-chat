import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { formatNumber } from '../../lib/localDigits';
import { useResizeObserver } from '../../lib/hooks/useResizeObserver';
import type { ChartWidget } from './chartSchema';
import { labelStep, niceTicks, pieSlices, valueDomain } from './chartGeometry';
import * as css from './UiChart.css';

/** Before the card is measured (and where nothing lays out): a desktop message's width. */
const DEFAULT_WIDTH = 560;
/** The card's inline padding; under 420 px of card the toggle shows icons only. */
const CARD_PADDING = 28;
const COMPACT_CARD = 420;
const PLOT_HEIGHT = 200;
const DONUT_SIZE = 168;

type Scale = { ticks: number[]; low: number; high: number };
type Geometry =
  | { kind: 'cartesian'; scale: Scale }
  | { kind: 'pie'; slices: NonNullable<ReturnType<typeof pieSlices>> };

/** What the plot needs, or undefined when a value, the domain or the sum cannot be drawn. */
const getGeometry = (chart: ChartWidget): Geometry | undefined => {
  const series = chart.series.map((s) => s.data);
  if (chart.kind === 'pie') {
    const slices = pieSlices(series[0] ?? []);
    return slices && { kind: 'pie', slices };
  }
  const domain = valueDomain(chart.kind, series);
  if (!domain) return undefined;
  const ticks = niceTicks(domain[0], domain[1]);
  const low = ticks[0] ?? domain[0];
  const high = ticks[ticks.length - 1] ?? domain[1];
  if (!ticks.every(Number.isFinite) || !Number.isFinite(high - low) || !(high > low)) {
    return undefined;
  }
  return { kind: 'cartesian', scale: { ticks, low, high } };
};

const ChartIcon = (
  <svg
    className={css.ToggleIcon}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden
  >
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);
const TableIcon = (
  <svg
    className={css.ToggleIcon}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden
  >
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M3 15h18M10 4v16" />
  </svg>
);

const color = (index: number) => css.SERIES_COLORS[index % css.SERIES_COLORS.length];

/** A label cut to about `maxWidth` pixels of 11.5 px text. */
const fitLabel = (label: string, maxWidth: number): string => {
  const chars = [...label];
  const fits = Math.max(2, Math.floor(maxWidth / 6.5));
  return chars.length <= fits ? label : `${chars.slice(0, fits - 1).join('')}…`;
};

type Formatters = {
  value: (value: number) => string;
  tick: (value: number) => string;
  percent: (share: number) => string;
};

const useFormatters = (): Formatters => {
  const language = useAppLanguageCode();
  return useMemo(() => {
    const compact = new Intl.NumberFormat(language, {
      notation: 'compact',
      maximumSignificantDigits: 3,
    });
    const scientific = new Intl.NumberFormat(language, {
      notation: 'scientific',
      maximumSignificantDigits: 3,
    });
    const percent = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 1 });
    return {
      value: (value) => formatNumber(value, language),
      tick: (value) => {
        const size = Math.abs(value);
        return (size >= 1e15 || (size > 0 && size < 1e-3) ? scientific : compact).format(value);
      },
      percent: (share) => percent.format(share),
    };
  }, [language]);
};

/** A chart widget: a bordered card with the plot, or the same numbers as a table. */
export function UiChart({ chart }: { chart: ChartWidget }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [width, setWidth] = useState<number>();
  const cardRef = useRef<HTMLElement>(null);
  const getCard = useCallback(() => cardRef.current, []);
  useResizeObserver((entries) => {
    const measured = entries[0]?.contentRect.width;
    if (measured) setWidth(Math.floor(measured));
  }, getCard);

  const geometry = useMemo(() => getGeometry(chart), [chart]);
  const plotWidth = width ?? DEFAULT_WIDTH;
  const compact = plotWidth + CARD_PADDING < COMPACT_CARD;
  const shown = geometry ? view : 'table';
  const slices = geometry?.kind === 'pie' ? geometry.slices : undefined;
  const cell: Cell = (seriesIndex, index) => {
    const value = format.value(chart.series[seriesIndex]?.data[index] ?? 0);
    const share = slices?.[index]?.share;
    return share === undefined
      ? value
      : t('mindroomUi.messages.uiWidget.share', { value, percent: format.percent(share) });
  };
  const toggle = (target: 'chart' | 'table', icon: ReactNode) => (
    <button
      type="button"
      className={css.ToggleButton}
      aria-pressed={view === target}
      aria-label={t(`mindroomUi.messages.uiWidget.${target}`)}
      onClick={() => setView(target)}
    >
      {icon}
      {!compact && <span aria-hidden>{t(`mindroomUi.messages.uiWidget.${target}`)}</span>}
    </button>
  );

  return (
    <figure ref={cardRef} className={css.Card}>
      <div className={css.Header}>
        <figcaption className={css.Heading}>
          <div className={css.Title}>{chart.title}</div>
          {chart.y && <div className={css.Subtitle}>{chart.y}</div>}
        </figcaption>
        {geometry && (
          <div className={css.Toggle}>
            {toggle('chart', ChartIcon)}
            {toggle('table', TableIcon)}
          </div>
        )}
      </div>
      {shown === 'table' || !geometry ? (
        <ChartTable chart={chart} cell={cell} />
      ) : (
        <ChartPlot
          chart={chart}
          geometry={geometry}
          width={plotWidth}
          format={format}
          cell={cell}
        />
      )}
    </figure>
  );
}

type Slices = Extract<Geometry, { kind: 'pie' }>['slices'];

/** A value as the table, the tooltip and the legend show it: with its share in a pie. */
type Cell = (seriesIndex: number, index: number) => string;

function ChartTable({ chart, cell }: { chart: ChartWidget; cell: Cell }) {
  return (
    <div className={css.TableScroll}>
      <table className={css.Table}>
        <caption className={css.VisuallyHidden}>{chart.title}</caption>
        <thead>
          <tr>
            <th scope="col">{chart.x}</th>
            {chart.series.map((s) => (
              <th key={s.name} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.labels.map((label, index) => (
            // Labels may repeat; the row's place is its identity.
            // eslint-disable-next-line react/no-array-index-key
            <tr key={index}>
              <th scope="row">{label}</th>
              {chart.series.map((s, seriesIndex) => (
                <td key={s.name}>{cell(seriesIndex, index)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type PlotProps = {
  chart: ChartWidget;
  width: number;
  format: Formatters;
  cell: Cell;
  active: number | undefined;
  onPoint: (index: number) => void;
};

const STEPS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** The plot: one tab stop whose arrow keys, Home and End move between labels. */
function ChartPlot({
  chart,
  geometry,
  width,
  format,
  cell,
}: {
  chart: ChartWidget;
  geometry: Geometry;
  width: number;
  format: Formatters;
  cell: Cell;
}) {
  const { t } = useTranslation();
  const [active, setActive] = useState<number>();
  const plotRef = useRef<HTMLDivElement>(null);
  const last = chart.labels.length - 1;
  const onKeyDown = (event: KeyboardEvent) => {
    const step = STEPS[event.key];
    let next: number | undefined;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else if (step !== undefined) next = Math.min(last, Math.max(0, (active ?? 0) + step));
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
  };
  const values = (index: number) =>
    chart.series.map((s, seriesIndex) => ({
      name: s.name,
      color: color(geometry.kind === 'pie' ? index : seriesIndex),
      text: cell(seriesIndex, index),
    }));
  const announce = (index: number) =>
    values(index)
      .map(({ name, text }) =>
        t('mindroomUi.messages.uiWidget.pointValue', {
          label: chart.labels[index],
          series: name,
          value: text,
        })
      )
      .join(', ');
  const props: PlotProps = { chart, width, format, cell, active, onPoint: setActive };
  const plot =
    geometry.kind === 'pie' ? (
      <DonutPlot {...props} slices={geometry.slices} />
    ) : (
      <CartesianPlot {...props} scale={geometry.scale} />
    );
  let tooltipX: number | undefined;
  if (active !== undefined) {
    tooltipX =
      geometry.kind === 'pie'
        ? Math.min(width, DONUT_SIZE)
        : cartesianLayout(chart, geometry.scale, width, format).x(active);
  }

  return (
    <>
      {geometry.kind !== 'pie' && chart.series.length > 1 && (
        <ul className={css.Legend} aria-hidden>
          {chart.series.map((s, index) => (
            <li key={s.name} className={css.LegendItem}>
              <i className={css.Swatch} style={{ background: color(index) }} />
              {s.name}
            </li>
          ))}
        </ul>
      )}
      {/* The plot is one tab stop that the arrow keys move through (spec 7.3); the table view
          and the polite announcements below are what assistive technology reads. */}
      {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      <div
        ref={plotRef}
        className={css.Plot}
        dir="ltr"
        role="group"
        aria-label={chart.title}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((current) => current ?? 0)}
        onBlur={() => setActive(undefined)}
        onPointerLeave={() => {
          if (document.activeElement !== plotRef.current) setActive(undefined);
        }}
      >
        {plot}
        {active !== undefined && tooltipX !== undefined && (
          <div
            className={css.Tooltip}
            aria-hidden
            style={{
              insetInlineStart: tooltipX + (tooltipX > width / 2 ? -10 : 10),
              transform: tooltipX > width / 2 ? 'translateX(-100%)' : undefined,
            }}
          >
            <div className={css.TooltipLabel}>{chart.labels[active]}</div>
            {values(active).map(({ name, color: swatch, text }) => (
              <div key={name} className={css.TooltipRow}>
                <i className={css.Swatch} style={{ background: swatch }} />
                {name}
                <span className={css.TooltipValue}>{text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      <div className={css.VisuallyHidden} aria-live="polite">
        {active === undefined ? '' : announce(active)}
      </div>
    </>
  );
}

const MARGIN_TOP = 8;
const MARGIN_END = 8;

/** Where the cartesian plot puts things: by label index and by value. */
const cartesianLayout = (chart: ChartWidget, scale: Scale, width: number, format: Formatters) => {
  const tickWidth = Math.max(...scale.ticks.map((tick) => format.tick(tick).length)) * 6.5 + 8;
  const left = Math.min(90, Math.max(20, tickWidth));
  const bottom = chart.x ? 38 : 22;
  const plotWidth = Math.max(1, width - left - MARGIN_END);
  const plotHeight = PLOT_HEIGHT - MARGIN_TOP - bottom;
  const count = chart.labels.length;
  const bars = chart.kind === 'bar';
  const band = bars || count === 1 ? plotWidth / count : (plotWidth - 12) / (count - 1);
  const x = (index: number) => {
    if (bars) return left + band * (index + 0.5);
    return count === 1 ? left + plotWidth / 2 : left + 6 + index * band;
  };
  const y = (value: number) =>
    MARGIN_TOP + plotHeight * (1 - (value - scale.low) / (scale.high - scale.low));
  return {
    left,
    plotWidth,
    plotHeight,
    band,
    x,
    y,
    zero: y(Math.min(scale.high, Math.max(scale.low, 0))),
  };
};

function CartesianPlot({
  chart,
  scale,
  width,
  format,
  active,
  onPoint,
}: PlotProps & { scale: Scale }) {
  const { left, plotWidth, plotHeight, band, x, y, zero } = cartesianLayout(
    chart,
    scale,
    width,
    format
  );
  const count = chart.labels.length;
  const every = labelStep(count, plotWidth);
  const seriesCount = chart.series.length;
  const group = band * 0.72;
  const barWidth = group / seriesCount;
  const points = (data: number[]) =>
    data.map((value, index) => `${x(index)} ${y(value)}`).join('L');
  const bottom = MARGIN_TOP + plotHeight;

  return (
    <svg className={css.Svg} width={width} height={PLOT_HEIGHT} aria-hidden>
      {scale.ticks.map((tick) => (
        <g key={tick}>
          <line
            className={tick === 0 ? css.Baseline : css.Grid}
            x1={left}
            x2={left + plotWidth}
            y1={y(tick)}
            y2={y(tick)}
          />
          <text x={left - 6} y={y(tick) + 4} textAnchor="end">
            {format.tick(tick)}
          </text>
        </g>
      ))}
      {active !== undefined && (
        <rect
          className={css.Band}
          x={x(active) - band / 2}
          y={MARGIN_TOP}
          width={band}
          height={plotHeight}
          rx={4}
        />
      )}
      {chart.kind === 'bar' &&
        chart.series.map((s, seriesIndex) =>
          s.data.map((value, index) => (
            <rect
              // eslint-disable-next-line react/no-array-index-key
              key={`${s.name}:${index}`}
              x={x(index) - group / 2 + seriesIndex * barWidth}
              y={Math.min(y(value), zero)}
              width={Math.max(1, barWidth - (seriesCount > 1 ? 1 : 0))}
              height={Math.abs(y(value) - zero)}
              rx={Math.min(3, barWidth / 3)}
              fill={color(seriesIndex)}
            />
          ))
        )}
      {chart.kind !== 'bar' &&
        chart.series.map((s, seriesIndex) => (
          <g key={s.name}>
            {chart.kind === 'area' && (
              <path
                d={`M${points(s.data)}L${x(count - 1)} ${zero}L${x(0)} ${zero}Z`}
                fill={color(seriesIndex)}
                fillOpacity={0.14}
              />
            )}
            <path className={css.SeriesLine} d={`M${points(s.data)}`} stroke={color(seriesIndex)} />
            {s.data.map((value, index) =>
              count <= 40 || index === active ? (
                <circle
                  // eslint-disable-next-line react/no-array-index-key
                  key={index}
                  className={css.Point}
                  cx={x(index)}
                  cy={y(value)}
                  r={index === active ? 4.5 : 3.5}
                  fill={color(seriesIndex)}
                />
              ) : null
            )}
          </g>
        ))}
      {chart.labels.map((label, index) =>
        index % every === 0 ? (
          // eslint-disable-next-line react/no-array-index-key
          <text key={index} x={x(index)} y={bottom + 15} textAnchor="middle">
            {fitLabel(label, every * band - 4)}
          </text>
        ) : null
      )}
      {chart.x && (
        <text x={left + plotWidth / 2} y={PLOT_HEIGHT - 3} textAnchor="middle">
          {chart.x}
        </text>
      )}
      {chart.labels.map((_label, index) => (
        <rect
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          x={x(index) - band / 2}
          y={MARGIN_TOP}
          width={band}
          height={plotHeight}
          fill="transparent"
          onPointerEnter={() => onPoint(index)}
        />
      ))}
    </svg>
  );
}

function DonutPlot({
  chart,
  width,
  format,
  cell,
  active,
  onPoint,
  slices,
}: PlotProps & { slices: Slices }) {
  const size = Math.min(DONUT_SIZE, width);
  const center = size / 2;
  const outer = center - 4;
  const inner = outer * 0.64;
  const at = (angle: number, radius: number) =>
    `${center + radius * Math.cos(angle - Math.PI / 2)} ${
      center + radius * Math.sin(angle - Math.PI / 2)
    }`;

  return (
    <div className={css.Donut}>
      <svg className={css.Svg} width={size} height={size} aria-hidden>
        {slices.map(({ start, end, share }, index) => {
          if (share === 0) return null;
          const dim = active !== undefined && active !== index ? 0.45 : 1;
          const enter = () => onPoint(index);
          if (share > 0.9999) {
            return (
              // eslint-disable-next-line react/no-array-index-key
              <circle
                key={index}
                cx={center}
                cy={center}
                r={(outer + inner) / 2}
                fill="none"
                stroke={color(index)}
                strokeWidth={outer - inner}
                opacity={dim}
                onPointerEnter={enter}
              />
            );
          }
          const pad = Math.min(0.012, (end - start) / 4);
          const from = start + pad;
          const to = end - pad;
          const large = to - from > Math.PI ? 1 : 0;
          return (
            <path
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              d={`M${at(from, outer)}A${outer} ${outer} 0 ${large} 1 ${at(to, outer)}L${at(
                to,
                inner
              )}A${inner} ${inner} 0 ${large} 0 ${at(from, inner)}Z`}
              fill={color(index)}
              opacity={dim}
              onPointerEnter={enter}
            />
          );
        })}
        {active !== undefined && (
          <text className={css.DonutCenter} x={center} y={center + 6} textAnchor="middle">
            {format.percent(slices[active]?.share ?? 0)}
          </text>
        )}
      </svg>
      <ul className={css.DonutLegend}>
        {chart.labels.map((label, index) => (
          // eslint-disable-next-line react/no-array-index-key
          <li key={index} className={css.LegendItem} onPointerEnter={() => onPoint(index)}>
            <i className={css.Swatch} style={{ background: color(index) }} />
            {label}
            <span className={css.LegendValue}>{cell(0, index)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
