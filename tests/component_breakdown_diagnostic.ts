/**
 * Component Breakdown Diagnostic
 *
 * Analyzes projection errors by breaking down into K9, BB9, and HR9 components
 * to identify which specific component is causing FIP projection errors.
 *
 * USAGE: npx tsx tests/component_breakdown_diagnostic.ts
 */

const API_BASE = 'https://atl-01.statsplus.net/world/api';

interface PitcherStats {
  player_id: number;
  playerName: string;
  year: number;
  ip: string;
  k9: number;
  bb9: number;
  hr9: number;
  fip: number;
  war: number;
  gs: number;
}

interface QuartileAnalysis {
  quartile: string;
  fipRange: string;
  count: number;
  // FIP errors
  fipMae: number;
  fipBias: number;
  // K9 errors
  k9Mae: number;
  k9Bias: number;
  // BB9 errors
  bb9Mae: number;
  bb9Bias: number;
  // HR9 errors
  hr9Mae: number;
  hr9Bias: number;
}

async function fetchPitchingStats(year: number): Promise<Map<number, PitcherStats>> {
  const url = `${API_BASE}/playerpitchstatsv2/?year=${year}`;
  console.log(`Fetching ${year} stats...`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${year} stats`);

  const csvText = await response.text();
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',');

  const indices = {
    player_id: headers.indexOf('player_id'),
    year: headers.indexOf('year'),
    split_id: headers.indexOf('split_id'),
    ip: headers.indexOf('ip'),
    k: headers.indexOf('k'),
    bb: headers.indexOf('bb'),
    hra: headers.indexOf('hra'),
    war: headers.indexOf('war'),
    gs: headers.indexOf('gs')
  };

  const playerMap = new Map<number, PitcherStats>();

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const split_id = parseInt(values[indices.split_id]);
    if (split_id !== 1) continue; // Only total stats

    const player_id = parseInt(values[indices.player_id]);
    const ip = values[indices.ip];
    const ipNum = parseIp(ip);

    // Filter for starters with 100+ IP
    if (ipNum < 100) continue;

    const k = parseInt(values[indices.k]) || 0;
    const bb = parseInt(values[indices.bb]) || 0;
    const hra = parseInt(values[indices.hra]) || 0;

    // Calculate rate stats
    const k9 = ipNum > 0 ? (k / ipNum) * 9 : 0;
    const bb9 = ipNum > 0 ? (bb / ipNum) * 9 : 0;
    const hr9 = ipNum > 0 ? (hra / ipNum) * 9 : 0;

    // Calculate FIP using constant 3.47 (typical WBL value)
    const fip = ipNum > 0 ? ((13 * hr9 + 3 * bb9 - 2 * k9) / 9) + 3.47 : 0;

    playerMap.set(player_id, {
      player_id,
      playerName: `Player ${player_id}`, // API doesn't provide names in this endpoint
      year: parseInt(values[indices.year]),
      ip,
      k9,
      bb9,
      hr9,
      fip,
      war: parseFloat(values[indices.war]) || 0,
      gs: parseInt(values[indices.gs]) || 0
    });
  }

  console.log(`Found ${playerMap.size} pitchers with 100+ IP in ${year}`);
  return playerMap;
}

function parseIp(ip: string): number {
  const parts = ip.split('.');
  if (parts.length === 1) return parseInt(ip);
  const whole = parseInt(parts[0]) || 0;
  const third = parseInt(parts[1]) || 0;
  return whole + third / 3;
}

async function analyzeComponentBreakdown() {
  console.log('=== Component Breakdown Diagnostic ===\n');
  console.log('Analyzing actual stats from 2018-2021 (100+ IP starters)');
  console.log('This shows what the projection system WOULD have needed to predict\n');

  // Fetch all years
  const years = [2018, 2019, 2020, 2021];
  const allStats: PitcherStats[] = [];

  for (const year of years) {
    try {
      const yearStats = await fetchPitchingStats(year);
      allStats.push(...Array.from(yearStats.values()));
    } catch (error) {
      console.warn(`Failed to fetch ${year}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(`\nTotal samples collected: ${allStats.length}\n`);

  if (allStats.length === 0) {
    console.error('No data collected! Exiting.');
    return;
  }

  // Sort by FIP for quartile analysis
  allStats.sort((a, b) => a.fip - b.fip);

  // Split into quartiles
  const quartileSize = Math.floor(allStats.length / 4);
  const quartiles: QuartileAnalysis[] = [];

  for (let q = 0; q < 4; q++) {
    const start = q * quartileSize;
    const end = q === 3 ? allStats.length : (q + 1) * quartileSize;
    const quartileData = allStats.slice(start, end);

    const fipRange = `${quartileData[0].fip.toFixed(2)}-${quartileData[quartileData.length - 1].fip.toFixed(2)}`;

    // Calculate average stats for this quartile (what we need to project)
    const avgK9 = calculateMean(quartileData.map(d => d.k9));
    const avgBb9 = calculateMean(quartileData.map(d => d.bb9));
    const avgHr9 = calculateMean(quartileData.map(d => d.hr9));
    const avgFip = calculateMean(quartileData.map(d => d.fip));

    quartiles.push({
      quartile: `Q${q + 1}`,
      fipRange,
      count: quartileData.length,
      fipMae: 0, // Placeholder - will be calculated when we have projections
      fipBias: avgFip, // Show actual average as target
      k9Mae: 0,
      k9Bias: avgK9, // Show actual average as target
      bb9Mae: 0,
      bb9Bias: avgBb9, // Show actual average as target
      hr9Mae: 0,
      hr9Bias: avgHr9 // Show actual average as target
    });
  }

  // Print results - showing what each quartile actually achieved
  console.log('=== ACTUAL PERFORMANCE BY QUARTILE (What projections need to match) ===\n');
  console.log('Quartile\t\tFIP Range\tCount\tAvg FIP\t\tAvg K9\t\tAvg BB9\t\tAvg HR9');
  console.log('─'.repeat(120));

  for (const q of quartiles) {
    const label = q.quartile === 'Q1' ? 'Q1 (Elite)' :
                  q.quartile === 'Q2' ? 'Q2 (Good)' :
                  q.quartile === 'Q3' ? 'Q3 (Avg)' : 'Q4 (Below Avg)';

    console.log(
      `${label}\t\t${q.fipRange}\t${q.count}\t` +
      `${q.fipBias.toFixed(2)}\t\t` +
      `${q.k9Bias.toFixed(2)}\t\t` +
      `${q.bb9Bias.toFixed(2)}\t\t` +
      `${q.hr9Bias.toFixed(2)}`
    );
  }

  console.log('\n=== WHAT THIS TELLS US ===\n');
  console.log('Your current projection errors are:');
  console.log('Q1 (Elite):      FIP Bias -0.398 (projecting 0.398 TOO HIGH)');
  console.log('Q2 (Good):       FIP Bias -0.162 (projecting 0.162 TOO HIGH)');
  console.log('Q3 (Average):    FIP Bias +0.129 (projecting 0.129 TOO LOW)');
  console.log('Q4 (Below Avg):  FIP Bias +0.505 (projecting 0.505 TOO LOW)\n');

  console.log('To fix this, we need to identify which component(s) are causing each error:\n');

  // Show component ranges for reference
  console.log('=== COMPONENT RANGES BY QUARTILE ===\n');

  for (let q = 0; q < 4; q++) {
    const start = q * quartileSize;
    const end = q === 3 ? allStats.length : (q + 1) * quartileSize;
    const quartileData = allStats.slice(start, end);
    const label = q === 0 ? 'Q1 (Elite)' : q === 1 ? 'Q2 (Good)' : q === 2 ? 'Q3 (Avg)' : 'Q4 (Below Avg)';

    const k9Values = quartileData.map(d => d.k9).sort((a, b) => a - b);
    const bb9Values = quartileData.map(d => d.bb9).sort((a, b) => a - b);
    const hr9Values = quartileData.map(d => d.hr9).sort((a, b) => a - b);

    const k9_p10 = k9Values[Math.floor(k9Values.length * 0.1)];
    const k9_p50 = k9Values[Math.floor(k9Values.length * 0.5)];
    const k9_p90 = k9Values[Math.floor(k9Values.length * 0.9)];

    const bb9_p10 = bb9Values[Math.floor(bb9Values.length * 0.1)];
    const bb9_p50 = bb9Values[Math.floor(bb9Values.length * 0.5)];
    const bb9_p90 = bb9Values[Math.floor(bb9Values.length * 0.9)];

    const hr9_p10 = hr9Values[Math.floor(hr9Values.length * 0.1)];
    const hr9_p50 = hr9Values[Math.floor(hr9Values.length * 0.5)];
    const hr9_p90 = hr9Values[Math.floor(hr9Values.length * 0.9)];

    console.log(`${label}:`);
    console.log(`  K/9:  P10=${k9_p10.toFixed(2)}  P50=${k9_p50.toFixed(2)}  P90=${k9_p90.toFixed(2)}`);
    console.log(`  BB/9: P10=${bb9_p10.toFixed(2)}  P50=${bb9_p50.toFixed(2)}  P90=${bb9_p90.toFixed(2)}`);
    console.log(`  HR/9: P10=${hr9_p10.toFixed(2)}  P50=${hr9_p50.toFixed(2)}  P90=${hr9_p90.toFixed(2)}\n`);
  }

  console.log('\n=== FIP FORMULA IMPACT ===\n');
  console.log('FIP = (13×HR9 + 3×BB9 - 2×K9) / 9 + constant\n');
  console.log('To reduce FIP by 1.0, you need to either:');
  console.log('  - Increase K9 by 4.5');
  console.log('  - Decrease BB9 by 3.0');
  console.log('  - Decrease HR9 by 0.69\n');

  console.log('Given your errors:');
  console.log('Q1 Elite (need -0.398 FIP, currently projecting too high):');
  console.log('  Option A: Increase projected K9 by ~1.79 (4.5 × 0.398)');
  console.log('  Option B: Decrease projected BB9 by ~1.19 (3.0 × 0.398)');
  console.log('  Option C: Decrease projected HR9 by ~0.27 (0.69 × 0.398)');
  console.log('  Option D: Mix of all three\n');

  console.log('Q4 Below Avg (need +0.505 FIP, currently projecting too low):');
  console.log('  Option A: Decrease projected K9 by ~2.27 (4.5 × 0.505)');
  console.log('  Option B: Increase projected BB9 by ~1.52 (3.0 × 0.505)');
  console.log('  Option C: Increase projected HR9 by ~0.35 (0.69 × 0.505)');
  console.log('  Option D: Mix of all three\n');

  console.log('=== NEXT STEPS ===\n');
  console.log('1. Check your linear formulas in PotentialStatsService.ts:');
  console.log('   - K/9 = 2.10 + 0.074 * Stuff');
  console.log('   - BB/9 = 5.30 - 0.052 * Control');
  console.log('   - HR/9 = 2.18 - 0.024 * HRA\n');
  console.log('2. Check your regression target adjustments in TrueRatingsCalculationService.ts:');
  console.log('   - K9 adjustment: targetOffset * 0.5');
  console.log('   - BB9 adjustment: targetOffset * 0.3');
  console.log('   - HR9 adjustment: targetOffset * 0.1\n');
  console.log('3. Consider adjusting these ratios to better distribute the FIP adjustments');
}

function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Run the analysis
analyzeComponentBreakdown().catch(console.error);
