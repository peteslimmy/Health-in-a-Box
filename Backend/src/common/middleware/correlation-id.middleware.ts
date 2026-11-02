import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { runWithRequestContext } from '../request-context';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.header('x-correlation-id');
    const correlationId = incoming && incoming.length <= 128 ? incoming : randomUUID();
    (req as Request & { correlationId: string }).correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    runWithRequestContext({ correlationId }, () => next());
  }
}
