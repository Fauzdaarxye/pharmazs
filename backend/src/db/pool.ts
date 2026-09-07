import mysql, { Pool, PoolOptions, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { config } from '../config';

const opts: PoolOptions = {
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  queueLimit: 0,
  namedPlaceholders: false,
  dateStrings: true, // return DATE/DATETIME as strings so we control formatting
  decimalNumbers: true, // DECIMAL columns come back as JS numbers (money in rupees)
};
if (config.db.socketPath) {
  opts.socketPath = config.db.socketPath;
}

export const pool: Pool = mysql.createPool(opts);

/** Run a parameterised query and get typed rows. SQL must always use `?` placeholders. */
export async function query<T extends RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await pool.query<T[]>(sql, params);
  return rows;
}

/** Run a single-row query, returning the first row or null. */
export async function queryOne<T extends RowDataPacket>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** Run an INSERT/UPDATE/DELETE and get the result header. */
export async function execute(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [res] = await pool.execute<ResultSetHeader>(sql, params as unknown[] as never);
  return res;
}

export async function ping(): Promise<boolean> {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
    return true;
  } finally {
    conn.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

export type { RowDataPacket, ResultSetHeader };
