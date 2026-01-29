/**
 * True Ratings Regression Optimizer
 *
 * Finds optimal regression parameters (target and strength) for each
 * performance quartile to minimize FIP projection error.
 *
 * Strategy:
 * - Divide pitchers into quartiles by their ACTUAL next-year FIP
 * - For each quartile, test different regression targets and strengths
 * - Find the combination that minimizes MAE
 *
 * USAGE: npx tsx tests/regression_optimizer.ts
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
    gs: number;
}

interface RegressionParams {
    targetOffset: number;  // Offset from league avg (e.g., 0.0 = lgAvg, 1.0 = lgAvg+1.0)
    strengthMultiplier: number;  // Multiplier on stabilization constant (1.0 = normal)
}

interface QuartileResult {
    quartile: number;
    actualFipRange: [number, number];
    bestParams: RegressionParams;
    bestMAE: number;
    sampleSize: number;
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
        gs: headers.indexOf('gs')
    };

    const playerMap = new Map<number, PitcherStats>();

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const split_id = parseInt(values[indices.split_id]);
        if (split_id !== 1) continue;

        const playerId = parseInt(values[indices.player_id]);
        const ip = parseIp(values[indices.ip]);

        const existing = playerMap.get(playerId);
        if (!existing) {
            playerMap.set(playerId, {
                player_id: playerId,
                year: parseInt(values[indices.year]),
                ip: String(ip),
                k: parseInt(values[indices.k]),
                bb: parseInt(values[indices.bb]),
                hra: parseInt(values[indices.hra]),
                er: parseInt(values[indices.er]),
                gs: parseInt(values[indices.gs])
            });
        } else {
            const existingIp = parseIp(existing.ip);
            existing.ip = String(existingIp + ip);
            existing.k += parseInt(values[indices.k]);
            existing.bb += parseInt(values[indices.bb]);
            existing.hra += parseInt(values[indices.hra]);
            existing.er += parseInt(values[indices.er]);
            existing.gs += parseInt(values[indices.gs]);
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

// Simulate True Ratings regression logic
function regressStat(
    rawStat: number,
    totalIp: number,
    targetStat: number,
    stabilizationK: number,
    strengthMultiplier: number
): number {
    const adjustedK = stabilizationK * strengthMultiplier;
    return (rawStat * totalIp + targetStat * adjustedK) / (totalIp + adjustedK);
}

async function optimizeQuartile(
    quartileData: Array<{ baseK9: number; baseBb9: number; baseHr9: number; baseIp: number; actualFip: number }>,
    leagueAvgK9: number,
    leagueAvgBb9: number,
    leagueAvgHr9: number,
    fipConstant: number
): Promise<{ params: RegressionParams; mae: number }> {
    // Grid search over parameter space
    const targetOffsets = [-0.5, -0.3, -0.1, 0.0, 0.1, 0.3, 0.5, 0.7, 1.0, 1.3, 1.5]; // Offset from league avg FIP
    const strengthMultipliers = [0.3, 0.5, 0.7, 1.0, 1.3, 1.5, 2.0]; // Multiplier on stabilization K

    let bestMAE = Infinity;
    let bestParams: RegressionParams = { targetOffset: 0.0, strengthMultiplier: 1.0 };

    const stabilization = { k9: 50, bb9: 40, hr9: 70 };
    const leagueAvgFip = calculateFip(leagueAvgK9, leagueAvgBb9, leagueAvgHr9, fipConstant);

    for (const targetOffset of targetOffsets) {
        for (const strengthMult of strengthMultipliers) {
            // Calculate MAE for this parameter combination
            let totalError = 0;

            for (const pitcher of quartileData) {
                // Calculate regression targets based on offset
                // targetOffset = 0 means regress to league avg
                // targetOffset > 0 means regress toward worse (higher FIP)
                // We need to convert FIP offset to K9/BB9/HR9 targets

                // For simplicity, apply offset proportionally to each component
                const targetK9 = leagueAvgK9 - (targetOffset * 0.5); // Lower K9 = worse
                const targetBb9 = leagueAvgBb9 + (targetOffset * 0.3); // Higher BB9 = worse
                const targetHr9 = leagueAvgHr9 + (targetOffset * 0.1); // Higher HR9 = worse

                const regressedK9 = regressStat(pitcher.baseK9, pitcher.baseIp, targetK9, stabilization.k9, strengthMult);
                const regressedBb9 = regressStat(pitcher.baseBb9, pitcher.baseIp, targetBb9, stabilization.bb9, strengthMult);
                const regressedHr9 = regressStat(pitcher.baseHr9, pitcher.baseIp, targetHr9, stabilization.hr9, strengthMult);

                const projectedFip = calculateFip(regressedK9, regressedBb9, regressedHr9, fipConstant);
                const error = Math.abs(projectedFip - pitcher.actualFip);
                totalError += error;
            }

            const mae = totalError / quartileData.length;

            if (mae < bestMAE) {
                bestMAE = mae;
                bestParams = { targetOffset, strengthMultiplier: strengthMult };
            }
        }
    }

    return { params: bestParams, mae: bestMAE };
}

async function runOptimization() {
    console.log('=== True Ratings Regression Optimizer ===\n');
    console.log('Finding optimal regression parameters for each performance quartile\n');

    const projectionPairs = [
        { projYear: 2018, baseYear: 2017 },
        { projYear: 2019, baseYear: 2018 },
        { projYear: 2020, baseYear: 2019 }
    ];

    // Collect all projection data
    interface ProjectionData {
        baseK9: number;
        baseBb9: number;
        baseHr9: number;
        baseIp: number;
        actualFip: number;
        leagueAvgK9: number;
        leagueAvgBb9: number;
        leagueAvgHr9: number;
        fipConstant: number;
    }

    const allData: ProjectionData[] = [];

    for (const pair of projectionPairs) {
        console.log(`Loading ${pair.baseYear} → ${pair.projYear}...`);

        const [baseStats, projStats] = await Promise.all([
            fetchPitchingStats(pair.baseYear),
            fetchPitchingStats(pair.projYear)
        ]);

        // Calculate league averages for projection year
        let totalK = 0, totalBb = 0, totalHr = 0, totalIp = 0, totalEr = 0, totalOuts = 0;
        projStats.forEach(p => {
            const ip = parseIp(p.ip);
            totalK += p.k;
            totalBb += p.bb;
            totalHr += p.hra;
            totalEr += p.er;
            totalOuts += ip * 3;
        });
        totalIp = totalOuts / 3;
        const leagueAvgK9 = (totalK / totalIp) * 9;
        const leagueAvgBb9 = (totalBb / totalIp) * 9;
        const leagueAvgHr9 = (totalHr / totalIp) * 9;
        const leagueEra = (totalEr * 9) / totalIp;
        const rawFipComponent = ((13 * totalHr) + (3 * totalBb) - (2 * totalK)) / totalIp;
        const fipConstant = leagueEra - rawFipComponent;

        // Collect pitcher pairs
        projStats.forEach(p => {
            const actualIp = parseIp(p.ip);
            if (actualIp < 50) return;

            const baseP = baseStats.get(p.player_id);
            if (!baseP) return;

            const baseIp = parseIp(baseP.ip);
            if (baseIp < 20) return;

            const baseK9 = (baseP.k / baseIp) * 9;
            const baseBb9 = (baseP.bb / baseIp) * 9;
            const baseHr9 = (baseP.hra / baseIp) * 9;

            const actualK9 = (p.k / actualIp) * 9;
            const actualBb9 = (p.bb / actualIp) * 9;
            const actualHr9 = (p.hra / actualIp) * 9;
            const actualFip = calculateFip(actualK9, actualBb9, actualHr9, fipConstant);

            allData.push({
                baseK9, baseBb9, baseHr9, baseIp, actualFip,
                leagueAvgK9, leagueAvgBb9, leagueAvgHr9, fipConstant
            });
        });
    }

    console.log(`\nTotal projection samples: ${allData.length}\n`);

    // Sort by actual FIP and divide into quartiles
    const sortedByActual = [...allData].sort((a, b) => a.actualFip - b.actualFip);
    const quartileSize = Math.floor(sortedByActual.length / 4);

    const quartiles = [
        { name: 'Q1 (Elite)', data: sortedByActual.slice(0, quartileSize) },
        { name: 'Q2 (Good)', data: sortedByActual.slice(quartileSize, quartileSize * 2) },
        { name: 'Q3 (Average)', data: sortedByActual.slice(quartileSize * 2, quartileSize * 3) },
        { name: 'Q4 (Below Avg)', data: sortedByActual.slice(quartileSize * 3) }
    ];

    console.log('=== Optimizing Each Quartile ===\n');

    const results: QuartileResult[] = [];

    for (let i = 0; i < quartiles.length; i++) {
        const q = quartiles[i];
        const minFip = Math.min(...q.data.map(d => d.actualFip));
        const maxFip = Math.max(...q.data.map(d => d.actualFip));

        console.log(`${q.name} (FIP: ${minFip.toFixed(2)} - ${maxFip.toFixed(2)})`);
        console.log(`  Sample size: ${q.data.length}`);
        console.log(`  Optimizing...`);

        // Use average league stats across all years
        const avgLeagueK9 = q.data.reduce((sum, d) => sum + d.leagueAvgK9, 0) / q.data.length;
        const avgLeagueBb9 = q.data.reduce((sum, d) => sum + d.leagueAvgBb9, 0) / q.data.length;
        const avgLeagueHr9 = q.data.reduce((sum, d) => sum + d.leagueAvgHr9, 0) / q.data.length;
        const avgFipConstant = q.data.reduce((sum, d) => sum + d.fipConstant, 0) / q.data.length;

        const { params, mae } = await optimizeQuartile(q.data, avgLeagueK9, avgLeagueBb9, avgLeagueHr9, avgFipConstant);

        console.log(`  ✓ Best MAE: ${mae.toFixed(3)}`);
        console.log(`  Best Params: targetOffset=${params.targetOffset.toFixed(2)}, strengthMult=${params.strengthMultiplier.toFixed(2)}\n`);

        results.push({
            quartile: i + 1,
            actualFipRange: [minFip, maxFip],
            bestParams: params,
            bestMAE: mae,
            sampleSize: q.data.length
        });
    }

    // Generate code
    console.log('\n=== Optimized Regression Parameters ===\n');

    console.log('```typescript');
    console.log('// Quartile-based regression parameters (optimized from 2017-2020 data)');
    console.log('interface QuartileRegressionParams {');
    console.log('  fipThreshold: number;  // Upper bound of FIP for this quartile');
    console.log('  targetOffset: number;  // Offset from league avg (lower = less regression)');
    console.log('  strengthMultiplier: number;  // Multiplier on stabilization constant');
    console.log('}');
    console.log('');
    console.log('const QUARTILE_REGRESSION_PARAMS: QuartileRegressionParams[] = [');
    results.forEach((r, idx) => {
        const fipThreshold = idx < results.length - 1 ? r.actualFipRange[1] : 999;
        console.log(`  { fipThreshold: ${fipThreshold.toFixed(2)}, targetOffset: ${r.bestParams.targetOffset.toFixed(2)}, strengthMultiplier: ${r.bestParams.strengthMultiplier.toFixed(2)} }, // Q${r.quartile} (Elite → Below Avg)`);
    });
    console.log('];');
    console.log('```');

    console.log('\n=== Performance Comparison ===\n');

    results.forEach(r => {
        console.log(`Q${r.quartile} (FIP: ${r.actualFipRange[0].toFixed(2)} - ${r.actualFipRange[1].toFixed(2)}): MAE ${r.bestMAE.toFixed(3)}`);
    });

    const overallMAE = results.reduce((sum, r) => sum + r.bestMAE * r.sampleSize, 0) / allData.length;
    console.log(`\nWeighted Overall MAE: ${overallMAE.toFixed(3)}`);

    console.log('\n=== Next Steps ===');
    console.log('1. Copy the generated code above into TrueRatingsCalculationService.ts');
    console.log('2. Update regressToLeagueMean() to use quartile-based params instead of FIP-based tiers');
    console.log('3. Test projections to verify elite pitchers are no longer over-projected');
}

runOptimization().catch(console.error);
