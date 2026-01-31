/**
 * TFR 2017 Validation Script
 *
 * Validates 2017 TFR projections against 2018-2021 actual outcomes.
 *
 * Tests:
 * 1. Level adjustment accuracy (AAA→MLB transitions)
 * 2. Trajectory validation (progression speed/quality)
 * 3. Early MLB performance (actual vs projected)
 * 4. Percentile ranking accuracy
 *
 * Usage: npx ts-node tools/research/tfr_2017_validation.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Types
// ============================================================================

interface Prospect2017 {
  playerId: number;
  name: string; // Exported as 'name', not 'playerName'
  age: number;
  tfr: number; // Exported as 'tfr', not 'trueFutureRating'
  projFip: number;
  projWar: number;
  level: string;
  totalMinorIp: number;
}

interface PitchingStats {
  player_id: number;
  player_name?: string;
  team_id?: number;
  ip: number;
  hr: number;
  bb: number;
  k: number;
  hr9?: number;
  bb9?: number;
  k9?: number;
  age?: number;
}

interface LevelTransition {
  playerId: number;
  playerName: string;
  fromYear: number;
  toYear: number;
  fromLevel: string;
  toLevel: string;
  fromStats: { k9: number; bb9: number; hr9: number; ip: number };
  toStats: { k9: number; bb9: number; hr9: number; ip: number };
  actualChange: { k9: number; bb9: number; hr9: number };
  projectedChange: { k9: number; bb9: number; hr9: number };
  tfr?: number;
}

interface TrajectoryData {
  playerId: number;
  playerName: string;
  tfr: number;
  startAge: number;
  endAge: number;
  startLevel: string;
  endLevel: string;
  reachedMLB: boolean;
  yearsToMLB?: number;
  mlbAge?: number;
  progression: Array<{ year: number; level: string; ip: number }>;
}

interface MLBPerformance {
  playerId: number;
  playerName: string;
  tfr: number;
  projFip: number;
  mlbYears: Array<{
    year: number;
    age: number;
    ip: number;
    fip: number;
    k9: number;
    bb9: number;
    hr9: number;
  }>;
  avgFip: number;
  totalIp: number;
}

// ============================================================================
// Data Loading
// ============================================================================

function loadProspects2017(): Prospect2017[] {
  const filePath = path.join(__dirname, '../reports/tfr_prospects_2017.json');

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    console.error('Please export 2017 prospects from Farm Rankings first.');
    console.error('See: tools/research/2017_calibration_workflow.md');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return data.prospects || [];
}

function loadMinorLeagueStats(year: number, level: string): PitchingStats[] {
  // Map level names: 'aaa' → 'aaa', 'rk' → 'r'
  const levelCode = level.toLowerCase() === 'rk' ? 'r' : level.toLowerCase();
  const filePath = path.join(__dirname, `../../public/data/minors/${year}_${levelCode}.csv`);

  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  Minor league stats not found: ${path.basename(filePath)}`);
    return [];
  }

  return parseStatsCSV(fs.readFileSync(filePath, 'utf-8'));
}

function loadMLBStats(year: number): PitchingStats[] {
  const filePath = path.join(__dirname, `../../public/data/mlb/${year}.csv`);

  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  MLB stats not found: ${path.basename(filePath)}`);
    return [];
  }

  return parseStatsCSV(fs.readFileSync(filePath, 'utf-8'));
}

function parseStatsCSV(csvText: string): PitchingStats[] {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  // IMPORTANT: Use player_id (not id) - 'id' is the record ID, 'player_id' is the actual player identifier
  const idIdx = header.findIndex(h => h === 'player_id' || h === 'playerid');
  const nameIdx = header.findIndex(h => h === 'name' || h === 'player_name' || h === 'playername');
  const teamIdx = header.findIndex(h => h === 'team_id' || h === 'teamid' || h === 'team');
  const ipIdx = header.findIndex(h => h === 'ip');
  const hrIdx = header.findIndex(h => h === 'hr' || h === 'hra'); // OOTP exports as 'hra' (home runs allowed)
  const bbIdx = header.findIndex(h => h === 'bb');
  const kIdx = header.findIndex(h => h === 'k' || h === 'so');
  const hr9Idx = header.findIndex(h => h === 'hr9' || h === 'hr/9');
  const bb9Idx = header.findIndex(h => h === 'bb9' || h === 'bb/9');
  const k9Idx = header.findIndex(h => h === 'k9' || h === 'k/9' || h === 'so9');
  const ageIdx = header.findIndex(h => h === 'age');

  const results: PitchingStats[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(c => c.trim());

    const ip = parseFloat(cells[ipIdx] || '0');
    if (ip === 0) continue; // Skip players with no IP

    const player_id = parseInt(cells[idIdx] || '0', 10);
    const hr = parseFloat(cells[hrIdx] || '0');
    const bb = parseFloat(cells[bbIdx] || '0');
    const k = parseFloat(cells[kIdx] || '0');

    // Calculate rate stats if not provided
    let hr9 = hr9Idx >= 0 ? parseFloat(cells[hr9Idx] || '0') : 0;
    let bb9 = bb9Idx >= 0 ? parseFloat(cells[bb9Idx] || '0') : 0;
    let k9 = k9Idx >= 0 ? parseFloat(cells[k9Idx] || '0') : 0;

    if (hr9 === 0 && ip > 0) hr9 = (hr / ip) * 9;
    if (bb9 === 0 && ip > 0) bb9 = (bb / ip) * 9;
    if (k9 === 0 && ip > 0) k9 = (k / ip) * 9;

    results.push({
      player_id,
      player_name: nameIdx >= 0 ? cells[nameIdx] : undefined,
      team_id: teamIdx >= 0 ? parseInt(cells[teamIdx] || '0', 10) : undefined,
      ip,
      hr,
      bb,
      k,
      hr9,
      bb9,
      k9,
      age: ageIdx >= 0 ? parseInt(cells[ageIdx] || '0', 10) : undefined
    });
  }

  return results;
}

// ============================================================================
// Validation 1: Level Adjustment Accuracy
// ============================================================================

function validateLevelAdjustments(prospects: Prospect2017[]): void {
  console.log('\n' + '='.repeat(70));
  console.log('TEST 1: Level Adjustment Accuracy (AAA→MLB Transitions)');
  console.log('='.repeat(70));
  console.log();

  // Expected adjustments (from TrueFutureRatingService.ts)
  const expectedAdjustments = {
    aaa_to_mlb: { k9: 0.27, bb9: -0.06, hr9: 0.39 }
  };

  const transitions: LevelTransition[] = [];

  // Debug: Sample data loading
  const sample2017AAA = loadMinorLeagueStats(2017, 'aaa');
  const sample2018MLB = loadMLBStats(2018);
  console.log(`DEBUG: Loaded ${sample2017AAA.length} AAA players from 2017`);
  console.log(`DEBUG: Loaded ${sample2018MLB.length} MLB players from 2018`);
  if (sample2017AAA.length > 0) {
    console.log(`DEBUG: Sample AAA player ID: ${sample2017AAA[0].player_id}, IP: ${sample2017AAA[0].ip}`);
  }
  if (sample2018MLB.length > 0) {
    console.log(`DEBUG: Sample MLB player ID: ${sample2018MLB[0].player_id}, IP: ${sample2018MLB[0].ip}`);
  }
  console.log(`DEBUG: Checking ${prospects.length} prospects`);
  console.log(`DEBUG: Sample prospect IDs: ${prospects.slice(0, 5).map(p => p.playerId).join(', ')}`);
  console.log();

  // For each prospect, track their AAA stats (2017-2020) and MLB stats (2018-2021)
  for (const prospect of prospects) {
    // Get their AAA stats from 2017-2020
    for (let year = 2017; year <= 2020; year++) {
      const aaaStats = loadMinorLeagueStats(year, 'aaa')
        .filter(s => s.player_id === prospect.playerId && s.ip >= 20);

      if (aaaStats.length === 0) continue;

      const aaaStat = aaaStats[0];

      // Check if they appeared in MLB in the next few years
      for (let mlbYear = year + 1; mlbYear <= 2021; mlbYear++) {
        const mlbStats = loadMLBStats(mlbYear)
          .filter(s => s.player_id === prospect.playerId && s.ip >= 20);

        if (mlbStats.length > 0) {
          const mlbStat = mlbStats[0];

          transitions.push({
            playerId: prospect.playerId,
            playerName: prospect.name,
            fromYear: year,
            toYear: mlbYear,
            fromLevel: 'AAA',
            toLevel: 'MLB',
            fromStats: {
              k9: aaaStat.k9 || 0,
              bb9: aaaStat.bb9 || 0,
              hr9: aaaStat.hr9 || 0,
              ip: aaaStat.ip
            },
            toStats: {
              k9: mlbStat.k9 || 0,
              bb9: mlbStat.bb9 || 0,
              hr9: mlbStat.hr9 || 0,
              ip: mlbStat.ip
            },
            actualChange: {
              k9: (mlbStat.k9 || 0) - (aaaStat.k9 || 0),
              bb9: (mlbStat.bb9 || 0) - (aaaStat.bb9 || 0),
              hr9: (mlbStat.hr9 || 0) - (aaaStat.hr9 || 0)
            },
            projectedChange: expectedAdjustments.aaa_to_mlb,
            tfr: prospect.tfr
          });

          break; // Only count first MLB appearance
        }
      }
    }
  }

  console.log(`Found ${transitions.length} AAA→MLB transitions\n`);

  if (transitions.length === 0) {
    console.log('⚠️  No transitions found. Cannot validate level adjustments.');
    console.log('   Make sure you have minor league stats for 2017-2020 and MLB stats for 2018-2021.');
    return;
  }

  // Calculate errors
  const k9Errors = transitions.map(t => Math.abs(t.actualChange.k9 - t.projectedChange.k9));
  const bb9Errors = transitions.map(t => Math.abs(t.actualChange.bb9 - t.projectedChange.bb9));
  const hr9Errors = transitions.map(t => Math.abs(t.actualChange.hr9 - t.projectedChange.hr9));

  const k9MAE = k9Errors.reduce((a, b) => a + b, 0) / k9Errors.length;
  const bb9MAE = bb9Errors.reduce((a, b) => a + b, 0) / bb9Errors.length;
  const hr9MAE = hr9Errors.reduce((a, b) => a + b, 0) / hr9Errors.length;

  const avgActualK9Change = transitions.reduce((sum, t) => sum + t.actualChange.k9, 0) / transitions.length;
  const avgActualBb9Change = transitions.reduce((sum, t) => sum + t.actualChange.bb9, 0) / transitions.length;
  const avgActualHr9Change = transitions.reduce((sum, t) => sum + t.actualChange.hr9, 0) / transitions.length;

  console.log('Average Actual Changes (AAA→MLB):');
  console.log(`  K/9:  ${avgActualK9Change >= 0 ? '+' : ''}${avgActualK9Change.toFixed(2)} (expected: +${expectedAdjustments.aaa_to_mlb.k9.toFixed(2)})`);
  console.log(`  BB/9: ${avgActualBb9Change >= 0 ? '+' : ''}${avgActualBb9Change.toFixed(2)} (expected: ${expectedAdjustments.aaa_to_mlb.bb9.toFixed(2)})`);
  console.log(`  HR/9: ${avgActualHr9Change >= 0 ? '+' : ''}${avgActualHr9Change.toFixed(2)} (expected: +${expectedAdjustments.aaa_to_mlb.hr9.toFixed(2)})`);
  console.log();

  console.log('Mean Absolute Error (MAE):');
  console.log(`  K/9:  ${k9MAE.toFixed(2)} ${k9MAE < 1.0 ? '✅' : '❌'} (target: <1.0)`);
  console.log(`  BB/9: ${bb9MAE.toFixed(2)} ${bb9MAE < 0.5 ? '✅' : '❌'} (target: <0.5)`);
  console.log(`  HR/9: ${hr9MAE.toFixed(2)} ${hr9MAE < 0.4 ? '✅' : '❌'} (target: <0.4)`);
  console.log();

  // Sample transitions
  console.log('Sample Transitions (first 5):');
  console.log('─'.repeat(70));
  transitions.slice(0, 5).forEach(t => {
    console.log(`${t.playerName} (TFR: ${t.tfr.toFixed(1)})`);
    console.log(`  ${t.fromYear} AAA → ${t.toYear} MLB`);
    console.log(`  K/9:  ${t.fromStats.k9.toFixed(2)} → ${t.toStats.k9.toFixed(2)} (${t.actualChange.k9 >= 0 ? '+' : ''}${t.actualChange.k9.toFixed(2)})`);
    console.log(`  BB/9: ${t.fromStats.bb9.toFixed(2)} → ${t.toStats.bb9.toFixed(2)} (${t.actualChange.bb9 >= 0 ? '+' : ''}${t.actualChange.bb9.toFixed(2)})`);
    console.log(`  HR/9: ${t.fromStats.hr9.toFixed(2)} → ${t.toStats.hr9.toFixed(2)} (${t.actualChange.hr9 >= 0 ? '+' : ''}${t.actualChange.hr9.toFixed(2)})`);
    console.log();
  });

  // Save detailed results
  const outputPath = path.join(__dirname, '../reports/2017_level_adjustments.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    summary: {
      transitionCount: transitions.length,
      averageActualChanges: {
        k9: avgActualK9Change,
        bb9: avgActualBb9Change,
        hr9: avgActualHr9Change
      },
      expectedChanges: expectedAdjustments.aaa_to_mlb,
      mae: {
        k9: k9MAE,
        bb9: bb9MAE,
        hr9: hr9MAE
      },
      testsPassed: {
        k9: k9MAE < 1.0,
        bb9: bb9MAE < 0.5,
        hr9: hr9MAE < 0.4
      }
    },
    transitions
  }, null, 2));

  console.log(`💾 Detailed results saved to: ${path.basename(outputPath)}`);
}

// ============================================================================
// Validation 2: Trajectory Analysis
// ============================================================================

function validateTrajectory(prospects: Prospect2017[]): void {
  console.log('\n' + '='.repeat(70));
  console.log('TEST 2: Trajectory Validation (Progression Speed & Quality)');
  console.log('='.repeat(70));
  console.log();

  const trajectories: TrajectoryData[] = [];

  for (const prospect of prospects) {
    const progression: Array<{ year: number; level: string; ip: number }> = [];
    let reachedMLB = false;
    let mlbAge: number | undefined;
    let yearsToMLB: number | undefined;

    // Track progression from 2017-2021
    for (let year = 2017; year <= 2021; year++) {
      // Check MLB first
      const mlbStats = loadMLBStats(year).filter(s => s.player_id === prospect.playerId && s.ip >= 10);
      if (mlbStats.length > 0) {
        progression.push({ year, level: 'MLB', ip: mlbStats[0].ip });
        if (!reachedMLB) {
          reachedMLB = true;
          mlbAge = mlbStats[0].age || (prospect.age + (year - 2017));
          yearsToMLB = year - 2017;
        }
        continue;
      }

      // Check minors
      for (const level of ['aaa', 'aa', 'a', 'rk']) {
        const minorStats = loadMinorLeagueStats(year, level).filter(s => s.player_id === prospect.playerId && s.ip >= 10);
        if (minorStats.length > 0) {
          progression.push({ year, level: level.toUpperCase(), ip: minorStats[0].ip });
          break;
        }
      }
    }

    if (progression.length > 0) {
      trajectories.push({
        playerId: prospect.playerId,
        playerName: prospect.name,
        tfr: prospect.tfr,
        startAge: prospect.age,
        endAge: prospect.age + 4,
        startLevel: progression[0].level,
        endLevel: progression[progression.length - 1].level,
        reachedMLB,
        yearsToMLB,
        mlbAge,
        progression
      });
    }
  }

  console.log(`Tracked ${trajectories.length} prospect careers\n`);

  // Group by TFR tier
  const elite = trajectories.filter(t => t.tfr >= 4.0);
  const aboveAvg = trajectories.filter(t => t.tfr >= 3.5 && t.tfr < 4.0);
  const average = trajectories.filter(t => t.tfr >= 3.0 && t.tfr < 3.5);
  const belowAvg = trajectories.filter(t => t.tfr < 3.0);

  const tiers = [
    { name: 'Elite (4.0+)', data: elite, expectedMLBRate: 0.5, expectedYears: 2 },
    { name: 'Above Avg (3.5-3.9)', data: aboveAvg, expectedMLBRate: 0.35, expectedYears: 3 },
    { name: 'Average (3.0-3.4)', data: average, expectedMLBRate: 0.20, expectedYears: 4 },
    { name: 'Below Avg (<3.0)', data: belowAvg, expectedMLBRate: 0.10, expectedYears: 5 }
  ];

  console.log('MLB Arrival Rate by TFR Tier:');
  console.log('─'.repeat(70));

  for (const tier of tiers) {
    const mlbCount = tier.data.filter(t => t.reachedMLB).length;
    const mlbRate = tier.data.length > 0 ? mlbCount / tier.data.length : 0;
    const avgYears = tier.data.filter(t => t.reachedMLB).reduce((sum, t) => sum + (t.yearsToMLB || 0), 0) / mlbCount || 0;
    const avgAge = tier.data.filter(t => t.reachedMLB).reduce((sum, t) => sum + (t.mlbAge || 0), 0) / mlbCount || 0;

    const ratePass = mlbRate >= tier.expectedMLBRate;
    const yearsPass = mlbCount > 0 ? avgYears <= tier.expectedYears : true;

    console.log(`${tier.name}`);
    console.log(`  Prospects: ${tier.data.length}`);
    console.log(`  Reached MLB: ${mlbCount} (${(mlbRate * 100).toFixed(1)}%) ${ratePass ? '✅' : '❌'}`);
    if (mlbCount > 0) {
      console.log(`  Avg Years to MLB: ${avgYears.toFixed(1)} ${yearsPass ? '✅' : '❌'}`);
      console.log(`  Avg MLB Debut Age: ${avgAge.toFixed(1)}`);
    }
    console.log();
  }

  // Sample progressions
  console.log('Sample Elite Progressions:');
  console.log('─'.repeat(70));
  elite.slice(0, 3).forEach(t => {
    console.log(`${t.playerName} (TFR: ${t.tfr.toFixed(1)}, Age: ${t.startAge})`);
    t.progression.forEach(p => {
      console.log(`  ${p.year}: ${p.level} (${p.ip.toFixed(1)} IP)`);
    });
    console.log();
  });

  // Save results
  const outputPath = path.join(__dirname, '../reports/2017_trajectory.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    summary: tiers.map(tier => ({
      tier: tier.name,
      count: tier.data.length,
      mlbCount: tier.data.filter(t => t.reachedMLB).length,
      mlbRate: tier.data.length > 0 ? tier.data.filter(t => t.reachedMLB).length / tier.data.length : 0,
      avgYearsToMLB: tier.data.filter(t => t.reachedMLB).reduce((sum, t) => sum + (t.yearsToMLB || 0), 0) / tier.data.filter(t => t.reachedMLB).length || 0
    })),
    trajectories
  }, null, 2));

  console.log(`💾 Detailed results saved to: ${path.basename(outputPath)}`);
}

// ============================================================================
// Validation 3: Early MLB Performance
// ============================================================================

function validateMLBPerformance(prospects: Prospect2017[]): void {
  console.log('\n' + '='.repeat(70));
  console.log('TEST 3: Early MLB Performance (Actual vs Projected)');
  console.log('='.repeat(70));
  console.log();

  const mlbPerformances: MLBPerformance[] = [];

  for (const prospect of prospects) {
    const mlbYears: Array<{ year: number; age: number; ip: number; fip: number; k9: number; bb9: number; hr9: number }> = [];

    // Check MLB stats 2018-2021 (ages 22-25 typically)
    for (let year = 2018; year <= 2021; year++) {
      const mlbStats = loadMLBStats(year).filter(s => s.player_id === prospect.playerId && s.ip >= 20);

      if (mlbStats.length > 0) {
        const stat = mlbStats[0];
        const fip = calculateFIP(stat.hr9 || 0, stat.bb9 || 0, stat.k9 || 0);

        mlbYears.push({
          year,
          age: stat.age || (prospect.age + (year - 2017)),
          ip: stat.ip,
          fip,
          k9: stat.k9 || 0,
          bb9: stat.bb9 || 0,
          hr9: stat.hr9 || 0
        });
      }
    }

    if (mlbYears.length > 0) {
      const totalIp = mlbYears.reduce((sum, y) => sum + y.ip, 0);
      const weightedFip = mlbYears.reduce((sum, y) => sum + (y.fip * y.ip), 0) / totalIp;

      mlbPerformances.push({
        playerId: prospect.playerId,
        playerName: prospect.name,
        tfr: prospect.tfr,
        projFip: prospect.projFip,
        mlbYears,
        avgFip: weightedFip,
        totalIp
      });
    }
  }

  console.log(`Found ${mlbPerformances.length} prospects with MLB data\n`);

  if (mlbPerformances.length === 0) {
    console.log('⚠️  No MLB performances found. Cannot validate.');
    return;
  }

  // Group by TFR tier
  const elite = mlbPerformances.filter(p => p.tfr >= 4.0);
  const aboveAvg = mlbPerformances.filter(p => p.tfr >= 3.5 && p.tfr < 4.0);
  const average = mlbPerformances.filter(p => p.tfr >= 3.0 && p.tfr < 3.5);

  console.log('Actual MLB Performance by TFR Tier:');
  console.log('─'.repeat(70));

  const tiers = [
    { name: 'Elite (4.0+)', data: elite, targetFip: 3.50 },
    { name: 'Above Avg (3.5-3.9)', data: aboveAvg, targetFip: 4.00 },
    { name: 'Average (3.0-3.4)', data: average, targetFip: 4.50 }
  ];

  for (const tier of tiers) {
    if (tier.data.length === 0) {
      console.log(`${tier.name}: No MLB data`);
      console.log();
      continue;
    }

    const avgFip = tier.data.reduce((sum, p) => sum + p.avgFip, 0) / tier.data.length;
    const avgProjFip = tier.data.reduce((sum, p) => sum + p.projFip, 0) / tier.data.length;
    const fipPass = avgFip < tier.targetFip;

    console.log(`${tier.name}`);
    console.log(`  Count: ${tier.data.length}`);
    console.log(`  Avg Actual FIP: ${avgFip.toFixed(2)} ${fipPass ? '✅' : '❌'} (target: <${tier.targetFip.toFixed(2)})`);
    console.log(`  Avg Projected FIP: ${avgProjFip.toFixed(2)}`);
    console.log(`  Projection Error: ${(avgFip - avgProjFip).toFixed(2)}`);
    console.log();
  }

  // Correlation
  const actualFips = mlbPerformances.map(p => p.avgFip);
  const projFips = mlbPerformances.map(p => p.projFip);
  const correlation = calculateCorrelation(actualFips, projFips);

  console.log(`Correlation (Projected vs Actual FIP): ${correlation.toFixed(3)} ${correlation > 0.4 ? '✅' : '❌'} (target: >0.4)`);
  console.log();

  // Top performers
  const sorted = [...mlbPerformances].sort((a, b) => a.avgFip - b.avgFip);
  console.log('Top 10 Actual MLB Performers:');
  console.log('─'.repeat(70));
  sorted.slice(0, 10).forEach((p, i) => {
    console.log(`${i + 1}. ${p.playerName} (TFR: ${p.tfr.toFixed(1)})`);
    console.log(`   Actual FIP: ${p.avgFip.toFixed(2)} | Projected: ${p.projFip.toFixed(2)} | Error: ${(p.avgFip - p.projFip).toFixed(2)}`);
    console.log(`   ${p.totalIp.toFixed(1)} IP over ${p.mlbYears.length} seasons`);
  });

  // Save results
  const outputPath = path.join(__dirname, '../reports/2017_mlb_performance.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    summary: {
      totalProspects: mlbPerformances.length,
      correlation,
      tierPerformance: tiers.map(tier => ({
        tier: tier.name,
        count: tier.data.length,
        avgActualFip: tier.data.length > 0 ? tier.data.reduce((sum, p) => sum + p.avgFip, 0) / tier.data.length : 0,
        avgProjFip: tier.data.length > 0 ? tier.data.reduce((sum, p) => sum + p.projFip, 0) / tier.data.length : 0
      }))
    },
    performances: mlbPerformances
  }, null, 2));

  console.log();
  console.log(`💾 Detailed results saved to: ${path.basename(outputPath)}`);
}

// ============================================================================
// Helper Functions
// ============================================================================

function calculateFIP(hr9: number, bb9: number, k9: number): number {
  return ((13 * hr9 + 3 * bb9 - 2 * k9) / 9) + 3.47;
}

function calculateCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) return 0;

  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  if (denX === 0 || denY === 0) return 0;
  return num / Math.sqrt(denX * denY);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('TFR 2017 Validation');
  console.log('Testing 2017 projections against 2018-2021 outcomes');
  console.log('='.repeat(70));
  console.log();

  const prospects = loadProspects2017();
  console.log(`Loaded ${prospects.length} prospects from 2017\n`);

  if (prospects.length === 0) {
    console.error('❌ No prospects found. Please export 2017 data first.');
    console.error('See: tools/research/2017_calibration_workflow.md');
    process.exit(1);
  }

  console.log('Distribution:');
  const tfrCounts = {
    elite: prospects.filter(p => p.tfr >= 4.5).length,
    star: prospects.filter(p => p.tfr >= 4.0 && p.tfr < 4.5).length,
    aboveAvg: prospects.filter(p => p.tfr >= 3.5 && p.tfr < 4.0).length,
    average: prospects.filter(p => p.tfr >= 3.0 && p.tfr < 3.5).length,
  };
  console.log(`  Elite (4.5+): ${tfrCounts.elite}`);
  console.log(`  Star (4.0-4.4): ${tfrCounts.star}`);
  console.log(`  Above Avg (3.5-3.9): ${tfrCounts.aboveAvg}`);
  console.log(`  Average (3.0-3.4): ${tfrCounts.average}`);

  // Run validation tests
  validateLevelAdjustments(prospects);
  validateTrajectory(prospects);
  validateMLBPerformance(prospects);

  console.log('\n' + '='.repeat(70));
  console.log('✅ Validation Complete');
  console.log('='.repeat(70));
  console.log();
  console.log('Results saved to tools/reports/:');
  console.log('  - 2017_level_adjustments.json');
  console.log('  - 2017_trajectory.json');
  console.log('  - 2017_mlb_performance.json');
  console.log();
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
