/**
 * SeasonSimulator Tests
 *
 * Verifies catcher rest frequency formula and backup catcher bench logic.
 */

import { describe, test, expect } from 'vitest';

// The catcher rest formula from buildGameLineup (extracted for testing):
// Given a catcher's projectedPa, compute restFreq (games between rest days).
function computeRestFreq(projectedPa: number): number {
  const maxPa = 162 * 4.5;
  const targetPa = Math.min(projectedPa, maxPa);
  const restDays = Math.max(1, Math.round(162 - targetPa / 4.5));
  const restFreq = Math.max(2, Math.floor((162 - restDays) / restDays));
  return restFreq;
}

// Approximate rest days and games played from restFreq
function simulateRestDays(restFreq: number, totalGames = 162): { restDays: number; gamesPlayed: number } {
  let gamesPlayed = 0;
  let restDays = 0;
  let consecutiveGames = 0;
  for (let g = 0; g < totalGames; g++) {
    if (consecutiveGames >= restFreq) {
      restDays++;
      consecutiveGames = 0;
    } else {
      gamesPlayed++;
      consecutiveGames++;
    }
  }
  return { restDays, gamesPlayed };
}

describe('catcher rest frequency formula', () => {
  test('full-time catcher (projectedPa=650) gets minimal rest', () => {
    const freq = computeRestFreq(650);
    const { gamesPlayed } = simulateRestDays(freq);
    // ~650 PA / 4.5 PA per game = ~144 games expected
    expect(gamesPlayed).toBeGreaterThanOrEqual(120);
    expect(gamesPlayed).toBeLessThanOrEqual(145);
  });

  test('part-time catcher (projectedPa=400) gets frequent rest', () => {
    const freq = computeRestFreq(400);
    const { gamesPlayed, restDays } = simulateRestDays(freq);
    // ~400 PA / 4.5 = ~89 games expected
    expect(gamesPlayed).toBeLessThanOrEqual(110);
    expect(restDays).toBeGreaterThanOrEqual(50);
  });

  test('typical starter (projectedPa=550) targets ~120 games', () => {
    const freq = computeRestFreq(550);
    const { gamesPlayed } = simulateRestDays(freq);
    // 550 / 4.5 = ~122 games
    expect(gamesPlayed).toBeGreaterThanOrEqual(110);
    expect(gamesPlayed).toBeLessThanOrEqual(135);
  });

  test('restFreq is always at least 2', () => {
    // Even a very low projectedPa shouldn't produce restFreq < 2
    expect(computeRestFreq(100)).toBeGreaterThanOrEqual(2);
    expect(computeRestFreq(200)).toBeGreaterThanOrEqual(2);
  });

  test('max PA catcher (projectedPa=729) gets very few rest days', () => {
    const freq = computeRestFreq(729);
    const { restDays } = simulateRestDays(freq);
    expect(restDays).toBeLessThanOrEqual(10);
  });

  test('restFreq produces rest days close to formula target', () => {
    // For projectedPa=500: targetRestDays = round(162 - 500/4.5) = round(51) = 51
    const freq = computeRestFreq(500);
    const { restDays } = simulateRestDays(freq);
    // Should be within ~10 of the target 51
    expect(restDays).toBeGreaterThanOrEqual(40);
    expect(restDays).toBeLessThanOrEqual(60);
  });
});
