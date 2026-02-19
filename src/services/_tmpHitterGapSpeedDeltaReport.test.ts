import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { teamRatingsService } from './TeamRatingsService';
import { scoutingDataService } from './ScoutingDataService';
import { hitterScoutingDataService } from './HitterScoutingDataService';
import { indexedDBService } from './IndexedDBService';

type ProspectLike = {
  playerId: number;
  name: string;
  scoutingRatings: { gap: number; speed: number };
  trueRatings: { gap: number; speed: number };
};

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

function pctAt(index: number, n: number): number {
  return n > 1 ? ((n - index - 1) / (n - 1)) * 100 : 50;
}

function computeLegacyMidRating(sortedValuesDesc: number[], value: number): { mid: number; min: number; max: number; ties: number } {
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
  return {
    min: Math.round(20 + (minPct / 100) * 60),
    max: Math.round(20 + (maxPct / 100) * 60),
    mid: Math.round(20 + (midPct / 100) * 60),
    ties: (last - first + 1),
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

beforeAll(async () => {
  const storage = new MemoryStorage();
  (global as any).localStorage = storage;
  (global as any).window = {
    localStorage: storage,
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };

  const API_BASE_URL = 'https://atl-01.statsplus.net/world';
  const nativeFetch = global.fetch.bind(global);
  global.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
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

  const year = 2021;
  const ymd = `${year}-12-31`;
  const pitcherCsvPath = path.join(process.cwd(), 'public', 'data', 'default_osa_scouting.csv');
  const hitterCsvPath = path.join(process.cwd(), 'public', 'data', 'default_hitter_osa_scouting.csv');
  const pitcherCsv = await fs.readFile(pitcherCsvPath, 'utf8');
  const hitterCsv = await fs.readFile(hitterCsvPath, 'utf8');
  const pitcherRatings = scoutingDataService.parseScoutingCsv(pitcherCsv, 'osa');
  const hitterRatings = hitterScoutingDataService.parseScoutingCsv(hitterCsv, 'osa');
  localStorage.setItem(`wbl_scouting_ratings_${ymd}_osa`, JSON.stringify(pitcherRatings));
  localStorage.setItem(`wbl_hitter_scouting_ratings_${ymd}_osa`, JSON.stringify(hitterRatings));
}, 120000);

test('report hitter gap/speed deltas', async () => {
  const year = 2021;
  const focusPlayerId = 14422;
  const topN = 12;

  const unified = await teamRatingsService.getUnifiedHitterTfrData(year);
  const prospects = unified.prospects as ProspectLike[];
  expect(prospects.length).toBeGreaterThan(0);

  const gapValuesDesc = prospects.map(p => p.scoutingRatings.gap).sort((a, b) => b - a);
  const speedValuesDesc = prospects.map(p => p.scoutingRatings.speed).sort((a, b) => b - a);

  const rows = prospects.map(p => {
    const lg = computeLegacyMidRating(gapValuesDesc, p.scoutingRatings.gap);
    const ls = computeLegacyMidRating(speedValuesDesc, p.scoutingRatings.speed);
    return {
      playerId: p.playerId,
      name: p.name,
      scoutGap: p.scoutingRatings.gap,
      scoutSpeed: p.scoutingRatings.speed,
      currentGap: p.trueRatings.gap,
      currentSpeed: p.trueRatings.speed,
      legacyGapMid: lg.mid,
      legacySpeedMid: ls.mid,
      legacyGapRange: `${lg.min}-${lg.max}`,
      legacySpeedRange: `${ls.min}-${ls.max}`,
      gapDelta: p.trueRatings.gap - lg.mid,
      speedDelta: p.trueRatings.speed - ls.mid,
      gapTieCount: lg.ties,
      speedTieCount: ls.ties,
    };
  });

  const fmt = (v: number, d = 2) => v.toFixed(d);
  const gapAbs = rows.map(r => Math.abs(r.gapDelta));
  const speedAbs = rows.map(r => Math.abs(r.speedDelta));
  const changedGap = rows.filter(r => r.gapDelta !== 0).length;
  const changedSpeed = rows.filter(r => r.speedDelta !== 0).length;

  console.log(`Hitter TFR Gap/Speed Delta Report (${year})`);
  console.log(`Pool size: ${rows.length}`);
  console.log(`Method: current MLB-based vs legacy prospect-rank midpoint (tie-aware approximation).`);
  console.log(`Gap: changed=${changedGap}/${rows.length} (${fmt((changedGap / rows.length) * 100, 1)}%), meanAbs=${fmt(gapAbs.reduce((a, b) => a + b, 0) / rows.length)}, medianAbs=${fmt(median(gapAbs))}, maxUp=${Math.max(...rows.map(r => r.gapDelta))}, maxDown=${Math.min(...rows.map(r => r.gapDelta))}`);
  console.log(`Speed: changed=${changedSpeed}/${rows.length} (${fmt((changedSpeed / rows.length) * 100, 1)}%), meanAbs=${fmt(speedAbs.reduce((a, b) => a + b, 0) / rows.length)}, medianAbs=${fmt(median(speedAbs))}, maxUp=${Math.max(...rows.map(r => r.speedDelta))}, maxDown=${Math.min(...rows.map(r => r.speedDelta))}`);

  console.log(`Top ${topN} Gap Movers (abs delta):`);
  for (const r of [...rows].sort((a, b) => Math.abs(b.gapDelta) - Math.abs(a.gapDelta)).slice(0, topN)) {
    console.log(`- ${r.playerId} ${r.name}: scoutGap=${r.scoutGap}, current=${r.currentGap}, legacyMid=${r.legacyGapMid} (range ${r.legacyGapRange}, ties=${r.gapTieCount}), delta=${r.gapDelta >= 0 ? '+' : ''}${r.gapDelta}`);
  }

  console.log(`Top ${topN} Speed Movers (abs delta):`);
  for (const r of [...rows].sort((a, b) => Math.abs(b.speedDelta) - Math.abs(a.speedDelta)).slice(0, topN)) {
    console.log(`- ${r.playerId} ${r.name}: scoutSpeed=${r.scoutSpeed}, current=${r.currentSpeed}, legacyMid=${r.legacySpeedMid} (range ${r.legacySpeedRange}, ties=${r.speedTieCount}), delta=${r.speedDelta >= 0 ? '+' : ''}${r.speedDelta}`);
  }

  const focus = rows.find(r => r.playerId === focusPlayerId);
  expect(focus).toBeTruthy();
  if (focus) {
    console.log(`Player Focus ${focus.playerId} ${focus.name}: Gap scout=${focus.scoutGap}, current=${focus.currentGap}, legacyMid=${focus.legacyGapMid}, range=${focus.legacyGapRange}, delta=${focus.gapDelta >= 0 ? '+' : ''}${focus.gapDelta}`);
    console.log(`Player Focus ${focus.playerId} ${focus.name}: Speed scout=${focus.scoutSpeed}, current=${focus.currentSpeed}, legacyMid=${focus.legacySpeedMid}, range=${focus.legacySpeedRange}, delta=${focus.speedDelta >= 0 ? '+' : ''}${focus.speedDelta}`);
  }
}, 120000);
