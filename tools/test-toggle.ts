/**
 * Quick sanity test: current/peak toggle produces different projections.
 * Run: npx tsx tools/test-toggle.ts
 */
import { computeBatterProjection } from '../src/services/ModalDataService';
import type { BatterProfileData, BatterProjectionDeps } from '../src/services/ModalDataService';

// Mock a prospect with very different current vs peak ratings
const data = {
  isProspect: true, hasTfrUpside: true, trueRating: undefined,
  estimatedPower: 45, estimatedEye: 50, estimatedAvoidK: 55, estimatedContact: 51,
  estimatedGap: 50, estimatedSpeed: 50,
  tfrPower: 65, tfrEye: 60, tfrAvoidK: 70, tfrContact: 78,
  tfrGap: 55, tfrSpeed: 55,
  tfrAvg: 0.298, tfrObp: 0.370, tfrSlg: 0.480,
  tfrBbPct: 10.5, tfrKPct: 15.0, tfrHrPct: 3.2, tfrPa: 640,
  // Cached proj* values = TFR-peak (the poison that should be stripped in current mode)
  projAvg: 0.298, projObp: 0.370, projSlg: 0.480,
  projWar: 4.5, projWoba: 0.370, projPa: 640,
  projBbPct: 10.5, projKPct: 15.0, projHrPct: 3.2,
  age: 25,
} as unknown as BatterProfileData;

function makeDeps(mode: 'current' | 'peak'): BatterProjectionDeps {
  return {
    projectionMode: mode, projectionYear: 2022,
    leagueAvg: null, scoutingData: null,
    expectedBbPct: (e) => 4 + e * 0.12,
    expectedKPct: (a) => 35 - a * 0.25,
    expectedAvg: (c) => 0.180 + c * 0.0018,
    expectedHrPct: (p) => p * 0.06,
    expectedDoublesRate: (g) => 0.02 + g * 0.0004,
    expectedTriplesRate: (s) => 0.001 + s * 0.00006,
    getProjectedPa: () => 580,
    getProjectedPaWithHistory: () => 580,
    calculateOpsPlus: () => 100,
    computeWoba: (bb, avg, _d, _t, hr) => avg + bb * 0.3 + hr * 2,
    calculateBaserunningRuns: () => 0,
    calculateBattingWar: (woba, pa) => ((woba - 0.320) * pa / 10),
    projectStolenBases: () => ({ sb: 5, cs: 2 }),
  } as unknown as BatterProjectionDeps;
}

const current = computeBatterProjection(data, [], makeDeps('current'));
const peak = computeBatterProjection(data, [], makeDeps('peak'));

console.log('Current (contact=51):', 'AVG', current.projAvg.toFixed(3), 'WAR', current.projWar.toFixed(1), 'PA', current.projPa);
console.log('Peak    (contact=78):', 'AVG', peak.projAvg.toFixed(3), 'WAR', peak.projWar.toFixed(1), 'PA', peak.projPa);

let pass = true;
if (current.projAvg === peak.projAvg) { console.log('FAIL: AVG identical'); pass = false; }
if (current.projWar === peak.projWar) { console.log('FAIL: WAR identical'); pass = false; }
if (current.projPa === peak.projPa) { console.log('FAIL: PA identical'); pass = false; }
if (current.projAvg >= peak.projAvg) { console.log('FAIL: current AVG >= peak AVG (should be lower)'); pass = false; }
if (current.projWar >= peak.projWar) { console.log('FAIL: current WAR >= peak WAR (should be lower)'); pass = false; }
if (current.isPeakMode) { console.log('FAIL: current mode has isPeakMode=true'); pass = false; }
if (!peak.isPeakMode) { console.log('FAIL: peak mode has isPeakMode=false'); pass = false; }

console.log(pass ? '\n✅ All checks passed' : '\n❌ Some checks failed');
process.exit(pass ? 0 : 1);
