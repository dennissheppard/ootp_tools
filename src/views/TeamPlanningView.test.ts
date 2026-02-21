jest.mock('../services/AnalyticsService', () => ({
  analyticsService: { trackTeamSelected: jest.fn(), trackPlayerProfileOpened: jest.fn() },
}));

jest.mock('./BatterProfileModal', () => ({
  batterProfileModal: { show: jest.fn() },
}));

jest.mock('./PitcherProfileModal', () => ({
  pitcherProfileModal: { show: jest.fn() },
}));

import { TeamPlanningView } from './TeamPlanningView';
import { indexedDBService, TeamPlanningOverrideRecord } from '../services/IndexedDBService';
import { Player, Position } from '../models/Player';

type AnyView = TeamPlanningView & Record<string, any>;

function createViewStub(): AnyView {
  const view = Object.create(TeamPlanningView.prototype) as AnyView;
  view.selectedTeamId = 1;
  view.gameYear = 2021;
  view.gridRows = [];
  view.playerMap = new Map<number, Player>();
  view.contractMap = new Map();
  view.overrides = new Map<string, TeamPlanningOverrideRecord>();
  view.devOverrides = new Map<number, number>();
  view.playerRatingMap = new Map<number, number>();
  view.playerTfrMap = new Map<number, number>();
  view.prospectCurrentRatingMap = new Map<number, number>();
  view.canonicalPitcherTrMap = new Map<number, number>();
  view.canonicalBatterTrMap = new Map<number, number>();
  view.playerAgeMap = new Map<number, number>();
  view.playerServiceYearsMap = new Map<number, number>();
  view.tradeFlags = new Map<number, 'tradeable' | 'not-tradeable'>();
  view.needOverrides = new Set<string>();
  view.salaryOverrides = new Map<string, number>();
  view.buildAndRenderGrid = jest.fn().mockResolvedValue(undefined);
  view.cellEditModal = { show: jest.fn() };
  return view;
}

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 99,
    firstName: 'Test',
    lastName: 'Player',
    teamId: 1,
    parentTeamId: 1,
    level: 1,
    position: Position.Pitcher,
    role: 0,
    age: 27,
    retired: false,
    ...overrides,
  };
}

function makeCell(overrides: Record<string, any> = {}): any {
  return {
    playerId: null,
    playerName: '',
    age: 0,
    rating: 0,
    salary: 0,
    contractStatus: 'empty',
    ...overrides,
  };
}

describe('TeamPlanningView regressions', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('resolveBestKnownRating returns highest value across canonical/grid/prospect maps', () => {
    const view = createViewStub();

    view.playerRatingMap.set(99, 0.5);
    view.prospectCurrentRatingMap.set(99, 1.0);
    view.playerTfrMap.set(99, 3.5);
    view.canonicalPitcherTrMap.set(99, 4.0);
    view.gridRows = [
      {
        position: 'MR1',
        section: 'bullpen',
        cells: new Map([
          [2021, makeCell({ playerId: 99, playerName: 'Test Player', age: 27, rating: 4.5, contractStatus: 'under-contract' })],
        ]),
      },
    ];

    expect(view.resolveBestKnownRating(99, 2021)).toBe(4.5);
    expect(view.resolveBestKnownRating(99)).toBe(4.0);
  });

  test('org-select clears prior same-year slot and persists resolved non-0.5 rating', async () => {
    const view = createViewStub();
    const saveSpy = jest.spyOn(indexedDBService, 'saveTeamPlanningOverrides').mockResolvedValue(undefined);

    const player = makePlayer({ id: 501 });
    view.playerMap.set(player.id, player);
    view.playerRatingMap.set(player.id, 0.5); // stale value
    view.canonicalPitcherTrMap.set(player.id, 4.5); // canonical fallback should win

    view.gridRows = [
      {
        position: 'MR1',
        section: 'bullpen',
        cells: new Map([[2021, makeCell({ playerId: player.id, playerName: 'Test Player', age: 27, rating: 4.5, contractStatus: 'under-contract' })]]),
      },
      {
        position: 'MR5',
        section: 'bullpen',
        cells: new Map([[2021, makeCell()]]),
      },
    ];

    await view.processEditResult(
      { action: 'org-select', player, sourceType: 'org' },
      'MR5',
      2021
    );

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const saved = saveSpy.mock.calls[0][0] as TeamPlanningOverrideRecord[];

    const clearedOriginal = saved.find(r => r.position === 'MR1' && r.year === 2021);
    const insertedTarget = saved.find(r => r.position === 'MR5' && r.year === 2021);

    expect(clearedOriginal).toBeDefined();
    expect(clearedOriginal?.playerId).toBeNull();
    expect(clearedOriginal?.contractStatus).toBe('empty');

    expect(insertedTarget).toBeDefined();
    expect(insertedTarget?.playerId).toBe(player.id);
    expect(insertedTarget?.rating).toBe(4.5);
  });

  test('handleCellClick passes resolved rating map to org picker modal', async () => {
    const view = createViewStub();
    const player = makePlayer({ id: 777 });

    view.playerMap.set(player.id, player);
    view.playerRatingMap.set(player.id, 0.5); // stale list value
    view.canonicalPitcherTrMap.set(player.id, 4.5); // resolved value expected in picker
    view.gridRows = [
      {
        position: 'MR5',
        section: 'bullpen',
        cells: new Map([[2021, makeCell()]]),
      },
    ];

    view.cellEditModal.show = jest.fn().mockResolvedValue({ action: 'cancel' });

    await view.handleCellClick('MR5', 2021);

    expect(view.cellEditModal.show).toHaveBeenCalledTimes(1);
    const ratingMapArg = view.cellEditModal.show.mock.calls[0][4] as Map<number, number>;
    expect(ratingMapArg.get(player.id)).toBe(4.5);
  });
});
