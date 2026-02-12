/**
 * Eye (BB%) development curves v2 — era-filtered, age-within-cohort focus.
 *
 * Isolates reliable data era (2012+) and does detailed age breakdowns
 * within peak BB% cohorts to see if age tightens the development curves.
 *
 * Usage: npx tsx tools/research/explore_eye_development_v2.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';

const DATA_DIR = path.join('public', 'data');
const MIN_MLB_PA_FOR_PEAK = 600;
const MIN_SEASON_PA = 100;
const PEAK_WINDOW = 3;

// Era filters
const RELIABLE_ERA_START = 2012;  // Primary analysis
const EARLY_ERA_START = 2005;     // Secondary comparison
const END_YEAR = 2020;
// Load data from all years so we can find players' full careers
const LOAD_START = 2000;

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
}

function loadBattingCsv(filePath: string, year: number): BatterSeason[] {
  if (!fs.existsSync(filePath)) return [];
  const csv = fs.readFileSync(filePath, 'utf-8');
  const parsed = Papa.parse<any>(csv, { header: true, skipEmptyLines: true });
  return parsed.data
    .filter((row: any) => parseInt(row.pa) >= 1)
    .map((row: any) => {
      const pa = parseInt(row.pa) || 0;
      const bb = parseInt(row.bb) || 0;
      const k = parseInt(row.k) || 0;
      const h = parseInt(row.h) || 0;
      const ab = parseInt(row.ab) || 0;
      const hr = parseInt(row.hr) || 0;
      return {
        playerId: parseInt(row.player_id),
        year,
        levelId: parseInt(row.level_id),
        pa, bb, k, h, ab, hr,
        bbPct: pa > 0 ? (bb / pa) * 100 : 0,
        kPct: pa > 0 ? (k / pa) * 100 : 0,
        hrPct: pa > 0 ? (hr / pa) * 100 : 0,
        avg: ab > 0 ? h / ab : 0,
      };
    });
}

function loadDobs(): Map<number, Date> {
  const map = new Map<number, Date>();
  for (const file of ['mlb_dob.csv', 'a_dob.csv', 'aa_dob.csv', 'aaa_dob.csv', 'rookie_dob.csv']) {
    const fp = path.join(DATA_DIR, file);
    if (!fs.existsSync(fp)) continue;
    const csv = fs.readFileSync(fp, 'utf-8');
    const parsed = Papa.parse<any>(csv, { header: true, skipEmptyLines: true });
    for (const row of parsed.data) {
      const id = parseInt(row.ID);
      if (!id || !row.DOB) continue;
      const dob = new Date(row.DOB);
      if (!isNaN(dob.getTime())) map.set(id, dob);
    }
  }
  return map;
}

function getAge(dob: Date, year: number): number {
  return Math.floor((new Date(year, 6, 1).getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

function stats(vals: number[]) {
  if (vals.length === 0) return { n: 0, mean: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, sd: 0 };
  const sorted = [...vals].sort((a, b) => a - b);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return { n: vals.length, mean, p10: pct(0.1), p25: pct(0.25), p50: pct(0.5), p75: pct(0.75), p90: pct(0.9), sd };
}

function correlation(pairs: { x: number; y: number }[]): number {
  const n = pairs.length;
  if (n < 3) return NaN;
  const mx = pairs.reduce((s, p) => s + p.x, 0) / n;
  const my = pairs.reduce((s, p) => s + p.y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of pairs) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

function main() {
  const dobMap = loadDobs();
  console.log(`DOBs: ${dobMap.size} players\n`);

  // Load all data
  const playerSeasons = new Map<number, BatterSeason[]>();
  for (let year = LOAD_START; year <= END_YEAR; year++) {
    const files: [string, number][] = [
      [path.join(DATA_DIR, 'mlb_batting', `${year}_batting.csv`), 1],
      [path.join(DATA_DIR, 'minors_batting', `${year}_aaa_batting.csv`), 2],
      [path.join(DATA_DIR, 'minors_batting', `${year}_aa_batting.csv`), 3],
      [path.join(DATA_DIR, 'minors_batting', `${year}_a_batting.csv`), 4],
      [path.join(DATA_DIR, 'minors_batting', `${year}_r_batting.csv`), 6],
    ];
    for (const [fp, lvl] of files) {
      for (const s of loadBattingCsv(fp, year)) {
        s.levelId = lvl;
        const dob = dobMap.get(s.playerId);
        if (dob) s.age = getAge(dob, year);
        if (!playerSeasons.has(s.playerId)) playerSeasons.set(s.playerId, []);
        playerSeasons.get(s.playerId)!.push(s);
      }
    }
  }

  // Build careers — require MLB seasons in reliable era
  function buildCareers(eraStart: number): PlayerCareer[] {
    const result: PlayerCareer[] = [];
    for (const [playerId, seasons] of playerSeasons) {
      const mlb = seasons.filter(s => s.levelId === 1 && s.pa >= MIN_SEASON_PA).sort((a, b) => a.year - b.year);
      const minor = seasons.filter(s => s.levelId > 1 && s.pa >= MIN_SEASON_PA).sort((a, b) => a.year - b.year);

      // Require MLB debut in reliable era
      if (mlb.length === 0 || mlb[0].year < eraStart) continue;
      const totalMlbPa = mlb.reduce((sum, s) => sum + s.pa, 0);
      if (totalMlbPa < MIN_MLB_PA_FOR_PEAK) continue;
      if (minor.length === 0) continue;

      // Find peak BB%
      let bestBb = -1, bestYrs: number[] = [];
      if (mlb.length >= PEAK_WINDOW) {
        for (let i = 0; i <= mlb.length - PEAK_WINDOW; i++) {
          const w = mlb.slice(i, i + PEAK_WINDOW);
          const tp = w.reduce((s, v) => s + v.pa, 0);
          const tb = w.reduce((s, v) => s + v.bb, 0);
          const bp = (tb / tp) * 100;
          if (bp > bestBb) { bestBb = bp; bestYrs = w.map(v => v.year); }
        }
      } else {
        const tp = mlb.reduce((s, v) => s + v.pa, 0);
        const tb = mlb.reduce((s, v) => s + v.bb, 0);
        bestBb = (tb / tp) * 100;
        bestYrs = mlb.map(v => v.year);
      }

      result.push({ playerId, mlbSeasons: mlb, minorSeasons: minor, peakBbPct: Math.round(bestBb * 10) / 10, peakYears: bestYrs });
    }
    return result;
  }

  const reliableCareers = buildCareers(RELIABLE_ERA_START);
  const earlyCareers = buildCareers(EARLY_ERA_START);
  console.log(`Reliable era (${RELIABLE_ERA_START}+): ${reliableCareers.length} players`);
  console.log(`Early era (${EARLY_ERA_START}+): ${earlyCareers.length} players\n`);

  // Use reliable era for primary analysis
  const careers = reliableCareers;

  const cohortRanges = [
    { label: '3-5%',  min: 3,  max: 5 },
    { label: '5-7%',  min: 5,  max: 7 },
    { label: '7-9%',  min: 7,  max: 9 },
    { label: '9-11%', min: 9,  max: 11 },
    { label: '11%+',  min: 11, max: 100 },
  ];

  const cohorts = new Map<string, PlayerCareer[]>();
  for (const r of cohortRanges) cohorts.set(r.label, []);
  for (const c of careers) {
    for (const r of cohortRanges) {
      if (c.peakBbPct! >= r.min && c.peakBbPct! < r.max) {
        cohorts.get(r.label)!.push(c);
        break;
      }
    }
  }

  // ─── Age-within-cohort breakdown ────────────────────────────────
  console.log('══════════════════════════════════════════════════════════════════════════');
  console.log(`  Age × Level BB% by Peak Cohort (${RELIABLE_ERA_START}+ debuts, MiLB seasons only)`);
  console.log('══════════════════════════════════════════════════════════════════════════\n');

  const levelNames: [string, number][] = [['R', 6], ['A', 4], ['AA', 3], ['AAA', 2]];

  for (const [label, cohortCareers] of cohorts) {
    if (cohortCareers.length < 10) {
      console.log(`${label} peak: ${cohortCareers.length} players (too few)\n`);
      continue;
    }

    console.log(`${label} peak BB% — ${cohortCareers.length} players`);
    console.log('─'.repeat(90));

    // Age × Level grid
    const grid = new Map<string, number[]>(); // "age_level" → BB% values

    for (const c of cohortCareers) {
      for (const s of c.minorSeasons) {
        if (s.age === undefined) continue;
        for (const [ln, lid] of levelNames) {
          if (s.levelId === lid) {
            const key = `${s.age}_${ln}`;
            if (!grid.has(key)) grid.set(key, []);
            grid.get(key)!.push(s.bbPct);
          }
        }
      }
    }

    // Print header
    const ages = [18, 19, 20, 21, 22, 23, 24, 25, 26];
    console.log('  Level  ' + ages.map(a => `  Age ${a}  `).join(''));
    console.log('  ' + '─'.repeat(85));

    for (const [ln] of levelNames) {
      let row = `  ${ln.padEnd(5)}  `;
      for (const age of ages) {
        const vals = grid.get(`${age}_${ln}`) ?? [];
        if (vals.length < 3) {
          row += '    --    ';
        } else {
          const s = stats(vals);
          row += `${s.mean.toFixed(1).padStart(4)}%(${String(s.n).padStart(2)}) `;
        }
      }
      console.log(row);
    }

    // Also show: "all levels combined" by age (PA-weighted)
    const byAge = new Map<number, { totalBb: number; totalPa: number; count: number }>();
    for (const c of cohortCareers) {
      for (const s of c.minorSeasons) {
        if (s.age === undefined) continue;
        if (!byAge.has(s.age)) byAge.set(s.age, { totalBb: 0, totalPa: 0, count: 0 });
        const entry = byAge.get(s.age)!;
        entry.totalBb += s.bb;
        entry.totalPa += s.pa;
        entry.count++;
      }
    }

    let allRow = '  ALL    ';
    for (const age of ages) {
      const entry = byAge.get(age);
      if (!entry || entry.count < 3) {
        allRow += '    --    ';
      } else {
        const bbPct = (entry.totalBb / entry.totalPa) * 100;
        allRow += `${bbPct.toFixed(1).padStart(4)}%(${String(entry.count).padStart(2)}) `;
      }
    }
    console.log('  ' + '─'.repeat(85));
    console.log(allRow);

    // MLB progression
    let mlbRow = '  MLB    ';
    for (const age of ages) {
      const vals: number[] = [];
      for (const c of cohortCareers) {
        for (const s of c.mlbSeasons) {
          if (s.age === age) vals.push(s.bbPct);
        }
      }
      if (vals.length < 3) {
        mlbRow += '    --    ';
      } else {
        const s = stats(vals);
        mlbRow += `${s.mean.toFixed(1).padStart(4)}%(${String(s.n).padStart(2)}) `;
      }
    }
    console.log(mlbRow);

    console.log('');
  }

  // ─── Transition analysis: what BB% do they have at each level? ──
  console.log('\n══════════════════════════════════════════════════════════════════════════');
  console.log('  BB% Ratio: MiLB BB% / Peak MLB BB% by age (how close to peak?)');
  console.log('══════════════════════════════════════════════════════════════════════════\n');

  for (const [label, cohortCareers] of cohorts) {
    if (cohortCareers.length < 10) continue;

    console.log(`${label} peak BB% — ratio of MiLB BB% to peak MLB BB%`);
    console.log('─'.repeat(90));

    // For each age, what fraction of their peak are they at?
    const ages = [18, 19, 20, 21, 22, 23, 24, 25, 26];
    const ratios = new Map<number, number[]>();
    for (const a of ages) ratios.set(a, []);

    for (const c of cohortCareers) {
      if (!c.peakBbPct || c.peakBbPct <= 0) continue;
      for (const s of c.minorSeasons) {
        if (s.age === undefined) continue;
        if (ratios.has(s.age)) {
          ratios.get(s.age)!.push(s.bbPct / c.peakBbPct!);
        }
      }
    }

    let row = '  Ratio  ';
    for (const age of ages) {
      const vals = ratios.get(age)!;
      if (vals.length < 3) {
        row += '    --    ';
      } else {
        const s = stats(vals);
        row += `${s.mean.toFixed(2).padStart(5)}(${String(s.n).padStart(2)}) `;
      }
    }
    console.log(row);

    // Standard deviation to show how tight the curve is
    let sdRow = '  SD     ';
    for (const age of ages) {
      const vals = ratios.get(age)!;
      if (vals.length < 3) {
        sdRow += '    --    ';
      } else {
        const s = stats(vals);
        sdRow += `${s.sd.toFixed(2).padStart(5)}(${String(s.n).padStart(2)}) `;
      }
    }
    console.log(sdRow);
    console.log('');
  }

  // ─── Within-cohort correlation at specific ages ─────────────────
  console.log('\n══════════════════════════════════════════════════════════════════════════');
  console.log('  Within-Cohort r: MiLB BB% at age X → Peak MLB BB%');
  console.log('  (Does knowing their BB% at a specific age help predict peak?)');
  console.log('══════════════════════════════════════════════════════════════════════════\n');

  for (const [label, cohortCareers] of cohorts) {
    if (cohortCareers.length < 15) continue;

    const ages = [19, 20, 21, 22, 23, 24];
    let row = `  ${label.padEnd(6)} `;
    for (const age of ages) {
      const pairs: { x: number; y: number }[] = [];
      for (const c of cohortCareers) {
        const seasonAtAge = c.minorSeasons.find(s => s.age === age);
        if (seasonAtAge && c.peakBbPct) {
          pairs.push({ x: seasonAtAge.bbPct, y: c.peakBbPct });
        }
      }
      if (pairs.length < 10) {
        row += `  age${age}:  --   `;
      } else {
        const r = correlation(pairs);
        row += `  age${age}: r=${r.toFixed(2)} (n=${pairs.length})  `;
      }
    }
    console.log(row);
  }

  // ─── Repeat key analyses with early era for comparison ──────────
  console.log('\n\n══════════════════════════════════════════════════════════════════════════');
  console.log(`  ERA COMPARISON: All-levels-combined BB% by age`);
  console.log(`  Reliable (${RELIABLE_ERA_START}+) vs Early (${EARLY_ERA_START}-${RELIABLE_ERA_START - 1})`);
  console.log('══════════════════════════════════════════════════════════════════════════\n');

  // Build early-only careers (debut 2005-2011)
  const earlyOnly = earlyCareers.filter(c => c.mlbSeasons[0].year < RELIABLE_ERA_START);

  const earlyCohorts = new Map<string, PlayerCareer[]>();
  for (const r of cohortRanges) earlyCohorts.set(r.label, []);
  for (const c of earlyOnly) {
    for (const r of cohortRanges) {
      if (c.peakBbPct! >= r.min && c.peakBbPct! < r.max) {
        earlyCohorts.get(r.label)!.push(c);
        break;
      }
    }
  }

  for (const range of cohortRanges) {
    const reliableC = cohorts.get(range.label)!;
    const earlyC = earlyCohorts.get(range.label)!;
    if (reliableC.length < 5 && earlyC.length < 5) continue;

    console.log(`${range.label} peak: Reliable n=${reliableC.length}, Early n=${earlyC.length}`);

    const ages = [19, 20, 21, 22, 23, 24, 25];

    const getAgeBbPct = (careers: PlayerCareer[], age: number) => {
      let totalBb = 0, totalPa = 0;
      for (const c of careers) {
        for (const s of c.minorSeasons) {
          if (s.age === age) { totalBb += s.bb; totalPa += s.pa; }
        }
      }
      return totalPa > 0 ? (totalBb / totalPa) * 100 : NaN;
    };

    let r1 = '  Reliable: ';
    let r2 = '  Early:    ';
    for (const age of ages) {
      const rv = getAgeBbPct(reliableC, age);
      const ev = getAgeBbPct(earlyC, age);
      r1 += isNaN(rv) ? '   --   ' : `${age}:${rv.toFixed(1).padStart(4)}%  `;
      r2 += isNaN(ev) ? '   --   ' : `${age}:${ev.toFixed(1).padStart(4)}%  `;
    }
    console.log(r1);
    console.log(r2);
    console.log('');
  }
}

main();
