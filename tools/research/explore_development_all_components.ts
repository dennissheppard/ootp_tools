/**
 * Development curves for all batter components: Eye (BB%), AvoidK (K%), Power (HR%), Contact (AVG).
 *
 * For each component, build peak-cohort development curves and measure
 * how tight the curves are (SD, within-cohort r).
 *
 * Usage: npx tsx tools/research/explore_development_all_components.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';

const DATA_DIR = path.join('public', 'data');
const RELIABLE_ERA_START = 2012;
const END_YEAR = 2020;
const LOAD_START = 2000;
const MIN_MLB_PA_FOR_PEAK = 600;
const MIN_SEASON_PA = 100;
const PEAK_WINDOW = 3;

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
  peakKPct?: number;
  peakHrPct?: number;
  peakAvg?: number;
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
        playerId: parseInt(row.player_id), year,
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

function computeStats(vals: number[]) {
  if (vals.length === 0) return { n: 0, mean: 0, sd: 0, p25: 0, p50: 0, p75: 0 };
  const sorted = [...vals].sort((a, b) => a - b);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return { n: vals.length, mean, sd, p25: pct(0.25), p50: pct(0.5), p75: pct(0.75) };
}

function correlation(pairs: { x: number; y: number }[]): number {
  const n = pairs.length;
  if (n < 5) return NaN;
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

// Find best PEAK_WINDOW-year rolling PA-weighted average for a stat
function findPeak(
  mlbSeasons: BatterSeason[],
  getStat: (s: BatterSeason) => { num: number; denom: number },
  higherIsBetter: boolean
): number | undefined {
  if (mlbSeasons.length === 0) return undefined;

  let bestVal = higherIsBetter ? -Infinity : Infinity;

  if (mlbSeasons.length >= PEAK_WINDOW) {
    for (let i = 0; i <= mlbSeasons.length - PEAK_WINDOW; i++) {
      const window = mlbSeasons.slice(i, i + PEAK_WINDOW);
      const totalNum = window.reduce((s, v) => s + getStat(v).num, 0);
      const totalDenom = window.reduce((s, v) => s + getStat(v).denom, 0);
      if (totalDenom === 0) continue;
      const val = totalNum / totalDenom;
      if (higherIsBetter ? val > bestVal : val < bestVal) bestVal = val;
    }
  } else {
    const totalNum = mlbSeasons.reduce((s, v) => s + getStat(v).num, 0);
    const totalDenom = mlbSeasons.reduce((s, v) => s + getStat(v).denom, 0);
    if (totalDenom === 0) return undefined;
    bestVal = totalNum / totalDenom;
  }

  return bestVal;
}

interface ComponentConfig {
  name: string;
  label: string;
  unit: string;
  getSeasonStat: (s: BatterSeason) => number;
  getPeak: (c: PlayerCareer) => number | undefined;
  setPeak: (c: PlayerCareer, v: number) => void;
  higherIsBetter: boolean;
  cohorts: { label: string; min: number; max: number }[];
  format: (v: number) => string;
}

function main() {
  const dobMap = loadDobs();
  console.log(`DOBs: ${dobMap.size}\n`);

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

  // Build careers
  const careers: PlayerCareer[] = [];
  for (const [playerId, seasons] of playerSeasons) {
    const mlb = seasons.filter(s => s.levelId === 1 && s.pa >= MIN_SEASON_PA).sort((a, b) => a.year - b.year);
    const minor = seasons.filter(s => s.levelId > 1 && s.pa >= MIN_SEASON_PA).sort((a, b) => a.year - b.year);

    if (mlb.length === 0 || mlb[0].year < RELIABLE_ERA_START) continue;
    const totalMlbPa = mlb.reduce((sum, s) => sum + s.pa, 0);
    if (totalMlbPa < MIN_MLB_PA_FOR_PEAK) continue;
    if (minor.length === 0) continue;

    const career: PlayerCareer = { playerId, mlbSeasons: mlb, minorSeasons: minor };

    // Find peaks
    career.peakBbPct = findPeak(mlb, s => ({ num: s.bb, denom: s.pa }), true)! * 100;
    career.peakKPct = findPeak(mlb, s => ({ num: s.k, denom: s.pa }), false)! * 100; // Lower is better
    career.peakHrPct = findPeak(mlb, s => ({ num: s.hr, denom: s.pa }), true)! * 100;
    career.peakAvg = findPeak(mlb, s => ({ num: s.h, denom: s.ab }), true)!;

    if (career.peakBbPct === undefined || career.peakKPct === undefined) continue;

    careers.push(career);
  }

  console.log(`${careers.length} careers (${RELIABLE_ERA_START}+ debuts, ${MIN_MLB_PA_FOR_PEAK}+ MLB PA, MiLB history)\n`);

  // Component configs
  const components: ComponentConfig[] = [
    {
      name: 'Eye', label: 'BB%', unit: '%',
      getSeasonStat: s => s.bbPct,
      getPeak: c => c.peakBbPct,
      setPeak: (c, v) => { c.peakBbPct = v; },
      higherIsBetter: true,
      cohorts: [
        { label: '3-5%', min: 3, max: 5 },
        { label: '5-7%', min: 5, max: 7 },
        { label: '7-9%', min: 7, max: 9 },
        { label: '9-11%', min: 9, max: 11 },
        { label: '11%+', min: 11, max: 100 },
      ],
      format: v => v.toFixed(1) + '%',
    },
    {
      name: 'AvoidK', label: 'K%', unit: '%',
      getSeasonStat: s => s.kPct,
      getPeak: c => c.peakKPct,
      setPeak: (c, v) => { c.peakKPct = v; },
      higherIsBetter: false, // Lower K% is better
      cohorts: [
        { label: '8-12%', min: 8, max: 12 },
        { label: '12-16%', min: 12, max: 16 },
        { label: '16-20%', min: 16, max: 20 },
        { label: '20-25%', min: 20, max: 25 },
        { label: '25%+', min: 25, max: 100 },
      ],
      format: v => v.toFixed(1) + '%',
    },
    {
      name: 'Power', label: 'HR%', unit: '%',
      getSeasonStat: s => s.hrPct,
      getPeak: c => c.peakHrPct,
      setPeak: (c, v) => { c.peakHrPct = v; },
      higherIsBetter: true,
      cohorts: [
        { label: '0-1.5%', min: 0, max: 1.5 },
        { label: '1.5-3%', min: 1.5, max: 3 },
        { label: '3-4.5%', min: 3, max: 4.5 },
        { label: '4.5-6%', min: 4.5, max: 6 },
        { label: '6%+', min: 6, max: 100 },
      ],
      format: v => v.toFixed(2) + '%',
    },
    {
      name: 'Contact', label: 'AVG', unit: '',
      getSeasonStat: s => s.avg,
      getPeak: c => c.peakAvg,
      setPeak: (c, v) => { c.peakAvg = v; },
      higherIsBetter: true,
      cohorts: [
        { label: '.200-.240', min: 0.200, max: 0.240 },
        { label: '.240-.270', min: 0.240, max: 0.270 },
        { label: '.270-.300', min: 0.270, max: 0.300 },
        { label: '.300-.330', min: 0.300, max: 0.330 },
        { label: '.330+', min: 0.330, max: 1.0 },
      ],
      format: v => v.toFixed(3),
    },
  ];

  for (const comp of components) {
    console.log('\n' + '═'.repeat(90));
    console.log(`  ${comp.name} (${comp.label}) — Development Curves by Peak Cohort`);
    console.log('═'.repeat(90));

    // Bucket into cohorts
    const cohortMap = new Map<string, PlayerCareer[]>();
    for (const c of comp.cohorts) cohortMap.set(c.label, []);
    for (const career of careers) {
      const peak = comp.getPeak(career);
      if (peak === undefined || isNaN(peak)) continue;
      for (const c of comp.cohorts) {
        if (peak >= c.min && peak < c.max) {
          cohortMap.get(c.label)!.push(career);
          break;
        }
      }
    }

    for (const [label, cohortCareers] of cohortMap) {
      if (cohortCareers.length < 8) {
        console.log(`\n  ${label} peak: ${cohortCareers.length} players (too few)`);
        continue;
      }

      console.log(`\n  ${label} peak ${comp.label} — ${cohortCareers.length} players`);
      console.log('  ' + '─'.repeat(85));

      const ages = [18, 19, 20, 21, 22, 23, 24, 25, 26];

      // ── MiLB by age (PA-weighted) ──
      let milbRow = '  MiLB  ';
      for (const age of ages) {
        let totalNum = 0, totalDenom = 0, count = 0;
        for (const c of cohortCareers) {
          for (const s of c.minorSeasons) {
            if (s.age !== age) continue;
            if (comp.name === 'Contact') {
              totalNum += s.h; totalDenom += s.ab;
            } else if (comp.name === 'Eye') {
              totalNum += s.bb; totalDenom += s.pa;
            } else if (comp.name === 'AvoidK') {
              totalNum += s.k; totalDenom += s.pa;
            } else {
              totalNum += s.hr; totalDenom += s.pa;
            }
            count++;
          }
        }
        if (count < 3 || totalDenom === 0) {
          milbRow += '    --    ';
        } else {
          const val = comp.name === 'Contact' ? totalNum / totalDenom : (totalNum / totalDenom) * 100;
          milbRow += `${comp.format(val).padStart(6)}(${String(count).padStart(2)}) `;
        }
      }
      console.log(milbRow);

      // ── MLB by age ──
      let mlbRow = '  MLB   ';
      for (const age of ages) {
        let totalNum = 0, totalDenom = 0, count = 0;
        for (const c of cohortCareers) {
          for (const s of c.mlbSeasons) {
            if (s.age !== age) continue;
            if (comp.name === 'Contact') {
              totalNum += s.h; totalDenom += s.ab;
            } else if (comp.name === 'Eye') {
              totalNum += s.bb; totalDenom += s.pa;
            } else if (comp.name === 'AvoidK') {
              totalNum += s.k; totalDenom += s.pa;
            } else {
              totalNum += s.hr; totalDenom += s.pa;
            }
            count++;
          }
        }
        if (count < 3 || totalDenom === 0) {
          mlbRow += '    --    ';
        } else {
          const val = comp.name === 'Contact' ? totalNum / totalDenom : (totalNum / totalDenom) * 100;
          mlbRow += `${comp.format(val).padStart(6)}(${String(count).padStart(2)}) `;
        }
      }
      console.log(mlbRow);

      // ── Ratio to peak ──
      const ratiosByAge = new Map<number, number[]>();
      for (const a of ages) ratiosByAge.set(a, []);

      for (const c of cohortCareers) {
        const peak = comp.getPeak(c);
        if (!peak || peak === 0) continue;
        for (const s of c.minorSeasons) {
          if (s.age === undefined || !ratiosByAge.has(s.age)) continue;
          const stat = comp.getSeasonStat(s);
          // For AVG, ratio = stat/peak. For percentages, same.
          ratiosByAge.get(s.age)!.push(stat / (comp.name === 'Contact' ? peak : peak));
        }
      }

      let ratioRow = '  Ratio ';
      let sdRow =    '  SD    ';
      for (const age of ages) {
        const vals = ratiosByAge.get(age)!;
        if (vals.length < 3) {
          ratioRow += '    --    ';
          sdRow += '    --    ';
        } else {
          const s = computeStats(vals);
          ratioRow += ` ${s.mean.toFixed(2).padStart(5)}(${String(s.n).padStart(2)}) `;
          sdRow += ` ${s.sd.toFixed(2).padStart(5)}(${String(s.n).padStart(2)}) `;
        }
      }
      console.log(ratioRow);
      console.log(sdRow);
    }

    // ── Within-cohort correlation: MiLB stat at age X → peak ──
    console.log(`\n  Within-Cohort r: MiLB ${comp.label} at age → peak ${comp.label}`);
    console.log('  ' + '─'.repeat(85));

    for (const [label, cohortCareers] of cohortMap) {
      if (cohortCareers.length < 15) continue;

      let row = `  ${label.padEnd(10)} `;
      for (const age of [19, 20, 21, 22, 23]) {
        const pairs: { x: number; y: number }[] = [];
        for (const c of cohortCareers) {
          const peak = comp.getPeak(c);
          if (peak === undefined) continue;
          const seasonAtAge = c.minorSeasons.find(s => s.age === age);
          if (seasonAtAge) {
            pairs.push({ x: comp.getSeasonStat(seasonAtAge), y: peak });
          }
        }
        if (pairs.length < 8) {
          row += `  ${age}: --      `;
        } else {
          const r = correlation(pairs);
          row += `  ${age}: r=${r.toFixed(2)}(${String(pairs.length).padStart(2)})  `;
        }
      }
      console.log(row);
    }

    // ── Overall correlation (not within cohort) ──
    const allPairs: { x: number; y: number }[] = [];
    for (const c of careers) {
      const peak = comp.getPeak(c);
      if (peak === undefined) continue;
      const lastMinor = c.minorSeasons[c.minorSeasons.length - 1];
      if (lastMinor.pa >= MIN_SEASON_PA) {
        allPairs.push({ x: comp.getSeasonStat(lastMinor), y: peak });
      }
    }
    if (allPairs.length >= 10) {
      const r = correlation(allPairs);
      console.log(`\n  Overall r (last MiLB → peak): r=${r.toFixed(3)} (n=${allPairs.length})`);
    }

    // ── Overall correlation: last MiLB → first MLB ──
    const transitionPairs: { x: number; y: number }[] = [];
    for (const c of careers) {
      const lastMinor = c.minorSeasons[c.minorSeasons.length - 1];
      const firstMlb = c.mlbSeasons[0];
      if (lastMinor.pa >= MIN_SEASON_PA && firstMlb.pa >= MIN_SEASON_PA) {
        transitionPairs.push({
          x: comp.getSeasonStat(lastMinor),
          y: comp.getSeasonStat(firstMlb),
        });
      }
    }
    if (transitionPairs.length >= 10) {
      const r = correlation(transitionPairs);
      console.log(`  Overall r (last MiLB → first MLB): r=${r.toFixed(3)} (n=${transitionPairs.length})`);
    }
  }

  // ── Summary comparison ──
  console.log('\n\n' + '═'.repeat(90));
  console.log('  SUMMARY: Component Comparison');
  console.log('═'.repeat(90));
  console.log('\n  Component    Overall r       Last MiLB→First MLB r    Avg SD of ratio');
  console.log('  ' + '─'.repeat(70));

  for (const comp of components) {
    // Overall last MiLB → peak
    const peakPairs: { x: number; y: number }[] = [];
    const transPairs: { x: number; y: number }[] = [];
    const allRatioSDs: number[] = [];

    for (const c of careers) {
      const peak = comp.getPeak(c);
      if (peak === undefined || peak === 0) continue;
      const lastMinor = c.minorSeasons[c.minorSeasons.length - 1];
      const firstMlb = c.mlbSeasons[0];

      if (lastMinor.pa >= MIN_SEASON_PA) {
        peakPairs.push({ x: comp.getSeasonStat(lastMinor), y: peak });
      }
      if (lastMinor.pa >= MIN_SEASON_PA && firstMlb.pa >= MIN_SEASON_PA) {
        transPairs.push({
          x: comp.getSeasonStat(lastMinor),
          y: comp.getSeasonStat(firstMlb),
        });
      }

      // Collect all ratios for SD calculation
      for (const s of c.minorSeasons) {
        if (s.age === undefined || s.age < 19 || s.age > 24) continue;
        allRatioSDs.push(comp.getSeasonStat(s) / peak);
      }
    }

    const rPeak = correlation(peakPairs);
    const rTrans = correlation(transPairs);
    const avgSD = computeStats(allRatioSDs).sd;

    console.log(`  ${comp.name.padEnd(12)}  r=${rPeak.toFixed(3)} (n=${peakPairs.length})     r=${rTrans.toFixed(3)} (n=${transPairs.length})              ${avgSD.toFixed(3)}`);
  }
}

main();
