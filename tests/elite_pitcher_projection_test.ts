/**
 * Elite Pitcher Projection Test
 *
 * Projects 2021 top 10 pitchers from 2017-2020 data and compares to actual.
 * Goal: Identify systematic bias in elite pitcher projections and calibrate accordingly.
 *
 * USAGE: npx tsx tests/elite_pitcher_projection_test.ts
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
    actualFip: number;
    actualWar: number;
    actualIp: number;
    fipError: number;
    warError: number;
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

// Simulate True Ratings regression with quartile-based parameters
const QUARTILE_REGRESSION_PARAMS = [
    { fipThreshold: 3.76, targetOffset: -0.50, strengthMultiplier: 1.30 }, // Q1 (Elite)
    { fipThreshold: 4.13, targetOffset: -0.50, strengthMultiplier: 2.00 }, // Q2 (Good)
    { fipThreshold: 4.52, targetOffset: 0.30, strengthMultiplier: 2.00 },  // Q3 (Average)
    { fipThreshold: 999.00, targetOffset: 1.50, strengthMultiplier: 2.00 }, // Q4 (Below Avg)
];

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
    fipConstant: number
): { fip: number; war: number } {
    const baseIp = parseIp(baseStats.ip);
    const baseK9 = (baseStats.k / baseIp) * 9;
    const baseBb9 = (baseStats.bb / baseIp) * 9;
    const baseHr9 = (baseStats.hra / baseIp) * 9;

    // Calculate raw FIP to determine quartile
    const rawFip = calculateFip(baseK9, baseBb9, baseHr9, fipConstant);

    // Find quartile params
    const quartileParams = QUARTILE_REGRESSION_PARAMS.find(q => rawFip <= q.fipThreshold)
                          || QUARTILE_REGRESSION_PARAMS[QUARTILE_REGRESSION_PARAMS.length - 1];

    const { targetOffset, strengthMultiplier } = quartileParams;

    // Calculate regression targets
    const targetK9 = leagueAvgK9 - (targetOffset * 0.5);
    const targetBb9 = leagueAvgBb9 + (targetOffset * 0.3);
    const targetHr9 = leagueAvgHr9 + (targetOffset * 0.1);

    // Apply regression
    const regressedK9 = regressStat(baseK9, baseIp, targetK9, STABILIZATION.k9, strengthMultiplier);
    const regressedBb9 = regressStat(baseBb9, baseIp, targetBb9, STABILIZATION.bb9, strengthMultiplier);
    const regressedHr9 = regressStat(baseHr9, baseIp, targetHr9, STABILIZATION.hr9, strengthMultiplier);

    const projectedFip = calculateFip(regressedK9, regressedBb9, regressedHr9, fipConstant);

    // Project IP conservatively (90% of prior year, clamped)
    const projectedIp = Math.min(Math.max(baseIp * 0.9, 50), 245);

    const projectedWar = calculateWar(projectedFip, projectedIp);

    return { fip: projectedFip, war: projectedWar };
}

async function runEliteTest() {
    console.log('=== Elite Pitcher Projection Test ===\n');
    console.log('Goal: Project top 10 pitchers and compare to actual results\n');

    // Test years: project these years from prior year
    const projectionYears = [2018, 2019, 2020];
    const allProjections: ProjectedPitcher[] = [];

    for (const projYear of projectionYears) {
        console.log(`\n=== Projecting ${projYear} from ${projYear - 1} ===\n`);

        const [baseStats, actualStats] = await Promise.all([
            fetchPitchingStats(projYear - 1),
            fetchPitchingStats(projYear)
        ]);

        // Calculate league averages for projection year
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

        console.log(`League averages: K/9=${leagueAvgK9.toFixed(2)}, BB/9=${leagueAvgBb9.toFixed(2)}, HR/9=${leagueAvgHr9.toFixed(2)}, FIP Constant=${fipConstant.toFixed(2)}\n`);

        // Get actual top 10 by WAR
        const top10Actual = Array.from(actualStats.values())
            .filter(p => parseIp(p.ip) >= 50)
            .sort((a, b) => b.war - a.war)
            .slice(0, 10);

        console.log('Actual Top 10 WAR Leaders:');
        top10Actual.forEach((p, idx) => {
            const actualIp = parseIp(p.ip);
            const actualK9 = (p.k / actualIp) * 9;
            const actualBb9 = (p.bb / actualIp) * 9;
            const actualHr9 = (p.hra / actualIp) * 9;
            const actualFip = calculateFip(actualK9, actualBb9, actualHr9, fipConstant);

            console.log(`  #${idx + 1}: Player ${p.player_id.toString().padEnd(6)} - ${p.war.toFixed(2)} WAR, ${actualFip.toFixed(2)} FIP, ${actualIp.toFixed(0)} IP`);
        });

        console.log('\nProjecting these pitchers from prior year:\n');

        // Project each top 10 pitcher
        for (const actual of top10Actual) {
            const baseP = baseStats.get(actual.player_id);
            if (!baseP) {
                console.log(`  Player ${actual.player_id}: No prior year data (skipped)`);
                continue;
            }

            const baseIp = parseIp(baseP.ip);
            if (baseIp < 20) {
                console.log(`  Player ${actual.player_id}: Insufficient prior IP (${baseIp.toFixed(0)}, skipped)`);
                continue;
            }

            const projection = projectPitcher(baseP, leagueAvgK9, leagueAvgBb9, leagueAvgHr9, fipConstant);

            const actualIp = parseIp(actual.ip);
            const actualK9 = (actual.k / actualIp) * 9;
            const actualBb9 = (actual.bb / actualIp) * 9;
            const actualHr9 = (actual.hra / actualIp) * 9;
            const actualFip = calculateFip(actualK9, actualBb9, actualHr9, fipConstant);

            const fipError = projection.fip - actualFip;
            const warError = projection.war - actual.war;

            allProjections.push({
                playerId: actual.player_id,
                year: projYear,
                baseYear: projYear - 1,
                projectedFip: projection.fip,
                projectedWar: projection.war,
                actualFip,
                actualWar: actual.war,
                actualIp,
                fipError,
                warError
            });

            console.log(`  Player ${actual.player_id.toString().padEnd(6)}: Proj FIP ${projection.fip.toFixed(2)} vs Actual ${actualFip.toFixed(2)} (error: ${fipError >= 0 ? '+' : ''}${fipError.toFixed(2)}), Proj WAR ${projection.war.toFixed(2)} vs Actual ${actual.war.toFixed(2)} (error: ${warError >= 0 ? '+' : ''}${warError.toFixed(2)})`);
        }
    }

    console.log('\n\n=== Overall Elite Pitcher Projection Analysis ===\n');

    const fipErrors = allProjections.map(p => p.fipError);
    const warErrors = allProjections.map(p => p.warError);

    const meanFipError = fipErrors.reduce((sum, e) => sum + e, 0) / fipErrors.length;
    const maeFip = fipErrors.reduce((sum, e) => sum + Math.abs(e), 0) / fipErrors.length;
    const rmseFip = Math.sqrt(fipErrors.reduce((sum, e) => sum + e * e, 0) / fipErrors.length);

    const meanWarError = warErrors.reduce((sum, e) => sum + e, 0) / warErrors.length;
    const maeWar = warErrors.reduce((sum, e) => sum + Math.abs(e), 0) / warErrors.length;
    const rmseWar = Math.sqrt(warErrors.reduce((sum, e) => sum + e * e, 0) / warErrors.length);

    console.log(`Sample Size: ${allProjections.length} elite pitchers\n`);

    console.log('FIP Projection Accuracy:');
    console.log(`  Mean Error:  ${meanFipError >= 0 ? '+' : ''}${meanFipError.toFixed(3)} (${meanFipError > 0 ? 'over-projecting FIP' : 'under-projecting FIP'})`);
    console.log(`  MAE:         ${maeFip.toFixed(3)}`);
    console.log(`  RMSE:        ${rmseFip.toFixed(3)}`);
    console.log('');

    console.log('WAR Projection Accuracy:');
    console.log(`  Mean Error:  ${meanWarError >= 0 ? '+' : ''}${meanWarError.toFixed(3)} (${meanWarError > 0 ? 'over-projecting WAR' : 'under-projecting WAR'})`);
    console.log(`  MAE:         ${maeWar.toFixed(3)}`);
    console.log(`  RMSE:        ${rmseWar.toFixed(3)}`);
    console.log('');

    // Show average projected vs actual
    const avgProjWar = allProjections.reduce((sum, p) => sum + p.projectedWar, 0) / allProjections.length;
    const avgActualWar = allProjections.reduce((sum, p) => sum + p.actualWar, 0) / allProjections.length;
    const avgProjFip = allProjections.reduce((sum, p) => sum + p.projectedFip, 0) / allProjections.length;
    const avgActualFip = allProjections.reduce((sum, p) => sum + p.actualFip, 0) / allProjections.length;

    console.log('Average Values:');
    console.log(`  Projected FIP: ${avgProjFip.toFixed(2)} vs Actual: ${avgActualFip.toFixed(2)}`);
    console.log(`  Projected WAR: ${avgProjWar.toFixed(2)} vs Actual: ${avgActualWar.toFixed(2)}`);
    console.log('');

    // Breakdown by year
    console.log('=== Breakdown by Year ===\n');
    for (const year of projectionYears) {
        const yearData = allProjections.filter(p => p.year === year);
        if (yearData.length === 0) continue;

        const yearMeanWar = yearData.reduce((sum, p) => sum + p.warError, 0) / yearData.length;
        const yearMaeWar = yearData.reduce((sum, p) => sum + Math.abs(p.warError), 0) / yearData.length;

        console.log(`${year} (n=${yearData.length}):`);
        console.log(`  WAR Mean Error: ${yearMeanWar >= 0 ? '+' : ''}${yearMeanWar.toFixed(3)}`);
        console.log(`  WAR MAE: ${yearMaeWar.toFixed(3)}`);
        console.log('');
    }

    // Summary and recommendations
    console.log('=== Summary ===\n');

    if (Math.abs(meanWarError) > 0.5) {
        if (meanWarError < -0.5) {
            console.log(`⚠️  UNDER-PROJECTING elite pitchers by ${Math.abs(meanWarError).toFixed(2)} WAR on average`);
            console.log(`    → Elite pitchers need a boost`);

            if (meanFipError > 0.2) {
                console.log(`    → Root cause: Over-projecting FIP by ${meanFipError.toFixed(2)} (too pessimistic)`);
                console.log(`    → Solution: Reduce regression strength for elite pitchers OR adjust regression target`);
            } else {
                console.log(`    → FIP projections look OK (${meanFipError.toFixed(2)}), issue is in WAR formula`);
                console.log(`    → Solution: Consider elite pitcher WAR multiplier or different replacement level`);
            }
        } else {
            console.log(`⚠️  OVER-PROJECTING elite pitchers by ${meanWarError.toFixed(2)} WAR on average`);
        }
    } else {
        console.log(`✓ Elite pitcher projections are well-calibrated (mean error: ${meanWarError.toFixed(2)} WAR)`);
    }

    console.log('\n=== Next Steps ===');
    console.log('1. If under-projecting WAR but FIP is OK: Test elite pitcher WAR multipliers');
    console.log('2. If over-projecting FIP: Reduce regression strength or adjust targets for elite pitchers');
    console.log('3. Run grid search to find optimal elite pitcher adjustment parameters');
}

runEliteTest().catch(console.error);
