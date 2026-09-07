import request from 'supertest';
import { Application } from 'express';

export const DEMO_PASSWORD = 'PharmaZs@2026';

export async function login(app: Application, email: string): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password: DEMO_PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return { accessToken: res.body.data.accessToken, refreshToken: res.body.data.refreshToken };
}

export function auth(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}
