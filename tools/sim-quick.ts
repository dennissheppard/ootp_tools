/**
 * Quick CLI sim runner for testing run environment changes.
 * Usage: npx tsx tools/sim-quick.ts
 */
import { runSimulation } from '../src/services/simulation/SimulationService';
import type { SimConfig } from '../src/services/simulation/SimulationTypes';

const config: SimConfig = {
  numSimulations: 100,  // fewer sims for speed
  mode: 'season',
  includePlayoffs: false,
  homeFieldAdvantage: 0.54,
  year: 2021,
};

console.log('Running 100 season simulations...');
const start = Date.now();

runSimulation(config, (done, total, status) => {
  if (done % 20 === 0) process.stdout.write(`  ${done}/${total} ${status ?? ''}\r`);
}).then(result => {
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s\n`);

  // League R/G
  const totalRS = result.teamSummaries.reduce((s, t) => s + t.meanRS, 0);
  const numTeams = result.teamSummaries.length;
  const lgRpg = (totalRS / numTeams / 162).toFixed(2);

  console.log(`League avg R/G: ${lgRpg}`);
  console.log(`Top 5 teams:`);
  result.teamSummaries.slice(0, 5).forEach(t => {
    console.log(`  ${t.teamName}: ${t.meanWins}W, ${(t.meanRS/162).toFixed(2)} RS/G, ${(t.meanRA/162).toFixed(2)} RA/G`);
  });

  console.log(`\nBottom 5 teams:`);
  result.teamSummaries.slice(-5).forEach(t => {
    console.log(`  ${t.teamName}: ${t.meanWins}W, ${(t.meanRS/162).toFixed(2)} RS/G, ${(t.meanRA/162).toFixed(2)} RA/G`);
  });

  // Leaderboard pitchers
  if (result.leaderboards) {
    console.log(`\nSouthern League Top 5 Pitchers (by ERA):`);
    result.leaderboards.southernPitchers.slice(0, 5).forEach(p => {
      console.log(`  ${p.name}: ${p.ip.toFixed(0)} IP, ${p.era.toFixed(2)} ERA, ${p.fip.toFixed(2)} FIP, ${Math.round(p.bb)} BB, ${Math.round(p.hr)} HR`);
    });
  }

  // Access debug data from window
  const lg = (globalThis as any).__simLeagueTotals;
  if (lg) {
    console.log(`\nLeague totals (per team):`);
    console.log(`  1B: ${Math.round(lg.singles/numTeams)}, 2B: ${Math.round(lg.doubles/numTeams)}, 3B: ${Math.round(lg.triples/numTeams)}, HR: ${Math.round(lg.hr/numTeams)}, BB: ${Math.round(lg.bb/numTeams)}`);
    console.log(`  AVG: ${lg.avg}, OBP: ${lg.obp}, SLG: ${lg.slg}`);
  }
}).catch(err => {
  console.error('Sim failed:', err);
  process.exit(1);
});
