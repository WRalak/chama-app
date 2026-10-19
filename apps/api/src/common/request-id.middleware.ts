import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import { AppRequest } from './request';

export function requestIdMiddleware(req: AppRequest, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  req.requestId = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}
