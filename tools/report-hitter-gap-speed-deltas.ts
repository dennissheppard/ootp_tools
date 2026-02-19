/**
 * Report how much hitter TFR Gap/Speed changed after switching to MLB-based
 * distributions (instead of prospect-pool ranking).
 *
 * Usage:
 *   npx tsx tools/report-hitter-gap-speed-deltas.ts --year=2021
 *   npx tsx tools/report-hitter-gap-speed-deltas.ts --year=2021 --playerId=14422
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

class MemoryStorage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [k, ...rest] = arg.slice(2).split('=');
    out[k] = rest.join('=');
  }
  return out;
}

function toUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

async function setupNodeEnvironment(): Promise<void> {
  const storage = new MemoryStorage();
  (globalThis as any).localStorage = storage;

  const windowStub = {
    localStorage: storage,
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  (globalThis as any).window = windowStub;

  const API_BASE_URL = 'https://atl-01.statsplus.net/world';
  const nativeFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = toUrl(input);

    if (url.startsWith('/api/')) {
      return nativeFetch(`${API_BASE_URL}${url}`, init);
    }

    if (url.startsWith('/data/')) {
      const relPath = url.replace(/^\/+/, '');
      const filePath = path.join(process.cwd(), 'public', relPath);
      try {
        const body = await fs.readFile(filePath);
        return new Response(body, { status: 200 });
      } catch {
        return new Response('Not Found', { status: 404, statusText: 'Not Found' });
      }
    }

    return nativeFetch(input as any, init);
  };
}

async function seedDefaultScouting(year: number): Promise<void> {
  const { scoutingDataService } = await import('../src/services/ScoutingDataService');
  const { hitterScoutingDataService } = await import('../src/services/HitterScoutingDataService');

  const pitcherCsvPath = path.join(process.cwd(), 'public', 'data', 'default_osa_scouting.csv');
  const hitterCsvPath = path.join(process.cwd(), 'public', 'data', 'default_hitter_osa_scouting.csv');
  const ymd = `${year}-12-31`;

  try {
    const pitcherCsv = await fs.readFile(pitcherCsvPath, 'utf8');
    const pitcherRatings = scoutingDataService.parseScoutingCsv(pitcherCsv, 'osa');
    localStorage.setItem(`wbl_scouting_ratings_${ymd}_osa`, JSON.stringify(pitcherRatings));
  } catch {
    // optional seed
  }

  try {
    const hitterCsv = await fs.readFile(hitterCsvPath, 'utf8');
    const hitterRatings = hitterScoutingDataService.parseScoutingCsv(hitterCsv, 'osa');
    localStorage.setItem(`wbl_hitter_scouting_ratings_${ymd}_osa`, JSON.stringify(hitterRatings));
  } catch {
    // optional seed
  }
}

async function disableIndexedDbPersistence(): Promise<void> {
  const { indexedDBService } = await import('../src/services/IndexedDBService');
  const db = indexedDBService as any;

  db.getPlayers = async () => [];
  db.savePlayers = async () => undefined;
  db.getMlbLeagueStats = async () => null;
  db.saveMlbLeagueStats = async () => undefined;
  db.deleteMlbLeagueStats = async () => undefined;
  db.getAllScoutingKeys = async () => [];
  db.getScoutingRatings = async () => null;
  db.getAllHitterScoutingKeys = async () => [];
  db.getHitterScoutingRatings = async () => null;
}

type ProspectLike = {
  playerId: number;
  name: string;
  scoutingRatings: { gap: number; speed: number };
  trueRatings: { gap: number; speed: number };
};

type LegacyTieResult = {
  minPct: number;
  maxPct: number;
  midPct: number;
  minRating: number;
  maxRating: number;
  midRating: number;
  tieCount: number;
};

function pctAt(index: number, n: number): number {
  return n > 1 ? ((n - index - 1) / (n - 1)) * 100 : 50;
}

function computeLegacyTieResult(
  sortedValuesDesc: number[],
  value: number
): LegacyTieResult {
  const n = sortedValuesDesc.length;
  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (sortedValuesDesc[i] === value) {
      if (first === -1) first = i;
      last = i;
    } else if (first !== -1) {
      break;
    }
  }
  if (first === -1) {
    first = n - 1;
    last = n - 1;
  }

  const minPct = Math.min(pctAt(first, n), pctAt(last, n));
  const maxPct = Math.max(pctAt(first, n), pctAt(last, n));
  const midPct = (minPct + maxPct) / 2;
  const toRating = (pct: number) => Math.round(20 + (pct / 100) * 60);

  return {
    minPct,
    maxPct,
    midPct,
    minRating: toRating(minPct),
    maxRating: toRating(maxPct),
    midRating: toRating(midPct),
    tieCount: (last - first + 1),
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function fmt(v: number, digits = 2): string {
  return Number.isFinite(v) ? v.toFixed(digits) : 'n/a';
}

async function main(): Promise<void> {
  await setupNodeEnvironment();
  await disableIndexedDbPersistence();

  const args = parseArgs(process.argv.slice(2));
  const { dateService } = await import('../src/services/DateService');
  const currentYear = await dateService.getCurrentYear();
  const year = Number(args.year ?? currentYear);
  const playerIdFilter = Number(args.playerId ?? 0);
  const topN = Math.max(5, Number(args.top ?? 15));

  await seedDefaultScouting(year);

  const { teamRatingsService } = await import('../src/services/TeamRatingsService');
  const unified = await teamRatingsService.getUnifiedHitterTfrData(year);
  const prospects = unified.prospects as ProspectLike[];
  if (prospects.length === 0) {
    console.log(`No hitter prospects found for year ${year}.`);
    return;
  }

  const gapValuesDesc = prospects.map(p => p.scoutingRatings.gap).sort((a, b) => b - a);
  const speedValuesDesc = prospects.map(p => p.scoutingRatings.speed).sort((a, b) => b - a);

  const rows = prospects.map(p => {
    const legacyGap = computeLegacyTieResult(gapValuesDesc, p.scoutingRatings.gap);
    const legacySpeed = computeLegacyTieResult(speedValuesDesc, p.scoutingRatings.speed);

    return {
      playerId: p.playerId,
      name: p.name,
      scoutGap: p.scoutingRatings.gap,
      scoutSpeed: p.scoutingRatings.speed,
      currentGap: p.trueRatings.gap,
      currentSpeed: p.trueRatings.speed,
      legacyGapMid: legacyGap.midRating,
      legacySpeedMid: legacySpeed.midRating,
      legacyGapRange: `${legacyGap.minRating}-${legacyGap.maxRating}`,
      legacySpeedRange: `${legacySpeed.minRating}-${legacySpeed.maxRating}`,
      gapDelta: p.trueRatings.gap - legacyGap.midRating,
      speedDelta: p.trueRatings.speed - legacySpeed.midRating,
      gapTieCount: legacyGap.tieCount,
      speedTieCount: legacySpeed.tieCount,
    };
  });

  const gapDeltas = rows.map(r => r.gapDelta);
  const speedDeltas = rows.map(r => r.speedDelta);
  const gapAbs = gapDeltas.map(Math.abs);
  const speedAbs = speedDeltas.map(Math.abs);

  const changedGap = rows.filter(r => r.gapDelta !== 0).length;
  const changedSpeed = rows.filter(r => r.speedDelta !== 0).length;

  console.log(`Hitter TFR Gap/Speed Delta Report (${year})`);
  console.log(`Pool size: ${rows.length}`);
  console.log(`Method: current MLB-based vs legacy prospect-rank midpoint (tie-aware approximation).`);
  console.log('');
  console.log(`Gap: changed=${changedGap}/${rows.length} (${fmt((changedGap / rows.length) * 100, 1)}%), meanAbs=${fmt(gapAbs.reduce((a, b) => a + b, 0) / rows.length)}, medianAbs=${fmt(median(gapAbs))}, maxUp=${Math.max(...gapDeltas)}, maxDown=${Math.min(...gapDeltas)}`);
  console.log(`Speed: changed=${changedSpeed}/${rows.length} (${fmt((changedSpeed / rows.length) * 100, 1)}%), meanAbs=${fmt(speedAbs.reduce((a, b) => a + b, 0) / rows.length)}, medianAbs=${fmt(median(speedAbs))}, maxUp=${Math.max(...speedDeltas)}, maxDown=${Math.min(...speedDeltas)}`);
  console.log('');

  const topGap = [...rows].sort((a, b) => Math.abs(b.gapDelta) - Math.abs(a.gapDelta)).slice(0, topN);
  console.log(`Top ${topN} Gap Movers (abs delta):`);
  for (const r of topGap) {
    console.log(`- ${r.playerId} ${r.name}: scoutGap=${r.scoutGap}, current=${r.currentGap}, legacyMid=${r.legacyGapMid} (range ${r.legacyGapRange}, ties=${r.gapTieCount}), delta=${r.gapDelta >= 0 ? '+' : ''}${r.gapDelta}`);
  }
  console.log('');

  const topSpeed = [...rows].sort((a, b) => Math.abs(b.speedDelta) - Math.abs(a.speedDelta)).slice(0, topN);
  console.log(`Top ${topN} Speed Movers (abs delta):`);
  for (const r of topSpeed) {
    console.log(`- ${r.playerId} ${r.name}: scoutSpeed=${r.scoutSpeed}, current=${r.currentSpeed}, legacyMid=${r.legacySpeedMid} (range ${r.legacySpeedRange}, ties=${r.speedTieCount}), delta=${r.speedDelta >= 0 ? '+' : ''}${r.speedDelta}`);
  }
  console.log('');

  if (Number.isFinite(playerIdFilter) && playerIdFilter > 0) {
    const row = rows.find(r => r.playerId === playerIdFilter);
    if (!row) {
      console.log(`Player ${playerIdFilter} not found in hitter TFR pool.`);
    } else {
      console.log(`Player Focus: ${row.playerId} ${row.name}`);
      console.log(`- Gap: scout=${row.scoutGap}, current=${row.currentGap}, legacyMid=${row.legacyGapMid}, legacyRange=${row.legacyGapRange}, ties=${row.gapTieCount}, delta=${row.gapDelta >= 0 ? '+' : ''}${row.gapDelta}`);
      console.log(`- Speed: scout=${row.scoutSpeed}, current=${row.currentSpeed}, legacyMid=${row.legacySpeedMid}, legacyRange=${row.legacySpeedRange}, ties=${row.speedTieCount}, delta=${row.speedDelta >= 0 ? '+' : ''}${row.speedDelta}`);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`report-hitter-gap-speed-deltas failed: ${String(err)}\n`);
  process.exit(1);
});

