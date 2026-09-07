import { Request } from 'express';
import { dateParam, intArrayParam, optIntParam, intParam } from './query';

export interface CommonFilters {
  from?: string;
  to?: string;
  regionIds: number[];
  taId?: number;
  drugId?: number;
  repId?: number;
  specialty?: string;
}

/** Extract the CONTRACT §4 common analytics filters from the query string. */
export function commonFilters(req: Request): CommonFilters {
  return {
    from: dateParam(req, 'from'),
    to: dateParam(req, 'to'),
    regionIds: intArrayParam(req, 'regionId'),
    taId: optIntParam(req, 'taId'),
    drugId: optIntParam(req, 'drugId'),
    repId: optIntParam(req, 'repId'),
    specialty: (req.query['specialty'] as string | undefined)?.trim() || undefined,
  };
}

export function limitParam(req: Request, fallback = 10, max = 200): number {
  return intParam(req, 'limit', fallback, { min: 1, max });
}
