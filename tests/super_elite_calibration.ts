/**
 * Super Elite Pitcher Calibration Test
 *
 * Problem: Top 10 WAR leaders are under-projected by 1.55 WAR on average (3.85 projected vs 5.40 actual)
 *
 * This test will:
 * 1. Find what WAR multiplier is needed for top 10 accuracy
 * 2. Test different approaches (FIP-based vs rank-based)
 * 3. Recommend optimal "super elite" tier parameters
 *
 * USAGE: npx tsx tests/super_elite_calibration.ts
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

interface ProjectedPitcher {
    playerId: number;
    year: number;
    baseYear: number;
    projectedFip: number;
    projectedWar: number;
    projectedIp: number;
    actualFip: number;
    actualWar: number;
    actualIp: number;
    actualRank: number;
    fipError: number;
    warError: number;
    ipError: number;
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

const ELITE_PITCHER_PARAMS = {
    fipThreshold: 3.50,
    targetOffset: -1.50,
    strengthMultiplier: 1.50,
    ipProjectionRatio: 1.00,
    warMultiplier: 1.20
};

const STABILIZATION = { k9: 50, bb9: 40, hr9: 70 };

function regressStat(rawStat: number, totalIp: number, targetStat: number, stabilizationK: number, strengthMultiplier: number): number {
    const adjustedK = stabilizationK * strengthMultiplier;
    return (rawStat * totalIp + targetStat * adjustedK) / (totalIp + adjustedK);
}

function projectPitcher(
    baseStats: PitcherStats,
    leagueAvgK9: number,
    leagueAvgBb9: number,
    leagueAvgHr9: number,
    fipConstant: number,
    warMultiplier: number = 1.20
): { fip: number; war: number; ip: number } {
    const baseIp = parseIp(baseStats.ip);
    const baseK9 = (baseStats.k / baseIp) * 9;
    const baseBb9 = (baseStats.bb / baseIp) * 9;
    const baseHr9 = (baseStats.hra / baseIp) * 9;

    const { targetOffset, strengthMultiplier, ipProjectionRatio } = ELITE_PITCHER_PARAMS;

    const targetK9 = leagueAvgK9 - (targetOffset * 0.5);
    const targetBb9 = leagueAvgBb9 + (targetOffset * 0.3);
    const targetHr9 = leagueAvgHr9 + (targetOffset * 0.1);

    const regressedK9 = regressStat(baseK9, baseIp, targetK9, STABILIZATION.k9, strengthMultiplier);
    const regressedBb9 = regressStat(baseBb9, baseIp, targetBb9, STABILIZATION.bb9, strengthMultiplier);
    const regressedHr9 = regressStat(baseHr9, baseIp, targetHr9, STABILIZATION.hr9, strengthMultiplier);

    const projectedFip = calculateFip(regressedK9, regressedBb9, regressedHr9, fipConstant);
    const projectedIp = Math.min(Math.max(baseIp * ipProjectionRatio, 50), 245);

    const baseWar = calculateWar(projectedFip, projectedIp);
    const projectedWar = baseWar * warMultiplier;

    return { fip: projectedFip, war: projectedWar, ip: projectedIp };
}

async function runCalibration() {
    console.log('=== Super Elite Pitcher Calibration Test ===\n');
    console.log('Problem: Top 10 WAR leaders under-projected by 1.55 WAR on average\n');

    const projectionYears = [2018, 2019, 2020];
    const allProjections: ProjectedPitcher[] = [];

    for (const projYear of projectionYears) {
        console.log(`\n=== Analyzing ${projYear} ===\n`);

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

        // Get actual top 10
        const top10Actual = Array.from(actualStats.values())
            .filter(p => parseIp(p.ip) >= 50)
            .sort((a, b) => b.war - a.war)
            .slice(0, 10);

        console.log('Actual Top 10:');
        top10Actual.forEach((p, idx) => {
            console.log(`  #${idx + 1}: Player ${p.player_id} - ${p.war.toFixed(2)} WAR`);
        });

        // Project each top 10 pitcher with current params
        for (let i = 0; i < top10Actual.length; i++) {
            const actual = top10Actual[i];
            const baseP = baseStats.get(actual.player_id);
            if (!baseP || parseIp(baseP.ip) < 20) continue;

            const projection = projectPitcher(baseP, leagueAvgK9, leagueAvgBb9, leagueAvgHr9, fipConstant);

            const actualIp = parseIp(actual.ip);
            const actualK9 = (actual.k / actualIp) * 9;
            const actualBb9 = (actual.bb / actualIp) * 9;
            const actualHr9 = (actual.hra / actualIp) * 9;
            const actualFip = calculateFip(actualK9, actualBb9, actualHr9, fipConstant);

            allProjections.push({
                playerId: actual.player_id,
                year: projYear,
                baseYear: projYear - 1,
                projectedFip: projection.fip,
                projectedWar: projection.war,
                projectedIp: projection.ip,
                actualFip,
                actualWar: actual.war,
                actualIp,
                actualRank: i + 1,
                fipError: projection.fip - actualFip,
                warError: projection.war - actual.war,
                ipError: projection.ip - actualIp
            });
        }
    }

    console.log('\n\n=== Current Performance (Elite Params: WAR x1.20) ===\n');

    const warErrors = allProjections.map(p => p.warError);
    const fipErrors = allProjections.map(p => p.fipError);
    const meanWarError = warErrors.reduce((sum, e) => sum + e, 0) / warErrors.length;
    const maeWar = warErrors.reduce((sum, e) => sum + Math.abs(e), 0) / warErrors.length;
    const avgProjWar = allProjections.reduce((sum, p) => sum + p.projectedWar, 0) / allProjections.length;
    const avgActualWar = allProjections.reduce((sum, p) => sum + p.actualWar, 0) / allProjections.length;

    const meanFipError = fipErrors.reduce((sum, e) => sum + e, 0) / fipErrors.length;
    const maeFip = fipErrors.reduce((sum, e) => sum + Math.abs(e), 0) / fipErrors.length;
    const avgProjFip = allProjections.reduce((sum, p) => sum + p.projectedFip, 0) / allProjections.length;
    const avgActualFip = allProjections.reduce((sum, p) => sum + p.actualFip, 0) / allProjections.length;

    const ipErrors = allProjections.map(p => p.ipError);
    const meanIpError = ipErrors.reduce((sum, e) => sum + e, 0) / ipErrors.length;
    const maeIp = ipErrors.reduce((sum, e) => sum + Math.abs(e), 0) / ipErrors.length;
    const avgProjIp = allProjections.reduce((sum, p) => sum + p.projectedIp, 0) / allProjections.length;
    const avgActualIp = allProjections.reduce((sum, p) => sum + p.actualIp, 0) / allProjections.length;

    console.log('WAR:');
    console.log(`  Avg Projected: ${avgProjWar.toFixed(2)}`);
    console.log(`  Avg Actual:    ${avgActualWar.toFixed(2)}`);
    console.log(`  Mean Error:    ${meanWarError >= 0 ? '+' : ''}${meanWarError.toFixed(2)}`);
    console.log(`  MAE:           ${maeWar.toFixed(2)}`);
    console.log('');
    console.log('FIP:');
    console.log(`  Avg Projected: ${avgProjFip.toFixed(2)}`);
    console.log(`  Avg Actual:    ${avgActualFip.toFixed(2)}`);
    console.log(`  Mean Error:    ${meanFipError >= 0 ? '+' : ''}${meanFipError.toFixed(2)}`);
    console.log(`  MAE:           ${maeFip.toFixed(2)}`);
    console.log('');
    console.log('IP:');
    console.log(`  Avg Projected: ${avgProjIp.toFixed(0)}`);
    console.log(`  Avg Actual:    ${avgActualIp.toFixed(0)}`);
    console.log(`  Mean Error:    ${meanIpError >= 0 ? '+' : ''}${meanIpError.toFixed(0)}`);
    console.log(`  MAE:           ${maeIp.toFixed(0)}`);
    console.log('');
    console.log(`Sample Size: ${allProjections.length} pitchers`);
    console.log('');
    console.log('Key Insight:');
    const fipContribution = Math.abs(meanFipError) * (avgActualIp / 9) / 8.50;
    const ipContribution = Math.abs(meanIpError) / 9 * Math.abs((5.20 - avgActualFip)) / 8.50;
    const totalWarGap = Math.abs(meanWarError);
    console.log(`  FIP error contributes ~${fipContribution.toFixed(2)} WAR to the gap`);
    console.log(`  IP error contributes ~${ipContribution.toFixed(2)} WAR to the gap`);
    console.log(`  Total WAR gap: ${totalWarGap.toFixed(2)} WAR`);

    // Calculate needed multiplier
    const neededMultiplier = avgActualWar / (avgProjWar / ELITE_PITCHER_PARAMS.warMultiplier);
    console.log(`\nNeeded WAR Multiplier: ${neededMultiplier.toFixed(2)}x (vs current 1.20x)`);

    // Test different multipliers
    console.log('\n=== Testing Different WAR Multipliers ===\n');

    const testMultipliers = [1.30, 1.35, 1.40, 1.45, 1.50, 1.55];

    for (const testMult of testMultipliers) {
        const testWarErrors = allProjections.map(p => {
            const baseWar = p.projectedWar / ELITE_PITCHER_PARAMS.warMultiplier;
            const testProjWar = baseWar * testMult;
            return testProjWar - p.actualWar;
        });

        const testMeanError = testWarErrors.reduce((sum, e) => sum + e, 0) / testWarErrors.length;
        const testMae = testWarErrors.reduce((sum, e) => sum + Math.abs(e), 0) / testWarErrors.length;
        const testAvgProj = allProjections.reduce((sum, p) => sum + (p.projectedWar / ELITE_PITCHER_PARAMS.warMultiplier * testMult), 0) / allProjections.length;

        console.log(`WAR x${testMult.toFixed(2)}: Avg Proj = ${testAvgProj.toFixed(2)}, Mean Error = ${testMeanError >= 0 ? '+' : ''}${testMeanError.toFixed(2)}, MAE = ${testMae.toFixed(2)}`);
    }

    // Analyze by rank
    console.log('\n=== Performance by Rank ===\n');

    for (let rank = 1; rank <= 10; rank++) {
        const rankProjections = allProjections.filter(p => p.actualRank === rank);
        if (rankProjections.length === 0) continue;

        const rankMeanError = rankProjections.reduce((sum, p) => sum + p.warError, 0) / rankProjections.length;
        const rankAvgProj = rankProjections.reduce((sum, p) => sum + p.projectedWar, 0) / rankProjections.length;
        const rankAvgActual = rankProjections.reduce((sum, p) => sum + p.actualWar, 0) / rankProjections.length;

        console.log(`Rank #${rank}: Proj ${rankAvgProj.toFixed(2)} vs Actual ${rankAvgActual.toFixed(2)}, Error ${rankMeanError >= 0 ? '+' : ''}${rankMeanError.toFixed(2)}`);
    }

    console.log('\n=== Recommendation ===\n');

    const optimalMultiplier = testMultipliers.reduce((best, curr) => {
        const currErrors = allProjections.map(p => {
            const baseWar = p.projectedWar / ELITE_PITCHER_PARAMS.warMultiplier;
            const testProjWar = baseWar * curr;
            return Math.abs(testProjWar - p.actualWar);
        });
        const currMae = currErrors.reduce((sum, e) => sum + e, 0) / currErrors.length;

        const bestErrors = allProjections.map(p => {
            const baseWar = p.projectedWar / ELITE_PITCHER_PARAMS.warMultiplier;
            const testProjWar = baseWar * best;
            return Math.abs(testProjWar - p.actualWar);
        });
        const bestMae = bestErrors.reduce((sum, e) => sum + e, 0) / bestErrors.length;

        return currMae < bestMae ? curr : best;
    });

    console.log(`Optimal "Super Elite" WAR Multiplier: ${optimalMultiplier.toFixed(2)}x`);
    console.log('');
    console.log('Recommended Implementation:');
    console.log('```typescript');
    console.log('const SUPER_ELITE_PITCHER_PARAMS = {');
    console.log('  fipThreshold: 3.50,          // Same as elite');
    console.log('  targetOffset: -1.50,          // Same as elite');
    console.log('  strengthMultiplier: 1.50,     // Same as elite');
    console.log('  ipProjectionRatio: 1.00,      // Same as elite');
    console.log(`  warMultiplier: ${optimalMultiplier.toFixed(2)}           // INCREASED from 1.20`);
    console.log('};');
    console.log('```');
    console.log('');
    console.log('Apply this multiplier to:');
    console.log('- Top 15-20 pitchers by projected WAR (after initial calculation)');
    console.log('- OR pitchers with FIP < 3.2 (very elite threshold)');
}

runCalibration().catch(console.error);
