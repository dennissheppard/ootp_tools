/**
 * FIP Projection Analysis by Performance Tier
 *
 * Breaks down FIP projection accuracy by actual FIP performance tier
 * to see if elite pitchers (low FIP) are being under-projected.
 *
 * This test projects 2018, 2019, 2020 from prior year data and analyzes
 * by FIP quartile to find systematic biases.
 *
 * USAGE: npx tsx tests/fip_tier_analysis.ts
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

function calculateFip(k9: number, bb9: number, hr9: number, fipConstant: number = 3.47): number {
    return ((13 * hr9) + (3 * bb9) - (2 * k9)) / 9 + fipConstant;
}

// Simple projection: use prior year performance (no aging, no regression)
// This isolates whether the issue is in aging/regression logic
function projectFipSimple(priorK9: number, priorBb9: number, priorHr9: number, fipConstant: number): number {
    return calculateFip(priorK9, priorBb9, priorHr9, fipConstant);
}

async function runTierAnalysis() {
    console.log('=== FIP Projection Analysis by Performance Tier ===\n');
    console.log('Analyzing 2018, 2019, 2020 projections from prior year\n');

    const projectionPairs = [
        { projYear: 2018, baseYear: 2017 },
        { projYear: 2019, baseYear: 2018 },
        { projYear: 2020, baseYear: 2019 }
    ];

    const allComparisons: Array<{
        year: number;
        playerId: number;
        actualFip: number;
        projectedFip: number;
        error: number;
        actualIp: number;
    }> = [];

    for (const pair of projectionPairs) {
        console.log(`\n=== Projecting ${pair.projYear} from ${pair.baseYear} ===\n`);

        const [baseStats, projStats] = await Promise.all([
            fetchPitchingStats(pair.baseYear),
            fetchPitchingStats(pair.projYear)
        ]);

        // Calculate league FIP constant for projection year
        let totalEr = 0, totalOuts = 0, totalK = 0, totalBb = 0, totalHr = 0;
        projStats.forEach(p => {
            totalEr += p.er;
            totalOuts += parseIp(p.ip) * 3;
            totalK += p.k;
            totalBb += p.bb;
            totalHr += p.hra;
        });
        const totalIp = totalOuts / 3;
        const leagueEra = (totalEr * 9) / totalIp;
        const rawFipComponent = ((13 * totalHr) + (3 * totalBb) - (2 * totalK)) / totalIp;
        const fipConstant = leagueEra - rawFipComponent;

        console.log(`League FIP constant: ${fipConstant.toFixed(2)}\n`);

        // For each pitcher in projection year, try to project from base year
        projStats.forEach(p => {
            const actualIp = parseIp(p.ip);

            // Only include pitchers with meaningful IP
            if (actualIp < 50) return;

            const baseP = baseStats.get(p.player_id);
            if (!baseP) return; // New pitcher, can't project

            const baseIp = parseIp(baseP.ip);
            if (baseIp < 20) return; // Not enough base data

            // Calculate actual FIP
            const actualK9 = (p.k / actualIp) * 9;
            const actualBb9 = (p.bb / actualIp) * 9;
            const actualHr9 = (p.hra / actualIp) * 9;
            const actualFip = calculateFip(actualK9, actualBb9, actualHr9, fipConstant);

            // Simple projection from base year (no regression)
            const baseK9 = (baseP.k / baseIp) * 9;
            const baseBb9 = (baseP.bb / baseIp) * 9;
            const baseHr9 = (baseP.hra / baseIp) * 9;
            const projectedFip = projectFipSimple(baseK9, baseBb9, baseHr9, fipConstant);

            const error = projectedFip - actualFip;

            allComparisons.push({
                year: pair.projYear,
                playerId: p.player_id,
                actualFip,
                projectedFip,
                error,
                actualIp
            });
        });
    }

    console.log(`\nTotal projections: ${allComparisons.length}\n`);

    // Sort by actual FIP and divide into quartiles
    const sortedByActual = [...allComparisons].sort((a, b) => a.actualFip - b.actualFip);

    const q1Cutoff = sortedByActual[Math.floor(sortedByActual.length * 0.25)].actualFip;
    const q2Cutoff = sortedByActual[Math.floor(sortedByActual.length * 0.50)].actualFip;
    const q3Cutoff = sortedByActual[Math.floor(sortedByActual.length * 0.75)].actualFip;

    console.log('=== Quartile Cutoffs (Actual FIP) ===');
    console.log(`Q1 (Elite):      FIP < ${q1Cutoff.toFixed(2)}`);
    console.log(`Q2 (Good):       ${q1Cutoff.toFixed(2)} ≤ FIP < ${q2Cutoff.toFixed(2)}`);
    console.log(`Q3 (Average):    ${q2Cutoff.toFixed(2)} ≤ FIP < ${q3Cutoff.toFixed(2)}`);
    console.log(`Q4 (Below Avg):  FIP ≥ ${q3Cutoff.toFixed(2)}`);
    console.log('');

    // Analyze each quartile
    const quartiles = [
        { name: 'Q1 (Elite)', data: allComparisons.filter(c => c.actualFip < q1Cutoff) },
        { name: 'Q2 (Good)', data: allComparisons.filter(c => c.actualFip >= q1Cutoff && c.actualFip < q2Cutoff) },
        { name: 'Q3 (Average)', data: allComparisons.filter(c => c.actualFip >= q2Cutoff && c.actualFip < q3Cutoff) },
        { name: 'Q4 (Below Avg)', data: allComparisons.filter(c => c.actualFip >= q3Cutoff) }
    ];

    console.log('=== Analysis by Quartile ===\n');

    quartiles.forEach(q => {
        const avgActual = q.data.reduce((sum, c) => sum + c.actualFip, 0) / q.data.length;
        const avgProjected = q.data.reduce((sum, c) => sum + c.projectedFip, 0) / q.data.length;
        const meanError = q.data.reduce((sum, c) => sum + c.error, 0) / q.data.length;
        const mae = q.data.reduce((sum, c) => sum + Math.abs(c.error), 0) / q.data.length;
        const variance = q.data.reduce((sum, c) => sum + Math.pow(c.error - meanError, 2), 0) / q.data.length;
        const stdDev = Math.sqrt(variance);
        const rmse = Math.sqrt(q.data.reduce((sum, c) => sum + c.error * c.error, 0) / q.data.length);

        console.log(`${q.name} (n=${q.data.length}):`);
        console.log(`  Avg Actual FIP:    ${avgActual.toFixed(2)}`);
        console.log(`  Avg Projected FIP: ${avgProjected.toFixed(2)}`);
        console.log(`  Mean Error:        ${meanError >= 0 ? '+' : ''}${meanError.toFixed(3)} (${meanError > 0 ? 'over-proj' : 'under-proj'})`);
        console.log(`  MAE:               ${mae.toFixed(3)}`);
        console.log(`  RMSE:              ${rmse.toFixed(3)}`);
        console.log(`  Std Dev:           ${stdDev.toFixed(3)}`);
        console.log('');
    });

    // Overall metrics
    const overallMeanError = allComparisons.reduce((sum, c) => sum + c.error, 0) / allComparisons.length;
    const overallMAE = allComparisons.reduce((sum, c) => sum + Math.abs(c.error), 0) / allComparisons.length;
    const overallRMSE = Math.sqrt(allComparisons.reduce((sum, c) => sum + c.error * c.error, 0) / allComparisons.length);

    console.log('=== Overall ===');
    console.log(`Mean Error: ${overallMeanError >= 0 ? '+' : ''}${overallMeanError.toFixed(3)}`);
    console.log(`MAE: ${overallMAE.toFixed(3)}`);
    console.log(`RMSE: ${overallRMSE.toFixed(3)}`);
    console.log('');

    // Top 20 analysis (most relevant for WAR leaders)
    console.log('\n=== Top 20 Elite Pitchers (Lowest Actual FIP) ===\n');
    const top20 = sortedByActual.slice(0, 20);
    top20.forEach((c, idx) => {
        console.log(`${(idx + 1).toString().padStart(2)}. ${c.year} Player ${c.playerId.toString().padEnd(6)}: Actual ${c.actualFip.toFixed(2)}, Proj ${c.projectedFip.toFixed(2)}, Error ${c.error >= 0 ? '+' : ''}${c.error.toFixed(2)}`);
    });

    const top20MeanError = top20.reduce((sum, c) => sum + c.error, 0) / top20.length;
    const top20MAE = top20.reduce((sum, c) => sum + Math.abs(c.error), 0) / top20.length;

    console.log(`\nTop 20 Mean Error: ${top20MeanError >= 0 ? '+' : ''}${top20MeanError.toFixed(3)}`);
    console.log(`Top 20 MAE: ${top20MAE.toFixed(3)}`);

    // Summary
    console.log('\n\n=== Summary ===');

    const eliteError = quartiles[0].data.reduce((sum, c) => sum + c.error, 0) / quartiles[0].data.length;

    if (Math.abs(eliteError) > 0.2) {
        if (eliteError > 0) {
            console.log(`⚠️  Elite pitchers are OVER-PROJECTED by ${eliteError.toFixed(3)} FIP on average`);
            console.log(`    → Projections are too optimistic for top performers`);
            console.log(`    → This would INFLATE their WAR projections`);
        } else {
            console.log(`⚠️  Elite pitchers are UNDER-PROJECTED by ${Math.abs(eliteError).toFixed(3)} FIP on average`);
            console.log(`    → Projections are too conservative for top performers`);
            console.log(`    → This would DEFLATE their WAR projections ✓ (explains low WAR)`);;
        }
    } else {
        console.log(`✓ Elite pitchers have minimal bias (${eliteError.toFixed(3)} FIP)`);
    }

    console.log('\nNote: This uses SIMPLE projection (prior year stats, no aging/regression)');
    console.log('If elite pitcher bias exists here, it suggests input data issues (e.g., True Ratings');
    console.log('regression crushing elite pitchers). If not, the bias is in aging/projection logic.');
}

runTierAnalysis().catch(console.error);
