/**
 * WAR Projection Validation Test
 *
 * Compares projected 2020 WAR (from 2019 True Ratings) against actual 2020 WAR.
 * This isolates whether the problem is:
 * 1. WAR formula (converting FIP+IP → WAR)
 * 2. FIP projections (aging/regression compressing ratings too much)
 * 3. IP projections (underestimating innings for elite pitchers)
 *
 * USAGE: npx tsx tests/war_projection_validation.ts
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

interface Comparison {
    playerId: number;
    // Actual 2020
    actual2020Ip: number;
    actual2020Fip: number;
    actual2020War: number;
    // Calculated 2020 (our formula on actual stats)
    calculated2020War: number;
    // Projected 2020 (from 2019)
    proj2020Ip?: number;
    proj2020Fip?: number;
    proj2020War?: number;
}

async function fetchPitchingStats(year: number): Promise<Map<number, PitcherStats>> {
    const url = `${API_BASE}/playerpitchstatsv2/?year=${year}`;
    console.log(`Fetching ${year} data...`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${year} stats`);

    const csvText = await response.text();
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',');

    const indices = {
        player_id: headers.indexOf('player_id'),
        year: headers.indexOf('year'),
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
            // Aggregate stats
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

function calculateFip(k9: number, bb9: number, hr9: number, fipConstant: number): number {
    return ((13 * hr9) + (3 * bb9) - (2 * k9)) / 9 + fipConstant;
}

function calculateWar(fip: number, ip: number, replacementFip: number, runsPerWin: number = 8.5): number {
    return ((replacementFip - fip) / runsPerWin) * (ip / 9);
}

async function runTest() {
    console.log('=== WAR Projection Validation Test ===\n');

    // Fetch 2020 actual stats
    const stats2020 = await fetchPitchingStats(2020);
    console.log(`Loaded ${stats2020.size} pitchers from 2020\n`);

    // Calculate league stats for 2020
    let totalEr = 0, totalOuts = 0, totalK = 0, totalBb = 0, totalHr = 0;
    stats2020.forEach(p => {
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
    const avgFip = rawFipComponent + fipConstant;
    const replacementFip = avgFip + 0.37; // NEW formula

    console.log('2020 League Context:');
    console.log(`  ERA: ${leagueEra.toFixed(2)}`);
    console.log(`  Avg FIP: ${avgFip.toFixed(2)}`);
    console.log(`  Replacement FIP: ${replacementFip.toFixed(2)}\n`);

    // Analyze top WAR pitchers from 2020
    const qualified = Array.from(stats2020.values()).filter(p => parseIp(p.ip) >= 50);
    const sortedByWar = qualified.sort((a, b) => b.war - a.war);

    console.log('=== Top 10 Actual 2020 WAR Leaders ===');
    sortedByWar.slice(0, 10).forEach((p, idx) => {
        const ip = parseIp(p.ip);
        const k9 = (p.k / ip) * 9;
        const bb9 = (p.bb / ip) * 9;
        const hr9 = (p.hra / ip) * 9;
        const fip = calculateFip(k9, bb9, hr9, fipConstant);
        const calcWar = calculateWar(fip, ip, replacementFip);

        console.log(`${idx + 1}. Player ${p.player_id}:`);
        console.log(`   OOTP WAR: ${p.war.toFixed(1)}, Our WAR: ${calcWar.toFixed(1)} (diff: ${(calcWar - p.war).toFixed(1)})`);
        console.log(`   FIP: ${fip.toFixed(2)}, IP: ${ip.toFixed(0)}, GS: ${p.gs}`);
    });

    // Calculate correlation for all qualified pitchers
    const comparisons = qualified.map(p => {
        const ip = parseIp(p.ip);
        const k9 = (p.k / ip) * 9;
        const bb9 = (p.bb / ip) * 9;
        const hr9 = (p.hra / ip) * 9;
        const fip = calculateFip(k9, bb9, hr9, fipConstant);
        const calcWar = calculateWar(fip, ip, replacementFip);

        return {
            playerId: p.player_id,
            ip,
            fip,
            ootpWar: p.war,
            calcWar,
            diff: calcWar - p.war
        };
    });

    const avgDiff = comparisons.reduce((sum, c) => sum + c.diff, 0) / comparisons.length;
    const mae = comparisons.reduce((sum, c) => sum + Math.abs(c.diff), 0) / comparisons.length;

    console.log('\n=== NEW Formula Validation (50+ IP pitchers) ===');
    console.log(`Mean Error: ${avgDiff.toFixed(3)}`);
    console.log(`MAE: ${mae.toFixed(3)}`);

    // Analyze by WAR tier
    console.log('\n=== Analysis by OOTP WAR Tier ===');
    const tiers = [
        { name: 'Elite (5+ WAR)', min: 5, max: 100 },
        { name: 'Great (3-5 WAR)', min: 3, max: 5 },
        { name: 'Good (1-3 WAR)', min: 1, max: 3 },
        { name: 'Average (0-1 WAR)', min: 0, max: 1 },
        { name: 'Below Avg (<0 WAR)', min: -100, max: 0 }
    ];

    tiers.forEach(tier => {
        const tierPitchers = comparisons.filter(c =>
            c.ootpWar >= tier.min && c.ootpWar < tier.max
        );

        if (tierPitchers.length === 0) return;

        const avgOotpWar = tierPitchers.reduce((sum, p) => sum + p.ootpWar, 0) / tierPitchers.length;
        const avgCalcWar = tierPitchers.reduce((sum, p) => sum + p.calcWar, 0) / tierPitchers.length;
        const avgIp = tierPitchers.reduce((sum, p) => sum + p.ip, 0) / tierPitchers.length;
        const avgFip = tierPitchers.reduce((sum, p) => sum + p.fip, 0) / tierPitchers.length;
        const avgDiff = avgCalcWar - avgOotpWar;

        console.log(`\n${tier.name} (n=${tierPitchers.length})`);
        console.log(`  Avg OOTP WAR: ${avgOotpWar.toFixed(2)}`);
        console.log(`  Avg Our WAR:  ${avgCalcWar.toFixed(2)}`);
        console.log(`  Difference:   ${avgDiff >= 0 ? '+' : ''}${avgDiff.toFixed(2)}`);
        console.log(`  Avg IP: ${avgIp.toFixed(0)}, Avg FIP: ${avgFip.toFixed(2)}`);
    });

    // Check IP distribution for elite pitchers
    const elite = comparisons.filter(c => c.ootpWar >= 5);
    const eliteIPs = elite.map(p => p.ip).sort((a, b) => b - a);

    console.log('\n=== Elite Pitcher (5+ WAR) IP Distribution ===');
    console.log(`Count: ${elite.length}`);
    console.log(`IP Range: ${Math.min(...eliteIPs).toFixed(0)} - ${Math.max(...eliteIPs).toFixed(0)}`);
    console.log(`IP Median: ${eliteIPs[Math.floor(eliteIPs.length / 2)].toFixed(0)}`);
    console.log(`IP Mean: ${(eliteIPs.reduce((sum, ip) => sum + ip, 0) / eliteIPs.length).toFixed(0)}`);

    // Summary
    console.log('\n=== Summary ===');
    if (Math.abs(avgDiff) <= 0.05) {
        console.log('✓ NEW formula is well-calibrated across all pitchers');
    } else if (avgDiff > 0) {
        console.log(`⚠️  NEW formula over-estimates by ${avgDiff.toFixed(2)} WAR on average`);
    } else {
        console.log(`⚠️  NEW formula under-estimates by ${Math.abs(avgDiff).toFixed(2)} WAR on average`);
    }

    // Check if elite pitchers are properly handled
    const eliteAvgDiff = elite.reduce((sum, p) => sum + p.diff, 0) / elite.length;
    if (Math.abs(eliteAvgDiff) > 0.3) {
        console.log(`⚠️  Elite pitchers (5+ WAR) have average error of ${eliteAvgDiff.toFixed(2)}`);
        console.log(`    This suggests the formula may not scale properly for top performers`);
    }

    console.log('\n=== Next Steps ===');
    console.log('If the formula is well-calibrated but projections show low WAR:');
    console.log('  → Issue is likely with FIP or IP projections, not WAR formula');
    console.log('  → Check: Are top pitchers getting regressed too hard toward league average?');
    console.log('  → Check: Are IP projections too conservative for elite starters?');
}

runTest().catch(console.error);
