import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { RankedBars, SegmentedBar, Sparkline, TimeChart, niceScale } from './charts';

const money = (raw: string) => `₦${raw}`;

const chart = (
  <TimeChart
    title="Charges by month"
    labels={['Aug', 'Sep', 'Oct']}
    detailLabels={['August 2026', 'September 2026', 'October 2026 (to date)']}
    format={money}
    series={[
      { key: 'a', label: 'Charges', color: 'var(--viz-1)', values: ['100.00', '250.00', '400.00'] },
      { key: 'b', label: 'Payments', color: 'var(--viz-2)', values: ['50.00', null, '300.00'] },
    ]}
  />
);

describe('niceScale', () => {
  it('rounds the top up to an even step and starts at zero', () => {
    const scale = niceScale(412);
    expect(scale.values[0]).toBe(0);
    expect(scale.max).toBeGreaterThanOrEqual(412);
    expect(scale.values[scale.values.length - 1]).toBe(scale.max);
  });

  it('copes with an all-zero series', () => {
    expect(niceScale(0)).toEqual({ max: 1, values: [0, 1] });
  });
});

describe('TimeChart', () => {
  it('shows a legend for two series and names the chart for assistive technology', () => {
    render(chart);
    expect(screen.getByRole('list', { name: 'Legend' })).toHaveTextContent('Charges');
    expect(screen.getByRole('img', { name: /Charges by month/ })).toBeInTheDocument();
  });

  it('reads one month at a time with the arrow keys, exact values, and a gap for missing data', async () => {
    render(chart);
    screen.getByRole('img').focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    const tip = screen.getByRole('status');
    expect(tip).toHaveTextContent('September 2026');
    expect(tip).toHaveTextContent('₦250.00');
    expect(tip).toHaveTextContent('—');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers the same numbers as a table', async () => {
    render(chart);
    await userEvent.click(screen.getByRole('button', { name: 'View as table' }));
    const table = screen.getByRole('table', { name: 'Charges by month' });
    expect(table).toHaveTextContent('October 2026 (to date)');
    expect(table).toHaveTextContent('₦400.00');
    await userEvent.click(screen.getByRole('button', { name: 'Show chart' }));
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('draws columns for the bar kind', () => {
    const { container } = render(
      <TimeChart
        kind="bar"
        title="Revenue"
        labels={['Aug', 'Sep']}
        format={money}
        series={[{ key: 'r', label: 'Revenue', color: 'var(--viz-1)', values: ['10.00', '20.00'] }]}
      />,
    );
    expect(container.querySelectorAll('rect[rx="3"]').length).toBe(2);
    fireEvent.pointerMove(container.querySelector('rect[fill="transparent"]') as Element, { clientX: 10 });
  });
});

describe('other charts', () => {
  it('splits a bar into labelled shares that add up to the total', () => {
    render(
      <SegmentedBar
        total="300.00"
        format={money}
        segments={[
          { key: 'a', label: 'Current', value: '100.00', color: '#86b6ef' },
          { key: 'b', label: 'Late', value: '200.00', color: '#104281' },
        ]}
      />,
    );
    expect(screen.getByText('33.3%')).toBeInTheDocument();
    expect(screen.getByText('66.7%')).toBeInTheDocument();
  });

  it('ranks with the largest bar at full width', () => {
    const { container } = render(
      <RankedBars
        format={money}
        items={[
          { key: 'a', label: 'A', value: '50.00' },
          { key: 'b', label: 'B', value: '100.00' },
        ]}
      />,
    );
    const widths = Array.from(container.querySelectorAll<HTMLElement>('div.rounded-full > div')).map((el) => el.style.width);
    expect(widths).toEqual(['50%', '100%']);
  });

  it('renders nothing for a single point', () => {
    const { container } = render(<Sparkline values={['1.00']} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('TimeChart drill-down', () => {
  const drillChart = (
    <TimeChart
      title="Charges by month"
      labels={['Aug', 'Sep']}
      detailLabels={['August 2026', 'September 2026']}
      format={(raw) => `₦${raw}`}
      series={[{ key: 'a', label: 'Charges', color: 'var(--viz-1)', values: ['1.00', '2.00'] }]}
      drill={(index) => <a href={`/records/${index}`}>Open records</a>}
    />
  );

  it('hints that points can be clicked, and offers actions once a point is chosen with the keyboard', async () => {
    render(drillChart);
    expect(screen.getByText(/Click a point to open its records/)).toBeInTheDocument();
    screen.getByRole('img').focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{Enter}');
    expect(screen.getByRole('link', { name: 'Open records' })).toHaveAttribute('href', '/records/1');
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('link', { name: 'Open records' })).toBeNull();
  });

  it('selects a point on click and deselects it on a second click', async () => {
    const { container } = render(drillChart);
    const overlay = container.querySelector('rect[fill="transparent"]') as Element;
    await userEvent.click(overlay);
    expect(screen.getByRole('link', { name: 'Open records' })).toBeInTheDocument();
    await userEvent.click(overlay);
    expect(screen.queryByRole('link', { name: 'Open records' })).toBeNull();
  });

  it('offers nothing to click when no drill-down is defined', () => {
    render(chart);
    expect(screen.queryByText(/Click a point/)).toBeNull();
  });
});
