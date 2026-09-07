import bcrypt from 'bcrypt';
import { config } from '../config';
import { ApiError } from '../http/envelope';
import * as repo from '../repositories/auth.repo';
import {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  refreshExpiry,
} from '../auth/token';
import { UserDto, toUserDto } from '../repositories/auth.repo';
import { Role } from '../types';

function buildAccessToken(u: repo.UserRow): string {
  return signAccessToken({
    sub: u.user_id,
    email: u.email,
    role: u.role,
    repId: u.sales_rep_id,
    regionId: u.region_id,
  });
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: UserDto;
}

export async function register(input: {
  fullName: string;
  email: string;
  password: string;
  role: Role;
  repId?: number | null;
  regionId?: number | null;
}): Promise<UserDto> {
  const existing = await repo.findUserByEmail(input.email);
  if (existing) throw ApiError.validation('A user with that email already exists');

  // A SALES_REP must map to an existing rep; a MANAGER must map to a region.
  let repId = input.repId ?? null;
  let regionId = input.regionId ?? null;
  if (input.role === 'SALES_REP') {
    if (repId == null || !(await repo.repExists(repId))) {
      throw ApiError.validation('SALES_REP requires a valid repId');
    }
  }
  if (input.role === 'MANAGER') {
    const regions = await repo.listActiveRegionIds();
    if (regionId == null || !regions.includes(regionId)) {
      throw ApiError.validation('MANAGER requires a valid regionId');
    }
  }

  const passwordHash = await bcrypt.hash(input.password, config.bcryptCost);
  const userId = await repo.insertUser({
    fullName: input.fullName,
    email: input.email,
    passwordHash,
    role: input.role,
    repId,
    regionId,
  });
  const row = await repo.findUserById(userId);
  return toUserDto(row!);
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const user = await repo.findUserByEmail(email);
  // Constant-ish response — do not reveal whether the email exists.
  if (!user || !user.is_active) throw ApiError.unauthorized('Invalid email or password');
  const okPw = await bcrypt.compare(password, user.password_hash);
  if (!okPw) throw ApiError.unauthorized('Invalid email or password');

  const accessToken = buildAccessToken(user);
  const { token: refreshToken, hash } = generateRefreshToken();
  await repo.storeRefreshToken(user.user_id, hash, refreshExpiry());
  await repo.touchLastLogin(user.user_id);
  return { accessToken, refreshToken, user: toUserDto(user) };
}

export async function refresh(refreshToken: string): Promise<{ accessToken: string }> {
  const hash = hashToken(refreshToken);
  const row = await repo.findValidRefreshToken(hash);
  if (!row) throw ApiError.unauthorized('Invalid or expired refresh token');
  const user = await repo.findUserById(row.user_id);
  if (!user || !user.is_active) throw ApiError.unauthorized('User is no longer active');
  return { accessToken: buildAccessToken(user) };
}

export async function logout(refreshToken: string): Promise<void> {
  const hash = hashToken(refreshToken);
  await repo.revokeRefreshToken(hash); // idempotent; no error if already revoked/unknown
}

export async function me(userId: number): Promise<UserDto> {
  const user = await repo.findUserById(userId);
  if (!user) throw ApiError.notFound('User not found');
  return toUserDto(user);
}
