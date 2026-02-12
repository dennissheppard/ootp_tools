/**
 * Development curves for pitcher components: Stuff (K/9), Control (BB/9), HRA (HR/9).
 *
 * For each component, build peak-cohort development curves and measure
 * how tight the curves are (SD, within-cohort r).
 *
 * Usage: npx tsx tools/research/explore_pitcher_development.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';

const DATA_DIR = path.join('public', 'data');
const RELIABLE_ERA_START = 2012;
const END_YEAR = 2020;
const LOAD_START = 2000;
const MIN_MLB_IP_FOR_PEAK = 300;
const MIN_SEASON_IP = 30;
const PEAK_WINDOW = 3;

interface PitcherSeason {
  playerId: number;
  year: number;
  levelId: number;
  ip: number;
  k: number;
  bb: number;
  hra: number;
  k9: number;
  bb9: number;
  hr9: number;
  age?: number;
}

interface PlayerCareer {
  playerId: number;
  mlbSeasons: PitcherSeason[];
  minorSeasons: PitcherSeason[];
  peakK9?: number;
  peakBb9?: number;
  peakHr9?: number;
}

function loadPitchingCsv(filePath: string, year: number): PitcherSeason[] {
  if (!fs.existsSync(filePath)) return [];
  const csv = fs.readFileSync(filePath, 'utf-8');
  const parsed = Papa.parse<any>(csv, { header: true, skipEmptyLines: true });
  return parsed.data
    .filter((row: any) => {
      const splitId = parseInt(row.split_id);
      const ip = parseFloat(row.ip) || 0;
      return splitId === 1 && ip >= 1;
    })
    .map((row: any) => {
      const ip = parseFloat(row.ip) || 0;
      const k = parseInt(row.k) || 0;
      const bb = parseInt(row.bb) || 0;
      const hra = parseInt(row.hra) || 0;
      return {
        playerId: parseInt(row.player_id), year,
        levelId: parseInt(row.level_id),
        ip, k, bb, hra,
        k9: ip > 0 ? (k / ip) * 9 : 0,
        bb9: ip > 0 ? (bb / ip) * 9 : 0,
        hr9: ip > 0 ? (hra / ip) * 9 : 0,
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

// Find best PEAK_WINDOW-year rolling IP-weighted average for a stat
function findPeak(
  mlbSeasons: PitcherSeason[],
  getStat: (s: PitcherSeason) => { num: number; denom: number },
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
      const val = (totalNum / totalDenom) * 9; // per 9 innings
      if (higherIsBetter ? val > bestVal : val < bestVal) bestVal = val;
    }
  } else {
    const totalNum = mlbSeasons.reduce((s, v) => s + getStat(v).num, 0);
    const totalDenom = mlbSeasons.reduce((s, v) => s + getStat(v).denom, 0);
    if (totalDenom === 0) return undefined;
    bestVal = (totalNum / totalDenom) * 9;
  }

  return bestVal;
}

interface ComponentConfig {
  name: string;
  label: string;
  getSeasonStat: (s: PitcherSeason) => number;
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
  const playerSeasons = new Map<number, PitcherSeason[]>();
  for (let year = LOAD_START; year <= END_YEAR; year++) {
    const files: [string, number][] = [
      [path.join(DATA_DIR, 'mlb', `${year}.csv`), 1],
      [path.join(DATA_DIR, 'minors', `${year}_aaa.csv`), 2],
      [path.join(DATA_DIR, 'minors', `${year}_aa.csv`), 3],
      [path.join(DATA_DIR, 'minors', `${year}_a.csv`), 4],
      [path.join(DATA_DIR, 'minors', `${year}_r.csv`), 6],
    ];
    for (const [fp, lvl] of files) {
      for (const s of loadPitchingCsv(fp, year)) {
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
    const mlb = seasons.filter(s => s.levelId === 1 && s.ip >= MIN_SEASON_IP).sort((a, b) => a.year - b.year);
    const minor = seasons.filter(s => s.levelId > 1 && s.ip >= MIN_SEASON_IP).sort((a, b) => a.year - b.year);

    if (mlb.length === 0 || mlb[0].year < RELIABLE_ERA_START) continue;
    const totalMlbIp = mlb.reduce((sum, s) => sum + s.ip, 0);
    if (totalMlbIp < MIN_MLB_IP_FOR_PEAK) continue;
    if (minor.length === 0) continue;

    const career: PlayerCareer = { playerId, mlbSeasons: mlb, minorSeasons: minor };

    // Find peaks (IP-weighted rolling 3-year window, per 9 IP)
    career.peakK9 = findPeak(mlb, s => ({ num: s.k, denom: s.ip }), true);    // Higher K/9 = better
    career.peakBb9 = findPeak(mlb, s => ({ num: s.bb, denom: s.ip }), false);  // Lower BB/9 = better
    career.peakHr9 = findPeak(mlb, s => ({ num: s.hra, denom: s.ip }), false); // Lower HR/9 = better

    if (career.peakK9 === undefined || career.peakBb9 === undefined || career.peakHr9 === undefined) continue;

    careers.push(career);
  }

  console.log(`${careers.length} careers (${RELIABLE_ERA_START}+ debuts, ${MIN_MLB_IP_FOR_PEAK}+ MLB IP, MiLB history)\n`);

  // Component configs
  const components: ComponentConfig[] = [
    {
      name: 'Stuff', label: 'K/9',
      getSeasonStat: s => s.k9,
      getPeak: c => c.peakK9,
      setPeak: (c, v) => { c.peakK9 = v; },
      higherIsBetter: true,
      cohorts: [
        { label: '4-6', min: 4, max: 6 },
        { label: '6-8', min: 6, max: 8 },
        { label: '8-10', min: 8, max: 10 },
        { label: '10+', min: 10, max: 20 },
      ],
      format: v => v.toFixed(2),
    },
    {
      name: 'Control', label: 'BB/9',
      getSeasonStat: s => s.bb9,
      getPeak: c => c.peakBb9,
      setPeak: (c, v) => { c.peakBb9 = v; },
      higherIsBetter: false, // Lower BB/9 is better
      cohorts: [
        { label: '1.5-2.5', min: 1.5, max: 2.5 },
        { label: '2.5-3.5', min: 2.5, max: 3.5 },
        { label: '3.5-4.5', min: 3.5, max: 4.5 },
        { label: '4.5+', min: 4.5, max: 10 },
      ],
      format: v => v.toFixed(2),
    },
    {
      name: 'HRA', label: 'HR/9',
      getSeasonStat: s => s.hr9,
      getPeak: c => c.peakHr9,
      setPeak: (c, v) => { c.peakHr9 = v; },
      higherIsBetter: false, // Lower HR/9 is better
      cohorts: [
        { label: '0.5-0.8', min: 0.5, max: 0.8 },
        { label: '0.8-1.1', min: 0.8, max: 1.1 },
        { label: '1.1-1.5', min: 1.1, max: 1.5 },
        { label: '1.5+', min: 1.5, max: 5 },
      ],
      format: v => v.toFixed(2),
    },
  ];

  for (const comp of components) {
    console.log('\n' + '='.repeat(90));
    console.log(`  ${comp.name} (${comp.label}) — Development Curves by Peak Cohort`);
    console.log('='.repeat(90));

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
      if (cohortCareers.length < 5) {
        console.log(`\n  ${label} peak: ${cohortCareers.length} players (too few)`);
        continue;
      }

      console.log(`\n  ${label} peak ${comp.label} — ${cohortCareers.length} players`);
      console.log('  ' + '-'.repeat(85));

      const ages = [18, 19, 20, 21, 22, 23, 24, 25, 26];

      // -- MiLB by age (IP-weighted) --
      let milbRow = '  MiLB  ';
      for (const age of ages) {
        let totalK = 0, totalBb = 0, totalHra = 0, totalIp = 0, count = 0;
        for (const c of cohortCareers) {
          for (const s of c.minorSeasons) {
            if (s.age !== age) continue;
            totalK += s.k;
            totalBb += s.bb;
            totalHra += s.hra;
            totalIp += s.ip;
            count++;
          }
        }
        if (count < 3 || totalIp === 0) {
          milbRow += '    --    ';
        } else {
          let val: number;
          if (comp.name === 'Stuff') val = (totalK / totalIp) * 9;
          else if (comp.name === 'Control') val = (totalBb / totalIp) * 9;
          else val = (totalHra / totalIp) * 9;
          milbRow += `${comp.format(val).padStart(6)}(${String(count).padStart(2)}) `;
        }
      }
      console.log(milbRow);

      // -- MLB by age --
      let mlbRow = '  MLB   ';
      for (const age of ages) {
        let totalK = 0, totalBb = 0, totalHra = 0, totalIp = 0, count = 0;
        for (const c of cohortCareers) {
          for (const s of c.mlbSeasons) {
            if (s.age !== age) continue;
            totalK += s.k;
            totalBb += s.bb;
            totalHra += s.hra;
            totalIp += s.ip;
            count++;
          }
        }
        if (count < 3 || totalIp === 0) {
          mlbRow += '    --    ';
        } else {
          let val: number;
          if (comp.name === 'Stuff') val = (totalK / totalIp) * 9;
          else if (comp.name === 'Control') val = (totalBb / totalIp) * 9;
          else val = (totalHra / totalIp) * 9;
          mlbRow += `${comp.format(val).padStart(6)}(${String(count).padStart(2)}) `;
        }
      }
      console.log(mlbRow);

      // -- Ratio to peak --
      const ratiosByAge = new Map<number, number[]>();
      for (const a of ages) ratiosByAge.set(a, []);

      for (const c of cohortCareers) {
        const peak = comp.getPeak(c);
        if (!peak || peak === 0) continue;
        for (const s of c.minorSeasons) {
          if (s.age === undefined || !ratiosByAge.has(s.age)) continue;
          const stat = comp.getSeasonStat(s);
          ratiosByAge.get(s.age)!.push(stat / peak);
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

    // -- Within-cohort correlation: MiLB stat at age X -> peak --
    console.log(`\n  Within-Cohort r: MiLB ${comp.label} at age -> peak ${comp.label}`);
    console.log('  ' + '-'.repeat(85));

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

    // -- Overall correlation (not within cohort) --
    const allPairs: { x: number; y: number }[] = [];
    for (const c of careers) {
      const peak = comp.getPeak(c);
      if (peak === undefined) continue;
      const lastMinor = c.minorSeasons[c.minorSeasons.length - 1];
      if (lastMinor.ip >= MIN_SEASON_IP) {
        allPairs.push({ x: comp.getSeasonStat(lastMinor), y: peak });
      }
    }
    if (allPairs.length >= 10) {
      const r = correlation(allPairs);
      console.log(`\n  Overall r (last MiLB -> peak): r=${r.toFixed(3)} (n=${allPairs.length})`);
    }

    // -- Overall correlation: last MiLB -> first MLB --
    const transitionPairs: { x: number; y: number }[] = [];
    for (const c of careers) {
      const lastMinor = c.minorSeasons[c.minorSeasons.length - 1];
      const firstMlb = c.mlbSeasons[0];
      if (lastMinor.ip >= MIN_SEASON_IP && firstMlb.ip >= MIN_SEASON_IP) {
        transitionPairs.push({
          x: comp.getSeasonStat(lastMinor),
          y: comp.getSeasonStat(firstMlb),
        });
      }
    }
    if (transitionPairs.length >= 10) {
      const r = correlation(transitionPairs);
      console.log(`  Overall r (last MiLB -> first MLB): r=${r.toFixed(3)} (n=${transitionPairs.length})`);
    }
  }

  // -- Summary comparison --
  console.log('\n\n' + '='.repeat(90));
  console.log('  SUMMARY: Component Comparison');
  console.log('='.repeat(90));
  console.log('\n  Component    Overall r       Last MiLB->First MLB r    Avg SD of ratio');
  console.log('  ' + '-'.repeat(70));

  for (const comp of components) {
    const peakPairs: { x: number; y: number }[] = [];
    const transPairs: { x: number; y: number }[] = [];
    const allRatioSDs: number[] = [];

    for (const c of careers) {
      const peak = comp.getPeak(c);
      if (peak === undefined || peak === 0) continue;
      const lastMinor = c.minorSeasons[c.minorSeasons.length - 1];
      const firstMlb = c.mlbSeasons[0];

      if (lastMinor.ip >= MIN_SEASON_IP) {
        peakPairs.push({ x: comp.getSeasonStat(lastMinor), y: peak });
      }
      if (lastMinor.ip >= MIN_SEASON_IP && firstMlb.ip >= MIN_SEASON_IP) {
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

  // -- Output curve constants for copy-paste into ProspectDevelopmentCurveService --
  console.log('\n\n' + '='.repeat(90));
  console.log('  CURVE CONSTANTS (for ProspectDevelopmentCurveService)');
  console.log('='.repeat(90));

  for (const comp of components) {
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

    console.log(`\n  // ${comp.name} (${comp.label})`);
    for (const cohort of comp.cohorts) {
      const cohortCareers = cohortMap.get(cohort.label) ?? [];
      if (cohortCareers.length < 5) continue;

      const ages = [18, 19, 20, 21, 22, 23, 24, 25, 26];
      const points: Record<number, number> = {};
      const counts: Record<number, number> = {};

      for (const age of ages) {
        let totalK = 0, totalBb = 0, totalHra = 0, totalIp = 0, count = 0;
        for (const c of cohortCareers) {
          for (const s of c.minorSeasons) {
            if (s.age !== age) continue;
            totalK += s.k;
            totalBb += s.bb;
            totalHra += s.hra;
            totalIp += s.ip;
            count++;
          }
        }
        if (count >= 3 && totalIp > 0) {
          let val: number;
          if (comp.name === 'Stuff') val = (totalK / totalIp) * 9;
          else if (comp.name === 'Control') val = (totalBb / totalIp) * 9;
          else val = (totalHra / totalIp) * 9;
          points[age] = Math.round(val * 100) / 100;
          counts[age] = count;
        }
      }

      // Calculate sdOfRatio
      const allRatios: number[] = [];
      for (const c of cohortCareers) {
        const peak = comp.getPeak(c);
        if (!peak || peak === 0) continue;
        for (const s of c.minorSeasons) {
          if (s.age === undefined || s.age < 19 || s.age > 24) continue;
          allRatios.push(comp.getSeasonStat(s) / peak);
        }
      }
      const sdOfRatio = computeStats(allRatios).sd;

      const pointsStr = Object.entries(points).map(([a, v]) => `${a}: ${v}`).join(', ');
      const countsStr = Object.entries(counts).map(([a, v]) => `${a}: ${v}`).join(', ');

      console.log(`  { label: '${cohort.label}', cohortMin: ${cohort.min}, cohortMax: ${cohort.max},`);
      console.log(`    points: { ${pointsStr} },`);
      console.log(`    counts: { ${countsStr} },`);
      console.log(`    sdOfRatio: ${sdOfRatio.toFixed(2)} },`);
    }
  }
}

main();
