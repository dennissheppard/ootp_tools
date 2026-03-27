/**
 * WBL API client — thin fetch wrapper for worldbaseballleague.org.
 *
 * Auth: x-api-key header (JSON API only; CSV endpoints are public).
 */

const WBL_BASE = 'https://worldbaseballleague.org';
const WBL_API_KEY = 'wbl_doback_gumbo_2020';

let wblCallCount = 0;
let wblBytesTransferred = 0;

export function getWblStats() {
  return { calls: wblCallCount, bytes: wblBytesTransferred };
}

export function resetWblStats() {
  wblCallCount = 0;
  wblBytesTransferred = 0;
}

export async function wblFetchJson<T = any>(
  endpoint: string,
  params?: Record<string, string | number>,
  retries = 2,
): Promise<T> {
  const url = new URL(endpoint, WBL_BASE);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    wblCallCount++;
    const res = await fetch(url.toString(), {
      headers: { 'x-api-key': WBL_API_KEY },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (attempt < retries && res.status >= 500) {
        console.warn(`  ⚠️ WBL ${endpoint} → ${res.status} (retry ${attempt + 1}/${retries})`);
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw new Error(`WBL ${endpoint} → ${res.status}: ${body}`);
    }

    const text = await res.text();
    wblBytesTransferred += new TextEncoder().encode(text).byteLength;
    return JSON.parse(text) as T;
  }

  throw new Error(`WBL ${endpoint} → exhausted retries`);
}

/**
 * Fetch a raw CSV file from the WBL server (public, no auth).
 */
export async function wblFetchCsv(path: string): Promise<string> {
  const url = new URL(path, WBL_BASE);
  wblCallCount++;
  const res = await fetch(url.toString());

  if (!res.ok) {
    throw new Error(`WBL CSV ${path} → ${res.status}`);
  }

  const text = await res.text();
  wblBytesTransferred += new TextEncoder().encode(text).byteLength;
  return text;
}

const WBL_FIREBASE_URL = 'https://wbl-gabs-machine-default-rtdb.firebaseio.com';

/**
 * Fetch JSON from the WBL Firebase Realtime Database (public, no auth).
 */
export async function wblFetchFirebase<T = any>(path: string): Promise<T> {
  const url = `${WBL_FIREBASE_URL}/${path}.json`;
  wblCallCount++;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`WBL Firebase ${path} → ${res.status}`);
  }

  const text = await res.text();
  wblBytesTransferred += new TextEncoder().encode(text).byteLength;
  return JSON.parse(text) as T;
}

/**
 * Fetch all pages of a paginated WBL stats endpoint.
 * Returns the combined `stats` array.
 */
export async function wblFetchAllStats<T = any>(
  endpoint: string,
  params: Record<string, string | number>,
): Promise<T[]> {
  const PAGE_SIZE = 2000;
  const allRows: T[] = [];
  let offset = 0;

  while (true) {
    const data = await wblFetchJson<{ stats: T[]; total: number }>(endpoint, {
      ...params,
      limit: PAGE_SIZE,
      offset,
    });

    allRows.push(...data.stats);

    if (allRows.length >= data.total || data.stats.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows;
}

/**
 * Fetch all pages of the WBL scout endpoint.
 * Returns the combined `ratings` array.
 */
export async function wblFetchAllScout<T = any>(
  endpoint: string,
  params: Record<string, string | number>,
): Promise<T[]> {
  const PAGE_SIZE = 2000;
  const allRows: T[] = [];
  let offset = 0;

  while (true) {
    const data = await wblFetchJson<{ ratings: T[]; total: number }>(endpoint, {
      ...params,
      limit: PAGE_SIZE,
      offset,
    });

    allRows.push(...data.ratings);

    if (allRows.length >= data.total || data.ratings.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows;
}

// Level string → league_id mapping
const LEVEL_TO_LEAGUE_ID: Record<string, number> = {
  WBL: 200,
  AAA: 201,
  AA: 202,
  A: 203,
  RL: 204,
  INT: -200,
};

export function levelToLeagueId(level: string): number {
  return LEVEL_TO_LEAGUE_ID[level.toUpperCase()] ?? 200;
}

// Level string → numeric level for players table
const LEVEL_TO_PLAYER_LEVEL: Record<string, string> = {
  WBL: '1',
  AAA: '2',
  AA: '3',
  A: '4',
  RL: '5',
  INT: '6', // IC
};

export function levelToPlayerLevel(level: string): string {
  return LEVEL_TO_PLAYER_LEVEL[level.toUpperCase()] ?? '1';
}
