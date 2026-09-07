import { query, RowDataPacket } from '../db/pool';
import { Principal } from '../types';
import { dataDateRange } from './common.repo';

export interface FilterData {
  regions: { regionId: number; regionName: string }[];
  therapeuticAreas: { taId: number; taName: string }[];
  products: { drugId: number; drugName: string }[];
  reps: { repId: number; fullName: string }[];
  specialties: string[];
  dateRange: { min: string; max: string };
}

export async function getFilters(p: Principal): Promise<FilterData> {
  // Managers see only their region in the filter lists.
  const regionWhere = p.role === 'MANAGER' && p.regionId != null ? 'WHERE region_id = ?' : '';
  const regionParams = p.role === 'MANAGER' && p.regionId != null ? [p.regionId] : [];

  const [regions, tas, products, reps, specialties, range] = await Promise.all([
    query<RowDataPacket & { regionId: number; regionName: string }>(
      `SELECT region_id AS regionId, region_name AS regionName FROM regions ${regionWhere} ORDER BY region_name`,
      regionParams,
    ),
    query<RowDataPacket & { taId: number; taName: string }>(
      'SELECT ta_id AS taId, ta_name AS taName FROM therapeutic_areas ORDER BY ta_name',
    ),
    query<RowDataPacket & { drugId: number; drugName: string }>(
      'SELECT drug_id AS drugId, drug_name AS drugName FROM drugs WHERE is_active=1 ORDER BY drug_name',
    ),
    query<RowDataPacket & { repId: number; fullName: string }>(
      `SELECT rep_id AS repId, full_name AS fullName FROM sales_reps WHERE is_active=1 ${
        p.role === 'MANAGER' && p.regionId != null ? 'AND region_id = ?' : ''
      } ORDER BY full_name`,
      p.role === 'MANAGER' && p.regionId != null ? [p.regionId] : [],
    ),
    query<RowDataPacket & { specialty: string }>('SELECT DISTINCT specialty FROM hcps ORDER BY specialty'),
    dataDateRange(),
  ]);

  return {
    regions,
    therapeuticAreas: tas,
    products,
    reps,
    specialties: specialties.map((s) => s.specialty),
    dateRange: range,
  };
}
