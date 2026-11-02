import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { AccessPolicyService } from '../access/access-policy.service';
import {
  SUPER_ADMIN_ROLE,
  checkApprovableDomain,
  emailDomain,
  isGmailDomain,
} from '../access/access-rules';
import { encryptSecret } from '../auth/mfa-crypto';
import { AuditService } from '../common/services/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { DomainDto, ProfileDto, SmtpDto, SuperAdminDto, UpdateDomainDto } from './dto/platform.dto';
import { BrandingKindName, checkImage } from './image-rules';
import { MailService, settingsKeyMaterial } from './mail.service';
import { SMTP_PRESETS, checkSmtpHost } from './smtp-rules';

const KIND = { logo: 'LOGO', favicon: 'FAVICON' } as const;

/** What the API reveals about the SMTP settings: never the password, only whether one is saved. */
function smtpView(s: {
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  smtpUser: string | null;
  smtpPasswordEnc: string | null;
  smtpFromName: string | null;
  smtpFromEmail: string | null;
  smtpReplyTo: string | null;
  smtpUpdatedAt: Date | null;
  smtpLastTestAt: Date | null;
  smtpLastTestOk: boolean | null;
  smtpLastTestNote: string | null;
}) {
  return {
    configured: !!(s.smtpHost && s.smtpPort && s.smtpFromEmail),
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpSecure,
    user: s.smtpUser,
    hasPassword: !!s.smtpPasswordEnc,
    fromName: s.smtpFromName,
    fromEmail: s.smtpFromEmail,
    replyTo: s.smtpReplyTo,
    updatedAt: s.smtpUpdatedAt,
    lastTest: s.smtpLastTestAt
      ? { at: s.smtpLastTestAt, ok: s.smtpLastTestOk, note: s.smtpLastTestNote }
      : null,
  };
}

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly access: AccessPolicyService,
    private readonly mail: MailService,
    private readonly users: UsersService,
  ) {}

  // ---------- profile and SMTP ----------

  private async ensure(organizationId: string) {
    return this.prisma.platformSetting.upsert({
      where: { organizationId },
      update: {},
      create: { organizationId },
    });
  }

  async get(user: AuthUser) {
    const [settings, assets] = await Promise.all([
      this.ensure(user.organizationId),
      this.prisma.brandingAsset.findMany({
        where: { organizationId: user.organizationId },
        select: {
          kind: true,
          fileName: true,
          contentType: true,
          sizeBytes: true,
          sha256: true,
          updatedAt: true,
        },
      }),
    ]);
    return {
      profile: {
        appName: settings.appName,
        tagline: settings.tagline,
        supportEmail: settings.supportEmail,
      },
      smtp: smtpView(settings),
      presets: SMTP_PRESETS,
      branding: {
        logo: assets.find((a) => a.kind === 'LOGO') ?? null,
        favicon: assets.find((a) => a.kind === 'FAVICON') ?? null,
      },
    };
  }

  async saveProfile(user: AuthUser, dto: ProfileDto) {
    const before = await this.ensure(user.organizationId);
    const updated = await this.prisma.platformSetting.update({
      where: { organizationId: user.organizationId },
      data: {
        appName: dto.appName.trim(),
        tagline: dto.tagline?.trim() || null,
        supportEmail: dto.supportEmail?.trim().toLowerCase() || null,
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'PLATFORM_PROFILE_UPDATED',
      targetType: 'PlatformSetting',
      targetId: updated.id,
      summary: 'Updated the product name and support contact',
      before: {
        appName: before.appName,
        tagline: before.tagline,
        supportEmail: before.supportEmail,
      },
      after: {
        appName: updated.appName,
        tagline: updated.tagline,
        supportEmail: updated.supportEmail,
      },
    });
    return this.get(user);
  }

  async saveSmtp(user: AuthUser, dto: SmtpDto) {
    const host = checkSmtpHost(dto.host);
    if (!host.ok) {
      throw new BadRequestException({ code: 'SMTP_HOST_INVALID', message: host.message });
    }
    const before = await this.ensure(user.organizationId);
    if (!dto.password && dto.user && !before.smtpPasswordEnc) {
      throw new BadRequestException({
        code: 'SMTP_PASSWORD_REQUIRED',
        message: 'Enter the SMTP password or API key for this user',
      });
    }
    const updated = await this.prisma.platformSetting.update({
      where: { organizationId: user.organizationId },
      data: {
        smtpHost: host.host,
        smtpPort: dto.port,
        smtpSecure: dto.secure,
        smtpUser: dto.user?.trim() || null,
        // A new password replaces the saved one; leaving it out keeps it. No user means no login.
        ...(dto.user?.trim()
          ? dto.password
            ? { smtpPasswordEnc: encryptSecret(dto.password, settingsKeyMaterial(this.config)) }
            : {}
          : { smtpPasswordEnc: null }),
        smtpFromName: dto.fromName.trim(),
        smtpFromEmail: dto.fromEmail.trim().toLowerCase(),
        smtpReplyTo: dto.replyTo?.trim().toLowerCase() || null,
        smtpUpdatedAt: new Date(),
        smtpUpdatedById: user.id,
        // A changed setup has not been tested yet.
        smtpLastTestAt: null,
        smtpLastTestOk: null,
        smtpLastTestNote: null,
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'SMTP_SETTINGS_UPDATED',
      targetType: 'PlatformSetting',
      targetId: updated.id,
      summary: `Saved outgoing email settings (${updated.smtpHost}:${updated.smtpPort})`,
      // The password is never written to the audit trail.
      before: {
        host: before.smtpHost,
        port: before.smtpPort,
        user: before.smtpUser,
        fromEmail: before.smtpFromEmail,
      },
      after: {
        host: updated.smtpHost,
        port: updated.smtpPort,
        user: updated.smtpUser,
        fromEmail: updated.smtpFromEmail,
        passwordChanged: !!dto.password,
      },
    });
    return this.get(user);
  }

  async clearSmtp(user: AuthUser) {
    await this.ensure(user.organizationId);
    await this.prisma.platformSetting.update({
      where: { organizationId: user.organizationId },
      data: {
        smtpHost: null,
        smtpPort: null,
        smtpUser: null,
        smtpPasswordEnc: null,
        smtpFromName: null,
        smtpFromEmail: null,
        smtpReplyTo: null,
        smtpUpdatedAt: new Date(),
        smtpUpdatedById: user.id,
        smtpLastTestAt: null,
        smtpLastTestOk: null,
        smtpLastTestNote: null,
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'SMTP_SETTINGS_CLEARED',
      targetType: 'PlatformSetting',
      summary: 'Removed the outgoing email settings',
    });
    return this.get(user);
  }

  /** Sends a real message with the saved settings and records whether it worked. */
  async testSmtp(user: AuthUser, to: string) {
    const settings = await this.ensure(user.organizationId);
    let ok = true;
    let note = 'Test message accepted by the mail server';
    try {
      await this.mail.send(user.organizationId, {
        to,
        subject: `${settings.appName}: test email`,
        text: `This is a test from ${settings.appName}. If you can read it, outgoing email is working.\n\nSent by ${user.email}.`,
      });
    } catch (error) {
      ok = false;
      const raw = error as { response?: { message?: string }; message?: string; code?: string };
      note = (raw.response?.message ?? raw.message ?? 'The mail server refused the message').slice(
        0,
        300,
      );
    }
    await this.prisma.platformSetting.update({
      where: { organizationId: user.organizationId },
      data: { smtpLastTestAt: new Date(), smtpLastTestOk: ok, smtpLastTestNote: note },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'SMTP_TEST_SENT',
      targetType: 'PlatformSetting',
      summary: `Sent a test email to ${to}: ${ok ? 'accepted' : 'failed'}`,
      after: { ok, note },
    });
    return { ok, note };
  }

  // ---------- logo and favicon ----------

  async saveAsset(user: AuthUser, kind: BrandingKindName, file: Express.Multer.File | undefined) {
    if (!file?.buffer?.length) {
      throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Choose an image file' });
    }
    const checked = checkImage(kind, file.buffer);
    if (!checked.ok) {
      throw new UnprocessableEntityException({ code: 'IMAGE_INVALID', message: checked.message });
    }
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const fileName = (file.originalname || kind).replace(/[^A-Za-z0-9._-]/g, '_').slice(-80);
    await this.ensure(user.organizationId);
    await this.prisma.brandingAsset.upsert({
      where: { organizationId_kind: { organizationId: user.organizationId, kind: KIND[kind] } },
      update: {
        fileName,
        contentType: checked.contentType,
        data: new Uint8Array(file.buffer),
        sizeBytes: file.buffer.length,
        sha256,
        updatedById: user.id,
      },
      create: {
        organizationId: user.organizationId,
        kind: KIND[kind],
        fileName,
        contentType: checked.contentType,
        data: new Uint8Array(file.buffer),
        sizeBytes: file.buffer.length,
        sha256,
        updatedById: user.id,
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'BRANDING_UPDATED',
      targetType: 'BrandingAsset',
      summary: `Replaced the ${kind} (${fileName}, ${file.buffer.length} bytes)`,
      after: { kind, sha256, contentType: checked.contentType },
    });
    return this.get(user);
  }

  async removeAsset(user: AuthUser, kind: BrandingKindName) {
    const result = await this.prisma.brandingAsset.deleteMany({
      where: { organizationId: user.organizationId, kind: KIND[kind] },
    });
    if (result.count > 0) {
      await this.audit.record({
        organizationId: user.organizationId,
        actorId: user.id,
        action: 'BRANDING_REMOVED',
        targetType: 'BrandingAsset',
        summary: `Removed the ${kind}`,
      });
    }
    return this.get(user);
  }

  // ---------- approved domains ----------

  async listDomains(user: AuthUser) {
    const [domains, people] = await Promise.all([
      this.prisma.approvedDomain.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { domain: 'asc' },
      }),
      this.prisma.user.findMany({
        where: { organizationId: user.organizationId, isActive: true },
        select: { email: true },
      }),
    ]);
    const counts = new Map<string, number>();
    for (const person of people) {
      const domain = emailDomain(person.email);
      if (domain) counts.set(domain, (counts.get(domain) ?? 0) + 1);
    }
    return {
      domains: domains.map((d) => ({
        id: d.id,
        domain: d.domain,
        note: d.note,
        isActive: d.isActive,
        createdAt: d.createdAt,
        accounts: counts.get(d.domain) ?? 0,
      })),
      // People whose address is no longer allowed (their domain was removed, or a Gmail address that is not a super admin).
      blockedAccounts: await this.blockedAccounts(user.organizationId),
      rule: 'Gmail addresses are blocked for everyone except registered super admins. All other people need an email at an approved domain.',
    };
  }

  private async blockedAccounts(organizationId: string) {
    const [people] = await Promise.all([
      this.prisma.user.findMany({
        where: { organizationId, isActive: true },
        select: {
          id: true,
          email: true,
          fullName: true,
          roleAssignments: { select: { role: { select: { code: true } } } },
        },
      }),
    ]);
    const blocked: Array<{ id: string; email: string; fullName: string; reason: string }> = [];
    for (const person of people) {
      const isSuper = person.roleAssignments.some((a) => a.role.code === SUPER_ADMIN_ROLE);
      const decision = await this.access.check(organizationId, person.email, isSuper);
      if (!decision.allowed) {
        blocked.push({
          id: person.id,
          email: person.email,
          fullName: person.fullName,
          reason: decision.message,
        });
      }
    }
    return blocked;
  }

  async addDomain(user: AuthUser, dto: DomainDto) {
    const checked = checkApprovableDomain(dto.domain);
    if (!checked.ok) {
      throw new BadRequestException({ code: 'DOMAIN_INVALID', message: checked.message });
    }
    const existing = await this.prisma.approvedDomain.findUnique({
      where: {
        organizationId_domain: { organizationId: user.organizationId, domain: checked.domain },
      },
    });
    if (existing) {
      throw new ConflictException({
        code: 'DOMAIN_EXISTS',
        message: `${checked.domain} is already on the list${existing.isActive ? '' : ' (switched off)'}`,
      });
    }
    const created = await this.prisma.approvedDomain.create({
      data: {
        organizationId: user.organizationId,
        domain: checked.domain,
        note: dto.note?.trim() || null,
        createdById: user.id,
      },
    });
    this.access.invalidate(user.organizationId);
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'DOMAIN_APPROVED',
      targetType: 'ApprovedDomain',
      targetId: created.id,
      summary: `Approved the email domain ${created.domain}`,
      after: { domain: created.domain, note: created.note },
    });
    return this.listDomains(user);
  }

  async updateDomain(user: AuthUser, id: string, dto: UpdateDomainDto) {
    const existing = await this.prisma.approvedDomain.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!existing) throw new NotFoundException('Domain not found');
    await this.prisma.approvedDomain.update({
      where: { id },
      data: {
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.note !== undefined ? { note: dto.note.trim() || null } : {}),
      },
    });
    this.access.invalidate(user.organizationId);
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action:
        dto.isActive === undefined
          ? 'DOMAIN_UPDATED'
          : dto.isActive
            ? 'DOMAIN_ENABLED'
            : 'DOMAIN_DISABLED',
      targetType: 'ApprovedDomain',
      targetId: id,
      summary: `${dto.isActive === false ? 'Switched off' : dto.isActive ? 'Switched on' : 'Updated'} the email domain ${existing.domain}`,
    });
    return this.listDomains(user);
  }

  async removeDomain(user: AuthUser, id: string) {
    const existing = await this.prisma.approvedDomain.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!existing) throw new NotFoundException('Domain not found');
    await this.prisma.approvedDomain.delete({ where: { id } });
    this.access.invalidate(user.organizationId);
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'DOMAIN_REMOVED',
      targetType: 'ApprovedDomain',
      targetId: id,
      summary: `Removed the email domain ${existing.domain}; people at that domain can no longer sign in`,
    });
    return this.listDomains(user);
  }

  // ---------- registered super admins ----------

  async listSuperAdmins(user: AuthUser) {
    const people = await this.prisma.user.findMany({
      where: {
        organizationId: user.organizationId,
        roleAssignments: { some: { role: { code: SUPER_ADMIN_ROLE } } },
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
        mfaEnabled: true,
        lastLoginAt: true,
      },
      orderBy: { email: 'asc' },
    });
    return {
      superAdmins: people,
      rule: 'Super admins are registered with a Gmail address. Gmail cannot be used by anyone else.',
    };
  }

  async addSuperAdmin(user: AuthUser, dto: SuperAdminDto) {
    const domain = emailDomain(dto.email);
    if (!domain || !isGmailDomain(domain)) {
      throw new BadRequestException({
        code: 'SUPER_ADMIN_NEEDS_GMAIL',
        message: 'A super admin must be registered with a Gmail address',
      });
    }
    const role = await this.prisma.role.findFirst({
      where: { organizationId: user.organizationId, code: SUPER_ADMIN_ROLE, isActive: true },
    });
    if (!role) throw new NotFoundException('The super admin role is not set up');
    await this.users.create(user, {
      email: dto.email,
      fullName: dto.fullName,
      password: dto.password,
      assignments: [{ roleId: role.id }],
    } as never);
    return this.listSuperAdmins(user);
  }
}
