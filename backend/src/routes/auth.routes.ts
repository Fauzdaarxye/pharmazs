import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as service from '../services/auth.service';
import { ok } from '../http/envelope';
import { asyncHandler } from '../http/middleware';
import { parseBody } from '../http/query';
import { authenticate, principal } from '../auth/middleware';

const ROLES = ['ADMIN', 'EXECUTIVE', 'MANAGER', 'SALES_REP', 'ANALYST'] as const;

const registerSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email().max(160),
  password: z.string().min(8).max(200),
  role: z.enum(ROLES),
  repId: z.number().int().positive().optional(),
  regionId: z.number().int().positive().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

export const authRouter = Router();

authRouter.post(
  '/register',
  asyncHandler(async (req: Request, res: Response) => {
    const body = parseBody(registerSchema, req.body);
    const user = await service.register(body);
    res.status(201).json(ok(user));
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = parseBody(loginSchema, req.body);
    const result = await service.login(email, password);
    res.json(ok(result));
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = parseBody(refreshSchema, req.body);
    const result = await service.refresh(refreshToken);
    res.json(ok(result));
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = parseBody(refreshSchema, req.body);
    await service.logout(refreshToken);
    res.json(ok({ loggedOut: true }));
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = await service.me(principal(req).userId);
    res.json(ok(user));
  }),
);
