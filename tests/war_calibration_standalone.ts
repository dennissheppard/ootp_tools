/**
 * Standalone WAR Calibration Test
 *
 * Compares OOTP's actual WAR values from 2020 season data
 * against what our formula would calculate using the same stats.
 *
 * This version fetches data directly from the StatsPlus API.
 *
 * USAGE: npx tsx tests/war_calibration_standalone.ts
 */

const API_BASE = 'https://atl-01.statsplus.net/world/api';

interface ApiPitchingStats {
    id: number;
    player_id: number;
    team_id: number;
    game_id: number;
    league_id: number;
    level_id: number;
    split_id: number;
    year: number;
    ip: string;
    k: number;
    bb: number;
    hra: number;
    h: number;
    er: number;
    war: number;
}

interface WARComparison {
    playerId: number;
    ip: number;
    k9: number;
    bb9: number;
    hr9: number;
    fip: number;
    ootpWar: number;
    calculatedWar: number;
    difference: number;
    fipPercentile: number;
}

interface WARStats {
    mean: number;
    median: number;
    stdDev: number;
    min: number;
    max: number;
    positive: number;
    negative: number;
    zero: number;
}

async function fetchPitchingStats(year: number): Promise<ApiPitchingStats[]> {
    const url = `${API_BASE}/playerpitchstatsv2/?year=${year}`;
    console.log(`Fetching: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch pitching stats: ${response.statusText}`);
    }
    const csvText = await response.text();
    return parseStatsCsv(csvText);
}

function parseStatsCsv(csvText: string): ApiPitchingStats[] {
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',');

    // Find column indices
    const indices = {
        id: headers.indexOf('id'),
        player_id: headers.indexOf('player_id'),
        year: headers.indexOf('year'),
        team_id: headers.indexOf('team_id'),
        game_id: headers.indexOf('game_id'),
        league_id: headers.indexOf('league_id'),
        level_id: headers.indexOf('level_id'),
        split_id: headers.indexOf('split_id'),
        ip: headers.indexOf('ip'),
        k: headers.indexOf('k'),
        bb: headers.indexOf('bb'),
        hra: headers.indexOf('hra'),
        h: headers.indexOf('h'),
        er: headers.indexOf('er'),
        war: headers.indexOf('war')
    };

    const stats: ApiPitchingStats[] = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const split_id = parseInt(values[indices.split_id]);

        // ONLY include overall stats (split_id = 1), skip home/away/monthly splits
        if (split_id !== 1) continue;

        stats.push({
            id: parseInt(values[indices.id]),
            player_id: parseInt(values[indices.player_id]),
            year: parseInt(values[indices.year]),
            team_id: parseInt(values[indices.team_id]),
            game_id: parseInt(values[indices.game_id]),
            league_id: parseInt(values[indices.league_id]),
            level_id: parseInt(values[indices.level_id]),
            split_id: split_id,
            ip: values[indices.ip],
            k: parseInt(values[indices.k]),
            bb: parseInt(values[indices.bb]),
            hra: parseInt(values[indices.hra]),
            h: parseInt(values[indices.h]),
            er: parseInt(values[indices.er]),
            war: parseFloat(values[indices.war])
        });
    }

    return stats;
}

function parseIp(ip: string | number): number {
    const ipAsString = String(ip);
    const parts = ipAsString.split('.');
    const fullInnings = parseInt(parts[0], 10);
    const partialInnings = parts.length > 1 ? parseInt(parts[1], 10) : 0;
    return fullInnings + (partialInnings / 3);
}

function calculateFip(k9: number, bb9: number, hr9: number, fipConstant: number): number {
    const fip = ((13 * hr9) + (3 * bb9) - (2 * k9)) / 9 + fipConstant;
    return Math.round(fip * 100) / 100;
}

function calculateWar(fip: number, ip: number, replacementFip: number, runsPerWin: number): number {
    const war = ((replacementFip - fip) / runsPerWin) * (ip / 9);
    return Math.round(war * 10) / 10;
}

function getStats(values: number[]): WARStats {
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    return {
        mean,
        median,
        stdDev,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        positive: values.filter(v => v > 0).length,
        negative: values.filter(v => v < 0).length,
        zero: values.filter(v => v === 0).length
    };
}

function printStats(stats: WARStats): void {
    console.log(`  Mean:   ${stats.mean.toFixed(2)}`);
    console.log(`  Median: ${stats.median.toFixed(2)}`);
    console.log(`  StdDev: ${stats.stdDev.toFixed(2)}`);
    console.log(`  Range:  ${stats.min.toFixed(2)} to ${stats.max.toFixed(2)}`);
    console.log(`  Distribution: ${stats.positive} positive, ${stats.negative} negative, ${stats.zero} zero`);
}

function calculateCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

    const r = (n * sumXY - sumX * sumY) / Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    return r * r; // R²
}

async function runWarCalibrationTest() {
    console.log('=== WAR Calibration Test ===\n');
    console.log('Comparing OOTP 2020 actual WAR vs our formula\n');

    // Fetch 2020 pitching stats
    const year = 2020;
    const rawStats = await fetchPitchingStats(year);
    console.log(`Total stat lines fetched: ${rawStats.length}`);

    // Aggregate stats by player (in case they were traded mid-season)
    const playerMap = new Map<number, ApiPitchingStats>();
    for (const stat of rawStats) {
        const existing = playerMap.get(stat.player_id);
        if (!existing) {
            playerMap.set(stat.player_id, { ...stat });
        } else {
            // Player was traded - sum counting stats across teams
            const existingIp = parseIp(existing.ip);
            const statIp = parseIp(stat.ip);
            existing.ip = String((existingIp + statIp).toFixed(1)).replace('.', '.');
            existing.k += stat.k;
            existing.bb += stat.bb;
            existing.hra += stat.hra;
            existing.h += stat.h;
            existing.er += stat.er;
            existing.war += stat.war; // Sum WAR across team stints
        }
    }

    const allPitchers = Array.from(playerMap.values());
    console.log(`Total unique pitchers: ${allPitchers.length}\n`);

    // Calculate league stats
    let totalEr = 0, totalOuts = 0, totalK = 0, totalBb = 0, totalHr = 0;

    for (const p of allPitchers) {
        totalEr += p.er;
        totalOuts += parseIp(p.ip) * 3;
        totalK += p.k;
        totalBb += p.bb;
        totalHr += p.hra;
    }

    const totalIp = totalOuts / 3;
    const leagueEra = (totalEr * 9) / totalIp;
    const rawFipComponent = ((13 * totalHr) + (3 * totalBb) - (2 * totalK)) / totalIp;
    const fipConstant = leagueEra - rawFipComponent;
    const avgFip = rawFipComponent + fipConstant;

    console.log(`League Stats for ${year}:`);
    console.log(`  ERA: ${leagueEra.toFixed(2)}`);
    console.log(`  Avg FIP: ${avgFip.toFixed(2)}`);
    console.log(`  FIP Constant: ${fipConstant.toFixed(2)}\n`);

    // Filter to pitchers with meaningful IP
    const minIp = 50;
    const qualifiedPitchers = allPitchers.filter(p => {
        const ip = parseIp(p.ip);
        return ip >= minIp && p.war != null && !isNaN(p.war);
    });

    console.log(`Qualified pitchers (${minIp}+ IP): ${qualifiedPitchers.length}\n`);

    // Calculate WAR using our FINAL formula
    const runsPerWin = 8.5;
    const replacementFip = avgFip + 1.00; // FINAL formula (elite-calibrated)
    console.log(`Our Formula Parameters (FINAL):`);
    console.log(`  Replacement FIP: ${replacementFip.toFixed(2)} (avgFip + 1.00)`);
    console.log(`  Runs Per Win: ${runsPerWin}\n`);

    const comparisons: WARComparison[] = qualifiedPitchers.map(p => {
        const ip = parseIp(p.ip);
        const k9 = (p.k / ip) * 9;
        const bb9 = (p.bb / ip) * 9;
        const hr9 = (p.hra / ip) * 9;

        const fip = calculateFip(k9, bb9, hr9, fipConstant);
        const calculatedWar = calculateWar(fip, ip, replacementFip, runsPerWin);

        return {
            playerId: p.player_id,
            ip,
            k9,
            bb9,
            hr9,
            fip,
            ootpWar: p.war,
            calculatedWar,
            difference: calculatedWar - p.war,
            fipPercentile: 0
        };
    });

    // Calculate FIP percentiles
    const sortedByFip = [...comparisons].sort((a, b) => a.fip - b.fip);
    comparisons.forEach(comp => {
        const rank = sortedByFip.findIndex(p => p.playerId === comp.playerId) + 1;
        comp.fipPercentile = ((comparisons.length - rank + 1) / comparisons.length) * 100;
    });

    // Calculate statistics
    const ootpStats = getStats(comparisons.map(c => c.ootpWar));
    const calcStats = getStats(comparisons.map(c => c.calculatedWar));
    const diffStats = getStats(comparisons.map(c => c.difference));

    console.log('=== OOTP WAR Distribution ===');
    printStats(ootpStats);

    console.log('\n=== Our Calculated WAR Distribution ===');
    printStats(calcStats);

    console.log('\n=== Difference (Our WAR - OOTP WAR) ===');
    printStats(diffStats);

    // Analyze by FIP quality tiers
    console.log('\n=== Analysis by FIP Quality ===');
    const tiers = [
        { name: 'Elite (95%+)', min: 95, max: 100 },
        { name: 'Great (80-95%)', min: 80, max: 95 },
        { name: 'Above Avg (60-80%)', min: 60, max: 80 },
        { name: 'Average (40-60%)', min: 40, max: 60 },
        { name: 'Below Avg (20-40%)', min: 20, max: 40 },
        { name: 'Bad (5-20%)', min: 5, max: 20 },
        { name: 'Terrible (0-5%)', min: 0, max: 5 }
    ];

    tiers.forEach(tier => {
        const tierPitchers = comparisons.filter(c =>
            c.fipPercentile >= tier.min && c.fipPercentile < tier.max
        );

        if (tierPitchers.length === 0) return;

        const avgOotpWar = tierPitchers.reduce((sum, p) => sum + p.ootpWar, 0) / tierPitchers.length;
        const avgCalcWar = tierPitchers.reduce((sum, p) => sum + p.calculatedWar, 0) / tierPitchers.length;
        const avgDiff = avgCalcWar - avgOotpWar;
        const avgIp = tierPitchers.reduce((sum, p) => sum + p.ip, 0) / tierPitchers.length;
        const avgFip = tierPitchers.reduce((sum, p) => sum + p.fip, 0) / tierPitchers.length;

        console.log(`\n${tier.name} (n=${tierPitchers.length}, avg IP=${avgIp.toFixed(0)}, avg FIP=${avgFip.toFixed(2)})`);
        console.log(`  OOTP WAR:   ${avgOotpWar.toFixed(2)}`);
        console.log(`  Our WAR:    ${avgCalcWar.toFixed(2)}`);
        console.log(`  Difference: ${avgDiff >= 0 ? '+' : ''}${avgDiff.toFixed(2)}`);

        // Show example pitchers
        const examples = tierPitchers.slice(0, 3);
        examples.forEach(p => {
            console.log(`    Player ${p.playerId}: FIP ${p.fip.toFixed(2)}, ${p.ip.toFixed(0)} IP, OOTP ${p.ootpWar.toFixed(1)}, Ours ${p.calculatedWar.toFixed(1)} (${p.difference >= 0 ? '+' : ''}${p.difference.toFixed(1)})`);
        });
    });

    // Find worst offenders
    console.log('\n=== Biggest Over-Estimations (Our WAR too high) ===');
    const overEstimated = [...comparisons].sort((a, b) => b.difference - a.difference).slice(0, 10);
    overEstimated.forEach(p => {
        console.log(`  Player ${p.playerId}: FIP ${p.fip.toFixed(2)} (${p.fipPercentile.toFixed(0)}%), ${p.ip.toFixed(0)} IP, OOTP ${p.ootpWar.toFixed(1)}, Ours ${p.calculatedWar.toFixed(1)} (+${p.difference.toFixed(1)})`);
    });

    console.log('\n=== Biggest Under-Estimations (Our WAR too low) ===');
    const underEstimated = [...comparisons].sort((a, b) => a.difference - b.difference).slice(0, 10);
    underEstimated.forEach(p => {
        console.log(`  Player ${p.playerId}: FIP ${p.fip.toFixed(2)} (${p.fipPercentile.toFixed(0)}%), ${p.ip.toFixed(0)} IP, OOTP ${p.ootpWar.toFixed(1)}, Ours ${p.calculatedWar.toFixed(1)} (${p.difference.toFixed(1)})`);
    });

    // Check correlation
    const correlation = calculateCorrelation(
        comparisons.map(c => c.ootpWar),
        comparisons.map(c => c.calculatedWar)
    );
    console.log(`\n=== Correlation ===`);
    console.log(`R² between OOTP and Our WAR: ${correlation.toFixed(3)}`);

    // Test alternative formulas
    console.log('\n=== Testing Alternative Replacement Levels ===');
    const alternatives = [
        { name: 'NEW (avgFip + 0.37)', replFip: avgFip + 0.37 },
        { name: 'OLD (avgFip + 1.02)', replFip: avgFip + 1.02 },
        { name: 'Standard (avgFip + 1.00)', replFip: avgFip + 1.00 },
        { name: 'Lower (avgFip + 0.20)', replFip: avgFip + 0.20 },
        { name: 'OOTP-matched', replFip: 0 } // Will calculate below
    ];

    // Calculate what replacement FIP would match OOTP's mean
    const targetMean = ootpStats.mean;
    // mean = average of ((replFip - fip) / rpw) * (ip / 9)
    // Solving for replFip that gives us targetMean
    let sumWeightedFip = 0;
    let sumWeight = 0;
    comparisons.forEach(c => {
        const weight = c.ip / 9;
        sumWeightedFip += c.fip * weight;
        sumWeight += weight;
    });
    const avgWeightedFip = sumWeightedFip / sumWeight;
    const ootpMatchedReplFip = avgWeightedFip + (targetMean * runsPerWin / sumWeight * comparisons.length);
    alternatives[alternatives.length - 1].replFip = ootpMatchedReplFip;

    alternatives.forEach(alt => {
        const altComps = comparisons.map(c => ({
            ...c,
            altWar: calculateWar(c.fip, c.ip, alt.replFip, runsPerWin),
            altDiff: 0
        }));
        altComps.forEach(c => c.altDiff = c.altWar - c.ootpWar);

        const altStats = getStats(altComps.map(c => c.altWar));
        const altDiffStats = getStats(altComps.map(c => c.altDiff));

        console.log(`\n${alt.name} (replFip = ${alt.replFip.toFixed(2)}):`);
        console.log(`  Our Mean: ${altStats.mean.toFixed(2)} (OOTP: ${ootpStats.mean.toFixed(2)}, diff: ${(altStats.mean - ootpStats.mean).toFixed(2)})`);
        console.log(`  Our StdDev: ${altStats.stdDev.toFixed(2)} (OOTP: ${ootpStats.stdDev.toFixed(2)}, diff: ${(altStats.stdDev - ootpStats.stdDev).toFixed(2)})`);
        console.log(`  Avg Error: ${altDiffStats.mean.toFixed(3)}`);
        console.log(`  MAE: ${(altComps.reduce((sum, c) => sum + Math.abs(c.altDiff), 0) / altComps.length).toFixed(3)}`);
    });

    // Summary
    console.log('\n=== Summary ===');
    if (Math.abs(diffStats.mean) > 0.1) {
        if (diffStats.mean > 0) {
            console.log(`⚠️  Our formula is OVER-ESTIMATING WAR by ${diffStats.mean.toFixed(2)} on average`);
            console.log(`    → Replacement level may be too high (currently ${replacementFip.toFixed(2)})`);
        } else {
            console.log(`⚠️  Our formula is UNDER-ESTIMATING WAR by ${Math.abs(diffStats.mean).toFixed(2)} on average`);
            console.log(`    → Replacement level may be too low (currently ${replacementFip.toFixed(2)})`);
        }
    } else {
        console.log(`✓ Our formula is well-calibrated (mean difference: ${diffStats.mean.toFixed(2)})`);
    }

    if (calcStats.stdDev < ootpStats.stdDev * 0.8) {
        console.log(`⚠️  Our distribution is TOO NARROW (σ = ${calcStats.stdDev.toFixed(2)} vs OOTP's ${ootpStats.stdDev.toFixed(2)})`);
        console.log(`    → Formula may be compressing WAR towards 0`);
    } else if (calcStats.stdDev > ootpStats.stdDev * 1.2) {
        console.log(`⚠️  Our distribution is TOO WIDE (σ = ${calcStats.stdDev.toFixed(2)} vs OOTP's ${ootpStats.stdDev.toFixed(2)})`);
    } else {
        console.log(`✓ Our distribution width is similar to OOTP (σ = ${calcStats.stdDev.toFixed(2)} vs ${ootpStats.stdDev.toFixed(2)})`);
    }

    console.log(`\nRecommended replacement FIP: ${ootpMatchedReplFip.toFixed(2)} (avgFip + ${(ootpMatchedReplFip - avgFip).toFixed(2)})`);
}

// Run the test
runWarCalibrationTest().catch(console.error);
