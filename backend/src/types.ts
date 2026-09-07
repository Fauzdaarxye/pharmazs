export type Role = 'ADMIN' | 'EXECUTIVE' | 'MANAGER' | 'SALES_REP' | 'ANALYST';

/** The authenticated principal, derived from a verified access token. */
export interface Principal {
  userId: number;
  email: string;
  role: Role;
  repId: number | null;
  regionId: number | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}

export {};
