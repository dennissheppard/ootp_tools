/**
 * sim-debug.ts — Diagnostic tool for the Monte Carlo simulation engine.
 *
 * Loads team snapshots and league baselines, dumps per-team rate summaries,
 * identifies outliers, and optionally traces individual games.
 *
 * Usage:
 *   npx tsx tools/sim-debug.ts [--year=2021] [--game=TOR,ADE] [--sims=10]
 */

import { teamRatingsService } from '../src/services/TeamRatingsService';
import { loadTeamSnapshots, computeLeagueRatesFromSnapshots } from '../src/services/simulation/SimulationService';
import { computeMatchupVector } from '../src/services/simulation/PlateAppearanceEngine';
import { simulateGame, createRNG } from '../src/services/simulation/GameEngine';
import type { TeamSnapshot, BatterSnapshot, PitcherSnapshot, LeagueAverageRates } from '../src/services/simulation/SimulationTypes';

// ============================================================================
// CLI arg parsing
// ============================================================================

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const match = args.find(a => a.startsWith(`--${name}=`));
  return match?.split('=')[1];
}

const year = parseInt(getArg('year') ?? '2021', 10);
const gameTeams = getArg('game')?.split(',');
const numSims = parseInt(getArg('sims') ?? '5', 10);

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`\n=== Simulation Debug — Year ${year} ===\n`);

  // Load team snapshots
  console.log('Loading team snapshots...');
  const teams = await loadTeamSnapshots(year);
  console.log(`Loaded ${teams.length} teams\n`);

  // Compute league averages
  const league = computeLeagueRatesFromSnapshots(teams);
  console.log('League average rates (log5 baseline):');
  console.log(`  BB%:    ${(league.bbPct * 100).toFixed(1)}%`);
  console.log(`  K%:     ${(league.kPct * 100).toFixed(1)}%`);
  console.log(`  HR/PA:  ${(league.hrRate * 100).toFixed(2)}%`);
  console.log(`  1B/PA:  ${(league.singleRate * 100).toFixed(1)}%`);
  console.log(`  2B/PA:  ${(league.doubleRate * 100).toFixed(1)}%`);
  console.log(`  3B/PA:  ${(league.tripleRate * 100).toFixed(2)}%`);
  console.log(`  Out/PA: ${(league.outRate * 100).toFixed(1)}%`);
  console.log(`  OBP:    ${((league.bbPct + league.singleRate + league.doubleRate + league.tripleRate + league.hrRate) * 100).toFixed(1)}%`);
  console.log();

  // Per-team summary
  console.log('Per-team lineup summary:');
  console.log('─'.repeat(110));
  console.log(
    padR('Team', 22) +
    padR('Batters', 8) +
    padR('AvgBB%', 8) +
    padR('AvgK%', 8) +
    padR('AvgHR%', 8) +
    padR('Avg1B%', 8) +
    padR('AvgOut%', 8) +
    padR('OBP', 8) +
    padR('Rot', 5) +
    padR('BP', 5) +
    padR('AvgPK%', 8) +
    padR('AvgPBB%', 8) +
    padR('AvgPHR%', 8)
  );
  console.log('─'.repeat(110));

  const teamStats: Array<{ team: TeamSnapshot; obp: number; pitcherK: number }> = [];

  for (const team of teams.sort((a, b) => a.teamName.localeCompare(b.teamName))) {
    const lu = team.lineup;
    const avgBB = avg(lu.map(b => b.pBB));
    const avgK = avg(lu.map(b => b.pK));
    const avgHR = avg(lu.map(b => b.pHR));
    const avg1B = avg(lu.map(b => b.pSingle));
    const avgOut = avg(lu.map(b => b.pOut));
    const obp = avgBB + avg1B + avg(lu.map(b => b.pDouble)) + avg(lu.map(b => b.pTriple)) + avgHR;

    const allPitchers = [...team.rotation, ...team.bullpen];
    const avgPK = avg(allPitchers.map(p => p.pK));
    const avgPBB = avg(allPitchers.map(p => p.pBB));
    const avgPHR = avg(allPitchers.map(p => p.pHR));

    teamStats.push({ team, obp, pitcherK: avgPK });

    console.log(
      padR(team.teamName, 22) +
      padR(String(lu.length), 8) +
      padR(pct(avgBB), 8) +
      padR(pct(avgK), 8) +
      padR(pct(avgHR), 8) +
      padR(pct(avg1B), 8) +
      padR(pct(avgOut), 8) +
      padR(pct(obp), 8) +
      padR(String(team.rotation.length), 5) +
      padR(String(team.bullpen.length), 5) +
      padR(pct(avgPK), 8) +
      padR(pct(avgPBB), 8) +
      padR(pct(avgPHR), 8)
    );
  }
  console.log();

  // Flag outliers
  const obps = teamStats.map(t => t.obp);
  const meanObp = avg(obps);
  const sdObp = Math.sqrt(avg(obps.map(o => (o - meanObp) ** 2)));
  console.log(`OBP stats: mean=${pct(meanObp)}, sd=${pct(sdObp)}`);

  const outliers = teamStats.filter(t => Math.abs(t.obp - meanObp) > 2 * sdObp);
  if (outliers.length > 0) {
    console.log('\n⚠️  OBP OUTLIERS (>2 SD from mean):');
    for (const o of outliers) {
      console.log(`  ${o.team.teamName}: OBP=${pct(o.obp)} (${o.obp > meanObp ? 'HIGH' : 'LOW'})`);
      // Show individual batters
      for (const b of o.team.lineup) {
        const bObp = b.pBB + b.pSingle + b.pDouble + b.pTriple + b.pHR;
        console.log(`    ${padR(b.name, 20)} pos=${padR(b.position, 3)} BB=${pct(b.pBB)} K=${pct(b.pK)} HR=${pct(b.pHR)} 1B=${pct(b.pSingle)} Out=${pct(b.pOut)} OBP=${pct(bObp)}`);
      }
    }
  }

  // Pitcher outliers
  const pks = teamStats.map(t => t.pitcherK);
  const meanPK = avg(pks);
  const sdPK = Math.sqrt(avg(pks.map(k => (k - meanPK) ** 2)));
  const pOutliers = teamStats.filter(t => Math.abs(t.pitcherK - meanPK) > 2 * sdPK);
  if (pOutliers.length > 0) {
    console.log('\n⚠️  PITCHER K% OUTLIERS (>2 SD from mean):');
    for (const o of pOutliers) {
      console.log(`  ${o.team.teamName}: AvgPK=${pct(o.pitcherK)} (${o.pitcherK > meanPK ? 'HIGH' : 'LOW'})`);
      for (const p of [...o.team.rotation, ...o.team.bullpen]) {
        console.log(`    ${padR(p.name, 20)} role=${p.role} pK=${pct(p.pK)} pBB=${pct(p.pBB)} pHR=${pct(p.pHR)}`);
      }
    }
  }

  // Show all teams with any batters that have default/placeholder rates
  const defaultBBPct = 0.08;
  console.log('\nTeams with placeholder/default batters:');
  for (const { team } of teamStats) {
    const defaults = team.lineup.filter(b => b.pBB === batterRatesToVector(defaultBBPct, 0.22, 0.03, 0.250, 0.045, 0.005).pBB && b.playerId < 0);
    if (defaults.length > 0) {
      console.log(`  ${team.teamName}: ${defaults.length} placeholder batters`);
    }
  }

  // Game trace
  if (gameTeams && gameTeams.length === 2) {
    const t1 = teams.find(t => t.abbr === gameTeams[0] || t.teamName.includes(gameTeams[0]));
    const t2 = teams.find(t => t.abbr === gameTeams[1] || t.teamName.includes(gameTeams[1]));
    if (t1 && t2) {
      console.log(`\n=== Game Trace: ${t1.teamName} vs ${t2.teamName} (${numSims} games) ===\n`);

      // Show matchup vectors for leadoff batter vs starter
      console.log('Matchup preview: Leadoff batter vs opposing starter');
      const v1 = computeMatchupVector(t1.lineup[0], t2.rotation[0], league);
      console.log(`  ${t1.lineup[0].name} vs ${t2.rotation[0].name}:`);
      console.log(`    BB=${pct(v1.pBB)} K=${pct(v1.pK)} HR=${pct(v1.pHR)} 1B=${pct(v1.pSingle)} 2B=${pct(v1.pDouble)} 3B=${pct(v1.pTriple)} Out=${pct(v1.pOut)}`);

      const v2 = computeMatchupVector(t2.lineup[0], t1.rotation[0], league);
      console.log(`  ${t2.lineup[0].name} vs ${t1.rotation[0].name}:`);
      console.log(`    BB=${pct(v2.pBB)} K=${pct(v2.pK)} HR=${pct(v2.pHR)} 1B=${pct(v2.pSingle)} 2B=${pct(v2.pDouble)} 3B=${pct(v2.pTriple)} Out=${pct(v2.pOut)}`);

      // Simulate games
      let t1Wins = 0;
      let totalRS1 = 0, totalRS2 = 0;
      for (let i = 0; i < numSims; i++) {
        const rng = createRNG(i * 1337 + 7);
        const home = i % 2 === 0 ? t1 : t2;
        const away = i % 2 === 0 ? t2 : t1;
        const result = simulateGame(home, away, 0, 0, league, rng, 0.016);

        const score1 = i % 2 === 0 ? result.homeScore : result.awayScore;
        const score2 = i % 2 === 0 ? result.awayScore : result.homeScore;
        totalRS1 += score1;
        totalRS2 += score2;
        if (score1 > score2) t1Wins++;

        console.log(`  Game ${i + 1}: ${t1.teamName} ${score1} - ${t2.teamName} ${score2} (${result.innings} inn)`);
      }
      console.log(`\n  ${t1.teamName} wins ${t1Wins}/${numSims} (${(t1Wins / numSims * 100).toFixed(0)}%)`);
      console.log(`  Avg score: ${(totalRS1 / numSims).toFixed(1)} - ${(totalRS2 / numSims).toFixed(1)}`);
    } else {
      console.log(`\nCould not find teams: ${gameTeams.join(', ')}`);
      console.log('Available:', teams.map(t => `${t.abbr} (${t.teamName})`).join(', '));
    }
  }

  console.log('\nDone.');
}

// ============================================================================
// Helpers
// ============================================================================

import { batterRatesToVector } from '../src/services/simulation/PlateAppearanceEngine';

function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

function padR(s: string, len: number): string {
  return s.padEnd(len);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
