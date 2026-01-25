import { PitcherScoutingRatings } from '../models/ScoutingData';
import { scoutingDataService } from '../services/ScoutingDataService';
import { trueRatingsCalculationService } from '../services/TrueRatingsCalculationService';
import { TruePlayerStats, TruePlayerBattingStats, trueRatingsService } from '../services/TrueRatingsService';
import { PlayerProfileModal, PlayerProfileData } from './PlayerProfileModal';
import { RatingEstimatorService } from '../services/RatingEstimatorService';
import { playerService } from '../services/PlayerService';
import { teamService } from '../services/TeamService';
import { trueFutureRatingService } from '../services/TrueFutureRatingService';
import { minorLeagueStatsService } from '../services/MinorLeagueStatsService';
import { MinorLeagueStatsWithLevel } from '../models/Stats';

type StatsMode = 'pitchers' | 'batters';

interface DerivedPitchingFields {
  ipOuts: number;
  kPer9: number;
  bbPer9: number;
  hraPer9: number;
}

interface TrueRatingFields {
  trueRating?: number;
  percentile?: number;
  fipLike?: number;
  estimatedStuff?: number;
  estimatedControl?: number;
  estimatedHra?: number;
  scoutOverall?: number;
  estimatedOverall?: number;
  scoutDiff?: number;
  /** True Future Rating for prospects */
  trueFutureRating?: number;
  tfrPercentile?: number;
  /** Flag indicating this is a prospect without MLB stats */
  isProspect?: boolean;
  /** Star gap (POT - OVR) for prospects */
  starGap?: number;
  prospectHasStats?: boolean;
  prospectLevel?: MinorLeagueStatsWithLevel['level'];
}

interface TeamInfoFields {
  teamDisplay?: string;
  teamFilter?: string;
  teamIsMajor?: boolean;
}

type PitcherRow = TruePlayerStats & DerivedPitchingFields & TrueRatingFields & TeamInfoFields;
type BatterRow = TruePlayerBattingStats & TeamInfoFields;
type TableRow = PitcherRow | BatterRow;

interface PitcherColumn {
  key: keyof PitcherRow | string;
  label: string;
  sortKey?: keyof PitcherRow | string;
  accessor?: (row: PitcherRow) => any;
}

interface ScoutingLookup {
  byId: Map<number, PitcherScoutingRatings>;
  byName: Map<string, PitcherScoutingRatings[]>;
}

const RAW_PITCHER_COLUMNS: PitcherColumn[] = [
  { key: 'playerName', label: 'Name' },
  { key: 'ip', label: 'IP', sortKey: 'ipOuts' },
  { key: 'k', label: 'K' },
  { key: 'bb', label: 'BB' },
  { key: 'hra', label: 'HR' },
  { key: 'r', label: 'R' },
  { key: 'er', label: 'ER' },
  { key: 'war', label: 'WAR' },
  { key: 'ra9war', label: 'Ra9WAR' },
  { key: 'wpa', label: 'WPA' },
  { key: 'kPer9', label: 'K/9' },
  { key: 'bbPer9', label: 'BB/9' },
  { key: 'hraPer9', label: 'HR/9' },
];

export class TrueRatingsView {
  private container: HTMLElement;
  private stats: TableRow[] = [];
  private currentPage = 1;
  private itemsPerPage = 50;
  private itemsPerPageSelection: '10' | '50' | '200' | 'all' = '50';
  private selectedYear = 2020;
  private selectedTeam = 'all';
  private teamOptions: string[] = [];
  private yearOptions = Array.from({ length: 22 }, (_, i) => 2021 - i); // 2021 down to 2000
  private sortKey: string | null = 'ra9war';
  private sortDirection: 'asc' | 'desc' = 'desc';
  private mode: StatsMode = 'pitchers';
  private showTrueRatings = true;
  private showRawStats = false;
  private showProspects = true;
  private showMlbPlayers = true;
  private allStats: TableRow[] = [];
  private readonly prefKey = 'wbl-prefs';
  private preferences: Record<string, unknown> = {};
  private pitcherColumns: PitcherColumn[] = [];
  private isDraggingColumn = false;
  private scoutingRatings: PitcherScoutingRatings[] = [];
  private rawPitcherStats: PitcherRow[] = [];
  private playerProfileModal: PlayerProfileModal;
  private scoutingLookup: ScoutingLookup | null = null;
  private playerRowLookup: Map<number, PitcherRow> = new Map();

  constructor(container: HTMLElement) {
    this.container = container;
    this.preferences = this.loadPreferences();
    this.playerProfileModal = new PlayerProfileModal();
    this.updatePitcherColumns();
    this.renderLayout();
    this.loadScoutingRatingsForYear();
    this.fetchAndRenderStats();
  }

  private renderLayout(): void {
    this.container.innerHTML = `
      <div class="true-ratings-content">
        <div class="draft-header">
            <h2 class="view-title">True Player Ratings</h2>
            <div class="toggle-group" role="tablist" aria-label="Stats type">
                <button class="toggle-btn active" data-mode="pitchers" role="tab" aria-selected="true">Pitchers</button>
                <button class="toggle-btn" data-mode="batters" role="tab" aria-selected="false">Batters</button>
            </div>
        </div>
        <div class="true-ratings-controls">
          <div class="form-field">
            <label for="true-ratings-year">Year:</label>
            <select id="true-ratings-year">
              ${this.yearOptions.map(year => `<option value="${year}" ${year === this.selectedYear ? 'selected' : ''}>${year}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label for="true-ratings-team">Team:</label>
            <select id="true-ratings-team">
              <option value="all">All</option>
            </select>
          </div>
          <div class="form-field">
            <label for="items-per-page">Per Page:</label>
            <select id="items-per-page">
              <option value="10">10</option>
              <option value="50" selected>50</option>
              <option value="200">200</option>
              <option value="all">All</option>
            </select>
          </div>
          <div class="form-field" id="ratings-view-toggle">
            <label>View:</label>
            <div class="toggle-group" role="group" aria-label="Ratings view">
              <button class="toggle-btn ${this.showRawStats ? 'active' : ''}" data-ratings-toggle="raw" aria-pressed="${this.showRawStats}">Raw Stats</button>
              <button class="toggle-btn ${this.showTrueRatings ? 'active' : ''}" data-ratings-toggle="true" aria-pressed="${this.showTrueRatings}">True Ratings</button>
              <button class="toggle-btn ${this.showMlbPlayers ? 'active' : ''}" data-player-toggle="mlb" aria-pressed="${this.showMlbPlayers}">MLB Players</button>
              <button class="toggle-btn ${this.showProspects ? 'active' : ''}" data-player-toggle="prospect" aria-pressed="${this.showProspects}">Prospects</button>
            </div>
          </div>
        </div>
        
        <div class="scout-upload-notice" id="scouting-notice" style="display: none; margin-bottom: 1rem;">
            No scouting data found. <button class="btn-link" id="go-to-data-mgmt">Manage Data</button>
        </div>

        <div class="ratings-help-text">
          <p>* <strong>Estimated Ratings</strong> (visible when hovering over K/9, BB/9, HR/9) are snapshots based solely on that single stat. <strong>True Ratings</strong> use sophisticated multi-year analysis and regression.</p>
        </div>
        <div id="true-ratings-table-container"></div>
        <div class="pagination-controls">
          <button id="prev-page" disabled>Previous</button>
          <span id="page-info"></span>
          <button id="next-page" disabled>Next</button>
        </div>
      </div>
      <div class="modal-overlay" id="scouting-missing-modal" aria-hidden="true">
        <div class="modal">
          <div class="modal-header">
            <h3 class="modal-title">Missing scouting data</h3>
            <button type="button" class="modal-close" id="scouting-missing-close" aria-label="Close">x</button>
          </div>
          <div class="modal-body" id="scouting-missing-body"></div>
        </div>
      </div>
    `;

    this.bindEventListeners();
  }

  private bindEventListeners(): void {
    this.container.querySelector('#true-ratings-year')?.addEventListener('change', (e) => {
      this.selectedYear = parseInt((e.target as HTMLSelectElement).value, 10);
      this.currentPage = 1;
      this.loadScoutingRatingsForYear();
      this.fetchAndRenderStats();
    });

    this.container.querySelector('#items-per-page')?.addEventListener('change', (e) => {
      const value = (e.target as HTMLSelectElement).value as '10' | '50' | '200' | 'all';
      this.itemsPerPageSelection = value;
      this.itemsPerPage = value === 'all' ? this.stats.length : parseInt(value, 10);
      this.currentPage = 1;
      this.renderStats();
    });

    this.container.querySelector('#true-ratings-team')?.addEventListener('change', (e) => {
      this.selectedTeam = (e.target as HTMLSelectElement).value;
      this.currentPage = 1;
      this.applyFiltersAndRender();
    });

    this.container.querySelector('#prev-page')?.addEventListener('click', () => {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.renderStats();
      }
    });

    this.container.querySelector('#next-page')?.addEventListener('click', () => {
      const totalPages = this.itemsPerPage === this.stats.length ? 1 : Math.ceil(this.stats.length / this.itemsPerPage);
      if (this.currentPage < totalPages) {
        this.currentPage++;
        this.renderStats();
      }
    });

    this.container.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const newMode = btn.dataset.mode as StatsMode | undefined;
        if (!newMode || this.mode === newMode) return;
        this.mode = newMode;
        this.sortKey = this.mode === 'pitchers' ? 'ra9war' : 'war';
        this.sortDirection = 'desc';
        this.container.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.updateRatingsControlsVisibility();
        this.updateScoutingUploadVisibility();
        this.fetchAndRenderStats();
      });
    });

    this.bindRatingsViewToggle();
    this.bindPlayerTypeToggle();
    this.updateRatingsControlsVisibility();

    const goToDataLink = this.container.querySelector<HTMLButtonElement>('#go-to-data-mgmt');
    goToDataLink?.addEventListener('click', () => {
        const tabBtn = document.querySelector<HTMLButtonElement>('[data-tab-target="tab-data-management"]');
        tabBtn?.click();
    });
  }

  private bindRatingsViewToggle(): void {
    const buttons = this.container.querySelectorAll<HTMLButtonElement>('[data-ratings-toggle]');
    buttons.forEach(button => {
      button.addEventListener('click', () => {
        const toggle = button.dataset.ratingsToggle;
        if (toggle === 'raw') {
          const nextRaw = !this.showRawStats;
          if (!nextRaw && !this.showTrueRatings) return;
          this.showRawStats = nextRaw;
        } else if (toggle === 'true') {
          const nextTrue = !this.showTrueRatings;
          if (!nextTrue && !this.showRawStats) return;
          this.showTrueRatings = nextTrue;
        } else {
          return;
        }

        buttons.forEach(btn => {
          const key = btn.dataset.ratingsToggle;
          const isActive = key === 'raw' ? this.showRawStats : this.showTrueRatings;
          btn.classList.toggle('active', isActive);
          btn.setAttribute('aria-pressed', String(isActive));
        });

        this.updatePitcherColumns();
        this.updateRatingsControlsVisibility();
        this.fetchAndRenderStats();
      });
    });
  }

  private bindPlayerTypeToggle(): void {
    const buttons = this.container.querySelectorAll<HTMLButtonElement>('[data-player-toggle]');
    buttons.forEach(button => {
      button.addEventListener('click', () => {
        const toggle = button.dataset.playerToggle;
        if (toggle === 'prospect') {
          const nextProspects = !this.showProspects;
          if (!nextProspects && !this.showMlbPlayers) return;
          this.showProspects = nextProspects;
        } else if (toggle === 'mlb') {
          const nextMlb = !this.showMlbPlayers;
          if (!nextMlb && !this.showProspects) return;
          this.showMlbPlayers = nextMlb;
        } else {
          return;
        }

        buttons.forEach(btn => {
          const key = btn.dataset.playerToggle;
          const isActive = key === 'prospect' ? this.showProspects : this.showMlbPlayers;
          btn.classList.toggle('active', isActive);
          btn.setAttribute('aria-pressed', String(isActive));
        });

        this.applyFiltersAndRender();
      });
    });
  }

  private updateRatingsControlsVisibility(): void {
    const viewToggle = this.container.querySelector<HTMLElement>('#ratings-view-toggle');
    if (viewToggle) viewToggle.style.display = this.mode === 'pitchers' ? '' : 'none';
  }

  private async fetchAndRenderStats(): Promise<void> {
    const tableContainer = this.container.querySelector<HTMLElement>('#true-ratings-table-container')!;
    const isTrueRatingsView = this.mode === 'pitchers' && this.showTrueRatings;
    tableContainer.innerHTML = `<div class="loading-message">${isTrueRatingsView ? 'Calculating true ratings...' : 'Loading stats...'}</div>`;
    
    try {
      if (this.mode === 'pitchers') {
        const pitchingStats = await trueRatingsService.getTruePitchingStats(this.selectedYear);
        this.rawPitcherStats = this.withDerivedPitchingFields(pitchingStats);
        
        await this.enrichWithTeamData(this.rawPitcherStats);

        if (isTrueRatingsView || this.showProspects) {
          this.stats = await this.buildTrueRatingsStats(this.rawPitcherStats);
        } else {
          this.stats = this.rawPitcherStats;
        }
      } else {
        const battingStats = await trueRatingsService.getTrueBattingStats(this.selectedYear);
        const enrichedStats = battingStats as BatterRow[];
        await this.enrichWithTeamData(enrichedStats);
        this.stats = enrichedStats;
      }
      this.allStats = [...this.stats];
      this.updateTeamOptions();
      this.applyFilters();
      this.updateItemsPerPageForFilter();
      this.updatePitcherColumns();
      this.sortStats();
      this.updateScoutingStatus();
      this.renderStats();
    } catch (error) {
      console.error(error);
      tableContainer.innerHTML = `<div class="error-message">Failed to load stats. ${error}</div>`;
    }
  }

  private async enrichWithTeamData(rows: (PitcherRow | BatterRow)[]): Promise<void> {
    try {
      const [allPlayers, allTeams] = await Promise.all([
        playerService.getAllPlayers(),
        teamService.getAllTeams()
      ]);

      const playerMap = new Map(allPlayers.map(p => [p.id, p]));
      const teamMap = new Map(allTeams.map(t => [t.id, t]));

      rows.forEach(row => {
        const playerId = (row as any).player_id;
        const player = playerMap.get(playerId);
        if (!player) return;

        const team = teamMap.get(player.teamId);
        if (!team) return;

        if (player.parentTeamId !== 0) {
          const parent = teamMap.get(player.parentTeamId);
          if (parent) {
            row.teamDisplay = `${parent.nickname} <span class="minor-team">(${team.nickname})</span>`;
            row.teamFilter = parent.nickname;
            row.teamIsMajor = false;
            return;
          }
        }
        
        row.teamDisplay = team.nickname;
        row.teamFilter = team.nickname;
        row.teamIsMajor = true;
      });
    } catch (err) {
      console.error('Error enriching team data:', err);
    }
  }

  private renderStats(): void {
    const tableContainer = this.container.querySelector<HTMLElement>('#true-ratings-table-container')!;
    if (this.stats.length === 0) {
      tableContainer.innerHTML = `<p class="no-stats">No ${this.mode} stats found for this year.</p>`;
      this.updatePaginationControls(0);
      return;
    }

    const paginatedStats = this.getPaginatedStats();
    tableContainer.innerHTML = this.renderTable(paginatedStats);
    this.updatePaginationControls(this.stats.length);
    this.bindSortHeaders();
    this.bindScrollButtons();
    this.bindPitcherColumnDragAndDrop();
    this.bindPlayerNameClicks();
    this.bindFlipCardLocking();
  }

  private applyFilters(): void {
    this.stats = this.allStats.filter(row => {
      if (this.mode === 'pitchers') {
        const isProspect = Boolean((row as PitcherRow).isProspect);
        if (isProspect && !this.showProspects) return false;
        if (!isProspect && !this.showMlbPlayers) return false;
      }
      if (this.selectedTeam === 'all') return true;
      const teamValue = (row as TeamInfoFields).teamFilter ?? '';
      return teamValue === this.selectedTeam;
    });
  }

  private applyFiltersAndRender(): void {
    this.applyFilters();
    this.updateItemsPerPageForFilter();
    this.sortStats();
    this.renderStats();
  }

  private updateItemsPerPageForFilter(): void {
    if (this.itemsPerPageSelection === 'all') {
      this.itemsPerPage = this.stats.length;
      return;
    }
    if (this.stats.length > 0 && this.itemsPerPage > this.stats.length) {
      this.itemsPerPage = this.stats.length;
    }
  }

  private updatePitcherColumns(): void {
    const columns = this.getPitcherColumnsForView();
    this.pitcherColumns = this.applyPitcherColumnOrder(columns);
    this.ensureSortKeyForView();
  }

  private getPitcherColumnsForView(): PitcherColumn[] {
    if (this.mode !== 'pitchers') {
      const [nameColumn, ...rest] = RAW_PITCHER_COLUMNS;
      return [
        nameColumn,
        { key: 'teamDisplay', label: 'Team', sortKey: 'teamDisplay' },
        ...rest
      ];
    }

    const [nameColumn, ...rest] = RAW_PITCHER_COLUMNS;
    const columns: PitcherColumn[] = [nameColumn];
    
    // Add Team column
    columns.push({ key: 'teamDisplay', label: 'Team', sortKey: 'teamDisplay' });

    if (this.showTrueRatings) {
      columns.push(...this.getTrueRatingColumns());
      if (this.scoutingRatings.length > 0) {
        columns.push(...this.getScoutingComparisonColumns());
      }
      columns.push(...this.getEstimatedRatingColumns());
    }

    if (this.showRawStats) {
      columns.push(...rest);
    }

    return columns;
  }

  private getPaginatedStats(): TableRow[] {
      if (this.itemsPerPage === this.stats.length) {
          return this.stats;
      }
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = this.currentPage * this.itemsPerPage;
    return this.stats.slice(startIndex, endIndex);
  }

  private withDerivedPitchingFields(pitchingStats: TruePlayerStats[]): PitcherRow[] {
    return pitchingStats.map(stat => {
      const outs = this.parseIpToOuts(stat.ip);
      const innings = outs / 3;
      return {
        ...stat,
        ipOuts: outs,
        kPer9: this.calculatePer9(stat.k, innings),
        bbPer9: this.calculatePer9(stat.bb, innings),
        hraPer9: this.calculatePer9(stat.hra, innings),
      };
    });
  }

  private async buildTrueRatingsStats(pitchers: PitcherRow[]): Promise<PitcherRow[]> {
    const [multiYearStats, leagueAverages] = await Promise.all([
      trueRatingsService.getMultiYearPitchingStats(this.selectedYear, 3),
      trueRatingsService.getLeagueAverages(this.selectedYear),
    ]);

    const scoutingLookup = this.buildScoutingLookup(this.scoutingRatings);
    this.scoutingLookup = scoutingLookup;
    const scoutingMatchMap = new Map<number, PitcherScoutingRatings>();

    const inputs = pitchers.map((pitcher) => {
      const scouting = this.resolveScoutingRating(pitcher, scoutingLookup);
      if (scouting) {
        scoutingMatchMap.set(pitcher.player_id, scouting);
      }
      return {
        playerId: pitcher.player_id,
        playerName: pitcher.playerName,
        yearlyStats: multiYearStats.get(pitcher.player_id) ?? [],
        scoutingRatings: scouting,
      };
    });

    const results = trueRatingsCalculationService.calculateTrueRatings(inputs, leagueAverages);
    const resultMap = new Map(results.map(result => [result.playerId, result]));

    const enrichedPitchers: PitcherRow[] = pitchers.map((pitcher) => {
      const result = resultMap.get(pitcher.player_id);
      if (!result) return pitcher;
      const scouting = scoutingMatchMap.get(pitcher.player_id);
      const estimatedOverall = this.averageRating(result.estimatedStuff, result.estimatedControl, result.estimatedHra);
      const scoutOverall = scouting ? this.averageRating(scouting.stuff, scouting.control, scouting.hra) : undefined;
      const scoutDiff =
        scoutOverall !== undefined ? Math.round(scoutOverall - estimatedOverall) : undefined;

      return {
        ...pitcher,
        trueRating: result.trueRating,
        percentile: result.percentile,
        fipLike: result.fipLike,
        estimatedStuff: result.estimatedStuff,
        estimatedControl: result.estimatedControl,
        estimatedHra: result.estimatedHra,
        estimatedOverall,
        scoutOverall,
        scoutDiff,
        isProspect: false,
      };
    });

    // Find prospects (scouting entries without MLB stats)
    const mlbPlayerIds = new Set(pitchers.map(p => p.player_id));
    const prospects = await this.buildProspectRows(mlbPlayerIds, results);

    // Merge MLB pitchers with prospects
    const allPitchers = [...enrichedPitchers, ...prospects];

    // Build player row lookup for modal access
    this.playerRowLookup = new Map(allPitchers.map(p => [p.player_id, p]));

    return allPitchers;
  }

  /**
   * Build prospect rows for players with scouting data but no MLB stats.
   * These rows will have isProspect=true and show TFR instead of TR.
   */
  private async buildProspectRows(
    mlbPlayerIds: Set<number>,
    mlbTrueRatings: { playerId: number; fipLike: number }[]
  ): Promise<PitcherRow[]> {
    // Find scouting entries not in MLB stats
    const prospectScouting = this.scoutingRatings.filter(s =>
      s.playerId > 0 && !mlbPlayerIds.has(s.playerId)
    );

    if (prospectScouting.length === 0) {
      return [];
    }

    // Get MLB FIPs for percentile calculation
    const mlbFips = mlbTrueRatings.map(tr => tr.fipLike + 3.47);

    // Build TFR inputs for prospects
    const tfrInputs = prospectScouting.map(scouting => {
      const minorStats = minorLeagueStatsService.getPlayerStats(
        scouting.playerId,
        this.selectedYear - 2,
        this.selectedYear
      );

      return {
        playerId: scouting.playerId,
        playerName: scouting.playerName ?? `Player ${scouting.playerId}`,
        age: scouting.age ?? 22,
        scouting,
        minorLeagueStats: minorStats,
      };
    });

    // Calculate TFR for all prospects
    const tfrResults = trueFutureRatingService.calculateTrueFutureRatings(tfrInputs, mlbFips);
    const tfrMap = new Map(tfrResults.map(r => [r.playerId, r]));

    // Fetch player/team data for prospects
    const [allPlayers, allTeams] = await Promise.all([
      playerService.getAllPlayers(),
      teamService.getAllTeams()
    ]);
    const playerMap = new Map(allPlayers.map(p => [p.id, p]));
    const teamMap = new Map(allTeams.map(t => [t.id, t]));

    // Build prospect rows
    const prospectRows: PitcherRow[] = [];

      for (const scouting of prospectScouting) {
        const tfr = tfrMap.get(scouting.playerId);
        if (!tfr) continue;

        const player = playerMap.get(scouting.playerId);
        let teamDisplay = '';
        let teamFilter = '';
        let teamIsMajor = false;

        const seasonStats = this.getHighestMinorLeagueStats(
          minorLeagueStatsService.getPlayerStats(scouting.playerId, this.selectedYear, this.selectedYear)
        );

        if (player) {
          const team = teamMap.get(player.teamId);
          if (team) {
            if (player.parentTeamId !== 0) {
              const parent = teamMap.get(player.parentTeamId);
            if (parent) {
              teamDisplay = `${parent.nickname} <span class="minor-team">(${team.nickname})</span>`;
              teamFilter = parent.nickname;
            }
          } else {
            teamDisplay = team.nickname;
            teamFilter = team.nickname;
            teamIsMajor = true;
          }
        }
        }

        const scoutOverall = this.averageRating(scouting.stuff, scouting.control, scouting.hra);
        const prospectHasStats = Boolean(seasonStats);
        const prospectIp = seasonStats?.ip ?? 0;
        const prospectOuts = prospectHasStats ? this.parseIpToOuts(prospectIp) : 0;
        const prospectK = seasonStats?.k ?? 0;
        const prospectBb = seasonStats?.bb ?? 0;
        const prospectHr = seasonStats?.hr ?? 0;
        const prospectK9 = seasonStats?.k9 ?? (prospectIp > 0 ? (prospectK / prospectIp) * 9 : 0);
        const prospectBb9 = seasonStats?.bb9 ?? (prospectIp > 0 ? (prospectBb / prospectIp) * 9 : 0);
        const prospectHr9 = seasonStats?.hr9 ?? (prospectIp > 0 ? (prospectHr / prospectIp) * 9 : 0);

        // Create a prospect row with placeholder stats
        // Cast to PitcherRow - we only need the fields we display
        const prospectRow = {
          // Required TruePlayerStats fields (will show as "-")
          player_id: scouting.playerId,
          playerName: scouting.playerName ?? `Player ${scouting.playerId}`,
          ip: prospectHasStats ? prospectIp.toFixed(1) : '0',
          k: prospectK,
          bb: prospectBb,
          hra: prospectHr,
          r: 0,
          er: 0,
          war: 0,
          ra9war: 0,
          wpa: 0,
          gs: 0,
          // Derived fields
          ipOuts: prospectOuts,
          kPer9: prospectK9,
          bbPer9: prospectBb9,
          hraPer9: prospectHr9,
          // Team info
          teamDisplay,
          teamFilter,
          teamIsMajor,
          // True Ratings fields - use TFR
          trueFutureRating: tfr.trueFutureRating,
          tfrPercentile: tfr.percentile,
          fipLike: tfr.projFip - 3.47, // Convert back to FIP-like (without constant)
          estimatedStuff: Math.round((tfr.projK9 - 2.07) / 0.074),
          estimatedControl: Math.round((5.22 - tfr.projBb9) / 0.052),
          estimatedHra: Math.round((2.08 - tfr.projHr9) / 0.024),
          scoutOverall,
          starGap: tfr.starGap,
          isProspect: true,
          prospectHasStats,
          prospectLevel: seasonStats?.level,
        } as PitcherRow;

      prospectRows.push(prospectRow);
    }

    return prospectRows;
  }

  private getHighestMinorLeagueStats(
    stats: MinorLeagueStatsWithLevel[]
  ): MinorLeagueStatsWithLevel | null {
    if (stats.length === 0) return null;
    const levelRank: Record<MinorLeagueStatsWithLevel['level'], number> = {
      aaa: 4,
      aa: 3,
      a: 2,
      r: 1,
    };

    let best = stats[0];
    for (const current of stats) {
      if (levelRank[current.level] > levelRank[best.level]) {
        best = current;
      }
    }
    return best;
  }

  private buildScoutingLookup(ratings: PitcherScoutingRatings[]): ScoutingLookup {
    const byId = new Map<number, PitcherScoutingRatings>();
    const byName = new Map<string, PitcherScoutingRatings[]>();

    ratings.forEach((rating) => {
      if (rating.playerId > 0) {
        byId.set(rating.playerId, rating);
      }

      if (rating.playerName) {
        const normalized = this.normalizeName(rating.playerName);
        if (!normalized) return;
        const list = byName.get(normalized) ?? [];
        list.push(rating);
        byName.set(normalized, list);
      }
    });

    return { byId, byName };
  }

  private resolveScoutingRating(pitcher: PitcherRow, lookup: ScoutingLookup): PitcherScoutingRatings | undefined {
    const byId = lookup.byId.get(pitcher.player_id);
    if (byId) return byId;

    const normalized = this.normalizeName(pitcher.playerName);
    const matches = lookup.byName.get(normalized);
    if (!matches || matches.length !== 1) return undefined;
    return matches[0];
  }

  private averageRating(stuff: number, control: number, hra: number): number {
    return Math.round((stuff + control + hra) / 3);
  }

  private parseIpToOuts(ip: string | number): number {
    const [fullInnings = '0', partialOuts = '0'] = String(ip).split('.');
    const inningsValue = parseInt(fullInnings, 10);
    const partialValue = parseInt(partialOuts, 10);

    if (Number.isNaN(inningsValue) || Number.isNaN(partialValue)) {
      return 0;
    }

    return (inningsValue * 3) + partialValue;
  }

  private calculatePer9(count: number, innings: number): number {
    if (!Number.isFinite(count) || innings <= 0) return 0;
    return (count / innings) * 9;
  }

  private applyPitcherColumnOrder(columns: PitcherColumn[]): PitcherColumn[] {
    const rawOrder = this.preferences.trueRatingsPitcherColumns;
    if (!Array.isArray(rawOrder) || rawOrder.length === 0) {
      return [...columns];
    }

    const ordered: PitcherColumn[] = [];
    const lookup = new Map(columns.map(column => [String(column.key), column]));

    for (const key of rawOrder) {
      if (typeof key !== 'string') continue;
      const column = lookup.get(key);
      if (column) {
        ordered.push(column);
        lookup.delete(key);
      }
    }

    ordered.push(...lookup.values());
    return ordered;
  }

  private updatePreferences(partial: Record<string, unknown>): void {
    if (typeof window === 'undefined') return;
    const current = this.loadPreferences();
    const merged = { ...current, ...partial };
    this.preferences = merged;
    try {
      localStorage.setItem(this.prefKey, JSON.stringify(merged));
    } catch {
      // ignore storage errors
    }
  }

  private loadPreferences(): Record<string, unknown> {
    if (typeof window === 'undefined') return {};
    try {
      const raw = localStorage.getItem(this.prefKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  private renderTable(stats: TableRow[]): string {
    if (stats.length === 0) return '';
    if (this.mode === 'pitchers') {
      return this.renderPitcherTable(stats as PitcherRow[]);
    }
    return this.renderBattersTable(stats as BatterRow[]);
  }

  private renderPitcherTable(stats: PitcherRow[]): string {
    const headerRow = this.pitcherColumns.map(column => {
      const sortKey = column.sortKey ?? column.key;
      const activeClass = this.sortKey === sortKey ? 'sort-active' : '';
      return `<th data-sort-key="${sortKey}" data-col-key="${column.key}" class="${activeClass}" draggable="true">${column.label}</th>`;
    }).join('');

    const rows = stats.map(player => {
      const isProspect = player.isProspect === true;
      const prospectHasStats = Boolean(player.prospectHasStats);
      const cells = this.pitcherColumns.map(column => {
        const rawValue = column.accessor ? column.accessor(player) : (player as any)[column.key];
        const columnKey = String(column.key);

        if (isProspect) {
          const prospectAllowedStatKeys = ['ip', 'k', 'bb', 'hra'];
          const prospectUnavailableStatKeys = ['r', 'er', 'war', 'ra9war', 'wpa'];
          if (prospectUnavailableStatKeys.includes(columnKey)) {
            return `<td data-col-key="${column.key}" class="prospect-stat">—</td>`;
          }
          if (prospectAllowedStatKeys.includes(columnKey) && !prospectHasStats) {
            return `<td data-col-key="${column.key}" class="prospect-stat">—</td>`;
          }
        }

        const displayValue = this.formatValue(rawValue, String(column.key));

        if (column.key === 'kPer9' || column.key === 'bbPer9' || column.key === 'hraPer9') {
          if (isProspect && !prospectHasStats) {
            return `<td data-col-key="${column.key}" class="prospect-stat">—</td>`;
          }
          const ip = player.ipOuts / 3;
          let rating = 0;
          let title = '';
          if (column.key === 'kPer9') {
            rating = RatingEstimatorService.estimateStuff(player.kPer9, ip).rating;
            title = 'Estimated Stuff Rating*';
          } else if (column.key === 'bbPer9') {
            rating = RatingEstimatorService.estimateControl(player.bbPer9, ip).rating;
            title = 'Estimated Control Rating*';
          } else if (column.key === 'hraPer9') {
            rating = RatingEstimatorService.estimateHRA(player.hraPer9, ip).rating;
            title = 'Estimated HRA Rating*';
          }
          return `<td data-col-key="${column.key}">${this.renderFlipCell(displayValue, rating.toString(), title)}</td>`;
        }

        // Make player name clickable only in True Ratings view
        if (column.key === 'playerName' && this.showTrueRatings) {
          const prospectBadge = isProspect ? ' <span class="prospect-badge">P</span>' : '';
          return `<td data-col-key="${column.key}"><button class="btn-link player-name-link" data-player-id="${player.player_id}">${displayValue}${prospectBadge}</button></td>`;
        }

        return `<td data-col-key="${column.key}">${displayValue}</td>`;
      }).join('');
      const rowClass = isProspect ? 'prospect-row' : '';
      return `<tr class="${rowClass}">${cells}</tr>`;
    }).join('');

    return `
      <div class="table-wrapper-outer">
        <button class="scroll-btn scroll-btn-left" aria-label="Scroll left"></button>
        <div class="table-wrapper">
          <table class="stats-table true-ratings-table">
            <thead>
              <tr>
                ${headerRow}
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
        <button class="scroll-btn scroll-btn-right" aria-label="Scroll right"></button>
      </div>
    `;
  }

  private renderFlipCell(front: string, back: string, title: string): string {
    return `
      <div class="flip-cell">
        <div class="flip-cell-inner">
          <div class="flip-cell-front">${front}</div>
          <div class="flip-cell-back">
            ${back}
            <span class="flip-tooltip">${title}</span>
          </div>
        </div>
      </div>
    `;
  }

  private bindFlipCardLocking(): void {
    const cells = this.container.querySelectorAll<HTMLElement>('.flip-cell');
    cells.forEach((cell) => {
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        cell.classList.toggle('is-flipped');
      });
    });
  }

  private renderBattersTable(stats: BatterRow[]): string {
    const batterExcludedKeys = ['ci', 'd', 'game_id', 'id', 'league_id', 'level_id', 'pitches_seen', 'position', 'sf', 'sh', 'split_id', 'stint', 't', 'teamDisplay'];
    const excludedKeys = ['id', 'player_id', 'team_id', 'game_id', 'league_id', 'level_id', 'split_id', 'year', ...batterExcludedKeys];
    let headers = Object.keys(stats[0]).filter(key => !excludedKeys.includes(key));
    
    headers = headers.filter(h => h !== 'playerName');
    headers.unshift('teamDisplay');
    headers.unshift('playerName');

    const headerRow = headers.map(header => {
      const activeClass = this.sortKey === header ? 'sort-active' : '';
      const label = header === 'teamDisplay' ? 'Team' : this.formatHeader(header);
      return `<th data-sort-key="${header}" data-col-key="${header}" class="${activeClass}">${label}</th>`;
    }).join('');
    
    const rows = stats.map(s => {
      const cells = headers.map(header => {
        const value: any = (s as any)[header];
        return `<td data-col-key="${header}">${this.formatValue(value, header)}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    return `
      <div class="table-wrapper-outer">
        <button class="scroll-btn scroll-btn-left" aria-label="Scroll left"></button>
        <div class="table-wrapper">
          <table class="stats-table true-ratings-table">
            <thead>
              <tr>
                ${headerRow}
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
        <button class="scroll-btn scroll-btn-right" aria-label="Scroll right"></button>
      </div>
    `;
  }

  private bindScrollButtons(): void {
        const wrapper = this.container.querySelector<HTMLElement>('.table-wrapper-outer');
        if (!wrapper) return;

        const tableWrapper = wrapper.querySelector<HTMLElement>('.table-wrapper');
        const scrollLeftBtn = wrapper.querySelector<HTMLButtonElement>('.scroll-btn-left');
        const scrollRightBtn = wrapper.querySelector<HTMLButtonElement>('.scroll-btn-right');

        if (!tableWrapper || !scrollLeftBtn || !scrollRightBtn) return;

        const handleScroll = () => {
            const { scrollLeft, scrollWidth, clientWidth } = tableWrapper;
            const canScrollLeft = scrollLeft > 0;
            const canScrollRight = scrollLeft < scrollWidth - clientWidth -1;
            
            scrollLeftBtn.classList.toggle('visible', canScrollLeft);
            scrollRightBtn.classList.toggle('visible', canScrollRight);
        };
        
        wrapper.addEventListener('mouseenter', handleScroll);
        wrapper.addEventListener('mouseleave', () => {
            scrollLeftBtn.classList.remove('visible');
            scrollRightBtn.classList.remove('visible');
        });
        tableWrapper.addEventListener('scroll', handleScroll);

        scrollLeftBtn.addEventListener('click', () => {
            tableWrapper.scrollBy({ left: -200, behavior: 'smooth' });
        });

        scrollRightBtn.addEventListener('click', () => {
            tableWrapper.scrollBy({ left: 200, behavior: 'smooth' });
        });

        handleScroll();
    }

  private bindSortHeaders(): void {
    const headers = this.container.querySelectorAll<HTMLElement>('[data-sort-key]');
    headers.forEach(header => {
      header.addEventListener('click', (e) => {
        if (this.isDraggingColumn) return;
        const key = header.dataset.sortKey;
        if (!key) return;

        if (this.sortKey === key) {
          this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortKey = key;
          this.sortDirection = 'desc';
        }
        this.showSortHint(e as MouseEvent);
        this.sortStats();
        this.renderStats();
      });
    });
  }

  private bindPitcherColumnDragAndDrop(): void {
    if (this.mode !== 'pitchers') return;
    const headers = this.container.querySelectorAll<HTMLTableCellElement>('.true-ratings-table th[data-col-key]');
    let draggedKey: string | null = null;

    headers.forEach(header => {
      header.addEventListener('dragstart', (e) => {
        draggedKey = header.dataset.colKey ?? null;
        this.isDraggingColumn = true;
        header.classList.add('dragging');
        this.applyColumnClass(draggedKey, 'dragging-col', true);
        if (draggedKey) {
          e.dataTransfer?.setData('text/plain', draggedKey);
        }
        e.dataTransfer?.setDragImage(header, 10, 10);
      });

      header.addEventListener('dragover', (e) => {
        if (!draggedKey) return;
        e.preventDefault();
        const targetKey = header.dataset.colKey;
        if (!targetKey || targetKey === draggedKey) {
          this.clearDropIndicators();
          return;
        }
        const rect = header.getBoundingClientRect();
        const isBefore = e.clientX < rect.left + rect.width / 2;
        this.updateDropIndicator(targetKey, isBefore ? 'before' : 'after');
      });

      header.addEventListener('drop', (e) => {
        e.preventDefault();
        const targetKey = header.dataset.colKey;
        const position = header.dataset.dropPosition as 'before' | 'after' | undefined;
        if (!draggedKey || !targetKey || draggedKey === targetKey) {
          draggedKey = null;
          this.clearDropIndicators();
          return;
        }
        this.reorderPitcherColumns(draggedKey, targetKey, position ?? 'before');
        draggedKey = null;
        this.clearDropIndicators();
      });

      header.addEventListener('dragend', () => {
        header.classList.remove('dragging');
        this.applyColumnClass(draggedKey, 'dragging-col', false);
        draggedKey = null;
        this.clearDropIndicators();
        setTimeout(() => {
          this.isDraggingColumn = false;
        }, 0);
      });
    });
  }

  private reorderPitcherColumns(draggedKey: string, targetKey: string, position: 'before' | 'after'): void {
    const fromIndex = this.pitcherColumns.findIndex(column => String(column.key) === draggedKey);
    const toIndex = this.pitcherColumns.findIndex(column => String(column.key) === targetKey);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

    const nextColumns = [...this.pitcherColumns];
    const [moved] = nextColumns.splice(fromIndex, 1);
    let insertIndex = position === 'after' ? toIndex + 1 : toIndex;
    if (fromIndex < insertIndex) {
      insertIndex -= 1;
    }
    nextColumns.splice(insertIndex, 0, moved);
    this.pitcherColumns = nextColumns;
    this.updatePreferences({ trueRatingsPitcherColumns: nextColumns.map(column => String(column.key)) });
    this.renderStats();
  }

  private updateDropIndicator(targetKey: string, position: 'before' | 'after'): void {
    this.clearDropIndicators();
    const cells = this.container.querySelectorAll<HTMLElement>(`.true-ratings-table [data-col-key="${targetKey}"]`);
    cells.forEach(cell => {
      cell.dataset.dropPosition = position;
      cell.classList.add(position === 'before' ? 'drop-before' : 'drop-after');
    });
  }

  private clearDropIndicators(): void {
    const cells = this.container.querySelectorAll<HTMLElement>('.true-ratings-table .drop-before, .true-ratings-table .drop-after');
    cells.forEach(cell => {
      cell.classList.remove('drop-before', 'drop-after');
      delete cell.dataset.dropPosition;
    });
  }

  private applyColumnClass(columnKey: string | null, className: string, add: boolean): void {
    if (!columnKey) return;
    const cells = this.container.querySelectorAll<HTMLElement>(`.true-ratings-table [data-col-key="${columnKey}"]`);
    cells.forEach(cell => cell.classList.toggle(className, add));
  }

  private sortStats(): void {
    if (!this.sortKey) return;
    const key = this.sortKey;

    this.stats.sort((a, b) => {
      let aVal = (a as any)[key];
      let bVal = (b as any)[key];

      // For trueRating sort, use trueFutureRating for prospects
      if (key === 'trueRating') {
        const aRow = a as PitcherRow;
        const bRow = b as PitcherRow;
        if (aRow.isProspect) aVal = aRow.trueFutureRating;
        if (bRow.isProspect) bVal = bRow.trueFutureRating;
      }

      // For percentile sort, use tfrPercentile for prospects
      if (key === 'percentile') {
        const aRow = a as PitcherRow;
        const bRow = b as PitcherRow;
        if (aRow.isProspect) aVal = aRow.tfrPercentile;
        if (bRow.isProspect) bVal = bRow.tfrPercentile;
      }

      let compare = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        compare = (aVal ?? 0) - (bVal ?? 0);
      } else {
        const aString = aVal !== undefined && aVal !== null ? String(aVal) : '';
        const bString = bVal !== undefined && bVal !== null ? String(bVal) : '';
        compare = aString.localeCompare(bString);
      }

      return this.sortDirection === 'asc' ? compare : -compare;
    });
  }
  
  private formatValue(value: any, key: string): string {
    if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        return value.toString();
      }
      const threeDecimalKeys = ['avg', 'obp'];
      return threeDecimalKeys.includes(key.toLowerCase()) ? value.toFixed(3) : value.toFixed(2);
    }

    return value ?? '';
  }

  private formatHeader(header: string): string {
    return header
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .replace(/_id/g, '')
      .replace(/^ip$/, 'IP')
      .replace(/^ha$/, 'H')
      .replace(/^er$/, 'ER')
      .replace(/^k$/, 'K')
      .replace(/^hr$/, 'HR')
      .replace(/^war$/, 'WAR')
      .replace(/^bb$/, 'BB')
      .replace(/^obp$/, 'OBP')
      .replace(/^avg$/, 'AVG')
      .replace(/^\w/, c => c.toUpperCase())
      .trim();
  }

  private getTrueRatingColumns(): PitcherColumn[] {
    return [
      {
        key: 'trueRating',
        label: 'TR',
        sortKey: 'trueRating',
        accessor: (row) => {
          // For prospects, show TFR instead of TR
          if (row.isProspect) {
            return this.renderTrueFutureRatingBadge(row.trueFutureRating);
          }
          return this.renderTrueRatingBadge(row.trueRating);
        },
      },
      {
        key: 'percentile',
        label: '%',
        sortKey: 'percentile',
        accessor: (row) => {
          // For prospects, show TFR percentile
          const pct = row.isProspect ? row.tfrPercentile : row.percentile;
          return typeof pct === 'number' ? pct.toFixed(1) : '';
        },
      },
      { key: 'fipLike', label: 'FIP*' },
    ];
  }

  private getEstimatedRatingColumns(): PitcherColumn[] {
    return [
      { key: 'estimatedStuff', label: 'True Stuff' },
      { key: 'estimatedControl', label: 'True Con' },
      { key: 'estimatedHra', label: 'True HRA' },
    ];
  }

  private getScoutingComparisonColumns(): PitcherColumn[] {
    return [
      {
        key: 'scoutDiff',
        label: 'Scout Δ',
        sortKey: 'scoutDiff',
        accessor: (row) => this.renderScoutComparison(row),
      },
    ];
  }

  private renderTrueRatingBadge(value?: number): string {
    if (typeof value !== 'number') return '';
    const className = this.getTrueRatingClass(value);
    return `<span class="badge ${className}">${value.toFixed(1)}</span>`;
  }

  private renderTrueFutureRatingBadge(value?: number): string {
    if (typeof value !== 'number') return '';
    const className = this.getTrueRatingClass(value);
    // TFR badge has a different style to indicate it's a projection
    return `<span class="badge ${className} tfr-badge" title="True Future Rating (Projected)">${value.toFixed(1)}</span>`;
  }

  private getTrueRatingClass(value: number): string {
    if (value >= 4.5) return 'rating-elite';
    if (value >= 4.0) return 'rating-plus';
    if (value >= 3.0) return 'rating-avg';
    if (value >= 2.0) return 'rating-fringe';
    return 'rating-poor';
  }

  private renderScoutComparison(row: PitcherRow): string {
    if (typeof row.estimatedOverall !== 'number' || typeof row.scoutOverall !== 'number') {
      return '';
    }
    const diff = row.scoutDiff ?? 0;
    const diffText = diff > 0 ? `+${diff}` : `${diff}`;
    const className = diff > 0 ? 'war-positive' : diff < 0 ? 'war-negative' : '';
    const detail = `${row.estimatedOverall}/${row.scoutOverall} (${diffText})`;
    const title = `Est ${row.estimatedOverall}, Scout ${row.scoutOverall}`;
    return `<span class="${className}" title="${title}">${detail}</span>`;
  }

  private showSortHint(event: MouseEvent): void {
    const arrow = document.createElement('div');
    arrow.className = 'sort-fade-hint';
    arrow.textContent = this.sortDirection === 'asc' ? '⬆️' : '⬇️';
    const offset = 16;
    arrow.style.left = `${event.clientX + offset}px`;
    arrow.style.top = `${event.clientY - offset}px`;
    document.body.appendChild(arrow);

    requestAnimationFrame(() => {
      arrow.classList.add('visible');
    });

    setTimeout(() => {
      arrow.classList.add('fade');
      arrow.addEventListener('transitionend', () => arrow.remove(), { once: true });
      setTimeout(() => arrow.remove(), 800);
    }, 900);
  }

  private updatePaginationControls(totalItems: number): void {
    const totalPages = this.itemsPerPage === totalItems ? 1 : Math.ceil(totalItems / this.itemsPerPage);
    const pageInfo = this.container.querySelector<HTMLElement>('#page-info')!;
    const prevButton = this.container.querySelector<HTMLButtonElement>('#prev-page')!;
    const nextButton = this.container.querySelector<HTMLButtonElement>('#next-page')!;

    if (totalPages <= 1) {
        pageInfo.textContent = '';
        prevButton.disabled = true;
        nextButton.disabled = true;
        return;
    }
    
    pageInfo.textContent = `Page ${this.currentPage} of ${totalPages}`;
    prevButton.disabled = this.currentPage === 1;
    nextButton.disabled = this.currentPage === totalPages;
  }

  private loadScoutingRatingsForYear(): void {
    this.scoutingRatings = scoutingDataService.getLatestScoutingRatings('my');
    // this.updateScoutingUploadLabel(); // Removed
    this.updatePitcherColumns();
    this.updateScoutingStatus();
  }

  private updateScoutingUploadVisibility(): void {
    const notice = this.container.querySelector<HTMLElement>('#scouting-notice');
    if (!notice) return;
    
    // Show notice if pitching mode and no scouting data
    if (this.mode === 'pitchers' && this.scoutingRatings.length === 0) {
        notice.style.display = 'block';
    } else {
        notice.style.display = 'none';
    }
  }

  private updateScoutingStatus(): void {
    // This function used to update the upload status text. 
    // Now it primarily serves to check missing players if data exists, or trigger visibility updates.
    this.updateScoutingUploadVisibility();
  }

  private ensureSortKeyForView(): void {
    if (this.mode !== 'pitchers') return;
    const availableKeys = new Set<string>();
    this.pitcherColumns.forEach(column => {
      availableKeys.add(String(column.key));
      if (column.sortKey) {
        availableKeys.add(String(column.sortKey));
      }
    });

    if (this.sortKey && availableKeys.has(this.sortKey)) {
      return;
    }

    if (this.showTrueRatings) {
      this.sortKey = 'trueRating';
      this.sortDirection = 'desc';
      return;
    }

    if (this.showRawStats) {
      this.sortKey = 'ra9war';
      this.sortDirection = 'desc';
    }
  }

  private normalizeName(name: string): string {
    const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
    const cleaned = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const tokens = cleaned.split(/\s+/).filter((token) => token && !suffixes.has(token));
    return tokens.join('');
  }

  private bindPlayerNameClicks(): void {
    if (this.mode !== 'pitchers' || !this.showTrueRatings) return;

    const links = this.container.querySelectorAll<HTMLButtonElement>('.player-name-link');
    links.forEach(link => {
      link.addEventListener('click', (e) => {
        e.stopPropagation();
        const playerId = parseInt(link.dataset.playerId ?? '', 10);
        if (!playerId) return;
        this.openPlayerProfile(playerId);
      });
    });
  }

  private async openPlayerProfile(playerId: number): Promise<void> {
    const row = this.playerRowLookup.get(playerId);
    if (!row) return;

    const scouting = this.scoutingLookup ? this.resolveScoutingRating(row, this.scoutingLookup) : undefined;

    // Fetch team info
    const player = await playerService.getPlayerById(playerId);
    let teamLabel = '';
    let parentLabel = '';
    
    if (player) {
      const team = await teamService.getTeamById(player.teamId);
      if (team) {
        teamLabel = `${team.name} ${team.nickname}`;
        if (team.parentTeamId !== 0) {
          const parent = await teamService.getTeamById(team.parentTeamId);
          if (parent) {
            parentLabel = parent.nickname;
          }
        }
      }
    }

    const profileData: PlayerProfileData = {
      playerId: row.player_id,
      playerName: row.playerName,
      team: teamLabel,
      parentTeam: parentLabel,
      trueRating: row.trueRating,
      percentile: row.percentile,
      estimatedStuff: row.estimatedStuff,
      estimatedControl: row.estimatedControl,
      estimatedHra: row.estimatedHra,
      scoutStuff: scouting?.stuff,
      scoutControl: scouting?.control,
      scoutHra: scouting?.hra,
      scoutStamina: scouting?.stamina,
      scoutInjuryProneness: scouting?.injuryProneness,
      scoutOvr: scouting?.ovr,
      scoutPot: scouting?.pot,
      // TFR fields for prospects
      trueFutureRating: row.trueFutureRating,
      tfrPercentile: row.tfrPercentile,
      starGap: row.starGap,
      isProspect: row.isProspect,
    };

    await this.playerProfileModal.show(profileData, this.selectedYear);
  }

  private updateTeamOptions(): void {
    const select = this.container.querySelector<HTMLSelectElement>('#true-ratings-team');
    if (!select) return;

    const options = new Set<string>();
    this.allStats.forEach(row => {
      const teamInfo = row as TeamInfoFields;
      if (!teamInfo.teamIsMajor) return;
      const teamValue = teamInfo.teamFilter;
      if (teamValue) options.add(teamValue);
    });

    this.teamOptions = Array.from(options).sort((a, b) => a.localeCompare(b));
    if (this.selectedTeam !== 'all' && !this.teamOptions.includes(this.selectedTeam)) {
      this.selectedTeam = 'all';
    }

    select.innerHTML = [
      '<option value="all">All</option>',
      ...this.teamOptions.map(team => `<option value="${team}">${team}</option>`)
    ].join('');
    select.value = this.selectedTeam;
  }
}
