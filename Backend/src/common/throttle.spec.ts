import { Body, Controller, Get, HttpCode, INestApplication, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { THROTTLERS, emailOf, isLoginRequest } from './throttle';

@Controller('auth')
class FakeAuthController {
  @Post('login')
  @HttpCode(200)
  login(@Body() body: { email?: string }) {
    return { ok: Boolean(body) };
  }
}

@Controller('data')
class FakeDataController {
  @Get()
  read() {
    return { ok: true };
  }
}

describe('rate limiting (production configuration)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(THROTTLERS)],
      controllers: [FakeAuthController, FakeDataController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => app.close());

  const login = (email: string) => request(app.getHttpServer()).post('/auth/login').send({ email });

  it('blocks the 9th sign-in attempt for one account within a minute', async () => {
    for (let i = 0; i < 8; i += 1) await login('victim@example.com').expect(200);
    await login('victim@example.com').expect(429);
  });

  it('counts the same account however the email is written', async () => {
    for (let i = 0; i < 4; i += 1) await login('Victim@Example.com').expect(200);
    for (let i = 0; i < 4; i += 1) await login('  victim@example.com ').expect(200);
    await login('VICTIM@EXAMPLE.COM').expect(429);
  });

  it('does not let one locked account affect other accounts from the same address', async () => {
    for (let i = 0; i < 9; i += 1) await login('victim@example.com');
    await login('victim@example.com').expect(429);
    await login('someone.else@example.com').expect(200);
  });

  it('does not apply the account limit to other routes', async () => {
    for (let i = 0; i < 25; i += 1) await request(app.getHttpServer()).get('/data').expect(200);
  });

  it('describes sign-in requests precisely', () => {
    expect(isLoginRequest({ method: 'POST', path: '/api/v1/auth/login' })).toBe(true);
    expect(isLoginRequest({ method: 'GET', path: '/api/v1/auth/login' })).toBe(false);
    expect(isLoginRequest({ method: 'POST', path: '/api/v1/auth/refresh' })).toBe(false);
    expect(emailOf({ body: { email: '  A@B.Co ' } })).toBe('a@b.co');
    expect(emailOf({ body: { email: 42 } })).toBe('');
    expect(emailOf(undefined)).toBe('');
  });
});
