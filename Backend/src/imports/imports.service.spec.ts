import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { allCentresUser, D } from '../testing/fixtures';
import { ImportsService } from './imports.service';
import { RevenueParserService } from './revenue-parser.service';

const mockReadPdf = jest.fn();
jest.mock('./file-extractor', () => ({
  // Same contract as the real extractor, without starting a process.
  extractFile: async (kind: string, buffer: Buffer, filename: string) => {
    if (kind === 'pdf') {
      const pdf = await mockReadPdf(buffer);
      return { rows: pdf.rows, pdf };
    }
    const { readRows } = jest.requireActual('./table-reader');
    return { rows: readRows(buffer, filename), pdf: null };
  },
}));

const CENTRE = 'centre-1';
const departments = [{ id: 'dep-pharm', code: 'PHARM', name: 'Pharmacy', aliases: [] }];
const channels = [
  { id: 'ch-cash', code: 'CASH', name: 'Cash', aliases: [] },
  { id: 'ch-pos', code: 'POS', name: 'POS', aliases: [] },
];

const csvFile = (body: string, name = 'report.csv') =>
  ({ buffer: Buffer.from(body), size: Buffer.byteLength(body), originalname: name }) as never;

const GOOD = 'Department,Cash,POS,Total Amount\nPharmacy,600.00,400.00,1000.00\n';

function build(
  overrides: { importBatch?: Record<string, jest.Mock>; transaction?: jest.Mock } = {},
) {
  const tx = {
    importBatch: {
      create: jest.fn(async ({ data }) => ({ id: 'batch-new', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    revenueReport: {
      create: jest.fn(async ({ data }) => ({
        id: 'report-new',
        grandTotal: data.grandTotal,
        lines: data.lines.create,
      })),
    },
  };
  const prisma = {
    centre: {
      findFirst: jest.fn().mockResolvedValue({
        id: CENTRE,
        status: 'ACTIVE',
        name: 'Test Centre',
        timezone: 'Africa/Lagos',
      }),
    },
    department: { findMany: jest.fn().mockResolvedValue(departments) },
    paymentChannel: { findMany: jest.fn().mockResolvedValue(channels) },
    revenueLine: { findMany: jest.fn().mockResolvedValue([]) },
    revenueReport: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    importBatch: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      ...overrides.importBatch,
    },
    $transaction:
      overrides.transaction ??
      jest.fn(async (arg: unknown) =>
        typeof arg === 'function' ? (arg as (t: unknown) => unknown)(tx) : Promise.all(arg as []),
      ),
  };
  const storage = { put: jest.fn().mockResolvedValue('2026-10-27/key-report.csv') };
  const audit = { record: jest.fn().mockResolvedValue({}) };
  const service = new ImportsService(
    prisma as never,
    new RevenueParserService(),
    storage as never,
    audit as never,
  );
  return { service, prisma, storage, audit, tx };
}

const uploadDto = { centreId: CENTRE, periodStart: '2026-09-01', periodEnd: '2026-09-30' } as never;
const uploader = allCentresUser('uploader');
const reviewer = allCentresUser('reviewer');

describe('revenue import upload', () => {
  it('stores a content fingerprint and writes the audit event in the same transaction', async () => {
    const { service, tx, audit } = build();
    await service.upload(uploader, csvFile(GOOD), uploadDto);
    const data = tx.importBatch.create.mock.calls[0][0].data;
    expect(data.contentFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(data.status).toBe('READY_TO_COMMIT');
    expect(audit.record.mock.calls[0][1]).toBe(tx);
  });

  it.each(['DRAFT', 'SUSPENDED', 'ARCHIVED'])(
    'FR-CEN-009: rejects an upload to a %s centre',
    async (status) => {
      const { service, prisma, storage } = build();
      prisma.centre.findFirst.mockResolvedValue({
        id: CENTRE,
        status,
        name: 'Test Centre',
        timezone: 'Africa/Lagos',
      });
      await expect(service.upload(uploader, csvFile(GOOD), uploadDto)).rejects.toMatchObject({
        response: { code: 'CENTRE_NOT_ACTIVE' },
      });
      expect(storage.put).not.toHaveBeenCalled();
    },
  );

  it('blocks a renamed re-send of identical figures for the same centre and period', async () => {
    const existing = {
      id: 'old',
      status: 'COMMITTED',
      createdAt: D('2026-10-01'),
      fileName: 'a.csv',
    };
    // 1st lookup (file hash) misses because the bytes differ; 2nd (fingerprint) hits.
    const findFirst = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
    const { service, storage } = build({ importBatch: { findFirst } });
    const resend = 'Department,Cash,POS,Total Amount\nPharmacy,600,400,1000\n';
    await expect(
      service.upload(uploader, csvFile(resend, 'renamed.csv'), uploadDto),
    ).rejects.toMatchObject({
      response: { code: 'DUPLICATE_REPORT' },
    });
    expect(findFirst.mock.calls[1][0].where.contentFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('maps the database duplicate-report violation to a clear conflict', async () => {
    const violation = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    });
    // Only the write transaction (callback form) fails; the array-form lookups still succeed.
    const transaction = jest.fn(async (arg: unknown) =>
      typeof arg === 'function' ? Promise.reject(violation) : Promise.all(arg as []),
    );
    const { service } = build({ transaction });
    await expect(service.upload(uploader, csvFile(GOOD), uploadDto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('blocks days already reported and never touches the existing report', async () => {
    const { service, prisma, tx } = build();
    prisma.revenueReport.findMany.mockResolvedValue([
      {
        id: 'r0',
        periodStart: D('2026-09-01'),
        periodEnd: D('2026-09-30'),
        sourceFileName: 'earlier.csv',
      },
    ]);
    await service.upload(uploader, csvFile(GOOD), uploadDto);
    const data = tx.importBatch.create.mock.calls[0][0].data;
    expect(data.status).toBe('NEEDS_REVIEW');
    expect(data.validationJson.errors.map((e: { code: string }) => e.code)).toContain(
      'PERIOD_ALREADY_UPLOADED',
    );
    expect(tx.revenueReport.create).not.toHaveBeenCalled();
  });

  it('flags omitted days when the new report starts after a gap', async () => {
    const { service, prisma, tx } = build();
    prisma.revenueReport.findMany.mockResolvedValue([
      {
        id: 'r0',
        periodStart: D('2026-08-01'),
        periodEnd: D('2026-08-28'),
        sourceFileName: 'aug.csv',
      },
    ]);
    await service.upload(uploader, csvFile(GOOD), uploadDto);
    const data = tx.importBatch.create.mock.calls[0][0].data;
    expect(data.status).toBe('READY_TO_COMMIT');
    expect(data.validationJson.flags).toHaveLength(1);
    expect(data.validationJson.flags[0]).toMatchObject({
      code: 'PERIOD_GAP',
      missingFrom: '2026-08-29',
      missingTo: '2026-08-31',
      requiresAcknowledgement: true,
    });
  });

  describe('PDF reports', () => {
    const pdfFile = () =>
      ({
        buffer: Buffer.from('%PDF-1.4 test'),
        size: 13,
        originalname: 'daily.pdf',
      }) as never;
    const table = (rows: string[][], period: { start: string; end: string } | null) => ({
      rows: [['S/N', 'Revenue Department', 'Cash', 'POS', 'Total Amount'], ...rows],
      title: 'TEST CENTRE HOSPITAL',
      printDate: '2026-10-01',
      period,
      pages: 1,
      ignoredLines: ['Director of Finance & Accounts'],
    });
    const read = mockReadPdf;

    it('takes the period from the PDF when none is entered and records what was set aside', async () => {
      read.mockResolvedValue(
        table(
          [
            ['1', 'Pharmacy', '600.00', '400.00', '1,000.00'],
            ['', 'Grand Total', '600.00', '400.00', '1,000.00'],
          ],
          { start: '2026-09-01', end: '2026-09-30' },
        ),
      );
      const { service, tx } = build();
      await service.upload(uploader, pdfFile(), { centreId: CENTRE } as never);
      const data = tx.importBatch.create.mock.calls[0][0].data;
      expect(data.status).toBe('READY_TO_COMMIT');
      expect(data.periodStart.toISOString().slice(0, 10)).toBe('2026-09-01');
      expect(data.periodEnd.toISOString().slice(0, 10)).toBe('2026-09-30');
      expect(data.validationJson.source).toMatchObject({
        kind: 'PDF',
        ignoredLines: ['Director of Finance & Accounts'],
      });
    });

    it('rejects an entered period that disagrees with the PDF', async () => {
      read.mockResolvedValue(
        table([['1', 'Pharmacy', '1.00', '0.00', '1.00']], {
          start: '2026-09-01',
          end: '2026-09-30',
        }),
      );
      const { service } = build();
      await expect(
        service.upload(uploader, pdfFile(), {
          centreId: CENTRE,
          periodStart: '2026-09-02',
          periodEnd: '2026-09-30',
        } as never),
      ).rejects.toMatchObject({ response: { code: 'PERIOD_MISMATCH' } });
    });

    it('holds a PDF whose printed totals do not tally, naming the rows', async () => {
      read.mockResolvedValue(
        table(
          [
            ['1', 'Pharmacy', '600.00', '400.00', '1,500.00'],
            ['', 'Grand Total', '600.00', '400.00', '1,500.00'],
          ],
          { start: '2026-09-01', end: '2026-09-30' },
        ),
      );
      const { service, tx } = build();
      await service.upload(uploader, pdfFile(), { centreId: CENTRE } as never);
      const data = tx.importBatch.create.mock.calls[0][0].data;
      expect(data.status).toBe('NEEDS_REVIEW');
      const codes = data.validationJson.errors.map((e: { code: string }) => e.code);
      expect(codes).toEqual(
        expect.arrayContaining(['ROW_TOTAL_MISMATCH', 'CROSS_FOOTING_MISMATCH']),
      );
    });

    it('refuses a report printed before its period ended', async () => {
      read.mockResolvedValue({
        ...table([['1', 'Pharmacy', '1.00', '0.00', '1.00']], {
          start: '2026-09-01',
          end: '2026-09-30',
        }),
        printDate: '2026-09-15',
      });
      const { service, tx } = build();
      await service.upload(uploader, pdfFile(), { centreId: CENTRE } as never);
      const errors = tx.importBatch.create.mock.calls[0][0].data.validationJson.errors;
      expect(errors.map((e: { code: string }) => e.code)).toContain('PRINTED_BEFORE_PERIOD_END');
    });

    it('turns an unreadable PDF into a clear message, not a server error', async () => {
      read.mockRejectedValue(new Error('No revenue table was found in the PDF'));
      const { service } = build();
      await expect(
        service.upload(uploader, pdfFile(), { centreId: CENTRE } as never),
      ).rejects.toMatchObject({
        response: { code: 'IMPORT_PARSE_FAILED' },
      });
    });

    it('takes only the new days when earlier reports sit inside the file period', async () => {
      read.mockResolvedValue(
        table(
          [
            ['1', 'Pharmacy', '1,000.00', '500.00', '1,500.00'],
            ['', 'Grand Total', '1,000.00', '500.00', '1,500.00'],
          ],
          { start: '2026-09-01', end: '2026-09-30' },
        ),
      );
      const { service, prisma, tx } = build();
      prisma.revenueReport.findMany.mockResolvedValue([
        {
          id: 'r1',
          periodStart: D('2026-09-01'),
          periodEnd: D('2026-09-20'),
          sourceFileName: 'first.pdf',
        },
      ]);
      prisma.revenueLine.findMany.mockResolvedValue([
        {
          departmentId: 'dep-pharm',
          reportedTotal: '600.00',
          channelTotal: '600.00',
          amountsJson: { CASH: '400.00', POS: '200.00' },
        },
      ]);
      await service.upload(uploader, pdfFile(), { centreId: CENTRE } as never);
      const data = tx.importBatch.create.mock.calls[0][0].data;
      expect(data.status).toBe('READY_TO_COMMIT');
      expect(data.periodStart.toISOString().slice(0, 10)).toBe('2026-09-21');
      expect(data.periodEnd.toISOString().slice(0, 10)).toBe('2026-09-30');
      expect(data.totalAmount).toBe('900.00');
      expect(data.normalizedJson.lines[0]).toMatchObject({
        reportedTotal: '900.00',
        amounts: { CASH: '600.00', POS: '300.00' },
      });
      expect(data.validationJson.trim).toMatchObject({
        takenStart: '2026-09-21',
        takenEnd: '2026-09-30',
      });
      expect(data.validationJson.warnings.map((w: { code: string }) => w.code)).toContain(
        'ONLY_NEW_DAYS_TAKEN',
      );
      expect(data.validationJson.flags).toEqual([]);
    });

    it('does not trim when an existing report reaches outside the file period', async () => {
      read.mockResolvedValue(
        table(
          [
            ['1', 'Pharmacy', '600.00', '400.00', '1,000.00'],
            ['', 'Grand Total', '600.00', '400.00', '1,000.00'],
          ],
          { start: '2026-09-10', end: '2026-09-30' },
        ),
      );
      const { service, prisma, tx } = build();
      prisma.revenueReport.findMany.mockResolvedValue([
        {
          id: 'r1',
          periodStart: D('2026-09-01'),
          periodEnd: D('2026-09-15'),
          sourceFileName: 'sept.pdf',
        },
      ]);
      await service.upload(uploader, pdfFile(), { centreId: CENTRE } as never);
      const data = tx.importBatch.create.mock.calls[0][0].data;
      expect(data.status).toBe('NEEDS_REVIEW');
      const error = data.validationJson.errors.find(
        (e: { code: string }) => e.code === 'PERIOD_ALREADY_UPLOADED',
      );
      expect(error.message).toContain('not for each day');
    });

    it('holds the upload when the file shows less than is already recorded', async () => {
      read.mockResolvedValue(
        table(
          [
            ['1', 'Pharmacy', '100.00', '0.00', '100.00'],
            ['', 'Grand Total', '100.00', '0.00', '100.00'],
          ],
          { start: '2026-09-01', end: '2026-09-30' },
        ),
      );
      const { service, prisma, tx } = build();
      prisma.revenueReport.findMany.mockResolvedValue([
        {
          id: 'r1',
          periodStart: D('2026-09-01'),
          periodEnd: D('2026-09-20'),
          sourceFileName: 'first.pdf',
        },
      ]);
      prisma.revenueLine.findMany.mockResolvedValue([
        {
          departmentId: 'dep-pharm',
          reportedTotal: '600.00',
          channelTotal: '600.00',
          amountsJson: { CASH: '600.00', POS: '0.00' },
        },
      ]);
      await service.upload(uploader, pdfFile(), { centreId: CENTRE } as never);
      const data = tx.importBatch.create.mock.calls[0][0].data;
      expect(data.status).toBe('NEEDS_REVIEW');
      expect(data.validationJson.errors.map((e: { code: string }) => e.code)).toContain(
        'NEW_FIGURES_BELOW_RECORDED',
      );
    });

    it('rejects a file named .pdf that is not a PDF', async () => {
      const { service } = build();
      const fake = { buffer: Buffer.from('hello'), size: 5, originalname: 'x.pdf' } as never;
      await expect(
        service.upload(uploader, fake, { centreId: CENTRE } as never),
      ).rejects.toMatchObject({
        response: { code: 'INVALID_FILE_CONTENT' },
      });
    });

    it('adds missing departments and channels only for a user allowed to edit the centre', async () => {
      read.mockResolvedValue(
        table([['1', 'Brand New Unit', '5.00', '5.00', '10.00']], {
          start: '2026-09-01',
          end: '2026-09-30',
        }),
      );
      const { service, prisma } = build();
      prisma.department.findMany.mockResolvedValueOnce([]);
      await expect(
        service.upload(uploader, pdfFile(), { centreId: CENTRE, createMissing: 'true' } as never),
      ).rejects.toMatchObject({ response: { code: 'SETUP_NOT_PERMITTED' } });
    });
  });

  it('keeps a batch with a row-total mismatch out of the committable state', async () => {
    const { service, tx } = build();
    await service.upload(
      uploader,
      csvFile('Department,Cash,POS,Total Amount\nPharmacy,600.00,400.00,1500.00\n'),
      uploadDto,
    );
    expect(tx.importBatch.create.mock.calls[0][0].data.status).toBe('NEEDS_REVIEW');
  });

  it('rejects workbooks that carry macros or external links', async () => {
    const { service } = build();
    const zip = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('xl/vbaProject.bin'),
    ]);
    const file = { buffer: zip, size: zip.length, originalname: 'macro.xlsx' } as never;
    await expect(service.upload(uploader, file, uploadDto)).rejects.toMatchObject({
      response: { code: 'UNSAFE_FILE_CONTENT' },
    });
  });
});

describe('revenue import commit', () => {
  const lines = (variance = '0.00') => [
    {
      departmentId: 'dep-pharm',
      reportedTotal: '1000.00',
      channelTotal: '1000.00',
      variance,
      amounts: { CASH: '600.00', POS: '400.00' },
    },
  ];

  function batch(overrides: Record<string, unknown> = {}) {
    return {
      id: 'batch-1',
      organizationId: 'org-1',
      centreId: CENTRE,
      status: 'READY_TO_COMMIT',
      createdById: 'uploader',
      periodStart: D('2026-09-01'),
      periodEnd: D('2026-09-30'),
      fileName: 'report.csv',
      fileHash: 'hash',
      contentFingerprint: 'fp',
      committedReportId: null,
      validationJson: { errors: [], grandTotal: '1000.00', channelTotal: '1000.00' },
      normalizedJson: { reportDate: '2026-09-30', lines: lines() },
      ...overrides,
    };
  }

  it('maker-checker: the uploader cannot commit their own import', async () => {
    const { service, tx } = build({
      importBatch: { findFirst: jest.fn().mockResolvedValue(batch()) },
    });
    await expect(service.commit(uploader, 'batch-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.revenueReport.create).not.toHaveBeenCalled();
  });

  it('lets a different reviewer commit, carrying the fingerprint and auditing atomically', async () => {
    const { service, tx, audit } = build({
      importBatch: { findFirst: jest.fn().mockResolvedValue(batch()) },
    });
    const result = await service.commit(reviewer, 'batch-1');
    expect(result).toMatchObject({ status: 'COMMITTED', alreadyCommitted: false });
    expect(tx.revenueReport.create.mock.calls[0][0].data.contentFingerprint).toBe('fp');
    expect(audit.record.mock.calls[0][1]).toBe(tx);
  });

  it('INV-009: committing an already committed import returns the original report', async () => {
    const { service, tx } = build({
      importBatch: {
        findFirst: jest
          .fn()
          .mockResolvedValue(batch({ status: 'COMMITTED', committedReportId: 'report-9' })),
      },
    });
    const result = await service.commit(reviewer, 'batch-1');
    expect(result).toMatchObject({ reportId: 'report-9', alreadyCommitted: true });
    expect(tx.revenueReport.create).not.toHaveBeenCalled();
  });

  it('INV-001: refuses to commit lines whose variance exceeds tolerance', async () => {
    const { service } = build({
      importBatch: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            batch({ normalizedJson: { reportDate: '2026-09-30', lines: lines('100.00') } }),
          ),
      },
    });
    await expect(service.commit(reviewer, 'batch-1')).rejects.toMatchObject({
      response: { code: 'IMPORT_NOT_READY' },
    });
  });

  it('refuses to commit a batch that still has validation errors', async () => {
    const { service } = build({
      importBatch: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            batch({ status: 'NEEDS_REVIEW', validationJson: { errors: [{ code: 'X' }] } }),
          ),
      },
    });
    await expect(service.commit(reviewer, 'batch-1')).rejects.toMatchObject({
      response: { code: 'IMPORT_NOT_READY' },
    });
  });
});

describe('committing a held report with approved variance', () => {
  const tally = [
    {
      code: 'ROW_TOTAL_MISMATCH',
      row: 2,
      message: 'PHARMACY: reported total 1000.00 differs from the channel sum 900.00 by 100.00',
    },
    {
      code: 'GRAND_TOTAL_MISMATCH',
      row: 3,
      message: 'Printed grand total 1000.00 differs from the sum of the department totals 900.00',
    },
  ];
  const held = (overrides: Record<string, unknown> = {}) => ({
    id: 'batch-1',
    organizationId: 'org-1',
    centreId: CENTRE,
    status: 'NEEDS_REVIEW',
    createdById: 'uploader',
    periodStart: D('2026-09-01'),
    periodEnd: D('2026-09-30'),
    fileName: 'report.pdf',
    fileHash: 'hash',
    contentFingerprint: 'fp',
    committedReportId: null,
    validationJson: { errors: tally, grandTotal: '1000.00', channelTotal: '900.00', flags: [] },
    normalizedJson: {
      reportDate: '2026-09-30',
      lines: [
        {
          rowNumber: 2,
          rawDepartment: 'PHARMACY',
          departmentId: 'dep-pharm',
          reportedTotal: '1000.00',
          channelTotal: '900.00',
          variance: '100.00',
          amounts: { CASH: '600.00', POS: '300.00' },
        },
      ],
    },
    ...overrides,
  });
  const reason = 'Centre confirmed by phone that the printed total includes a late cheque';
  const withBatch = (batch: unknown) =>
    build({ importBatch: { findFirst: jest.fn().mockResolvedValue(batch) } });

  it('commits the report on its channel amounts and records who accepted what and why', async () => {
    const { service, tx, audit } = withBatch(held());
    const result = await service.commitWithVariance(reviewer, 'batch-1', { reason });
    expect(result).toMatchObject({
      status: 'COMMITTED',
      withVariance: true,
      grandTotal: '900.00',
      printedGrandTotal: '1000.00',
      difference: '100.00',
    });
    const data = tx.revenueReport.create.mock.calls[0][0].data;
    expect(data.grandTotal).toBe('900.00'); // the figure the rows evidence, not the printed 1,000
    expect(data.channelTotal).toBe('900.00');
    expect(data.varianceApprovedById).toBe('reviewer');
    expect(data.varianceReason).toBe(reason);
    expect(data.varianceJson).toMatchObject({
      printedGrandTotal: '1000.00',
      evidencedTotal: '900.00',
      difference: '100.00',
      findings: 2,
    });
    expect(data.lines.create[0]).toMatchObject({
      reportedTotal: '1000.00',
      channelTotal: '900.00',
      variance: '100.00',
    });
    // the held batch is claimed from NEEDS_REVIEW, and the audit event is in the same transaction
    expect(tx.importBatch.updateMany.mock.calls[0][0].where.status).toBe('NEEDS_REVIEW');
    expect(audit.record.mock.calls[0][0]).toMatchObject({
      action: 'IMPORT_COMMITTED_WITH_VARIANCE',
    });
    expect(audit.record.mock.calls[0][0].after).toMatchObject({
      varianceReason: reason,
      difference: '100.00',
    });
    expect(audit.record.mock.calls[0][1]).toBe(tx);
  });

  it('maker-checker: the uploader cannot approve their own report', async () => {
    const { service, tx } = withBatch(held());
    await expect(
      service.commitWithVariance(uploader, 'batch-1', { reason }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.revenueReport.create).not.toHaveBeenCalled();
  });

  it('refuses when anything other than a total difference is wrong, and says what', async () => {
    const { service, tx } = withBatch(
      held({
        validationJson: {
          errors: [
            ...tally,
            { code: 'UNKNOWN_DEPARTMENT', row: 5, message: 'Department "X" is not configured' },
          ],
          flags: [],
        },
      }),
    );
    await expect(service.commitWithVariance(reviewer, 'batch-1', { reason })).rejects.toMatchObject(
      {
        response: {
          code: 'VARIANCE_NOT_ALLOWED',
          details: [expect.objectContaining({ code: 'UNKNOWN_DEPARTMENT' })],
        },
      },
    );
    expect(tx.revenueReport.create).not.toHaveBeenCalled();
  });

  it('points to the normal commit when there is nothing to approve', async () => {
    const { service } = withBatch(
      held({ status: 'READY_TO_COMMIT', validationJson: { errors: [] } }),
    );
    await expect(service.commitWithVariance(reviewer, 'batch-1', { reason })).rejects.toMatchObject(
      {
        response: { code: 'VARIANCE_NOT_APPLICABLE' },
      },
    );
  });

  it('still needs the omitted-days reason when the report also skips days', async () => {
    const flagged = held({
      validationJson: {
        errors: tally,
        grandTotal: '1000.00',
        flags: [{ code: 'GAP', message: '12 Oct missing', requiresAcknowledgement: true }],
      },
    });
    const { service } = withBatch(flagged);
    await expect(service.commitWithVariance(reviewer, 'batch-1', { reason })).rejects.toMatchObject(
      {
        response: { code: 'ACKNOWLEDGEMENT_REQUIRED' },
      },
    );
  });

  it('returns the original report when approved twice, and never touches another centre', async () => {
    const done = withBatch(held({ status: 'COMMITTED', committedReportId: 'report-9' }));
    await expect(
      done.service.commitWithVariance(reviewer, 'batch-1', { reason }),
    ).resolves.toMatchObject({ reportId: 'report-9', alreadyCommitted: true });
    expect(done.tx.revenueReport.create).not.toHaveBeenCalled();
    const scoped = { ...reviewer, allCentres: false, centreIds: ['other-centre'] };
    await expect(
      withBatch(held()).service.commitWithVariance(scoped, 'batch-1', { reason }),
    ).rejects.toBeDefined();
  });

  it('the ordinary commit still refuses the same held report', async () => {
    const { service } = withBatch(held());
    await expect(service.commit(reviewer, 'batch-1')).rejects.toMatchObject({
      response: { code: 'IMPORT_NOT_READY' },
    });
  });
});

describe('what the API reveals and puts in headers', () => {
  it('never returns storage keys or the raw uploaded rows from an import', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 'b1',
      centreId: CENTRE,
      status: 'READY_TO_COMMIT',
      validationJson: { errors: [] },
    });
    const { service } = build({ importBatch: { findFirst } });
    await service.get(uploader, 'b1');
    expect(findFirst.mock.calls[0][0].omit).toMatchObject({ fileKey: true, rowsJson: true });
  });

  it('builds a download filename from safe characters only, whatever the centre code holds', async () => {
    const { service, prisma } = build();
    prisma.centre.findFirst.mockResolvedValue({
      id: CENTRE,
      code: 'A/B"\r\nX-Injected: yes',
      departments: [],
      paymentChannels: [],
    });
    const { fileName } = await service.template(uploader, CENTRE);
    expect(fileName).toMatch(/^revenue-template-[A-Za-z0-9_-]+\.csv$/);
    expect(fileName).not.toMatch(/[\r\n"/\\:]/);
  });

  it('neutralises spreadsheet formulas in the template header and rows', async () => {
    const { service, prisma } = build();
    prisma.centre.findFirst.mockResolvedValue({
      id: CENTRE,
      code: 'C1',
      departments: [{ name: '=HYPERLINK("http://evil.test")' }, { name: '+SUM(A1)' }],
      paymentChannels: [{ name: '@cmd' }],
    });
    const { content } = await service.template(uploader, CENTRE);
    expect(content).not.toMatch(/(^|,|\n)[=+@-]/);
    expect(content).toContain("'=HYPERLINK");
  });
});

describe('original file download', () => {
  it('returns the stored file with a safe name and records the download', async () => {
    const { service, prisma, storage, audit } = build();
    (prisma.importBatch as Record<string, jest.Mock>).findFirst.mockResolvedValue({
      id: 'b1',
      centreId: CENTRE,
      fileKey: 'k1',
      fileName: 'uath revenue (sept).pdf',
    });
    (storage as Record<string, jest.Mock>).get = jest
      .fn()
      .mockResolvedValue(Buffer.from('%PDF-1.4'));
    const file = await service.downloadSource(uploader, 'b1');
    expect(file.fileName).toBe('uath_revenue__sept_.pdf');
    expect(file.contentType).toBe('application/pdf');
    expect(audit.record.mock.calls[0][0]).toMatchObject({
      action: 'IMPORT_SOURCE_DOWNLOADED',
      targetId: 'b1',
    });
  });

  it('refuses a batch from another centre the caller cannot see', async () => {
    const { service, prisma } = build();
    (prisma.importBatch as Record<string, jest.Mock>).findFirst.mockResolvedValue({
      id: 'b2',
      centreId: 'other-centre',
      fileKey: 'k2',
      fileName: 'x.csv',
    });
    const scoped = { ...allCentresUser('s'), allCentres: false, centreIds: [CENTRE] };
    await expect(service.downloadSource(scoped, 'b2')).rejects.toMatchObject({ status: 404 });
  });
});
