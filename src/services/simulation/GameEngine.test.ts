/**
 * GameEngine Defense Tests
 *
 * Verifies that computeDefensiveShift produces correct BABIP shifts
 * from projected defensive runs (defRuns), excluding DH.
 */

import { computeDefensiveShift } from './GameEngine';
import type { BatterSnapshot } from './SimulationTypes';

function makeBatter(position: string, defRuns: number): BatterSnapshot {
  return {
    playerId: 1,
    name: 'Test',
    position,
    pBB: 0.08, pK: 0.20, pHR: 0.03, pTriple: 0.005, pDouble: 0.04, pSingle: 0.20, pOut: 0.445,
    projectedPa: 600,
    injuryTier: 'Normal',
    speed: 50,
    stealAggression: 50,
    stealAbility: 50,
    woba: 0.320,
    positionRating: 50,
    defRuns,
  };
}

describe('computeDefensiveShift', () => {
  test('all-zero defRuns returns 0 shift', () => {
    const lineup = [
      makeBatter('C', 0), makeBatter('1B', 0), makeBatter('2B', 0),
      makeBatter('SS', 0), makeBatter('3B', 0), makeBatter('LF', 0),
      makeBatter('CF', 0), makeBatter('RF', 0), makeBatter('DH', 0),
    ];
    expect(computeDefensiveShift(lineup)).toBeCloseTo(0, 5);
  });

  test('positive defRuns returns positive shift (good defense)', () => {
    const lineup = [
      makeBatter('C', 5), makeBatter('1B', 5), makeBatter('2B', 5),
      makeBatter('SS', 5), makeBatter('3B', 5), makeBatter('LF', 5),
      makeBatter('CF', 5), makeBatter('RF', 5), makeBatter('DH', 5),
    ];
    const shift = computeDefensiveShift(lineup);
    expect(shift).toBeGreaterThan(0);
    // 8 fielders × 5 = 40 (DH excluded), 40 / 1000 = 0.040
    expect(shift).toBeCloseTo(0.040, 3);
  });

  test('negative defRuns returns negative shift (bad defense)', () => {
    const lineup = [
      makeBatter('C', -5), makeBatter('1B', -5), makeBatter('2B', -5),
      makeBatter('SS', -5), makeBatter('3B', -5), makeBatter('LF', -5),
      makeBatter('CF', -5), makeBatter('RF', -5), makeBatter('DH', -5),
    ];
    const shift = computeDefensiveShift(lineup);
    expect(shift).toBeLessThan(0);
    expect(shift).toBeCloseTo(-0.040, 3);
  });

  test('DH defRuns is excluded', () => {
    // All zeros except DH at -10 — should still be 0
    const lineup = [
      makeBatter('C', 0), makeBatter('1B', 0), makeBatter('2B', 0),
      makeBatter('SS', 0), makeBatter('3B', 0), makeBatter('LF', 0),
      makeBatter('CF', 0), makeBatter('RF', 0), makeBatter('DH', -10),
    ];
    expect(computeDefensiveShift(lineup)).toBeCloseTo(0, 5);
  });

  test('mixed lineup sums correctly (DH excluded)', () => {
    const lineup = [
      makeBatter('SS', 10), makeBatter('1B', -5), makeBatter('2B', 0),
      makeBatter('3B', 0), makeBatter('C', 0), makeBatter('LF', 0),
      makeBatter('CF', 0), makeBatter('RF', 0), makeBatter('DH', -7),
    ];
    const shift = computeDefensiveShift(lineup);
    // Team total = 10 + (-5) = 5 (DH's -7 excluded), shift = 5/1000
    expect(shift).toBeCloseTo(5 / 1000, 4);
  });
});
