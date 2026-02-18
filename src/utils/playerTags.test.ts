import {
  computeBatterTags,
  computePitcherTags,
  renderTagsHtml,
  PlayerTag,
  TagContext,
} from './playerTags';
import type { BatterProfileData } from '../views/BatterProfileModal';
import type { PitcherProfileData } from '../views/PitcherProfileModal';

// ============================================================================
// Helpers
// ============================================================================

function makeBatterData(overrides: Partial<BatterProfileData> = {}): BatterProfileData {
  return { playerId: 1, playerName: 'Test', ...overrides };
}

function makePitcherData(overrides: Partial<PitcherProfileData> = {}): PitcherProfileData {
  return { playerId: 1, playerName: 'Test', ...overrides };
}

const emptyCtx: TagContext = { currentSalary: 0 };

// ============================================================================
// Overperformer
// ============================================================================

describe('Overperformer tag', () => {
  test('applied when overall TR > TFR', () => {
    const data = makeBatterData({ trueRating: 3.5, trueFutureRating: 3.0 });
    expect(computeBatterTags(data, emptyCtx).find(t => t.id === 'overperformer')).toBeDefined();
  });

  test('applied even when some TFR components have upside (overall TR still wins)', () => {
    const data = makeBatterData({
      trueRating: 3.5, trueFutureRating: 3.0, hasTfrUpside: true,
    });
    expect(computeBatterTags(data, emptyCtx).find(t => t.id === 'overperformer')).toBeDefined();
  });

  test('not applied when TR <= TFR', () => {
    expect(computeBatterTags(makeBatterData({ trueRating: 3.0, trueFutureRating: 4.0 }), emptyCtx)
      .find(t => t.id === 'overperformer')).toBeUndefined();
    expect(computeBatterTags(makeBatterData({ trueRating: 3.0, trueFutureRating: 3.0 }), emptyCtx)
      .find(t => t.id === 'overperformer')).toBeUndefined();
  });

  test('not applied when TR or TFR is missing', () => {
    expect(computeBatterTags(makeBatterData({ trueRating: 3.5 }), emptyCtx)
      .find(t => t.id === 'overperformer')).toBeUndefined();
    expect(computeBatterTags(makeBatterData({ trueFutureRating: 3.0 }), emptyCtx)
      .find(t => t.id === 'overperformer')).toBeUndefined();
  });

  test('works for pitchers', () => {
    const data = makePitcherData({ trueRating: 3.5, trueFutureRating: 3.0 });
    expect(computePitcherTags(data, emptyCtx).find(t => t.id === 'overperformer')).toBeDefined();
  });
});

// ============================================================================
// Underperformer
// ============================================================================

describe('Underperformer tag', () => {
  test('applied when devRatio >= 0.8 and TFR - TR >= 0.5', () => {
    const data = makeBatterData({
      scoutOvr: 4.0, scoutPot: 4.5, // devRatio = 0.889
      trueRating: 2.5, trueFutureRating: 3.5,
    });
    expect(computeBatterTags(data, emptyCtx).find(t => t.id === 'underperformer')).toBeDefined();
  });

  test('not applied when devRatio < 0.8', () => {
    const data = makeBatterData({
      scoutOvr: 2.0, scoutPot: 4.0, // devRatio = 0.5
      trueRating: 2.5, trueFutureRating: 3.5,
    });
    expect(computeBatterTags(data, emptyCtx).find(t => t.id === 'underperformer')).toBeUndefined();
  });

  test('not applied when TFR - TR < 0.5', () => {
    const data = makeBatterData({
      scoutOvr: 4.0, scoutPot: 4.5,
      trueRating: 3.0, trueFutureRating: 3.0,
    });
    expect(computeBatterTags(data, emptyCtx).find(t => t.id === 'underperformer')).toBeUndefined();
  });
});

// ============================================================================
// Expensive / Bargain
// ============================================================================

describe('Value tags', () => {
  // Sorted ascending $/WAR in raw dollars (best value first)
  const distribution = [
    2_000_000, 4_000_000, 6_000_000, 8_000_000, 10_000_000,
    12_000_000, 14_000_000, 16_000_000, 18_000_000,
  ];

  test('Bargain when $/WAR in top 1/3 (lowest)', () => {
    const ctx: TagContext = {
      currentSalary: 5_000_000,
      leagueDollarPerWar: distribution,
    };
    const data = makeBatterData({ projWar: 4.0 }); // $1.25M/WAR — best value
    expect(computeBatterTags(data, ctx).find(t => t.id === 'bargain')).toBeDefined();
  });

  test('Expensive when $/WAR in bottom 1/3 (highest)', () => {
    const ctx: TagContext = {
      currentSalary: 20_000_000,
      leagueDollarPerWar: distribution,
    };
    const data = makeBatterData({ projWar: 1.0 }); // $20M/WAR — worst value
    expect(computeBatterTags(data, ctx).find(t => t.id === 'expensive')).toBeDefined();
  });

  test('neither tag when salary < $3M', () => {
    const ctx: TagContext = {
      currentSalary: 500_000,
      leagueDollarPerWar: distribution,
    };
    const data = makeBatterData({ projWar: 0.1 });
    const tags = computeBatterTags(data, ctx);
    expect(tags.find(t => t.id === 'expensive')).toBeUndefined();
    expect(tags.find(t => t.id === 'bargain')).toBeUndefined();
  });

  test('neither tag when WAR <= 0.5', () => {
    const ctx: TagContext = {
      currentSalary: 10_000_000,
      leagueDollarPerWar: distribution,
    };
    const data = makeBatterData({ projWar: 0.3 });
    const tags = computeBatterTags(data, ctx);
    expect(tags.find(t => t.id === 'expensive')).toBeUndefined();
    expect(tags.find(t => t.id === 'bargain')).toBeUndefined();
  });

  test('neither tag when distribution is not provided', () => {
    const ctx: TagContext = { currentSalary: 15_000_000 };
    const data = makeBatterData({ projWar: 3.0 });
    const tags = computeBatterTags(data, ctx);
    expect(tags.find(t => t.id === 'expensive')).toBeUndefined();
    expect(tags.find(t => t.id === 'bargain')).toBeUndefined();
  });
});

// ============================================================================
// Ready for Promotion
// ============================================================================

describe('Ready for Promotion tag', () => {
  test('applied for prospect with devRatio >= 0.5 and enough minor PA', () => {
    const data = makeBatterData({
      isProspect: true, scoutOvr: 2.5, scoutPot: 4.0, // devRatio = 0.625
      totalMinorPa: 500,
    });
    expect(computeBatterTags(data, emptyCtx).find(t => t.id === 'ready-for-promotion')).toBeDefined();
  });

  test('not applied for non-prospect', () => {
    const data = makeBatterData({
      isProspect: false, scoutOvr: 3.0, scoutPot: 4.0,
      totalMinorPa: 500,
    });
    expect(computeBatterTags(data, emptyCtx).find(t => t.id === 'ready-for-promotion')).toBeUndefined();
  });

  test('not applied when devRatio < 0.5', () => {
    const data = makeBatterData({
      isProspect: true, scoutOvr: 1.5, scoutPot: 4.0, // devRatio = 0.375
      totalMinorPa: 500,
    });
    expect(computeBatterTags(data, emptyCtx).find(t => t.id === 'ready-for-promotion')).toBeUndefined();
  });

  test('not applied when minor PA < 300', () => {
    const data = makeBatterData({
      isProspect: true, scoutOvr: 3.0, scoutPot: 4.0,
      totalMinorPa: 100,
    });
    expect(computeBatterTags(data, emptyCtx).find(t => t.id === 'ready-for-promotion')).toBeUndefined();
  });

  test('pitcher uses 100 IP threshold', () => {
    const data = makePitcherData({
      isProspect: true, scoutOvr: 3.0, scoutPot: 4.0,
      totalMinorIp: 150,
    });
    expect(computePitcherTags(data, emptyCtx).find(t => t.id === 'ready-for-promotion')).toBeDefined();

    const lowIp = makePitcherData({
      isProspect: true, scoutOvr: 3.0, scoutPot: 4.0,
      totalMinorIp: 50,
    });
    expect(computePitcherTags(lowIp, emptyCtx).find(t => t.id === 'ready-for-promotion')).toBeUndefined();
  });
});

// ============================================================================
// Blocked
// ============================================================================

describe('Blocked tag', () => {
  test('applied for prospect with TFR >= 3.0 and strong incumbent', () => {
    const data = makeBatterData({
      isProspect: true, trueFutureRating: 3.5,
    });
    const ctx: TagContext = {
      currentSalary: 0,
      blockingPlayer: 'Star Veteran',
      blockingRating: 4.0,
      blockingYears: 4,
    };
    expect(computeBatterTags(data, ctx).find(t => t.id === 'blocked')).toBeDefined();
  });

  test('not applied when TFR < 3.0', () => {
    const data = makeBatterData({
      isProspect: true, trueFutureRating: 2.5,
    });
    const ctx: TagContext = {
      currentSalary: 0,
      blockingPlayer: 'Star Veteran',
      blockingRating: 4.0,
      blockingYears: 4,
    };
    expect(computeBatterTags(data, ctx).find(t => t.id === 'blocked')).toBeUndefined();
  });

  test('not applied when incumbent has < 3 years remaining', () => {
    const data = makeBatterData({
      isProspect: true, trueFutureRating: 3.5,
    });
    const ctx: TagContext = {
      currentSalary: 0,
      blockingPlayer: 'Star Veteran',
      blockingRating: 4.0,
      blockingYears: 2,
    };
    expect(computeBatterTags(data, ctx).find(t => t.id === 'blocked')).toBeUndefined();
  });
});

// ============================================================================
// Workhorse
// ============================================================================

describe('Workhorse tag', () => {
  test('batter: applied when projPa >= 650', () => {
    expect(computeBatterTags(makeBatterData({ projPa: 660 }), emptyCtx)
      .find(t => t.id === 'workhorse')).toBeDefined();
  });

  test('batter: not applied when projPa < 650', () => {
    expect(computeBatterTags(makeBatterData({ projPa: 600 }), emptyCtx)
      .find(t => t.id === 'workhorse')).toBeUndefined();
  });

  test('pitcher: applied when projIp >= 190', () => {
    expect(computePitcherTags(makePitcherData({ projIp: 200 }), emptyCtx)
      .find(t => t.id === 'workhorse')).toBeDefined();
  });

  test('pitcher: not applied when projIp < 190', () => {
    expect(computePitcherTags(makePitcherData({ projIp: 170 }), emptyCtx)
      .find(t => t.id === 'workhorse')).toBeUndefined();
  });
});

// ============================================================================
// Combined / Edge Cases
// ============================================================================

describe('Combined tags and edge cases', () => {
  test('player can have multiple tags', () => {
    const data = makeBatterData({
      trueRating: 3.5, trueFutureRating: 3.0,
      projPa: 660,
    });
    const tags = computeBatterTags(data, emptyCtx);
    expect(tags.find(t => t.id === 'overperformer')).toBeDefined();
    expect(tags.find(t => t.id === 'workhorse')).toBeDefined();
  });

  test('empty data returns no tags', () => {
    expect(computeBatterTags(makeBatterData(), emptyCtx)).toEqual([]);
    expect(computePitcherTags(makePitcherData(), emptyCtx)).toEqual([]);
  });
});

// ============================================================================
// renderTagsHtml
// ============================================================================

describe('renderTagsHtml', () => {
  test('returns empty string for no tags', () => {
    expect(renderTagsHtml([])).toBe('');
  });

  test('renders pill badges with correct classes', () => {
    const tags: PlayerTag[] = [
      { id: 'test', label: 'Test', color: 'green', tooltip: 'A tooltip' },
    ];
    const html = renderTagsHtml(tags);
    expect(html).toContain('player-tags-row');
    expect(html).toContain('player-tag tag-green');
    expect(html).toContain('Test');
    expect(html).toContain('title="A tooltip"');
  });

  test('renders multiple tags', () => {
    const tags: PlayerTag[] = [
      { id: 'a', label: 'A', color: 'green', tooltip: '' },
      { id: 'b', label: 'B', color: 'amber', tooltip: '' },
    ];
    const html = renderTagsHtml(tags);
    expect(html).toContain('tag-green');
    expect(html).toContain('tag-amber');
  });
});
