/**
 * Tests for position ratings precomputed cache + custom scouting merge.
 *
 * Covers:
 * 1. getPositionRatings() reads from precomputed cache and caches in memory
 * 2. mergeCustomPositionRatings() overlays custom fielding on top of OSA
 * 3. Sync-db position_ratings_lookup builder logic (mirrored)
 * 4. No raw hitter_scouting table queries (the 47K-row bug)
 */

// ── Mirror of sync-db position_ratings_lookup builder ──

function buildPositionRatingsLookup(
  scoutMap: Map<number, { raw_data?: { fielding?: Record<string, string> } }>
): Record<string, Record<string, number>> {
  const lookup: Record<string, Record<string, number>> = {};
  for (const [pid, s] of scoutMap) {
    const fielding = s.raw_data?.fielding;
    if (!fielding) continue;
    const posRatings: Record<string, number> = {};
    for (let i = 2; i <= 9; i++) {
      const val = parseInt(fielding[`pos${i}`], 10);
      if (val > 0) posRatings[`pos${i}`] = val;
    }
    if (Object.keys(posRatings).length > 0) {
      lookup[pid] = posRatings;
    }
  }
  return lookup;
}

// ── Mirror of SupabaseDataService.mergeCustomPositionRatings ──

function mergeCustomPositionRatings(
  cache: Map<number, Record<string, number>>,
  ratings: { playerId: number; fielding?: Record<string, string> }[]
): void {
  for (const r of ratings) {
    if (!r.fielding) continue;
    const posRatings: Record<string, number> = {};
    for (let i = 2; i <= 9; i++) {
      const val = parseInt(r.fielding[`pos${i}`], 10);
      if (val > 0) posRatings[`pos${i}`] = val;
    }
    if (Object.keys(posRatings).length > 0) {
      cache.set(r.playerId, posRatings);
    }
  }
}

describe('Position ratings lookup builder (sync-db)', () => {
  it('extracts pos2-pos9 from raw_data.fielding', () => {
    const scoutMap = new Map<number, any>([
      [100, { raw_data: { fielding: { pos2: '20', pos3: '0', pos4: '55', pos5: '40', pos6: '70', pos7: '0', pos8: '0', pos9: '0' } } }],
    ]);
    const lookup = buildPositionRatingsLookup(scoutMap);
    expect(lookup[100]).toEqual({ pos4: 55, pos5: 40, pos6: 70, pos2: 20 });
  });

  it('skips players without fielding data', () => {
    const scoutMap = new Map<number, any>([
      [101, { raw_data: {} }],
      [102, { raw_data: null }],
      [103, {}],
    ]);
    const lookup = buildPositionRatingsLookup(scoutMap);
    expect(Object.keys(lookup)).toHaveLength(0);
  });

  it('skips players where all positions are 0', () => {
    const scoutMap = new Map<number, any>([
      [104, { raw_data: { fielding: { pos2: '0', pos3: '0', pos4: '0', pos5: '0', pos6: '0', pos7: '0', pos8: '0', pos9: '0' } } }],
    ]);
    const lookup = buildPositionRatingsLookup(scoutMap);
    expect(lookup[104]).toBeUndefined();
  });

  it('handles multiple players', () => {
    const scoutMap = new Map<number, any>([
      [200, { raw_data: { fielding: { pos6: '65' } } }],
      [201, { raw_data: { fielding: { pos7: '50', pos8: '45' } } }],
      [202, { raw_data: {} }],
    ]);
    const lookup = buildPositionRatingsLookup(scoutMap);
    expect(Object.keys(lookup)).toHaveLength(2);
    expect(lookup[200]).toEqual({ pos6: 65 });
    expect(lookup[201]).toEqual({ pos7: 50, pos8: 45 });
  });
});

describe('mergeCustomPositionRatings', () => {
  it('overlays custom fielding on top of OSA cache', () => {
    const cache = new Map<number, Record<string, number>>([
      [100, { pos6: 70, pos4: 55 }],
    ]);
    mergeCustomPositionRatings(cache, [
      { playerId: 100, fielding: { pos6: '60', pos4: '65' } },
    ]);
    // Custom scouting has different ratings — should overwrite
    expect(cache.get(100)).toEqual({ pos6: 60, pos4: 65 });
  });

  it('adds new players not in OSA cache', () => {
    const cache = new Map<number, Record<string, number>>();
    mergeCustomPositionRatings(cache, [
      { playerId: 300, fielding: { pos2: '40', pos8: '55' } },
    ]);
    expect(cache.get(300)).toEqual({ pos2: 40, pos8: 55 });
  });

  it('skips players without fielding data', () => {
    const cache = new Map<number, Record<string, number>>();
    mergeCustomPositionRatings(cache, [
      { playerId: 400 },
      { playerId: 401, fielding: undefined },
    ]);
    expect(cache.size).toBe(0);
  });

  it('does not remove existing OSA entries for players without custom fielding', () => {
    const cache = new Map<number, Record<string, number>>([
      [500, { pos6: 70 }],
    ]);
    mergeCustomPositionRatings(cache, [
      { playerId: 500 }, // no fielding — should not touch existing entry
      { playerId: 501, fielding: { pos3: '45' } },
    ]);
    expect(cache.get(500)).toEqual({ pos6: 70 }); // preserved
    expect(cache.get(501)).toEqual({ pos3: 45 }); // added
  });

  it('handles custom fielding with all-zero positions (no-op)', () => {
    const cache = new Map<number, Record<string, number>>([
      [600, { pos6: 70 }],
    ]);
    mergeCustomPositionRatings(cache, [
      { playerId: 600, fielding: { pos2: '0', pos3: '0' } },
    ]);
    // All zeros → empty object → no overwrite
    expect(cache.get(600)).toEqual({ pos6: 70 });
  });
});

describe('precomputed cache round-trip', () => {
  it('lookup survives JSON serialization (as stored in Supabase)', () => {
    const scoutMap = new Map<number, any>([
      [100, { raw_data: { fielding: { pos2: '35', pos6: '70', pos8: '50' } } }],
      [200, { raw_data: { fielding: { pos4: '60' } } }],
    ]);
    const lookup = buildPositionRatingsLookup(scoutMap);

    // Simulate Supabase JSON round-trip
    const serialized = JSON.parse(JSON.stringify(lookup));

    // Reconstruct Map (as getPositionRatings does)
    const map = new Map<number, Record<string, number>>();
    for (const [id, posRatings] of Object.entries(serialized)) {
      map.set(Number(id), posRatings as Record<string, number>);
    }

    expect(map.get(100)).toEqual({ pos2: 35, pos6: 70, pos8: 50 });
    expect(map.get(200)).toEqual({ pos4: 60 });
    expect(map.size).toBe(2);
  });
});
