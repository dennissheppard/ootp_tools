/**
 * Shared PostgREST helpers for CLI tools.
 *
 * Env vars (set in .env.local or export):
 *   SUPABASE_URL          — e.g. https://xxx.supabase.co
 *   SUPABASE_SERVICE_KEY  — service_role key (full write access, no RLS)
 *
 * Falls back to VITE_SUPABASE_URL if SUPABASE_URL not set.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Load .env.local (service key) then .env (URL) — no dotenv dependency
function loadEnvFile(filePath: string): void {
  try {
    const text = fs.readFileSync(filePath, 'utf-8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // File doesn't exist — that's fine
  }
}

// Resolve project root: tools/lib/supabase-client.ts → ../../
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
loadEnvFile(path.join(projectRoot, '.env.local'));
loadEnvFile(path.join(projectRoot, '.env'));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY.');
  console.error('Set them in .env.local or as environment variables.');
  console.error(`  SUPABASE_URL=${SUPABASE_URL || '(not set)'}`);
  console.error(`  SUPABASE_KEY=${SUPABASE_KEY ? '(set)' : '(not set)'}`);
  process.exit(1);
}

const HEADERS = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
};

// ──────────────────────────────────────────────
// Query (GET with auto-pagination)
// ──────────────────────────────────────────────

export async function supabaseQuery<T = any>(table: string, params: string): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const allRows: T[] = [];
  let offset = 0;

  while (true) {
    const sep = params ? '&' : '';
    const url = `${SUPABASE_URL}/rest/v1/${table}?${params}${sep}offset=${offset}&limit=${PAGE_SIZE}`;
    const response = await fetch(url, {
      headers: { ...HEADERS, 'Prefer': 'count=exact' },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`GET ${table} failed (${response.status}): ${body}`);
    }

    const rows: T[] = await response.json();
    allRows.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows;
}

// ──────────────────────────────────────────────
// Upsert (POST with dedup + batching)
// ──────────────────────────────────────────────

export async function supabasePost(table: string, rows: any[]): Promise<void> {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`POST ${table} failed (${response.status}): ${body}`);
  }
}

/**
 * Dedup rows by a composite key, then upsert in batches.
 * Prevents "cannot affect row a second time" errors.
 */
export async function supabaseUpsertBatches(
  table: string,
  rows: any[],
  batchSize = 500,
  onConflict?: string,
): Promise<number> {
  if (rows.length === 0) return 0;

  const url = `${SUPABASE_URL}/rest/v1/${table}${onConflict ? `?on_conflict=${onConflict}` : ''}`;
  let uploaded = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(batch),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`POST ${table} batch ${Math.floor(i / batchSize)} failed (${response.status}): ${body}`);
    }

    uploaded += batch.length;
    if (uploaded % 5000 === 0 || uploaded === rows.length) {
      console.log(`  ${table}: ${uploaded}/${rows.length} rows`);
    }
  }

  return uploaded;
}

// ──────────────────────────────────────────────
// RPC (call a PostgreSQL function)
// ──────────────────────────────────────────────

export async function supabaseRpc<T = any>(fn: string, args: Record<string, any> = {}): Promise<T> {
  const url = `${SUPABASE_URL}/rest/v1/rpc/${fn}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(args),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`RPC ${fn} failed (${response.status}): ${body}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : (undefined as any);
}

// ──────────────────────────────────────────────
// Delete
// ──────────────────────────────────────────────

/**
 * Delete rows from a table matching a PostgREST filter.
 * Example: supabaseDelete('batting_stats', 'year=eq.2021')
 */
export async function supabaseDelete(table: string, filter: string): Promise<number> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${filter}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { ...HEADERS, 'Prefer': 'count=exact' },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`DELETE ${table} failed (${response.status}): ${body}`);
  }

  const countHeader = response.headers.get('content-range');
  if (countHeader) {
    const match = countHeader.match(/\/(\d+)/);
    if (match) return parseInt(match[1], 10);
  }
  return 0;
}

// ──────────────────────────────────────────────
// CSV helpers
// ──────────────────────────────────────────────

export function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

export function toIntOrNull(val: string): number | null {
  if (!val || val === '') return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

export function toFloatOrNull(val: string): number | null {
  if (!val || val === '') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

// Column whitelists (match SupabaseDataService)
export const PITCHING_COLS = new Set([
  'id', 'player_id', 'year', 'team_id', 'game_id', 'league_id', 'level_id', 'split_id',
  'ip', 'ab', 'tb', 'ha', 'k', 'bf', 'rs', 'bb', 'r', 'er', 'gb', 'fb', 'pi', 'ipf',
  'g', 'gs', 'w', 'l', 's', 'sa', 'da', 'sh', 'sf', 'ta', 'hra', 'bk', 'ci', 'iw',
  'wp', 'hp', 'gf', 'dp', 'qs', 'svo', 'bs', 'ra', 'war', 'fip', 'babip', 'whip',
]);

export const BATTING_COLS = new Set([
  'id', 'player_id', 'year', 'team_id', 'game_id', 'league_id', 'level_id', 'split_id',
  'position', 'ab', 'h', 'k', 'pa', 'pitches_seen', 'g', 'gs', 'd', 't', 'hr', 'r',
  'rbi', 'sb', 'cs', 'bb', 'ibb', 'gdp', 'sh', 'sf', 'hp', 'ci', 'wpa', 'stint',
  'ubr', 'war',
]);

export const DECIMAL_COLS = new Set(['wpa', 'li', 'war', 'ra9war', 'ubr']);
export const STRING_COLS = new Set(['ip']);

export function filterColumns(rows: any[], allowedCols: Set<string>): any[] {
  return rows.map(row => {
    const filtered: any = {};
    for (const key of Object.keys(row)) {
      if (allowedCols.has(key)) filtered[key] = row[key];
    }
    return filtered;
  });
}

/**
 * Dedup rows by a key function. Keeps last occurrence.
 */
export function dedupRows(rows: any[], keyFn: (row: any) => string): any[] {
  const map = new Map<string, any>();
  for (const row of rows) {
    map.set(keyFn(row), row);
  }
  return Array.from(map.values());
}
