/**
 * sync-db.ts — CLI tool to sync WBL API data into Supabase.
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

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  supabaseQuery,
  supabaseUpsertBatches,
  supabaseRpc,
  PITCHING_COLS,
  BATTING_COLS,
  filterColumns,
  dedupRows,
  supabasePatch,
} from './lib/supabase-client';

import { SNAPSHOT_KEYS } from './freeze-projections';

import {
  wblFetchJson,
  wblFetchCsv,
  wblFetchFirebase,
  wblFetchAllStats,
  wblFetchAllScout,
  getWblStats,
  levelToLeagueId,
  levelToPlayerLevel,
} from './lib/wbl-api-client';

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
import { determinePitcherRole } from '../src/models/Player';
import { resolveCanonicalBatterData, computeBatterProjection } from '../src/services/ModalDataService';
import { leagueBattingAveragesService } from '../src/services/LeagueBattingAveragesService';
import { projectDefensiveValue, parseFieldingScouting } from '../src/services/DefensiveProjectionService';
import { parseParkFactorsCsv, computeEffectiveParkFactors, computePitcherParkHrFactor, type ParkFactorRow } from '../src/services/ParkFactorService';
import { constructOptimalLineup, redistributeTeamPA } from '../src/services/LineupConstructionService';
import { classifyPitcherRole, projectionService } from '../src/services/ProjectionService';

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────

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

/**
 * Resolve team display name for projections.
 * Draft-eligible/HSC players show their status instead of "FA".
 */
function resolveTeamName(teamId: number, player: any, teamMap: Map<number, string>, gameYear?: number): string {
  const teamName = teamMap.get(teamId);
  if (teamName) return teamName;
  const draftYear = gameYear ? ` (${gameYear})` : '';
  if (player.draft_eligible) return `Draft Eligible${draftYear}`;
  if (player.hsc) return player.hsc;
  return 'FA';
}

// ──────────────────────────────────────────────
// WBL API → Supabase contract mapping
// ──────────────────────────────────────────────

const STATSPLUS_CONTRACT_URL = 'https://atl-01.statsplus.net/world/api/contract/';

function mapContractRow(row: any, playerLeagueMap: Map<number, number>): any {
  const salaries: number[] = [];
  for (let i = 0; i <= 14; i++) {
    salaries.push(row[`salary${i}`] || 0);
  }
  const leagueId = playerLeagueMap.get(row.player_id) ?? 0;
  return {
    player_id: row.player_id,
    team_id: row.team_id || 0,
    league_id: leagueId,
    is_major: leagueId === 200,
    season_year: row.season_year || 0,
    years: row.years || 0,
    current_year: row.current_year || 0,
    salaries,
    no_trade: !!row.no_trade,
    last_year_team_option: !!row.last_year_team_option,
    last_year_player_option: !!row.last_year_player_option,
    last_year_vesting_option: !!row.last_year_vesting_option,
  };
}

/**
 * Fetch contracts from WBL API, verify they're current, fall back to StatsPlus CSV if stale.
 * The WBL API /contract endpoint sometimes doesn't include extensions/new contracts.
 */
async function fetchContracts(year: number, playerLeagueMap: Map<number, number>): Promise<any[]> {
  // Try WBL API first
  try {
    const data = await wblFetchJson<{ contracts: any[] }>('/api/contract');
    const wblContracts = data.contracts;

    // Check staleness: do any contracts have season_year matching the current year?
    const maxSeasonYear = Math.max(...wblContracts.map((c: any) => c.season_year || 0));
    if (maxSeasonYear >= year) {
      console.log(`  ✅ WBL API contracts look current (max season_year=${maxSeasonYear}, game year=${year})`);
      return wblContracts.map(c => mapContractRow(c, playerLeagueMap));
    }

    console.warn(`  ⚠️ WBL API contracts are stale (max season_year=${maxSeasonYear}, game year=${year}) — falling back to StatsPlus`);
  } catch (err) {
    console.warn(`  ⚠️ WBL API contract fetch failed — falling back to StatsPlus:`, err);
  }

  // Fallback: StatsPlus CSV (public, no auth)
  const res = await fetch(STATSPLUS_CONTRACT_URL);
  if (!res.ok) throw new Error(`StatsPlus contract fetch failed: ${res.status}`);
  const csvText = await res.text();
  const lines = csvText.split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('StatsPlus contract CSV is empty');

  const headers = lines[0].split(',');
  const rows: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    if (values.length < headers.length) continue;
    const row: any = {};
    for (let j = 0; j < headers.length; j++) {
      const h = headers[j].trim();
      const v = values[j]?.trim() ?? '';
      // Numeric fields
      row[h] = /^\d+$/.test(v) ? parseInt(v, 10) : v;
    }
    rows.push(mapContractRow(row, playerLeagueMap));
  }

  console.log(`  ✅ StatsPlus fallback: ${rows.length} contracts (max season_year=${Math.max(...rows.map(r => r.season_year))})`);
  return rows;
}

// ──────────────────────────────────────────────
// WBL API → Supabase scouting mapping
// ──────────────────────────────────────────────

const INJURY_MAP: Record<string, string> = {
  IRN: 'Iron Man',
  DUR: 'Durable',
  NOR: 'Normal',
  FRG: 'Fragile',
  WRK: 'Wrecked',
};

function mapInjuryProneness(val: string | number | null): string | null {
  if (val == null) return null;
  const s = String(val).toUpperCase();
  return INJURY_MAP[s] ?? String(val);
}

/**
 * Parse a human-readable injury duration string into approximate days.
 * Formats: "5 weeks", "9-10 months", "DtD, 1 day", "DtD, one week", "3 months", "2 days"
 */
function parseInjuryDuration(duration: string): number {
  const s = duration.toLowerCase().trim();
  // Strip "DtD, " prefix
  const core = s.startsWith('dtd,') ? s.slice(4).trim() : s;

  // Word numbers
  const wordNums: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

  // Range: "9-10 months" → use high end
  const rangeMatch = core.match(/^(\d+)\s*-\s*(\d+)\s+(day|week|month)/);
  if (rangeMatch) {
    const high = parseInt(rangeMatch[2], 10);
    const unit = rangeMatch[3];
    if (unit.startsWith('month')) return high * 30;
    if (unit.startsWith('week')) return high * 7;
    return high;
  }

  // Numeric: "5 weeks", "3 months", "2 days"
  const numMatch = core.match(/^(\d+)\s+(day|week|month)/);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    const unit = numMatch[2];
    if (unit.startsWith('month')) return n * 30;
    if (unit.startsWith('week')) return n * 7;
    return n;
  }

  // Word: "one week"
  const wordMatch = core.match(/^(\w+)\s+(day|week|month)/);
  if (wordMatch) {
    const n = wordNums[wordMatch[1]] ?? 1;
    const unit = wordMatch[2];
    if (unit.startsWith('month')) return n * 30;
    if (unit.startsWith('week')) return n * 7;
    return n;
  }

  return 0;
}

interface FirebaseInjury {
  player: string;   // "P Gabriel Sowle"
  injury: string;   // "torn labrum (Shoulder)"
  duration: string;  // "9-10 months"
  dlStatus: string;  // "Not on IL"
}

/**
 * Fetch injury data from WBL Firebase (primary source).
 * Returns a Map of "FirstName LastName" → days remaining.
 * The caller resolves names to player IDs using the player list.
 */
async function fetchFirebaseInjuries(teamIds: number[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const results = await Promise.all(
    teamIds.map(id =>
      wblFetchFirebase<FirebaseInjury[] | null>(`teamHome/${id}/injuries`)
        .catch(() => null)
    )
  );
  for (const injuries of results) {
    if (!injuries) continue;
    for (const inj of injuries) {
      const days = parseInjuryDuration(inj.duration);
      if (days <= 0) continue;
      // Player format: "POS FirstName LastName" — strip position prefix
      const name = inj.player.replace(/^[A-Z0-9]{1,3}\s+/, '');
      if (name) map.set(name, days);
    }
  }
  return map;
}

/**
 * Fallback: Parse the WBL players.csv to extract active injury days remaining per player.
 * Returns a Map of player_id → days remaining (only entries > 0).
 */
function parseInjuryCsv(csvText: string): Map<number, number> {
  const lines = csvText.split('\n');
  if (lines.length < 2) return new Map();

  const headers = lines[0].split(',');
  const iPlayerId = headers.indexOf('player_id');
  const iDlLeft = headers.indexOf('injury_dl_left');
  const iInjLeft = headers.indexOf('injury_left');
  if (iPlayerId < 0 || (iDlLeft < 0 && iInjLeft < 0)) {
    console.warn('  ⚠️ Injury CSV: missing expected columns');
    return new Map();
  }

  const map = new Map<number, number>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split(',');
    const dlLeft = iDlLeft >= 0 ? parseInt(cols[iDlLeft], 10) || 0 : 0;
    const injLeft = iInjLeft >= 0 ? parseInt(cols[iInjLeft], 10) || 0 : 0;
    const days = Math.max(dlLeft, injLeft);
    if (days > 0) {
      const pid = parseInt(cols[iPlayerId], 10);
      if (!isNaN(pid)) map.set(pid, days);
    }
  }
  return map;
}

function mapPitcherScoutingRow(r: any, gameDate: string): any {
  const pitchMap: Record<string, string> = {
    fb: 'fbp', ch: 'chp', cb: 'cbp', sl: 'slp', si: 'sip',
    sp: 'spp', ct: 'ctp', fo: 'fop', cc: 'ccp', sc: 'scp',
    kc: 'kcp', kn: 'knp',
  };
  const rawData: any = {};
  if (r.pitching?.pitches) {
    const pitches: Record<string, number> = {};
    for (const [key, val] of Object.entries(r.pitching.pitches)) {
      const mapped = pitchMap[key] || key;
      const v = parseInt(String(val), 10);
      if (v > 0) pitches[mapped] = v;
    }
    if (Object.keys(pitches).length > 0) rawData.pitches = pitches;
  }

  return {
    player_id: parseInt(r.player_id, 10),
    source: 'osa',
    snapshot_date: gameDate,
    player_name: r.player_name || null,
    stuff: parseInt(r.pitching?.stuff, 10) || null,
    control: parseInt(r.pitching?.control, 10) || null,
    hra: parseInt(r.pitching?.hra, 10) || null,
    ovr: r.overall ? parseFloat(r.overall) : null,
    pot: r.potential ? parseFloat(r.potential) : null,
    stamina: parseInt(r.pitching?.stamina, 10) || null,
    injury_proneness: mapInjuryProneness(r.injury_proneness),
    babip: r.pitching?.pbabip ?? null,
    raw_data: Object.keys(rawData).length > 0 ? rawData : null,
  };
}

function mapHitterScoutingRow(r: any, gameDate: string): any {
  return {
    player_id: parseInt(r.player_id, 10),
    source: 'osa',
    snapshot_date: gameDate,
    player_name: r.player_name || null,
    power: parseInt(r.batting?.power, 10) || null,
    eye: parseInt(r.batting?.eye, 10) || null,
    avoid_k: parseInt(r.batting?.avoidKs, 10) || null,
    contact: parseInt(r.batting?.contact, 10) || null,
    gap: parseInt(r.batting?.gap, 10) || null,
    speed: parseInt(r.batting?.speed, 10) || null,
    stealing_aggressiveness: parseInt(r.batting?.sbAgg, 10) || null,
    stealing_ability: parseInt(r.batting?.steal, 10) || null,
    injury_proneness: mapInjuryProneness(r.injury_proneness),
    ovr: r.overall ? parseFloat(r.overall) : null,
    pot: r.potential ? parseFloat(r.potential) : null,
    pos: r.position || null,
    raw_data: r.fielding ? { fielding: r.fielding } : null,
  };
}

// ──────────────────────────────────────────────
// WBL API → Supabase field mapping
// ──────────────────────────────────────────────

function mapPitchingRow(row: any): any {
  return {
    player_id: row.player_id,
    year: row.Year,
    league_id: levelToLeagueId(row.Level),
    split_id: 1,
    g: row.G ?? null,
    gs: row.GS ?? null,
    ip: String(row.IP ?? '0'),  // Supabase ip is TEXT
    w: row.W ?? null,
    l: row.L ?? null,
    s: row.SV ?? null,
    ha: row.HA ?? row.H ?? null,
    hra: row.HR ?? null,
    bb: row.BB ?? null,
    k: row.K ?? row.SO ?? null,
    er: row.ER ?? null,
    bf: row.BF ?? null,
    war: row.WAR != null ? parseFloat(String(row.WAR)) : null,
    wpa: row.WPA != null ? parseFloat(String(row.WPA)) : null,
  };
}

function mapBattingRow(row: any): any {
  return {
    player_id: row.player_id,
    year: row.Year,
    league_id: levelToLeagueId(row.Level),
    split_id: 1,
    g: row.G ?? null,
    pa: row.PA ?? null,
    ab: row.AB ?? null,
    h: row.H ?? null,
    d: row['2B'] ?? null,
    t: row['3B'] ?? null,
    hr: row.HR ?? null,
    r: row.R ?? null,
    rbi: row.RBI ?? null,
    bb: row.BB ?? null,
    k: row.K ?? row.SO ?? null,
    sb: row.SB ?? null,
    cs: row.CS ?? null,
    war: row.WAR != null ? parseFloat(String(row.WAR)) : null,
    wpa: row.WPA != null ? parseFloat(String(row.WPA)) : null,
    ubr: row.UBR != null ? parseFloat(String(row.UBR)) : null,
  };
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

  // Defensive stats (DRS) — may be empty if API not populated
  defensiveStatsMap: Map<number, any[]>;  // player_id → rows (multi-year, multi-position)

  // Park factors by team_id
  parkFactorsMap: Map<number, ParkFactorRow>;

  // Current-year subsets
  currentYearPitching: any[];
  currentYearBatting: any[];

  // Precomputed distributions (from precomputed_cache)
  precomputedPitcherDist: any | null;
  precomputedHitterDist: any | null;

  // Active injury: player_id → days remaining (only injured players)
  injuryDaysMap: Map<number, number>;
}

async function buildSyncContext(year: number): Promise<SyncContext> {
  console.log('\n=== Building sync context ===');

  const pitchingYears = [year, year - 1, year - 2, year - 3].filter(y => y >= LEAGUE_START_YEAR);
  const battingYears = [...pitchingYears];
  const milbYears = [year, year - 1, year - 2].filter(y => y >= LEAGUE_START_YEAR);

  // Wave 1a: Players, teams, contracts (light)
  const [allPlayersRaw, teamsRaw, contractsRaw] = await Promise.all([
    supabaseQuery<any>('players', 'select=*&order=id'),
    supabaseQuery<any>('teams', 'select=*&order=id'),
    supabaseQuery<any>('contracts', 'select=*&order=player_id'),
  ]);

  // Wave 1b: Scouting tables (heavy JSONB — run sequentially to avoid concurrent timeout)
  const hitterScoutCols = 'player_id,player_name,power,eye,avoid_k,contact,gap,speed,ovr,pot,pos,stealing_aggressiveness,stealing_ability,injury_proneness,raw_data';
  const pitcherScoutCols = 'player_id,player_name,stuff,control,hra,stamina,ovr,pot,injury_proneness,babip,raw_data';
  const pitcherScoutOsa = await supabaseQuery<any>('pitcher_scouting', `select=${pitcherScoutCols}&source=eq.osa&order=snapshot_date.desc`);
  const hitterScoutOsa = await supabaseQuery<any>('hitter_scouting', `select=${hitterScoutCols}&source=eq.osa&order=snapshot_date.desc`);
  const hitterScoutMy = await supabaseQuery<any>('hitter_scouting', `select=${hitterScoutCols}&source=eq.my&order=snapshot_date.desc`);

  // Wave 2: Stats + RPCs (lighter, but many rows)
  const [
    mlbPitching,
    mlbBatting,
    milbPitching,
    milbBatting,
    precomputedDists,
    careerIpRows,
    careerBatRows,
    aaaStatsRows,
    aaStatsRows,
    defensiveStatsRaw,
  ] = await Promise.all([
    supabaseQuery<any>('pitching_stats', `select=*&league_id=eq.200&split_id=eq.1&year=in.(${pitchingYears.join(',')})&order=player_id`),
    supabaseQuery<any>('batting_stats', `select=*&league_id=eq.200&split_id=eq.1&year=in.(${battingYears.join(',')})&order=player_id`),
    supabaseQuery<any>('pitching_stats', `select=*&league_id=in.(201,202,203,204)&split_id=eq.1&year=in.(${milbYears.join(',')})&order=player_id`),
    supabaseQuery<any>('batting_stats', `select=*&league_id=in.(201,202,203,204)&split_id=eq.1&year=in.(${milbYears.join(',')})&order=player_id`),
    supabaseQuery<any>('precomputed_cache', 'select=*&key=like.*distribution*'),
    supabaseRpc<any[]>('career_pitching_ip'),
    supabaseRpc<any[]>('career_batting_aggregates'),
    supabaseQuery<any>('pitching_stats', `select=player_id&league_id=eq.201&split_id=eq.1&year=eq.${year}&order=player_id`),
    supabaseQuery<any>('pitching_stats', `select=player_id&league_id=eq.202&split_id=eq.1&year=eq.${year}&order=player_id`),
    supabaseQuery<any>('defensive_stats', `select=*&year=in.(${pitchingYears.join(',')})&order=player_id`).catch(() => [] as any[]),
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

  // Defensive stats map (player_id → array of DRS rows across years/positions)
  const defensiveStatsMap = new Map<number, any[]>();
  for (const row of (defensiveStatsRaw || [])) {
    const pid = row.player_id;
    if (!defensiveStatsMap.has(pid)) defensiveStatsMap.set(pid, []);
    defensiveStatsMap.get(pid)!.push(row);
  }

  // Park factors from CSV
  let parkFactorsMap = new Map<number, ParkFactorRow>();
  try {
    const parkCsvPath = path.join(__dirname, '..', 'public', 'data', 'park_factors.csv');
    const parkCsv = fs.readFileSync(parkCsvPath, 'utf-8');
    parkFactorsMap = parseParkFactorsCsv(parkCsv);
    console.log(`  Park factors: ${parkFactorsMap.size} teams`);
  } catch (e: any) {
    console.log(`  ⚠️ Park factors not loaded: ${e.message}`);
  }

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

  // DOB gap-fill: check if any scouted players are missing DOB
  // (players.age from the API is a stale snapshot — DOB is the real source of truth for age)
  const scoutedIds = new Set([...pitcherScoutMap.keys(), ...hitterScoutMapOsa.keys()]);
  let dobGaps = 0;
  for (const pid of scoutedIds) {
    if (!dobMap.has(pid)) dobGaps++;
  }
  if (dobGaps > 0) {
    console.log(`  ${dobGaps} scouted players missing DOB — fetching players.csv...`);
    try {
      const csv = await wblFetchCsv('/csv/players.csv');
      const lines = csv.split(/\r?\n/);
      const header = lines[0]?.split(',') ?? [];
      const idIdx = header.findIndex((h: string) => h.trim().toLowerCase() === 'player_id' || h.trim().toLowerCase() === 'id');
      const dobIdx = header.findIndex((h: string) => h.trim().toLowerCase() === 'date_of_birth' || h.trim().toLowerCase() === 'dob');
      let filled = 0;
      if (idIdx >= 0 && dobIdx >= 0) {
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',');
          const pid = parseInt(cols[idIdx], 10);
          if (isNaN(pid) || dobMap.has(pid)) continue;
          const dobStr = cols[dobIdx]?.trim();
          if (!dobStr) continue;
          const dob = new Date(dobStr);
          if (!isNaN(dob.getTime())) {
            dobMap.set(pid, dob);
            filled++;
            // Also update player record for DB write
            const player = playerMap.get(pid);
            if (player) player.dob = dobStr;
          }
        }
        console.log(`  ✅ Filled ${filled} DOBs from players.csv (${dobGaps - filled} still missing)`);
      }
    } catch (err: any) {
      console.warn(`  ⚠️ DOB gap-fill failed: ${err.message}`);
    }
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
  console.log(`  Defensive stats: ${defensiveStatsMap.size} players`);

  // Active injury map (from players.injury_days_remaining, written by Step 3)
  const injuryDaysMap = new Map<number, number>();
  for (const p of allPlayersRaw) {
    const days = typeof p.injury_days_remaining === 'string'
      ? parseInt(p.injury_days_remaining, 10)
      : (p.injury_days_remaining ?? 0);
    if (days > 0) injuryDaysMap.set(p.id, days);
  }
  console.log(`  Active injuries: ${injuryDaysMap.size} players`);

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
    defensiveStatsMap,
    parkFactorsMap,
    currentYearPitching, currentYearBatting,
    precomputedPitcherDist, precomputedHitterDist,
    injuryDaysMap,
  };
}

// ──────────────────────────────────────────────
// Step 1: Detect game date + year
// ──────────────────────────────────────────────

async function detectGameDate(): Promise<{ gameDate: string; year: number; upToDate: boolean }> {
  console.log('\n=== Step 1: Detect game date ===');

  // Fetch WBL API date and DB date in parallel
  const [dateResponse, dbRows] = await Promise.all([
    wblFetchJson<{ in_game_date: { date: string }; season: string }>('/api/date'),
    supabaseQuery<{ game_date?: string }>('data_version', 'select=game_date&table_name=eq.game_state'),
  ]);

  const gameDate = dateResponse.in_game_date.date;
  const dbGameDate = dbRows[0]?.game_date ?? '(not set)';

  console.log(`  DB game date:  ${dbGameDate}`);
  console.log(`  API game date: ${gameDate}`);

  let year: number;
  if (explicitYear) {
    year = parseInt(explicitYear, 10);
    console.log(`  Using explicit year: ${year}`);
  } else {
    const apiSeason = parseInt(dateResponse.season, 10);
    const calendarYear = parseInt(gameDate.split('-')[0], 10);
    const month = parseInt(gameDate.split('-')[1], 10);

    if (!isNaN(apiSeason) && !isNaN(calendarYear)) {
      // Apr-Oct: if calendar year > API season, API is lagging — use calendar year
      // (same logic as browser DateService.getCurrentYear)
      if (month >= 4 && month <= 10 && calendarYear > apiSeason) {
        year = calendarYear;
        console.log(`  Detected year: ${year} (API says ${apiSeason}, using calendar year — API lag)`);
      } else {
        year = apiSeason;
        console.log(`  Detected year: ${year}`);
      }
    } else if (!isNaN(apiSeason)) {
      year = apiSeason;
      console.log(`  Detected year: ${year}`);
    } else {
      const yearMatch = gameDate.match(/\b(20\d{2})\b/);
      if (yearMatch) {
        year = parseInt(yearMatch[1], 10);
      } else {
        throw new Error(`Cannot parse year from game date: "${gameDate}"`);
      }
      console.log(`  Detected year: ${year} (from date fallback)`);
    }
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
  pitcherScouting: number;
  hitterScouting: number;
  defensiveStats: number;
}

async function fetchAndWriteData(year: number, gameDate: string): Promise<WriteStats> {
  console.log('\n=== Step 3: Fetch + write current-year data ===');
  const stats: WriteStats = {
    teams: 0, players: 0, mlbPitching: 0, mlbBatting: 0,
    milbPitching: 0, milbBatting: 0, contracts: 0,
    pitcherScouting: 0, hitterScouting: 0, defensiveStats: 0,
  };

  // Sequential: teams → players (FK ordering)
  console.log('  Fetching teams...');
  const WBL_LEVELS = ['wbl', 'aaa', 'aa', 'a', 'rl', 'int'] as const;
  const teamResults = await Promise.all(
    WBL_LEVELS.map(level => wblFetchJson<{ teams: Record<string, any> }>('/api/teams', { level }))
  );
  const teams: any[] = [];
  for (const result of teamResults) {
    for (const t of Object.values(result.teams)) {
      teams.push({
        id: t.team_id,
        name: t.name,
        nickname: t.nickname,
        league_id: t.league_id,
        parent_team_id: t.parent_team_id || null,
      });
    }
  }
  const dedupedTeams = dedupRows(teams, r => String(r.id));
  stats.teams = await supabaseUpsertBatches('teams', dedupedTeams, BATCH_SIZE, 'id');
  console.log(`  ✅ Teams: ${stats.teams} rows`);

  // Fetch players + injury data (Firebase primary, CSV fallback)
  const wblTeamIds = dedupedTeams.filter(t => t.league_id === 200).map(t => t.id);
  console.log('  Fetching players + injury data...');
  const [playersResponse, firebaseInjuryNames, injuryCsvText] = await Promise.all([
    wblFetchJson<{ players: any[] }>('/api/players'),
    fetchFirebaseInjuries(wblTeamIds).catch(err => {
      console.warn(`  ⚠️ Firebase injury fetch failed: ${err.message}`);
      return null;
    }),
    wblFetchCsv('/csv/players.csv').catch(err => {
      console.warn(`  ⚠️ CSV injury fetch failed: ${err.message}`);
      return '';
    }),
  ]);

  // Build name→id lookup from the player API response for Firebase name matching
  const injuryMap = new Map<number, number>();
  if (firebaseInjuryNames && firebaseInjuryNames.size > 0) {
    // Firebase returned data — resolve names to player IDs
    const nameToId = new Map<string, number>();
    for (const p of playersResponse.players) {
      if (p.name) nameToId.set(p.name, parseInt(p.player_id, 10));
    }
    let matched = 0, unmatched = 0;
    for (const [name, days] of firebaseInjuryNames) {
      const pid = nameToId.get(name);
      if (pid) {
        injuryMap.set(pid, days);
        matched++;
      } else {
        unmatched++;
      }
    }
    console.log(`  🏥 Firebase injuries: ${matched} matched, ${unmatched} unmatched`);
  } else {
    // Fallback to CSV
    const csvMap = parseInjuryCsv(injuryCsvText);
    for (const [pid, days] of csvMap) injuryMap.set(pid, days);
    console.log(`  🏥 CSV injury fallback: ${injuryMap.size} players`);
  }

  // Load draft-eligible CSV (source of truth for draft pool membership)
  const draftEligibleIds = new Set<number>();
  try {
    const draftCsvPath = path.join(__dirname, '..', 'public', 'data', 'draft_eligible.csv');
    const draftCsv = fs.readFileSync(draftCsvPath, 'utf-8');
    for (const line of draftCsv.split(/\r?\n/).slice(1)) {
      const id = parseInt(line.trim(), 10);
      if (!isNaN(id)) draftEligibleIds.add(id);
    }
    console.log(`  Draft eligible CSV: ${draftEligibleIds.size} players`);
  } catch {
    console.log('  ⚠️ No draft_eligible.csv found — draft_eligible will be false for all players');
  }

  // Build player league_id map for contract enrichment
  const playerLeagueMap = new Map<number, number>();

  const players = playersResponse.players
    .map(p => {
      const id = parseInt(p.player_id, 10);
      if (isNaN(id)) return null;

      // Ghost/deleted players: API returns name=null. Mark as retired.
      // All keys must match other rows for PostgREST batch upsert.
      if (!p.name) {
        return {
          id, first_name: null, last_name: null,
          team_id: null, parent_team_id: null, level: null,
          position: null, role: null, age: null,
          retired: true, status: 'retired',
          draft_eligible: false,
          injury_days_remaining: 0,
        };
      }

      const nameParts = p.name.split(' ');
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(' ') || '';
      const teamId = p.team_id ? parseInt(String(p.team_id), 10) : null;
      const orgId = p.org_id ? parseInt(String(p.org_id), 10) : null;
      const role = p.roster_status?.role ? parseInt(p.roster_status.role, 10) : null;
      const rosterLeagueId = p.roster_status?.league_id ? parseInt(p.roster_status.league_id, 10) : null;
      if (rosterLeagueId != null) playerLeagueMap.set(id, rosterLeagueId);

      // Player status: draft_eligible.csv is source of truth for draft pool.
      // API team_id overrides CSV — if a player is on a team, they were drafted/signed.
      const playerAge = p.age ? parseInt(p.age, 10) : null;
      const inDraftCsv = draftEligibleIds.has(id);
      let status: string;
      let isRetired = false;
      let isDraftEligible = false;
      if (teamId) {
        // On a team — active, even if they were in the draft pool (means they were drafted/signed)
        status = 'active';
      } else if (!p.roster_status) {
        status = 'retired';
        isRetired = true;
      } else if (inDraftCsv) {
        // In draft CSV + no team = draft-eligible
        status = 'draftee';
        isDraftEligible = true;
        // Sanity check: flag if age seems wrong for a draftee
        if (playerAge !== null && playerAge > 22) {
          console.warn(`  ⚠️ Draft-eligible player #${id} ${p.name} is ${playerAge} years old — verify draft_eligible.csv`);
        }
      } else if (p.roster_status.is_active === '1') {
        status = 'free_agent';
      } else {
        // No team, not in draft CSV, is_active=0 → unsigned free agent
        status = 'free_agent';
      }

      return {
        id,
        first_name: firstName,
        last_name: lastName,
        team_id: teamId === 0 ? null : teamId,
        parent_team_id: orgId === 0 ? null : orgId,
        level: p.level ? levelToPlayerLevel(p.level) : null,
        position: p.position ? parseInt(p.position, 10) : null,
        role: isNaN(role as number) ? null : role,
        age: playerAge,
        retired: isRetired,
        status,
        draft_eligible: isDraftEligible,
        injury_days_remaining: injuryMap.get(id) ?? 0,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  const dedupedPlayers = dedupRows(players, r => String(r.id));
  stats.players = await supabaseUpsertBatches('players', dedupedPlayers, BATCH_SIZE, 'id');
  console.log(`  ✅ Players: ${stats.players} rows`);

  // Parallel: MLB stats + MiLB stats + contracts + scouting
  const MILB_LEVELS = ['aaa', 'aa', 'a', 'rl'] as const;
  const MILB_NAMES = { aaa: 'AAA', aa: 'AA', a: 'A', rl: 'R' } as const;

  const parallelPromises: Promise<void>[] = [];

  // MLB pitching
  parallelPromises.push((async () => {
    console.log('  Fetching MLB pitching...');
    const rows = await wblFetchAllStats('/api/playerpitchstats', { year, level: 'wbl' });
    const mapped = filterColumns(rows.map(mapPitchingRow), PITCHING_COLS);
    const deduped = dedupRows(mapped, r => `${r.player_id}_${r.year}_${r.league_id}_${r.split_id}`);
    stats.mlbPitching = await supabaseUpsertBatches('pitching_stats', deduped, BATCH_SIZE, 'player_id,year,league_id,split_id', 4);
    console.log(`  ✅ MLB pitching: ${stats.mlbPitching} rows`);
  })());

  // MLB batting
  parallelPromises.push((async () => {
    console.log('  Fetching MLB batting...');
    const rows = await wblFetchAllStats('/api/playerbatstats', { year, level: 'wbl' });
    const mapped = filterColumns(rows.map(mapBattingRow), BATTING_COLS);
    const deduped = dedupRows(mapped, r => `${r.player_id}_${r.year}_${r.league_id}_${r.split_id}`);
    stats.mlbBatting = await supabaseUpsertBatches('batting_stats', deduped, BATCH_SIZE, 'player_id,year,league_id,split_id', 4);
    console.log(`  ✅ MLB batting: ${stats.mlbBatting} rows`);
  })());

  // MiLB pitching × 4 levels
  for (const level of MILB_LEVELS) {
    parallelPromises.push((async () => {
      const rows = await wblFetchAllStats('/api/playerpitchstats', { year, level });
      const mapped = filterColumns(rows.map(mapPitchingRow), PITCHING_COLS);
      const deduped = dedupRows(mapped, r => `${r.player_id}_${r.year}_${r.league_id}_${r.split_id}`);
      const count = await supabaseUpsertBatches('pitching_stats', deduped, BATCH_SIZE, 'player_id,year,league_id,split_id');
      stats.milbPitching += count;
      console.log(`  ✅ MiLB pitching ${MILB_NAMES[level]}: ${count} rows`);
    })());
  }

  // MiLB batting × 4 levels
  for (const level of MILB_LEVELS) {
    parallelPromises.push((async () => {
      const rows = await wblFetchAllStats('/api/playerbatstats', { year, level });
      const mapped = filterColumns(rows.map(mapBattingRow), BATTING_COLS);
      const deduped = dedupRows(mapped, r => `${r.player_id}_${r.year}_${r.league_id}_${r.split_id}`);
      const count = await supabaseUpsertBatches('batting_stats', deduped, BATCH_SIZE, 'player_id,year,league_id,split_id');
      stats.milbBatting += count;
      console.log(`  ✅ MiLB batting ${MILB_NAMES[level]}: ${count} rows`);
    })());
  }

  // Contracts (WBL API with StatsPlus CSV fallback if stale)
  parallelPromises.push((async () => {
    console.log('  Fetching contracts...');
    const contracts = await fetchContracts(year, playerLeagueMap);
    const deduped = dedupRows(contracts, r => String(r.player_id));
    stats.contracts = await supabaseUpsertBatches('contracts', deduped, BATCH_SIZE, 'player_id');
    console.log(`  ✅ Contracts: ${stats.contracts} rows`);
  })());

  // OSA Scouting
  parallelPromises.push((async () => {
    console.log('  Fetching OSA scouting...');
    const allRatings = await wblFetchAllScout('/api/scout', {});
    const pitcherRows: any[] = [];
    const hitterRows: any[] = [];
    for (const r of allRatings) {
      if (r.is_pitcher) {
        pitcherRows.push(mapPitcherScoutingRow(r, gameDate));
      } else {
        hitterRows.push(mapHitterScoutingRow(r, gameDate));
      }
    }
    if (pitcherRows.length > 0) {
      const deduped = dedupRows(pitcherRows, r => `${r.player_id}_${r.source}_${r.snapshot_date}`);
      stats.pitcherScouting = await supabaseUpsertBatches('pitcher_scouting', deduped, BATCH_SIZE, 'player_id,source,snapshot_date', 4);
    }
    if (hitterRows.length > 0) {
      const deduped = dedupRows(hitterRows, r => `${r.player_id}_${r.source}_${r.snapshot_date}`);
      stats.hitterScouting = await supabaseUpsertBatches('hitter_scouting', deduped, BATCH_SIZE, 'player_id,source,snapshot_date', 4);
    }
    console.log(`  ✅ Scouting: ${stats.pitcherScouting} pitchers, ${stats.hitterScouting} hitters`);
  })());

  // DRS (Defensive Runs Saved) — optional, API may return empty
  parallelPromises.push((async () => {
    console.log('  Fetching DRS...');
    try {
      const data = await wblFetchJson<{ drs: any[]; total: number }>('/api/drs', { year });
      if (data.drs && data.drs.length > 0) {
        const mapped = data.drs.map((r: any) => ({
          player_id: parseInt(r.player_id, 10),
          year: parseInt(r.year ?? year, 10),
          position: parseInt(r.position, 10),
          g: parseInt(r.g, 10) || 0,
          ip: String(r.ip ?? r.IP ?? '0'),
          drs: parseFloat(r.DRS ?? r.drs ?? 0),
          drs_per_162: parseFloat(r.DRS_per_162 ?? r.drs_per_162 ?? 0),
          zr: parseFloat(r.zr ?? r.ZR ?? 0),
          framing: parseFloat(r.framing ?? 0),
          arm: parseFloat(r.arm ?? 0),
        }));
        const deduped = dedupRows(mapped, r => `${r.player_id}_${r.year}_${r.position}`);
        stats.defensiveStats = await supabaseUpsertBatches('defensive_stats', deduped, BATCH_SIZE, 'player_id,year,position', 4);
      }
      console.log(`  ✅ DRS: ${stats.defensiveStats} rows${stats.defensiveStats === 0 ? ' (API returned empty — scouting-only mode)' : ''}`);
    } catch (e: any) {
      console.log(`  ⚠️ DRS fetch failed (non-fatal): ${e.message}`);
    }
  })());

  await Promise.all(parallelPromises);

  // Patch IC player levels: contract league_id=-200 → level='6'
  // The WBL API doesn't reliably set level for IC players, so we derive it from contracts
  const icIds: number[] = [];
  for (const c of dedupedPlayers) {
    // Check if this player has an IC contract (league_id=-200 in playerLeagueMap)
    if (playerLeagueMap.get(c.id) === -200) icIds.push(c.id);
  }
  if (icIds.length > 0) {
    const BATCH = 200;
    for (let i = 0; i < icIds.length; i += BATCH) {
      const batch = icIds.slice(i, i + BATCH);
      await supabasePatch('players', `id=in.(${batch.join(',')})`, { level: '6' });
    }
    console.log(`  ✅ Patched ${icIds.length} IC players → level=6`);
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

    // Determine role from scouting profile (pitches + stamina), matching browser logic
    const ootpRole = player?.role ? parseInt(player.role, 10) : undefined;
    const role = determinePitcherRole({
      pitchRatings: scouting?.raw_data?.pitches,
      stamina: scouting?.stamina,
      ootpRole,
      gamesStarted: yearlyStats.reduce((sum, y) => sum + (y.gs || 0), 0),
      inningsPitched: yearlyStats.reduce((sum, y) => sum + y.ip, 0),
    });

    pitcherInputs.push({
      playerId,
      playerName: player ? `${player.first_name} ${player.last_name}` : 'Unknown',
      yearlyStats: yearlyStats.sort((a, b) => b.year - a.year),
      scoutingRatings,
      role,
      targetYear: year,
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
      targetYear: year,
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
    pitcherTrResults: pitcherResults,
    hitterTrResults: hitterResults,
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
      case 5: return 'R';
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

    // Age: DOB → players.age → scouting.age fallback (draft-eligible players often lack DOB)
    let age = calculateAge(dobMap.get(playerId), year, playerId);
    if (!age && scouting.age) {
      const scoutAge = typeof scouting.age === 'string' ? parseInt(scouting.age, 10) : scouting.age;
      if (scoutAge >= 15 && scoutAge <= 50) age = scoutAge;
    }
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

    // Apply park HR factor to pitcher prospect's FIP if available
    const orgId = player?.parent_team_id || player?.team_id || 0;
    let adjustedHr9 = result.projHr9;
    let adjustedFip = result.projFip;
    if (ctx.parkFactorsMap.size > 0) {
      const parkRow = ctx.parkFactorsMap.get(orgId);
      if (parkRow) {
        const hrFactor = computePitcherParkHrFactor(parkRow);
        adjustedHr9 = result.projHr9 * hrFactor;
        adjustedFip = fipWarService.calculateFip({ hr9: adjustedHr9, bb9: result.projBb9, k9: result.projK9, ip: 0 });
      }
    }

    const projWar = fipWarService.calculateWar(adjustedFip, projIp);

    const pitcherProspectData: any = {
        ...result,
        name: result.playerName,
        level: icPlayerIds.has(result.playerId) ? 'IC' : getLevelLabel(player?.level),
        team: team?.nickname || 'Unknown',
        parentOrg: teamMap.get(player?.parent_team_id || player?.team_id)?.nickname || team?.nickname || 'Unknown',
        teamId: teamId || 0,
        teamName: team?.name || 'Unknown',
        teamNickname: team?.nickname || '',
        orgId,
        peakFip: adjustedFip,
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
        projHr9: adjustedHr9,
        potentialRatings: {
          stuff: result.projK9,
          control: result.projBb9,
          hra: adjustedHr9,
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
  // Require wobaValues (added when TFR ranking switched from WAR to wOBA)
  if (ctx.precomputedHitterDist && ctx.precomputedHitterDist.wobaValues) {
    hitterTrueFutureRatingService.setMLBDistributionCache(ctx.precomputedHitterDist);
    console.log('  Loaded hitter MLB distribution from precomputed cache');
  } else {
    console.log('  Building hitter MLB distribution from stats...');
    const hitterDist = await buildHitterMlbDistribution(dobMap);
    hitterTrueFutureRatingService.setMLBDistributionCache(hitterDist);
    await supabaseUpsertBatches('precomputed_cache', [{ key: 'hitter_mlb_distribution_def_def_def', data: hitterDist }], 1, 'key');
  }

  // Filter hitter prospects: career AB ≤ 130, has scouting
  const hitterTfrInputs: HitterTrueFutureRatingInput[] = [];
  hitterScoutMap.forEach((scouting, playerId) => {
    const career = careerAbMap.get(playerId) || 0;
    if (career > 130) return;

    // Age: DOB → players.age → scouting.age fallback (draft-eligible players often lack DOB)
    let age = calculateAge(dobMap.get(playerId), year, playerId);
    if (!age && scouting.age) {
      const scoutAge = typeof scouting.age === 'string' ? parseInt(scouting.age, 10) : scouting.age;
      if (scoutAge >= 15 && scoutAge <= 50) age = scoutAge;
    }
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
        injuryProneness: scouting.injury_proneness,
        stealingAggressiveness: scouting.stealing_aggressiveness,
        stealingAbility: scouting.stealing_ability,
      },
      minorLeagueStats: milbBattingByPlayer.get(playerId) || [],
      trueRating: tr,
    });
  });

  // Build PA by injury map first — passed to TFR service so it computes all derived fields
  const paByInjury = await buildPaByInjury(dobMap);

  // Build player info map for park factor adjustments (orgId + bats)
  let hitterPlayerInfoMap: Map<number, { teamId: number; bats: string }> | undefined;
  if (ctx.parkFactorsMap.size > 0) {
    hitterPlayerInfoMap = new Map<number, { teamId: number; bats: string }>();
    for (const input of hitterTfrInputs) {
      const player = allPlayerMap.get(input.playerId);
      const orgId = player?.parent_team_id || player?.team_id || 0;
      hitterPlayerInfoMap.set(input.playerId, { teamId: orgId, bats: player?.bats ?? 'R' });
    }
  }

  const hitterTfrResults = await hitterTrueFutureRatingService.calculateTrueFutureRatings(
    hitterTfrInputs, undefined, paByInjury,
    ctx.parkFactorsMap.size > 0 ? ctx.parkFactorsMap : undefined,
    hitterPlayerInfoMap
  );

  // Build RatedHitterProspect objects
  for (const result of hitterTfrResults) {
    const player = allPlayerMap.get(result.playerId);
    const scouting = hitterScoutMap.get(result.playerId)!;
    const teamId = player?.parent_team_id || player?.team_id;
    const team = teamMap.get(teamId);
    const injury = scouting.injury_proneness || 'Normal';

    // All derived fields (projObp, projSlg, projOps, wrcPlus, projWar, projPa)
    // are now computed inside calculateTrueFutureRatings() — no duplicate computation needed.

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
  const allWoba: number[] = [];

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
    allWoba.push(Math.round(wOBA * 1000) / 1000);
  }

  allBbPct.sort((a, b) => a - b);
  allKPct.sort((a, b) => a - b);
  allHrPct.sort((a, b) => a - b);
  allAvg.sort((a, b) => a - b);
  allDoublesRate.sort((a, b) => a - b);
  allTriplesRate.sort((a, b) => a - b);
  allWar.sort((a, b) => a - b);
  allWoba.sort((a, b) => a - b);

  console.log(`  Built hitter MLB dist: ${allBbPct.length} player-seasons`);

  return {
    bbPctValues: allBbPct,
    kPctValues: allKPct,
    hrPctValues: allHrPct,
    avgValues: allAvg,
    doublesRateValues: allDoublesRate,
    triplesRateValues: allTriplesRate,
    warValues: allWar,
    wobaValues: allWoba,
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
  trRows: { player_id: number; rating_type: string; data: any }[],
  tfrRows: { player_id: number; rating_type: string; data: any }[] = [],
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

  // Build TFR lookups from Step 5
  const pitcherTfrMap = new Map<number, any>();
  const hitterTfrMap = new Map<number, any>();
  for (const row of tfrRows) {
    if (row.rating_type === 'pitcher_tfr') pitcherTfrMap.set(row.player_id, row.data);
    if (row.rating_type === 'hitter_tfr') hitterTfrMap.set(row.player_id, row.data);
  }

  console.log(`  TFR lookups: ${pitcherTfrMap.size} pitchers, ${hitterTfrMap.size} hitters`);

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
  // Use prior year (year-1) as baseline — same as browser modal (BatterProfileModal line 364)
  let leagueAvg: any = null;

  // Try prior year first (projection baseline)
  {
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
  // Include draft-eligible/HSC pitchers who have scouting data but no stats
  for (const [pid, player] of playerMap) {
    if (pitcherIds.has(pid)) continue;
    const pos = typeof player.position === 'string' ? parseInt(player.position, 10) : player.position;
    if (pos !== 1) continue;
    if (!player.draft_eligible && !player.hsc) continue;
    if (pitcherScoutMap.has(pid)) pitcherIds.add(pid);
  }

  const pitcherTrInputs: TrueRatingInput[] = [];
  for (const playerId of pitcherIds) {
    const player = playerMap.get(playerId);
    const scouting = pitcherScoutMap.get(playerId);
    const yearlyStats = playerPitchingStats.get(playerId) ?? [];

    // Mirror canonical TR pipeline: require 10+ total IP or scouting
    const totalIpForPlayer = yearlyStats.reduce((sum, s) => sum + s.ip, 0);
    if (totalIpForPlayer < 10 && !scouting) continue;

    // Skip position players who haven't pitched in the last 2 years
    // (filters out former two-way players who transitioned to hitting)
    const pos = typeof player?.position === 'string' ? parseInt(player.position, 10) : (player?.position ?? 0);
    if (pos !== 1 && pos !== 0) {
      const recentIp = yearlyStats
        .filter(s => s.year >= year - 1)
        .reduce((sum, s) => sum + s.ip, 0);
      if (recentIp < 10) continue;
    }

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
    const role = determinePitcherRole({
      pitchRatings: scouting?.raw_data?.pitches,
      stamina: scouting?.stamina,
      ootpRole,
      gamesStarted: yearlyStats.reduce((sum, s) => sum + (s.gs || 0), 0),
      inningsPitched: yearlyStats.reduce((sum, s) => sum + s.ip, 0),
    });

    pitcherTrInputs.push({
      playerId,
      playerName: player ? `${player.first_name} ${player.last_name}` : 'Unknown',
      yearlyStats: yearlyStats.sort((a, b) => b.year - a.year),
      scoutingRatings,
      role,
      targetYear: year,
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
    const scouting = pitcherScoutMap.get(tr.playerId);
    const isDraftOrHsc = player.draft_eligible || player.hsc;
    const hasRecentMlb = (currentStats && parseIp(currentStats.ip) > 0) ||
      (yearlyStats && yearlyStats.some(y => y.year === year - 1 && y.ip > 0));

    // Draft-eligible/HSC players always get projections (peak year projections)
    if (!isDraftOrHsc) {
      let isMlbReady = hasRecentMlb;

      if (!isMlbReady) {
        const isUpperMinors = aaaOrAaPlayerIds.has(tr.playerId);
        const ovr = scouting?.ovr ?? 20;
        const pot = scouting?.pot ?? 20;
        const starGap = pot - ovr;
        const isQualityProspect = (ovr >= 45) || (starGap <= 1.0 && pot >= 45);
        if (isUpperMinors && (isQualityProspect || tr.trueRating >= 2.0)) isMlbReady = true;
        if (ovr >= 50) isMlbReady = true;
      }
      // Promotion-ready prospect gate: upper minors (AAA/AA) with devTR >= 1.5 or devRatio > 0.5
      if (!isMlbReady) {
        const isUpperMinors2 = aaaOrAaPlayerIds.has(tr.playerId);
        if (isUpperMinors2) {
          const tfrEntry = pitcherTfrMap.get(tr.playerId);
          const devTR = typeof tfrEntry?.developmentTR === 'number' ? tfrEntry.developmentTR : (tfrEntry?.developmentTR?.trueRating ?? 0);
          const scoutOvr = scouting?.ovr ?? 0;
          const scoutPot = scouting?.pot ?? 1;
          const devRatio = scoutOvr / scoutPot;
          if (devTR >= 1.5 || devRatio > 0.5) isMlbReady = true;
        }
      }
      if (!isMlbReady) continue;
    }

    const teamId = player.team_id ?? currentStats?.team_id ?? 0;

    // Build scouting for IP calculation — pitches are in raw_data.pitches, not the top-level column
    const scoutingForIp: any = scouting ? {
      stamina: scouting.stamina,
      injuryProneness: scouting.injury_proneness,
      pitches: scouting.raw_data?.pitches ?? scouting.pitches,
      ovr: scouting.ovr,
      pot: scouting.pot,
    } : undefined;

    // Determine SP/RP role — canonical classifier (same as browser)
    const ootpRole = player.role ? parseInt(String(player.role), 10) : 0;
    const { isSp, roleReason } = classifyPitcherRole({
      pitches: scoutingForIp?.pitches,
      stamina: scoutingForIp?.stamina,
      ootpRole,
      currentGS: currentStats?.gs,
      historicalStats: yearlyStats?.map(s => ({ ip: s.ip, gs: s.gs })),
      hasRecentMlb,
      trueRating: tr.trueRating,
    });

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

    // ── Draftee/HSC peak projection shortcut ──
    // For scouting-only draftees, use TFR data (potential ratings) directly
    // instead of the TR→ensemble pipeline which produces defaults for zero-stats players.
    if (isDraftOrHsc && !hasRecentMlb) {
      const tfr = pitcherTfrMap.get(tr.playerId);
      if (tfr) {
        console.log(`  🎓 [draftee-pitcher] ${tr.playerName} (${tr.playerId}): TFR star=${tfr.trueFutureRating}, pct=${tfr.percentile}, peakFip=${tfr.peakFip}, trueRatings=${JSON.stringify(tfr.trueRatings)}`);

        // Use TFR-derived peak projection (already computed in Step 5)
        const peakRatings = {
          stuff: tfr.trueRatings?.stuff ?? scouting?.stuff ?? 50,
          control: tfr.trueRatings?.control ?? scouting?.control ?? 50,
          hra: tfr.trueRatings?.hra ?? scouting?.hra ?? 50,
        };
        const draftIp = tfr.peakIp ?? Math.round(baseIp);
        const peakStats = PotentialStatsService.calculatePitchingStats(
          { ...peakRatings, movement: 50, babip: 50 }, draftIp, leagueContext,
        );
        // Use fipWarService.calculateWar for consistency with the modal (no elite multiplier)
        const peakWar = fipWarService.calculateWar(peakStats.fip, draftIp);
        const fipLike = trueRatingsCalculationService.calculateFipLike(peakStats.k9, peakStats.bb9, peakStats.hr9);

        tempPitcherProjections.push({
          playerId: tr.playerId,
          name: tr.playerName,
          teamId,
          teamName: resolveTeamName(teamId, player, teamMap, year),
          position: player.position,
          level: typeof player.level === 'string' ? parseInt(player.level, 10) : (player.level ?? 1),
          parentTeamId: player.parent_team_id ?? 0,
          age: playerAge,
          currentTrueRating: tfr.trueFutureRating ?? 0,
          currentPercentile: tfr.percentile ?? 0,
          projectedStats: {
            k9: peakStats.k9,
            bb9: peakStats.bb9,
            hr9: peakStats.hr9,
            fip: peakStats.fip,
            war: peakWar,
            ip: draftIp,
          },
          projectedRatings: peakRatings,
          isSp,
          fipLike,
          projectedTrueRating: 0,
          isProspect: true,
        });
        continue;
      }
      // No TFR data — fall back to scouting-only via PotentialStatsService
      console.log(`  ⚠️ [draftee-pitcher] ${tr.playerName} (${tr.playerId}): NO TFR found, falling back to scouting`);
      if (scouting) {
        const scoutRatings = {
          stuff: scouting.pot >= 50 ? scouting.pot : scouting.stuff,
          control: scouting.control,
          hra: scouting.hra,
        };
        const fallbackIp = Math.round(baseIp);
        const peakStats = PotentialStatsService.calculatePitchingStats(
          { ...scoutRatings, movement: 50, babip: 50 }, fallbackIp, leagueContext,
        );
        const fallbackWar = fipWarService.calculateWar(peakStats.fip, fallbackIp);
        const fipLike = trueRatingsCalculationService.calculateFipLike(peakStats.k9, peakStats.bb9, peakStats.hr9);

        tempPitcherProjections.push({
          playerId: tr.playerId,
          name: tr.playerName,
          teamId,
          teamName: resolveTeamName(teamId, player, teamMap, year),
          position: player.position,
          level: typeof player.level === 'string' ? parseInt(player.level, 10) : (player.level ?? 1),
          parentTeamId: player.parent_team_id ?? 0,
          age: playerAge,
          currentTrueRating: 0,
          currentPercentile: 0,
          projectedStats: {
            k9: peakStats.k9,
            bb9: peakStats.bb9,
            hr9: peakStats.hr9,
            fip: peakStats.fip,
            war: fallbackWar,
            ip: fallbackIp,
          },
          projectedRatings: scoutRatings,
          isSp,
          fipLike,
          projectedTrueRating: 0,
          isProspect: true,
        });
        continue;
      }
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
      teamName: resolveTeamName(teamId, player, teamMap, year),
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

  // Promotion-ready prospects: compute current-year projections for prospects not in TR results
  // Uses developmentTR (current-ability ratings from dev curves) instead of peak TFR
  {
    const existingIds = new Set(tempPitcherProjections.map(p => p.playerId));
    let promotionProspectCount = 0;
    for (const [playerId, tfrData] of pitcherTfrMap) {
      if (existingIds.has(playerId)) continue; // Already has a projection
      const player = playerMap.get(playerId);
      if (!player || player.retired) continue;

      const scouting = pitcherScoutMap.get(playerId);
      const ovr = scouting?.ovr ?? 0;
      const pot = scouting?.pot ?? 1;
      const devRatio = ovr / pot;
      const isUpperMinors = aaaOrAaPlayerIds.has(playerId);
      const devTR = typeof tfrData.developmentTR === 'number' ? tfrData.developmentTR : (tfrData.developmentTR?.trueRating ?? 0);

      // Must be upper minors (AAA/AA) with either devTR >= 1.5 or devRatio > 0.5
      if (!isUpperMinors) continue;
      if (devTR < 1.5 && devRatio <= 0.5) continue;

      // Use development-curve TR ratings for current-ability projection
      const devRatings = tfrData.developmentTR?.ratings ?? tfrData.trueRatings ?? {};
      const stuff = devRatings.stuff ?? scouting?.stuff ?? 50;
      const control = devRatings.control ?? scouting?.control ?? 50;
      const hra = devRatings.hra ?? scouting?.hra ?? 50;

      // IP from scouting stamina (same formula as main path)
      const stamina = scouting?.stamina ?? 40;
      const pitches = scouting?.pitches ?? {};
      const usablePitches = Object.values(pitches).filter((r: any) => r >= 25).length;
      const isSp = usablePitches >= 3 && stamina >= 35;
      let baseIp: number;
      if (isSp) {
        baseIp = 10 + (stamina * 3.0);
        baseIp = Math.max(100, Math.min(280, baseIp));
      } else {
        baseIp = 30 + (stamina * 0.6);
        baseIp = Math.max(30, Math.min(100, baseIp));
      }

      // Injury modifier (same as main path)
      const proneness = (scouting?.injury_proneness ?? 'Normal').toLowerCase();
      let injuryMod = 1.0;
      switch (proneness) {
        case 'iron man': injuryMod = 1.15; break;
        case 'durable': injuryMod = 1.10; break;
        case 'fragile': injuryMod = 0.90; break;
        case 'wrecked': injuryMod = 0.75; break;
      }
      baseIp *= injuryMod;

      // Skill modifier based on projected FIP
      const projK9 = (stuff + 28) / 13.5;
      const projBb9 = (100.4 - control) / 19.2;
      const projHr9 = (86.7 - hra) / 41.7;
      const projFip = ((13 * projHr9) + (3 * projBb9) - (2 * projK9)) / 9 + 3.47;
      let skillMod = 1.0;
      if (projFip <= 3.50) skillMod = 1.20;
      else if (projFip <= 4.00) skillMod = 1.10;
      else if (projFip <= 4.50) skillMod = 1.0;
      else if (projFip <= 5.00) skillMod = 0.90;
      else skillMod = 0.80;
      baseIp *= skillMod;

      const projIp = Math.round(baseIp);
      const projWar = fipWarService.calculateWar(Math.round(projFip * 100) / 100, projIp);
      const fipLike = trueRatingsCalculationService.calculateFipLike(projK9, projBb9, projHr9);
      const playerAge = typeof player.age === 'string' ? parseInt(player.age, 10) : (player.age ?? 25);
      const teamId = player.team_id ?? 0;

      tempPitcherProjections.push({
        playerId,
        name: tfrData.playerName ?? `${player.first_name} ${player.last_name}`,
        teamId,
        teamName: resolveTeamName(teamId, player, teamMap, year),
        position: player.position,
        level: typeof player.level === 'string' ? parseInt(player.level, 10) : (player.level ?? 2),
        parentTeamId: player.parent_team_id ?? 0,
        age: playerAge,
        currentTrueRating: devTR,
        currentPercentile: 0,
        projectedStats: {
          k9: Math.round(projK9 * 100) / 100,
          bb9: Math.round(projBb9 * 100) / 100,
          hr9: Math.round(projHr9 * 100) / 100,
          fip: Math.round(projFip * 100) / 100,
          war: projWar,
          ip: projIp,
        },
        projectedRatings: { stuff, control, hra },
        isSp,
        fipLike,
        projectedTrueRating: 0,
        isProspect: true,
      });
      promotionProspectCount++;
    }
    if (promotionProspectCount > 0) {
      console.log(`  🔄 Promotion-ready prospect projections: ${promotionProspectCount} pitchers`);
    }
  }

  // Injury adjustment: reduce IP proportionally to days missed
  {
    const SEASON_DAYS = 180;
    let injuredPitcherCount = 0;
    for (const p of tempPitcherProjections) {
      const injDays = ctx.injuryDaysMap.get(p.playerId) ?? 0;
      if (injDays > 0 && p.projectedStats.ip > 0) {
        const ratio = Math.max(0, 1 - injDays / SEASON_DAYS);
        p.projectedStats.ip = Math.round(p.projectedStats.ip * ratio);
        p.projectedStats.war = fipWarService.calculateWar(p.projectedStats.fip, p.projectedStats.ip);
        injuredPitcherCount++;
      }
    }
    if (injuredPitcherCount > 0) console.log(`  🏥 Pitcher injury adjustments: ${injuredPitcherCount}`);
  }

  // Apply park factors to pitcher projections (adjust HR9 → recompute FIP → recompute WAR)
  if (ctx.parkFactorsMap.size > 0) {
    for (const p of tempPitcherProjections) {
      const parkRaw = ctx.parkFactorsMap.get(p.teamId);
      if (!parkRaw) continue;
      const pfHr = computePitcherParkHrFactor(parkRaw);
      if (pfHr === 1.0) continue;
      const s = p.projectedStats;
      s.hr9 = Math.round(s.hr9 * pfHr * 100) / 100;
      // Recompute FIP from park-adjusted HR9
      s.fip = Math.round((((13 * s.hr9) + (3 * s.bb9) - (2 * s.k9)) / 9 + 3.47) * 100) / 100;
      // Recompute WAR from park-adjusted FIP
      s.war = fipWarService.calculateWar(s.fip, s.ip);
      // Update fipLike for ranking
      p.fipLike = trueRatingsCalculationService.calculateFipLike(s.k9, s.bb9, s.hr9);
    }
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
    const injDays = ctx.injuryDaysMap.get(p.playerId);
    return { ...p, projectedTrueRating: percentileToRating(pctile), projectedPercentile: pctile, ...(injDays ? { injuryDays: injDays } : {}) };
  });

  // Overlay canonical TR
  for (const p of pitcherProjections) {
    const canonical = pitcherTrMap.get(p.playerId);
    if (canonical) {
      p.currentTrueRating = canonical.trueRating;
      p.currentPercentile = canonical.percentile;
    }
  }

  // For draftees without TFR/TR, use projected rating + percentile from FIP ranking
  for (const p of pitcherProjections) {
    if (p.isProspect && p.currentTrueRating === 0 && p.projectedTrueRating > 0) {
      p.currentTrueRating = p.projectedTrueRating;
      p.currentPercentile = p.projectedPercentile;
    }
  }

  // Attach park factor data for display
  if (ctx.parkFactorsMap.size > 0) {
    for (const p of pitcherProjections) {
      const parkRow = ctx.parkFactorsMap.get(p.teamId);
      if (parkRow) {
        p.parkHrFactor = computePitcherParkHrFactor(parkRow);
        p.parkName = parkRow.park_name;
      }
    }
  }

  pitcherProjections.sort((a: any, b: any) => a.projectedStats.fip - b.projectedStats.fip);

  // Sanity checks
  let pitcherIssues = 0;
  for (const p of pitcherProjections) {
    const fip = p.projectedStats.fip;
    const war = p.projectedStats.war;
    const ip = p.projectedStats.ip;
    const issues: string[] = [];
    if (!Number.isFinite(fip) || fip < 1.0 || fip > 8.0) issues.push(`FIP=${fip?.toFixed(2) ?? 'NaN'}`);
    if (!Number.isFinite(war) || war < -5 || war > 15) issues.push(`WAR=${war?.toFixed(1) ?? 'NaN'}`);
    if (p.isSp && (ip < 20 || ip > 300)) issues.push(`IP=${ip?.toFixed(0) ?? 'NaN'} (SP)`);
    if (issues.length > 0) {
      pitcherIssues++;
      console.warn(`  ⚠️  Pitcher #${p.playerId} ${p.name}: ${issues.join(', ')}`);
    }
  }
  console.log(`  ✅ Pitcher projections: ${pitcherProjections.length} (${pitcherIssues} sanity issues)`);

  // Draftee pitcher diagnostic
  const drafteePitchers = pitcherProjections.filter((p: any) => {
    const player = playerMap.get(p.playerId);
    return player?.draft_eligible || player?.hsc;
  });
  if (drafteePitchers.length > 0) {
    console.log(`  🎓 Draftee pitchers: ${drafteePitchers.length}`);
    const topDraftP = [...drafteePitchers].sort((a: any, b: any) => a.projectedStats.fip - b.projectedStats.fip).slice(0, 5);
    for (const p of topDraftP) {
      console.log(`    ${p.name}: FIP ${p.projectedStats.fip.toFixed(2)}, WAR ${p.projectedStats.war.toFixed(1)}, IP ${p.projectedStats.ip}, K/9 ${p.projectedStats.k9.toFixed(1)}, BB/9 ${p.projectedStats.bb9.toFixed(1)}`);
    }
  }

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
  // Include draft-eligible/HSC batters who have scouting data but no stats
  for (const [pid, player] of playerMap) {
    if (batterIds.has(pid)) continue;
    const pos = typeof player.position === 'string' ? parseInt(player.position, 10) : player.position;
    if (pos === 1) continue; // skip pitchers
    if (!player.draft_eligible && !player.hsc) continue;
    if (hitterScoutMap.has(pid)) batterIds.add(pid);
  }

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
      targetYear: year,
    });

    batterInfoMap.set(playerId, {
      age: playerAge,
      teamId,
      teamName: resolveTeamName(teamId, player, teamMap, year),
      position,
      name: playerName,
      scouting: scoutingRatings,
      fromMyScout: false,
    });
  }

  // Use canonical Step 4 TR results instead of recomputing with a different year window.
  // For draft-eligible/HSC players without canonical TR, create scouting-based TR.
  const hitterTrResults: any[] = [];
  for (const input of hitterTrInputs) {
    const canonical = hitterTrMap.get(input.playerId);
    if (canonical) {
      hitterTrResults.push(canonical);
    } else if (input.scoutingRatings) {
      // Scouting-only TR for draft-eligible players — derive blended rates from scouting
      const sr = input.scoutingRatings;
      const power = sr.power ?? 50;
      const eye = sr.eye ?? 50;
      const avoidK = sr.avoidK ?? 50;
      const contact = sr.contact ?? 50;
      const gap = sr.gap ?? 50;
      const speed = sr.speed ?? 50;

      // Use TFR data if available (peak projection from Step 5), else derive from ratings
      const tfr = hitterTfrMap.get(input.playerId);
      const blendedBbPct = tfr?.projBbPct ?? HitterRatingEstimatorService.expectedBbPct(eye);
      const blendedKPct = tfr?.projKPct ?? HitterRatingEstimatorService.expectedKPct(avoidK);
      const blendedHrPct = tfr?.projHrPct ?? HitterRatingEstimatorService.expectedHrPct(power);
      const blendedAvg = tfr?.projAvg ?? HitterRatingEstimatorService.expectedAvg(contact);
      const blendedDoublesRate = HitterRatingEstimatorService.expectedDoublesRate(gap);
      const blendedTriplesRate = HitterRatingEstimatorService.expectedTriplesRate(speed);

      // Use TFR star rating if available, fall back to scouting potential
      const tfrStarRating = tfr?.trueFutureRating ?? sr.pot ?? 0;

      hitterTrResults.push({
        playerId: input.playerId,
        playerName: input.playerName,
        blendedBbPct,
        blendedKPct,
        blendedHrPct,
        blendedAvg,
        blendedDoublesRate,
        blendedTriplesRate,
        estimatedPower: tfr?.trueRatings?.power ?? power,
        estimatedEye: tfr?.trueRatings?.eye ?? eye,
        estimatedAvoidK: tfr?.trueRatings?.avoidK ?? avoidK,
        estimatedContact: tfr?.trueRatings?.contact ?? contact,
        estimatedGap: tfr?.trueRatings?.gap ?? gap,
        estimatedSpeed: tfr?.trueRatings?.speed ?? speed,
        trueRating: tfrStarRating,
        percentile: tfr?.percentile ?? 0,
        totalPa: 0,
        isDraftee: true,
      });
    }
  }

  // Build batter projections
  const POSITION_LABELS: Record<number, string> = {
    1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH',
  };

  const batterProjections: any[] = [];
  const defensiveLookup: Record<number, [number, number, string]> = {}; // player_id → [defRuns, posAdj, source]
  let drafteeDefNonZero = 0, drafteeDefZero = 0;

  // Build batter projections using computeBatterProjection — the same function
  // the browser uses. This guarantees sync-db, the projection table, and the modal
  // all produce identical numbers.
  for (const trResult of hitterTrResults) {
    const info = batterInfoMap.get(trResult.playerId);
    if (!info) continue;

    const { age, teamId, teamName, position, name, scouting } = info;
    const playerForBatter = playerMap.get(trResult.playerId);

    // Build BatterProfileData-like object with canonical TR
    const data: any = {
      playerId: trResult.playerId,
      playerName: name,
      age,
      position,
      estimatedPower: trResult.estimatedPower,
      estimatedEye: trResult.estimatedEye,
      estimatedAvoidK: trResult.estimatedAvoidK,
      estimatedContact: trResult.estimatedContact,
      estimatedGap: trResult.estimatedGap,
      estimatedSpeed: trResult.estimatedSpeed,
      scoutGap: scouting?.gap,
      scoutSpeed: scouting?.speed,
      injuryProneness: scouting?.injuryProneness,
    };
    // For draftees: pass undefined as playerTR so resolveCanonicalBatterData doesn't
    // force isProspect=false. Instead, set up peak projection fields manually.
    if (trResult.isDraftee) {
      data.isProspect = true;
      data.hasTfrUpside = true;
      // Set TFR fields so computeBatterProjection uses them in peak mode
      data.tfrPower = trResult.estimatedPower;
      data.tfrEye = trResult.estimatedEye;
      data.tfrAvoidK = trResult.estimatedAvoidK;
      data.tfrContact = trResult.estimatedContact;
      data.tfrGap = trResult.estimatedGap;
      data.tfrSpeed = trResult.estimatedSpeed;
      data.tfrBbPct = trResult.blendedBbPct;
      data.tfrKPct = trResult.blendedKPct;
      data.tfrHrPct = trResult.blendedHrPct;
      data.tfrAvg = trResult.blendedAvg;
      // Derive OBP/SLG from blended rates
      data.tfrObp = Math.min(0.450, trResult.blendedAvg + (trResult.blendedBbPct / 100) * (1 - trResult.blendedAvg));
      const hrPerAb = (trResult.blendedHrPct / 100) / 0.88;
      const iso = trResult.blendedDoublesRate + 2 * trResult.blendedTriplesRate + 3 * hrPerAb;
      data.tfrSlg = trResult.blendedAvg + iso;
      data.projBbPct = trResult.blendedBbPct;
      data.projKPct = trResult.blendedKPct;
      data.projHrPct = trResult.blendedHrPct;
      data.projAvg = trResult.blendedAvg;
      data.projDoublesRate = trResult.blendedDoublesRate;
      data.projTriplesRate = trResult.blendedTriplesRate;
    } else {
      resolveCanonicalBatterData(data, trResult, undefined);
    }

    // Build MLB stats history for PA + SB projection
    const paByYear = new Map<number, any>();
    for (const s of ctx.mlbBattingStats) {
      if (s.player_id !== trResult.playerId) continue;
      const existing = paByYear.get(s.year);
      if (existing) {
        existing.pa += s.pa ?? 0; existing.h += s.h ?? 0;
        existing.ab += s.ab ?? 0; existing.bb += s.bb ?? 0;
        existing.hr += s.hr ?? 0; existing.d += s.d ?? 0;
        existing.t += s.t ?? 0; existing.k += s.k ?? 0;
        existing.sb += s.sb ?? 0; existing.cs += s.cs ?? 0;
        existing.rbi += s.rbi ?? 0;
      } else {
        paByYear.set(s.year, {
          year: s.year, pa: s.pa ?? 0, ab: s.ab ?? 0, h: s.h ?? 0,
          bb: s.bb ?? 0, hr: s.hr ?? 0, d: s.d ?? 0, t: s.t ?? 0,
          k: s.k ?? 0, sb: s.sb ?? 0, cs: s.cs ?? 0, rbi: s.rbi ?? 0,
        });
      }
    }
    const mlbStats = [...paByYear.values()].map((s: any) => {
      const singles = s.h - s.d - s.t - s.hr;
      const slg = s.ab > 0 ? (singles + 2 * s.d + 3 * s.t + 4 * s.hr) / s.ab : 0;
      return {
        year: s.year, level: 'MLB', pa: s.pa,
        avg: s.ab > 0 ? s.h / s.ab : 0,
        obp: s.pa > 0 ? (s.h + s.bb) / s.pa : 0,
        slg: Math.round(slg * 1000) / 1000,
        hr: s.hr, d: s.d, t: s.t, rbi: s.rbi,
        sb: s.sb, cs: s.cs, bb: s.bb, k: s.k,
      };
    });

    // Defensive projection: estimate PA first, then compute defRuns/posAdj
    // Exclude current in-progress season from PA history. Partial-year counting
    // stats are categorically wrong for playing-time projection — rate stats
    // (HR%, BB%, etc.) blend via TR year weights, but PA/HR/SB counts must come
    // from full completed seasons only.
    const paHistory = mlbStats
      .filter(s => s.year < year)
      .map(s => ({ year: s.year, pa: s.pa }));
    const estPa = paHistory.length > 0
      ? leagueBattingAveragesService.getProjectedPaWithHistory(paHistory, age, scouting?.injuryProneness)
      : leagueBattingAveragesService.getProjectedPa(scouting?.injuryProneness, age);
    const rawFieldingData = ctx.hitterScoutMapOsa.get(trResult.playerId)?.raw_data?.fielding
      ?? ctx.hitterScoutMapCombined.get(trResult.playerId)?.raw_data?.fielding;
    const scoutFielding = parseFieldingScouting(rawFieldingData);
    const drsRows = ctx.defensiveStatsMap.get(trResult.playerId) ?? [];
    const careerIp = ctx.careerIpMap.get(trResult.playerId) ?? 0;
    const defProjection = projectDefensiveValue(position, age, estPa, scoutFielding, drsRows, year, careerIp, !!trResult.isDraftee);
    if (trResult.isDraftee) {
      if (defProjection.defRuns !== 0 || defProjection.posAdj !== 0) {
        drafteeDefNonZero++;
      } else {
        drafteeDefZero++;
      }
    }
    defensiveLookup[trResult.playerId] = [defProjection.defRuns, defProjection.posAdj, defProjection.source];

    // Park factors based on player's home team and batting hand
    const playerBats = playerForBatter?.bats ?? 'R';
    const teamParkFactors = ctx.parkFactorsMap.get(teamId);
    const parkFactors = teamParkFactors ? computeEffectiveParkFactors(teamParkFactors, playerBats) : undefined;

    // Filter out current in-progress season from stats passed to projection.
    // Rate stats are already blended via TR year weights — counting stats (PA, HR, SB)
    // from a partial season would pollute the projection.
    const completedSeasonStats = mlbStats.filter(s => s.year < year);
    const modalResult = computeBatterProjection(data, completedSeasonStats, {
      projectionMode: 'current',
      projectionYear: year + 1,
      leagueAvg: leagueAvg as any,
      scoutingData: scouting ? {
        injuryProneness: scouting.injuryProneness,
        stealingAggressiveness: scouting.stealingAggressiveness,
        stealingAbility: scouting.stealingAbility,
      } : null,
      defRuns: defProjection.defRuns,
      posAdj: defProjection.posAdj,
      parkFactors,
      expectedBbPct: (eye: number) => HitterRatingEstimatorService.expectedBbPct(eye),
      expectedKPct: (avoidK: number) => HitterRatingEstimatorService.expectedKPct(avoidK),
      expectedAvg: (contact: number) => HitterRatingEstimatorService.expectedAvg(contact),
      expectedHrPct: (power: number) => HitterRatingEstimatorService.expectedHrPct(power),
      expectedDoublesRate: (gap: number) => HitterRatingEstimatorService.expectedDoublesRate(gap),
      expectedTriplesRate: (speed: number) => HitterRatingEstimatorService.expectedTriplesRate(speed),
      getProjectedPa: (injury, a) => leagueBattingAveragesService.getProjectedPa(injury, a),
      getProjectedPaWithHistory: (history, a, injury) =>
        leagueBattingAveragesService.getProjectedPaWithHistory(history, a, injury),
      calculateOpsPlus: (obp, slg, lg) => leagueBattingAveragesService.calculateOpsPlus(obp, slg, lg),
      computeWoba: (bbRate, avg, d, t, hr) => {
        const single = avg * (1 - bbRate) - hr - d - t;
        return 0.69 * bbRate + 0.89 * Math.max(0, single) + 1.27 * d + 1.62 * t + 2.10 * hr;
      },
      calculateBaserunningRuns: (sb, cs) => leagueBattingAveragesService.calculateBaserunningRuns(sb, cs),
      calculateBattingWar: (woba, pa, lg, sbRuns, defR, posA) =>
        leagueBattingAveragesService.calculateBattingWar(woba, pa, lg, sbRuns, defR, posA),
      projectStolenBases: (sr, ste, pa) => HitterRatingEstimatorService.projectStolenBases(sr, ste, pa),
      applyAgingToRates: (rates, a) => HitterRatingEstimatorService.applyAgingToBlendedRates(rates, hitterAgingService.getAgingModifiers(a)),
    });

    // Injury adjustment: reduce counting stats proportionally to days missed
    const SEASON_DAYS = 180;
    const batterInjDays = ctx.injuryDaysMap.get(trResult.playerId) ?? 0;
    const batterInjRatio = batterInjDays > 0 && modalResult.projPa > 0
      ? Math.max(0, 1 - batterInjDays / SEASON_DAYS) : 1;
    const adjPa = batterInjRatio < 1 ? Math.round(modalResult.projPa * batterInjRatio) : modalResult.projPa;
    const adjWar = batterInjRatio < 1 ? modalResult.projWar * batterInjRatio : modalResult.projWar;
    const adjHr = batterInjRatio < 1 ? Math.round(modalResult.projHr * batterInjRatio) : modalResult.projHr;
    const adjSb = batterInjRatio < 1 ? Math.round(modalResult.projSb * batterInjRatio) : modalResult.projSb;

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
        woba: Math.round(modalResult.projWoba * 100000) / 100000,
        avg: Math.round(modalResult.projAvg * 1000) / 1000,
        obp: Math.round(modalResult.projObp * 1000) / 1000,
        slg: Math.round(modalResult.projSlg * 1000) / 1000,
        ops: Math.round(modalResult.projOps * 1000) / 1000,
        wrcPlus: modalResult.projOpsPlus,
        war: Math.round(adjWar * 10) / 10,
        pa: adjPa,
        hr: adjHr,
        rbi: Math.round(adjHr * 3.5 + adjPa * 0.08),
        sb: adjSb,
        hrPct: Math.round(modalResult.projHrPct * 10) / 10,
        bbPct: Math.round(modalResult.projBbPct * 10) / 10,
        kPct: Math.round(modalResult.projKPct * 10) / 10,
        defRuns: defProjection.defRuns,
        posAdj: defProjection.posAdj,
        sbRuns: Math.round(modalResult.projSbRuns * 10) / 10,
        defSource: defProjection.source,
      },
      estimatedRatings: {
        power: trResult.estimatedPower,
        eye: trResult.estimatedEye,
        avoidK: trResult.estimatedAvoidK,
        contact: trResult.estimatedContact,
      },
      scoutingRatings: scouting ? {
        power: scouting.power,
        eye: scouting.eye,
        avoidK: scouting.avoidK,
        contact: scouting.contact ?? 50,
      } : undefined,
      bats: playerForBatter?.bats ?? undefined,
      parkFactors,
      parkName: teamParkFactors?.park_name,
      injuryDays: batterInjDays > 0 ? batterInjDays : undefined,
    });
  }

  batterProjections.sort((a: any, b: any) => b.projectedStats.war - a.projectedStats.war);

  // Batter sanity checks
  let batterIssues = 0;
  for (const p of batterProjections) {
    const war = p.projectedStats.war;
    if (!Number.isFinite(war) || war < -5 || war > 15) {
      batterIssues++;
      console.warn(`  ⚠️  Batter #${p.playerId} ${p.name}: WAR=${war?.toFixed(1) ?? 'NaN'}`);
    }
  }
  const injuredBatterCount = batterProjections.filter((p: any) => {
    const injDays = ctx.injuryDaysMap.get(p.playerId) ?? 0;
    return injDays > 0;
  }).length;
  console.log(`  ✅ Batter projections: ${batterProjections.length} (${batterIssues} sanity issues)`);
  if (injuredBatterCount > 0) console.log(`  🏥 Batter injury adjustments: ${injuredBatterCount}`);
  if (drafteeDefNonZero > 0 || drafteeDefZero > 0) {
    console.log(`  🛡️ Draftee defense: ${drafteeDefNonZero} with non-zero def, ${drafteeDefZero} with zero def`);
  }

  // Draftee batter diagnostic
  const drafteeBatters = batterProjections.filter((p: any) => {
    const player = playerMap.get(p.playerId);
    return player?.draft_eligible || player?.hsc;
  });
  if (drafteeBatters.length > 0) {
    console.log(`  🎓 Draftee batters: ${drafteeBatters.length}`);
    const topDraftB = [...drafteeBatters].sort((a: any, b: any) => b.projectedStats.war - a.projectedStats.war).slice(0, 5);
    for (const p of topDraftB) {
      console.log(`    ${p.name}: WAR ${p.projectedStats.war.toFixed(1)}, wOBA ${p.projectedStats.woba.toFixed(3)}, AVG ${p.projectedStats.avg.toFixed(3)}, PA ${p.projectedStats.pa}, HR ${p.projectedStats.hr}`);
    }
  }

  // Park factor impact summary
  if (ctx.parkFactorsMap.size > 0) {
    const byTeam = new Map<number, { team: string; wars: number[]; count: number }>();
    for (const b of batterProjections) {
      const tid = b.teamId;
      if (!byTeam.has(tid)) byTeam.set(tid, { team: b.teamName, wars: [], count: 0 });
      byTeam.get(tid)!.wars.push(b.projectedStats.war);
      byTeam.get(tid)!.count++;
    }
    const teamAvgWar = [...byTeam.entries()]
      .filter(([tid]) => ctx.parkFactorsMap.has(tid))
      .map(([tid, { team, wars }]) => {
        const pf = ctx.parkFactorsMap.get(tid)!;
        const avgWar = wars.reduce((a, b) => a + b, 0) / wars.length;
        return { team, avgWar, hrFactor: pf.hr, avgFactor: pf.avg };
      })
      .sort((a, b) => b.avgWar - a.avgWar);
    console.log('  📊 Park factor impact (avg batter WAR by team):');
    for (const { team, avgWar, hrFactor, avgFactor } of teamAvgWar.slice(0, 5)) {
      console.log(`    ${team}: avg WAR ${avgWar.toFixed(2)} (HR factor ${hrFactor.toFixed(3)}, AVG factor ${avgFactor.toFixed(3)})`);
    }
    console.log('    ...');
    for (const { team, avgWar, hrFactor, avgFactor } of teamAvgWar.slice(-3)) {
      console.log(`    ${team}: avg WAR ${avgWar.toFixed(2)} (HR factor ${hrFactor.toFixed(3)}, AVG factor ${avgFactor.toFixed(3)})`);
    }
  }

  // ────────── Roster-aware PA redistribution ──────────
  const teamBatterGroups = new Map<number, typeof batterProjections>();
  for (const proj of batterProjections) {
    const teamId = proj.parentTeamId || proj.teamId;
    if (!teamId) continue;
    if (!teamBatterGroups.has(teamId)) teamBatterGroups.set(teamId, []);
    teamBatterGroups.get(teamId)!.push(proj);
  }

  let redistTeams = 0;
  for (const [_teamId, teamBatters] of teamBatterGroups) {
    if (teamBatters.length < 2) continue;
    const { lineup, bench } = constructOptimalLineup(teamBatters, (b: any) => b.projectedStats.war);
    redistributeTeamPA(lineup, bench, {
      recalcWar: (woba, pa, sbRuns, defRuns, posAdj) => {
        return leagueBattingAveragesService.calculateBattingWar(woba, pa, leagueAvg, sbRuns, defRuns, posAdj);
      }
    });
    redistTeams++;
  }
  console.log(`  ✅ PA redistribution: ${redistTeams} teams rebalanced`);

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

  // Serialize park factors for browser
  const parkFactorsObj: Record<number, any> = {};
  for (const [teamId, pf] of ctx.parkFactorsMap) {
    parkFactorsObj[teamId] = pf;
  }

  // Write large JSONB entries sequentially — parallel writes compete for
  // connections and timeout on Supabase free tier (8s statement limit).
  await supabaseUpsertBatches('precomputed_cache', [{ key: 'pitcher_projections', data: pitcherData }], 1, 'key');
  await supabaseUpsertBatches('precomputed_cache', [{ key: 'batter_projections', data: batterData }], 1, 'key');
  await supabaseUpsertBatches('precomputed_cache', [{ key: 'defensive_lookup', data: defensiveLookup }], 1, 'key');
  await supabaseUpsertBatches('precomputed_cache', [{ key: 'park_factors', data: parkFactorsObj }], 1, 'key');
  console.log('  ✅ Projections saved to precomputed_cache');
  console.log(`  ✅ Defensive lookup: ${Object.keys(defensiveLookup).length} entries`);

  return { pitcherProj: pitcherProjections.length, batterProj: batterProjections.length };
}

// ──────────────────────────────────────────────
// Step 6: League Context
// ──────────────────────────────────────────────

async function computeLeagueContext(ctx: SyncContext, pitcherTrResults?: any[]): Promise<void> {
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

  // FIP distributions derived from TR results — same pool used for TR percentiles
  // fipLike + 3.47 = FIP, so percentile rankings are identical to TR pool
  const fipDistribution: number[] = [];
  const spFipDistribution: number[] = [];
  const rpFipDistribution: number[] = [];
  if (pitcherTrResults && pitcherTrResults.length > 0) {
    for (const tr of pitcherTrResults) {
      const fip = Math.round((tr.fipLike + 3.47) * 100) / 100;
      fipDistribution.push(fip);
      if (tr.role === 'SP' || tr.role === 'SW') spFipDistribution.push(fip);
      else rpFipDistribution.push(fip);
    }
  } else {
    // Fallback: raw stats-based (if TR results not available)
    for (const r of pitchingRows) {
      const ip = parseFloat(String(r.ip)) || 0;
      if (ip < 50) continue;
      const fip = ((13 * (r.hra ?? 0)) + (3 * (r.bb ?? 0)) - (2 * (r.k ?? 0))) / ip + 3.47;
      fipDistribution.push(Math.round(fip * 100) / 100);
    }
  }
  fipDistribution.sort((a, b) => a - b);
  spFipDistribution.sort((a, b) => a - b);
  rpFipDistribution.sort((a, b) => a - b);
  console.log(`  FIP distribution: ${fipDistribution.length} pitchers (SP: ${spFipDistribution.length}, RP: ${rpFipDistribution.length})`);

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

  // Compute league FIP constant from current-year pitching stats
  let lgFipConstant = 3.47;
  {
    let lgIp = 0, lgEr = 0, lgK = 0, lgBb = 0, lgHr = 0;
    for (const r of pitchingRows) {
      const ip = parseFloat(String(r.ip)) || 0;
      lgIp += ip; lgEr += r.er ?? 0; lgK += r.k ?? 0; lgBb += r.bb ?? 0; lgHr += r.hra ?? r.hr ?? 0;
    }
    if (lgIp > 0) {
      lgFipConstant = (lgEr / lgIp * 9) - ((13 * lgHr + 3 * lgBb - 2 * lgK) / lgIp);
    }
  }

  const data = { batterWarMax, pitcherWarMax, fipDistribution, spFipDistribution, rpFipDistribution, dollarPerWar, leagueAverages, fipConstant: lgFipConstant };
  await supabaseUpsertBatches('precomputed_cache', [{ key: 'league_context', data }], 1, 'key');
  console.log('  ✅ League context saved to precomputed_cache');

  // Build compact scouting lookups
  // Pitcher format: { [playerId]: [stuff, control, hra, ovr, pot, lev, hsc, name, age, stamina, pitches] }
  // pitches is a JSON object string (e.g. {"FB":70,"SL":55}) or empty string
  console.log('  Building scouting + contract lookups...');

  const pitcherScoutLookup: Record<string, (number | string)[]> = {};
  for (const [pid, s] of ctx.pitcherScoutMap) {
    const lev = s.lev || '';
    const pitchesStr = s.pitches && Object.keys(s.pitches).length > 0 ? JSON.stringify(s.pitches) : '';
    pitcherScoutLookup[pid] = [s.stuff, s.control, s.hra, s.ovr ?? 0, s.pot ?? 0, lev, s.hsc || '', s.player_name || '', s.age || 0, s.stamina || 0, pitchesStr];
  }

  const hitterScoutLookup: Record<string, (number | string)[]> = {};
  for (const [hPid, s] of ctx.hitterScoutMapOsa) {
    const lev = s.lev || '';
    hitterScoutLookup[hPid] = [s.contact ?? 50, s.power, s.eye, s.avoid_k, s.gap ?? 50, s.speed ?? 50, s.ovr ?? 0, s.pot ?? 0, lev, s.hsc || '', s.player_name || '', s.age || 0, s.stealing_aggressiveness ?? 0, s.stealing_ability ?? 0, s.injury_proneness || ''];
  }

  // Position ratings lookup: { [playerId]: { pos2: N, pos3: N, ... } }
  // Compact fielding position ratings for Team Planner prospect slotting
  const posRatingsLookup: Record<string, Record<string, number>> = {};
  for (const [hPid, s] of ctx.hitterScoutMapOsa) {
    const fielding = s.raw_data?.fielding;
    if (!fielding) continue;
    const posRatings: Record<string, number> = {};
    for (let i = 2; i <= 9; i++) {
      const val = parseInt(fielding[`pos${i}`], 10);
      if (val > 0) posRatings[`pos${i}`] = val;
    }
    if (Object.keys(posRatings).length > 0) {
      posRatingsLookup[hPid] = posRatings;
    }
  }

  // Contract lookup: { [playerId]: [salary, leagueId, yearsRemaining] }
  const contractLookup: Record<string, number[]> = {};
  for (const c of ctx.contracts) {
    const salary = (c.salaries ?? [])[c.current_year ?? 0] ?? 0;
    contractLookup[c.player_id] = [salary, c.league_id ?? 0, (c.years ?? 0) - (c.current_year ?? 0)];
  }

  // Player lookup: { [playerId]: [firstName, lastName, position, age, teamId, parentTeamId, level, status, draftEligible, hsc, bats] }
  // Non-retired players only — replaces getAllPlayers() in views
  const playerLookup: Record<string, (string | number | boolean | null)[]> = {};
  for (const [pid, p] of ctx.playerMap) {
    if (p.retired) continue;
    // IC players (contract league_id=-200) have level 6, but ctx.playerMap may still show level 1
    const level = ctx.icPlayerIds.has(pid) ? 6
      : (typeof p.level === 'string' ? parseInt(p.level, 10) : (p.level ?? 1));
    playerLookup[pid] = [
      p.first_name || '', p.last_name || '',
      p.position ?? 0, typeof p.age === 'string' ? parseInt(p.age, 10) : (p.age ?? 0),
      p.team_id ?? 0, p.parent_team_id ?? 0,
      level, p.status || 'active', p.draft_eligible ?? false, p.hsc || '', p.bats || '',
    ];
  }

  // DOB lookup from context
  const dobLookup: Record<string, number> = {};
  for (const [id, dob] of ctx.dobMap) {
    dobLookup[id] = dob.getFullYear();
  }

  // Write lookups sequentially — large JSONB upserts can timeout on free-tier Supabase
  const lookups: [string, any][] = [
    ['pitcher_scouting_lookup', pitcherScoutLookup],
    ['hitter_scouting_lookup', hitterScoutLookup],
    ['contract_lookup', contractLookup],
    ['dob_lookup', dobLookup],
    ['position_ratings_lookup', posRatingsLookup],
    ['player_lookup', playerLookup],
  ];
  for (const [key, data] of lookups) {
    await supabaseUpsertBatches('precomputed_cache', [{ key, data }], 1, 'key');
  }
  console.log(`  ✅ Pitcher scouting lookup: ${Object.keys(pitcherScoutLookup).length} entries`);
  console.log(`  ✅ Hitter scouting lookup: ${Object.keys(hitterScoutLookup).length} entries`);
  console.log(`  ✅ Position ratings lookup: ${Object.keys(posRatingsLookup).length} entries`);
  console.log(`  ✅ Player lookup: ${Object.keys(playerLookup).length} entries`);
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

/**
 * Auto-freeze: if the season has started and no snapshot exists for this year,
 * snapshot the current precomputed_cache before overwriting with in-season data.
 */
async function autoFreezeIfNeeded(gameDate: string, year: number): Promise<void> {
  // Check if season is in progress (Apr-Oct of the season year)
  const month = parseInt(gameDate.split('-')[1], 10);
  const gameDateYear = parseInt(gameDate.split('-')[0], 10);
  if (month < 4 || month > 10) return; // offseason — no auto-freeze

  // The projection target year is the game date's calendar year (e.g., 2022-04-18 → 2022).
  // The API `season` field may lag behind (still reporting 2021), so don't rely on it.
  const projectionYear = gameDateYear;

  // Check if snapshot already exists — check actual data, not just the index
  // (index may use old delimiter or be missing)
  const snapshotId = `opening_day_${projectionYear}`;
  const probeKey = `batter_projections__snapshot__${snapshotId}`;
  const existing = await supabaseQuery<{ key: string }>(
    'precomputed_cache',
    `select=key&key=eq.${probeKey}`
  );
  if (existing.length > 0) {
    console.log(`  Snapshot ${snapshotId} already exists — skipping auto-freeze`);
    return;
  }

  // Check that there's existing data to snapshot
  const probe = await supabaseQuery<{ key: string }>(
    'precomputed_cache',
    'select=key&key=eq.batter_projections'
  );
  if (probe.length === 0) {
    console.log('\n  ⚠️  No existing projections to snapshot — skipping auto-freeze');
    return;
  }

  console.log(`\n=== Auto-Freeze: Snapshotting opening day projections for ${projectionYear} ===`);

  // Read and copy all snapshot keys
  const rows: { key: string; data: any }[] = [];

  for (const key of SNAPSHOT_KEYS) {
    const result = await supabaseQuery<{ key: string; data: any }>(
      'precomputed_cache',
      `select=key,data&key=eq.${key}`
    );
    if (result.length > 0 && result[0].data) {
      rows.push({ key: `${key}__snapshot__${snapshotId}`, data: result[0].data });
    }
  }

  if (rows.length > 0) {
    await supabaseUpsertBatches('precomputed_cache', rows, 5, 'key');

    // Read existing index and append
    const indexRows = await supabaseQuery<{ key: string; data: any }>(
      'precomputed_cache',
      'select=data&key=eq.snapshots__index'
    );
    const existingSnapshots: any[] = indexRows[0]?.data?.snapshots ?? [];
    existingSnapshots.push({
      id: snapshotId,
      label: 'Opening Day',
      year: projectionYear,
      createdAt: new Date().toISOString(),
    });
    await supabaseUpsertBatches('precomputed_cache', [{ key: 'snapshots__index', data: { snapshots: existingSnapshots } }], 1, 'key');

    console.log(`  ✅ Auto-froze ${rows.length} keys as ${snapshotId}`);
  }
}

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

  // Auto-freeze opening day projections before first in-season sync
  await autoFreezeIfNeeded(gameDate, year);

  // Step 2
  await timed('Clear stale data', clearStaleData);

  // Step 3
  const writeStats = await timed('Fetch + write data', () => fetchAndWriteData(year, gameDate));

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
        await supabaseUpsertBatches('player_ratings', deduped, 100, 'player_id,rating_type', 2);
        await supabaseUpsertBatches('precomputed_cache', [{ key: 'pitcher_tfr_prospects', data: pitcherTfrData }], 1, 'key');
        await supabaseUpsertBatches('precomputed_cache', [{ key: 'hitter_tfr_prospects', data: hitterTfrData }], 1, 'key');
        console.log(`  ✅ Wrote ${deduped.length} ratings, TFR: ${pitcherTfrData.length} pitchers, ${hitterTfrData.length} hitters`);
      });
    }

    // Step 5.5 + 6 run concurrently with rating writes
    projCounts = await timed('Compute projections', () => computeProjections(ctx, trResult.rows, tfrResult.rows));
    await timed('Compute league context', () => computeLeagueContext(ctx, trResult.pitcherTrResults));

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
  console.log(`  Pitcher scouting: ${writeStats.pitcherScouting}`);
  console.log(`  Hitter scouting:  ${writeStats.hitterScouting}`);
  if (!skipCompute) {
    console.log(`  Pitcher TR:   ${trCounts.pitcherTr}`);
    console.log(`  Hitter TR:    ${trCounts.hitterTr}`);
    console.log(`  Pitcher TFR:  ${tfrCounts.pitcherTfr}`);
    console.log(`  Hitter TFR:   ${tfrCounts.hitterTfr}`);
    console.log(`  Pitcher Proj: ${projCounts.pitcherProj}`);
    console.log(`  Batter Proj:  ${projCounts.batterProj}`);
  }
  const wblStats = getWblStats();
  const kb = (wblStats.bytes / 1024).toFixed(0);
  const mb = (wblStats.bytes / (1024 * 1024)).toFixed(2);
  const bandwidth = wblStats.bytes >= 1024 * 1024 ? `${mb} MB` : `${kb} KB`;
  console.log(`  API calls:    ${wblStats.calls} (${bandwidth} transferred)`);
  console.log(`  Total time:   ${elapsed}s`);
}

main().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
