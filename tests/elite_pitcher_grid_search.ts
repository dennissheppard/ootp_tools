/**
 * Elite Pitcher Grid Search Optimizer
 *
 * Tests thousands of parameter combinations to find optimal settings for elite pitcher projections.
 *
 * Parameters tested:
 * - Elite FIP regression targetOffset (-1.5 to 0.0)
 * - Elite FIP regression strength (0.3 to 1.5)
 * - Elite IP projection ratio (0.85 to 1.0)
 * - Elite WAR multiplier (1.0 to 1.5)
 *
 * USAGE: npx tsx tests/elite_pitcher_grid_search.ts
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

interface GridSearchParams {
    eliteTargetOffset: number;
    eliteStrengthMultiplier: number;
    eliteIpRatio: number;
    eliteWarMultiplier: number;
}

interface GridSearchResult extends GridSearchParams {
    fipMae: number;
    fipMeanError: number;
    warMae: number;
    warMeanError: number;
    combinedError: number; // Weighted combination
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
                war: parseFloat(values[indices.war]),
                gs: parseInt(values[indices.gs])
            });
        } else {
            const existingIp = parseIp(existing.ip);
            existing.ip = String(existingIp + ip);
            existing.k += parseInt(values[indices.k]);
            existing.bb += parseInt(values[indices.bb]);
            existing.hra += parseInt(values[indices.hra]);
            existing.er += parseInt(values[indices.er]);
            existing.war += parseFloat(values[indices.war]);
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

function calculateWar(fip: number, ip: number, replacementFip: number = 5.20, runsPerWin: number = 8.50): number {
    return ((replacementFip - fip) / runsPerWin) * (ip / 9);
}

const STABILIZATION = { k9: 50, bb9: 40, hr9: 70 };

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

function projectPitcher(
    baseStats: PitcherStats,
    leagueAvgK9: number,
    leagueAvgBb9: number,
    leagueAvgHr9: number,
    fipConstant: number,
    params: GridSearchParams
): { fip: number; war: number } {
    const baseIp = parseIp(baseStats.ip);
    const baseK9 = (baseStats.k / baseIp) * 9;
    const baseBb9 = (baseStats.bb / baseIp) * 9;
    const baseHr9 = (baseStats.hra / baseIp) * 9;

    const { eliteTargetOffset, eliteStrengthMultiplier, eliteIpRatio, eliteWarMultiplier } = params;

    // Calculate regression targets for elite pitchers
    const targetK9 = leagueAvgK9 - (eliteTargetOffset * 0.5);
    const targetBb9 = leagueAvgBb9 + (eliteTargetOffset * 0.3);
    const targetHr9 = leagueAvgHr9 + (eliteTargetOffset * 0.1);

    // Apply regression
    const regressedK9 = regressStat(baseK9, baseIp, targetK9, STABILIZATION.k9, eliteStrengthMultiplier);
    const regressedBb9 = regressStat(baseBb9, baseIp, targetBb9, STABILIZATION.bb9, eliteStrengthMultiplier);
    const regressedHr9 = regressStat(baseHr9, baseIp, targetHr9, STABILIZATION.hr9, eliteStrengthMultiplier);

    const projectedFip = calculateFip(regressedK9, regressedBb9, regressedHr9, fipConstant);

    // Project IP with elite-specific ratio
    const projectedIp = Math.min(Math.max(baseIp * eliteIpRatio, 50), 245);

    // Calculate WAR with elite multiplier
    const baseWar = calculateWar(projectedFip, projectedIp);
    const projectedWar = baseWar * eliteWarMultiplier;

    return { fip: projectedFip, war: projectedWar };
}

async function evaluateParams(
    params: GridSearchParams,
    testData: Array<{
        baseStats: PitcherStats;
        actualFip: number;
        actualWar: number;
        leagueAvgK9: number;
        leagueAvgBb9: number;
        leagueAvgHr9: number;
        fipConstant: number;
    }>
): Promise<{ fipMae: number; fipMeanError: number; warMae: number; warMeanError: number }> {
    let totalFipError = 0;
    let totalWarError = 0;
    let totalAbsFipError = 0;
    let totalAbsWarError = 0;

    for (const test of testData) {
        const projection = projectPitcher(
            test.baseStats,
            test.leagueAvgK9,
            test.leagueAvgBb9,
            test.leagueAvgHr9,
            test.fipConstant,
            params
        );

        const fipError = projection.fip - test.actualFip;
        const warError = projection.war - test.actualWar;

        totalFipError += fipError;
        totalWarError += warError;
        totalAbsFipError += Math.abs(fipError);
        totalAbsWarError += Math.abs(warError);
    }

    return {
        fipMae: totalAbsFipError / testData.length,
        fipMeanError: totalFipError / testData.length,
        warMae: totalAbsWarError / testData.length,
        warMeanError: totalWarError / testData.length
    };
}

async function runGridSearch() {
    console.log('=== Elite Pitcher Grid Search Optimizer ===\n');
    console.log('Loading test data (2018-2020 top 10 pitchers)...\n');

    // Load all test data
    const testData: Array<{
        baseStats: PitcherStats;
        actualFip: number;
        actualWar: number;
        leagueAvgK9: number;
        leagueAvgBb9: number;
        leagueAvgHr9: number;
        fipConstant: number;
    }> = [];

    const projectionYears = [2018, 2019, 2020];

    for (const projYear of projectionYears) {
        const [baseStats, actualStats] = await Promise.all([
            fetchPitchingStats(projYear - 1),
            fetchPitchingStats(projYear)
        ]);

        // Calculate league averages
        let totalK = 0, totalBb = 0, totalHr = 0, totalIp = 0, totalEr = 0, totalOuts = 0;
        actualStats.forEach(p => {
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

        // Get top 10 actual pitchers
        const top10Actual = Array.from(actualStats.values())
            .filter(p => parseIp(p.ip) >= 50)
            .sort((a, b) => b.war - a.war)
            .slice(0, 10);

        for (const actual of top10Actual) {
            const baseP = baseStats.get(actual.player_id);
            if (!baseP || parseIp(baseP.ip) < 20) continue;

            const actualIp = parseIp(actual.ip);
            const actualK9 = (actual.k / actualIp) * 9;
            const actualBb9 = (actual.bb / actualIp) * 9;
            const actualHr9 = (actual.hra / actualIp) * 9;
            const actualFip = calculateFip(actualK9, actualBb9, actualHr9, fipConstant);

            testData.push({
                baseStats: baseP,
                actualFip,
                actualWar: actual.war,
                leagueAvgK9,
                leagueAvgBb9,
                leagueAvgHr9,
                fipConstant
            });
        }
    }

    console.log(`Loaded ${testData.length} test cases\n`);
    console.log('Starting grid search...\n');

    // Define parameter grid
    const eliteTargetOffsets = [-1.5, -1.3, -1.0, -0.8, -0.7, -0.6, -0.5, -0.4, -0.3, -0.2, -0.1, 0.0];
    const eliteStrengthMultipliers = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.5];
    const eliteIpRatios = [0.85, 0.87, 0.90, 0.92, 0.95, 0.97, 1.0];
    const eliteWarMultipliers = [1.0, 1.05, 1.10, 1.15, 1.20, 1.25, 1.30, 1.35, 1.40, 1.45, 1.50];

    const totalCombinations = eliteTargetOffsets.length * eliteStrengthMultipliers.length *
                             eliteIpRatios.length * eliteWarMultipliers.length;

    console.log(`Testing ${totalCombinations.toLocaleString()} parameter combinations\n`);

    const results: GridSearchResult[] = [];
    let tested = 0;
    const startTime = Date.now();

    for (const targetOffset of eliteTargetOffsets) {
        for (const strengthMult of eliteStrengthMultipliers) {
            for (const ipRatio of eliteIpRatios) {
                for (const warMult of eliteWarMultipliers) {
                    const params: GridSearchParams = {
                        eliteTargetOffset: targetOffset,
                        eliteStrengthMultiplier: strengthMult,
                        eliteIpRatio: ipRatio,
                        eliteWarMultiplier: warMult
                    };

                    const metrics = await evaluateParams(params, testData);

                    // Combined error: prioritize WAR accuracy (weight 2x), minimize FIP bias
                    const combinedError = (metrics.warMae * 2.0) + Math.abs(metrics.fipMeanError) * 0.5;

                    results.push({
                        ...params,
                        ...metrics,
                        combinedError
                    });

                    tested++;

                    if (tested % 1000 === 0) {
                        const elapsed = (Date.now() - startTime) / 1000;
                        const rate = tested / elapsed;
                        const remaining = (totalCombinations - tested) / rate;
                        console.log(`Progress: ${tested}/${totalCombinations} (${(tested / totalCombinations * 100).toFixed(1)}%) - ETA: ${Math.round(remaining)}s`);
                    }
                }
            }
        }
    }

    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`\nCompleted ${totalCombinations.toLocaleString()} tests in ${elapsed.toFixed(1)}s\n`);

    // Sort by combined error
    results.sort((a, b) => a.combinedError - b.combinedError);

    console.log('=== Top 10 Parameter Combinations ===\n');

    for (let i = 0; i < 10; i++) {
        const r = results[i];
        console.log(`#${i + 1}: Combined Error = ${r.combinedError.toFixed(3)}`);
        console.log(`  Parameters:`);
        console.log(`    Elite Target Offset:      ${r.eliteTargetOffset.toFixed(2)}`);
        console.log(`    Elite Strength Mult:      ${r.eliteStrengthMultiplier.toFixed(2)}`);
        console.log(`    Elite IP Ratio:           ${r.eliteIpRatio.toFixed(2)}`);
        console.log(`    Elite WAR Multiplier:     ${r.eliteWarMultiplier.toFixed(2)}`);
        console.log(`  Metrics:`);
        console.log(`    FIP MAE:                  ${r.fipMae.toFixed(3)}`);
        console.log(`    FIP Mean Error:           ${r.fipMeanError >= 0 ? '+' : ''}${r.fipMeanError.toFixed(3)}`);
        console.log(`    WAR MAE:                  ${r.warMae.toFixed(3)}`);
        console.log(`    WAR Mean Error:           ${r.warMeanError >= 0 ? '+' : ''}${r.warMeanError.toFixed(3)}`);
        console.log('');
    }

    const best = results[0];

    console.log('\n=== Recommended Parameters (Best Overall) ===\n');
    console.log('```typescript');
    console.log('// Elite pitcher-specific parameters (optimized for top 10 WAR leaders)');
    console.log('const ELITE_PITCHER_PARAMS = {');
    console.log(`  targetOffset: ${best.eliteTargetOffset.toFixed(2)},           // Offset from league avg`);
    console.log(`  strengthMultiplier: ${best.eliteStrengthMultiplier.toFixed(2)},       // Regression strength`);
    console.log(`  ipProjectionRatio: ${best.eliteIpRatio.toFixed(2)},         // IP projection ratio`);
    console.log(`  warMultiplier: ${best.eliteWarMultiplier.toFixed(2)}            // WAR adjustment multiplier`);
    console.log('};');
    console.log('```');

    console.log('\n=== Performance Comparison ===\n');

    // Baseline (current quartile system)
    const baselineParams: GridSearchParams = {
        eliteTargetOffset: -0.50,
        eliteStrengthMultiplier: 1.30,
        eliteIpRatio: 0.90,
        eliteWarMultiplier: 1.0
    };

    const baselineMetrics = await evaluateParams(baselineParams, testData);

    console.log('Baseline (Current Quartile System):');
    console.log(`  FIP MAE:        ${baselineMetrics.fipMae.toFixed(3)}`);
    console.log(`  FIP Mean Error: ${baselineMetrics.fipMeanError >= 0 ? '+' : ''}${baselineMetrics.fipMeanError.toFixed(3)}`);
    console.log(`  WAR MAE:        ${baselineMetrics.warMae.toFixed(3)}`);
    console.log(`  WAR Mean Error: ${baselineMetrics.warMeanError >= 0 ? '+' : ''}${baselineMetrics.warMeanError.toFixed(3)}`);
    console.log('');

    console.log('Optimized (Best Parameters):');
    console.log(`  FIP MAE:        ${best.fipMae.toFixed(3)} (${((best.fipMae - baselineMetrics.fipMae) / baselineMetrics.fipMae * 100).toFixed(1)}% change)`);
    console.log(`  FIP Mean Error: ${best.fipMeanError >= 0 ? '+' : ''}${best.fipMeanError.toFixed(3)} (${((best.fipMeanError - baselineMetrics.fipMeanError) / Math.abs(baselineMetrics.fipMeanError) * 100).toFixed(1)}% change)`);
    console.log(`  WAR MAE:        ${best.warMae.toFixed(3)} (${((best.warMae - baselineMetrics.warMae) / baselineMetrics.warMae * 100).toFixed(1)}% change)`);
    console.log(`  WAR Mean Error: ${best.warMeanError >= 0 ? '+' : ''}${best.warMeanError.toFixed(3)} (${((best.warMeanError - baselineMetrics.warMeanError) / Math.abs(baselineMetrics.warMeanError) * 100).toFixed(1)}% change)`);
    console.log('');

    console.log('=== Implementation Notes ===');
    console.log('1. Apply these parameters only to elite pitchers (top ~20 by projected WAR or FIP < 3.5)');
    console.log('2. Use existing quartile parameters for non-elite pitchers');
    console.log('3. Consider a smooth transition zone rather than a hard cutoff');
    console.log('4. Test on 2021 projections to verify improvement');
}

runGridSearch().catch(console.error);
