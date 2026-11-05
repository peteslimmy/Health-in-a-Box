import { PrismaClient, RoundingMode, ChargeRunStatus, ImportStatus } from '@prisma/client';
import argon2 from 'argon2';
import { Decimal } from 'decimal.js';

import { PERMISSIONS, ROLE_PERMISSIONS } from './reference-data';

const prisma = new PrismaClient();

const DEMO = 'DEMO FIXTURE — replace with real data';

type HospitalSeed = {
  code: string;
  name: string;
  city: string;
  departments: Array<{ code: string; name: string; base: number; rate: number }>;
  paymentTermsDays: number;
};

const HOSPITALS: HospitalSeed[] = [
  {
    code: 'HNB-LAG-001',
    name: 'Lekki Phase 1 Hospital',
    city: 'Lagos',
    paymentTermsDays: 30,
    departments: [
      { code: 'CONSULT', name: 'Consultations', base: 1850000, rate: 4.5 },
      { code: 'DIAG', name: 'Diagnostics', base: 2650000, rate: 5 },
      { code: 'PHARM', name: 'Pharmacy', base: 3200000, rate: 3.25 },
      { code: 'PROC', name: 'Procedures', base: 1250000, rate: 5 },
    ],
  },
  {
    code: 'HNB-ABJ-002',
    name: 'Abuja Central Hospital',
    city: 'Abuja',
    paymentTermsDays: 30,
    departments: [
      { code: 'CONSULT', name: 'Consultations', base: 1420000, rate: 4 },
      { code: 'DIAG', name: 'Diagnostics', base: 1980000, rate: 5 },
      { code: 'PHARM', name: 'Pharmacy', base: 2240000, rate: 3 },
      { code: 'PROC', name: 'Procedures', base: 980000, rate: 5 },
    ],
  },
  {
    code: 'HNB-PHC-003',
    name: 'Port Harcourt Hospital',
    city: 'Port Harcourt',
    paymentTermsDays: 45,
    departments: [
      { code: 'CONSULT', name: 'Consultations', base: 980000, rate: 4 },
      { code: 'DIAG', name: 'Diagnostics', base: 1320000, rate: 4.75 },
      { code: 'PHARM', name: 'Pharmacy', base: 1610000, rate: 3.5 },
      { code: 'PROC', name: 'Procedures', base: 720000, rate: 5 },
    ],
  },
];

const CHANNELS = [
  { code: 'CASH', name: 'Cash' },
  { code: 'POS', name: 'POS' },
  { code: 'TRANSFER', name: 'Bank Transfer' },
  { code: 'HMO', name: 'HMO' },
];

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function roundCharge(base: Decimal, rate: Decimal): Decimal {
  return base.mul(rate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function splitChannels(total: Decimal, variant: number): Array<{ code: string; amount: Decimal }> {
  const weights = [0.28, 0.34, 0.26, 0.12].map((w, i) => w + ((variant + i) % 3) * 0.01);
  const sum = weights.reduce((a, b) => a + b, 0);
  const amounts = weights.map((w) =>
    total.mul(w).div(sum).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
  );
  const diff = total.minus(amounts.reduce((a, b) => a.plus(b), new Decimal(0)));
  amounts[0] = amounts[0].plus(diff);
  return CHANNELS.map((c, i) => ({ code: c.code, amount: amounts[i] }));
}

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: 'hnb-demo' },
    update: { name: 'HNB Demo Organisation' },
    create: { name: 'HNB Demo Organisation', slug: 'hnb-demo' },
  });

  const permissions = new Map<string, string>();
  for (const [code, name, group, description] of PERMISSIONS) {
    const p = await prisma.permission.upsert({
      where: { code },
      update: { name, group, description },
      create: { code, name, group, description },
    });
    permissions.set(code, p.id);
  }

  const roles = new Map<string, string>();
  for (const [code, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { organizationId_code: { organizationId: org.id, code } },
      update: { name: code.replace('_', ' '), isSystem: true },
      create: {
        organizationId: org.id,
        code,
        name: code.replace('_', ' '),
        description: `Seeded system role: ${code}`,
        isSystem: true,
      },
    });
    roles.set(code, role.id);
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: permissions.get(p)! })),
      skipDuplicates: true,
    });
  }

  // Reference data (permissions and roles) is always seeded above. Everything below creates
  // fake demo users, hospitals, reports, charges and payments, and must never reach production.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
    console.log('Reference data seeded. Demo data skipped because NODE_ENV=production.');
    return;
  }
  const password = process.env.SEED_DEMO_PASSWORD ?? 'HnbDemo#2026';
  const passwordHash = await argon2.hash(password);
  const users = [
    { email: 'admin@hnb.local', fullName: 'System Administrator', role: 'ADMIN' },
    { email: 'manager@hnb.local', fullName: 'Finance Manager', role: 'FINANCE_MANAGER' },
    { email: 'officer@hnb.local', fullName: 'Finance Officer', role: 'FINANCE_OFFICER' },
    { email: 'auditor@hnb.local', fullName: 'Internal Auditor', role: 'AUDITOR' },
  ];

  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { organizationId_email: { organizationId: org.id, email: u.email } },
      update: { fullName: u.fullName, isActive: true },
      create: {
        organizationId: org.id,
        email: u.email,
        fullName: u.fullName,
        passwordHash,
      },
    });
    await prisma.userRoleAssignment.deleteMany({ where: { userId: user.id } });
    await prisma.userRoleAssignment.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        roleId: roles.get(u.role)!,
        hospitalId: null,
      },
    });
  }

  // The demo accounts sign in with @hnb.local, so that domain must be approved for the organisation.
  const demoAdmin = await prisma.user.findFirstOrThrow({
    where: { organizationId: org.id, email: 'admin@hnb.local' },
    select: { id: true },
  });
  await prisma.approvedDomain.upsert({
    where: { organizationId_domain: { organizationId: org.id, domain: 'hnb.local' } },
    update: { isActive: true },
    create: {
      organizationId: org.id,
      domain: 'hnb.local',
      note: 'Demo accounts',
      createdById: demoAdmin.id,
    },
  });

  const hospitals = new Map<string, string>();
  const departments = new Map<string, string>();
  const rules = new Map<string, { id: string; rate: Decimal }>();

  for (const c of HOSPITALS) {
    const hospital = await prisma.hospital.upsert({
      where: { organizationId_code: { organizationId: org.id, code: c.code } },
      update: { name: c.name, status: 'ACTIVE', paymentTermsDays: c.paymentTermsDays },
      create: {
        organizationId: org.id,
        code: c.code,
        name: c.name,
        address: `${c.city}, Nigeria`,
        contactName: `${c.city} Hospital Manager`,
        contactEmail: `hospital.${c.code.toLowerCase()}@hnb.local`,
        status: 'ACTIVE',
        paymentTermsDays: c.paymentTermsDays,
        gracePeriodDays: 5,
        openedAt: new Date(Date.UTC(2022, 0, 15)),
        notes: DEMO,
      },
    });
    hospitals.set(c.code, hospital.id);

    for (const d of c.departments) {
      const dept = await prisma.department.upsert({
        where: { hospitalId_code: { hospitalId: hospital.id, code: d.code } },
        update: { name: d.name },
        create: { hospitalId: hospital.id, code: d.code, name: d.name },
      });
      departments.set(`${c.code}:${d.code}`, dept.id);

      let rule = await prisma.chargeRule.findFirst({
        where: { hospitalId: hospital.id, departmentId: dept.id, name: `${d.name} service charge` },
      });
      if (!rule) {
        rule = await prisma.chargeRule.create({
          data: {
            hospitalId: hospital.id,
            departmentId: dept.id,
            name: `${d.name} service charge`,
            basis: 'PERCENTAGE',
            rate: new Decimal(d.rate),
            effectiveFrom: new Date(Date.UTC(2023, 0, 1)),
            priority: 10,
            rounding: RoundingMode.HALF_UP,
            isActive: true,
          },
        });
      }
      rules.set(`${c.code}:${d.code}`, { id: rule.id, rate: new Decimal(d.rate) });
    }

    for (const ch of CHANNELS) {
      const channel = await prisma.paymentChannel.upsert({
        where: { hospitalId_code: { hospitalId: hospital.id, code: ch.code } },
        update: { name: ch.name },
        create: { hospitalId: hospital.id, code: ch.code, name: ch.name },
      });
      const aliases =
        ch.code === 'TRANSFER'
          ? ['bank', 'bank transfer', 'transfer']
          : ch.code === 'HMO'
            ? ['hmo', 'insurance']
            : [ch.code.toLowerCase(), ch.name.toLowerCase()];
      for (const alias of [...new Set(aliases)]) {
        await prisma.paymentChannelAlias.upsert({
          where: { channelId_alias: { channelId: channel.id, alias } },
          update: {},
          create: { channelId: channel.id, alias },
        });
      }
    }

    let agreement = await prisma.commercialAgreement.findFirst({
      where: { hospitalId: hospital.id, name: 'Demo master service-charge agreement' },
    });
    if (!agreement) {
      agreement = await prisma.commercialAgreement.create({
        data: {
          hospitalId: hospital.id,
          name: 'Demo master service-charge agreement',
          effectiveFrom: new Date(Date.UTC(2023, 0, 1)),
          status: 'ACTIVE',
          notes: DEMO,
        },
      });
    }
    await prisma.chargeRule.updateMany({
      where: { hospitalId: hospital.id, agreementId: null },
      data: { agreementId: agreement.id },
    });
  }

  const today = new Date();
  const currentMonth = startOfMonth(today);
  const createdReceivables: Array<{
    id: string;
    hospitalId: string;
    balance: Decimal;
    dueDate: Date;
  }> = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const month = addMonths(currentMonth, -offset);
    const periodStart = startOfMonth(month);
    const periodEnd =
      offset === 0
        ? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
        : endOfMonth(month);
    const reportDate = periodEnd;

    for (const c of HOSPITALS) {
      const hospitalId = hospitals.get(c.code)!;
      const hash = `demo-${c.code}-${periodStart.toISOString().slice(0, 10)}`;
      const existing = await prisma.revenueReport.findFirst({ where: { sourceFileHash: hash } });
      if (existing) continue;

      const variant = offset + c.code.length;
      const reportLines: Array<{
        departmentId: string;
        departmentCode: string;
        total: Decimal;
        channels: Array<{ code: string; amount: Decimal }>;
      }> = [];

      for (let di = 0; di < c.departments.length; di += 1) {
        const d = c.departments[di];
        const seasonal = new Decimal(1).plus(
          new Decimal(((offset * 7 + di * 13) % 11) - 5).div(100),
        );
        const total = new Decimal(d.base).mul(seasonal).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        reportLines.push({
          departmentId: departments.get(`${c.code}:${d.code}`)!,
          departmentCode: d.code,
          total,
          channels: splitChannels(total, variant + di),
        });
      }

      const grandTotal = reportLines.reduce((a, l) => a.plus(l.total), new Decimal(0));
      const channelTotal = reportLines.reduce(
        (a, l) => a.plus(l.channels.reduce((b, ch) => b.plus(ch.amount), new Decimal(0))),
        new Decimal(0),
      );

      const batch = await prisma.importBatch.create({
        data: {
          organizationId: org.id,
          hospitalId,
          status: ImportStatus.COMMITTED,
          fileName: `demo-revenue-${c.code}-${periodStart.toISOString().slice(0, 7)}.csv`,
          fileHash: hash,
          periodStart,
          periodEnd,
          rowCount: reportLines.length,
          validRowCount: reportLines.length,
          totalAmount: grandTotal,
          createdById: (await prisma.user.findFirst({
            where: { organizationId: org.id, email: 'officer@hnb.local' },
          }))!.id,
          validationJson: { demo: true, note: DEMO },
        },
      });

      const report = await prisma.revenueReport.create({
        data: {
          organizationId: org.id,
          hospitalId,
          periodStart,
          periodEnd,
          reportDate,
          status: 'COMMITTED',
          grandTotal,
          channelTotal,
          sourceFileName: `demo-revenue-${c.code}-${periodStart.toISOString().slice(0, 7)}.csv`,
          sourceFileHash: hash,
          importBatchId: batch.id,
          createdById: (await prisma.user.findFirst({
            where: { organizationId: org.id, email: 'officer@hnb.local' },
          }))!.id,
          lines: {
            create: reportLines.map((l) => {
              const channelSum = l.channels.reduce((a, ch) => a.plus(ch.amount), new Decimal(0));
              return {
                departmentId: l.departmentId,
                reportedTotal: l.total,
                channelTotal: channelSum,
                variance: l.total.minus(channelSum),
                amountsJson: Object.fromEntries(
                  l.channels.map((ch) => [ch.code, ch.amount.toFixed(2)]),
                ),
              };
            }),
          },
        },
        include: { lines: true },
      });

      await prisma.importBatch.update({
        where: { id: batch.id },
        data: { committedReportId: report.id },
      });

      const existingRun = await prisma.chargeRun.findFirst({
        where: { hospitalId, periodStart, periodEnd },
      });
      if (existingRun) continue;

      const creatorId = (await prisma.user.findFirst({
        where: { organizationId: org.id, email: 'officer@hnb.local' },
      }))!.id;
      const managerId = (await prisma.user.findFirst({
        where: { organizationId: org.id, email: 'manager@hnb.local' },
      }))!.id;
      const asOf = addDays(reportDate, 5);
      let baseTotal = new Decimal(0);
      let chargeTotal = new Decimal(0);

      const run = await prisma.chargeRun.create({
        data: {
          organizationId: org.id,
          hospitalId,
          periodStart,
          periodEnd,
          asOf,
          status: ChargeRunStatus.DRAFT,
          createdById: creatorId,
          rulesSnapshot: { demo: true, note: DEMO },
        },
      });

      for (const line of report.lines) {
        const dept = c.departments.find(
          (d) => departments.get(`${c.code}:${d.code}`) === line.departmentId,
        );
        if (!dept) continue;
        const rule = rules.get(`${c.code}:${dept.code}`)!;
        const base = new Decimal(line.reportedTotal);
        const charge = roundCharge(base, rule.rate);
        baseTotal = baseTotal.plus(base);
        chargeTotal = chargeTotal.plus(charge);
        await prisma.chargeLine.create({
          data: {
            chargeRunId: run.id,
            revenueLineId: line.id,
            departmentId: line.departmentId,
            ruleId: rule.id,
            baseAmount: base,
            rate: rule.rate,
            chargeAmount: charge,
            ruleName: `${dept.name} service charge`,
            traceJson: {
              basis: 'PERCENTAGE',
              calculation: `${base.toString()} x ${rule.rate.toString()}%`,
              demo: true,
            },
          },
        });
      }

      await prisma.chargeRun.update({
        where: { id: run.id },
        data: { baseTotal, chargeTotal },
      });

      if (offset === 0) {
        await prisma.chargeRun.update({
          where: { id: run.id },
          data: { status: ChargeRunStatus.DRAFT },
        });
        continue;
      }

      if (offset === 1) {
        await prisma.chargeRun.update({
          where: { id: run.id },
          data: { status: ChargeRunStatus.SUBMITTED, submittedAt: addDays(reportDate, 7) },
        });
        continue;
      }

      await prisma.chargeRun.update({
        where: { id: run.id },
        data: {
          status: ChargeRunStatus.POSTED,
          submittedAt: addDays(reportDate, 7),
          approvedById: managerId,
          approvedAt: addDays(reportDate, 9),
          postedAt: addDays(reportDate, 10),
        },
      });

      const runLines = await prisma.chargeLine.findMany({ where: { chargeRunId: run.id } });
      const dueDate = addDays(asOf, c.paymentTermsDays);
      for (const line of runLines) {
        const reference = `RCV-${c.code}-${periodStart.toISOString().slice(0, 7).replace('-', '')}-${line.id.slice(0, 4).toUpperCase()}`;
        const receivable = await prisma.receivable.create({
          data: {
            organizationId: org.id,
            hospitalId,
            chargeLineId: line.id,
            reference,
            description: `Service charge — ${line.ruleName ?? 'service charge'} — ${periodStart.toISOString().slice(0, 7)}`,
            originalAmount: line.chargeAmount,
            amountPaid: 0,
            balance: line.chargeAmount,
            dueDate,
            status: 'OPEN',
            ledgerEntries: {
              create: {
                organizationId: org.id,
                hospitalId,
                type: 'CHARGE',
                debit: line.chargeAmount,
                credit: 0,
                description: 'Service charge posted',
                occurredAt: addDays(reportDate, 10),
                createdById: managerId,
                sourceType: 'CHARGE_RUN',
                sourceId: run.id,
              },
            },
          },
        });
        createdReceivables.push({
          id: receivable.id,
          hospitalId,
          balance: new Decimal(receivable.balance),
          dueDate,
        });
      }
    }
  }

  const existingPayments = await prisma.payment.count({
    where: { organizationId: org.id, notes: DEMO },
  });
  if (existingPayments === 0) {
    const officerId = (await prisma.user.findFirst({
      where: { organizationId: org.id, email: 'officer@hnb.local' },
    }))!.id;
    for (const c of HOSPITALS) {
      const hospitalId = hospitals.get(c.code)!;
      const target = createdReceivables.filter((r) => r.hospitalId === hospitalId);
      if (!target.length) continue;
      const outstanding = target.reduce((a, r) => a.plus(r.balance), new Decimal(0));
      const receiptAmount = outstanding.mul(0.55).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      if (receiptAmount.lte(0)) continue;

      const payment = await prisma.payment.create({
        data: {
          organizationId: org.id,
          hospitalId,
          receiptDate: addDays(new Date(), -14),
          amount: receiptAmount,
          unallocatedAmount: receiptAmount,
          method: 'BANK_TRANSFER',
          reference: `DEMO-RECEIPT-${c.code}-01`,
          payerName: c.name,
          notes: DEMO,
          status: 'POSTED',
          postedAt: addDays(new Date(), -14),
          createdById: officerId,
        },
      });

      let remaining = receiptAmount;
      for (const r of target) {
        if (remaining.lte(0)) break;
        const alloc = Decimal.min(remaining, r.balance);
        if (alloc.lte(0)) continue;
        const fresh = await prisma.receivable.findUnique({ where: { id: r.id } });
        if (!fresh) continue;
        const newPaid = new Decimal(fresh.amountPaid).plus(alloc);
        const newBalance = new Decimal(fresh.originalAmount).minus(newPaid);
        await prisma.$transaction([
          prisma.paymentAllocation.create({
            data: { paymentId: payment.id, receivableId: r.id, amount: alloc },
          }),
          prisma.receivable.update({
            where: { id: r.id },
            data: {
              amountPaid: newPaid,
              balance: newBalance,
              status: newBalance.lte(0) ? 'PAID' : 'PARTIALLY_PAID',
            },
          }),
          prisma.ledgerEntry.create({
            data: {
              organizationId: org.id,
              hospitalId,
              receivableId: r.id,
              type: 'PAYMENT_ALLOCATION',
              debit: 0,
              credit: alloc,
              description: `Payment allocation ${payment.reference ?? payment.id}`,
              occurredAt: addDays(new Date(), -14),
              createdById: officerId,
              sourceType: 'PAYMENT',
              sourceId: payment.id,
            },
          }),
          prisma.payment.update({
            where: { id: payment.id },
            data: { unallocatedAmount: { decrement: alloc } },
          }),
        ]);
        remaining = remaining.minus(alloc);
        r.balance = r.balance.minus(alloc);
      }
      // Allocation state is derived from unallocatedAmount; the receipt stays POSTED.
    }
  }

  await prisma.auditEvent.create({
    data: {
      organizationId: org.id,
      action: 'DEMO_SEED',
      targetType: 'SYSTEM',
      summary: 'Demo dataset seeded. All records marked as demo fixtures.',
      after: { demo: true, note: DEMO },
    },
  });

  console.log('Seed complete.');
  console.log(
    process.env.SEED_DEMO_PASSWORD
      ? 'Demo accounts (password from SEED_DEMO_PASSWORD):'
      : 'Demo accounts (default demo password; set SEED_DEMO_PASSWORD to change it):',
  );
  for (const u of users) console.log(`  ${u.email}  ${u.role}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
