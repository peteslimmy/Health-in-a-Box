import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { decryptSecret } from '../auth/mfa-crypto';
import { PrismaService } from '../prisma/prisma.service';

/** Key material for settings secrets: separate from the sign-in secret key by a fixed suffix. */
export function settingsKeyMaterial(config: ConfigService): string {
  const base =
    config.get<string>('MFA_ENCRYPTION_KEY') ??
    `${config.getOrThrow<string>('JWT_REFRESH_SECRET')}:mfa`;
  return `${base}:settings`;
}

export type MailMessage = { to: string; subject: string; text: string; html?: string };

@Injectable()
export class MailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Sends one message with the organisation's saved SMTP settings. Throws when none are saved or the server refuses. */
  async send(organizationId: string, message: MailMessage): Promise<{ messageId: string }> {
    const settings = await this.prisma.platformSetting.findUnique({ where: { organizationId } });
    if (!settings?.smtpHost || !settings.smtpPort || !settings.smtpFromEmail) {
      throw new ServiceUnavailableException({
        code: 'SMTP_NOT_CONFIGURED',
        message: 'Outgoing email is not set up yet',
      });
    }
    const password = settings.smtpPasswordEnc
      ? decryptSecret(settings.smtpPasswordEnc, settingsKeyMaterial(this.config))
      : undefined;
    const transport = createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: settings.smtpSecure,
      // Never send in the clear: when the connection starts unencrypted it must upgrade.
      requireTLS: !settings.smtpSecure,
      auth: settings.smtpUser ? { user: settings.smtpUser, pass: password ?? '' } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    try {
      const info = await transport.sendMail({
        from: { name: settings.smtpFromName ?? '', address: settings.smtpFromEmail },
        replyTo: settings.smtpReplyTo ?? undefined,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return { messageId: String(info.messageId ?? '') };
    } finally {
      transport.close();
    }
  }
}
