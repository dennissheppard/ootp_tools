/**
 * Explore Eye (BB%) development curves by peak-ability cohort.
 *
 * Question: Among players who eventually reached a similar peak BB%,
 * is there a recognizable MiLB → MLB development trajectory?
 *
 * If so, we could use it to estimate a prospect's current Eye TR
 * by placing them on the development curve for their TFR cohort.
 *
 * Usage: npx tsx tools/research/explore_eye_development.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';

// ─── Config ───────────────────────────────────────────────────────
const DATA_DIR = path.join('public', 'data');
const START_YEAR = 2000;
const END_YEAR = 2020;
const MIN_MLB_PA_FOR_PEAK = 800;   // Need enough MLB PA to identify "peak"
const MIN_SEASON_PA = 100;          // Min PA for a season to count
const PEAK_WINDOW = 3;              // Best N-year rolling window for peak BB%

// ─── Types ────────────────────────────────────────────────────────
interface BatterSeason {
  playerId: number;
  year: number;
  levelId: number;
  pa: number;
  bb: number;
  k: number;
  h: number;
  ab: number;
  hr: number;
  d: number;
  t: number;
  bbPct: number;
  kPct: number;
  hrPct: number;
  avg: number;
  age?: number;
}

interface PlayerCareer {
  playerId: number;
  mlbSeasons: BatterSeason[];
  minorSeasons: BatterSeason[];
  peakBbPct?: number;
  peakYears?: number[];
  dob?: Date;
}

// ─── Data Loading ─────────────────────────────────────────────────
function loadBattingCsv(filePath: string, year: number): BatterSeason[] {
  if (!fs.existsSync(filePath)) return [];
  const csv = fs.readFileSync(filePath, 'utf-8');
  const parsed = Papa.parse<any>(csv, { header: true, skipEmptyLines: true });

  return parsed.data
    .filter(row => {
      const pa = parseInt(row.pa);
      return pa && pa >= 1;
    })
    .map(row => {
      const pa = parseInt(row.pa) || 0;
      const bb = parseInt(row.bb) || 0;
      const k = parseInt(row.k) || 0;
      const h = parseInt(row.h) || 0;
      const ab = parseInt(row.ab) || 0;
      const hr = parseInt(row.hr) || 0;
      const d = parseInt(row.d) || 0;
      const t = parseInt(row.t) || 0;

      return {
        playerId: parseInt(row.player_id),
        year,
        levelId: parseInt(row.level_id),
        pa, bb, k, h, ab, hr, d, t,
        bbPct: pa > 0 ? (bb / pa) * 100 : 0,
        kPct: pa > 0 ? (k / pa) * 100 : 0,
        hrPct: pa > 0 ? (hr / pa) * 100 : 0,
        avg: ab > 0 ? h / ab : 0,
      };
    });
}

function loadDobFile(filePath: string): Map<number, Date> {
  const map = new Map<number, Date>();
  if (!fs.existsSync(filePath)) return map;
  const csv = fs.readFileSync(filePath, 'utf-8');
  const parsed = Papa.parse<any>(csv, { header: true, skipEmptyLines: true });
  for (const row of parsed.data) {
    const id = parseInt(row.ID);
    if (!id || !row.DOB) continue;
    const dob = new Date(row.DOB);
    if (!isNaN(dob.getTime())) {
      map.set(id, dob);
    }
  }
  return map;
}

function getAge(dob: Date, year: number): number {
  // Approximate: season midpoint is July 1
  const seasonMid = new Date(year, 6, 1);
  return Math.floor((seasonMid.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

// ─── Main ─────────────────────────────────────────────────────────
function main() {
  console.log('Loading DOB files...');
  const dobMap = new Map<number, Date>();
  for (const [file] of [
    ['mlb_dob.csv'], ['a_dob.csv'], ['aa_dob.csv'], ['aaa_dob.csv'], ['rookie_dob.csv']
  ]) {
    const dobs = loadDobFile(path.join(DATA_DIR, file));
    for (const [id, dob] of dobs) dobMap.set(id, dob);
  }
  console.log(`  ${dobMap.size} players with DOB`);

  // Step 1: Load all batting data
  console.log('\nLoading batting data...');
  const playerSeasons = new Map<number, BatterSeason[]>();

  for (let year = START_YEAR; year <= END_YEAR; year++) {
    // MLB
    const mlb = loadBattingCsv(path.join(DATA_DIR, 'mlb_batting', `${year}_batting.csv`), year);
    for (const s of mlb) {
      s.levelId = 1; // Ensure MLB
      const dob = dobMap.get(s.playerId);
      if (dob) s.age = getAge(dob, year);
      if (!playerSeasons.has(s.playerId)) playerSeasons.set(s.playerId, []);
      playerSeasons.get(s.playerId)!.push(s);
    }

    // Minors
    for (const [level, levelId] of [['aaa', 2], ['aa', 3], ['a', 4], ['r', 6]] as const) {
      const minor = loadBattingCsv(
        path.join(DATA_DIR, 'minors_batting', `${year}_${level}_batting.csv`), year
      );
      for (const s of minor) {
        s.levelId = levelId as number;
        const dob = dobMap.get(s.playerId);
        if (dob) s.age = getAge(dob, year);
        if (!playerSeasons.has(s.playerId)) playerSeasons.set(s.playerId, []);
        playerSeasons.get(s.playerId)!.push(s);
      }
    }
  }

  console.log(`  ${playerSeasons.size} unique players loaded`);

  // Step 2: Build careers and find peak BB%
  console.log('\nBuilding career profiles...');
  const careers: PlayerCareer[] = [];

  for (const [playerId, seasons] of playerSeasons) {
    const mlbSeasons = seasons
      .filter(s => s.levelId === 1 && s.pa >= MIN_SEASON_PA)
      .sort((a, b) => a.year - b.year);
    const minorSeasons = seasons
      .filter(s => s.levelId > 1 && s.pa >= MIN_SEASON_PA)
      .sort((a, b) => a.year - b.year);

    const totalMlbPa = mlbSeasons.reduce((sum, s) => sum + s.pa, 0);
    if (totalMlbPa < MIN_MLB_PA_FOR_PEAK) continue; // Need enough MLB data to identify peak
    if (minorSeasons.length === 0) continue; // Need minor league history

    // Find peak BB%: best PEAK_WINDOW-year rolling PA-weighted average
    let bestBbPct = -1;
    let bestYears: number[] = [];

    if (mlbSeasons.length >= PEAK_WINDOW) {
      for (let i = 0; i <= mlbSeasons.length - PEAK_WINDOW; i++) {
        const window = mlbSeasons.slice(i, i + PEAK_WINDOW);
        const totalPa = window.reduce((sum, s) => sum + s.pa, 0);
        const totalBb = window.reduce((sum, s) => sum + s.bb, 0);
        const windowBbPct = (totalBb / totalPa) * 100;
        if (windowBbPct > bestBbPct) {
          bestBbPct = windowBbPct;
          bestYears = window.map(s => s.year);
        }
      }
    } else {
      // Fewer than PEAK_WINDOW MLB seasons — use all MLB
      const totalPa = mlbSeasons.reduce((sum, s) => sum + s.pa, 0);
      const totalBb = mlbSeasons.reduce((sum, s) => sum + s.bb, 0);
      bestBbPct = (totalBb / totalPa) * 100;
      bestYears = mlbSeasons.map(s => s.year);
    }

    careers.push({
      playerId,
      mlbSeasons,
      minorSeasons,
      peakBbPct: Math.round(bestBbPct * 10) / 10,
      peakYears: bestYears,
      dob: dobMap.get(playerId),
    });
  }

  console.log(`  ${careers.length} players with MLB peak + MiLB history`);

  // Step 3: Bucket by peak BB% cohort
  const cohorts = new Map<string, PlayerCareer[]>();
  const cohortRanges = [
    { label: '3-5%', min: 3, max: 5 },
    { label: '5-7%', min: 5, max: 7 },
    { label: '7-9%', min: 7, max: 9 },
    { label: '9-11%', min: 9, max: 11 },
    { label: '11-14%', min: 11, max: 14 },
    { label: '14%+', min: 14, max: 100 },
  ];

  for (const range of cohortRanges) {
    cohorts.set(range.label, []);
  }

  for (const career of careers) {
    const bb = career.peakBbPct!;
    for (const range of cohortRanges) {
      if (bb >= range.min && bb < range.max) {
        cohorts.get(range.label)!.push(career);
        break;
      }
    }
  }

  // Step 4: Analyze development trajectories
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Eye (BB%) Development Curves by Peak Cohort');
  console.log('══════════════════════════════════════════════════════════\n');

  for (const [label, cohortCareers] of cohorts) {
    if (cohortCareers.length < 5) {
      console.log(`${label} peak BB%: ${cohortCareers.length} players (too few, skipping)\n`);
      continue;
    }

    console.log(`${label} peak BB% — ${cohortCareers.length} players`);
    console.log('─'.repeat(70));

    // Collect BB% by level
    const byLevel = new Map<string, number[]>();
    const levels = ['Rookie', 'A', 'AA', 'AAA'];
    const levelIds = [6, 4, 3, 2];
    for (const l of levels) byLevel.set(l, []);

    // Also collect by "years before MLB debut"
    const byYearsBeforeDebut = new Map<number, number[]>();
    for (let y = -5; y <= 0; y++) byYearsBeforeDebut.set(y, []);

    // And MLB year 1, 2, 3
    const mlbYear = new Map<number, number[]>();
    for (let y = 1; y <= 5; y++) mlbYear.set(y, []);

    // And by age
    const byAge = new Map<number, number[]>();
    for (let a = 18; a <= 35; a++) byAge.set(a, []);

    for (const career of cohortCareers) {
      const mlbDebut = career.mlbSeasons.length > 0 ? career.mlbSeasons[0].year : undefined;

      // Minor league BB% by level
      for (const s of career.minorSeasons) {
        const levelIdx = levelIds.indexOf(s.levelId);
        if (levelIdx >= 0) {
          byLevel.get(levels[levelIdx])!.push(s.bbPct);
        }

        // Years before debut
        if (mlbDebut) {
          const yearsBeforeDebut = s.year - mlbDebut;
          if (yearsBeforeDebut >= -5 && yearsBeforeDebut <= 0) {
            if (!byYearsBeforeDebut.has(yearsBeforeDebut)) byYearsBeforeDebut.set(yearsBeforeDebut, []);
            byYearsBeforeDebut.get(yearsBeforeDebut)!.push(s.bbPct);
          }
        }

        // By age
        if (s.age && s.age >= 18 && s.age <= 35) {
          byAge.get(s.age)!.push(s.bbPct);
        }
      }

      // MLB BB% by year number
      for (let i = 0; i < Math.min(5, career.mlbSeasons.length); i++) {
        mlbYear.get(i + 1)!.push(career.mlbSeasons[i].bbPct);
      }
    }

    // Print by level
    console.log('  By Minor League Level:');
    for (const level of levels) {
      const vals = byLevel.get(level)!;
      if (vals.length < 3) continue;
      const sorted = [...vals].sort((a, b) => a - b);
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      const p25 = sorted[Math.floor(sorted.length * 0.25)];
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p75 = sorted[Math.floor(sorted.length * 0.75)];
      console.log(`    ${level.padEnd(6)} n=${String(vals.length).padStart(4)}  mean=${avg.toFixed(1).padStart(5)}%  p25=${p25.toFixed(1)}%  p50=${p50.toFixed(1)}%  p75=${p75.toFixed(1)}%`);
    }

    // Print by years before debut
    console.log('  By Years Before MLB Debut:');
    for (let y = -5; y <= 0; y++) {
      const vals = byYearsBeforeDebut.get(y)!;
      if (vals.length < 3) continue;
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      const sorted = [...vals].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const label2 = y === 0 ? 'Debut yr' : `${Math.abs(y)}yr before`;
      console.log(`    ${label2.padEnd(12)} n=${String(vals.length).padStart(4)}  mean=${avg.toFixed(1).padStart(5)}%  median=${p50.toFixed(1)}%`);
    }

    // Print MLB years
    console.log('  MLB Seasons:');
    for (let y = 1; y <= 5; y++) {
      const vals = mlbYear.get(y)!;
      if (vals.length < 3) continue;
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      const sorted = [...vals].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      console.log(`    Year ${y}     n=${String(vals.length).padStart(4)}  mean=${avg.toFixed(1).padStart(5)}%  median=${p50.toFixed(1)}%`);
    }

    // Print by age (compact, only ages with data)
    console.log('  By Age:');
    let ageLine = '    ';
    for (let a = 18; a <= 35; a++) {
      const vals = byAge.get(a)!;
      if (vals.length < 5) continue;
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      ageLine += `${a}:${avg.toFixed(1)}%(${vals.length})  `;
    }
    console.log(ageLine);

    console.log('');
  }

  // Step 5: Correlation analysis — does MiLB BB% predict within-cohort MLB BB%?
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Within-Cohort Correlation: Last MiLB BB% vs First MLB BB%');
  console.log('══════════════════════════════════════════════════════════\n');

  for (const [label, cohortCareers] of cohorts) {
    if (cohortCareers.length < 10) continue;

    const pairs: { miLBBb: number; mlbBb: number }[] = [];

    for (const career of cohortCareers) {
      if (career.minorSeasons.length === 0 || career.mlbSeasons.length === 0) continue;

      // Last MiLB season (highest level, most recent)
      const lastMinor = career.minorSeasons[career.minorSeasons.length - 1];
      // First MLB season with enough PA
      const firstMlb = career.mlbSeasons[0];

      if (lastMinor.pa >= 100 && firstMlb.pa >= 100) {
        pairs.push({ miLBBb: lastMinor.bbPct, mlbBb: firstMlb.bbPct });
      }
    }

    if (pairs.length < 10) continue;

    // Calculate Pearson correlation
    const n = pairs.length;
    const meanX = pairs.reduce((s, p) => s + p.miLBBb, 0) / n;
    const meanY = pairs.reduce((s, p) => s + p.mlbBb, 0) / n;
    let ssXY = 0, ssXX = 0, ssYY = 0;
    for (const p of pairs) {
      ssXY += (p.miLBBb - meanX) * (p.mlbBb - meanY);
      ssXX += (p.miLBBb - meanX) ** 2;
      ssYY += (p.mlbBb - meanY) ** 2;
    }
    const r = ssXX > 0 && ssYY > 0 ? ssXY / Math.sqrt(ssXX * ssYY) : 0;

    console.log(`${label} peak BB%:  n=${pairs.length}  r=${r.toFixed(3)}  (last MiLB BB% → first MLB BB%)`);
    console.log(`  MiLB mean=${meanX.toFixed(1)}%  MLB mean=${meanY.toFixed(1)}%`);
  }

  // Step 6: Same but for K% (AvoidK) as a control — should show higher correlation
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Control: K% Correlation (should be higher)');
  console.log('══════════════════════════════════════════════════════════\n');

  // Quick K% peak cohort analysis
  const kCohortPairs: { miLBK: number; mlbK: number }[] = [];
  for (const career of careers) {
    if (career.minorSeasons.length === 0 || career.mlbSeasons.length === 0) continue;
    const lastMinor = career.minorSeasons[career.minorSeasons.length - 1];
    const firstMlb = career.mlbSeasons[0];
    if (lastMinor.pa >= 100 && firstMlb.pa >= 100) {
      kCohortPairs.push({ miLBK: lastMinor.kPct, mlbK: firstMlb.kPct });
    }
  }

  if (kCohortPairs.length >= 10) {
    const n = kCohortPairs.length;
    const meanX = kCohortPairs.reduce((s, p) => s + p.miLBK, 0) / n;
    const meanY = kCohortPairs.reduce((s, p) => s + p.mlbK, 0) / n;
    let ssXY = 0, ssXX = 0, ssYY = 0;
    for (const p of kCohortPairs) {
      ssXY += (p.miLBK - meanX) * (p.mlbK - meanY);
      ssXX += (p.miLBK - meanX) ** 2;
      ssYY += (p.mlbK - meanY) ** 2;
    }
    const r = ssXX > 0 && ssYY > 0 ? ssXY / Math.sqrt(ssXX * ssYY) : 0;
    console.log(`All players:  n=${n}  r=${r.toFixed(3)}  (last MiLB K% → first MLB K%)`);
    console.log(`  MiLB K% mean=${meanX.toFixed(1)}%  MLB K% mean=${meanY.toFixed(1)}%`);
  }

  // BB% overall correlation (not within cohort) for comparison
  const bbAllPairs: { miLBBb: number; mlbBb: number }[] = [];
  for (const career of careers) {
    if (career.minorSeasons.length === 0 || career.mlbSeasons.length === 0) continue;
    const lastMinor = career.minorSeasons[career.minorSeasons.length - 1];
    const firstMlb = career.mlbSeasons[0];
    if (lastMinor.pa >= 100 && firstMlb.pa >= 100) {
      bbAllPairs.push({ miLBBb: lastMinor.bbPct, mlbBb: firstMlb.bbPct });
    }
  }

  if (bbAllPairs.length >= 10) {
    const n = bbAllPairs.length;
    const meanX = bbAllPairs.reduce((s, p) => s + p.miLBBb, 0) / n;
    const meanY = bbAllPairs.reduce((s, p) => s + p.mlbBb, 0) / n;
    let ssXY = 0, ssXX = 0, ssYY = 0;
    for (const p of bbAllPairs) {
      ssXY += (p.miLBBb - meanX) * (p.mlbBb - meanY);
      ssXX += (p.miLBBb - meanX) ** 2;
      ssYY += (p.mlbBb - meanY) ** 2;
    }
    const r = ssXX > 0 && ssYY > 0 ? ssXY / Math.sqrt(ssXX * ssYY) : 0;
    console.log(`\nBB% overall:  n=${n}  r=${r.toFixed(3)}  (last MiLB BB% → first MLB BB%)`);
    console.log(`  MiLB BB% mean=${meanX.toFixed(1)}%  MLB BB% mean=${meanY.toFixed(1)}%`);
  }
}

main();
