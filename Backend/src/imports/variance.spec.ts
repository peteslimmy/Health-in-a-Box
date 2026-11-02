import { assessVariance, summariseVariance } from './variance';

const issue = (code: string, message = code, row?: number) => ({ code, message, row });

describe('which findings can be approved', () => {
  it('accepts a report whose only findings are differences between totals', () => {
    const result = assessVariance([
      issue('ROW_TOTAL_MISMATCH'),
      issue('GRAND_TOTAL_MISMATCH'),
      issue('COLUMN_TOTAL_MISMATCH'),
      issue('CROSS_FOOTING_MISMATCH'),
      issue('SERIAL_GAP'),
    ]);
    expect(result.eligible).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it.each([
    'INVALID_AMOUNT',
    'NEGATIVE_AMOUNT',
    'UNKNOWN_DEPARTMENT',
    'UNKNOWN_CHANNEL_COLUMN',
    'DUPLICATE_DEPARTMENT',
    'NO_CHANNEL_COLUMNS',
    'PERIOD_ALREADY_UPLOADED',
    'PRINTED_BEFORE_PERIOD_END',
    'EMPTY_FILE',
  ])('never lets %s be approved, even next to a tally difference', (code) => {
    const result = assessVariance([issue('ROW_TOTAL_MISMATCH'), issue(code)]);
    expect(result.eligible).toBe(false);
    expect(result.blockers.map((b) => b.code)).toEqual([code]);
  });

  it('has nothing to approve when there are no findings', () => {
    expect(assessVariance([]).eligible).toBe(false);
  });
});

describe('what is recorded about the difference', () => {
  const lines = [
    {
      rowNumber: 2,
      rawDepartment: 'PHARMACY',
      departmentId: 'd1',
      reportedTotal: '1000.00',
      channelTotal: '900.00',
      variance: '100.00',
    },
    {
      rowNumber: 3,
      rawDepartment: 'SURGERY',
      departmentId: 'd2',
      reportedTotal: '500.00',
      channelTotal: '500.00',
      variance: '0.00',
    },
    {
      rowNumber: 4,
      rawDepartment: 'RADIOLOGY',
      departmentId: 'd3',
      reportedTotal: '200.00',
      channelTotal: '200.00',
      variance: '0.005',
    },
  ];
  const errors = [
    issue(
      'ROW_TOTAL_MISMATCH',
      'PHARMACY: reported total 1000.00 differs from the channel sum 900.00 by 100.00',
      2,
    ),
    issue('ROW_TOTAL_MISMATCH', 'second'),
    issue('GRAND_TOTAL_MISMATCH', 'grand'),
  ];

  it('keeps the printed total, the evidenced total and the difference, exactly', () => {
    const summary = summariseVariance({ errors, printedGrandTotal: '1750.00', lines });
    expect(summary.printedGrandTotal).toBe('1750.00');
    expect(summary.evidencedTotal).toBe('1600.00');
    expect(summary.difference).toBe('150.00');
  });

  it('lists only the rows that differ beyond the rounding tolerance', () => {
    const summary = summariseVariance({ errors, printedGrandTotal: '1750.00', lines });
    expect(summary.linesWithDifference).toEqual([
      {
        rowNumber: 2,
        department: 'PHARMACY',
        printed: '1000.00',
        channels: '900.00',
        difference: '100.00',
      },
    ]);
  });

  it('counts findings by kind and keeps the messages that were accepted', () => {
    const summary = summariseVariance({ errors, printedGrandTotal: '1750.00', lines });
    expect(summary.findings).toBe(3);
    expect(summary.findingsByCode).toEqual({ ROW_TOTAL_MISMATCH: 2, GRAND_TOTAL_MISMATCH: 1 });
    expect(summary.accepted[0]).toContain('PHARMACY');
  });

  it('can show a printed total lower than the rows support', () => {
    const summary = summariseVariance({ errors, printedGrandTotal: '1000.00', lines });
    expect(summary.difference).toBe('-600.00');
  });
});
