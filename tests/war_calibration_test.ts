/**
 * WAR Calibration Test
 *
 * Compares OOTP's actual WAR values from 2020 season data
 * against what our formula would calculate using the same stats.
 *
 * This helps us identify if our WAR formula is properly calibrated
 * or if it's too generous/harsh compared to OOTP's baseline.
 *
 * USAGE: This test needs to run in a browser environment (uses IndexedDB)
 * 1. Start dev server: npm run dev
 * 2. Open browser console at http://localhost:5173
 * 3. Copy/paste the test code from war_calibration_browser.html
 *
 * OR use the standalone Node.js version below (calculates directly from CSV/API data)
 */

import { fipWarService } from '../src/services/FipWarService';

interface WARComparison {
    playerId: number;
    name: string;
    ip: number;
    k9: number;
    bb9: number;
    hr9: number;
    fip: number;
    ootpWar: number;      // WAR from OOTP export
    calculatedWar: number; // WAR from our formula
    difference: number;    // calculatedWar - ootpWar
    fipPercentile: number; // Lower is worse
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

async function runWarCalibrationTest() {
    console.log('=== WAR Calibration Test ===\n');
    console.log('Comparing OOTP 2020 actual WAR vs our formula\n');

    // Get 2020 pitching stats and league context
    const year = 2020;
    const pitchers = await trueRatingsService.getTruePitchingStats(year);
    const leagueStats = await leagueStatsService.getLeagueStats(year);

    console.log(`League Stats for ${year}:`);
    console.log(`  ERA: ${leagueStats.era.toFixed(2)}`);
    console.log(`  Avg FIP: ${leagueStats.avgFip.toFixed(2)}`);
    console.log(`  FIP Constant: ${leagueStats.fipConstant.toFixed(2)}`);
    console.log(`  Replacement FIP: ${leagueStats.replacementFip.toFixed(2)}\n`);

    // Filter to pitchers with meaningful IP (50+ to avoid noise)
    const minIp = 50;
    const qualifiedPitchers = pitchers.filter(p => {
        const ip = trueRatingsService.parseIp(p.ip);
        return ip >= minIp && p.war != null && !isNaN(p.war);
    });

    console.log(`Qualified pitchers (${minIp}+ IP): ${qualifiedPitchers.length}\n`);

    // Calculate WAR using our formula
    const comparisons: WARComparison[] = qualifiedPitchers.map(p => {
        const ip = trueRatingsService.parseIp(p.ip);
        const k9 = (p.k / ip) * 9;
        const bb9 = (p.bb / ip) * 9;
        const hr9 = (p.hra / ip) * 9; // 'hra' is home runs allowed in API

        // Calculate FIP using league constant
        const fip = fipWarService.calculateFip(
            { ip, k9, bb9, hr9 },
            leagueStats.fipConstant
        );

        // Calculate WAR using our formula with league context
        // This matches what PotentialStatsService does
        const runsPerWin = 8.5;
        const replacementFip = leagueStats.avgFip + (0.12 * runsPerWin);
        const calculatedWar = fipWarService.calculateWar(
            fip,
            ip,
            replacementFip,
            runsPerWin
        );

        return {
            playerId: p.player_id,
            name: p.player_name,
            ip,
            k9,
            bb9,
            hr9,
            fip,
            ootpWar: p.war,
            calculatedWar,
            difference: calculatedWar - p.war,
            fipPercentile: 0 // Will calculate below
        };
    });

    // Calculate FIP percentiles (lower FIP = higher percentile = better)
    const sortedByFip = [...comparisons].sort((a, b) => a.fip - b.fip);
    comparisons.forEach(comp => {
        const rank = sortedByFip.findIndex(p => p.playerId === comp.playerId) + 1;
        comp.fipPercentile = ((comparisons.length - rank + 1) / comparisons.length) * 100;
    });

    // Calculate statistics
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

        console.log(`\n${tier.name} (n=${tierPitchers.length})`);
        console.log(`  OOTP WAR:   ${avgOotpWar.toFixed(2)}`);
        console.log(`  Our WAR:    ${avgCalcWar.toFixed(2)}`);
        console.log(`  Difference: ${avgDiff >= 0 ? '+' : ''}${avgDiff.toFixed(2)}`);

        // Show example pitchers
        const examples = tierPitchers.slice(0, 3);
        examples.forEach(p => {
            console.log(`    ${p.name}: FIP ${p.fip.toFixed(2)}, OOTP ${p.ootpWar.toFixed(1)}, Ours ${p.calculatedWar.toFixed(1)} (${p.difference >= 0 ? '+' : ''}${p.difference.toFixed(1)})`);
        });
    });

    // Find worst offenders (biggest differences)
    console.log('\n=== Biggest Over-Estimations (Our WAR too high) ===');
    const overEstimated = [...comparisons].sort((a, b) => b.difference - a.difference).slice(0, 10);
    overEstimated.forEach(p => {
        console.log(`  ${p.name}: FIP ${p.fip.toFixed(2)} (${p.fipPercentile.toFixed(0)}%), IP ${p.ip.toFixed(0)}, OOTP ${p.ootpWar.toFixed(1)}, Ours ${p.calculatedWar.toFixed(1)} (+${p.difference.toFixed(1)})`);
    });

    console.log('\n=== Biggest Under-Estimations (Our WAR too low) ===');
    const underEstimated = [...comparisons].sort((a, b) => a.difference - b.difference).slice(0, 10);
    underEstimated.forEach(p => {
        console.log(`  ${p.name}: FIP ${p.fip.toFixed(2)} (${p.fipPercentile.toFixed(0)}%), IP ${p.ip.toFixed(0)}, OOTP ${p.ootpWar.toFixed(1)}, Ours ${p.calculatedWar.toFixed(1)} (${p.difference.toFixed(1)})`);
    });

    // Check correlation
    const correlation = calculateCorrelation(
        comparisons.map(c => c.ootpWar),
        comparisons.map(c => c.calculatedWar)
    );
    console.log(`\n=== Correlation ===`);
    console.log(`R² between OOTP and Our WAR: ${correlation.toFixed(3)}`);

    // Summary
    console.log('\n=== Summary ===');
    if (Math.abs(diffStats.mean) > 0.1) {
        if (diffStats.mean > 0) {
            console.log(`⚠️  Our formula is OVER-ESTIMATING WAR by ${diffStats.mean.toFixed(2)} on average`);
            console.log(`    → Replacement level may be too high (currently ${(leagueStats.avgFip + 1.02).toFixed(2)})`);
        } else {
            console.log(`⚠️  Our formula is UNDER-ESTIMATING WAR by ${Math.abs(diffStats.mean).toFixed(2)} on average`);
            console.log(`    → Replacement level may be too low (currently ${(leagueStats.avgFip + 1.02).toFixed(2)})`);
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

// Run the test
runWarCalibrationTest().catch(console.error);
