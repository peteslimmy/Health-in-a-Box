import { Controller, Get, NotFoundException, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * What the sign-in page needs before anyone is signed in: the product name and the logo and favicon.
 * Public by design; it reveals nothing beyond what the page itself shows.
 */
@ApiTags('branding')
@Public()
@Controller('branding')
export class BrandingController {
  constructor(private readonly prisma: PrismaService) {}

  /** This is a single-organisation installation; the first organisation is the one that is shown. */
  private async organisation() {
    return this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
  }

  @Get()
  @ApiOperation({ summary: 'Product name, logo and favicon addresses' })
  async get() {
    const org = await this.organisation();
    if (!org) return { appName: 'HNB Receivables', tagline: null, logoUrl: null, faviconUrl: null };
    const [settings, assets] = await Promise.all([
      this.prisma.platformSetting.findUnique({ where: { organizationId: org.id } }),
      this.prisma.brandingAsset.findMany({
        where: { organizationId: org.id },
        select: { kind: true, sha256: true },
      }),
    ]);
    const url = (kind: 'LOGO' | 'FAVICON', path: string) => {
      const asset = assets.find((a) => a.kind === kind);
      // The version in the address makes a replaced image show at once despite caching.
      return asset ? `/api/v1/branding/${path}?v=${asset.sha256.slice(0, 12)}` : null;
    };
    return {
      appName: settings?.appName ?? 'HNB Receivables',
      tagline: settings?.tagline ?? null,
      logoUrl: url('LOGO', 'logo'),
      faviconUrl: url('FAVICON', 'favicon'),
    };
  }

  private async send(kind: 'LOGO' | 'FAVICON', res: Response) {
    const org = await this.organisation();
    const asset = org
      ? await this.prisma.brandingAsset.findUnique({
          where: { organizationId_kind: { organizationId: org.id, kind } },
        })
      : null;
    if (!asset) throw new NotFoundException('Not set');
    res.setHeader('Content-Type', asset.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(asset.data));
  }

  @Get('logo')
  logo(@Res() res: Response) {
    return this.send('LOGO', res);
  }

  @Get('favicon')
  favicon(@Res() res: Response) {
    return this.send('FAVICON', res);
  }
}
