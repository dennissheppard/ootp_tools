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

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────

const API_BASE = 'https://atl-01.statsplus.net/world/api';
const LEAGUE_START_YEAR = 2000;
const BATCH_SIZE = 500;

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
    stats.mlbPitching = await supabaseUpsertBatches('pitching_stats', deduped, BATCH_SIZE, 'player_id,year,league_id,split_id');
    console.log(`  ✅ MLB pitching: ${stats.mlbPitching} rows`);
  })());

  // MLB batting
  parallelPromises.push((async () => {
    console.log('  Fetching MLB batting...');
    const csv = await apiFetchText(`playerbatstatsv2/?year=${year}`);
    const rows = parseStatsCsv(csv);
    const filtered = filterColumns(rows, BATTING_COLS);
    const deduped = dedupRows(filtered, r => `${r.player_id}_${r.year}_${r.league_id}_${r.split_id}`);
    stats.mlbBatting = await supabaseUpsertBatches('batting_stats', deduped, BATCH_SIZE, 'player_id,year,league_id,split_id');
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

async function computeTrueRatings(year: number): Promise<{ pitcherTr: number; hitterTr: number; rows: any[] }> {
  console.log('\n=== Step 4: Compute True Ratings ===');
  const ratingRows: { player_id: number; rating_type: string; data: any }[] = [];

  // --- Pitcher TR ---
  console.log('  Computing pitcher TR...');

  // Fetch multi-year pitching stats (current year + 2 prior)
  const pitchingYears = [year, year - 1, year - 2].filter(y => y >= LEAGUE_START_YEAR);
  const pitchingStats = await supabaseQuery<any>(
    'pitching_stats',
    `select=*&league_id=eq.200&split_id=eq.1&year=in.(${pitchingYears.join(',')})&order=player_id`
  );

  // Fetch scouting data (latest OSA snapshot)
  const pitcherScouting = await supabaseQuery<any>(
    'pitcher_scouting',
    `select=*&source=eq.osa&order=snapshot_date.desc`
  );

  // Fetch players for names + roles
  const allPlayers = await supabaseQuery<any>('players', 'select=id,first_name,last_name,role&first_name=not.is.null');
  const playerMap = new Map<number, any>();
  for (const p of allPlayers) playerMap.set(p.id, p);

  // Build scouting lookup (latest per player)
  const scoutingMap = new Map<number, any>();
  for (const s of pitcherScouting) {
    if (!scoutingMap.has(s.player_id)) scoutingMap.set(s.player_id, s);
  }

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

  const battingYears = [year, year - 1, year - 2].filter(y => y >= LEAGUE_START_YEAR);
  const battingStats = await supabaseQuery<any>(
    'batting_stats',
    `select=*&league_id=eq.200&split_id=eq.1&year=in.(${battingYears.join(',')})&order=player_id`
  );

  // Fetch hitter scouting data (latest OSA snapshot)
  const hitterScouting = await supabaseQuery<any>(
    'hitter_scouting',
    `select=*&source=eq.osa&order=snapshot_date.desc`
  );

  const hitterScoutingMap = new Map<number, any>();
  for (const s of hitterScouting) {
    if (!hitterScoutingMap.has(s.player_id)) hitterScoutingMap.set(s.player_id, s);
  }

  // Fetch "my" scouting to override OSA
  const myHitterScouting = await supabaseQuery<any>(
    'hitter_scouting',
    `select=*&source=eq.my&order=snapshot_date.desc`
  );
  for (const s of myHitterScouting) {
    if (!hitterScoutingMap.has(s.player_id)) hitterScoutingMap.set(s.player_id, s);
  }

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
  year: number,
  trRows: { player_id: number; rating_type: string; data: any }[]
): Promise<{ pitcherTfr: number; hitterTfr: number; rows: any[] }> {
  console.log('\n=== Step 5: Compute True Future Ratings ===');
  const ratingRows: { player_id: number; rating_type: string; data: any }[] = [];

  // Build TR lookup for comparison
  const pitcherTrMap = new Map<number, number>();
  const hitterTrMap = new Map<number, number>();
  for (const row of trRows) {
    if (row.rating_type === 'pitcher_tr') pitcherTrMap.set(row.player_id, row.data.trueRating);
    if (row.rating_type === 'hitter_tr') hitterTrMap.set(row.player_id, row.data.trueRating);
  }

  // Fetch DOBs + direct age from players table
  const playerDobs = await supabaseQuery<any>('players', 'select=id,dob,age');
  const dobMap = new Map<number, Date>();
  const directAgeMap = new Map<number, number>();
  for (const p of playerDobs) {
    if (p.dob) dobMap.set(p.id, new Date(p.dob));
    if (p.age && !p.dob) directAgeMap.set(p.id, typeof p.age === 'string' ? parseInt(p.age, 10) : p.age);
  }

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

  // Build IC player set from contracts (leagueId === -200)
  const contractRows = await supabaseQuery<{ player_id: number; league_id: number }>('contracts', 'select=player_id,league_id&league_id=eq.-200');
  const icPlayerIds = new Set(contractRows.map(r => r.player_id));

  // --- Pitcher TFR ---
  console.log('  Computing pitcher TFR...');

  // Fetch pitcher scouting (latest OSA)
  const pitcherScouting = await supabaseQuery<any>(
    'pitcher_scouting',
    'select=*&source=eq.osa&order=snapshot_date.desc'
  );
  const pitcherScoutMap = new Map<number, any>();
  for (const s of pitcherScouting) {
    if (!pitcherScoutMap.has(s.player_id)) pitcherScoutMap.set(s.player_id, s);
  }

  // Aggregate career MLB IP per pitcher
  const careerIp = await supabaseQuery<any>(
    'pitching_stats',
    'select=player_id,ip&league_id=eq.200&split_id=eq.1'
  );
  const careerIpMap = new Map<number, number>();
  for (const row of careerIp) {
    const ip = typeof row.ip === 'string' ? parseFloat(row.ip) : (row.ip || 0);
    careerIpMap.set(row.player_id, (careerIpMap.get(row.player_id) || 0) + ip);
  }

  // Fetch MiLB pitching stats (2-3 recent years)
  const milbYears = [year, year - 1, year - 2].filter(y => y >= LEAGUE_START_YEAR);
  const milbPitching = await supabaseQuery<any>(
    'pitching_stats',
    `select=*&league_id=in.(201,202,203,204)&split_id=eq.1&year=in.(${milbYears.join(',')})&order=player_id`
  );

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

  // Build MLB distribution (check precomputed cache first)
  let pitcherDist = await supabaseQuery<any>('precomputed_cache', "select=data&key=eq.pitcher_mlb_distribution");
  let pitcherMlbDist: MLBPercentileDistribution;

  if (pitcherDist.length > 0 && pitcherDist[0].data) {
    pitcherMlbDist = pitcherDist[0].data;
    console.log('  Loaded pitcher MLB distribution from precomputed cache');
  } else {
    console.log('  Building pitcher MLB distribution from stats...');
    pitcherMlbDist = await buildPitcherMlbDistribution(dobMap);
    // Save to precomputed cache
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

  // Fetch all players for team info
  const allPlayers = await supabaseQuery<any>('players', 'select=id,team_id,parent_team_id,first_name,last_name,level,position&first_name=not.is.null');
  const allPlayerMap = new Map<number, any>();
  for (const p of allPlayers) allPlayerMap.set(p.id, p);

  // Fetch teams
  const allTeams = await supabaseQuery<any>('teams', 'select=id,name,nickname,parent_team_id');
  const teamMap = new Map<number, any>();
  for (const t of allTeams) teamMap.set(t.id, t);

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

  // Fetch hitter scouting
  const hitterScouting = await supabaseQuery<any>(
    'hitter_scouting',
    'select=*&source=eq.osa&order=snapshot_date.desc'
  );
  const hitterScoutMap = new Map<number, any>();
  for (const s of hitterScouting) {
    if (!hitterScoutMap.has(s.player_id)) hitterScoutMap.set(s.player_id, s);
  }

  // Aggregate career MLB stats per hitter (for farm-eligibility + mlbForTR adjustment)
  const careerBatting = await supabaseQuery<any>(
    'batting_stats',
    'select=player_id,ab,h,bb,k,hr,pa&league_id=eq.200&split_id=eq.1'
  );
  const careerAbMap = new Map<number, number>();
  const careerMlbBattingMap = new Map<number, { ab: number; h: number; bb: number; k: number; hr: number; pa: number }>();
  for (const row of careerBatting) {
    const ab = row.ab ?? 0;
    careerAbMap.set(row.player_id, (careerAbMap.get(row.player_id) || 0) + ab);
    const prev = careerMlbBattingMap.get(row.player_id) ?? { ab: 0, h: 0, bb: 0, k: 0, hr: 0, pa: 0 };
    careerMlbBattingMap.set(row.player_id, {
      ab: prev.ab + ab,
      h: prev.h + (row.h ?? 0),
      bb: prev.bb + (row.bb ?? 0),
      k: prev.k + (row.k ?? 0),
      hr: prev.hr + (row.hr ?? 0),
      pa: prev.pa + (row.pa ?? 0),
    });
  }

  // Fetch MiLB batting stats
  const milbBatting = await supabaseQuery<any>(
    'batting_stats',
    `select=*&league_id=in.(201,202,203,204)&split_id=eq.1&year=in.(${milbYears.join(',')})&order=player_id`
  );

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

  // Build hitter MLB distribution
  const hitterDistRows = await supabaseQuery<any>('precomputed_cache', "select=data&key=like.hitter_mlb_distribution_*");
  if (hitterDistRows.length > 0 && hitterDistRows[0].data) {
    // Use the first cached distribution
    (hitterTrueFutureRatingService as any)._mlbDistCache = hitterDistRows[0].data;
    (hitterTrueFutureRatingService as any)._mlbDistCacheKey = 'def_def_def';
    console.log('  Loaded hitter MLB distribution from precomputed cache');
  } else {
    console.log('  Building hitter MLB distribution from stats...');
    const hitterDist = await buildHitterMlbDistribution(dobMap);
    (hitterTrueFutureRatingService as any)._mlbDistCache = hitterDist;
    (hitterTrueFutureRatingService as any)._mlbDistCacheKey = 'def_def_def';
    // Save to precomputed cache
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
// Step 6: League Context
// ──────────────────────────────────────────────

async function computeLeagueContext(year: number): Promise<void> {
  console.log('\n=== Step 6: Compute league context ===');

  // Fetch batting + pitching stats (with player_id for $/WAR) + contracts + scouting in parallel
  const [battingRows, pitchingRows, contracts, pitcherScoutRows, hitterScoutRows] = await Promise.all([
    supabaseQuery<{ player_id: number; war: number }>(
      'batting_stats',
      `select=player_id,war&league_id=eq.200&split_id=eq.1&year=eq.${year}&war=not.is.null`
    ),
    supabaseQuery<{ player_id: number; war: number; ip: string; k: number; bb: number; hra: number }>(
      'pitching_stats',
      `select=player_id,war,ip,k,bb,hra&league_id=eq.200&split_id=eq.1&year=eq.${year}&war=not.is.null`
    ),
    supabaseQuery<{ player_id: number; salaries: number[]; current_year: number; league_id: number; years: number }>(
      'contracts',
      'select=player_id,salaries,current_year,league_id,years'
    ),
    supabaseQuery<any>(
      'pitcher_scouting',
      'select=player_id,stuff,control,hra,ovr,pot,lev,hsc,player_name,age,stamina&source=eq.osa&order=snapshot_date.desc'
    ),
    supabaseQuery<any>(
      'hitter_scouting',
      'select=player_id,contact,power,eye,avoid_k,gap,speed,ovr,pot,lev,hsc,player_name,age&source=eq.osa&order=snapshot_date.desc'
    ),
  ]);

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
    const rows = await supabaseQuery<any>(
      'batting_stats',
      `select=pa,ab,h,d,t,hr,bb,hp,sf,r&year=eq.${y}&league_id=eq.200&split_id=eq.1`
    );
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
  for (const s of pitcherScoutRows) {
    if (pitcherScoutLookup[s.player_id]) continue; // latest snapshot only (ordered desc)
    const lev = s.lev || '';
    const base = [s.stuff, s.control, s.hra, s.ovr ?? 0, s.pot ?? 0, lev, s.hsc || ''];
    if (lev === '-' || lev === '') {
      // Draftees/FAs: include extra fields for buildScoutingOnlyRows
      base.push(s.player_name || '', s.age || 0, s.stamina || 0);
    }
    pitcherScoutLookup[s.player_id] = base;
  }

  const hitterScoutLookup: Record<string, (number | string)[]> = {};
  for (const s of hitterScoutRows) {
    if (hitterScoutLookup[s.player_id]) continue;
    const lev = s.lev || '';
    const base = [s.contact ?? 50, s.power, s.eye, s.avoid_k, s.gap ?? 50, s.speed ?? 50, s.ovr ?? 0, s.pot ?? 0, lev, s.hsc || ''];
    if (lev === '-' || lev === '') {
      base.push(s.player_name || '', s.age || 0);
    }
    hitterScoutLookup[s.player_id] = base;
  }

  // Contract lookup: { [playerId]: [salary, leagueId, yearsRemaining] }
  const contractLookup: Record<string, number[]> = {};
  for (const c of contracts) {
    const salary = (c.salaries ?? [])[c.current_year ?? 0] ?? 0;
    contractLookup[c.player_id] = [salary, c.league_id ?? 0, (c.years ?? 0) - (c.current_year ?? 0)];
  }

  // DOB lookup: { [playerId]: birthYear } — replaces 12-page players?select=id,dob fetch
  const dobRows = await supabaseQuery<{ id: number; dob: string }>('players', 'select=id,dob&dob=not.is.null');
  const dobLookup: Record<string, number> = {};
  for (const r of dobRows) {
    if (r.dob) dobLookup[r.id] = new Date(r.dob).getFullYear();
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
  await clearStaleData();

  // Step 3
  const writeStats = await fetchAndWriteData(year);

  let trCounts = { pitcherTr: 0, hitterTr: 0 };
  let tfrCounts = { pitcherTfr: 0, hitterTfr: 0 };

  if (!skipCompute) {
    // Step 4
    const trResult = await computeTrueRatings(year);
    trCounts = { pitcherTr: trResult.pitcherTr, hitterTr: trResult.hitterTr };

    // Step 5
    const tfrResult = await computeTrueFutureRatings(year, trResult.rows);
    tfrCounts = { pitcherTfr: tfrResult.pitcherTfr, hitterTfr: tfrResult.hitterTfr };

    // Write all ratings to Supabase
    const allRatingRows = [...trResult.rows, ...tfrResult.rows];
    if (allRatingRows.length > 0) {
      console.log(`\n  Writing ${allRatingRows.length} rating rows to player_ratings...`);
      const deduped = dedupRows(allRatingRows, r => `${r.player_id}_${r.rating_type}`);
      await supabaseUpsertBatches('player_ratings', deduped, BATCH_SIZE, 'player_id,rating_type');
      console.log(`  ✅ Wrote ${deduped.length} ratings`);

      // Store TFR arrays in precomputed_cache (1 request per type instead of 3-4 paginated requests)
      const pitcherTfrData = tfrResult.rows.filter((r: any) => r.rating_type === 'pitcher_tfr').map((r: any) => r.data);
      const hitterTfrData = tfrResult.rows.filter((r: any) => r.rating_type === 'hitter_tfr').map((r: any) => r.data);
      await Promise.all([
        supabaseUpsertBatches('precomputed_cache', [{ key: 'pitcher_tfr_prospects', data: pitcherTfrData }], 1, 'key'),
        supabaseUpsertBatches('precomputed_cache', [{ key: 'hitter_tfr_prospects', data: hitterTfrData }], 1, 'key'),
      ]);
      console.log(`  ✅ TFR precomputed cache: ${pitcherTfrData.length} pitchers, ${hitterTfrData.length} hitters`);
    }
  }

  // Step 6 — league context (only when computing ratings)
  if (!skipCompute) {
    await computeLeagueContext(year);
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
