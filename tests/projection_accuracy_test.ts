/**
 * Projection Accuracy Test
 *
 * Compares our projected top 5 WAR pattern (e.g., 5.1, 4.6, 4.2, 3.7, 3.5)
 * against actual top 5 WAR from past years to quantify accuracy.
 *
 * USAGE: npx tsx tests/projection_accuracy_test.ts
 */

const API_BASE = 'https://atl-01.statsplus.net/world/api';

interface PitcherStats {
    player_id: number;
    year: number;
    ip: string;
    k: number;
    bb: number;
    hra: number;
    er: number;
    war: number;
    gs: number;
}

async function fetchPitchingStats(year: number): Promise<Map<number, PitcherStats>> {
    const url = `${API_BASE}/playerpitchstatsv2/?year=${year}`;
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
        er: headers.indexOf('er'),
        war: headers.indexOf('war'),
        gs: headers.indexOf('gs')
    };

    const playerMap = new Map<number, PitcherStats>();

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const split_id = parseInt(values[indices.split_id]);

        if (split_id !== 1) continue;

        const playerId = parseInt(values[indices.player_id]);
        const ip = parseIp(values[indices.ip]);
        const k = parseInt(values[indices.k]);
        const bb = parseInt(values[indices.bb]);
        const hra = parseInt(values[indices.hra]);
        const er = parseInt(values[indices.er]);
        const war = parseFloat(values[indices.war]);
        const gs = parseInt(values[indices.gs]);

        const existing = playerMap.get(playerId);
        if (!existing) {
            playerMap.set(playerId, {
                player_id: playerId,
                year: parseInt(values[indices.year]),
                ip: String(ip),
                k, bb, hra, er, war, gs
            });
        } else {
            const existingIp = parseIp(existing.ip);
            existing.ip = String(existingIp + ip);
            existing.k += k;
            existing.bb += bb;
            existing.hra += hra;
            existing.er += er;
            existing.war += war;
            existing.gs += gs;
        }
    }

    return playerMap;
}

function parseIp(ip: string | number): number {
    const ipAsString = String(ip);
    const parts = ipAsString.split('.');
    const fullInnings = parseInt(parts[0], 10);
    const partialInnings = parts.length > 1 ? parseInt(parts[1], 10) : 0;
    return fullInnings + (partialInnings / 3);
}

async function runAccuracyTest() {
    console.log('=== Projection Accuracy Test ===');
    console.log('Comparing our projected top 5 WAR pattern vs actual history\n');

    // Our projected 2021 top 5 (based on 203-198 IP, 3.29-3.86 FIP)
    // Using replacementFip = avgFip + 1.00
    const ourProjectedTop5 = [5.1, 4.6, 4.2, 3.7, 3.5];

    console.log('Our Projected Top 5 WAR Pattern:');
    ourProjectedTop5.forEach((war, idx) => {
        console.log(`  #${idx + 1}: ${war.toFixed(1)} WAR`);
    });
    console.log('');

    // Fetch actual top 5 from past 3 years
    const years = [2018, 2019, 2020];
    const allActualTop5: Array<{ year: number; rank: number; war: number }> = [];

    for (const year of years) {
        console.log(`\n=== ${year} Actual Top 5 ===`);
        const stats = await fetchPitchingStats(year);

        const qualified = Array.from(stats.values())
            .filter(p => parseIp(p.ip) >= 50)
            .sort((a, b) => b.war - a.war)
            .slice(0, 5);

        qualified.forEach((p, idx) => {
            console.log(`  #${idx + 1}: ${p.war.toFixed(1)} WAR (Player ${p.player_id}, ${parseIp(p.ip).toFixed(0)} IP)`);
            allActualTop5.push({
                year,
                rank: idx + 1,
                war: p.war
            });
        });
    }

    // Calculate error metrics
    console.log('\n\n=== Error Analysis ===\n');

    // Group by rank position
    const errorsByRank: Array<{ rank: number; errors: number[] }> = [];
    for (let rank = 1; rank <= 5; rank++) {
        const actualAtRank = allActualTop5.filter(a => a.rank === rank);
        const projectedAtRank = ourProjectedTop5[rank - 1];
        const errors = actualAtRank.map(a => projectedAtRank - a.war);

        errorsByRank.push({ rank, errors });

        const meanError = errors.reduce((sum, e) => sum + e, 0) / errors.length;
        const mae = errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length;
        const variance = errors.reduce((sum, e) => sum + Math.pow(e - meanError, 2), 0) / errors.length;
        const stdDev = Math.sqrt(variance);

        console.log(`Rank #${rank} (projected ${projectedAtRank.toFixed(1)} WAR):`);
        console.log(`  Actual values: ${actualAtRank.map(a => a.war.toFixed(1)).join(', ')}`);
        console.log(`  Mean Error: ${meanError.toFixed(2)} WAR (${meanError > 0 ? 'over-estimate' : 'under-estimate'})`);
        console.log(`  MAE: ${mae.toFixed(2)} WAR`);
        console.log(`  Std Dev: ${stdDev.toFixed(2)} WAR`);
        console.log('');
    }

    // Overall metrics
    const allErrors = allActualTop5.map((a, idx) => {
        const projectedWar = ourProjectedTop5[a.rank - 1];
        return projectedWar - a.war;
    });

    const overallMeanError = allErrors.reduce((sum, e) => sum + e, 0) / allErrors.length;
    const overallMAE = allErrors.reduce((sum, e) => sum + Math.abs(e), 0) / allErrors.length;
    const overallVariance = allErrors.reduce((sum, e) => sum + Math.pow(e - overallMeanError, 2), 0) / allErrors.length;
    const overallStdDev = Math.sqrt(overallVariance);
    const rmse = Math.sqrt(allErrors.reduce((sum, e) => sum + e * e, 0) / allErrors.length);

    console.log('=== Overall Metrics (15 data points) ===');
    console.log(`Mean Error: ${overallMeanError.toFixed(2)} WAR`);
    console.log(`MAE: ${overallMAE.toFixed(2)} WAR`);
    console.log(`RMSE: ${rmse.toFixed(2)} WAR`);
    console.log(`Std Dev: ${overallStdDev.toFixed(2)} WAR`);
    console.log('');

    // Calculate what percentage of errors are within 1 WAR
    const within1War = allErrors.filter(e => Math.abs(e) <= 1.0).length;
    const within2War = allErrors.filter(e => Math.abs(e) <= 2.0).length;

    console.log(`Errors within ±1 WAR: ${within1War}/15 (${(within1War / 15 * 100).toFixed(0)}%)`);
    console.log(`Errors within ±2 WAR: ${within2War}/15 (${(within2War / 15 * 100).toFixed(0)}%)`);
    console.log('');

    // Show individual errors
    console.log('\n=== Individual Comparisons ===\n');
    for (const year of years) {
        console.log(`${year}:`);
        const yearData = allActualTop5.filter(a => a.year === year);
        yearData.forEach(a => {
            const projected = ourProjectedTop5[a.rank - 1];
            const error = projected - a.war;
            console.log(`  #${a.rank}: Actual ${a.war.toFixed(1)}, Projected ${projected.toFixed(1)}, Error ${error >= 0 ? '+' : ''}${error.toFixed(1)}`);
        });
        console.log('');
    }

    // Summary
    console.log('\n=== Summary ===');
    if (Math.abs(overallMeanError) <= 0.5) {
        console.log(`✓ Projections are well-calibrated (mean error: ${overallMeanError.toFixed(2)} WAR)`);
    } else if (overallMeanError < -0.5) {
        console.log(`⚠️  Projections UNDER-ESTIMATE by ${Math.abs(overallMeanError).toFixed(2)} WAR on average`);
        console.log(`   → Top pitchers are being projected too conservatively`);
    } else {
        console.log(`⚠️  Projections OVER-ESTIMATE by ${overallMeanError.toFixed(2)} WAR on average`);
        console.log(`   → Top pitchers are being projected too optimistically`);
    }

    console.log(`\nTypical error: ±${rmse.toFixed(2)} WAR (RMSE)`);

    if (rmse < 1.0) {
        console.log(`✓ Excellent accuracy (RMSE < 1.0)`);
    } else if (rmse < 1.5) {
        console.log(`✓ Good accuracy (RMSE < 1.5)`);
    } else if (rmse < 2.0) {
        console.log(`~ Moderate accuracy (RMSE < 2.0)`);
    } else {
        console.log(`⚠️  Poor accuracy (RMSE >= 2.0)`);
    }
}

runAccuracyTest().catch(console.error);
