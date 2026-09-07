import { query, queryOne, execute, RowDataPacket } from '../db/pool';

export interface UserRow extends RowDataPacket {
  user_id: number;
  full_name: string;
  email: string;
  password_hash: string;
  role: 'ADMIN' | 'EXECUTIVE' | 'MANAGER' | 'SALES_REP' | 'ANALYST';
  sales_rep_id: number | null;
  region_id: number | null;
  is_active: number;
  last_login_at: string | null;
  created_at: string;
}

export interface UserDto {
  userId: number;
  fullName: string;
  email: string;
  role: UserRow['role'];
  repId: number | null;
  regionId: number | null;
  isActive: boolean;
  lastLoginAt: string | null;
}

export function toUserDto(r: UserRow): UserDto {
  return {
    userId: r.user_id,
    fullName: r.full_name,
    email: r.email,
    role: r.role,
    repId: r.sales_rep_id,
    regionId: r.region_id,
    isActive: !!r.is_active,
    lastLoginAt: r.last_login_at,
  };
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  return queryOne<UserRow>('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
}

export async function findUserById(userId: number): Promise<UserRow | null> {
  return queryOne<UserRow>('SELECT * FROM users WHERE user_id = ? LIMIT 1', [userId]);
}

export async function insertUser(u: {
  fullName: string;
  email: string;
  passwordHash: string;
  role: UserRow['role'];
  repId: number | null;
  regionId: number | null;
}): Promise<number> {
  const res = await execute(
    `INSERT INTO users (full_name, email, password_hash, role, sales_rep_id, region_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [u.fullName, u.email, u.passwordHash, u.role, u.repId, u.regionId],
  );
  return res.insertId;
}

export async function touchLastLogin(userId: number): Promise<void> {
  await execute('UPDATE users SET last_login_at = NOW() WHERE user_id = ?', [userId]);
}

// --- refresh tokens ---
interface RefreshRow extends RowDataPacket {
  token_id: number;
  user_id: number;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
}

export async function storeRefreshToken(userId: number, tokenHash: string, expiresAt: Date): Promise<void> {
  await execute(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [userId, tokenHash, expiresAt],
  );
}

export async function findValidRefreshToken(tokenHash: string): Promise<RefreshRow | null> {
  return queryOne<RefreshRow>(
    `SELECT * FROM refresh_tokens
      WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW()
      LIMIT 1`,
    [tokenHash],
  );
}

export async function revokeRefreshToken(tokenHash: string): Promise<number> {
  const res = await execute(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL',
    [tokenHash],
  );
  return res.affectedRows;
}

export async function listActiveRegionIds(): Promise<number[]> {
  const rows = await query<RowDataPacket & { region_id: number }>('SELECT region_id FROM regions');
  return rows.map((r) => r.region_id);
}

export async function repExists(repId: number): Promise<boolean> {
  const row = await queryOne<RowDataPacket>('SELECT rep_id FROM sales_reps WHERE rep_id = ?', [repId]);
  return !!row;
}
