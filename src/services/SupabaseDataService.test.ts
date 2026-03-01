/**
 * Tests for SupabaseDataService column filtering invariants.
 *
 * The real class can't be instantiated in Node (uses import.meta.env),
 * so we mirror the private static column sets and test the filtering contract.
 * Mirror of production sets — update if source changes.
 */

// ── Mirror of SupabaseDataService column whitelists ──

const PITCHING_COLS = new Set([
  'id', 'player_id', 'year', 'team_id', 'game_id', 'league_id', 'level_id', 'split_id',
  'ip', 'ab', 'tb', 'ha', 'k', 'bf', 'rs', 'bb', 'r', 'er', 'gb', 'fb', 'pi', 'ipf',
  'g', 'gs', 'w', 'l', 's', 'sa', 'da', 'sh', 'sf', 'ta', 'hra', 'bk', 'ci', 'iw',
  'wp', 'hp', 'gf', 'dp', 'qs', 'svo', 'bs', 'ra', 'war', 'fip', 'babip', 'whip',
]);

const BATTING_COLS = new Set([
  'id', 'player_id', 'year', 'team_id', 'game_id', 'league_id', 'level_id', 'split_id',
  'position', 'ab', 'h', 'k', 'pa', 'pitches_seen', 'g', 'gs', 'd', 't', 'hr', 'r',
  'rbi', 'sb', 'cs', 'bb', 'ibb', 'gdp', 'sh', 'sf', 'hp', 'ci', 'wpa', 'stint',
  'ubr', 'war',
]);

/** Same logic as SupabaseDataService.filterColumns */
function filterColumns(rows: any[], allowedCols: Set<string>): any[] {
  return rows.map(row => {
    const filtered: any = {};
    for (const key of Object.keys(row)) {
      if (allowedCols.has(key)) filtered[key] = row[key];
    }
    return filtered;
  });
}

describe('SupabaseDataService column filtering', () => {
  describe('PITCHING_COLS exclusions', () => {
    const badCols = ['cg', 'sho', 'hld', 'ir', 'irs', 'wpa', 'li', 'stint', 'outs', 'sd', 'md', 'ra9war', 'sb', 'cs'];

    it.each(badCols)('excludes %s', (col) => {
      expect(PITCHING_COLS.has(col)).toBe(false);
    });
  });

  describe('PITCHING_COLS inclusions', () => {
    const requiredCols = ['player_id', 'year', 'ip', 'k', 'bb', 'hra', 'war', 'er', 'ha', 'g', 'gs', 'w', 'l', 'fip', 'whip'];

    it.each(requiredCols)('includes %s', (col) => {
      expect(PITCHING_COLS.has(col)).toBe(true);
    });
  });

  describe('BATTING_COLS exclusions', () => {
    const badCols = ['avg', 'obp'];

    it.each(badCols)('excludes computed field %s', (col) => {
      expect(BATTING_COLS.has(col)).toBe(false);
    });
  });

  describe('BATTING_COLS inclusions', () => {
    const requiredCols = ['player_id', 'year', 'ab', 'h', 'pa', 'hr', 'war', 'bb', 'k', 'r', 'rbi', 'sb', 'd', 't'];

    it.each(requiredCols)('includes %s', (col) => {
      expect(BATTING_COLS.has(col)).toBe(true);
    });
  });

  describe('filterColumns logic', () => {
    it('strips extra keys, keeps allowed keys', () => {
      const input = [{ player_id: 1, year: 2021, ip: 150, cg: 3, sho: 1, hld: 5, bogus: 'x' }];
      const result = filterColumns(input, PITCHING_COLS);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ player_id: 1, year: 2021, ip: 150 });
      expect(result[0].cg).toBeUndefined();
      expect(result[0].sho).toBeUndefined();
      expect(result[0].hld).toBeUndefined();
      expect(result[0].bogus).toBeUndefined();
    });

    it('preserves all allowed columns', () => {
      const row: any = {};
      for (const col of PITCHING_COLS) row[col] = 42;
      const result = filterColumns([row], PITCHING_COLS);

      expect(Object.keys(result[0]).length).toBe(PITCHING_COLS.size);
    });

    it('handles empty rows', () => {
      expect(filterColumns([], PITCHING_COLS)).toEqual([]);
    });

    it('batting: strips avg and obp from parsed CSV rows', () => {
      const input = [{ player_id: 1, year: 2021, ab: 500, h: 150, avg: 0.300, obp: 0.380, hr: 30 }];
      const result = filterColumns(input, BATTING_COLS);

      expect(result[0].avg).toBeUndefined();
      expect(result[0].obp).toBeUndefined();
      expect(result[0]).toEqual({ player_id: 1, year: 2021, ab: 500, h: 150, hr: 30 });
    });
  });
});
