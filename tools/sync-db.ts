/**
 * sync-db.ts — CLI tool to sync StatsPlus API data into Supabase.
 *
 * Replaces the in-browser hero sync. Every browser client becomes a pure reader.
 *
 * Usage:
 *   npx tsx tools/sync-db.ts                 # auto-detect year/date
 *   npx tsx tools/sync-db.ts --year=2021     # explicit year
 *   npx tsx tools/sync-db.ts --skip-compute  # data only, skip TR/TFR
 *   npx tsx tools/sync-db.ts --force         # re-sync even if DB is up to date
 *
 * Env vars:
 *   SUPABASE_URL          — PostgREST base
 *   SUPABASE_SERVICE_KEY  — service_role key (full write access, no RLS)
 */

import {
  supabaseQuery,
  supabaseUpsertBatches,
  supabasePatch,
  supabaseRpc,
  PITCHING_COLS,
  BATTING_COLS,
  DECIMAL_COLS,
  STRING_COLS,
  filterColumns,
  dedupRows,
  parseCsvLine,
  toIntOrNull,
  toFloatOrNull,
} from './lib/supabase-client';

// Pure math imports from src/services (no browser deps at module load time)
import { trueRatingsCalculationService } from '../src/services/TrueRatingsCalculationService';
import type { TrueRatingInput, YearlyPitchingStats } from '../src/services/TrueRatingsCalculationService';
import { hitterTrueRatingsCalculationService } from '../src/services/HitterTrueRatingsCalculationService';
import type { HitterTrueRatingInput } from '../src/services/HitterTrueRatingsCalculationService';
import { trueFutureRatingService } from '../src/services/TrueFutureRatingService';
import type { TrueFutureRatingInput, MLBPercentileDistribution } from '../src/services/TrueFutureRatingService';
import { hitterTrueFutureRatingService } from '../src/services/HitterTrueFutureRatingService';
import type { HitterTrueFutureRatingInput } from '../src/services/HitterTrueFutureRatingService';
import type { PitcherScoutingRatings } from '../src/models/ScoutingData';
import type { HitterScoutingRatings } from '../src/models/ScoutingData';
import type { MinorLeagueStatsWithLevel } from '../src/models/Stats';
import type { MinorLeagueBattingStatsWithLevel } from '../src/models/Stats';
import { fipWarService } from '../src/services/FipWarService';
import { prospectDevelopmentCurveService } from '../src/services/ProspectDevelopmentCurveService';
import { agingService } from '../src/services/AgingService';
import { hitterAgingService } from '../src/services/HitterAgingService';
import { ensembleProjectionService } from '../src/services/EnsembleProjectionService';
import { PotentialStatsService } from '../src/services/PotentialStatsService';
import { HitterRatingEstimatorService } from '../src/services/HitterRatingEstimatorService';

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────

const API_BASE = 'https://atl-01.statsplus.net/world/api';
const LEAGUE_START_YEAR = 2000;
const BATCH_SIZE = 1000;

// Timing helper
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const result = await fn();
  console.log(`  ⏱ ${label}: ${((Date.now() - start) / 1000).toFixed(1)}s`);
  return result;
}

// Parse CLI args
const args = process.argv.slice(2);
const explicitYear = args.find(a => a.startsWith('--year='))?.split('=')[1];
const skipCompute = args.includes('--skip-compute');
const forceSync = args.includes('--force');

// ──────────────────────────────────────────────
// API helpers
// ──────────────────────────────────────────────

let apiCallCount = 0;
let apiBytesTransferred = 0;

async function apiFetchText(path: string): Promise<string> {
  const url = `${API_BASE}/${path}`;
  apiCallCount++;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  const text = await res.text();
  apiBytesTransferred += new TextEncoder().encode(text).byteLength;
  return text;
}

async function apiFetchJson(path: string): Promise<any> {
  const text = await apiFetchText(path);
  return JSON.parse(text);
}

// ──────────────────────────────────────────────
// CSV parsing for StatsPlus API responses
// ──────────────────────────────────────────────

function parseStatsCsv(csvText: string): any[] {
  const lines = csvText.replace(/^\ufeff/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().trim());
  const rows: any[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const obj: any = {};

    for (let j = 0; j < headers.length; j++) {
      const col = headers[j];
      const val = (values[j] ?? '').trim();

      if (STRING_COLS.has(col)) {
        obj[col] = val || null;
      } else if (DECIMAL_COLS.has(col)) {
        obj[col] = toFloatOrNull(val);
      } else {
        obj[col] = toIntOrNull(val);
      }
    }

    if (obj.player_id) rows.push(obj);
  }

  return rows;
}

function parsePlayersCsv(csv: string): any[] {
  const lines = csv.trim().split('\n');
  return lines.slice(1).map(line => {
    const v = parseCsvLine(line);
    return {
      id: parseInt(v[0], 10),
      first_name: v[1]?.trim(),
      last_name: v[2]?.trim(),
      team_id: parseInt(v[3], 10) || null,
      parent_team_id: parseInt(v[4], 10) || null,
      level: v[5]?.trim(),
      position: parseInt(v[6], 10),
      role: parseInt(v[7], 10),
      age: parseInt(v[8], 10),
      retired: v[9]?.trim() === '1',
    };
  }).filter(p => !isNaN(p.id));
}

function parseTeamsCsv(csv: string): any[] {
  const lines = csv.trim().split('\n');
  return lines.slice(1).map(line => {
    const v = parseCsvLine(line);
    const leagueId = parseInt(v[4], 10);
    return {
      id: parseInt(v[0], 10),
      name: v[1]?.trim(),
      nickname: v[2]?.trim(),
      parent_team_id: parseInt(v[3], 10),
      league_id: isNaN(leagueId) ? null : leagueId,
    };
  }).filter(t => !isNaN(t.id));
}

function parseContractsCsv(csv: string): any[] {
  const lines = csv.trim().split('\n');
  const rows: any[] = [];

  for (const line of lines.slice(1)) {
    const v = line.split(',');
    const playerId = parseInt(v[0], 10);
    if (isNaN(playerId)) continue;

    const salaries: number[] = [];
    for (let i = 14; i <= 28; i++) {
      salaries.push(parseInt(v[i], 10) || 0);
    }

    rows.push({
      player_id: playerId,
      team_id: parseInt(v[1], 10) || 0,
      league_id: parseInt(v[2], 10) || 0,
      is_major: v[3] === '1' || v[3]?.toLowerCase() === 'true',
      season_year: parseInt(v[13], 10) || 0,
      years: parseInt(v[29], 10) || 0,
      current_year: parseInt(v[30], 10) || 0,
      salaries,
      no_trade: v[4] === '1' || v[4]?.toLowerCase() === 'true',
      last_year_team_option: v[5] === '1' || v[5]?.toLowerCase() === 'true',
      last_year_player_option: v[6] === '1' || v[6]?.toLowerCase() === 'true',
      last_year_vesting_option: v[7] === '1' || v[7]?.toLowerCase() === 'true',
    });
  }

  return rows;
}

// ──────────────────────────────────────────────
// SyncContext — fetch once, pass everywhere
// ──────────────────────────────────────────────

interface SyncContext {
  year: number;

  // Raw arrays
  mlbPitchingStats: any[];      // 4-year window, league_id=200, split_id=1
  mlbBattingStats: any[];       // 4-year window
  milbPitchingStats: any[];     // 3-year MiLB
  milbBattingStats: any[];      // 3-year MiLB
  contracts: any[];

  // Derived maps
  playerMap: Map<number, any>;
  dobMap: Map<number, Date>;
  directAgeMap: Map<number, number>;
  teamMap: Map<number, any>;
  teamNicknameMap: Map<number, string>;

  pitcherScoutMap: Map<number, any>;
  hitterScoutMapOsa: Map<number, any>;
  hitterScoutMapCombined: Map<number, any>;

  careerIpMap: Map<number, number>;
  careerAbMap: Map<number, number>;
  careerMlbBattingMap: Map<number, { ab: number; h: number; bb: number; k: number; hr: number; pa: number }>;

  icPlayerIds: Set<number>;
  aaaOrAaPlayerIds: Set<number>;

  // Current-year subsets
  currentYearPitching: any[];
  currentYearBatting: any[];

  // Precomputed distributions (from precomputed_cache)
  precomputedPitcherDist: any | null;
  precomputedHitterDist: any | null;
}

async function buildSyncContext(year: number): Promise<SyncContext> {
  console.log('\n=== Building sync context ===');

  const pitchingYears = [year, year - 1, year - 2, year - 3].filter(y => y >= LEAGUE_START_YEAR);
  const battingYears = [...pitchingYears];
  const milbYears = [year, year - 1, year - 2].filter(y => y >= LEAGUE_START_YEAR);

  const [
    allPlayersRaw,
    teamsRaw,
    pitcherScoutOsa,
    hitterScoutOsa,
    hitterScoutMy,
    mlbPitching,
    mlbBatting,
    milbPitching,
    milbBatting,
    contractsRaw,
    precomputedDists,
    careerIpRows,
    careerBatRows,
    aaaStatsRows,
    aaStatsRows,
  ] = await Promise.all([
    supabaseQuery<any>('players', 'select=*&order=id'),
    supabaseQuery<any>('teams', 'select=*&order=id'),
    supabaseQuery<any>('pitcher_scouting', 'select=*&source=eq.osa&order=snapshot_date.desc'),
    supabaseQuery<any>('hitter_scouting', 'select=*&source=eq.osa&order=snapshot_date.desc'),
    supabaseQuery<any>('hitter_scouting', 'select=*&source=eq.my&order=snapshot_date.desc'),
    supabaseQuery<any>('pitching_stats', `select=*&league_id=eq.200&split_id=eq.1&year=in.(${pitchingYears.join(',')})&order=player_id`),
    supabaseQuery<any>('batting_stats', `select=*&league_id=eq.200&split_id=eq.1&year=in.(${battingYears.join(',')})&order=player_id`),
    supabaseQuery<any>('pitching_stats', `select=*&league_id=in.(201,202,203,204)&split_id=eq.1&year=in.(${milbYears.join(',')})&order=player_id`),
    supabaseQuery<any>('batting_stats', `select=*&league_id=in.(201,202,203,204)&split_id=eq.1&year=in.(${milbYears.join(',')})&order=player_id`),
    supabaseQuery<any>('contracts', 'select=*&order=player_id'),
    supabaseQuery<any>('precomputed_cache', 'select=*&key=like.*distribution*'),
    supabaseRpc<any[]>('career_pitching_ip'),
    supabaseRpc<any[]>('career_batting_aggregates'),
    supabaseQuery<any>('pitching_stats', `select=player_id&league_id=eq.201&split_id=eq.1&year=eq.${year}&order=player_id`),
    supabaseQuery<any>('pitching_stats', `select=player_id&league_id=eq.202&split_id=eq.1&year=eq.${year}&order=player_id`),
  ]);

  // Build player maps
  const playerMap = new Map<number, any>();
  const dobMap = new Map<number, Date>();
  const directAgeMap = new Map<number, number>();
  for (const p of allPlayersRaw) {
    if (p.first_name) playerMap.set(p.id, p);
    if (p.dob) dobMap.set(p.id, new Date(p.dob));
    if (p.age && !p.dob) directAgeMap.set(p.id, typeof p.age === 'string' ? parseInt(p.age, 10) : p.age);
  }

  // Build team maps
  const teamMap = new Map<number, any>();
  const teamNicknameMap = new Map<number, string>();
  for (const t of teamsRaw) {
    teamMap.set(t.id, t);
    teamNicknameMap.set(t.id, t.nickname);
  }

  // Build scouting maps (latest per player, ordered desc)
  const pitcherScoutMap = new Map<number, any>();
  for (const s of pitcherScoutOsa) {
    if (!pitcherScoutMap.has(s.player_id)) pitcherScoutMap.set(s.player_id, s);
  }

  const hitterScoutMapOsa = new Map<number, any>();
  for (const s of hitterScoutOsa) {
    if (!hitterScoutMapOsa.has(s.player_id)) hitterScoutMapOsa.set(s.player_id, s);
  }

  // Combined: start with OSA, override with my
  const hitterScoutMapCombined = new Map(hitterScoutMapOsa);
  for (const s of hitterScoutMy) {
    if (!hitterScoutMapCombined.has(s.player_id)) hitterScoutMapCombined.set(s.player_id, s);
  }

  // Career IP map (from RPC)
  const careerIpMap = new Map<number, number>();
  for (const row of (careerIpRows || [])) {
    careerIpMap.set(row.player_id, parseFloat(String(row.total_ip)) || 0);
  }

  // Career batting aggregates (from RPC)
  const careerAbMap = new Map<number, number>();
  const careerMlbBattingMap = new Map<number, { ab: number; h: number; bb: number; k: number; hr: number; pa: number }>();
  for (const row of (careerBatRows || [])) {
    const ab = Number(row.total_ab) || 0;
    careerAbMap.set(row.player_id, ab);
    careerMlbBattingMap.set(row.player_id, {
      ab,
      h: Number(row.total_h) || 0,
      bb: Number(row.total_bb) || 0,
      k: Number(row.total_k) || 0,
      hr: Number(row.total_hr) || 0,
      pa: Number(row.total_pa) || 0,
    });
  }

  // IC player IDs
  const icPlayerIds = new Set<number>();
  for (const c of contractsRaw) {
    if (c.league_id === -200) icPlayerIds.add(c.player_id);
  }

  // AAA/AA readiness
  const aaaOrAaPlayerIds = new Set<number>([
    ...aaaStatsRows.map((s: any) => s.player_id),
    ...aaStatsRows.map((s: any) => s.player_id),
  ]);

  // Current-year subsets
  const currentYearPitching = mlbPitching.filter(r => r.year === year);
  const currentYearBatting = mlbBatting.filter(r => r.year === year);

  // Precomputed distributions
  let precomputedPitcherDist: any = null;
  let precomputedHitterDist: any = null;
  for (const row of precomputedDists) {
    if (row.key === 'pitcher_mlb_distribution') precomputedPitcherDist = row.data;
    if (row.key?.startsWith('hitter_mlb_distribution_')) precomputedHitterDist = row.data;
  }

  console.log(`  Players: ${playerMap.size} (${dobMap.size} with DOB)`);
  console.log(`  Teams: ${teamMap.size}`);
  console.log(`  Pitcher scouting: ${pitcherScoutMap.size}`);
  console.log(`  Hitter scouting: ${hitterScoutMapOsa.size} OSA, ${hitterScoutMapCombined.size} combined`);
  console.log(`  MLB pitching: ${mlbPitching.length} rows (4yr), ${currentYearPitching.length} current`);
  console.log(`  MLB batting: ${mlbBatting.length} rows (4yr), ${currentYearBatting.length} current`);
  console.log(`  MiLB: ${milbPitching.length} pitching, ${milbBatting.length} batting`);
  console.log(`  Contracts: ${contractsRaw.length}, IC players: ${icPlayerIds.size}`);
  console.log(`  Career maps: ${careerIpMap.size} IP, ${careerAbMap.size} AB`);

  return {
    year,
    mlbPitchingStats: mlbPitching,
    mlbBattingStats: mlbBatting,
    milbPitchingStats: milbPitching,
    milbBattingStats: milbBatting,
    contracts: contractsRaw,
    playerMap, dobMap, directAgeMap,
    teamMap, teamNicknameMap,
    pitcherScoutMap, hitterScoutMapOsa, hitterScoutMapCombined,
    careerIpMap, careerAbMap, careerMlbBattingMap,
    icPlayerIds, aaaOrAaPlayerIds,
    currentYearPitching, currentYearBatting,
    precomputedPitcherDist, precomputedHitterDist,
  };
}

// ──────────────────────────────────────────────
// Step 1: Detect game date + year
// ──────────────────────────────────────────────

async function detectGameDate(): Promise<{ gameDate: string; year: number; upToDate: boolean }> {
  console.log('\n=== Step 1: Detect game date ===');

  // Fetch API date and DB date in parallel
  const [dateText, dbRows] = await Promise.all([
    apiFetchText('date/'),
    supabaseQuery<{ game_date?: string }>('data_version', 'select=game_date&table_name=eq.game_state'),
  ]);

  const gameDate = dateText.trim().replace(/^"|"$/g, '');
  const dbGameDate = dbRows[0]?.game_date ?? '(not set)';

  console.log(`  DB game date:  ${dbGameDate}`);
  console.log(`  API game date: ${gameDate}`);

  let year: number;
  if (explicitYear) {
    year = parseInt(explicitYear, 10);
    console.log(`  Using explicit year: ${year}`);
  } else {
    // Extract year from date string — try common formats
    const yearMatch = gameDate.match(/\b(20\d{2})\b/);
    if (yearMatch) {
      year = parseInt(yearMatch[1], 10);
    } else {
      throw new Error(`Cannot parse year from game date: "${gameDate}"`);
    }
    console.log(`  Detected year: ${year}`);
  }

  const upToDate = dbGameDate === gameDate;
  return { gameDate, year, upToDate };
}

// ──────────────────────────────────────────────
// Step 2: Clear stale data
// ──────────────────────────────────────────────

async function clearStaleData(): Promise<void> {
  console.log('\n=== Step 2: Clear stale data ===');
  await supabaseRpc('clear_for_sync');
  console.log('  Cleared contracts + player_ratings');
}

// ──────────────────────────────────────────────
// Step 3: Fetch + write current-year data
// ──────────────────────────────────────────────

interface WriteStats {
  teams: number;
  players: number;
  mlbPitching: number;
  mlbBatting: number;
  milbPitching: number;
  milbBatting: number;
  contracts: number;
}

async function fetchAndWriteData(year: number): Promise<WriteStats> {
  console.log('\n=== Step 3: Fetch + write current-year data ===');
  const stats: WriteStats = {
    teams: 0, players: 0, mlbPitching: 0, mlbBatting: 0,
    milbPitching: 0, milbBatting: 0, contracts: 0,
  };

  // Sequential: teams → players (FK ordering)
  console.log('  Fetching teams...');
  const teamsCsv = await apiFetchText('teams/');
  const teams = parseTeamsCsv(teamsCsv);
  const dedupedTeams = dedupRows(teams, r => String(r.id));
  stats.teams = await supabaseUpsertBatches('teams', dedupedTeams, BATCH_SIZE, 'id');
  console.log(`  ✅ Teams: ${stats.teams} rows`);

  console.log('  Fetching players...');
  const playersCsv = await apiFetchText('players/');
  const players = parsePlayersCsv(playersCsv);
  // team_id=0 → null (no FK target for free agents/retired)
  for (const p of players) {
    if (p.team_id === 0) p.team_id = null;
    if (p.parent_team_id === 0) p.parent_team_id = null;
  }
  const dedupedPlayers = dedupRows(players, r => String(r.id));
  stats.players = await supabaseUpsertBatches('players', dedupedPlayers, BATCH_SIZE, 'id');
  console.log(`  ✅ Players: ${stats.players} rows`);

  // Parallel: MLB stats + MiLB stats + contracts
  const MILB_LEVELS = [
    { lid: 201, name: 'AAA' },
    { lid: 202, name: 'AA' },
    { lid: 203, name: 'A' },
    { lid: 204, name: 'R' },
  ];

  const parallelPromises: Promise<void>[] = [];

  // MLB pitching
  parallelPromises.push((async () => {
    console.log('  Fetching MLB pitching...');
    const csv = await apiFetchText(`playerpitchstatsv2/?year=${year}`);
    const rows = parseStatsCsv(csv);
    const filtered = filterColumns(rows, PITCHING_COLS);
    const deduped = dedupRows(filtered, r => `${r.player_id}_${r.year}_${r.league_id}_${r.split_id}`);
    stats.mlbPitching = await supabaseUpsertBatches('pitching_stats', deduped, BATCH_SIZE, 'player_id,year,league_id,split_id', 4);
    console.log(`  ✅ MLB pitching: ${stats.mlbPitching} rows`);
  })());

  // MLB batting
  parallelPromises.push((async () => {
    console.log('  Fetching MLB batting...');
    const csv = await apiFetchText(`playerbatstatsv2/?year=${year}`);
    const rows = parseStatsCsv(csv);
    const filtered = filterColumns(rows, BATTING_COLS);
    const deduped = dedupRows(filtered, r => `${r.player_id}_${r.year}_${r.league_id}_${r.split_id}`);
    stats.mlbBatting = await supabaseUpsertBatches('batting_stats', deduped, BATCH_SIZE, 'player_id,year,league_id,split_id', 4);
    console.log(`  ✅ MLB batting: ${stats.mlbBatting} rows`);
  })());

  // MiLB pitching × 4 levels
  for (const level of MILB_LEVELS) {
    parallelPromises.push((async () => {
      const csv = await apiFetchText(`playerpitchstatsv2/?year=${year}&lid=${level.lid}&split=1`);
      const rows = parseStatsCsv(csv);
      const filtered = filterColumns(rows, PITCHING_COLS);
      const deduped = dedupRows(filtered, r => `${r.player_id}_${r.year}_${r.league_id}_${r.split_id}`);
      const count = await supabaseUpsertBatches('pitching_stats', deduped, BATCH_SIZE, 'player_id,year,league_id,split_id');
      stats.milbPitching += count;
      console.log(`  ✅ MiLB pitching ${level.name}: ${count} rows`);
    })());
  }

  // MiLB batting × 4 levels
  for (const level of MILB_LEVELS) {
    parallelPromises.push((async () => {
      const csv = await apiFetchText(`playerbatstatsv2/?year=${year}&lid=${level.lid}&split=1`);
      const rows = parseStatsCsv(csv);
      const filtered = filterColumns(rows, BATTING_COLS);
      const deduped = dedupRows(filtered, r => `${r.player_id}_${r.year}_${r.league_id}_${r.split_id}`);
      const count = await supabaseUpsertBatches('batting_stats', deduped, BATCH_SIZE, 'player_id,year,league_id,split_id');
      stats.milbBatting += count;
      console.log(`  ✅ MiLB batting ${level.name}: ${count} rows`);
    })());
  }

  // Contracts
  parallelPromises.push((async () => {
    console.log('  Fetching contracts...');
    const csv = await apiFetchText('contract/');
    const contracts = parseContractsCsv(csv);
    const deduped = dedupRows(contracts, r => String(r.player_id));
    stats.contracts = await supabaseUpsertBatches('contracts', deduped, BATCH_SIZE, 'player_id');
    console.log(`  ✅ Contracts: ${stats.contracts} rows`);
  })());

  await Promise.all(parallelPromises);

  // Fix IC player levels: IC players have level=1 (same as MLB) in the API
  // but contract league_id=-200. Set level='6' so the browser can distinguish
  // IC from MLB without loading contracts.
  const icContracts = await supabaseQuery<{ player_id: number }>(
    'contracts', 'select=player_id&league_id=eq.-200'
  );
  if (icContracts.length > 0) {
    const icIds = icContracts.map(r => r.player_id);
    for (let i = 0; i < icIds.length; i += BATCH_SIZE) {
      const batch = icIds.slice(i, i + BATCH_SIZE);
      await supabasePatch('players', `id=in.(${batch.join(',')})`, { level: '6' });
    }
    console.log(`  ✅ IC player levels: ${icIds.length} players set to level=6`);
  }

  return stats;
}

// ──────────────────────────────────────────────
// Step 4: Compute TR
// ──────────────────────────────────────────────

async function computeTrueRatings(ctx: SyncContext): Promise<{ pitcherTr: number; hitterTr: number; rows: any[] }> {
  console.log('\n=== Step 4: Compute True Ratings ===');
  const ratingRows: { player_id: number; rating_type: string; data: any }[] = [];
  const year = ctx.year;

  // --- Pitcher TR ---
  console.log('  Computing pitcher TR...');

  // Filter multi-year pitching stats from context
  const pitchingYearsSet = new Set([year, year - 1, year - 2].filter(y => y >= LEAGUE_START_YEAR));
  const pitchingStats = ctx.mlbPitchingStats.filter(r => pitchingYearsSet.has(r.year));

  // Aliases from context
  const playerMap = ctx.playerMap;
  const scoutingMap = ctx.pitcherScoutMap;

  // Group pitching stats by player → yearly stats
  const playerYearlyStats = new Map<number, YearlyPitchingStats[]>();
  for (const row of pitchingStats) {
    const ip = typeof row.ip === 'string' ? parseFloat(row.ip) : (row.ip || 0);
    if (ip <= 0) continue;

    if (!playerYearlyStats.has(row.player_id)) {
      playerYearlyStats.set(row.player_id, []);
    }

    playerYearlyStats.get(row.player_id)!.push({
      year: row.year,
      ip,
      k9: (row.k / ip) * 9,
      bb9: (row.bb / ip) * 9,
      hr9: ((row.hra ?? row.hr ?? 0) / ip) * 9,
      gs: row.gs ?? 0,
    });
  }

  // Build TrueRatingInput[]
  const pitcherInputs: TrueRatingInput[] = [];
  playerYearlyStats.forEach((yearlyStats, playerId) => {
    const player = playerMap.get(playerId);
    const scouting = scoutingMap.get(playerId);

    const scoutingRatings: PitcherScoutingRatings | undefined = scouting ? {
      playerId,
      playerName: scouting.player_name,
      stuff: scouting.stuff,
      control: scouting.control,
      hra: scouting.hra,
      ovr: scouting.ovr,
      pot: scouting.pot,
    } : undefined;

    // Map OOTP numeric role (11=SP, 12=RP, 13=CL) to PitcherRole
    const ootpRole = player?.role ? parseInt(player.role, 10) : undefined;
    const role = ootpRole === 11 ? 'SP' as const : undefined; // Let IP-based fallback handle RP/SW

    pitcherInputs.push({
      playerId,
      playerName: player ? `${player.first_name} ${player.last_name}` : 'Unknown',
      yearlyStats: yearlyStats.sort((a, b) => b.year - a.year),
      scoutingRatings,
      role,
    });
  });

  const pitcherResults = trueRatingsCalculationService.calculateTrueRatings(pitcherInputs);
  for (const r of pitcherResults) {
    ratingRows.push({ player_id: r.playerId, rating_type: 'pitcher_tr', data: r });
  }
  console.log(`  ✅ Pitcher TR: ${pitcherResults.length} ratings`);

  // --- Hitter TR ---
  console.log('  Computing hitter TR...');

  const battingYearsSet = new Set([year, year - 1, year - 2].filter(y => y >= LEAGUE_START_YEAR));
  const battingStats = ctx.mlbBattingStats.filter(r => battingYearsSet.has(r.year));

  // Use combined hitter scouting from context (my overrides OSA)
  const hitterScoutingMap = ctx.hitterScoutMapCombined;

  // Group batting stats by player → yearly arrays
  const playerBattingStats = new Map<number, any[]>();
  for (const row of battingStats) {
    if (!playerBattingStats.has(row.player_id)) {
      playerBattingStats.set(row.player_id, []);
    }

    const ab = row.ab ?? 0;
    const h = row.h ?? 0;
    const pa = row.pa ?? 0;
    const bb = row.bb ?? 0;
    const hp = row.hp ?? 0;

    playerBattingStats.get(row.player_id)!.push({
      year: row.year,
      pa,
      ab,
      h,
      d: row.d ?? 0,
      t: row.t ?? 0,
      hr: row.hr ?? 0,
      bb,
      k: row.k ?? 0,
      hp,
      sf: row.sf ?? 0,
      sh: row.sh ?? 0,
      sb: row.sb ?? 0,
      cs: row.cs ?? 0,
      avg: ab > 0 ? h / ab : 0,
      obp: pa > 0 ? (h + bb + hp) / pa : 0,
    });
  }

  // Build HitterTrueRatingInput[]
  const hitterInputs: HitterTrueRatingInput[] = [];
  playerBattingStats.forEach((yearlyStats, playerId) => {
    const totalPa = yearlyStats.reduce((sum: number, s: any) => sum + s.pa, 0);
    if (totalPa < 30) return;

    const player = playerMap.get(playerId);
    const scouting = hitterScoutingMap.get(playerId);

    const scoutingRatings: HitterScoutingRatings | undefined = scouting ? {
      playerId,
      playerName: scouting.player_name,
      power: scouting.power,
      eye: scouting.eye,
      avoidK: scouting.avoid_k,
      contact: scouting.contact ?? 50,
      gap: scouting.gap ?? 50,
      speed: scouting.speed ?? 50,
      ovr: scouting.ovr,
      pot: scouting.pot,
    } : undefined;

    hitterInputs.push({
      playerId,
      playerName: player ? `${player.first_name} ${player.last_name}` : 'Unknown',
      yearlyStats: yearlyStats.sort((a: any, b: any) => b.year - a.year),
      scoutingRatings,
    });
  });

  const hitterLeagueAvg = hitterTrueRatingsCalculationService.getDefaultLeagueAverages();
  const hitterResults = hitterTrueRatingsCalculationService.calculateTrueRatings(hitterInputs, hitterLeagueAvg);
  for (const r of hitterResults) {
    ratingRows.push({ player_id: r.playerId, rating_type: 'hitter_tr', data: r });
  }
  console.log(`  ✅ Hitter TR: ${hitterResults.length} ratings`);

  return {
    pitcherTr: pitcherResults.length,
    hitterTr: hitterResults.length,
    rows: ratingRows,
  };
}

// ──────────────────────────────────────────────
// Step 5: Compute TFR
// ──────────────────────────────────────────────

async function computeTrueFutureRatings(
  ctx: SyncContext,
  trRows: { player_id: number; rating_type: string; data: any }[]
): Promise<{ pitcherTfr: number; hitterTfr: number; rows: any[] }> {
  console.log('\n=== Step 5: Compute True Future Ratings ===');
  const ratingRows: { player_id: number; rating_type: string; data: any }[] = [];
  const year = ctx.year;

  // Build TR lookup for comparison
  const pitcherTrMap = new Map<number, number>();
  const hitterTrMap = new Map<number, number>();
  for (const row of trRows) {
    if (row.rating_type === 'pitcher_tr') pitcherTrMap.set(row.player_id, row.data.trueRating);
    if (row.rating_type === 'hitter_tr') hitterTrMap.set(row.player_id, row.data.trueRating);
  }

  // Aliases from context
  const dobMap = ctx.dobMap;
  const directAgeMap = ctx.directAgeMap;

  function calculateAge(dob: Date | undefined, referenceYear: number, playerId?: number): number | null {
    if (dob) {
      const age = referenceYear - dob.getFullYear();
      return (age >= 15 && age <= 50) ? age : null;
    }
    // Fallback: use direct age from players table (IC players have no DOB)
    if (playerId !== undefined) {
      const directAge = directAgeMap.get(playerId);
      if (directAge && directAge >= 15 && directAge <= 50) return directAge;
    }
    return null;
  }

  function getLevelLabel(level: number | string | undefined): string {
    const n = typeof level === 'string' ? parseInt(level, 10) : (level ?? 6);
    switch (n) {
      case 1: return 'MLB';
      case 2: return 'AAA';
      case 3: return 'AA';
      case 4: return 'A';
      case 6: return 'R';
      case 7: return 'R';
      default: return 'R';
    }
  }

  // IC player set from context
  const icPlayerIds = ctx.icPlayerIds;

  // --- Pitcher TFR ---
  console.log('  Computing pitcher TFR...');

  // Aliases from context
  const pitcherScoutMap = ctx.pitcherScoutMap;
  const careerIpMap = ctx.careerIpMap;
  const milbPitching = ctx.milbPitchingStats;

  const leagueToLevel: Record<number, string> = { 201: 'aaa', 202: 'aa', 203: 'a', 204: 'r' };

  // Group MiLB stats by player
  const milbStatsByPlayer = new Map<number, MinorLeagueStatsWithLevel[]>();
  for (const row of milbPitching) {
    const level = leagueToLevel[row.league_id];
    if (!level) continue;
    const ip = typeof row.ip === 'string' ? parseFloat(row.ip) : (row.ip || 0);
    if (ip <= 0) continue;

    if (!milbStatsByPlayer.has(row.player_id)) milbStatsByPlayer.set(row.player_id, []);
    milbStatsByPlayer.get(row.player_id)!.push({
      id: row.player_id,
      name: `Player ${row.player_id}`,
      ip,
      hr: row.hra ?? row.hr ?? 0,
      bb: row.bb ?? 0,
      k: row.k ?? 0,
      hr9: ip > 0 ? ((row.hra ?? row.hr ?? 0) / ip) * 9 : 0,
      bb9: ip > 0 ? (row.bb / ip) * 9 : 0,
      k9: ip > 0 ? (row.k / ip) * 9 : 0,
      year: row.year,
      level: level as any,
    });
  }

  // Build MLB distribution (from context or compute on first run)
  let pitcherMlbDist: MLBPercentileDistribution;

  if (ctx.precomputedPitcherDist) {
    pitcherMlbDist = ctx.precomputedPitcherDist;
    console.log('  Loaded pitcher MLB distribution from precomputed cache');
  } else {
    console.log('  Building pitcher MLB distribution from stats...');
    pitcherMlbDist = await buildPitcherMlbDistribution(dobMap);
    await supabaseUpsertBatches('precomputed_cache', [{ key: 'pitcher_mlb_distribution', data: pitcherMlbDist }], 1, 'key');
  }

  // Pre-set cache on singleton (avoids browser-dependent buildMLBPercentileDistribution)
  (trueFutureRatingService as any)._mlbDistCache = pitcherMlbDist;

  // Filter prospects: career IP ≤ 50, has scouting
  const pitcherTfrInputs: TrueFutureRatingInput[] = [];
  pitcherScoutMap.forEach((scouting, playerId) => {
    const career = careerIpMap.get(playerId) || 0;
    if (career > 50) return; // Not a prospect

    const age = calculateAge(dobMap.get(playerId), year, playerId);
    if (!age) return;

    const tr = pitcherTrMap.get(playerId);
    const pot = scouting.pot || 0;
    const ovr = scouting.ovr || 0;
    const starGap = pot - ovr;

    // Gate check: age < 26 OR starGap >= 0.5
    if (age >= 26 && starGap < 0.5) return;

    pitcherTfrInputs.push({
      playerId,
      playerName: scouting.player_name || 'Unknown',
      age,
      scouting: {
        playerId,
        stuff: scouting.stuff,
        control: scouting.control,
        hra: scouting.hra,
        ovr: scouting.ovr,
        pot: scouting.pot,
      },
      minorLeagueStats: milbStatsByPlayer.get(playerId) || [],
      trueRating: tr,
    });
  });

  const pitcherTfrResults = await trueFutureRatingService.calculateTrueFutureRatings(pitcherTfrInputs);

  // Aliases from context
  const allPlayerMap = ctx.playerMap;
  const teamMap = ctx.teamMap;

  // Build RatedProspect objects
  for (const result of pitcherTfrResults) {
    const player = allPlayerMap.get(result.playerId);
    const scouting = pitcherScoutMap.get(result.playerId)!;
    const teamId = player?.parent_team_id || player?.team_id;
    const team = teamMap.get(teamId);

    // IP projection from stamina + injury (same logic as TeamRatingsService)
    const stamina = scouting.stamina;
    const injury = scouting.injury_proneness || 'Normal';
    const pitches = scouting.raw_data?.pitches ?? {};
    const pitchCount = Object.values(pitches).filter((v: any) => v >= 45).length;
    const isSp = stamina >= 30 && pitchCount >= 3;

    let projIp: number;
    if (isSp) {
      const baseIp = 30 + (stamina * 3.0);
      let injuryFactor = 1.0;
      if (injury === 'Durable') injuryFactor = 1.10;
      else if (injury === 'Iron Man') injuryFactor = 1.15;
      else if (injury === 'Fragile') injuryFactor = 0.90;
      else if (injury === 'Wrecked') injuryFactor = 0.75;
      projIp = Math.round(baseIp * injuryFactor);
      let skillMod = 1.0;
      if (result.projFip <= 3.50) skillMod = 1.20;
      else if (result.projFip <= 4.00) skillMod = 1.10;
      else if (result.projFip <= 4.50) skillMod = 1.0;
      else if (result.projFip <= 5.00) skillMod = 0.90;
      else skillMod = 0.80;
      projIp = Math.round(projIp * skillMod);
      let ipBoost = 1.0;
      if (result.projFip < 3.0) ipBoost = 1.08;
      else if (result.projFip < 3.5) ipBoost = 1.08 - ((result.projFip - 3.0) / 0.5) * 0.05;
      else if (result.projFip < 4.0) ipBoost = 1.03 - ((result.projFip - 3.5) / 0.5) * 0.03;
      if (ipBoost > 1.0) projIp = Math.round(projIp * ipBoost);
      projIp = Math.max(120, Math.min(260, projIp));
    } else {
      const baseIp = 50 + (stamina * 0.5);
      let injuryFactor = 1.0;
      if (injury === 'Durable') injuryFactor = 1.10;
      else if (injury === 'Iron Man') injuryFactor = 1.15;
      else if (injury === 'Fragile') injuryFactor = 0.90;
      else if (injury === 'Wrecked') injuryFactor = 0.75;
      projIp = Math.round(baseIp * injuryFactor);
      let skillMod = 1.0;
      if (result.projFip <= 3.50) skillMod = 1.20;
      else if (result.projFip <= 4.00) skillMod = 1.10;
      else if (result.projFip <= 4.50) skillMod = 1.0;
      else if (result.projFip <= 5.00) skillMod = 0.90;
      else skillMod = 0.80;
      projIp = Math.round(projIp * skillMod);
      let ipBoost = 1.0;
      if (result.projFip < 3.0) ipBoost = 1.08;
      else if (result.projFip < 3.5) ipBoost = 1.08 - ((result.projFip - 3.0) / 0.5) * 0.05;
      else if (result.projFip < 4.0) ipBoost = 1.03 - ((result.projFip - 3.5) / 0.5) * 0.03;
      if (ipBoost > 1.0) projIp = Math.round(projIp * ipBoost);
      projIp = Math.max(40, Math.min(80, projIp));
    }

    const projWar = fipWarService.calculateWar(result.projFip, projIp);

    const pitcherProspectData: any = {
        ...result,
        name: result.playerName,
        level: icPlayerIds.has(result.playerId) ? 'IC' : getLevelLabel(player?.level),
        team: team?.nickname || 'Unknown',
        parentOrg: teamMap.get(player?.parent_team_id || player?.team_id)?.nickname || team?.nickname || 'Unknown',
        teamId: teamId || 0,
        teamName: team?.name || 'Unknown',
        teamNickname: team?.nickname || '',
        orgId: player?.parent_team_id || player?.team_id || 0,
        peakFip: result.projFip,
        peakWar: Math.round(projWar * 10) / 10,
        peakIp: projIp,
        projIp,
        projWar: Math.round(projWar * 10) / 10,
        stamina,
        injury: scouting.injury_proneness || 'Normal',
        isProspect: true,
        isFarmEligible: (careerIpMap.get(result.playerId) || 0) <= 50,
        scoutOvr: scouting.ovr,
        scoutPot: scouting.pot,
        trueRatings: {
          stuff: result.trueStuff,
          control: result.trueControl,
          hra: result.trueHra,
        },
        potentialRatings: {
          stuff: result.projK9,
          control: result.projBb9,
          hra: result.projHr9,
        },
        stats: {
          ip: projIp,
          k9: result.adjustedK9,
          bb9: result.adjustedBb9,
          hr9: result.adjustedHr9,
        },
        scoutingRatings: {
          stuff: scouting.stuff,
          control: scouting.control,
          hra: scouting.hra,
          stamina,
          pitches: pitchCount,
        },
        rawStats: result.rawK9 !== undefined ? {
          k9: result.rawK9,
          bb9: result.rawBb9!,
          hr9: result.rawHr9!,
        } : undefined,
    };

    // Compute development-curve TR (current ability estimate)
    pitcherProspectData.developmentTR = prospectDevelopmentCurveService.calculatePitcherProspectTR(pitcherProspectData);

    ratingRows.push({
      player_id: result.playerId,
      rating_type: 'pitcher_tfr',
      data: pitcherProspectData,
    });
  }
  console.log(`  ✅ Pitcher TFR: ${pitcherTfrResults.length} prospects`);

  // --- Hitter TFR ---
  console.log('  Computing hitter TFR...');

  // Aliases from context
  const hitterScoutMap = ctx.hitterScoutMapOsa;
  const careerAbMap = ctx.careerAbMap;
  const careerMlbBattingMap = ctx.careerMlbBattingMap;
  const milbBatting = ctx.milbBattingStats;

  // Group MiLB batting stats by player
  const milbBattingByPlayer = new Map<number, MinorLeagueBattingStatsWithLevel[]>();
  for (const row of milbBatting) {
    const level = leagueToLevel[row.league_id];
    if (!level) continue;
    const pa = row.pa ?? 0;
    const ab = row.ab ?? 0;
    const h = row.h ?? 0;
    if (pa <= 0) continue;

    if (!milbBattingByPlayer.has(row.player_id)) milbBattingByPlayer.set(row.player_id, []);

    const d = row.d ?? 0;
    const t = row.t ?? 0;
    const hr = row.hr ?? 0;
    const bb = row.bb ?? 0;
    const k = row.k ?? 0;
    const avg = ab > 0 ? h / ab : 0;
    const obp = pa > 0 ? (h + bb) / pa : 0;
    const slg = ab > 0 ? (h - d - t - hr + d * 2 + t * 3 + hr * 4) / ab : 0;

    milbBattingByPlayer.get(row.player_id)!.push({
      id: row.player_id,
      name: `Player ${row.player_id}`,
      pa, ab, h, d, t, hr, bb, k,
      sb: row.sb ?? 0,
      cs: row.cs ?? 0,
      avg, obp, slg,
      ops: obp + slg,
      iso: slg - avg,
      bb_pct: pa > 0 ? bb / pa : 0,
      k_pct: pa > 0 ? k / pa : 0,
      year: row.year,
      level: level as any,
    });
  }

  // Build hitter MLB distribution (from context or compute on first run)
  if (ctx.precomputedHitterDist) {
    (hitterTrueFutureRatingService as any)._mlbDistCache = ctx.precomputedHitterDist;
    (hitterTrueFutureRatingService as any)._mlbDistCacheKey = 'def_def_def';
    console.log('  Loaded hitter MLB distribution from precomputed cache');
  } else {
    console.log('  Building hitter MLB distribution from stats...');
    const hitterDist = await buildHitterMlbDistribution(dobMap);
    (hitterTrueFutureRatingService as any)._mlbDistCache = hitterDist;
    (hitterTrueFutureRatingService as any)._mlbDistCacheKey = 'def_def_def';
    await supabaseUpsertBatches('precomputed_cache', [{ key: 'hitter_mlb_distribution_def_def_def', data: hitterDist }], 1, 'key');
  }

  // Filter hitter prospects: career AB ≤ 130, has scouting
  const hitterTfrInputs: HitterTrueFutureRatingInput[] = [];
  hitterScoutMap.forEach((scouting, playerId) => {
    const career = careerAbMap.get(playerId) || 0;
    if (career > 130) return;

    const age = calculateAge(dobMap.get(playerId), year, playerId);
    if (!age) return;

    const tr = hitterTrMap.get(playerId);
    const pot = scouting.pot || 0;
    const ovr = scouting.ovr || 0;
    const starGap = pot - ovr;

    if (age >= 26 && starGap < 0.5) return;

    hitterTfrInputs.push({
      playerId,
      playerName: scouting.player_name || 'Unknown',
      age,
      scouting: {
        playerId,
        power: scouting.power,
        eye: scouting.eye,
        avoidK: scouting.avoid_k,
        contact: scouting.contact ?? 50,
        gap: scouting.gap ?? 50,
        speed: scouting.speed ?? 50,
        ovr: scouting.ovr,
        pot: scouting.pot,
      },
      minorLeagueStats: milbBattingByPlayer.get(playerId) || [],
      trueRating: tr,
    });
  });

  const hitterTfrResults = await hitterTrueFutureRatingService.calculateTrueFutureRatings(hitterTfrInputs);

  // Build PA by injury (empirical)
  const paByInjury = await buildPaByInjury(dobMap);

  // Build RatedHitterProspect objects
  for (const result of hitterTfrResults) {
    const player = allPlayerMap.get(result.playerId);
    const scouting = hitterScoutMap.get(result.playerId)!;
    const teamId = player?.parent_team_id || player?.team_id;
    const team = teamMap.get(teamId);
    const injury = scouting.injury_proneness || 'Normal';

    // PA projection from injury tier
    const projPa = paByInjury.get(injury) ?? 640;

    const hitterProspectData: any = {
        ...result,
        name: result.playerName,
        level: icPlayerIds.has(result.playerId) ? 'IC' : getLevelLabel(player?.level),
        team: team?.nickname || 'Unknown',
        parentOrg: teamMap.get(player?.parent_team_id || player?.team_id)?.nickname || team?.nickname || 'Unknown',
        teamId: teamId || 0,
        teamName: team?.name || 'Unknown',
        teamNickname: team?.nickname || '',
        orgId: player?.parent_team_id || player?.team_id || 0,
        projPa,
        injury,
        injuryProneness: injury,
        isProspect: true,
        isFarmEligible: (careerAbMap.get(result.playerId) || 0) <= 130,
        scoutOvr: scouting.ovr,
        scoutPot: scouting.pot,
        position: player?.position,
        scoutingRatings: {
          power: scouting.power,
          eye: scouting.eye,
          avoidK: scouting.avoid_k,
          contact: scouting.contact,
          gap: scouting.gap,
          speed: scouting.speed,
          ovr: scouting.ovr,
          pot: scouting.pot,
        },
        trueRatings: {
          power: result.truePower,
          eye: result.trueEye,
          avoidK: result.trueAvoidK,
          contact: result.trueContact,
          gap: result.trueGap,
          speed: result.trueSpeed,
        },
        rawStats: result.rawBbPct !== undefined ? {
          bbPct: result.rawBbPct,
          kPct: result.rawKPct!,
          hrPct: result.rawHrPct!,
          avg: result.rawAvg!,
        } : undefined,
    };

    // Build MLB stats adjustment for prospects with some MLB time
    const mlbCareer = careerMlbBattingMap.get(result.playerId);
    const mlbForTR = (mlbCareer && mlbCareer.pa > 0 && mlbCareer.ab > 0) ? {
      avg: mlbCareer.h / mlbCareer.ab,
      bbPct: (mlbCareer.bb / mlbCareer.pa) * 100,
      kPct: (mlbCareer.k / mlbCareer.pa) * 100,
      hrPct: (mlbCareer.hr / mlbCareer.pa) * 100,
      pa: mlbCareer.pa,
    } : undefined;

    // Compute development-curve TR (current ability estimate)
    hitterProspectData.developmentTR = prospectDevelopmentCurveService.calculateProspectTR(hitterProspectData, mlbForTR);

    ratingRows.push({
      player_id: result.playerId,
      rating_type: 'hitter_tfr',
      data: hitterProspectData,
    });
  }
  console.log(`  ✅ Hitter TFR: ${hitterTfrResults.length} prospects`);

  return {
    pitcherTfr: pitcherTfrResults.length,
    hitterTfr: hitterTfrResults.length,
    rows: ratingRows,
  };
}

// ──────────────────────────────────────────────
// MLB Distribution builders (for when precomputed cache is empty)
// ──────────────────────────────────────────────

async function buildPitcherMlbDistribution(dobMap: Map<number, Date>): Promise<MLBPercentileDistribution> {
  const FIP_CONSTANT = 3.47;
  const years = [2015, 2016, 2017, 2018, 2019, 2020];
  const allK9: number[] = [];
  const allBb9: number[] = [];
  const allHr9: number[] = [];
  const allFip: number[] = [];

  const stats = await supabaseQuery<any>(
    'pitching_stats',
    `select=player_id,year,ip,k,bb,hra&league_id=eq.200&split_id=eq.1&year=in.(${years.join(',')})`
  );

  for (const row of stats) {
    const ip = typeof row.ip === 'string' ? parseFloat(row.ip) : (row.ip || 0);
    if (ip < 50) continue;

    const dob = dobMap.get(row.player_id);
    if (!dob) continue;
    const age = row.year - dob.getFullYear();
    if (age < 25 || age > 32) continue;

    const k9 = (row.k / ip) * 9;
    const bb9 = (row.bb / ip) * 9;
    const hr9 = ((row.hra ?? 0) / ip) * 9;

    if (k9 > 2 && k9 < 15 && bb9 >= 0.5 && bb9 < 8 && hr9 >= 0.2 && hr9 < 3) {
      allK9.push(k9);
      allBb9.push(bb9);
      allHr9.push(hr9);
      const fip = ((13 * hr9 + 3 * bb9 - 2 * k9) / 9) + FIP_CONSTANT;
      allFip.push(Math.round(fip * 100) / 100);
    }
  }

  allK9.sort((a, b) => a - b);
  allBb9.sort((a, b) => a - b);
  allHr9.sort((a, b) => a - b);
  allFip.sort((a, b) => a - b);

  console.log(`  Built pitcher MLB dist: ${allK9.length} player-seasons`);
  return { k9Values: allK9, bb9Values: allBb9, hr9Values: allHr9, fipValues: allFip };
}

async function buildHitterMlbDistribution(dobMap: Map<number, Date>): Promise<any> {
  const years = [2015, 2016, 2017, 2018, 2019, 2020];
  const allBbPct: number[] = [];
  const allKPct: number[] = [];
  const allHrPct: number[] = [];
  const allAvg: number[] = [];
  const allDoublesRate: number[] = [];
  const allTriplesRate: number[] = [];
  const allWar: number[] = [];

  const lgWoba = 0.315;
  const wobaScale = 1.15;
  const runsPerWin = 10;
  const replacementRuns = 20;

  const stats = await supabaseQuery<any>(
    'batting_stats',
    `select=player_id,year,pa,ab,h,d,t,hr,bb,k,hp,sf,war&league_id=eq.200&split_id=eq.1&year=in.(${years.join(',')})`
  );

  for (const row of stats) {
    const pa = row.pa ?? 0;
    const ab = row.ab ?? 0;
    if (pa < 400) continue;

    const dob = dobMap.get(row.player_id);
    if (!dob) continue;
    const age = row.year - dob.getFullYear();
    if (age < 25 || age > 29) continue;

    const h = row.h ?? 0;
    const d = row.d ?? 0;
    const t = row.t ?? 0;
    const hr = row.hr ?? 0;
    const bb = row.bb ?? 0;
    const k = row.k ?? 0;
    const hp = row.hp ?? 0;

    const bbPct = bb / pa;
    const kPct = k / pa;
    const hrPct = ab > 0 ? hr / ab : 0;
    const avg = ab > 0 ? h / ab : 0;
    const doublesRate = ab > 0 ? d / ab : 0;
    const triplesRate = ab > 0 ? t / ab : 0;

    allBbPct.push(bbPct);
    allKPct.push(kPct);
    allHrPct.push(hrPct);
    allAvg.push(avg);
    allDoublesRate.push(doublesRate);
    allTriplesRate.push(triplesRate);

    // Compute WAR for distribution
    const obp = pa > 0 ? (h + bb + hp) / pa : 0;
    const singles = h - d - t - hr;
    const slg = ab > 0 ? (singles + 2 * d + 3 * t + 4 * hr) / ab : 0;
    const wOBA = (0.69 * bb + 0.72 * hp + 0.89 * singles + 1.27 * d + 1.62 * t + 2.10 * hr) /
                 (ab + bb + hp + (row.sf ?? 0));
    const wRAA = ((wOBA - lgWoba) / wobaScale) * pa;
    const war = (wRAA + replacementRuns) / runsPerWin;
    allWar.push(Math.round(war * 10) / 10);
  }

  allBbPct.sort((a, b) => a - b);
  allKPct.sort((a, b) => a - b);
  allHrPct.sort((a, b) => a - b);
  allAvg.sort((a, b) => a - b);
  allDoublesRate.sort((a, b) => a - b);
  allTriplesRate.sort((a, b) => a - b);
  allWar.sort((a, b) => a - b);

  console.log(`  Built hitter MLB dist: ${allBbPct.length} player-seasons`);

  return {
    bbPctValues: allBbPct,
    kPctValues: allKPct,
    hrPctValues: allHrPct,
    avgValues: allAvg,
    doublesRateValues: allDoublesRate,
    triplesRateValues: allTriplesRate,
    warValues: allWar,
  };
}

async function buildPaByInjury(dobMap: Map<number, Date>): Promise<Map<string, number>> {
  // Build combined PA distribution from MLB peak-age data
  const years = [2015, 2016, 2017, 2018, 2019, 2020];
  const stats = await supabaseQuery<any>(
    'batting_stats',
    `select=player_id,year,pa&league_id=eq.200&split_id=eq.1&year=in.(${years.join(',')})`
  );

  const allPa: number[] = [];
  for (const row of stats) {
    const pa = row.pa ?? 0;
    if (pa < 400) continue;

    const dob = dobMap.get(row.player_id);
    if (!dob) continue;
    const age = row.year - dob.getFullYear();
    if (age < 25 || age > 29) continue;

    allPa.push(pa);
  }

  allPa.sort((a, b) => a - b);

  function percentile(arr: number[], pct: number): number {
    if (arr.length === 0) return 600;
    const idx = Math.floor(pct / 100 * (arr.length - 1));
    return arr[Math.min(idx, arr.length - 1)];
  }

  const result = new Map<string, number>();
  result.set('Iron Man', percentile(allPa, 90));
  result.set('Durable', percentile(allPa, 80));
  result.set('Normal', percentile(allPa, 70));
  result.set('Fragile', percentile(allPa, 50));
  result.set('Wrecked', percentile(allPa, 25));

  return result;
}

// ──────────────────────────────────────────────
// parseIp helper (same as TrueRatingsService:932)
// ──────────────────────────────────────────────

function parseIp(ipValue: string | number): number {
  if (ipValue === null || ipValue === undefined) return 0;
  const parts = String(ipValue).split('.');
  const fullInnings = parseInt(parts[0], 10) || 0;
  const partialOuts = parts.length > 1 ? parseInt(parts[1], 10) || 0 : 0;
  return fullInnings + partialOuts / 3;
}

// ──────────────────────────────────────────────
// Step 5.5: Compute Projections
// ──────────────────────────────────────────────

const PROJ_PERCENTILE_TO_RATING: Array<{ threshold: number; rating: number }> = [
  { threshold: 97.7, rating: 5.0 },
  { threshold: 93.3, rating: 4.5 },
  { threshold: 84.1, rating: 4.0 },
  { threshold: 69.1, rating: 3.5 },
  { threshold: 50.0, rating: 3.0 },
  { threshold: 30.9, rating: 2.5 },
  { threshold: 15.9, rating: 2.0 },
  { threshold: 6.7, rating: 1.5 },
  { threshold: 2.3, rating: 1.0 },
  { threshold: 0.0, rating: 0.5 },
];

function percentileToRating(percentile: number): number {
  for (const { threshold, rating } of PROJ_PERCENTILE_TO_RATING) {
    if (percentile >= threshold) return rating;
  }
  return 0.5;
}

function getPercentile(value: number, distribution: number[]): number {
  if (distribution.length === 0) return 50;
  let rank = 0;
  for (const val of distribution) {
    if (val < value) rank++;
    else break;
  }
  return (rank / distribution.length) * 100;
}

function getValueAtPercentile(pct: number, distribution: number[]): number {
  if (distribution.length === 0) return 0;
  const index = Math.floor((pct / 100) * distribution.length);
  return distribution[Math.max(0, Math.min(distribution.length - 1, index))];
}

async function computeProjections(
  ctx: SyncContext,
  trRows: { player_id: number; rating_type: string; data: any }[]
): Promise<{ pitcherProj: number; batterProj: number }> {
  console.log('\n=== Step 5.5: Compute Projections ===');
  const year = ctx.year;

  // Build canonical TR lookups from Step 4
  const pitcherTrMap = new Map<number, any>();
  const hitterTrMap = new Map<number, any>();
  for (const row of trRows) {
    if (row.rating_type === 'pitcher_tr') pitcherTrMap.set(row.player_id, row.data);
    if (row.rating_type === 'hitter_tr') hitterTrMap.set(row.player_id, row.data);
  }

  // ────────── Data from SyncContext ──────────

  const allPitchingStats = ctx.mlbPitchingStats;
  const currentYearPitching = ctx.currentYearPitching;
  const battingYearsSet = new Set([year - 1, year - 2, year - 3].filter(y => y >= LEAGUE_START_YEAR));
  const allBattingStats = ctx.mlbBattingStats.filter(r => battingYearsSet.has(r.year));
  const currentYearBatting = ctx.currentYearBatting;

  const playerMap = ctx.playerMap;
  const teamMap = ctx.teamNicknameMap;
  const pitcherScoutMap = ctx.pitcherScoutMap;
  const hitterScoutMap = ctx.hitterScoutMapOsa;
  const aaaOrAaPlayerIds = ctx.aaaOrAaPlayerIds;

  // Compute league stats for pitcher projections
  let totalIp = 0, totalK = 0, totalBb = 0, totalHr = 0, totalEr = 0;
  for (const r of currentYearPitching) {
    const ip = parseIp(r.ip);
    if (ip <= 0) continue;
    totalIp += ip;
    totalK += r.k ?? 0;
    totalBb += r.bb ?? 0;
    totalHr += r.hra ?? r.hr ?? 0;
    totalEr += r.er ?? 0;
  }
  const fipConstant = totalIp > 0
    ? (totalEr / totalIp * 9) - ((13 * totalHr + 3 * totalBb - 2 * totalK) / totalIp)
    : 3.47;
  const avgFip = totalIp > 0
    ? ((13 * totalHr + 3 * totalBb - 2 * totalK) / totalIp) + fipConstant
    : 4.2;

  const leagueContext = { fipConstant, avgFip, runsPerWin: 8.5 };

  // Compute league batting averages for batter projections
  let lgPa = 0, lgAb = 0, lgH = 0, lgD = 0, lgT = 0, lgHrB = 0, lgBb = 0, lgHp = 0, lgSf = 0, lgR = 0;
  for (const r of currentYearBatting) {
    const pa = r.pa ?? 0;
    if (pa < 1) continue;
    lgPa += pa; lgAb += r.ab ?? 0; lgH += r.h ?? 0; lgD += r.d ?? 0; lgT += r.t ?? 0;
    lgHrB += r.hr ?? 0; lgBb += r.bb ?? 0; lgHp += r.hp ?? 0; lgSf += r.sf ?? 0; lgR += r.r ?? 0;
  }

  let leagueAvg: any = null;
  if (lgPa > 0 && lgAb > 0) {
    const lgSingles = lgH - lgD - lgT - lgHrB;
    const lgTb = lgSingles + 2 * lgD + 3 * lgT + 4 * lgHrB;
    const denom = lgAb + lgBb + lgHp + lgSf;
    leagueAvg = {
      year,
      lgObp: Math.round(((lgH + lgBb + lgHp) / denom) * 1000) / 1000,
      lgSlg: Math.round((lgTb / lgAb) * 1000) / 1000,
      lgWoba: Math.round(((0.69 * lgBb + 0.72 * lgHp + 0.89 * lgSingles + 1.27 * lgD + 1.62 * lgT + 2.10 * lgHrB) / denom) * 1000) / 1000,
      lgRpa: Math.round((lgR / lgPa) * 1000) / 1000,
      wobaScale: 1.15,
      runsPerWin: 10,
      totalPa: lgPa,
      totalRuns: lgR,
    };
  }

  // If current year has no data, try prior year from context
  if (!leagueAvg) {
    const priorBatting = ctx.mlbBattingStats.filter(r => r.year === year - 1);
    let pPa = 0, pAb = 0, pH = 0, pD = 0, pT = 0, pHr = 0, pBb = 0, pHp = 0, pSf = 0, pR = 0;
    for (const r of priorBatting) {
      const pa = r.pa ?? 0; if (pa < 1) continue;
      pPa += pa; pAb += r.ab ?? 0; pH += r.h ?? 0; pD += r.d ?? 0; pT += r.t ?? 0;
      pHr += r.hr ?? 0; pBb += r.bb ?? 0; pHp += r.hp ?? 0; pSf += r.sf ?? 0; pR += r.r ?? 0;
    }
    if (pPa > 0 && pAb > 0) {
      const pSingles = pH - pD - pT - pHr;
      const pTb = pSingles + 2 * pD + 3 * pT + 4 * pHr;
      const denom = pAb + pBb + pHp + pSf;
      leagueAvg = {
        year: year - 1,
        lgObp: Math.round(((pH + pBb + pHp) / denom) * 1000) / 1000,
        lgSlg: Math.round((pTb / pAb) * 1000) / 1000,
        lgWoba: Math.round(((0.69 * pBb + 0.72 * pHp + 0.89 * pSingles + 1.27 * pD + 1.62 * pT + 2.10 * pHr) / denom) * 1000) / 1000,
        lgRpa: Math.round((pR / pPa) * 1000) / 1000,
        wobaScale: 1.15,
        runsPerWin: 10,
        totalPa: pPa,
        totalRuns: pR,
      };
    }
  }

  // ────────── Pitcher Projections ──────────
  console.log('  Computing pitcher projections...');

  // Group multi-year pitching stats by player
  const playerPitchingStats = new Map<number, YearlyPitchingStats[]>();
  for (const row of allPitchingStats) {
    const ip = parseIp(row.ip);
    if (ip <= 0) continue;
    if (!playerPitchingStats.has(row.player_id)) playerPitchingStats.set(row.player_id, []);
    playerPitchingStats.get(row.player_id)!.push({
      year: row.year,
      ip,
      k9: (row.k / ip) * 9,
      bb9: (row.bb / ip) * 9,
      hr9: ((row.hra ?? row.hr ?? 0) / ip) * 9,
      gs: row.gs ?? 0,
    });
  }

  // Current-year stats map
  const currentPitchingMap = new Map<number, any>();
  for (const r of currentYearPitching) currentPitchingMap.set(r.player_id, r);

  // Build TR inputs (same as computeTrueRatings but using projection-specific multi-year window)
  const pitcherIds = new Set<number>();
  playerPitchingStats.forEach((_s, pid) => pitcherIds.add(pid));
  currentYearPitching.forEach((s: any) => pitcherIds.add(s.player_id));

  const pitcherTrInputs: TrueRatingInput[] = [];
  for (const playerId of pitcherIds) {
    const player = playerMap.get(playerId);
    const scouting = pitcherScoutMap.get(playerId);
    const yearlyStats = playerPitchingStats.get(playerId) ?? [];

    // Mirror canonical TR pipeline: require 10+ total IP or scouting
    const totalIpForPlayer = yearlyStats.reduce((sum, s) => sum + s.ip, 0);
    if (totalIpForPlayer < 10 && !scouting) continue;

    const scoutingRatings: PitcherScoutingRatings | undefined = scouting ? {
      playerId,
      playerName: scouting.player_name,
      stuff: scouting.stuff,
      control: scouting.control,
      hra: scouting.hra,
      ovr: scouting.ovr,
      pot: scouting.pot,
      stamina: scouting.stamina,
      injuryProneness: scouting.injury_proneness,
      pitches: scouting.pitches,
    } : undefined;

    const ootpRole = player?.role ? parseInt(String(player.role), 10) : undefined;
    const role = ootpRole === 11 ? 'SP' as const : undefined;

    pitcherTrInputs.push({
      playerId,
      playerName: player ? `${player.first_name} ${player.last_name}` : 'Unknown',
      yearlyStats: yearlyStats.sort((a, b) => b.year - a.year),
      scoutingRatings,
      role,
    });
  }

  const pitcherTrResults = trueRatingsCalculationService.calculateTrueRatings(pitcherTrInputs);

  // Build SP IP/stamina distributions from current-year stats + scouting
  const spIpDistribution: number[] = [];
  const spStaminaDistribution: number[] = [];
  const MIN_GS_FOR_PEAK = 29;

  for (const r of currentYearPitching) {
    if ((r.gs ?? 0) >= MIN_GS_FOR_PEAK) {
      const ip = parseIp(r.ip);
      if (ip > 0) spIpDistribution.push(ip);
    }
  }
  for (const [, s] of pitcherScoutMap) {
    const pitches = s.pitches ?? {};
    const usablePitches = Object.values(pitches).filter((r: any) => r > 25).length;
    const stam = s.stamina ?? 0;
    if (usablePitches >= 3 && stam >= 35) spStaminaDistribution.push(stam);
  }
  spIpDistribution.sort((a, b) => a - b);
  spStaminaDistribution.sort((a, b) => a - b);
  const spMaxIp = spIpDistribution.length > 0 ? spIpDistribution[spIpDistribution.length - 1] : 240;

  // If current year distributions are empty, try prior year from context
  if (spIpDistribution.length === 0) {
    const priorPitching = ctx.mlbPitchingStats.filter(r => r.year === year - 1);
    for (const r of priorPitching) {
      if ((r.gs ?? 0) >= MIN_GS_FOR_PEAK) {
        const ip = parseIp(r.ip);
        if (ip > 0) spIpDistribution.push(ip);
      }
    }
    spIpDistribution.sort((a, b) => a - b);
  }

  // Generate pitcher projections
  const tempPitcherProjections: any[] = [];

  for (const tr of pitcherTrResults) {
    const player = playerMap.get(tr.playerId);
    if (!player) continue;
    if (player.retired) continue;

    const playerAge = typeof player.age === 'string' ? parseInt(player.age, 10) : (player.age ?? 25);
    const currentStats = currentPitchingMap.get(tr.playerId);
    const yearlyStats = playerPitchingStats.get(tr.playerId);

    // Readiness check (same as browser ProjectionService)
    const hasRecentMlb = (currentStats && parseIp(currentStats.ip) > 0) ||
      (yearlyStats && yearlyStats.some(y => y.year === year - 1 && y.ip > 0));

    let isMlbReady = hasRecentMlb;
    const scouting = pitcherScoutMap.get(tr.playerId);

    if (!isMlbReady) {
      const isUpperMinors = aaaOrAaPlayerIds.has(tr.playerId);
      const ovr = scouting?.ovr ?? 20;
      const pot = scouting?.pot ?? 20;
      const starGap = pot - ovr;
      const isQualityProspect = (ovr >= 45) || (starGap <= 1.0 && pot >= 45);
      if (isUpperMinors && (isQualityProspect || tr.trueRating >= 2.0)) isMlbReady = true;
      if (ovr >= 50) isMlbReady = true;
    }
    if (!isMlbReady) continue;

    const teamId = player.team_id ?? currentStats?.team_id ?? 0;

    // Build scouting for IP calculation
    const scoutingForIp: any = scouting ? {
      stamina: scouting.stamina,
      injuryProneness: scouting.injury_proneness,
      pitches: scouting.pitches,
      ovr: scouting.ovr,
      pot: scouting.pot,
    } : undefined;

    // Determine SP/RP role (same logic as browser)
    let isSp = false;
    let roleReason = 'fallback';
    if (scoutingForIp) {
      const pitches = scoutingForIp.pitches ?? {};
      const usablePitches = Object.values(pitches).filter((r: any) => r >= 25).length;
      const stam = scoutingForIp.stamina ?? 0;
      if (usablePitches >= 3 && stam >= 35) {
        if (!hasRecentMlb || tr.trueRating >= 2.0) {
          isSp = true;
          roleReason = 'scouting-profile';
        }
      }
    }
    if (!isSp) {
      const ootpRole = player.role ? parseInt(String(player.role), 10) : 0;
      if (ootpRole === 11) { isSp = true; roleReason = 'ootp-role'; }
      else if (currentStats && (currentStats.gs ?? 0) >= 5) { isSp = true; roleReason = 'current-stats-gs'; }
      else if (yearlyStats) {
        const recent = yearlyStats.find(s => s.ip > 10);
        if (recent && recent.gs >= 5) { isSp = true; roleReason = 'historical-gs'; }
      }
    }

    // Calculate projected IP (replicated from ProjectionService.calculateProjectedIp)
    const stamina = scoutingForIp?.stamina ?? (isSp ? 50 : 30);
    let baseIp: number;

    if (isSp && spStaminaDistribution.length > 0 && spIpDistribution.length > 0) {
      const staminaPercentile = getPercentile(stamina, spStaminaDistribution);
      baseIp = getValueAtPercentile(staminaPercentile, spIpDistribution);
      if (baseIp < 100) baseIp = 100;
    } else {
      baseIp = isSp ? 10 + (stamina * 3.0) : 30 + (stamina * 0.6);
      if (isSp) baseIp = Math.max(100, Math.min(280, baseIp));
      else baseIp = Math.max(30, Math.min(100, baseIp));
    }

    // Injury modifier (only when no historical data)
    const proneness = scoutingForIp?.injuryProneness?.toLowerCase() ?? 'normal';
    const hasHistoricalData = yearlyStats && yearlyStats.length > 0 && yearlyStats.some(s => s.ip >= (isSp ? 50 : 10));
    if (!hasHistoricalData) {
      let injuryMod = 1.0;
      switch (proneness) {
        case 'iron man': injuryMod = 1.15; break;
        case 'durable': injuryMod = 1.10; break;
        case 'normal': injuryMod = 1.0; break;
        case 'fragile': injuryMod = 0.90; break;
        case 'wrecked': injuryMod = 0.75; break;
      }
      baseIp *= injuryMod;
    }

    // Apply aging and ensemble projection
    const currentRatings = {
      stuff: tr.estimatedStuff,
      control: tr.estimatedControl,
      hra: tr.estimatedHra,
    };
    const projectedRatings = agingService.applyAging(currentRatings, playerAge);

    // Calculate temp FIP for skill modifier
    const tempStats = PotentialStatsService.calculatePitchingStats(
      { ...projectedRatings, movement: 50, babip: 50 }, 150, leagueContext
    );
    const estimatedFip = tempStats.fip;

    // Skill modifier
    let skillMod = 1.0;
    if (estimatedFip <= 3.50) skillMod = 1.20;
    else if (estimatedFip <= 4.00) skillMod = 1.10;
    else if (estimatedFip <= 4.50) skillMod = 1.0;
    else if (estimatedFip <= 5.00) skillMod = 0.90;
    else skillMod = 0.80;
    baseIp *= skillMod;

    // Historical blend
    const totalHistoricalIp = yearlyStats?.reduce((sum, s) => sum + s.ip, 0) ?? 0;
    const isLimitedExperience = totalHistoricalIp > 0 && totalHistoricalIp < 80 && playerAge < 28;
    const hasStarterProfile = isSp && stamina >= 50;

    if (yearlyStats && yearlyStats.length > 0) {
      const minIpThreshold = isSp ? 50 : 10;
      const completedSeasons = yearlyStats.filter(s => s.ip >= minIpThreshold);
      let totalWeightedIp = 0, totalWeight = 0;
      const weights = [5, 3, 2];
      for (let i = 0; i < Math.min(completedSeasons.length, 3); i++) {
        totalWeightedIp += completedSeasons[i].ip * weights[i];
        totalWeight += weights[i];
      }
      if (totalWeight > 0) {
        let weightedIp = totalWeightedIp / totalWeight;
        const recentStats = completedSeasons[0];
        if (completedSeasons.length >= 2) {
          const previousStats = completedSeasons[1];
          if (recentStats && previousStats && recentStats.ip > 120 && recentStats.ip > previousStats.ip * 1.5) {
            weightedIp = recentStats.ip;
          }
        }
        if (isLimitedExperience && hasStarterProfile) {
          baseIp = (baseIp * 0.85) + (weightedIp * 0.15);
        } else if (weightedIp > 50) {
          baseIp = (baseIp * 0.45) + (weightedIp * 0.55);
        } else {
          baseIp = (baseIp * 0.50) + (weightedIp * 0.50);
        }
      }
    } else if (currentStats) {
      const rawIp = parseIp(currentStats.ip);
      if (rawIp > 0) {
        const isYoungStarterCallup = rawIp < 80 && playerAge < 28 && hasStarterProfile;
        if (isYoungStarterCallup) baseIp = (baseIp * 0.85) + (rawIp * 0.15);
        else baseIp = (baseIp * 0.50) + (rawIp * 0.50);
      }
    }

    // Age cliff
    if (playerAge >= 46) baseIp *= 0.10;
    else if (playerAge >= 43) baseIp *= 0.40;
    else if (playerAge >= 40) baseIp *= 0.75;

    // IP cap
    const ipCap = Math.round(spMaxIp * 1.05);
    if (isSp && baseIp > ipCap) baseIp = ipCap;

    // Elite boost
    let finalIp = baseIp;
    if (estimatedFip < 3.0) finalIp = baseIp * 1.08;
    else if (estimatedFip < 3.5) {
      const t = (estimatedFip - 3.0) / 0.5;
      finalIp = baseIp * (1.08 - t * 0.05);
    } else if (estimatedFip < 4.0) {
      const t = (estimatedFip - 3.5) / 0.5;
      finalIp = baseIp * (1.03 - t * 0.03);
    }
    const projIp = Math.round(finalIp);

    // Ensemble projection for rates
    const ensemble = ensembleProjectionService.calculateEnsemble({
      currentRatings, age: playerAge, yearlyStats, leagueContext,
    });

    const potStats = PotentialStatsService.calculatePitchingStats(
      { stuff: currentRatings.stuff, control: currentRatings.control, hra: currentRatings.hra, movement: 50, babip: 50 },
      projIp, leagueContext,
    );

    const fipLike = trueRatingsCalculationService.calculateFipLike(ensemble.k9, ensemble.bb9, ensemble.hr9);

    tempPitcherProjections.push({
      playerId: tr.playerId,
      name: tr.playerName,
      teamId,
      teamName: teamMap.get(teamId) || 'FA',
      position: player.position,
      level: typeof player.level === 'string' ? parseInt(player.level, 10) : (player.level ?? 1),
      parentTeamId: player.parent_team_id ?? 0,
      age: playerAge,
      currentTrueRating: tr.trueRating,
      currentPercentile: tr.percentile,
      projectedStats: {
        k9: ensemble.k9,
        bb9: ensemble.bb9,
        hr9: ensemble.hr9,
        fip: ensemble.fip,
        war: potStats.war,
        ip: projIp,
      },
      projectedRatings,
      isSp,
      fipLike,
      projectedTrueRating: 0,
      isProspect: !hasRecentMlb,
    });
  }

  // Rank pitcher projections by fipLike
  tempPitcherProjections.sort((a, b) => a.fipLike - b.fipLike);
  const pitcherRanks = new Map<number, number>();
  let ri = 0;
  while (ri < tempPitcherProjections.length) {
    const currentFip = tempPitcherProjections[ri].fipLike;
    let rj = ri;
    while (rj < tempPitcherProjections.length && tempPitcherProjections[rj].fipLike === currentFip) rj++;
    const avgRank = (ri + 1 + rj) / 2;
    for (let rk = ri; rk < rj; rk++) pitcherRanks.set(tempPitcherProjections[rk].playerId, avgRank);
    ri = rj;
  }

  const pn = tempPitcherProjections.length;
  const pitcherProjections = tempPitcherProjections.map((p: any) => {
    const rank = pitcherRanks.get(p.playerId) || pn;
    const pctile = Math.round(((pn - rank + 0.5) / pn) * 1000) / 10;
    return { ...p, projectedTrueRating: percentileToRating(pctile) };
  });

  // Overlay canonical TR
  for (const p of pitcherProjections) {
    const canonical = pitcherTrMap.get(p.playerId);
    if (canonical) {
      p.currentTrueRating = canonical.trueRating;
      p.currentPercentile = canonical.percentile;
    }
  }

  pitcherProjections.sort((a: any, b: any) => a.projectedStats.fip - b.projectedStats.fip);

  // Sanity checks
  let pitcherIssues = 0;
  for (const p of pitcherProjections) {
    const fip = p.projectedStats.fip;
    const war = p.projectedStats.war;
    const ip = p.projectedStats.ip;
    if (!Number.isFinite(fip) || fip < 1.0 || fip > 8.0) pitcherIssues++;
    if (!Number.isFinite(war) || war < -5 || war > 15) pitcherIssues++;
    if (p.isSp && (ip < 20 || ip > 300)) pitcherIssues++;
  }
  console.log(`  ✅ Pitcher projections: ${pitcherProjections.length} (${pitcherIssues} sanity issues)`);

  // Determine statsYear and usedFallbackStats for metadata
  const pitcherTotalCurrentIp = currentYearPitching.reduce((sum: number, s: any) => sum + parseIp(s.ip), 0);
  const pitcherUsedFallback = pitcherTotalCurrentIp <= 0;

  // Count scouting metadata
  let pitcherFromMyScout = 0, pitcherFromOSA = 0;
  for (const p of pitcherProjections) {
    if (pitcherScoutMap.has(p.playerId)) pitcherFromOSA++;
  }

  // ────────── Batter Projections ──────────
  console.log('  Computing batter projections...');

  // Group multi-year batting stats by player
  const playerBattingStats = new Map<number, any[]>();
  for (const row of allBattingStats) {
    if (!playerBattingStats.has(row.player_id)) playerBattingStats.set(row.player_id, []);
    const ab = row.ab ?? 0;
    const h = row.h ?? 0;
    const pa = row.pa ?? 0;
    const bb = row.bb ?? 0;
    const hp = row.hp ?? 0;
    playerBattingStats.get(row.player_id)!.push({
      year: row.year,
      pa, ab, h,
      d: row.d ?? 0, t: row.t ?? 0, hr: row.hr ?? 0,
      bb, k: row.k ?? 0, hp, sf: row.sf ?? 0, sh: row.sh ?? 0,
      sb: row.sb ?? 0, cs: row.cs ?? 0,
      avg: ab > 0 ? h / ab : 0,
      obp: pa > 0 ? (h + bb + hp) / pa : 0,
    });
  }

  // Build player pool
  const batterIds = new Set<number>();
  playerBattingStats.forEach((_s, pid) => batterIds.add(pid));
  currentYearBatting.forEach((s: any) => batterIds.add(s.player_id));

  // Current-year batting map
  const currentBattingMap = new Map<number, any>();
  for (const r of currentYearBatting) currentBattingMap.set(r.player_id, r);

  // Build hitter TR inputs
  const hitterTrInputs: HitterTrueRatingInput[] = [];
  const batterInfoMap = new Map<number, any>();
  let batterFromMyScout = 0, batterFromOSA = 0;

  for (const playerId of batterIds) {
    const player = playerMap.get(playerId);
    const stat = currentBattingMap.get(playerId);
    const stats = playerBattingStats.get(playerId);

    if (!player) continue;
    if (player.retired) continue;

    const position = player.position || stat?.position || 0;
    if (position === 1) continue; // Skip pitchers

    const scoutingInfo = hitterScoutMap.get(playerId);
    if ((!stats || stats.length === 0) && !scoutingInfo) continue;

    const totalPa = (stats ?? []).reduce((sum: number, s: any) => sum + s.pa, 0);
    if (totalPa < 30 && !scoutingInfo) continue;

    const teamId = player.team_id ?? stat?.team_id ?? 0;
    const playerName = stat?.player_name ?? `${player.first_name} ${player.last_name}`;
    const playerAge = typeof player.age === 'string' ? parseInt(player.age, 10) : (player.age ?? 25);

    const scoutingRatings: HitterScoutingRatings | undefined = scoutingInfo ? {
      playerId,
      playerName: scoutingInfo.player_name,
      power: scoutingInfo.power,
      eye: scoutingInfo.eye,
      avoidK: scoutingInfo.avoid_k,
      contact: scoutingInfo.contact ?? 50,
      gap: scoutingInfo.gap ?? 50,
      speed: scoutingInfo.speed ?? 50,
      ovr: scoutingInfo.ovr,
      pot: scoutingInfo.pot,
      stealingAggressiveness: scoutingInfo.stealing_aggressiveness ?? scoutingInfo.sr,
      stealingAbility: scoutingInfo.stealing_ability ?? scoutingInfo.ste,
      injuryProneness: scoutingInfo.injury_proneness,
    } : undefined;

    if (scoutingInfo) batterFromOSA++;

    hitterTrInputs.push({
      playerId,
      playerName,
      yearlyStats: (stats ?? []).sort((a: any, b: any) => b.year - a.year),
      scoutingRatings,
    });

    batterInfoMap.set(playerId, {
      age: playerAge,
      teamId,
      teamName: teamMap.get(teamId) || 'FA',
      position,
      name: playerName,
      scouting: scoutingRatings,
      fromMyScout: false,
    });
  }

  const hitterTrResults = hitterTrueRatingsCalculationService.calculateTrueRatings(hitterTrInputs);

  // Build batter projections
  const POSITION_LABELS: Record<number, string> = {
    1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH',
  };

  const batterProjections: any[] = [];

  for (const trResult of hitterTrResults) {
    const info = batterInfoMap.get(trResult.playerId);
    if (!info) continue;

    const { age, teamId, teamName, position, name, scouting } = info;
    const currentRatings = {
      power: trResult.estimatedPower,
      eye: trResult.estimatedEye,
      avoidK: trResult.estimatedAvoidK,
      contact: trResult.estimatedContact,
    };

    const projectedRatings = hitterAgingService.applyAging(currentRatings, age);

    const projBbPct = HitterRatingEstimatorService.expectedBbPct(projectedRatings.eye);
    const projKPct = HitterRatingEstimatorService.expectedKPct(projectedRatings.avoidK);
    const projAvg = HitterRatingEstimatorService.expectedAvg(projectedRatings.contact);
    const projHrPct = HitterRatingEstimatorService.expectedHrPct(projectedRatings.power);

    const bbRate = projBbPct / 100;
    const hitRate = projAvg * (1 - bbRate);
    const hrRate = projHrPct / 100;
    const nonHrHitRate = Math.max(0, hitRate - hrRate);
    const tripleRate = nonHrHitRate * 0.08;
    const doubleRate = nonHrHitRate * 0.27;
    const singleRate = nonHrHitRate * 0.65;

    const projWoba = Math.max(0.200, Math.min(0.500,
      0.69 * bbRate + 0.89 * singleRate + 1.27 * doubleRate + 1.62 * tripleRate + 2.10 * hrRate
    ));
    const projIso = hrRate * 3 + doubleRate + (tripleRate * 2);
    const projObp = Math.min(0.450, projAvg + (projBbPct / 100));
    const projSlg = projAvg + projIso;
    const projOps = projObp + projSlg;

    // Projected PA
    const historicalPaData = (playerBattingStats.get(trResult.playerId) ?? []).map((s: any) => ({ year: s.year, pa: s.pa }));
    // Inline getProjectedPaWithHistory logic (same algorithm as LeagueBattingAveragesService)
    let projPa = 585; // default
    if (historicalPaData.length > 0 && age) {
      const sortedStats = [...historicalPaData].sort((a: any, b: any) => b.year - a.year).slice(0, 4);
      const paWeights = [0.40, 0.30, 0.20, 0.10];
      let weightedPaSum = 0, totalWeight = 0;
      for (let i = 0; i < sortedStats.length; i++) {
        const w = paWeights[i] || 0.10;
        weightedPaSum += sortedStats[i].pa * w;
        totalWeight += w;
      }
      const historicalAvgPa = weightedPaSum / totalWeight;

      // Age curve multiplier
      function getAgeCurveMultiplier(a: number): number {
        if (a <= 21) return 0.88 + (a - 20) * 0.02;
        if (a <= 27) return 0.88 + ((a - 21) / 6) * 0.12;
        if (a <= 32) return 1.00 - (a - 27) * 0.002;
        if (a <= 37) return 0.99 - (a - 32) * 0.03;
        return 0.84 - (a - 37) * 0.04;
      }

      let weightedAgeSum = 0;
      for (let i = 0; i < sortedStats.length; i++) {
        const w = paWeights[i] || 0.10;
        weightedAgeSum += (age - (i + 1)) * w;
      }
      const avgHistoricalAge = weightedAgeSum / totalWeight;
      const ageCurveMultiplier = getAgeCurveMultiplier(age) / getAgeCurveMultiplier(avgHistoricalAge);
      const ageAdjustedPa = historicalAvgPa * ageCurveMultiplier;

      // Injury multiplier
      const ip = scouting?.injuryProneness?.toLowerCase() ?? 'normal';
      let injuryMult = 1.0;
      switch (ip) {
        case 'iron man': injuryMult = 1.08; break;
        case 'durable': injuryMult = 1.04; break;
        case 'fragile': injuryMult = 0.88; break;
        case 'wrecked': injuryMult = 0.75; break;
      }
      const injuryAdjustedPa = ageAdjustedPa * injuryMult;

      let trustFactor = Math.min(0.98, 0.40 + (sortedStats.length * 0.20));
      if (historicalAvgPa >= 500 && sortedStats.length >= 2) trustFactor = Math.min(0.98, trustFactor + 0.05);

      // Baseline PA by age
      function getBaselinePaByAge(a: number): number {
        if (a <= 21) return 480 + (a - 20) * 20;
        if (a <= 27) return 480 + ((a - 21) / 6) * 120;
        if (a <= 32) return 600 - (a - 27) * 2;
        if (a <= 37) return 590 - (a - 32) * 20;
        return 490 - (a - 37) * 30;
      }

      const baselinePa = historicalAvgPa < 250
        ? Math.min(getBaselinePaByAge(age), 350)
        : getBaselinePaByAge(age);
      const baselineAdjusted = baselinePa * injuryMult;
      const blendedPa = (injuryAdjustedPa * trustFactor) + (baselineAdjusted * (1 - trustFactor));
      projPa = Math.round(Math.max(50, Math.min(700, blendedPa)));
    } else if (age) {
      // Fallback for players with no history
      if (age <= 21) projPa = 480;
      else if (age <= 23) projPa = 520;
      else if (age <= 32) projPa = 585;
      else if (age <= 36) projPa = 520;
      else projPa = 400;
    }

    const projHr = Math.round(projPa * (projHrPct / 100));
    const projRbi = Math.round(projHr * 3.5 + projPa * 0.08);

    // Stolen bases
    const sr = scouting?.stealingAggressiveness;
    const ste = scouting?.stealingAbility;
    let projSb: number, projCs: number;
    if (sr !== undefined && ste !== undefined) {
      const histSbData: Array<{ sb: number; cs: number; pa: number }> = [];
      for (const s of (playerBattingStats.get(trResult.playerId) ?? [])) {
        if (s.sb !== undefined && s.cs !== undefined) histSbData.push({ sb: s.sb, cs: s.cs, pa: s.pa });
      }
      if (histSbData.length > 0) {
        const sbProj = HitterRatingEstimatorService.projectStolenBasesWithHistory(sr, ste, projPa, histSbData);
        projSb = sbProj.sb; projCs = sbProj.cs;
      } else {
        const sbProj = HitterRatingEstimatorService.projectStolenBases(sr, ste, projPa);
        projSb = sbProj.sb; projCs = sbProj.cs;
      }
    } else {
      projSb = Math.round(projPa * 0.02);
      projCs = Math.round(projPa * 0.005);
    }

    // WAR calculation
    const sbRuns = projSb * 0.2 - projCs * 0.4;
    let wrcPlus = 100;
    let projWar = 0;
    if (leagueAvg) {
      const wRaaPerPa = (projWoba - leagueAvg.lgWoba) / leagueAvg.wobaScale;
      wrcPlus = Math.round(((wRaaPerPa + leagueAvg.lgRpa) / leagueAvg.lgRpa) * 100);
      const wRAA = ((projWoba - leagueAvg.lgWoba) / leagueAvg.wobaScale) * projPa;
      const replacementRuns = (projPa / 600) * 20;
      projWar = Math.round(((wRAA + replacementRuns + sbRuns) / leagueAvg.runsPerWin) * 10) / 10;
    }

    const playerForBatter = playerMap.get(trResult.playerId);
    batterProjections.push({
      playerId: trResult.playerId,
      name,
      teamId,
      teamName,
      position,
      positionLabel: POSITION_LABELS[position] || 'UT',
      level: playerForBatter ? (typeof playerForBatter.level === 'string' ? parseInt(playerForBatter.level, 10) : (playerForBatter.level ?? 1)) : 1,
      parentTeamId: playerForBatter?.parent_team_id ?? 0,
      age,
      currentTrueRating: trResult.trueRating,
      percentile: trResult.percentile,
      projectedStats: {
        woba: Math.round(projWoba * 1000) / 1000,
        avg: Math.round(projAvg * 1000) / 1000,
        obp: Math.round(projObp * 1000) / 1000,
        slg: Math.round(projSlg * 1000) / 1000,
        ops: Math.round(projOps * 1000) / 1000,
        wrcPlus,
        war: projWar,
        pa: projPa,
        hr: projHr,
        rbi: projRbi,
        sb: projSb,
        hrPct: Math.round(projHrPct * 10) / 10,
        bbPct: Math.round(projBbPct * 10) / 10,
        kPct: Math.round(projKPct * 10) / 10,
      },
      estimatedRatings: {
        power: Math.round(projectedRatings.power),
        eye: Math.round(projectedRatings.eye),
        avoidK: Math.round(projectedRatings.avoidK),
        contact: Math.round(projectedRatings.contact),
      },
      scoutingRatings: scouting ? {
        power: scouting.power,
        eye: scouting.eye,
        avoidK: scouting.avoidK,
        contact: scouting.contact ?? 50,
      } : undefined,
    });
  }

  // Overlay canonical hitter TR
  for (const p of batterProjections) {
    const canonical = hitterTrMap.get(p.playerId);
    if (canonical) {
      p.currentTrueRating = canonical.trueRating;
      p.percentile = canonical.percentile;
    }
  }

  batterProjections.sort((a: any, b: any) => b.projectedStats.war - a.projectedStats.war);

  // Batter sanity checks
  let batterIssues = 0;
  for (const p of batterProjections) {
    const war = p.projectedStats.war;
    if (!Number.isFinite(war) || war < -5 || war > 15) batterIssues++;
  }
  console.log(`  ✅ Batter projections: ${batterProjections.length} (${batterIssues} sanity issues)`);

  // ────────── Store in precomputed_cache ──────────
  const pitcherData = {
    projections: pitcherProjections,
    statsYear: pitcherUsedFallback ? year - 1 : year,
    usedFallbackStats: pitcherUsedFallback,
    totalCurrentIp: pitcherTotalCurrentIp,
    scoutingMetadata: { fromMyScout: pitcherFromMyScout, fromOSA: pitcherFromOSA },
  };

  const batterData = {
    projections: batterProjections,
    statsYear: year,
    usedFallbackStats: false,
    scoutingMetadata: { fromMyScout: batterFromMyScout, fromOSA: batterFromOSA },
  };

  await Promise.all([
    supabaseUpsertBatches('precomputed_cache', [{ key: 'pitcher_projections', data: pitcherData }], 1, 'key'),
    supabaseUpsertBatches('precomputed_cache', [{ key: 'batter_projections', data: batterData }], 1, 'key'),
  ]);
  console.log('  ✅ Projections saved to precomputed_cache');

  return { pitcherProj: pitcherProjections.length, batterProj: batterProjections.length };
}

// ──────────────────────────────────────────────
// Step 6: League Context
// ──────────────────────────────────────────────

async function computeLeagueContext(ctx: SyncContext): Promise<void> {
  console.log('\n=== Step 6: Compute league context ===');
  const year = ctx.year;

  // Filter current-year stats with WAR from context
  const battingRows = ctx.currentYearBatting.filter(r => r.war != null);
  const pitchingRows = ctx.currentYearPitching.filter(r => r.war != null);
  const contracts = ctx.contracts;

  // Batter WAR max
  const batterWarMax = battingRows.reduce((mx, r) => Math.max(mx, r.war ?? 0), 0);
  console.log(`  Batter WAR max: ${batterWarMax}`);

  // Pitcher WAR max
  const pitcherWarMax = pitchingRows.reduce((mx, r) => Math.max(mx, r.war ?? 0), 0);
  console.log(`  Pitcher WAR max: ${pitcherWarMax}`);

  // FIP distribution (50+ IP)
  const fipDistribution: number[] = [];
  for (const r of pitchingRows) {
    const ip = parseFloat(String(r.ip)) || 0;
    if (ip < 50) continue;
    const fip = ((13 * (r.hra ?? 0)) + (3 * (r.bb ?? 0)) - (2 * (r.k ?? 0))) / ip + 3.47;
    fipDistribution.push(Math.round(fip * 100) / 100);
  }
  fipDistribution.sort((a, b) => a - b);
  console.log(`  FIP distribution: ${fipDistribution.length} pitchers (50+ IP)`);

  // $/WAR distribution: all players with salary >= 3M and WAR > 0.5
  const salaryMap = new Map<number, number>();
  for (const c of contracts) {
    const sal = (c.salaries ?? [])[c.current_year ?? 0] ?? 0;
    if (sal >= 3_000_000) salaryMap.set(c.player_id, sal);
  }

  // Build player WAR map from both batting and pitching
  const warMap = new Map<number, number>();
  for (const r of battingRows) {
    if (r.war > 0.5) warMap.set(r.player_id, r.war);
  }
  for (const r of pitchingRows) {
    const existing = warMap.get(r.player_id) ?? 0;
    if (r.war > existing) warMap.set(r.player_id, r.war);
  }

  const dollarPerWar: number[] = [];
  for (const [pid, sal] of salaryMap) {
    const war = warMap.get(pid);
    if (war && war > 0.5) {
      dollarPerWar.push(Math.round(sal / war));
    }
  }
  dollarPerWar.sort((a, b) => a - b);
  console.log(`  $/WAR distribution: ${dollarPerWar.length} players (sal >= 3M, WAR > 0.5)`);

  // League batting averages (current year + prior year for projections)
  const leagueAverages: Record<string, any> = {};
  for (const y of [year, year - 1]) {
    const rows = ctx.mlbBattingStats.filter(r => r.year === y);
    let totalPa = 0, totalAb = 0, totalH = 0, totalD = 0, totalT = 0;
    let totalHr = 0, totalBb = 0, totalHp = 0, totalSf = 0, totalR = 0;
    for (const r of rows) {
      const pa = r.pa ?? 0;
      if (pa < 1) continue;
      totalPa += pa;
      totalAb += r.ab ?? 0;
      totalH += r.h ?? 0;
      totalD += r.d ?? 0;
      totalT += r.t ?? 0;
      totalHr += r.hr ?? 0;
      totalBb += r.bb ?? 0;
      totalHp += r.hp ?? 0;
      totalSf += r.sf ?? 0;
      totalR += r.r ?? 0;
    }
    if (totalPa > 0 && totalAb > 0) {
      const totalSingles = totalH - totalD - totalT - totalHr;
      const totalTb = totalSingles + 2 * totalD + 3 * totalT + 4 * totalHr;
      const denom = totalAb + totalBb + totalHp + totalSf;
      leagueAverages[String(y)] = {
        year: y,
        lgObp: Math.round(((totalH + totalBb + totalHp) / denom) * 1000) / 1000,
        lgSlg: Math.round((totalTb / totalAb) * 1000) / 1000,
        lgWoba: Math.round(((0.69 * totalBb + 0.72 * totalHp + 0.89 * totalSingles + 1.27 * totalD + 1.62 * totalT + 2.10 * totalHr) / denom) * 1000) / 1000,
        lgRpa: Math.round((totalR / totalPa) * 1000) / 1000,
        wobaScale: 1.15,
        runsPerWin: 10,
        totalPa,
        totalRuns: totalR,
      };
      console.log(`  League averages (${y}): lgOBP=${leagueAverages[String(y)].lgObp} lgSLG=${leagueAverages[String(y)].lgSlg} lgwOBA=${leagueAverages[String(y)].lgWoba}`);
    }
  }

  const data = { batterWarMax, pitcherWarMax, fipDistribution, dollarPerWar, leagueAverages };
  await supabaseUpsertBatches('precomputed_cache', [{ key: 'league_context', data }], 1, 'key');
  console.log('  ✅ League context saved to precomputed_cache');

  // Build compact scouting lookups
  // Format: { [playerId]: [stuff, control, hra, ovr, pot, lev, hsc, ?name, ?age, ?stamina] }
  // Extra fields (name/age/stamina) only for draftees (lev='-') to keep payload small
  console.log('  Building scouting + contract lookups...');

  const pitcherScoutLookup: Record<string, (number | string)[]> = {};
  for (const [pid, s] of ctx.pitcherScoutMap) {
    const lev = s.lev || '';
    const base = [s.stuff, s.control, s.hra, s.ovr ?? 0, s.pot ?? 0, lev, s.hsc || ''];
    if (lev === '-' || lev === '') {
      // Draftees/FAs: include extra fields for buildScoutingOnlyRows
      base.push(s.player_name || '', s.age || 0, s.stamina || 0);
    }
    pitcherScoutLookup[pid] = base;
  }

  const hitterScoutLookup: Record<string, (number | string)[]> = {};
  for (const [hPid, s] of ctx.hitterScoutMapOsa) {
    const lev = s.lev || '';
    const base = [s.contact ?? 50, s.power, s.eye, s.avoid_k, s.gap ?? 50, s.speed ?? 50, s.ovr ?? 0, s.pot ?? 0, lev, s.hsc || ''];
    if (lev === '-' || lev === '') {
      base.push(s.player_name || '', s.age || 0);
    }
    hitterScoutLookup[hPid] = base;
  }

  // Contract lookup: { [playerId]: [salary, leagueId, yearsRemaining] }
  const contractLookup: Record<string, number[]> = {};
  for (const c of ctx.contracts) {
    const salary = (c.salaries ?? [])[c.current_year ?? 0] ?? 0;
    contractLookup[c.player_id] = [salary, c.league_id ?? 0, (c.years ?? 0) - (c.current_year ?? 0)];
  }

  // DOB lookup from context
  const dobLookup: Record<string, number> = {};
  for (const [id, dob] of ctx.dobMap) {
    dobLookup[id] = dob.getFullYear();
  }

  await Promise.all([
    supabaseUpsertBatches('precomputed_cache', [{ key: 'pitcher_scouting_lookup', data: pitcherScoutLookup }], 1, 'key'),
    supabaseUpsertBatches('precomputed_cache', [{ key: 'hitter_scouting_lookup', data: hitterScoutLookup }], 1, 'key'),
    supabaseUpsertBatches('precomputed_cache', [{ key: 'contract_lookup', data: contractLookup }], 1, 'key'),
    supabaseUpsertBatches('precomputed_cache', [{ key: 'dob_lookup', data: dobLookup }], 1, 'key'),
  ]);
  console.log(`  ✅ Pitcher scouting lookup: ${Object.keys(pitcherScoutLookup).length} entries`);
  console.log(`  ✅ Hitter scouting lookup: ${Object.keys(hitterScoutLookup).length} entries`);
  console.log(`  ✅ Contract lookup: ${Object.keys(contractLookup).length} entries`);
  console.log(`  ✅ DOB lookup: ${Object.keys(dobLookup).length} entries`);
}

// ──────────────────────────────────────────────
// Step 7: Finalize
// ──────────────────────────────────────────────

async function finalize(gameDate: string): Promise<void> {
  console.log('\n=== Step 7: Finalize ===');
  await supabaseRpc('complete_sync', { sync_date: gameDate });
  console.log(`  ✅ game_date set to "${gameDate}"`);
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== WBL Sync Tool ===');
  const startTime = Date.now();

  // Step 1
  const { gameDate, year, upToDate } = await detectGameDate();

  if (upToDate && !forceSync) {
    console.log('\n  ✅ DB is already up to date — nothing to do. Use --force to re-sync.');
    return;
  }
  if (upToDate && forceSync) {
    console.log('\n  ⚠️  DB is already up to date — re-syncing anyway (--force)');
  }

  // Step 2
  await timed('Clear stale data', clearStaleData);

  // Step 3
  const writeStats = await timed('Fetch + write data', () => fetchAndWriteData(year));

  let trCounts = { pitcherTr: 0, hitterTr: 0 };
  let tfrCounts = { pitcherTfr: 0, hitterTfr: 0 };
  let projCounts = { pitcherProj: 0, batterProj: 0 };

  if (!skipCompute) {
    // Build shared context (parallel burst of ~15 queries)
    const ctx = await timed('Build sync context', () => buildSyncContext(year));

    // Step 4
    const trResult = await timed('Compute TR', () => computeTrueRatings(ctx));
    trCounts = { pitcherTr: trResult.pitcherTr, hitterTr: trResult.hitterTr };

    // Step 5
    const tfrResult = await timed('Compute TFR', () => computeTrueFutureRatings(ctx, trResult.rows));
    tfrCounts = { pitcherTfr: tfrResult.pitcherTfr, hitterTfr: tfrResult.hitterTfr };

    // Start rating writes in background — projections/league context don't depend on them
    const allRatingRows = [...trResult.rows, ...tfrResult.rows];
    let writePromise: Promise<void> = Promise.resolve();
    if (allRatingRows.length > 0) {
      const deduped = dedupRows(allRatingRows, r => `${r.player_id}_${r.rating_type}`);
      const pitcherTfrData = tfrResult.rows.filter((r: any) => r.rating_type === 'pitcher_tfr').map((r: any) => r.data);
      const hitterTfrData = tfrResult.rows.filter((r: any) => r.rating_type === 'hitter_tfr').map((r: any) => r.data);

      writePromise = timed('Write ratings + TFR cache', async () => {
        await Promise.all([
          supabaseUpsertBatches('player_ratings', deduped, BATCH_SIZE, 'player_id,rating_type', 8),
          supabaseUpsertBatches('precomputed_cache', [{ key: 'pitcher_tfr_prospects', data: pitcherTfrData }], 1, 'key'),
          supabaseUpsertBatches('precomputed_cache', [{ key: 'hitter_tfr_prospects', data: hitterTfrData }], 1, 'key'),
        ]);
        console.log(`  ✅ Wrote ${deduped.length} ratings, TFR: ${pitcherTfrData.length} pitchers, ${hitterTfrData.length} hitters`);
      });
    }

    // Step 5.5 + 6 run concurrently with rating writes
    projCounts = await timed('Compute projections', () => computeProjections(ctx, trResult.rows));
    await timed('Compute league context', () => computeLeagueContext(ctx));

    // Ensure writes complete before finalize
    await writePromise;
  }

  // Step 7
  await finalize(gameDate);

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n=== Summary ===');
  console.log(`  Game date: ${gameDate} (year ${year})`);
  console.log(`  Teams:        ${writeStats.teams}`);
  console.log(`  Players:      ${writeStats.players}`);
  console.log(`  MLB pitching: ${writeStats.mlbPitching}`);
  console.log(`  MLB batting:  ${writeStats.mlbBatting}`);
  console.log(`  MiLB pitching: ${writeStats.milbPitching}`);
  console.log(`  MiLB batting: ${writeStats.milbBatting}`);
  console.log(`  Contracts:    ${writeStats.contracts}`);
  if (!skipCompute) {
    console.log(`  Pitcher TR:   ${trCounts.pitcherTr}`);
    console.log(`  Hitter TR:    ${trCounts.hitterTr}`);
    console.log(`  Pitcher TFR:  ${tfrCounts.pitcherTfr}`);
    console.log(`  Hitter TFR:   ${tfrCounts.hitterTfr}`);
    console.log(`  Pitcher Proj: ${projCounts.pitcherProj}`);
    console.log(`  Batter Proj:  ${projCounts.batterProj}`);
  }
  const kb = (apiBytesTransferred / 1024).toFixed(0);
  const mb = (apiBytesTransferred / (1024 * 1024)).toFixed(2);
  const bandwidth = apiBytesTransferred >= 1024 * 1024 ? `${mb} MB` : `${kb} KB`;
  console.log(`  API calls:    ${apiCallCount} (${bandwidth} transferred)`);
  console.log(`  Total time:   ${elapsed}s`);
}

main().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
