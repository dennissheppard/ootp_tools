/**
 * Projection Diagnostic Test
 *
 * Analyzes what the projection system actually produces for 2021
 * to identify why projected WAR is capped at ~3.2
 *
 * This will check:
 * 1. Are IP projections too low?
 * 2. Are FIP projections too conservative?
 * 3. How does the distribution compare to actual 2020?
 */

const API_BASE = 'https://atl-01.statsplus.net/world/api';

interface PitcherStats {
    player_id: number;
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
    console.log(`Fetching ${year} data...`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${year} stats`);

    const csvText = await response.text();
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',');

    const indices = {
        player_id: headers.indexOf('player_id'),
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

function calculateWar(fip: number, ip: number, avgFip: number): number {
    const replacementFip = avgFip + 0.37;
    return ((replacementFip - fip) / 8.5) * (ip / 9);
}

async function runDiagnostic() {
    console.log('=== Projection Diagnostic Test ===\n');

    // Fetch 2019 and 2020 actual data
    const [stats2019, stats2020] = await Promise.all([
        fetchPitchingStats(2019),
        fetchPitchingStats(2020)
    ]);

    console.log(`Loaded ${stats2019.size} pitchers from 2019`);
    console.log(`Loaded ${stats2020.size} pitchers from 2020\n`);

    // Get top 2020 performers
    const qualified2020 = Array.from(stats2020.values())
        .filter(p => parseIp(p.ip) >= 150)
        .sort((a, b) => b.war - a.war)
        .slice(0, 20); // Top 20

    console.log('=== Top 20 Actual 2020 Pitchers (150+ IP) ===');
    console.log('What they DID in 2020:\n');

    qualified2020.forEach((p, idx) => {
        const ip = parseIp(p.ip);
        const k9 = (p.k / ip) * 9;
        const bb9 = (p.bb / ip) * 9;
        const hr9 = (p.hra / ip) * 9;
        const fip = calculateFip(k9, bb9, hr9);

        console.log(`${(idx + 1).toString().padStart(2)}. Player ${p.player_id.toString().padEnd(6)} (${p.gs.toString().padStart(3)} GS):`);
        console.log(`    WAR: ${p.war.toFixed(1)}, FIP: ${fip.toFixed(2)}, IP: ${ip.toFixed(0)}`);
        console.log(`    K/9: ${k9.toFixed(1)}, BB/9: ${bb9.toFixed(1)}, HR/9: ${hr9.toFixed(2)}`);
    });

    // Check their 2019 performance
    console.log('\n=== What They Did in 2019 (for projection baseline) ===\n');

    qualified2020.forEach((p, idx) => {
        const stats2019Player = stats2019.get(p.player_id);
        if (stats2019Player) {
            const ip2019 = parseIp(stats2019Player.ip);
            const k9_2019 = (stats2019Player.k / ip2019) * 9;
            const bb9_2019 = (stats2019Player.bb / ip2019) * 9;
            const hr9_2019 = (stats2019Player.hra / ip2019) * 9;
            const fip2019 = calculateFip(k9_2019, bb9_2019, hr9_2019);

            console.log(`${(idx + 1).toString().padStart(2)}. Player ${p.player_id.toString().padEnd(6)}:`);
            console.log(`    2019: WAR ${stats2019Player.war.toFixed(1)}, FIP ${fip2019.toFixed(2)}, IP ${ip2019.toFixed(0)} (${stats2019Player.gs} GS)`);

            const ip2020 = parseIp(p.ip);
            const k9_2020 = (p.k / ip2020) * 9;
            const bb9_2020 = (p.bb / ip2020) * 9;
            const hr9_2020 = (p.hra / ip2020) * 9;
            const fip2020 = calculateFip(k9_2020, bb9_2020, hr9_2020);

            console.log(`    2020: WAR ${p.war.toFixed(1)}, FIP ${fip2020.toFixed(2)}, IP ${ip2020.toFixed(0)} (${p.gs} GS)`);
            console.log(`    Change: ${(ip2020 - ip2019).toFixed(0)} IP, ${(fip2020 - fip2019).toFixed(2)} FIP`);
        } else {
            console.log(`${(idx + 1).toString().padStart(2)}. Player ${p.player_id.toString().padEnd(6)}: NO 2019 DATA (rookie or returning from injury)`);
        }
    });

    // Simulate projection logic
    console.log('\n=== Simulating Projection Logic ===\n');
    console.log('If we projected 2020 from 2019 data, what should we get?\n');

    const playersWithBoth = qualified2020.filter(p => stats2019.has(p.player_id));

    console.log(`Players in top 20 with 2019 data: ${playersWithBoth.length}\n`);

    // Simple projection: Use 2019 stats with minimal regression
    playersWithBoth.forEach((p, idx) => {
        const stats2019Player = stats2019.get(p.player_id)!;
        const ip2019 = parseIp(stats2019Player.ip);
        const ip2020Actual = parseIp(p.ip);

        const k9_2019 = (stats2019Player.k / ip2019) * 9;
        const bb9_2019 = (stats2019Player.bb / ip2019) * 9;
        const hr9_2019 = (stats2019Player.hra / ip2019) * 9;
        const fip2019 = calculateFip(k9_2019, bb9_2019, hr9_2019);

        // Simple projection: assume same performance, project IP based on GS
        const projectedIp = ip2019; // Simplest assumption
        const projectedFip = fip2019; // No regression
        const projectedWar = calculateWar(projectedFip, projectedIp, 4.21);

        const actualWar2020 = p.war;

        console.log(`Player ${p.player_id}:`);
        console.log(`  2019 baseline: ${fip2019.toFixed(2)} FIP, ${ip2019.toFixed(0)} IP → ${stats2019Player.war.toFixed(1)} WAR`);
        console.log(`  Simple proj:   ${projectedFip.toFixed(2)} FIP, ${projectedIp.toFixed(0)} IP → ${projectedWar.toFixed(1)} WAR`);
        console.log(`  2020 actual:   ${calculateFip((p.k/ip2020Actual)*9, (p.bb/ip2020Actual)*9, (p.hra/ip2020Actual)*9).toFixed(2)} FIP, ${ip2020Actual.toFixed(0)} IP → ${actualWar2020.toFixed(1)} WAR`);
        console.log(`  Projection error: ${(projectedWar - actualWar2020).toFixed(1)} WAR\n`);
    });

    // Summary
    console.log('\n=== Key Questions ===');
    console.log('1. Are your IP projections giving 350-450 IP to elite starters?');
    console.log('   (Top 2020 pitchers averaged 400+ IP)');
    console.log('');
    console.log('2. Are your FIP projections in the 3.2-3.7 range for elite pitchers?');
    console.log('   (Top 2020 pitchers had 3.2-3.6 FIP)');
    console.log('');
    console.log('3. If projections show 3.2 max WAR, likely causes:');
    console.log('   - IP capped too low (e.g., 200-250 instead of 400+)');
    console.log('   - FIP regressed too hard (e.g., 4.0+ instead of 3.3)');
    console.log('   - Or both');
}

runDiagnostic().catch(console.error);
