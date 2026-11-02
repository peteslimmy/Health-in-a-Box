import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccessDecision, evaluateAccess } from './access-rules';

/** How long the approved list is remembered. Changes made here clear it at once on this instance. */
export const DOMAIN_CACHE_MS = 15_000;

@Injectable()
export class AccessPolicyService {
  private readonly cache = new Map<string, { at: number; domains: Set<string> }>();

  constructor(private readonly prisma: PrismaService) {}

  async approvedDomains(organizationId: string): Promise<Set<string>> {
    const hit = this.cache.get(organizationId);
    if (hit && Date.now() - hit.at < DOMAIN_CACHE_MS) return hit.domains;
    const rows = await this.prisma.approvedDomain.findMany({
      where: { organizationId, isActive: true },
      select: { domain: true },
    });
    const domains = new Set(rows.map((row) => row.domain));
    this.cache.set(organizationId, { at: Date.now(), domains });
    return domains;
  }

  invalidate(organizationId: string) {
    this.cache.delete(organizationId);
  }

  async check(
    organizationId: string,
    email: string,
    isSuperAdmin: boolean,
  ): Promise<AccessDecision> {
    return evaluateAccess({
      email,
      isSuperAdmin,
      approvedDomains: await this.approvedDomains(organizationId),
    });
  }

  /** Throws a 403 with a readable reason when this address may not hold an account. */
  async assert(organizationId: string, email: string, isSuperAdmin: boolean): Promise<void> {
    const decision = await this.check(organizationId, email, isSuperAdmin);
    if (!decision.allowed) {
      throw new ForbiddenException({ code: decision.code, message: decision.message });
    }
  }
}
