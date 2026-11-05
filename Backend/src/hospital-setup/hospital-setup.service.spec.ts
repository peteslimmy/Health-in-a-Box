import { ROLE_PERMISSIONS } from '../../prisma/reference-data';
import { allHospitalsUser, superAdminUser } from '../testing/fixtures';
import { HospitalSetupService } from './hospital-setup.service';
import { CommitSetupDto } from './dto/hospital-setup.dto';

jest.mock('../imports/file-extractor', () => ({
  extractFile: jest.fn(async () => ({
    rows: [
      ['S/N', 'Revenue Department', 'Cash', 'Total Amount'],
      ['1', 'PHARMACY', '10.00', '10.00'],
      ['', 'Grand Total', '10.00', '10.00'],
    ],
    pdf: null,
  })),
}));

const owner = superAdminUser('owner', ['hospitals.onboard']);
const scoped = { ...owner, allHospitals: false, hospitalIds: ['c1'] };

function build(overrides: { existing?: unknown; draftStatus?: string } = {}) {
  const created: Record<string, unknown[]> = {
    hospital: [],
    department: [],
    paymentChannel: [],
    agreement: [],
    rule: [],
  };
  const tx = {
    hospital: {
      create: jest.fn(async ({ data }) => {
        created.hospital.push(data);
        return { id: 'new-hospital', ...data };
      }),
    },
    department: { create: jest.fn(async ({ data }) => created.department.push(data)) },
    paymentChannel: { create: jest.fn(async ({ data }) => created.paymentChannel.push(data)) },
    commercialAgreement: {
      create: jest.fn(async ({ data }) => {
        created.agreement.push(data);
        return { id: 'agreement-1' };
      }),
    },
    chargeRule: { create: jest.fn(async ({ data }) => created.rule.push(data)) },
    hospitalSetupDraft: { update: jest.fn() },
  };
  const draftRow = {
    id: 'draft-1',
    organizationId: 'org-1',
    status: overrides.draftStatus ?? 'OPEN',
    fileName: 'uath.pdf',
    fileKey: 'k',
    analysisJson: {
      profile: { hospital: { suggestedName: 'X', suggestedCode: 'X' } },
      existingMatches: [],
    },
  };
  const prisma = {
    hospital: {
      findFirst: jest.fn(async () => overrides.existing ?? null),
      findMany: jest.fn(async () => []),
    },
    hospitalSetupDraft: {
      findFirst: jest.fn(async () => draftRow),
      create: jest.fn(async ({ data }) => ({ id: 'draft-1', createdAt: new Date(), ...data })),
      update: jest.fn(),
    },
    $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  };
  const storage = {
    put: jest.fn(async () => 'stored-key'),
    get: jest.fn(async () => Buffer.from('file')),
  };
  const audit = { record: jest.fn(async () => ({})) };
  const imports = { upload: jest.fn(async () => ({ id: 'import-1', status: 'READY_TO_COMMIT' })) };
  const service = new HospitalSetupService(
    prisma as never,
    storage as never,
    audit as never,
    imports as never,
  );
  return { service, prisma, tx, created, audit, imports, storage };
}

const dto = (extra: Partial<CommitSetupDto> = {}): CommitSetupDto => ({
  hospital: { code: 'uath', name: ' University of Abuja Teaching Hospital ' },
  departments: [
    {
      printedName: 'ACCIDENT & EMERGENCY',
      name: 'Accident and Emergency',
      code: 'accident_emergency',
    },
    { printedName: 'PHARMACY', name: 'Pharmacy', code: 'PHARMACY' },
  ],
  channels: [
    {
      printedHeading: 'Mobile Money',
      printedName: 'Mobile Money',
      name: 'Mobile Money',
      code: 'MOBILE_MONEY',
    } as never,
  ],
  ...extra,
});

const csvFile = () =>
  ({
    buffer: Buffer.from('a,b\n1,2\n'),
    size: 8,
    originalname: 'lekki.csv',
  }) as Express.Multer.File;

describe('who may use the wizard', () => {
  it('is for the super admin only: ADMIN lacks the permission, SUPER_ADMIN has it', () => {
    expect(ROLE_PERMISSIONS.SUPER_ADMIN).toContain('hospitals.onboard');
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain('hospitals.onboard');
    expect(ROLE_PERMISSIONS.FINANCE_MANAGER).not.toContain('hospitals.onboard');
    expect(ROLE_PERMISSIONS.FINANCE_OFFICER).not.toContain('hospitals.onboard');
    expect(ROLE_PERMISSIONS.AUDITOR).not.toContain('hospitals.onboard');
  });

  it('needs the super admin role even when the permission and every hospital are held', async () => {
    const { service } = build();
    const admin = allHospitalsUser('admin', ['hospitals.onboard']);
    await expect(service.analyse(admin, csvFile())).rejects.toMatchObject({
      response: { code: 'SUPER_ADMIN_REQUIRED' },
    });
    await expect(service.commit(admin, 'draft-1', dto())).rejects.toMatchObject({
      response: { code: 'SUPER_ADMIN_REQUIRED' },
    });
    await expect(service.listOpen(admin)).rejects.toMatchObject({
      response: { code: 'SUPER_ADMIN_REQUIRED' },
    });
  });

  it('also needs access to all hospitals, whatever the permission', async () => {
    const { service } = build();
    await expect(service.analyse(scoped, csvFile())).rejects.toMatchObject({
      response: { code: 'ALL_HOSPITALS_REQUIRED' },
    });
    await expect(service.commit(scoped, 'draft-1', dto())).rejects.toMatchObject({
      response: { code: 'ALL_HOSPITALS_REQUIRED' },
    });
    await expect(service.listOpen(scoped)).rejects.toBeDefined();
  });
});

describe('reading a file', () => {
  it('keeps the file and the findings as an open draft and creates no hospital', async () => {
    const { service, prisma, storage, tx } = build();
    const result = await service.analyse(owner, csvFile());
    expect(result.draftId).toBe('draft-1');
    expect(result.profile.departments.map((d) => d.name)).toEqual(['PHARMACY']);
    expect(storage.put).toHaveBeenCalled();
    expect(prisma.hospitalSetupDraft.create).toHaveBeenCalled();
    expect(tx.hospital.create).not.toHaveBeenCalled();
  });

  it('refuses unsupported types and disguised files', async () => {
    const { service } = build();
    await expect(
      service.analyse(owner, { buffer: Buffer.from('x'), size: 1, originalname: 'a.txt' } as never),
    ).rejects.toMatchObject({ response: { code: 'UNSUPPORTED_FILE_TYPE' } });
    await expect(
      service.analyse(owner, {
        buffer: Buffer.from('nope'),
        size: 4,
        originalname: 'a.pdf',
      } as never),
    ).rejects.toMatchObject({ response: { code: 'INVALID_FILE_CONTENT' } });
    await expect(service.analyse(owner, undefined)).rejects.toMatchObject({
      response: { code: 'FILE_REQUIRED' },
    });
  });
});

describe('creating the hospital', () => {
  it('creates the hospital, departments and channels together, remembering printed names as aliases', async () => {
    const { service, created, tx, audit } = build();
    const result = await service.commit(owner, 'draft-1', dto());
    expect(result.hospital).toMatchObject({
      code: 'UATH',
      name: 'University of Abuja Teaching Hospital',
      status: 'DRAFT',
    });
    expect(result.counts).toEqual({ departments: 2, channels: 1 });
    expect(created.department).toEqual([
      expect.objectContaining({
        code: 'ACCIDENT_EMERGENCY',
        aliases: { create: [{ alias: 'ACCIDENT & EMERGENCY' }] },
      }),
      // same words, different case: the existing matching already ignores case, so no alias needed
      expect.objectContaining({ code: 'PHARMACY', aliases: { create: [] } }),
    ]);
    expect(tx.hospitalSetupDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED', hospitalId: 'new-hospital' }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'HOSPITAL_CREATED' }),
      tx,
    );
  });

  it('adds the agreement and a hospital-default rule, and activates, when terms are given', async () => {
    const { service, created } = build();
    const result = await service.commit(
      owner,
      'draft-1',
      dto({
        terms: { agreementName: '2026 agreement', ratePercent: 7.5, effectiveFrom: '2026-09-25' },
        activate: true,
      }),
    );
    expect(result.hospital.status).toBe('ACTIVE');
    expect(created.agreement).toEqual([
      expect.objectContaining({ name: '2026 agreement', status: 'ACTIVE' }),
    ]);
    expect(created.rule).toEqual([
      expect.objectContaining({ basis: 'PERCENTAGE', agreementId: 'agreement-1', priority: 0 }),
    ]);
    expect(String((created.rule[0] as { rate: unknown }).rate)).toBe('7.5');
  });

  it('refuses to activate without terms, or to import without activating', async () => {
    const { service, tx } = build();
    await expect(service.commit(owner, 'draft-1', dto({ activate: true }))).rejects.toMatchObject({
      response: { code: 'TERMS_REQUIRED' },
    });
    await expect(service.commit(owner, 'draft-1', dto({ importNow: true }))).rejects.toMatchObject({
      response: { code: 'ACTIVATION_REQUIRED' },
    });
    expect(tx.hospital.create).not.toHaveBeenCalled();
  });

  it('refuses repeated codes or names in the lists, before anything is created', async () => {
    const { service, tx } = build();
    const twice = (field: 'code' | 'name') =>
      dto({
        departments: [
          { printedName: 'A', name: 'Pharmacy', code: 'PHARM' },
          {
            printedName: 'B',
            name: field === 'name' ? 'PHARMACY' : 'Surgery',
            code: field === 'code' ? 'pharm' : 'SURG',
          },
        ],
      });
    await expect(service.commit(owner, 'draft-1', twice('code'))).rejects.toMatchObject({
      response: { code: 'SETUP_DUPLICATE_CODE' },
    });
    await expect(service.commit(owner, 'draft-1', twice('name'))).rejects.toMatchObject({
      response: { code: 'SETUP_DUPLICATE_NAME' },
    });
    expect(tx.hospital.create).not.toHaveBeenCalled();
  });

  it('refuses a hospital whose code or name already exists', async () => {
    const { service, tx } = build({ existing: { code: 'UATH', name: 'Other' } });
    await expect(service.commit(owner, 'draft-1', dto())).rejects.toMatchObject({
      response: { code: 'HOSPITAL_EXISTS' },
    });
    expect(tx.hospital.create).not.toHaveBeenCalled();
  });

  it('refuses a finished or cancelled set-up', async () => {
    const { service } = build({ draftStatus: 'COMPLETED' });
    await expect(service.commit(owner, 'draft-1', dto())).rejects.toMatchObject({
      response: { code: 'SETUP_NOT_OPEN' },
    });
  });

  it('imports the report afterwards, and keeps the hospital if that import fails', async () => {
    const ok = build();
    const withImport = dto({
      terms: { agreementName: 'A', ratePercent: 5, effectiveFrom: '2026-09-25' },
      activate: true,
      importNow: true,
    });
    const good = await ok.service.commit(owner, 'draft-1', withImport);
    expect(good.import).toEqual({ id: 'import-1', status: 'READY_TO_COMMIT' });
    expect(ok.imports.upload).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({ originalname: 'uath.pdf' }),
      { hospitalId: 'new-hospital' },
    );

    const bad = build();
    bad.imports.upload.mockRejectedValueOnce({ response: { message: 'The PDF did not tally' } });
    const failed = await bad.service.commit(owner, 'draft-1', withImport);
    expect(failed.hospital.code).toBe('UATH');
    expect(failed.import).toBeNull();
    expect(failed.importError).toBe('The PDF did not tally');
  });
});
