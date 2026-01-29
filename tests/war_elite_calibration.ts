/**
 * Elite WAR Calibration Test
 *
 * Focuses ONLY on top WAR leaders (the elite starters that matter for projections)
 * Tests multiple years to find the right replacement level for matching OOTP's
 * calculation at the TOP end of the distribution.
 *
 * USAGE: npx tsx tests/war_elite_calibration.ts
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

        // Only overall stats (split_id = 1)
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
            // Player traded - aggregate
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

async function runEliteTest() {
    console.log('=== Elite WAR Calibration Test ===');
    console.log('Focusing on top 20 WAR leaders per year\n');

    const years = [2018, 2019, 2020];
    const allTopPitchers: Array<{
        year: number;
        rank: number;
        playerId: number;
        ip: number;
        fip: number;
        ootpWar: number;
        gs: number;
    }> = [];

    // Fetch and analyze each year
    for (const year of years) {
        console.log(`\n=== ${year} Season ===`);
        const stats = await fetchPitchingStats(year);

        // Calculate league stats
        let totalEr = 0, totalOuts = 0, totalK = 0, totalBb = 0, totalHr = 0;
        stats.forEach(p => {
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

        console.log(`League: ERA ${leagueEra.toFixed(2)}, Avg FIP ${avgFip.toFixed(2)}\n`);

        // Get top 20 by OOTP WAR
        const qualified = Array.from(stats.values())
            .filter(p => parseIp(p.ip) >= 50)
            .sort((a, b) => b.war - a.war)
            .slice(0, 20);

        console.log('Top 20 WAR Leaders:');
        qualified.forEach((p, idx) => {
            const ip = parseIp(p.ip);
            const k9 = (p.k / ip) * 9;
            const bb9 = (p.bb / ip) * 9;
            const hr9 = (p.hra / ip) * 9;
            const fip = calculateFip(k9, bb9, hr9, fipConstant);

            console.log(`${(idx + 1).toString().padStart(2)}. Player ${p.player_id.toString().padEnd(6)}: ${p.war.toFixed(1)} WAR, ${fip.toFixed(2)} FIP, ${ip.toFixed(0)} IP (${p.gs} GS)`);

            allTopPitchers.push({
                year,
                rank: idx + 1,
                playerId: p.player_id,
                ip,
                fip,
                ootpWar: p.war,
                gs: p.gs
            });
        });
    }

    // Test different replacement levels on TOP pitchers only
    console.log('\n\n=== Testing Replacement Levels on Elite Pitchers ===\n');

    const testLevels = [
        { name: 'Current (avgFip + 0.80)', offset: 0.80 },
        { name: 'Higher (avgFip + 1.00)', offset: 1.00 },
        { name: 'Even Higher (avgFip + 1.20)', offset: 1.20 },
        { name: 'OOTP Starter Match?', offset: 1.40 },
    ];

    for (const test of testLevels) {
        const errors: number[] = [];
        const absErrors: number[] = [];

        for (const pitcher of allTopPitchers) {
            // Fetch league avgFip for this year
            const yearStats = await fetchPitchingStats(pitcher.year);
            let totalEr = 0, totalOuts = 0, totalK = 0, totalBb = 0, totalHr = 0;
            yearStats.forEach(p => {
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

            const replacementFip = avgFip + test.offset;
            const calculatedWar = calculateWar(pitcher.fip, pitcher.ip, replacementFip);
            const error = calculatedWar - pitcher.ootpWar;

            errors.push(error);
            absErrors.push(Math.abs(error));
        }

        const meanError = errors.reduce((sum, e) => sum + e, 0) / errors.length;
        const mae = absErrors.reduce((sum, e) => sum + e, 0) / absErrors.length;
        const avgOotpWar = allTopPitchers.reduce((sum, p) => sum + p.ootpWar, 0) / allTopPitchers.length;

        console.log(`${test.name}:`);
        console.log(`  Mean Error: ${meanError.toFixed(3)} (positive = over-estimate)`);
        console.log(`  MAE: ${mae.toFixed(3)}`);
        console.log(`  Avg OOTP WAR (top 20/year): ${avgOotpWar.toFixed(2)}`);
    }

    // Detailed analysis on top 10 from each year
    console.log('\n\n=== Detailed Top 10 Analysis ===\n');

    for (const year of years) {
        console.log(`\n${year} Top 10:`);
        const yearPitchers = allTopPitchers.filter(p => p.year === year && p.rank <= 10);

        const stats = await fetchPitchingStats(year);
        let totalEr = 0, totalOuts = 0, totalK = 0, totalBb = 0, totalHr = 0;
        stats.forEach(p => {
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

        yearPitchers.forEach(p => {
            const repl80 = avgFip + 0.80;
            const repl100 = avgFip + 1.00;
            const repl120 = avgFip + 1.20;
            const repl140 = avgFip + 1.40;

            const war80 = calculateWar(p.fip, p.ip, repl80);
            const war100 = calculateWar(p.fip, p.ip, repl100);
            const war120 = calculateWar(p.fip, p.ip, repl120);
            const war140 = calculateWar(p.fip, p.ip, repl140);

            console.log(`#${p.rank} - Player ${p.playerId}: ${p.ootpWar.toFixed(1)} WAR actual`);
            console.log(`     FIP: ${p.fip.toFixed(2)}, IP: ${p.ip.toFixed(0)}`);
            console.log(`     +0.80: ${war80.toFixed(1)} (${(war80 - p.ootpWar).toFixed(1)})`);
            console.log(`     +1.00: ${war100.toFixed(1)} (${(war100 - p.ootpWar).toFixed(1)})`);
            console.log(`     +1.20: ${war120.toFixed(1)} (${(war120 - p.ootpWar).toFixed(1)})`);
            console.log(`     +1.40: ${war140.toFixed(1)} (${(war140 - p.ootpWar).toFixed(1)})`);
        });
    }

    console.log('\n\n=== Recommendation ===');
    console.log('Find the offset that minimizes MAE on top 20 pitchers per year');
}

runEliteTest().catch(console.error);
