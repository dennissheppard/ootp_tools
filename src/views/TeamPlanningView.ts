import { teamService } from '../services/TeamService';
import { dateService } from '../services/DateService';
import { playerService } from '../services/PlayerService';
import { contractService, Contract } from '../services/ContractService';
import { trueRatingsService, LEAGUE_START_YEAR } from '../services/TrueRatingsService';
import { teamRatingsService, TeamPowerRanking, RatedPitcher, RatedBatter, RatedHitterProspect, RatedProspect } from '../services/TeamRatingsService';
import { RosterGap } from '../services/DraftValueService';
import { indexedDBService, TeamPlanningOverrideRecord } from '../services/IndexedDBService';
import { CellEditModal, CellEditContext, CellEditResult } from './CellEditModal';
import { MessageModal } from './MessageModal';
import { batterProfileModal, BatterProfileData } from './BatterProfileModal';
import { pitcherProfileModal, PitcherProfileData } from './PitcherProfileModal';
import { Team } from '../models/Team';
import { Player, getPositionLabel } from '../models/Player';

// --- Types ---

type IndicatorType = 'CLIFF' | 'EXT' | 'FA' | 'TR' | 'EXPENSIVE' | 'TRADE' | 'FA_TARGET' | 'UPGRADE';

interface CellIndicator {
  type: IndicatorType;
  label: string;
  tooltip: string;
}

interface GridCell {
  playerId: number | null;
  playerName: string;
  age: number;
  rating: number;
  salary: number;
  contractStatus: 'under-contract' | 'final-year' | 'arb-eligible' | 'empty' | 'minor-league' | 'prospect';
  level?: string;
  isProspect?: boolean;
  isMinContract?: boolean;
  isOverride?: boolean;
  overrideSourceType?: string;
  indicators?: CellIndicator[];
}

interface GridRow {
  position: string;
  section: 'lineup' | 'rotation' | 'bullpen';
  cells: Map<number, GridCell>;
}

interface YearFinancials {
  year: number;
  lineupTotal: number;
  rotationTotal: number;
  bullpenTotal: number;
  grandTotal: number;
}

interface PositionAssessment {
  position: string;
  section: 'lineup' | 'rotation' | 'bullpen';
  category: 'strength' | 'need' | 'extension';
  detail: string;
  targetPosition: string;
  targetYear: number;
}

// --- Trade Market Types ---

interface SurplusProspect {
  playerId: number;
  name: string;
  position: number;
  positionLabel: string;
  tfr: number;
  age: number;
  level: string;
  orgId: number;
  orgName: string;
  blockingPlayer: string;
  blockingRating: number;
  blockingYears: number;
  isPitcher: boolean;
}

interface SurplusMlbPlayer {
  playerId: number;
  name: string;
  positionLabel: string;
  trueRating: number;
  age: number;
  contractYearsRemaining: number;
  isExpiring: boolean;
  orgId: number;
  orgName: string;
  isPitcher: boolean;
  replacementName: string;
  replacementTfr: number;
}

interface TeamNeed {
  position: string;
  section: 'lineup' | 'rotation' | 'bullpen';
  severity: 'critical' | 'moderate';
  bestCurrentRating: number;
  playerName: string;
}

interface TeamTradeProfile {
  teamId: number;
  teamName: string;
  needs: TeamNeed[];
  surplusProspects: SurplusProspect[];
  surplusMlbPlayers: SurplusMlbPlayer[];
}

interface TradeMatchDetail {
  name: string;
  positionLabel: string;
  rating: number;
  isProspect: boolean;
}

interface TradeTarget {
  player: SurplusProspect | SurplusMlbPlayer;
  isProspect: boolean;
  matchScore: number;
  sourceTeamNeeds: TeamNeed[];
  complementary: boolean;
  matchDetails: TradeMatchDetail[];
}

interface TradeMarketMatch {
  position: string;
  section: 'lineup' | 'rotation' | 'bullpen';
  severity: 'critical' | 'moderate';
  targets: TradeTarget[];
}

// --- Constants ---

const LINEUP_POSITIONS = ['C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF', 'DH'];
const ROTATION_POSITIONS = ['SP1', 'SP2', 'SP3', 'SP4', 'SP5'];
const BULLPEN_POSITIONS = ['CL', 'SU1', 'SU2', 'MR1', 'MR2', 'MR3', 'MR4', 'MR5'];

const POSITION_SLOTS = [
  { label: 'C', canPlay: [2] },
  { label: '1B', canPlay: [3, 6] },
  { label: '2B', canPlay: [4, 6] },
  { label: 'SS', canPlay: [6] },
  { label: '3B', canPlay: [5, 6] },
  { label: 'LF', canPlay: [7, 8, 9] },
  { label: 'CF', canPlay: [8] },
  { label: 'RF', canPlay: [9, 7, 8] },
  { label: 'DH', canPlay: [2, 3, 4, 5, 6, 7, 8, 9, 10] },
];

/** Map a numeric position code to the primary grid label. */
const POSITION_CODE_TO_LABEL: Record<number, string> = {
  2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH',
};

const MIN_SALARY = 228_000;
const MIN_SALARY_THRESHOLD = MIN_SALARY;
const TEAM_CONTROL_YEARS = 6;
const TYPICAL_DEBUT_AGE = 23;
const MIN_PROSPECT_GRID_AGE = 22;

// Rough arbitration salary estimates by TFR tier (years 4-6 of team control)
const ARB_TIERS: { minTfr: number; salaries: [number, number, number] }[] = [
  { minTfr: 5.0, salaries: [7_000_000, 10_000_000, 13_000_000] },
  { minTfr: 4.0, salaries: [4_000_000,  7_000_000, 10_000_000] },
  { minTfr: 3.0, salaries: [1_000_000,  4_000_000,  7_000_000] },
  { minTfr: 2.5, salaries: [  750_000,  2_000_000,  4_000_000] },
  { minTfr: 0,   salaries: [  500_000,  1_000_000,  2_000_000] },
];

/** Estimate salary for a team-controlled player given their service year (1-6) and TFR. */
function estimateTeamControlSalary(serviceYear: number, tfr: number): number {
  if (serviceYear <= 3) return MIN_SALARY;
  const arbYear = serviceYear - 3; // 1, 2, or 3
  const tier = ARB_TIERS.find(t => tfr >= t.minTfr) ?? ARB_TIERS[ARB_TIERS.length - 1];
  return tier.salaries[Math.min(arbYear, 3) - 1];
}

export class TeamPlanningView {
  private container: HTMLElement;
  private cellEditModal: CellEditModal;
  private messageModal: MessageModal;
  private hasLoadedData = false;
  private viewMode: 'grid' | 'analysis' | 'market' = (localStorage.getItem('wbl-tp-viewMode') as 'grid' | 'analysis' | 'market') || 'grid';
  private collapsedSections: Set<string> = new Set();

  private allTeams: Team[] = [];
  private teamLookup: Map<number, Team> = new Map();
  private selectedTeamId: number | null = null;
  private gameYear: number = 2021;
  private gridRows: GridRow[] = [];
  private playerMap: Map<number, Player> = new Map();
  private contractMap: Map<number, Contract> = new Map();
  private overrides: Map<string, TeamPlanningOverrideRecord> = new Map();
  private devOverrides: Set<number> = new Set();
  private playerRatingMap: Map<number, number> = new Map();
  private playerTfrMap: Map<number, number> = new Map();
  private prospectCurrentRatingMap: Map<number, number> = new Map();
  private canonicalPitcherTrMap: Map<number, number> = new Map();
  private canonicalBatterTrMap: Map<number, number> = new Map();
  private playerAgeMap: Map<number, number> = new Map();
  private playerServiceYearsMap: Map<number, number> = new Map();

  private lastFinancials: Map<number, YearFinancials> = new Map();

  // Cached data for profile modals
  private cachedRanking: TeamPowerRanking | null = null;
  private cachedAllRankings: TeamPowerRanking[] = [];
  private cachedOrgHitters: RatedHitterProspect[] = [];
  private cachedAllHitterProspects: RatedHitterProspect[] = [];
  private cachedOrgPitchers: RatedProspect[] = [];
  private cachedAllPitcherProspects: RatedProspect[] = [];
  private cachedTradeProfiles: Map<number, TeamTradeProfile> = new Map();
  private tradeMarketYear: number = parseInt(localStorage.getItem('wbl-tp-marketYear') ?? '0', 10); // offset from gameYear (0 = current season)
  private analysisYear: number = parseInt(localStorage.getItem('wbl-tp-analysisYear') ?? '-1', 10); // -1 = all years, 0+ = offset from gameYear

  constructor(container: HTMLElement) {
    this.container = container;
    this.cellEditModal = new CellEditModal();
    this.messageModal = new MessageModal();
    this.renderLayout();
    this.setupLazyLoading();
  }

  private setupLazyLoading(): void {
    const tabPanel = this.container.closest<HTMLElement>('.tab-panel');
    const isCurrentlyActive = tabPanel?.classList.contains('active');

    if (isCurrentlyActive) {
      this.loadData();
      this.hasLoadedData = true;
    } else {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            const target = mutation.target as HTMLElement;
            if (target.classList.contains('active')) {
              if (!this.hasLoadedData) {
                this.loadData();
                this.hasLoadedData = true;
              }
              observer.disconnect();
              break;
            }
          }
        }
      });

      if (tabPanel) {
        observer.observe(tabPanel, { attributes: true });
      }
    }
  }

  private renderLayout(): void {
    this.container.innerHTML = `
      <div class="true-ratings-content">
        <div class="draft-header">
          <p class="section-subtitle">Rosters are auto-filled assuming players fully develop. Edit the grid, look at team needs, draft strategy, and see what trades might make sense for your org</p>
        </div>
        <div class="true-ratings-controls">
          <div class="filter-bar">
            <label>Filters:</label>
            <div class="filter-group" role="group" aria-label="Team planning filters">
              <div class="filter-dropdown" data-filter="team">
                <button class="filter-dropdown-btn" aria-haspopup="true" aria-expanded="false">
                  Team: <span id="tp-team-display">Select Team</span> ▾
                </button>
                <div class="filter-dropdown-menu" id="tp-team-menu"></div>
              </div>
              <button class="toggle-btn ${this.viewMode === 'grid' ? 'active' : ''}" data-view="grid">Planning Grid</button>
              <button class="toggle-btn ${this.viewMode === 'analysis' ? 'active' : ''}" data-view="analysis">Org Analysis</button>
              <button class="toggle-btn ${this.viewMode === 'market' ? 'active' : ''}" data-view="market">Trade Market</button>
            </div>
          </div>
        </div>
        <div id="team-planning-grid-container" class="team-planning-grid-container">
          <p class="empty-text">Select a team to start planning your next championship</p>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    this.container.querySelectorAll('.filter-dropdown-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dropdown = btn.closest('.filter-dropdown');
        this.container.querySelectorAll('.filter-dropdown').forEach(d => {
          if (d !== dropdown) d.classList.remove('open');
        });
        dropdown?.classList.toggle('open');
      });
    });

    document.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.filter-dropdown')) {
        this.container.querySelectorAll('.filter-dropdown').forEach(d => {
          d.classList.remove('open');
        });
      }
    });

    // View toggle: Planning Grid vs Org Analysis
    this.container.querySelectorAll<HTMLElement>('.toggle-btn[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.view as 'grid' | 'analysis' | 'market';
        if (!mode || mode === this.viewMode) return;
        this.viewMode = mode;
        try { localStorage.setItem('wbl-tp-viewMode', mode); } catch { /* ignore */ }
        this.container.querySelectorAll('.toggle-btn[data-view]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.applyViewMode();
      });
    });
  }

  private applyViewMode(): void {
    const gridWrapper = this.container.querySelector<HTMLElement>('.team-planning-table-wrapper');
    const toolbar = this.container.querySelector<HTMLElement>('.tp-grid-toolbar');
    const summaryContainer = this.container.querySelector<HTMLElement>('#tp-summary-container');
    const marketContainer = this.container.querySelector<HTMLElement>('#tp-market-container');

    if (this.viewMode === 'grid') {
      if (gridWrapper) gridWrapper.style.display = '';
      if (toolbar) toolbar.style.display = '';
      if (summaryContainer) summaryContainer.style.display = 'none';
      if (marketContainer) marketContainer.style.display = 'none';
    } else if (this.viewMode === 'analysis') {
      if (gridWrapper) gridWrapper.style.display = 'none';
      if (toolbar) toolbar.style.display = 'none';
      if (summaryContainer) summaryContainer.style.display = '';
      if (marketContainer) marketContainer.style.display = 'none';
    } else {
      // market
      if (gridWrapper) gridWrapper.style.display = 'none';
      if (toolbar) toolbar.style.display = 'none';
      if (summaryContainer) summaryContainer.style.display = 'none';
      if (marketContainer) marketContainer.style.display = '';
    }
  }

  private navigateToGridCell(position: string, year: number): void {
    // 1. Switch to grid view
    this.viewMode = 'grid';
    try { localStorage.setItem('wbl-tp-viewMode', 'grid'); } catch { /* ignore */ }
    this.container.querySelectorAll('.toggle-btn[data-view]').forEach(b => b.classList.remove('active'));
    const gridBtn = this.container.querySelector('.toggle-btn[data-view="grid"]');
    if (gridBtn) gridBtn.classList.add('active');
    this.applyViewMode();

    // 2. Uncollapse the section containing this position
    const targetRow = this.gridRows.find(r => r.position === position);
    if (targetRow && this.collapsedSections.has(targetRow.section)) {
      this.collapsedSections.delete(targetRow.section);
      this.rerenderGridTable(this.lastFinancials);
    }

    // 3. Find cell, scroll, and flash
    setTimeout(() => {
      const cell = this.container.querySelector<HTMLElement>(
        `.grid-cell[data-position="${position}"][data-year="${year}"]`
      );
      if (!cell) return;

      cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
      cell.classList.add('cell-highlight-flash');
      cell.addEventListener('animationend', () => {
        cell.classList.remove('cell-highlight-flash');
      }, { once: true });
    }, 50);
  }

  private async loadData(): Promise<void> {
    try {
      const gridContainer = this.container.querySelector<HTMLElement>('#team-planning-grid-container');
      if (gridContainer) {
        gridContainer.innerHTML = '<p class="empty-text">Loading data...</p>';
      }

      const [teams, players, year, rankings] = await Promise.all([
        teamService.getAllTeams(),
        playerService.getAllPlayers(),
        dateService.getCurrentYear(),
        teamRatingsService.getPowerRankings(2021),
      ]);

      this.allTeams = teams;
      this.gameYear = year;

      this.playerMap.clear();
      for (const p of players) {
        this.playerMap.set(p.id, p);
      }

      this.contractMap = await contractService.getAllContracts();

      const rosterTeamIds = new Set(rankings.map(r => r.teamId));
      this.populateTeamDropdown(rosterTeamIds);

      if (gridContainer) {
        gridContainer.innerHTML = '<p class="empty-text">Select a team to start planning your next championship</p>';
      }
    } catch (err) {
      console.error('Failed to load team planning data:', err);
      const gridContainer = this.container.querySelector<HTMLElement>('#team-planning-grid-container');
      if (gridContainer) {
        gridContainer.innerHTML = '<p class="empty-text">Failed to load data. Please try again.</p>';
      }
    }
  }

  private populateTeamDropdown(rosterTeamIds: Set<number>): void {
    const menu = this.container.querySelector<HTMLElement>('#tp-team-menu');
    if (!menu) return;

    const mainTeams = this.allTeams.filter(t => t.parentTeamId === 0 && rosterTeamIds.has(t.id));
    mainTeams.sort((a, b) => a.nickname.localeCompare(b.nickname));

    this.teamLookup.clear();
    for (const t of mainTeams) {
      this.teamLookup.set(t.id, t);
    }

    menu.innerHTML = mainTeams.map(t =>
      `<div class="filter-dropdown-item" data-value="${t.id}">${t.nickname}</div>`
    ).join('');

    menu.querySelectorAll('.filter-dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const el = e.target as HTMLElement;
        const value = el.dataset.value;
        if (!value) return;

        this.selectedTeamId = parseInt(value, 10);
        try { localStorage.setItem('wbl-selected-team', el.textContent?.trim() || value); } catch { /* ignore */ }

        const display = this.container.querySelector('#tp-team-display');
        if (display) display.textContent = el.textContent || '';

        menu.querySelectorAll('.filter-dropdown-item').forEach(i => i.classList.remove('selected'));
        el.classList.add('selected');

        el.closest('.filter-dropdown')?.classList.remove('open');

        // Load overrides from DB when team changes
        this.loadOverrides().then(() => this.buildAndRenderGrid());
      });
    });

    // Restore saved team selection
    const savedTeam = localStorage.getItem('wbl-selected-team');
    if (savedTeam) {
      const match = mainTeams.find(t => t.nickname === savedTeam);
      if (match) {
        this.selectedTeamId = match.id;
        const display = this.container.querySelector('#tp-team-display');
        if (display) display.textContent = match.nickname;
        menu.querySelector(`.filter-dropdown-item[data-value="${match.id}"]`)?.classList.add('selected');
        this.loadOverrides().then(() => this.buildAndRenderGrid());
      }
    }
  }

  // =====================================================================
  // Main orchestrator — updated with Phases 2.5, 3, 4
  // =====================================================================

  private async buildAndRenderGrid(): Promise<void> {
    if (!this.selectedTeamId) return;

    const gridContainer = this.container.querySelector<HTMLElement>('#team-planning-grid-container');
    if (gridContainer) {
      gridContainer.innerHTML = '<p class="empty-text">Loading roster...</p>';
    }

    try {
      const [rankings, unifiedHitterData, pitcherFarmData] = await Promise.all([
        teamRatingsService.getPowerRankings(this.gameYear),
        teamRatingsService.getUnifiedHitterTfrData(this.gameYear),
        teamRatingsService.getFarmData(this.gameYear),
      ]);

      const teamRanking = rankings.find(r => r.teamId === this.selectedTeamId);

      if (!teamRanking) {
        if (gridContainer) {
          gridContainer.innerHTML = '<p class="empty-text">No roster data found for this team.</p>';
        }
        return;
      }

      // Unified pool: all org hitters with TFR data (including young MLB players with upside)
      const allOrgHitters = unifiedHitterData.prospects.filter(p => p.orgId === this.selectedTeamId);
      // Farm-eligible subset for prospect slotting
      const farmHitters = allOrgHitters.filter(p => p.isFarmEligible);
      const orgPitchers = pitcherFarmData.prospects.filter(p => p.orgId === this.selectedTeamId);

      // Cache data for profile modals
      this.cachedRanking = teamRanking;
      this.cachedAllRankings = rankings;
      this.cachedOrgHitters = allOrgHitters;
      this.cachedAllHitterProspects = unifiedHitterData.prospects;
      this.cachedOrgPitchers = orgPitchers;
      this.cachedAllPitcherProspects = pitcherFarmData.prospects;

      // Collect roster player IDs (used for TFR fallback and service year computation)
      const rosterPlayerIds = new Set<number>();
      for (const b of teamRanking.lineup) rosterPlayerIds.add(b.playerId);
      for (const b of teamRanking.bench) rosterPlayerIds.add(b.playerId);
      for (const p of teamRanking.rotation) rosterPlayerIds.add(p.playerId);
      for (const p of teamRanking.bullpen) rosterPlayerIds.add(p.playerId);

      // Build TFR map from both hitter and pitcher TFR data
      this.playerTfrMap.clear();
      for (const h of allOrgHitters) this.playerTfrMap.set(h.playerId, h.trueFutureRating);
      for (const p of orgPitchers) this.playerTfrMap.set(p.playerId, p.trueFutureRating);

      // Fallback: check full unified data for MLB roster players whose orgId didn't match
      for (const h of unifiedHitterData.prospects) {
        if (rosterPlayerIds.has(h.playerId) && !this.playerTfrMap.has(h.playerId)) {
          this.playerTfrMap.set(h.playerId, h.trueFutureRating);
        }
      }

      // Compute actual MLB service years for roster players (for team control calculation)
      await this.computeServiceYears(rosterPlayerIds);

      // Build prospect current rating map (dev overrides skip the curve — use TFR directly)
      // Fetch canonical TR maps so prospects with actual MLB stats use their proven ability as a floor.
      // Power rankings only include top 13 pitchers/13 batters per team — canonical maps cover everyone.
      const [canonicalPitcherTr, canonicalBatterTr] = await Promise.all([
        trueRatingsService.getPitcherTrueRatings(this.gameYear),
        trueRatingsService.getHitterTrueRatings(this.gameYear),
      ]);
      this.canonicalPitcherTrMap = new Map(
        Array.from(canonicalPitcherTr.entries()).map(([id, rec]) => [id, rec.trueRating])
      );
      this.canonicalBatterTrMap = new Map(
        Array.from(canonicalBatterTr.entries()).map(([id, rec]) => [id, rec.trueRating])
      );

      this.prospectCurrentRatingMap.clear();
      for (const h of farmHitters) {
        const devRating = this.devOverrides.has(h.playerId) ? h.trueFutureRating : this.computeProspectCurrentRating(h);
        const canonicalTr = canonicalBatterTr.get(h.playerId)?.trueRating;
        this.prospectCurrentRatingMap.set(h.playerId, canonicalTr ? Math.max(devRating, canonicalTr) : devRating);
      }
      for (const p of orgPitchers) {
        const devRating = this.devOverrides.has(p.playerId) ? p.trueFutureRating : this.computeProspectCurrentRating(p);
        const canonicalTr = canonicalPitcherTr.get(p.playerId)?.trueRating;
        this.prospectCurrentRatingMap.set(p.playerId, canonicalTr ? Math.max(devRating, canonicalTr) : devRating);
      }

      // Build player age map for buildRow projections
      this.playerAgeMap.clear();
      for (const h of allOrgHitters) this.playerAgeMap.set(h.playerId, h.age);
      for (const p of orgPitchers) this.playerAgeMap.set(p.playerId, p.age);

      this.gridRows = this.buildGridData(teamRanking);

      // Apply user overrides BEFORE prospect fill — overrides act as locked constraints
      // so the greedy algorithm optimizes around user decisions
      this.applyOverrides();

      // Build player rating map before fillProspects — map has TR for MLB-only players,
      // max(TR, TFR) for players in the unified hitter pool.
      // fillProspects uses this to avoid replacing young MLB players whose TFR exceeds their TR.
      this.buildPlayerRatingMap(teamRanking, allOrgHitters, orgPitchers);

      // Fill rating map gaps: recently-promoted MLB players (e.g. AA→MLB) are excluded from
      // both the power ranking top 13 and getFarmData (which skips MLB teams), so they have
      // no entry in playerRatingMap. Use canonical TR as fallback so the cell edit modal
      // and grid show their actual ability instead of 0.5.
      for (const [pid, player] of this.playerMap) {
        if (this.playerRatingMap.has(pid)) continue;
        if (player.parentTeamId !== this.selectedTeamId && player.teamId !== this.selectedTeamId) continue;
        if (player.position === 1) {
          const tr = canonicalPitcherTr.get(pid);
          if (tr) this.playerRatingMap.set(pid, tr.trueRating);
        } else {
          const tr = canonicalBatterTr.get(pid);
          if (tr) this.playerRatingMap.set(pid, tr.trueRating);
        }
      }

      this.fillProspects(farmHitters, orgPitchers);

      // Re-sort rotation by rating each year so the best pitcher is always SP1
      this.sortRotationByYear();

      // Phase 3: Indicators
      this.computeIndicators();

      // Phase 4: Financials
      const financials = this.computeFinancials();
      this.lastFinancials = financials;

      // Render grid with indicators + salary rows
      this.renderGrid(financials);

      // Phase 3: Summary section (includes draft strategy)
      this.renderSummarySection();
      this.bindSummaryLinks();

      // Build trade market profiles for all teams
      this.cachedTradeProfiles = this.buildAllTeamProfiles();
      this.renderTradeMarket();

      // Re-apply view mode after summary/draft/market sections are populated
      this.applyViewMode();

    } catch (err) {
      console.error('Failed to build grid:', err);
      if (gridContainer) {
        gridContainer.innerHTML = '<p class="empty-text">Failed to load roster data.</p>';
      }
    }
  }

  // =====================================================================
  // MLB service year computation (for team control)
  // =====================================================================

  /**
   * Count actual MLB service years for each roster player by scanning
   * the already-cached league-wide stats (no individual API calls needed).
   */
  private async computeServiceYears(rosterPlayerIds: Set<number>): Promise<void> {
    this.playerServiceYearsMap.clear();

    // Build a map of playerId → Set<year> by scanning cached league stats
    const playerYears = new Map<number, Set<number>>();
    for (const pid of rosterPlayerIds) playerYears.set(pid, new Set());

    // Load all years of league-wide pitching + batting stats from cache
    const years: number[] = [];
    for (let y = LEAGUE_START_YEAR; y <= this.gameYear; y++) years.push(y);

    const [pitchingByYear, battingByYear] = await Promise.all([
      Promise.all(years.map(y => trueRatingsService.getTruePitchingStats(y).catch(() => []))),
      Promise.all(years.map(y => trueRatingsService.getTrueBattingStats(y).catch(() => []))),
    ]);

    // Scan each year's data for roster players
    for (let i = 0; i < years.length; i++) {
      for (const stat of pitchingByYear[i]) {
        const yearSet = playerYears.get(stat.player_id);
        if (yearSet) yearSet.add(years[i]);
      }
      for (const stat of battingByYear[i]) {
        const yearSet = playerYears.get(stat.player_id);
        if (yearSet) yearSet.add(years[i]);
      }
    }

    for (const [pid, yearSet] of playerYears) {
      if (yearSet.size > 0) {
        this.playerServiceYearsMap.set(pid, yearSet.size);
      }
    }
  }

  // =====================================================================
  // Grid data building (existing)
  // =====================================================================

  private buildGridData(ranking: TeamPowerRanking): GridRow[] {
    const rows: GridRow[] = [];
    const yearRange = this.getYearRange();

    for (const posLabel of LINEUP_POSITIONS) {
      const batter = ranking.lineup.find(b => b.positionLabel === posLabel);
      const row = this.buildRow(posLabel, 'lineup', batter?.playerId ?? null, batter?.name ?? '', batter?.trueRating ?? 0, yearRange);
      rows.push(row);
    }

    for (let i = 0; i < ROTATION_POSITIONS.length; i++) {
      const posLabel = ROTATION_POSITIONS[i];
      const pitcher: RatedPitcher | undefined = ranking.rotation[i];
      const row = this.buildRow(posLabel, 'rotation', pitcher?.playerId ?? null, pitcher?.name ?? '', pitcher?.trueRating ?? 0, yearRange);
      rows.push(row);
    }

    for (let i = 0; i < BULLPEN_POSITIONS.length; i++) {
      const posLabel = BULLPEN_POSITIONS[i];
      const pitcher: RatedPitcher | undefined = ranking.bullpen[i];
      const row = this.buildRow(posLabel, 'bullpen', pitcher?.playerId ?? null, pitcher?.name ?? '', pitcher?.trueRating ?? 0, yearRange);
      rows.push(row);
    }

    return rows;
  }

  private estimateETA(prospect: { level: string; trueFutureRating: number }): number {
    const levelYears: Record<string, number> = {
      'MLB': 0, 'AAA': 1, 'AA': 2, 'A': 3, 'R': 4, 'IC': 5,
    };
    const base = levelYears[prospect.level] ?? 4;
    const acceleration = prospect.trueFutureRating >= 4.0 ? 1
      : prospect.trueFutureRating >= 3.5 ? 0.5
      : 0;
    return Math.max(0, Math.ceil(base - acceleration));
  }

  private fillProspects(hitters: RatedHitterProspect[], pitchers: RatedProspect[]): void {
    const yearRange = this.getYearRange();

    const sortedHitters = [...hitters].sort((a, b) => b.trueFutureRating - a.trueFutureRating);
    const sortedPitchers = [...pitchers].sort((a, b) => b.trueFutureRating - a.trueFutureRating);

    const hitterETA = new Map<number, number>();
    for (const h of sortedHitters) hitterETA.set(h.playerId, this.estimateETA(h));
    const pitcherETA = new Map<number, number>();
    for (const p of sortedPitchers) pitcherETA.set(p.playerId, this.estimateETA(p));

    const lineupRowMap = new Map<string, GridRow>();
    for (const row of this.gridRows) {
      if (row.section === 'lineup') lineupRowMap.set(row.position, row);
    }

    // Start at yi=1: year 0 is the actual current roster, prospect optimization starts from year 1
    for (let yi = 1; yi < yearRange.length; yi++) {
      const year = yearRange[yi];

      // Collect player IDs locked by user overrides this year (across all sections).
      // Override cells are treated as immovable constraints — the greedy algorithm
      // optimizes the remaining open slots around them.
      const overridePlayerIds = new Set<number>();
      for (const row of this.gridRows) {
        const cell = row.cells.get(year);
        if (cell?.isOverride && cell.playerId) {
          overridePlayerIds.add(cell.playerId);
        }
      }

      // Identify positions open for prospect placement:
      // empty, already a prospect, min contract, arb-eligible, or final-year — but NEVER override cells.
      // Final-year cells are open because the player is leaving after this year anyway;
      // the improvement check ensures only genuinely better prospects replace them.
      const openPositions: string[] = [];
      for (const [posLabel, row] of lineupRowMap) {
        const cell = row.cells.get(year);
        if (cell?.isOverride) continue; // Locked by user edit
        if (!cell || cell.contractStatus === 'empty' || cell.isProspect
          || cell.isMinContract || cell.contractStatus === 'arb-eligible'
          || cell.contractStatus === 'final-year') {
          openPositions.push(posLabel);
        }
      }
      if (openPositions.length === 0) continue;

      const available = sortedHitters.filter(h =>
        hitterETA.get(h.playerId)! <= yi && h.age + yi >= MIN_PROSPECT_GRID_AGE
        && !overridePlayerIds.has(h.playerId) // Already placed by user override
      );
      if (available.length === 0) continue;

      const slotsToFill = POSITION_SLOTS.filter(s => openPositions.includes(s.label));

      // Greedy assignment: place each prospect where it provides the biggest upgrade
      const usedThisYear = new Set<number>();
      const filledSlots = new Set<string>();

      // Build all (prospect, slot, improvement) candidates
      type Candidate = { prospect: RatedHitterProspect; slot: typeof POSITION_SLOTS[0]; projected: number; improvement: number };
      let candidates: Candidate[] = [];

      for (const prospect of available) {
        const prospectCurrentRating = this.prospectCurrentRatingMap.get(prospect.playerId) ?? prospect.trueFutureRating;
        const prospectProjected = this.projectPlanningRating(prospectCurrentRating, prospect.trueFutureRating, prospect.age, yi);

        for (const slot of slotsToFill) {
          if (!slot.canPlay.includes(prospect.position)) continue;
          const row = lineupRowMap.get(slot.label)!;
          const current = row.cells.get(year);
          const incumbentRating = current?.rating ?? 0;

          // Only place if prospect is actually better
          if (prospectProjected <= incumbentRating) continue;

          candidates.push({
            prospect,
            slot,
            projected: prospectProjected,
            improvement: prospectProjected - incumbentRating,
          });
        }
      }

      // Sort by improvement descending — biggest upgrades first
      candidates.sort((a, b) => b.improvement - a.improvement);

      for (const { prospect, slot, projected } of candidates) {
        if (usedThisYear.has(prospect.playerId) || filledSlots.has(slot.label)) continue;

        usedThisYear.add(prospect.playerId);
        filledSlots.add(slot.label);

        const eta = hitterETA.get(prospect.playerId)!;
        const serviceYear = yi - eta + 1;
        const row = lineupRowMap.get(slot.label)!;
        row.cells.set(year, {
          playerId: prospect.playerId,
          playerName: prospect.name,
          age: prospect.age + yi,
          rating: projected,
          salary: estimateTeamControlSalary(serviceYear, prospect.trueFutureRating),
          contractStatus: 'prospect',
          level: prospect.level,
          isProspect: true,
        });
      }
    }

    const spProspects = sortedPitchers.filter(p => {
      const pitches = p.scoutingRatings?.pitches ?? 0;
      const stamina = p.scoutingRatings?.stamina ?? 0;
      return pitches >= 3 && stamina >= 30;
    });
    const rpProspects = sortedPitchers.filter(p => {
      const pitches = p.scoutingRatings?.pitches ?? 0;
      const stamina = p.scoutingRatings?.stamina ?? 0;
      return pitches < 3 || stamina < 30;
    });

    // Pitcher prospect filling — greedy by improvement, arb-eligible cells are open
    for (let yi = 1; yi < yearRange.length; yi++) {
      const year = yearRange[yi];
      const usedThisYear = new Set<number>();

      // Collect player IDs locked by user overrides this year (across all sections)
      const overridePlayerIds = new Set<number>();
      for (const row of this.gridRows) {
        const cell = row.cells.get(year);
        if (cell?.isOverride && cell.playerId) {
          overridePlayerIds.add(cell.playerId);
        }
      }

      // Helper: check if a pitcher cell is open for prospect replacement
      const isPitcherCellOpen = (cell: GridCell | undefined): boolean => {
        if (cell?.isOverride) return false; // Locked by user edit
        if (!cell || cell.contractStatus === 'empty') return true;
        return cell.isProspect || cell.isMinContract || cell.contractStatus === 'arb-eligible'
          || cell.contractStatus === 'final-year';
      };

      // Rotation: greedy by improvement across all SP slots
      const rotationCandidates: { row: GridRow; prospect: RatedProspect; projected: number; improvement: number }[] = [];
      for (const row of this.gridRows) {
        if (row.section !== 'rotation') continue;
        const cell = row.cells.get(year);
        if (!isPitcherCellOpen(cell)) continue;
        const incumbentRating = cell?.rating ?? 0;

        for (const p of spProspects) {
          if (overridePlayerIds.has(p.playerId)) continue; // Already placed by user override
          if (pitcherETA.get(p.playerId)! > yi || p.age + yi < MIN_PROSPECT_GRID_AGE) continue;
          const pCurrent = this.prospectCurrentRatingMap.get(p.playerId) ?? p.trueFutureRating;
          const pProjected = this.projectPlanningRating(pCurrent, p.trueFutureRating, p.age, yi);
          if (pProjected <= incumbentRating) continue;
          rotationCandidates.push({ row, prospect: p, projected: pProjected, improvement: pProjected - incumbentRating });
        }
      }
      rotationCandidates.sort((a, b) => b.improvement - a.improvement);
      const filledRotationSlots = new Set<string>();
      for (const { row, prospect, projected } of rotationCandidates) {
        if (usedThisYear.has(prospect.playerId) || filledRotationSlots.has(row.position)) continue;
        usedThisYear.add(prospect.playerId);
        filledRotationSlots.add(row.position);
        const eta = pitcherETA.get(prospect.playerId)!;
        row.cells.set(year, {
          playerId: prospect.playerId, playerName: prospect.name,
          age: prospect.age + yi, rating: projected,
          salary: estimateTeamControlSalary(yi - eta + 1, prospect.trueFutureRating),
          contractStatus: 'prospect', level: prospect.level, isProspect: true,
        });
      }

      // Bullpen: greedy by improvement, RP first then overflow SP
      const bullpenCandidates: { row: GridRow; prospect: RatedProspect; projected: number; improvement: number }[] = [];
      const bpProspects = [...rpProspects, ...spProspects];
      for (const row of this.gridRows) {
        if (row.section !== 'bullpen') continue;
        const cell = row.cells.get(year);
        if (!isPitcherCellOpen(cell)) continue;
        const incumbentRating = cell?.rating ?? 0;

        for (const p of bpProspects) {
          if (overridePlayerIds.has(p.playerId)) continue; // Already placed by user override
          if (usedThisYear.has(p.playerId)) continue;
          if (pitcherETA.get(p.playerId)! > yi || p.age + yi < MIN_PROSPECT_GRID_AGE) continue;
          const pCurrent = this.prospectCurrentRatingMap.get(p.playerId) ?? p.trueFutureRating;
          const pProjected = this.projectPlanningRating(pCurrent, p.trueFutureRating, p.age, yi);
          if (pProjected <= incumbentRating) continue;
          bullpenCandidates.push({ row, prospect: p, projected: pProjected, improvement: pProjected - incumbentRating });
        }
      }
      bullpenCandidates.sort((a, b) => b.improvement - a.improvement);
      const filledBullpenSlots = new Set<string>();
      for (const { row, prospect, projected } of bullpenCandidates) {
        if (usedThisYear.has(prospect.playerId) || filledBullpenSlots.has(row.position)) continue;
        usedThisYear.add(prospect.playerId);
        filledBullpenSlots.add(row.position);
        const eta = pitcherETA.get(prospect.playerId)!;
        row.cells.set(year, {
          playerId: prospect.playerId, playerName: prospect.name,
          age: prospect.age + yi, rating: projected,
          salary: estimateTeamControlSalary(yi - eta + 1, prospect.trueFutureRating),
          contractStatus: 'prospect', level: prospect.level, isProspect: true,
        });
      }
    }
  }

  /** Re-sort rotation cells by rating each year so the best pitcher is always SP1. */
  private sortRotationByYear(): void {
    const yearRange = this.getYearRange();
    const rotationRows = this.gridRows.filter(r => r.section === 'rotation');

    for (const year of yearRange) {
      const cells = rotationRows.map(r => r.cells.get(year)!);

      // Sort: occupied cells by rating descending, empty cells to the bottom
      const sorted = [...cells].sort((a, b) => {
        const aEmpty = !a || !a.playerId;
        const bEmpty = !b || !b.playerId;
        if (aEmpty && bEmpty) return 0;
        if (aEmpty) return 1;
        if (bEmpty) return -1;
        return b.rating - a.rating;
      });

      for (let i = 0; i < rotationRows.length; i++) {
        rotationRows[i].cells.set(year, sorted[i]);
      }
    }
  }

  private buildRow(
    position: string,
    section: 'lineup' | 'rotation' | 'bullpen',
    playerId: number | null,
    playerName: string,
    rating: number,
    yearRange: number[],
  ): GridRow {
    const cells = new Map<number, GridCell>();
    const contract = playerId ? this.contractMap.get(playerId) : undefined;
    const player = playerId ? this.playerMap.get(playerId) : undefined;
    const baseAge = player?.age ?? 0;

    for (let yi = 0; yi < yearRange.length; yi++) {
      const year = yearRange[yi];
      const yearOffset = yi;

      if (!playerId || !contract) {
        cells.set(year, {
          playerId: null,
          playerName: '',
          age: 0,
          rating: 0,
          salary: 0,
          contractStatus: 'empty',
        });
        continue;
      }

      const contractYearsRemaining = contractService.getYearsRemaining(contract);
      const currentSalary = contractService.getCurrentSalary(contract);
      const isMinDeal = currentSalary <= MIN_SALARY_THRESHOLD;

      // Determine effective years remaining using actual MLB service years when available
      let effectiveYearsRemaining = contractYearsRemaining;
      const serviceYears = this.playerServiceYearsMap.get(playerId!) ?? 0;

      if (serviceYears > 0 && serviceYears <= TEAM_CONTROL_YEARS) {
        // Player has known MLB service time — calculate remaining team control
        // serviceYears includes current year, so remaining = total - serviceYears + 1
        const teamControlRemaining = TEAM_CONTROL_YEARS - serviceYears + 1;
        effectiveYearsRemaining = Math.max(contractYearsRemaining, teamControlRemaining);
      } else if (serviceYears === 0 && isMinDeal && baseAge > 0) {
        // No stats data available — fall back to age-based estimate for min-salary players
        const estimatedServiceYears = Math.max(0, baseAge - TYPICAL_DEBUT_AGE);
        const teamControlLeft = Math.max(1, TEAM_CONTROL_YEARS - estimatedServiceYears);
        effectiveYearsRemaining = Math.max(contractYearsRemaining, teamControlLeft);
      }

      if (yearOffset < effectiveYearsRemaining) {
        const isLastYear = yearOffset === effectiveYearsRemaining - 1;

        // Salary: use contract for explicit contract years, estimate for team-control extensions
        let salary: number;
        if (yearOffset < contractYearsRemaining) {
          salary = contractService.getSalaryForYear(contract, yearOffset);
        } else {
          // Beyond contract but within team control — estimate arb/pre-arb salary
          const tfr = this.playerTfrMap.get(playerId!) ?? rating;
          const serviceAtYear = serviceYears > 0
            ? serviceYears + yearOffset
            : Math.max(1, baseAge - TYPICAL_DEBUT_AGE + yearOffset);
          salary = estimateTeamControlSalary(serviceAtYear, tfr);
        }

        // Contract status: explicit contract → under-contract, extended team control → arb-eligible
        let contractStatus: GridCell['contractStatus'];
        if (isLastYear) {
          contractStatus = 'final-year';
        } else if (yearOffset >= contractYearsRemaining) {
          contractStatus = 'arb-eligible';
        } else {
          contractStatus = 'under-contract';
        }

        // Project rating using TFR for growth, aging for decline
        const tfr = this.playerTfrMap.get(playerId!);
        const peakRating = (tfr !== undefined && tfr > rating) ? tfr : rating;
        // Dev override: player is already at peak — skip the growth phase
        const effectiveCurrentRating = this.devOverrides.has(playerId!) ? peakRating : rating;
        const projectedRating = this.projectPlanningRating(effectiveCurrentRating, peakRating, baseAge, yearOffset);

        cells.set(year, {
          playerId,
          playerName,
          age: baseAge + yearOffset,
          rating: projectedRating,
          salary,
          contractStatus,
          isMinContract: salary <= MIN_SALARY_THRESHOLD,
        });
      } else {
        cells.set(year, {
          playerId: null,
          playerName: '',
          age: 0,
          rating: 0,
          salary: 0,
          contractStatus: 'empty',
        });
      }
    }

    return { position, section, cells };
  }

  private getYearRange(): number[] {
    const years: number[] = [];
    for (let i = 0; i < 6; i++) {
      years.push(this.gameYear + i);
    }
    return years;
  }

  // =====================================================================
  // Phase 3: Indicators
  // =====================================================================

  private computeIndicators(): void {
    const yearRange = this.getYearRange();

    for (const row of this.gridRows) {
      for (let yi = 0; yi < yearRange.length; yi++) {
        const year = yearRange[yi];
        const cell = row.cells.get(year);
        if (!cell) continue;

        const indicators: CellIndicator[] = [];

        if (cell.contractStatus === 'empty' && !cell.isProspect) {
          // FA indicator on empty cells in years 2-4 if no prospect fills it
          if (yi >= 1 && yi <= 4) {
            indicators.push({
              type: 'FA',
              label: 'FA',
              tooltip: 'Free agent target needed — no prospect or contract covers this slot',
            });
          }
        } else if (!cell.isProspect && cell.contractStatus !== 'empty') {
          // CLIFF: age >= 33 or estimated service years >= 10
          const estimatedService = cell.age > 0 ? Math.max(0, cell.age - TYPICAL_DEBUT_AGE) : 0;
          if (cell.age >= 33 || estimatedService >= 10) {
            indicators.push({
              type: 'CLIFF',
              label: 'CLIFF',
              tooltip: `Age ${cell.age}, ~${estimatedService}yr service — decline risk`,
            });
          }

          // EXT: player under-contract, next year is final-year, rating >= 3.0, age <= 31, not prospect/min
          if (yi < yearRange.length - 1) {
            const nextCell = row.cells.get(yearRange[yi + 1]);
            if (cell.contractStatus === 'under-contract'
              && nextCell?.contractStatus === 'final-year'
              && cell.rating >= 3.0
              && cell.age <= 31
              && !cell.isMinContract) {
              indicators.push({
                type: 'EXT',
                label: 'EXT',
                tooltip: `Extension candidate — ${cell.playerName} is ${cell.age}, rated ${cell.rating.toFixed(1)}, entering final contract year next season`,
              });
            }
          }

          // EXPENSIVE: salary >= $10M
          if (cell.salary >= 10_000_000) {
            indicators.push({
              type: 'EXPENSIVE',
              label: '$$$',
              tooltip: `High salary: ${this.formatSalary(cell.salary)}`,
            });
          }

          // TR: rating < 2.5, final year, no strong prospect coming
          if (cell.rating < 2.5 && cell.contractStatus === 'final-year') {
            const hasStrongProspect = this.hasUpcomingProspect(row, yi, yearRange, 3.0);
            if (!hasStrongProspect) {
              indicators.push({
                type: 'TR',
                label: 'TR',
                tooltip: `Trade target area — underperforming (${cell.rating.toFixed(1)}) in final year with no strong prospect coming`,
              });
            }
          }
        }

        // UPGRADE: year 0 only — a prospect in the org is MLB-ready and better than the incumbent
        if (yi === 0 && cell.playerId && !cell.isProspect && cell.contractStatus !== 'empty') {
          const upgrade = this.findProspectUpgrade(row, cell);
          if (upgrade) {
            indicators.push({
              type: 'UPGRADE',
              label: 'UP',
              tooltip: `Prospect upgrade: ${upgrade.name} (${upgrade.rating.toFixed(1)} TFR, ${upgrade.level})`,
            });
          }
        }

        // Override indicators
        if (cell.isOverride) {
          if (cell.overrideSourceType === 'trade-target') {
            indicators.push({
              type: 'TRADE',
              label: 'TRADE',
              tooltip: `Trade target — ${cell.playerName}`,
            });
          } else if (cell.overrideSourceType === 'fa-target') {
            indicators.push({
              type: 'FA_TARGET',
              label: 'FA',
              tooltip: `Free agent target — ${cell.playerName}`,
            });
          }
        }

        cell.indicators = indicators;
      }
    }
  }

  /** Check if a strong prospect (TFR >= threshold) fills the position in any future year. */
  private hasUpcomingProspect(row: GridRow, currentYearIndex: number, yearRange: number[], threshold: number): boolean {
    for (let yi = currentYearIndex + 1; yi < yearRange.length; yi++) {
      const futureCell = row.cells.get(yearRange[yi]);
      if (futureCell?.isProspect && futureCell.rating >= threshold) return true;
    }
    return false;
  }

  /** Find the best MLB-ready prospect upgrade for a current-year cell. */
  private findProspectUpgrade(row: GridRow, cell: GridCell): { name: string; rating: number; level: string } | null {
    const isPitcherRow = row.section === 'rotation' || row.section === 'bullpen';

    if (isPitcherRow) {
      const best = this.cachedOrgPitchers
        .filter(p => this.estimateETA(p) === 0 && p.trueFutureRating > cell.rating)
        .sort((a, b) => b.trueFutureRating - a.trueFutureRating)[0];
      return best ? { name: this.abbreviateName(best.name), rating: best.trueFutureRating, level: best.level } : null;
    }

    // Hitter: check position eligibility
    const slot = POSITION_SLOTS.find(s => s.label === row.position);
    const eligible = slot?.canPlay;
    if (!eligible) return null;

    const best = this.cachedOrgHitters
      .filter(h => this.estimateETA(h) === 0 && eligible.includes(h.position) && h.trueFutureRating > cell.rating)
      .sort((a, b) => b.trueFutureRating - a.trueFutureRating)[0];
    return best ? { name: this.abbreviateName(best.name), rating: best.trueFutureRating, level: best.level } : null;
  }

  // =====================================================================
  // Phase 4: Financial Summary
  // =====================================================================

  private computeFinancials(): Map<number, YearFinancials> {
    const yearRange = this.getYearRange();
    const financials = new Map<number, YearFinancials>();

    for (const year of yearRange) {
      financials.set(year, {
        year,
        lineupTotal: 0,
        rotationTotal: 0,
        bullpenTotal: 0,
        grandTotal: 0,
      });
    }

    for (const row of this.gridRows) {
      for (const year of yearRange) {
        const cell = row.cells.get(year);
        if (!cell || cell.contractStatus === 'empty') continue;

        const salary = cell.salary > 0 ? cell.salary : MIN_SALARY;

        const f = financials.get(year)!;
        if (row.section === 'lineup') f.lineupTotal += salary;
        else if (row.section === 'rotation') f.rotationTotal += salary;
        else if (row.section === 'bullpen') f.bullpenTotal += salary;
        f.grandTotal += salary;
      }
    }

    return financials;
  }

  // =====================================================================
  // Rendering: grid + indicators + salary rows
  // =====================================================================

  private renderGrid(financials: Map<number, YearFinancials>): void {
    const gridContainer = this.container.querySelector<HTMLElement>('#team-planning-grid-container');
    if (!gridContainer) return;

    const yearRange = this.getYearRange();
    const yearHeaders = yearRange.map(y => `<th class="grid-year-header">${y}</th>`).join('');

    // Group rows by section for accordion rendering
    const sections: { name: string; rows: GridRow[] }[] = [];
    let currentSection = '';
    for (const row of this.gridRows) {
      if (row.section !== currentSection) {
        currentSection = row.section;
        sections.push({ name: currentSection, rows: [] });
      }
      sections[sections.length - 1].rows.push(row);
    }

    const sectionRatings = this.computeSectionRatings();

    let bodyHtml = '';
    for (let si = 0; si < sections.length; si++) {
      const section = sections[si];
      const isCollapsed = this.collapsedSections.has(section.name);

      bodyHtml += this.renderSectionHeaderRow(section.name, yearRange, sectionRatings);

      if (!isCollapsed) {
        for (const row of section.rows) {
          bodyHtml += `<tr class="grid-data-row" data-section="${section.name}">`;
          bodyHtml += `<td class="grid-position-label">${row.position}</td>`;
          for (const year of yearRange) {
            const cell = row.cells.get(year);
            bodyHtml += this.renderCell(cell, row.position, year);
          }
          bodyHtml += '</tr>';
        }
        bodyHtml += this.renderSalaryRow(section.name, yearRange, financials);
      }

      // Grand total + team rating after last section
      if (si === sections.length - 1) {
        bodyHtml += this.renderGrandTotalRow(yearRange, financials);
        bodyHtml += this.renderTeamRatingRow(yearRange, sectionRatings);
      }
    }

    const hasOverrides = this.overrides.size > 0;
    gridContainer.innerHTML = `
      <div class="tp-grid-toolbar">
        <div class="tp-color-legend">
          <span class="legend-item"><span class="legend-swatch legend-swatch-contract"></span>Under Contract</span>
          <span class="legend-item"><span class="legend-swatch legend-swatch-final"></span>Final Year</span>
          <span class="legend-item"><span class="legend-swatch legend-swatch-arb"></span>Arb Eligible</span>
          <span class="legend-item"><span class="legend-swatch legend-swatch-prospect"></span>Prospect</span>
          <span class="legend-item"><span class="legend-swatch legend-swatch-empty"></span>Empty / Gap</span>
          <span class="legend-item"><span class="legend-swatch legend-swatch-override"></span>Manual Edit</span>
        </div>
        <button class="btn tp-reset-btn" id="tp-reset-btn" ${hasOverrides ? '' : 'style="display:none;"'}>Reset Edits</button>
      </div>
      <div class="team-planning-table-wrapper">
        <table class="team-planning-table">
          <thead>
            <tr>
              <th class="grid-position-header">Pos</th>
              ${yearHeaders}
            </tr>
          </thead>
          <tbody>
            ${bodyHtml}
          </tbody>
        </table>
      </div>
      <div id="tp-summary-container"></div>
      <div id="tp-market-container"></div>
    `;

    // Bind accordion toggle on section headers
    gridContainer.querySelectorAll<HTMLElement>('.grid-section-toggle').forEach(header => {
      header.addEventListener('click', () => {
        const sectionRow = header.closest<HTMLElement>('.grid-section-row');
        const sectionName = sectionRow?.dataset.section;
        if (!sectionName) return;
        if (this.collapsedSections.has(sectionName)) {
          this.collapsedSections.delete(sectionName);
        } else {
          this.collapsedSections.add(sectionName);
        }
        // Re-render grid only (preserves summary/draft containers)
        this.rerenderGridTable(financials);
      });
    });

    // Bind name click events — opens player profile modal
    gridContainer.querySelectorAll<HTMLElement>('.cell-name-link').forEach(nameEl => {
      nameEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const playerId = nameEl.dataset.profileId ? parseInt(nameEl.dataset.profileId, 10) : null;
        if (playerId) {
          this.openPlayerProfile(playerId);
        }
      });
    });

    // Bind cell click events — all grid cells are clickable (opens edit modal)
    gridContainer.querySelectorAll<HTMLElement>('.grid-cell').forEach(cell => {
      cell.addEventListener('click', (e) => {
        const position = cell.dataset.position;
        const year = cell.dataset.year ? parseInt(cell.dataset.year, 10) : null;
        if (position && year) {
          e.stopPropagation();
          this.handleCellClick(position, year);
        }
      });
    });

    // Bind Reset Edits button (now inside grid container)
    const resetBtn = gridContainer.querySelector<HTMLElement>('#tp-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.handleResetEdits());
    }

    // Apply current view mode
    this.applyViewMode();
  }

  /** Re-render just the table body (for accordion toggle without losing summary/draft). */
  private rerenderGridTable(financials: Map<number, YearFinancials>): void {
    const tableBody = this.container.querySelector<HTMLElement>('.team-planning-table tbody');
    if (!tableBody) return;

    const yearRange = this.getYearRange();

    const sections: { name: string; rows: GridRow[] }[] = [];
    let currentSection = '';
    for (const row of this.gridRows) {
      if (row.section !== currentSection) {
        currentSection = row.section;
        sections.push({ name: currentSection, rows: [] });
      }
      sections[sections.length - 1].rows.push(row);
    }

    const sectionRatings = this.computeSectionRatings();

    let bodyHtml = '';
    for (let si = 0; si < sections.length; si++) {
      const section = sections[si];
      const isCollapsed = this.collapsedSections.has(section.name);

      bodyHtml += this.renderSectionHeaderRow(section.name, yearRange, sectionRatings);

      if (!isCollapsed) {
        for (const row of section.rows) {
          bodyHtml += `<tr class="grid-data-row" data-section="${section.name}">`;
          bodyHtml += `<td class="grid-position-label">${row.position}</td>`;
          for (const year of yearRange) {
            const cell = row.cells.get(year);
            bodyHtml += this.renderCell(cell, row.position, year);
          }
          bodyHtml += '</tr>';
        }
        bodyHtml += this.renderSalaryRow(section.name, yearRange, financials);
      }

      if (si === sections.length - 1) {
        bodyHtml += this.renderGrandTotalRow(yearRange, financials);
        bodyHtml += this.renderTeamRatingRow(yearRange, sectionRatings);
      }
    }

    tableBody.innerHTML = bodyHtml;

    // Rebind accordion toggles
    tableBody.querySelectorAll<HTMLElement>('.grid-section-toggle').forEach(header => {
      header.addEventListener('click', () => {
        const sectionRow = header.closest<HTMLElement>('.grid-section-row');
        const sectionName = sectionRow?.dataset.section;
        if (!sectionName) return;
        if (this.collapsedSections.has(sectionName)) {
          this.collapsedSections.delete(sectionName);
        } else {
          this.collapsedSections.add(sectionName);
        }
        this.rerenderGridTable(financials);
      });
    });

    // Rebind name clicks
    tableBody.querySelectorAll<HTMLElement>('.cell-name-link').forEach(nameEl => {
      nameEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const playerId = nameEl.dataset.profileId ? parseInt(nameEl.dataset.profileId, 10) : null;
        if (playerId) this.openPlayerProfile(playerId);
      });
    });

    // Rebind cell clicks
    tableBody.querySelectorAll<HTMLElement>('.grid-cell').forEach(cell => {
      cell.addEventListener('click', (e) => {
        const position = cell.dataset.position;
        const year = cell.dataset.year ? parseInt(cell.dataset.year, 10) : null;
        if (position && year) {
          e.stopPropagation();
          this.handleCellClick(position, year);
        }
      });
    });
  }

  private renderCell(cell: GridCell | undefined, position: string, year: number): string {
    const dataAttrs = `data-position="${position}" data-year="${year}"`;
    const overrideClass = cell?.isOverride ? ' cell-override' : '';

    if (!cell || cell.contractStatus === 'empty') {
      const indicators = cell?.indicators ?? [];
      const indicatorHtml = this.renderIndicators(indicators);
      return `<td class="grid-cell cell-empty${overrideClass}" ${dataAttrs}>
        <span class="cell-empty-label">---</span>
        ${indicatorHtml}
      </td>`;
    }

    if (cell.isProspect) {
      const ratingClass = this.getRatingClass(cell.rating);
      const abbrevName = this.abbreviateName(cell.playerName);
      const salaryStr = cell.salary > 0 ? this.formatSalary(cell.salary) : '';
      const indicatorHtml = this.renderIndicators(cell.indicators ?? []);
      const nameClickable = cell.playerId ? ` cell-name-link` : '';
      const nameDataAttr = cell.playerId ? ` data-profile-id="${cell.playerId}"` : '';
      const nameTitle = cell.playerId ? ` title="ID: ${cell.playerId}"` : '';

      return `
        <td class="grid-cell cell-minor-league${overrideClass}" ${dataAttrs}>
          <div class="cell-name${nameClickable}"${nameDataAttr}${nameTitle}>${abbrevName}</div>
          <div class="cell-meta">
            <span class="cell-age">Age: ${cell.age}</span>
            <span class="badge ${ratingClass} cell-rating">${cell.rating.toFixed(1)}</span>
          </div>
          ${salaryStr ? `<div class="cell-salary">${salaryStr}</div>` : ''}
          ${indicatorHtml}
        </td>
      `;
    }

    const statusClass = `cell-${cell.contractStatus}`;
    const ratingClass = this.getRatingClass(cell.rating);
    const abbrevName = this.abbreviateName(cell.playerName);
    const salaryStr = cell.salary > 0 ? this.formatSalary(cell.salary) : '';
    const indicatorHtml = this.renderIndicators(cell.indicators ?? []);
    const nameClickable = cell.playerId ? ` cell-name-link` : '';
    const nameDataAttr = cell.playerId ? ` data-profile-id="${cell.playerId}"` : '';
    const nameTitle = cell.playerId ? ` title="ID: ${cell.playerId}"` : '';

    return `
      <td class="grid-cell ${statusClass}${overrideClass}" ${dataAttrs}>
        <div class="cell-name${nameClickable}"${nameDataAttr}${nameTitle}>${abbrevName}</div>
        <div class="cell-meta">
          <span class="cell-age">Age: ${cell.age}</span>
          <span class="badge ${ratingClass} cell-rating">${cell.rating.toFixed(1)}</span>
        </div>
        ${salaryStr ? `<div class="cell-salary">${salaryStr}</div>` : ''}
        ${indicatorHtml}
      </td>
    `;
  }

  private renderIndicators(indicators: CellIndicator[]): string {
    if (indicators.length === 0) return '';
    const badges = indicators.map(ind => {
      const cls = `cell-indicator cell-indicator-${ind.type.toLowerCase()}`;
      return `<span class="${cls}" title="${ind.tooltip}">${ind.label}</span>`;
    }).join('');
    return `<div class="cell-indicators">${badges}</div>`;
  }

  private renderSalaryRow(section: string, yearRange: number[], financials: Map<number, YearFinancials>): string {
    let html = `<tr class="grid-salary-row">`;
    html += `<td class="salary-cell salary-label">${section.charAt(0).toUpperCase() + section.slice(1)}</td>`;
    for (const year of yearRange) {
      const f = financials.get(year)!;
      let total = 0;
      if (section === 'lineup') total = f.lineupTotal;
      else if (section === 'rotation') total = f.rotationTotal;
      else if (section === 'bullpen') total = f.bullpenTotal;
      html += `<td class="salary-cell">${this.formatSalary(total)}</td>`;
    }
    html += '</tr>';
    return html;
  }

  private renderGrandTotalRow(yearRange: number[], financials: Map<number, YearFinancials>): string {
    let html = `<tr class="grid-salary-total-row">`;
    html += `<td class="salary-total-cell salary-label">TOTAL</td>`;
    for (const year of yearRange) {
      const f = financials.get(year)!;
      html += `<td class="salary-total-cell">${this.formatSalary(f.grandTotal)}</td>`;
    }
    html += '</tr>';
    return html;
  }

  // =====================================================================
  // Phase 3: Position Assessments + Summary Section
  // =====================================================================

  private assessPositions(filterYear?: number): PositionAssessment[] {
    const fullRange = this.getYearRange();
    const yearRange = filterYear !== undefined ? [filterYear] : fullRange;
    const isSingleYear = filterYear !== undefined;
    const assessments: PositionAssessment[] = [];

    for (const row of this.gridRows) {
      let emptyYears = 0;
      let firstEmptyYear = 0;
      let highRatingYears = 0;
      let currentPlayer = '';
      let currentRating = 0;
      let currentAge = 0;
      let isExtCandidate = false;

      // Track cells with sub-3.0 players (positions of need)
      const weakYears: { year: number; name: string; rating: number }[] = [];

      for (let yi = 0; yi < yearRange.length; yi++) {
        const cell = row.cells.get(yearRange[yi]);
        if (!cell || cell.contractStatus === 'empty') {
          if (emptyYears === 0) firstEmptyYear = yearRange[yi];
          emptyYears++;
        } else {
          if (cell.rating >= 3.5) highRatingYears++;
          if (cell.rating < 3.0 && cell.rating > 0) {
            weakYears.push({ year: yearRange[yi], name: cell.playerName, rating: cell.rating });
          }
          if (yi === 0) {
            currentPlayer = cell.playerName;
            currentRating = cell.rating;
            currentAge = cell.age;
          }
        }
      }

      // Check extension candidate: only when viewing all years or the current/next year
      if (!isSingleYear || filterYear === fullRange[0] || filterYear === fullRange[1]) {
        const currentCell = row.cells.get(fullRange[0]);
        const nextCell = fullRange.length > 1 ? row.cells.get(fullRange[1]) : undefined;
        if (currentCell && !currentCell.isProspect && !currentCell.isMinContract
          && currentCell.contractStatus === 'under-contract'
          && nextCell?.contractStatus === 'final-year'
          && currentCell.rating >= 3.0 && currentCell.age <= 31) {
          isExtCandidate = true;
        }
      }

      // Strength: single year = any 3.5+ player; all years = 5+ years of 3.5+ coverage
      const strengthThreshold = isSingleYear ? 1 : 5;
      if (highRatingYears >= strengthThreshold) {
        const detail = isSingleYear
          ? `${row.position} — ${currentPlayer ? this.abbreviateName(currentPlayer) : '?'}: ${currentRating.toFixed(1)} rating`
          : `${row.position} — ${currentPlayer ? this.abbreviateName(currentPlayer) : '?'}: ${highRatingYears} years of 3.5+ coverage`;
        assessments.push({
          position: row.position,
          section: row.section,
          category: 'strength',
          detail,
          targetPosition: row.position,
          targetYear: yearRange[0],
        });
      }

      // Need: any cell with a player rated under 3.0, or empty years
      if (weakYears.length > 0) {
        // Group by unique players
        const uniquePlayers = new Map<string, { rating: number; years: number[] }>();
        for (const w of weakYears) {
          const key = w.name || '(empty)';
          const existing = uniquePlayers.get(key);
          if (existing) {
            existing.years.push(w.year);
            existing.rating = Math.min(existing.rating, w.rating);
          } else {
            uniquePlayers.set(key, { rating: w.rating, years: [w.year] });
          }
        }
        for (const [name, info] of uniquePlayers) {
          const detail = isSingleYear
            ? `${this.abbreviateName(name)} at ${info.rating.toFixed(1)}`
            : `${this.abbreviateName(name)} at ${info.rating.toFixed(1)} (${info.years.join(', ')})`;
          assessments.push({
            position: row.position,
            section: row.section,
            category: 'need',
            detail,
            targetPosition: row.position,
            targetYear: info.years[0],
          });
        }
      }
      if (emptyYears > 0) {
        assessments.push({
          position: row.position,
          section: row.section,
          category: 'need',
          detail: isSingleYear ? 'empty' : `${emptyYears} empty year${emptyYears !== 1 ? 's' : ''}`,
          targetPosition: row.position,
          targetYear: firstEmptyYear,
        });
      }

      // Extension priority
      if (isExtCandidate) {
        assessments.push({
          position: row.position,
          section: row.section,
          category: 'extension',
          detail: `${this.abbreviateName(currentPlayer)}: age ${currentAge}, ${currentRating.toFixed(1)} rating, penultimate year`,
          targetPosition: row.position,
          targetYear: fullRange[0],
        });
      }
    }

    return assessments;
  }

  private renderSummarySection(): void {
    const container = this.container.querySelector<HTMLElement>('#tp-summary-container');
    if (!container) return;

    const filterYear = this.analysisYear >= 0 ? this.gameYear + this.analysisYear : undefined;
    const assessments = this.assessPositions(filterYear);
    const allGaps = this.analyzePositionGaps();
    // Filter gaps by selected year: only show gaps relevant to that year
    const gaps = filterYear !== undefined
      ? allGaps.filter(g => g.gapStartYear <= filterYear && g.gapStartYear + g.emptyYears > filterYear)
      : allGaps;

    const strengths = assessments.filter(a => a.category === 'strength');
    const needs = assessments.filter(a => a.category === 'need');
    const extensions = assessments.filter(a => a.category === 'extension');

    const renderList = (items: PositionAssessment[], emptyMsg: string) => {
      if (items.length === 0) return `<p class="summary-empty">${emptyMsg}</p>`;
      return '<ul class="summary-list">' + items.map(i =>
        `<li class="summary-link" data-target-pos="${i.targetPosition}" data-target-year="${i.targetYear}">${i.detail}</li>`
      ).join('') + '</ul>';
    };

    const renderGroupedNeeds = (items: PositionAssessment[], emptyMsg: string) => {
      if (items.length === 0) return `<p class="summary-empty">${emptyMsg}</p>`;
      // Group by position, preserving order of first appearance
      const groups: { position: string; items: PositionAssessment[] }[] = [];
      const groupMap = new Map<string, PositionAssessment[]>();
      for (const item of items) {
        let group = groupMap.get(item.position);
        if (!group) {
          group = [];
          groupMap.set(item.position, group);
          groups.push({ position: item.position, items: group });
        }
        group.push(item);
      }
      return groups.map(g => `
        <div class="summary-need-group">
          <div class="summary-need-pos">${g.position}</div>
          <ul class="summary-list summary-list-nested">${g.items.map(i =>
            `<li class="summary-link" data-target-pos="${i.targetPosition}" data-target-year="${i.targetYear}">${i.detail}</li>`
          ).join('')}</ul>
        </div>
      `).join('');
    };

    const renderDraftStrategy = (draftGaps: RosterGap[]) => {
      if (draftGaps.length === 0) return `<p class="summary-empty">No significant roster gaps identified.</p>`;
      const sorted = [...draftGaps].sort((a, b) => {
        const yearDiff = a.gapStartYear - b.gapStartYear;
        if (yearDiff !== 0) return yearDiff;
        return b.emptyYears - a.emptyYears;
      });
      return '<ul class="summary-list">' + sorted.map(gap => {
        const yearsUntilGap = gap.gapStartYear - this.gameYear;
        let suggestion: string;
        if (yearsUntilGap <= 1) {
          suggestion = `${gap.position} needed now, lean college player or trade target`;
        } else if (yearsUntilGap <= 3) {
          suggestion = `${gap.position} needed, lean college player for gap in ${yearsUntilGap} year${yearsUntilGap !== 1 ? 's' : ''}`;
        } else {
          suggestion = `No long term ${gap.position} depth in the majors, draft now`;
        }
        return `<li class="summary-link" data-target-pos="${gap.position}" data-target-year="${gap.gapStartYear}">${suggestion}</li>`;
      }).join('') + '</ul>';
    };

    // Year selector buttons
    const yearRange = this.getYearRange();
    const allActive = this.analysisYear === -1 ? ' active' : '';
    const yearSelectorHtml = `<button class="toggle-btn analysis-year-btn${allActive}" data-year-offset="-1">All</button>` +
      yearRange.map(y => {
        const offset = y - this.gameYear;
        const active = offset === this.analysisYear ? ' active' : '';
        return `<button class="toggle-btn analysis-year-btn${active}" data-year-offset="${offset}">${y}</button>`;
      }).join('');

    container.innerHTML = `
      <div class="analysis-year-selector">
        <span class="market-year-label">Target Season:</span>
        ${yearSelectorHtml}
      </div>
      <div class="planning-summary-section">
        <div class="planning-summary-card summary-card-strength">
          <div class="summary-card-header summary-header-strength">Positions of Strength</div>
          <div class="summary-card-body">
            ${renderList(strengths, 'No long-term strengths identified.')}
          </div>
        </div>
        <div class="planning-summary-card summary-card-need">
          <div class="summary-card-header summary-header-need">Positions of Need</div>
          <div class="summary-card-body">
            ${renderGroupedNeeds(needs, 'No significant gaps identified.')}
          </div>
        </div>
        <div class="planning-summary-card summary-card-extension">
          <div class="summary-card-header summary-header-extension">Extension Priorities</div>
          <div class="summary-card-body">
            ${renderList(extensions, 'No extension candidates.')}
          </div>
        </div>
        <div class="planning-summary-card summary-card-draft">
          <div class="summary-card-header summary-header-draft">Draft Strategy</div>
          <div class="summary-card-body">
            ${renderDraftStrategy(gaps)}
          </div>
        </div>
      </div>
    `;

    // Bind year selector
    container.querySelectorAll<HTMLElement>('.analysis-year-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const offset = parseInt(btn.dataset.yearOffset ?? '-1', 10);
        if (offset === this.analysisYear) return;
        this.analysisYear = offset;
        try { localStorage.setItem('wbl-tp-analysisYear', String(offset)); } catch { /* ignore */ }
        this.renderSummarySection();
        this.bindSummaryLinks();
      });
    });
  }

  private bindSummaryLinks(): void {
    const summaryContainer = this.container.querySelector<HTMLElement>('#tp-summary-container');
    if (!summaryContainer) return;
    summaryContainer.querySelectorAll<HTMLElement>('.summary-link').forEach(el => {
      el.addEventListener('click', () => {
        const pos = el.dataset.targetPos;
        const yr = el.dataset.targetYear ? parseInt(el.dataset.targetYear, 10) : null;
        if (pos && yr) this.navigateToGridCell(pos, yr);
      });
    });
  }

  // =====================================================================
  // Phase 2.5: Draft Reference Section
  // =====================================================================

  private analyzePositionGaps(): RosterGap[] {
    const yearRange = this.getYearRange();
    const gaps: RosterGap[] = [];

    for (const row of this.gridRows) {
      let gapYears = 0;
      let gapStartYear = 0;
      let hasProspect = false;

      for (let yi = 0; yi < yearRange.length; yi++) {
        const cell = row.cells.get(yearRange[yi]);
        const isGap = !cell || cell.contractStatus === 'empty' || (cell.rating > 0 && cell.rating < 3.0);
        if (isGap) {
          if (gapYears === 0) gapStartYear = yearRange[yi];
          gapYears++;
        }
        if (cell?.isProspect) {
          hasProspect = true;
        }
      }

      if (gapYears > 0) {
        gaps.push({
          position: row.position,
          section: row.section,
          gapStartYear,
          emptyYears: gapYears,
          hasProspectCoverage: hasProspect,
        });
      }
    }

    return gaps;
  }

  // =====================================================================
  // Override persistence and cell editing
  // =====================================================================

  private buildPlayerRatingMap(
    ranking: TeamPowerRanking,
    orgHitters: RatedHitterProspect[],
    orgPitchers: RatedProspect[],
  ): void {
    this.playerRatingMap.clear();
    // MLB lineup
    for (const b of ranking.lineup) this.playerRatingMap.set(b.playerId, b.trueRating);
    for (const b of ranking.bench) this.playerRatingMap.set(b.playerId, b.trueRating);
    // MLB pitching
    for (const p of ranking.rotation) this.playerRatingMap.set(p.playerId, p.trueRating);
    for (const p of ranking.bullpen) this.playerRatingMap.set(p.playerId, p.trueRating);
    // Unified hitter pool: store max(TR, TFR, canonical current) for edit modal sorting
    for (const h of orgHitters) {
      const existing = this.playerRatingMap.get(h.playerId) ?? 0;
      const prospectCurrent = this.prospectCurrentRatingMap.get(h.playerId) ?? 0;
      this.playerRatingMap.set(h.playerId, Math.max(existing, h.trueFutureRating, prospectCurrent));
    }
    // Pitcher prospects: store max(TR, TFR, canonical current) — matches hitter logic
    for (const p of orgPitchers) {
      const existing = this.playerRatingMap.get(p.playerId) ?? 0;
      const prospectCurrent = this.prospectCurrentRatingMap.get(p.playerId) ?? 0;
      this.playerRatingMap.set(p.playerId, Math.max(existing, p.trueFutureRating, prospectCurrent));
    }
  }

  private async loadOverrides(): Promise<void> {
    if (!this.selectedTeamId) return;
    const [records, devPlayerIds] = await Promise.all([
      indexedDBService.getTeamPlanningOverrides(this.selectedTeamId),
      indexedDBService.getAllPlayerDevOverrides(),
    ]);
    this.overrides.clear();
    for (const rec of records) {
      this.overrides.set(rec.key, rec);
    }
    this.devOverrides = new Set(devPlayerIds);
  }

  private applyOverrides(): void {
    for (const [, override] of this.overrides) {
      const row = this.gridRows.find(r => r.position === override.position);
      if (!row) continue;

      // Fix stale overrides saved with rating 0 (bug: player had no entry in rating maps)
      let effectiveRating = override.rating;
      if (effectiveRating <= 0 && override.playerId) {
        effectiveRating = this.playerRatingMap.get(override.playerId) ?? 0;
      }

      row.cells.set(override.year, {
        playerId: override.playerId,
        playerName: override.playerName,
        age: override.age,
        rating: effectiveRating,
        salary: override.salary,
        contractStatus: override.contractStatus as GridCell['contractStatus'],
        level: override.level,
        isProspect: override.isProspect,
        isOverride: true,
        overrideSourceType: override.sourceType,
      });
    }
  }

  private async openPlayerProfile(playerId: number): Promise<void> {
    const player = this.playerMap.get(playerId);
    if (!player) return;

    const team = this.teamLookup.get(player.teamId);
    const parentTeam = player.parentTeamId ? this.teamLookup.get(player.parentTeamId) : undefined;
    const teamLabel = team?.nickname ?? '';
    const parentLabel = parentTeam?.nickname ?? teamLabel;
    const isPitcher = player.position === 1;

    if (isPitcher) {
      await this.openPitcherProfile(playerId, player, teamLabel, parentLabel);
    } else {
      await this.openBatterProfile(playerId, player, teamLabel, parentLabel);
    }
  }

  private async openPitcherProfile(playerId: number, player: Player, teamLabel: string, parentLabel: string): Promise<void> {
    // Check farm data first (prospect) — try org-specific, then all orgs
    const prospect = this.cachedOrgPitchers.find(p => p.playerId === playerId)
      ?? this.cachedAllPitcherProspects.find(p => p.playerId === playerId);
    if (prospect) {
      const data: PitcherProfileData = {
        playerId,
        playerName: prospect.name,
        team: teamLabel,
        parentTeam: parentLabel,
        age: player.age,
        positionLabel: getPositionLabel(player.position),
        isProspect: true,
        trueFutureRating: prospect.trueFutureRating,
        tfrPercentile: prospect.percentile,
        hasTfrUpside: true,
        tfrStuff: prospect.trueRatings?.stuff,
        tfrControl: prospect.trueRatings?.control,
        tfrHra: prospect.trueRatings?.hra,
        scoutStuff: prospect.scoutingRatings?.stuff,
        scoutControl: prospect.scoutingRatings?.control,
        scoutHra: prospect.scoutingRatings?.hra,
        scoutStamina: prospect.scoutingRatings?.stamina,
        estimatedStuff: prospect.developmentTR?.stuff ?? prospect.trueRatings?.stuff,
        estimatedControl: prospect.developmentTR?.control ?? prospect.trueRatings?.control,
        estimatedHra: prospect.developmentTR?.hra ?? prospect.trueRatings?.hra,
        projWar: prospect.peakWar,
        projIp: prospect.peakIp,
        projK9: prospect.projK9,
        projBb9: prospect.projBb9,
        projHr9: prospect.projHr9,
        tfrBySource: prospect.tfrBySource,
      };
      await pitcherProfileModal.show(data as any, this.gameYear);
      return;
    }

    // MLB pitcher from rankings — try selected team first, then all teams
    let ratedPitcher: RatedPitcher | undefined;
    if (this.cachedRanking) {
      ratedPitcher = [...this.cachedRanking.rotation, ...this.cachedRanking.bullpen].find(p => p.playerId === playerId);
    }
    if (!ratedPitcher) {
      for (const r of this.cachedAllRankings) {
        ratedPitcher = [...r.rotation, ...r.bullpen].find(p => p.playerId === playerId);
        if (ratedPitcher) break;
      }
    }
    const data: PitcherProfileData = {
      playerId,
      playerName: ratedPitcher?.name ?? `${player.firstName} ${player.lastName}`,
      team: teamLabel,
      parentTeam: parentLabel,
      age: player.age,
      positionLabel: getPositionLabel(player.position),
      trueRating: ratedPitcher?.trueRating,
      estimatedStuff: ratedPitcher?.trueStuff,
      estimatedControl: ratedPitcher?.trueControl,
      estimatedHra: ratedPitcher?.trueHra,
      isProspect: false,
    };
    await pitcherProfileModal.show(data as any, this.gameYear);
  }

  private async openBatterProfile(playerId: number, player: Player, teamLabel: string, parentLabel: string): Promise<void> {
    // Check farm data first (prospect) — try org-specific, then all orgs
    const prospect = this.cachedOrgHitters.find(p => p.playerId === playerId)
      ?? this.cachedAllHitterProspects.find(p => p.playerId === playerId);
    if (prospect) {
      const data: BatterProfileData = {
        playerId,
        playerName: prospect.name,
        team: teamLabel,
        parentTeam: parentLabel,
        age: player.age,
        position: player.position,
        positionLabel: getPositionLabel(player.position),
        isProspect: true,
        trueFutureRating: prospect.trueFutureRating,
        tfrPercentile: prospect.percentile,
        hasTfrUpside: true,
        tfrPower: prospect.trueRatings?.power,
        tfrEye: prospect.trueRatings?.eye,
        tfrAvoidK: prospect.trueRatings?.avoidK,
        tfrContact: prospect.trueRatings?.contact,
        tfrGap: prospect.trueRatings?.gap,
        tfrSpeed: prospect.trueRatings?.speed,
        scoutPower: prospect.scoutingRatings?.power,
        scoutEye: prospect.scoutingRatings?.eye,
        scoutAvoidK: prospect.scoutingRatings?.avoidK,
        scoutContact: prospect.scoutingRatings?.contact,
        scoutGap: prospect.scoutingRatings?.gap,
        scoutSpeed: prospect.scoutingRatings?.speed,
        scoutOvr: prospect.scoutingRatings?.ovr,
        scoutPot: prospect.scoutingRatings?.pot,
        estimatedPower: prospect.developmentTR?.power ?? prospect.trueRatings?.power,
        estimatedEye: prospect.developmentTR?.eye ?? prospect.trueRatings?.eye,
        estimatedAvoidK: prospect.developmentTR?.avoidK ?? prospect.trueRatings?.avoidK,
        estimatedContact: prospect.developmentTR?.contact ?? prospect.trueRatings?.contact,
        estimatedGap: prospect.developmentTR?.gap ?? prospect.trueRatings?.gap,
        estimatedSpeed: prospect.developmentTR?.speed ?? prospect.trueRatings?.speed,
        projWoba: prospect.projWoba,
        projWar: prospect.projWar,
        projPa: prospect.projPa,
        projAvg: prospect.projAvg,
        projBbPct: prospect.projBbPct,
        projKPct: prospect.projKPct,
        projHrPct: prospect.projHrPct,
        injuryProneness: prospect.injuryProneness,
        tfrBySource: prospect.tfrBySource,
      };
      await batterProfileModal.show(data, this.gameYear);
      return;
    }

    // MLB batter from rankings — try selected team first, then all teams
    let ratedBatter: RatedBatter | undefined;
    if (this.cachedRanking) {
      ratedBatter = [...this.cachedRanking.lineup, ...this.cachedRanking.bench].find(b => b.playerId === playerId);
    }
    if (!ratedBatter) {
      for (const r of this.cachedAllRankings) {
        ratedBatter = [...r.lineup, ...r.bench].find(b => b.playerId === playerId);
        if (ratedBatter) break;
      }
    }
    const data: BatterProfileData = {
      playerId,
      playerName: ratedBatter?.name ?? `${player.firstName} ${player.lastName}`,
      team: teamLabel,
      parentTeam: parentLabel,
      age: player.age,
      position: player.position,
      positionLabel: getPositionLabel(player.position),
      trueRating: ratedBatter?.trueRating,
      estimatedPower: ratedBatter?.estimatedPower,
      estimatedEye: ratedBatter?.estimatedEye,
      estimatedAvoidK: ratedBatter?.estimatedAvoidK,
      estimatedContact: ratedBatter?.estimatedContact,
      estimatedGap: ratedBatter?.estimatedGap,
      estimatedSpeed: ratedBatter?.estimatedSpeed,
      pa: ratedBatter?.stats?.pa,
      avg: ratedBatter?.stats?.avg,
      obp: ratedBatter?.stats?.obp,
      slg: ratedBatter?.stats?.slg,
      hr: ratedBatter?.stats?.hr,
      war: ratedBatter?.stats?.war,
      woba: ratedBatter?.woba,
      percentile: ratedBatter?.percentile,
      projWar: ratedBatter?.projWar,
      projBbPct: ratedBatter?.blendedBbPct,
      projKPct: ratedBatter?.blendedKPct,
      projHrPct: ratedBatter?.blendedHrPct,
      projAvg: ratedBatter?.blendedAvg,
      projDoublesRate: ratedBatter?.blendedDoublesRate,
      projTriplesRate: ratedBatter?.blendedTriplesRate,
      projWoba: ratedBatter?.woba,
      isProspect: false,
    };
    await batterProfileModal.show(data, this.gameYear);
  }

  private async handleCellClick(position: string, year: number): Promise<void> {
    if (!this.selectedTeamId) return;

    const row = this.gridRows.find(r => r.position === position);
    if (!row) return;

    const currentCell = row.cells.get(year);
    const currentCellData = currentCell && currentCell.contractStatus !== 'empty'
      ? { playerId: currentCell.playerId, playerName: currentCell.playerName, age: currentCell.age, rating: currentCell.rating }
      : null;

    // Find incumbent: look leftward in the row for a non-prospect, non-empty cell with a playerId
    let incumbentCell: CellEditContext['incumbentCell'] = null;
    const yearRange = this.getYearRange();
    const yearIndex = yearRange.indexOf(year);
    for (let i = yearIndex - 1; i >= 0; i--) {
      const cell = row.cells.get(yearRange[i]);
      if (cell && cell.playerId && !cell.isProspect && cell.contractStatus !== 'empty') {
        incumbentCell = { playerId: cell.playerId, playerName: cell.playerName, age: cell.age, rating: cell.rating };
        break;
      }
    }

    // Look up TFR and dev override state for the current cell's player
    // Only show TFR when there's unrealized upside (TFR > current rating)
    const currentPlayerId = currentCellData?.playerId;
    const rawTfr = currentPlayerId ? this.playerTfrMap.get(currentPlayerId) : undefined;
    const currentPlayerTfr = (rawTfr !== undefined && currentCellData && rawTfr > currentCellData.rating) ? rawTfr : undefined;
    const currentPlayerDevOverride = currentPlayerId ? this.devOverrides.has(currentPlayerId) : false;

    const context: CellEditContext = {
      position,
      year,
      section: row.section,
      currentCell: currentCellData,
      incumbentCell,
      teamId: this.selectedTeamId,
      gameYear: this.gameYear,
      currentPlayerTfr,
      currentPlayerDevOverride,
    };

    // Build org player list sorted by TFR/TR (highest first)
    const orgPlayers = Array.from(this.playerMap.values())
      .filter(p => p.parentTeamId === this.selectedTeamId || p.teamId === this.selectedTeamId)
      .sort((a, b) => (this.playerRatingMap.get(b.id) ?? 0) - (this.playerRatingMap.get(a.id) ?? 0));
    const allPlayers = Array.from(this.playerMap.values()).filter(p => !p.retired);

    // Display rating map: use current ability (not TFR ceiling) so prospects
    // show their development-curve estimate rather than their ceiling rating.
    const displayRatingMap = new Map<number, number>();
    for (const p of orgPlayers) {
      displayRatingMap.set(p.id, this.resolveCurrentRatingForProjection(p.id));
    }

    // Build projected age/rating map only for future years.
    // For current year edits, displayRatingMap provides the correct current ability.
    const yearOffset = year - this.gameYear;
    let projectedDataMap: Map<number, { projectedAge: number; projectedRating: number }> | undefined;
    if (yearOffset > 0) {
      projectedDataMap = new Map<number, { projectedAge: number; projectedRating: number }>();
      for (const p of orgPlayers) {
        const baseAge = this.playerAgeMap.get(p.id) ?? p.age;
        const currentRating = this.resolveCurrentRatingForProjection(p.id);
        const tfr = this.playerTfrMap.get(p.id);
        const peakRating = (tfr !== undefined && tfr > currentRating) ? tfr : currentRating;
        const effectiveCurrent = this.devOverrides.has(p.id) ? Math.max(currentRating, peakRating) : currentRating;
        const projRating = this.projectPlanningRating(effectiveCurrent, peakRating, baseAge, yearOffset);
        projectedDataMap.set(p.id, { projectedAge: baseAge + yearOffset, projectedRating: projRating });
      }
    }

    const result = await this.cellEditModal.show(context, orgPlayers, allPlayers, this.contractMap, displayRatingMap, projectedDataMap);
    await this.processEditResult(result, position, year);
  }

  private async processEditResult(result: CellEditResult, position: string, year: number): Promise<void> {
    if (!this.selectedTeamId) return;

    if (result.action === 'cancel') return;

    if (result.action === 'dev-override-set' && result.devOverridePlayerId) {
      await indexedDBService.savePlayerDevOverride(result.devOverridePlayerId);
      this.devOverrides.add(result.devOverridePlayerId);
      await this.buildAndRenderGrid();
      return;
    }

    if (result.action === 'dev-override-remove' && result.devOverridePlayerId) {
      await indexedDBService.deletePlayerDevOverride(result.devOverridePlayerId);
      this.devOverrides.delete(result.devOverridePlayerId);
      await this.buildAndRenderGrid();
      return;
    }

    if (result.action === 'clear') {
      const key = `${this.selectedTeamId}_${position}_${year}`;
      // Save an explicit empty override so the cell becomes vacant,
      // even if there was a default player auto-assigned to this slot
      const emptyOverride: TeamPlanningOverrideRecord = {
        key,
        teamId: this.selectedTeamId,
        position,
        year,
        playerId: null,
        playerName: '',
        age: 0,
        rating: 0,
        salary: 0,
        contractStatus: 'empty',
        sourceType: 'clear',
        createdAt: Date.now(),
      };
      await indexedDBService.saveTeamPlanningOverride(emptyOverride);
      this.overrides.set(key, emptyOverride);
      await this.buildAndRenderGrid();
      return;
    }

    if (result.action === 'extend' && result.player) {
      const years = result.extensionYears ?? 1;
      const yearRange = this.getYearRange();
      const startIndex = yearRange.indexOf(year);
      const records: TeamPlanningOverrideRecord[] = [];

      // Find the incumbent's current age from the playerMap
      const player = this.playerMap.get(result.player.id);
      const baseAge = player?.age ?? result.player.age;
      const incumbentRating = result.rating ?? 0;

      for (let i = 0; i < years && startIndex + i < yearRange.length; i++) {
        const targetYear = yearRange[startIndex + i];
        const yearOffset = targetYear - this.gameYear;
        const key = `${this.selectedTeamId}_${position}_${targetYear}`;
        const record: TeamPlanningOverrideRecord = {
          key,
          teamId: this.selectedTeamId,
          position,
          year: targetYear,
          playerId: result.player.id,
          playerName: `${result.player.firstName} ${result.player.lastName}`,
          age: baseAge + yearOffset,
          rating: incumbentRating,
          salary: 0,
          contractStatus: i === years - 1 ? 'final-year' : 'under-contract',
          sourceType: 'extend',
          createdAt: Date.now(),
        };
        records.push(record);
        this.overrides.set(key, record);
      }

      await indexedDBService.saveTeamPlanningOverrides(records);
      await this.buildAndRenderGrid();
      return;
    }

    if ((result.action === 'org-select' || result.action === 'search-select') && result.player) {
      const player = result.player;
      const sourceType = result.sourceType ?? 'org';
      const contract = this.contractMap.get(player.id);
      const isMinorLeaguer = player.level !== undefined && player.level > 1;

      // Resolve current ability (without TFR) for projection, and TFR as ceiling.
      const baseAge = this.playerAgeMap.get(player.id) ?? player.age;
      const currentRating = this.resolveCurrentRatingForProjection(player.id);
      const tfr = this.playerTfrMap.get(player.id);
      const peakRating = (tfr !== undefined && tfr > currentRating) ? tfr : currentRating;
      const effectiveCurrent = this.devOverrides.has(player.id) ? Math.max(currentRating, peakRating) : currentRating;
      // For salary estimation, use TFR-inclusive rating (consistent with auto-fill salary logic)
      const salaryBasisRating = this.resolveBestKnownRating(player.id, year);

      // Determine how many years of control we have
      let controlYears: number;
      const serviceYears = this.playerServiceYearsMap.get(player.id) ?? 0;

      if (!contract || isMinorLeaguer) {
        // No contract or minor leaguer → full 6 years of team control
        controlYears = TEAM_CONTROL_YEARS;
      } else {
        const currentSalary = contractService.getCurrentSalary(contract);
        const contractYearsRemaining = contractService.getYearsRemaining(contract);

        if (serviceYears > 0 && serviceYears <= TEAM_CONTROL_YEARS) {
          // Use actual MLB service years for team control
          const teamControlRemaining = TEAM_CONTROL_YEARS - serviceYears + 1;
          controlYears = Math.max(contractYearsRemaining, teamControlRemaining);
        } else if (currentSalary <= MIN_SALARY_THRESHOLD) {
          // No stats data — fall back to age-based estimate for min-salary players
          const estimatedServiceYears = Math.max(0, player.age - TYPICAL_DEBUT_AGE);
          const teamControlLeft = Math.max(1, TEAM_CONTROL_YEARS - estimatedServiceYears);
          controlYears = Math.max(contractYearsRemaining, teamControlLeft);
        } else {
          // No service data and not min salary — use contract years
          controlYears = contractYearsRemaining;
        }
      }

      const yearRange = this.getYearRange();
      const startIndex = yearRange.indexOf(year);
      const records: TeamPlanningOverrideRecord[] = [];
      const clearRecords: TeamPlanningOverrideRecord[] = [];
      const targetYears: number[] = [];

      // Determine service year offset for salary estimation
      let serviceYearStart = serviceYears > 0 ? serviceYears : 1;
      if (serviceYears === 0 && contract && !isMinorLeaguer) {
        const currentSalary = contractService.getCurrentSalary(contract);
        if (currentSalary <= MIN_SALARY_THRESHOLD) {
          // On minimum deal — estimate how many service years they already have
          serviceYearStart = Math.max(1, Math.max(0, player.age - TYPICAL_DEBUT_AGE) + 1);
        }
      }

      for (let i = 0; i < controlYears && startIndex + i < yearRange.length; i++) {
        targetYears.push(yearRange[startIndex + i]);
      }

      // Ensure one slot per player per year: if this player already occupies
      // another row in any target year, clear that original slot.
      for (const targetYear of targetYears) {
        for (const row of this.gridRows) {
          if (row.position === position) continue;
          const cell = row.cells.get(targetYear);
          if (!cell || cell.playerId !== player.id) continue;

          const key = `${this.selectedTeamId}_${row.position}_${targetYear}`;
          if (records.some(r => r.key === key) || clearRecords.some(r => r.key === key)) continue;

          const clearRecord: TeamPlanningOverrideRecord = {
            key,
            teamId: this.selectedTeamId,
            position: row.position,
            year: targetYear,
            playerId: null,
            playerName: '',
            age: 0,
            rating: 0,
            salary: 0,
            contractStatus: 'empty',
            sourceType,
            createdAt: Date.now(),
          };
          clearRecords.push(clearRecord);
          this.overrides.set(key, clearRecord);
        }
      }

      for (let i = 0; i < controlYears && startIndex + i < yearRange.length; i++) {
        const targetYear = yearRange[startIndex + i];
        const yearOffset = targetYear - this.gameYear;
        const key = `${this.selectedTeamId}_${position}_${targetYear}`;

        // Project rating: grow from current ability toward peak, then age decline
        const cellRating = this.projectPlanningRating(effectiveCurrent, peakRating, baseAge, yearOffset);

        // Compute salary: use contract salary if available, otherwise estimate from team control
        let cellSalary: number;
        if (contract && !isMinorLeaguer) {
          const contractYearsRemaining = contractService.getYearsRemaining(contract);
          if (i < contractYearsRemaining) {
            cellSalary = contractService.getSalaryForYear(contract, i);
          } else {
            // Beyond contract — arb/team control estimate
            const serviceYear = serviceYearStart + i;
            cellSalary = estimateTeamControlSalary(serviceYear, salaryBasisRating);
          }
        } else {
          // Minor leaguer or no contract — full team control estimate
          const serviceYear = i + 1;
          cellSalary = estimateTeamControlSalary(serviceYear, salaryBasisRating);
        }

        const isLastYear = i === controlYears - 1;
        const record: TeamPlanningOverrideRecord = {
          key,
          teamId: this.selectedTeamId,
          position,
          year: targetYear,
          playerId: player.id,
          playerName: `${player.firstName} ${player.lastName}`,
          age: player.age + yearOffset,
          rating: cellRating,
          salary: cellSalary,
          contractStatus: isLastYear ? 'final-year' : 'under-contract',
          isProspect: isMinorLeaguer,
          sourceType,
          createdAt: Date.now(),
        };
        records.push(record);
        this.overrides.set(key, record);
      }

      await indexedDBService.saveTeamPlanningOverrides([...clearRecords, ...records]);
      await this.buildAndRenderGrid();
      return;
    }
  }

  private async handleResetEdits(): Promise<void> {
    if (!this.selectedTeamId || this.overrides.size === 0) return;

    const answer = await this.messageModal.confirm(
      'Reset All Edits',
      'This will clear all manual cell edits for this team and restore the auto-generated grid. Continue?',
      ['Reset', 'Cancel'],
    );

    if (answer === 'Reset') {
      await indexedDBService.deleteAllTeamPlanningOverrides(this.selectedTeamId);
      this.overrides.clear();
      await this.buildAndRenderGrid();
    }
  }

  // =====================================================================
  // Trade Market — Analysis
  // =====================================================================

  /**
   * Analyze a team's needs, surplus prospects, and surplus MLB players.
   * @param yearOffset — how many years into the future (0 = current). For the selected
   *   team we use the planning grid; for other teams we project from current roster + contracts.
   */
  private analyzeTeamTradeProfile(
    teamId: number,
    ranking: TeamPowerRanking,
    allHitterProspects: RatedHitterProspect[],
    allPitcherProspects: RatedProspect[],
    yearOffset: number = 0,
  ): TeamTradeProfile {
    const teamName = ranking.teamName;
    const needs: TeamNeed[] = [];
    const surplusProspects: SurplusProspect[] = [];
    const surplusMlbPlayers: SurplusMlbPlayer[] = [];
    const targetYear = this.gameYear + yearOffset;

    // --- Detect needs ---
    // For the selected team, use grid data (includes prospect fill + overrides).
    // For other teams, use current roster adjusted for contract coverage.
    const isSelectedTeam = teamId === this.selectedTeamId;

    if (isSelectedTeam && yearOffset > 0 && this.gridRows.length > 0) {
      // Use the planning grid for the selected team — it already has projected
      // ratings, prospect fill-ins, and user overrides baked in.
      for (const row of this.gridRows) {
        const cell = row.cells.get(targetYear);
        const rating = cell?.rating ?? 0;
        const isEmpty = !cell || cell.contractStatus === 'empty';
        // Skip deep bullpen (MR1-MR5)
        if (row.section === 'bullpen' && !['CL', 'SU1', 'SU2'].includes(row.position)) continue;

        if (isEmpty || rating < 3.0) {
          needs.push({
            position: row.position,
            section: row.section,
            severity: rating < 2.0 || isEmpty ? 'critical' : 'moderate',
            bestCurrentRating: rating,
            playerName: cell?.playerName ?? '',
          });
        }
      }
    } else {
      // Use current roster, adjusted for contract expiration at yearOffset
      const lineupByPos = new Map<string, RatedBatter>();
      for (const b of ranking.lineup) lineupByPos.set(b.positionLabel, b);

      for (const posLabel of LINEUP_POSITIONS) {
        const batter = lineupByPos.get(posLabel);
        let rating = batter?.trueRating ?? 0;
        // If we're looking into the future, check if the incumbent's contract covers the target year
        if (batter && yearOffset > 0) {
          const contract = this.contractMap.get(batter.playerId);
          const yearsLeft = contract ? contractService.getYearsRemaining(contract) : 0;
          if (yearsLeft <= yearOffset) rating = 0; // gone by then
        }
        if (rating < 3.0) {
          needs.push({
            position: posLabel,
            section: 'lineup',
            severity: rating < 2.0 || rating === 0 ? 'critical' : 'moderate',
            bestCurrentRating: rating,
            playerName: rating > 0 ? (batter?.name ?? '') : '',
          });
        }
      }

      for (let i = 0; i < ROTATION_POSITIONS.length; i++) {
        const sp = ranking.rotation[i];
        let rating = sp?.trueRating ?? 0;
        if (sp && yearOffset > 0) {
          const contract = this.contractMap.get(sp.playerId);
          const yearsLeft = contract ? contractService.getYearsRemaining(contract) : 0;
          if (yearsLeft <= yearOffset) rating = 0;
        }
        if (rating < 3.0) {
          needs.push({
            position: ROTATION_POSITIONS[i],
            section: 'rotation',
            severity: rating < 2.0 || rating === 0 ? 'critical' : 'moderate',
            bestCurrentRating: rating,
            playerName: rating > 0 ? (sp?.name ?? '') : '',
          });
        }
      }

      for (let i = 0; i < Math.min(3, BULLPEN_POSITIONS.length); i++) {
        const rp = ranking.bullpen[i];
        let rating = rp?.trueRating ?? 0;
        if (rp && yearOffset > 0) {
          const contract = this.contractMap.get(rp.playerId);
          const yearsLeft = contract ? contractService.getYearsRemaining(contract) : 0;
          if (yearsLeft <= yearOffset) rating = 0;
        }
        if (rating < 3.0) {
          needs.push({
            position: BULLPEN_POSITIONS[i],
            section: 'bullpen',
            severity: rating < 2.0 || rating === 0 ? 'critical' : 'moderate',
            bestCurrentRating: rating,
            playerName: rating > 0 ? (rp?.name ?? '') : '',
          });
        }
      }
    }

    // --- Detect surplus prospects (TFR >= 3.0, blocked at natural position) ---
    // Build lineup map from current roster for blocking check (always uses current roster)
    const lineupByPosForSurplus = new Map<string, RatedBatter>();
    for (const b of ranking.lineup) lineupByPosForSurplus.set(b.positionLabel, b);

    const orgHitters = allHitterProspects.filter(p => p.orgId === teamId && p.trueFutureRating >= 3.0);
    const orgPitchers = allPitcherProspects.filter(p => p.orgId === teamId && p.trueFutureRating >= 3.0);

    for (const prospect of orgHitters) {
      const posLabel = POSITION_CODE_TO_LABEL[prospect.position] ?? 'DH';
      const incumbent = lineupByPosForSurplus.get(posLabel);
      if (!incumbent) continue;

      const incumbentContract = this.contractMap.get(incumbent.playerId);
      const incumbentYears = incumbentContract ? contractService.getYearsRemaining(incumbentContract) : 0;
      // Blocked: incumbent is strong AND still covers the position past yearOffset
      const effectiveBlockingYears = Math.max(0, incumbentYears - yearOffset);
      if (incumbent.trueRating >= 3.5 && effectiveBlockingYears >= 3) {
        surplusProspects.push({
          playerId: prospect.playerId,
          name: prospect.name,
          position: prospect.position,
          positionLabel: posLabel,
          tfr: prospect.trueFutureRating,
          age: prospect.age,
          level: prospect.level,
          orgId: teamId,
          orgName: teamName,
          blockingPlayer: incumbent.name,
          blockingRating: incumbent.trueRating,
          blockingYears: effectiveBlockingYears,
          isPitcher: false,
        });
      }
    }

    for (const prospect of orgPitchers) {
      const pitches = prospect.scoutingRatings?.pitches ?? 0;
      const stamina = prospect.scoutingRatings?.stamina ?? 0;
      const isSP = pitches >= 3 && stamina >= 30;

      if (isSP) {
        const weakSP = ranking.rotation.find(sp => {
          if (sp.trueRating < 3.5) return true;
          // If we're in the future, check if this SP's contract covers the target year
          if (yearOffset > 0) {
            const c = this.contractMap.get(sp.playerId);
            if (c && contractService.getYearsRemaining(c) <= yearOffset) return true;
          }
          return false;
        });
        if (!weakSP) {
          const bestSP = ranking.rotation[0];
          const bestContract = bestSP ? this.contractMap.get(bestSP.playerId) : undefined;
          const blockYears = bestContract ? Math.max(0, contractService.getYearsRemaining(bestContract) - yearOffset) : 3;
          surplusProspects.push({
            playerId: prospect.playerId,
            name: prospect.name,
            position: 1,
            positionLabel: 'SP',
            tfr: prospect.trueFutureRating,
            age: prospect.age,
            level: prospect.level,
            orgId: teamId,
            orgName: teamName,
            blockingPlayer: bestSP?.name ?? 'Rotation',
            blockingRating: ranking.rotationRating,
            blockingYears: blockYears,
            isPitcher: true,
          });
        }
      } else {
        const weakRP = ranking.bullpen.slice(0, 3).find(rp => {
          if (rp.trueRating < 3.5) return true;
          if (yearOffset > 0) {
            const c = this.contractMap.get(rp.playerId);
            if (c && contractService.getYearsRemaining(c) <= yearOffset) return true;
          }
          return false;
        });
        if (!weakRP) {
          const bestRP = ranking.bullpen[0];
          const bestContract = bestRP ? this.contractMap.get(bestRP.playerId) : undefined;
          const blockYears = bestContract ? Math.max(0, contractService.getYearsRemaining(bestContract) - yearOffset) : 3;
          surplusProspects.push({
            playerId: prospect.playerId,
            name: prospect.name,
            position: 1,
            positionLabel: 'RP',
            tfr: prospect.trueFutureRating,
            age: prospect.age,
            level: prospect.level,
            orgId: teamId,
            orgName: teamName,
            blockingPlayer: bestRP?.name ?? 'Bullpen',
            blockingRating: ranking.bullpenRating,
            blockingYears: blockYears,
            isPitcher: true,
          });
        }
      }
    }

    // --- Detect surplus MLB players (expiring + prospect replacement ready) ---
    const allRosterPlayers = [
      ...ranking.lineup.map(b => ({ ...b, isPitcher: false, posLabel: b.positionLabel })),
      ...ranking.rotation.map((p, i) => ({ ...p, isPitcher: true, posLabel: ROTATION_POSITIONS[i], position: 1 })),
      ...ranking.bullpen.slice(0, 3).map((p, i) => ({ ...p, isPitcher: true, posLabel: BULLPEN_POSITIONS[i], position: 1 })),
    ];

    for (const mlb of allRosterPlayers) {
      if (mlb.trueRating < 3.0) continue;
      const contract = this.contractMap.get(mlb.playerId);
      if (!contract) continue;
      const yearsLeft = contractService.getYearsRemaining(contract);
      // Adjust for year offset: player must still be under contract at that point
      if (yearsLeft <= yearOffset) continue; // already gone by target year
      const effectiveYearsLeft = yearsLeft - yearOffset;
      if (effectiveYearsLeft > 2) continue; // not expiring at target year

      let bestReplacement: { name: string; tfr: number } | null = null;
      if (mlb.isPitcher) {
        const candidates = orgPitchers
          .filter(p => p.trueFutureRating >= 3.0 && this.estimateETA(p) <= 2 + yearOffset)
          .sort((a, b) => b.trueFutureRating - a.trueFutureRating);
        if (candidates.length > 0) bestReplacement = { name: candidates[0].name, tfr: candidates[0].trueFutureRating };
      } else {
        const posCode = 'position' in mlb ? (mlb.position as number) : 0;
        const candidates = orgHitters
          .filter(h => h.trueFutureRating >= 3.0 && h.position === posCode && this.estimateETA(h) <= 2 + yearOffset)
          .sort((a, b) => b.trueFutureRating - a.trueFutureRating);
        if (candidates.length > 0) bestReplacement = { name: candidates[0].name, tfr: candidates[0].trueFutureRating };
      }

      if (bestReplacement) {
        const player = this.playerMap.get(mlb.playerId);
        surplusMlbPlayers.push({
          playerId: mlb.playerId,
          name: mlb.name,
          positionLabel: mlb.posLabel,
          trueRating: mlb.trueRating,
          age: (player?.age ?? 0) + yearOffset,
          contractYearsRemaining: effectiveYearsLeft,
          isExpiring: effectiveYearsLeft === 1,
          orgId: teamId,
          orgName: teamName,
          isPitcher: mlb.isPitcher,
          replacementName: bestReplacement.name,
          replacementTfr: bestReplacement.tfr,
        });
      }
    }

    return { teamId, teamName, needs, surplusProspects, surplusMlbPlayers };
  }

  private buildAllTeamProfiles(): Map<number, TeamTradeProfile> {
    const yearOffset = this.tradeMarketYear;
    const profiles = new Map<number, TeamTradeProfile>();
    for (const ranking of this.cachedAllRankings) {
      const profile = this.analyzeTeamTradeProfile(
        ranking.teamId,
        ranking,
        this.cachedAllHitterProspects,
        this.cachedAllPitcherProspects,
        yearOffset,
      );
      profiles.set(ranking.teamId, profile);
    }
    return profiles;
  }

  private findTradeMatches(): TradeMarketMatch[] {
    if (!this.selectedTeamId) return [];
    const myProfile = this.cachedTradeProfiles.get(this.selectedTeamId);
    if (!myProfile) return [];

    const matches: TradeMarketMatch[] = [];

    /** Check if a player's position can fill a need position. */
    const positionFitsNeed = (playerPosLabel: string, needPos: string, isPitcher: boolean): boolean => {
      if (isPitcher) {
        if (playerPosLabel === 'SP') return needPos.startsWith('SP');
        if (playerPosLabel === 'RP') return ['CL', 'SU1', 'SU2'].includes(needPos);
        return false;
      }
      // Hitter: check if the player's natural position can play the need position
      const playerSlot = POSITION_SLOTS.find(s => s.label === playerPosLabel);
      const needSlot = POSITION_SLOTS.find(s => s.label === needPos);
      if (!playerSlot || !needSlot) return playerPosLabel === needPos;
      // Player's position code must be in the need slot's canPlay list
      const playerPosCode = Object.entries(POSITION_CODE_TO_LABEL)
        .find(([, label]) => label === playerPosLabel)?.[0];
      if (!playerPosCode) return false;
      return needSlot.canPlay.includes(parseInt(playerPosCode, 10));
    };

    for (const need of myProfile.needs) {
      const targets: TradeTarget[] = [];

      const yearOffset = this.tradeMarketYear;

      for (const [otherTeamId, otherProfile] of this.cachedTradeProfiles) {
        if (otherTeamId === this.selectedTeamId) continue;

        // Collect specific two-way match details for this team pair (deduplicated)
        const collectMatchDetails = (): TradeMatchDetail[] => {
          const seen = new Set<string>();
          const details: TradeMatchDetail[] = [];
          for (const theirNeed of otherProfile.needs) {
            for (const ourSurplus of myProfile.surplusProspects) {
              if (positionFitsNeed(ourSurplus.positionLabel, theirNeed.position, ourSurplus.isPitcher)) {
                const key = `${ourSurplus.playerId}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  details.push({ name: ourSurplus.name, positionLabel: ourSurplus.positionLabel, rating: ourSurplus.tfr, isProspect: true });
                }
              }
            }
            for (const ourSurplus of myProfile.surplusMlbPlayers) {
              if (positionFitsNeed(ourSurplus.positionLabel, theirNeed.position, ourSurplus.isPitcher)) {
                const key = `${ourSurplus.playerId}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  details.push({ name: ourSurplus.name, positionLabel: ourSurplus.positionLabel, rating: ourSurplus.trueRating, isProspect: false });
                }
              }
            }
          }
          return details;
        };

        // Check their surplus prospects
        for (const prospect of otherProfile.surplusProspects) {
          if (!positionFitsNeed(prospect.positionLabel, need.position, prospect.isPitcher)) continue;

          // ETA filter: prospect must be able to help within a year of the target season
          const eta = this.estimateETA({ level: prospect.level, trueFutureRating: prospect.tfr });
          if (eta > yearOffset + 1) continue;

          const matchDetails = collectMatchDetails();
          const complementary = matchDetails.length > 0;

          const matchScore = prospect.tfr * 10
            + (complementary ? 20 : 0)
            + (prospect.level === 'AAA' ? 5 : prospect.level === 'AA' ? 3 : 0);

          targets.push({
            player: prospect,
            isProspect: true,
            matchScore,
            sourceTeamNeeds: otherProfile.needs,
            complementary,
            matchDetails,
          });
        }

        // Check their surplus MLB players
        for (const mlbPlayer of otherProfile.surplusMlbPlayers) {
          if (!positionFitsNeed(mlbPlayer.positionLabel, need.position, mlbPlayer.isPitcher)) continue;

          const matchDetails = collectMatchDetails();
          const complementary = matchDetails.length > 0;

          const matchScore = mlbPlayer.trueRating * 10
            + (complementary ? 20 : 0)
            + (mlbPlayer.isExpiring ? 3 : 0);

          targets.push({
            player: mlbPlayer,
            isProspect: false,
            matchScore,
            sourceTeamNeeds: otherProfile.needs,
            complementary,
            matchDetails,
          });
        }
      }

      // Sort: complementary first, then by score
      targets.sort((a, b) => {
        if (a.complementary !== b.complementary) return a.complementary ? -1 : 1;
        return b.matchScore - a.matchScore;
      });

      if (targets.length > 0) {
        matches.push({
          position: need.position,
          section: need.section,
          severity: need.severity,
          targets: targets.slice(0, 8),
        });
      }
    }

    return matches;
  }

  // =====================================================================
  // Trade Market — Rendering
  // =====================================================================

  private renderTradeMarket(): void {
    const container = this.container.querySelector<HTMLElement>('#tp-market-container');
    if (!container) return;

    if (!this.selectedTeamId) {
      container.innerHTML = '<p class="empty-text">Select a team to view trade market.</p>';
      return;
    }

    const myProfile = this.cachedTradeProfiles.get(this.selectedTeamId);
    if (!myProfile) {
      container.innerHTML = '<p class="empty-text">No trade data available.</p>';
      return;
    }

    const matches = this.findTradeMatches();
    const targetYear = this.gameYear + this.tradeMarketYear;

    // Year selector buttons
    const yearRange = this.getYearRange();
    const yearSelectorHtml = yearRange.map(y => {
      const offset = y - this.gameYear;
      const active = offset === this.tradeMarketYear ? ' active' : '';
      return `<button class="toggle-btn market-year-btn${active}" data-year-offset="${offset}">${y}</button>`;
    }).join('');

    // Section 1: Your Situation
    const yearLabel = this.tradeMarketYear === 0 ? 'current' : `${targetYear} projected`;
    const needsHtml = myProfile.needs.length > 0
      ? '<ul class="summary-list">' + myProfile.needs.map(n => {
        const nameStr = n.playerName ? ` (${this.abbreviateName(n.playerName)})` : '';
        const ratingStr = n.bestCurrentRating > 0 ? `${n.bestCurrentRating.toFixed(1)}${nameStr}` : 'empty';
        return `<li class="summary-link" data-target-pos="${n.position}" data-target-year="${targetYear}"><span class="market-severity-${n.severity}">${n.severity.toUpperCase()}</span> ${n.position} — ${yearLabel}: ${ratingStr}</li>`;
      }).join('') + '</ul>'
      : '<p class="summary-empty">No significant needs identified.</p>';

    const surplusProspectsHtml = myProfile.surplusProspects.length > 0
      ? myProfile.surplusProspects.map(p =>
        `<div class="market-player-card market-prospect-card">
          <span class="cell-name-link" data-profile-id="${p.playerId}" title="ID: ${p.playerId}">${this.abbreviateName(p.name)}</span>
          <span class="badge ${this.getRatingClass(p.tfr)} cell-rating">${p.tfr.toFixed(1)}</span>
          <span class="market-pos-badge">${p.positionLabel}</span>
          <span class="market-detail">${p.level}, Age ${p.age}</span>
          <span class="market-block-info">blocked by ${this.abbreviateName(p.blockingPlayer)} (${p.blockingRating.toFixed(1)}, ${p.blockingYears}yr)</span>
        </div>`
      ).join('')
      : '<p class="summary-empty">No blocked prospects.</p>';

    const surplusMlbHtml = myProfile.surplusMlbPlayers.length > 0
      ? myProfile.surplusMlbPlayers.map(p =>
        `<div class="market-player-card market-mlb-card">
          <span class="cell-name-link" data-profile-id="${p.playerId}" title="ID: ${p.playerId}">${this.abbreviateName(p.name)}</span>
          <span class="badge ${this.getRatingClass(p.trueRating)} cell-rating">${p.trueRating.toFixed(1)}</span>
          <span class="market-pos-badge">${p.positionLabel}</span>
          <span class="market-detail">Age ${p.age}, ${p.contractYearsRemaining}yr left</span>
          <span class="market-block-info">${p.contractYearsRemaining <= 1 ? 'expiring' : `${p.contractYearsRemaining}yr left`}, replaced by ${this.abbreviateName(p.replacementName)} (${p.replacementTfr.toFixed(1)} TFR)</span>
        </div>`
      ).join('')
      : '';

    // Section 2: Trade Targets by Position
    const targetsHtml = matches.length > 0
      ? matches.map(m => `
        <div class="market-target-group">
          <div class="market-target-header">
            <span class="market-pos-label">${m.position}</span>
            <span class="market-severity-${m.severity}">${m.severity.toUpperCase()}</span>
          </div>
          <div class="market-target-list">
            ${m.targets.map(t => this.renderTradeTargetCard(t)).join('')}
          </div>
        </div>
      `).join('')
      : '<p class="summary-empty">No matching trade targets found.</p>';

    container.innerHTML = `
      <div class="trade-market-section">
        <div class="market-year-selector">
          <span class="market-year-label">Target Season:</span>
          ${yearSelectorHtml}
        </div>

        <div class="trade-market-overview">
          <div class="planning-summary-card summary-card-need">
            <div class="summary-card-header summary-header-need">Positions of Need</div>
            <div class="summary-card-body">
              ${needsHtml}
            </div>
          </div>
          <div class="planning-summary-card summary-card-strength">
            <div class="summary-card-header summary-header-strength">Trade Chips</div>
            <div class="summary-card-body">
              ${myProfile.surplusProspects.length > 0 ? '<div class="market-surplus-label">Blocked Prospects</div>' : ''}
              ${surplusProspectsHtml}
              ${myProfile.surplusMlbPlayers.length > 0 ? '<div class="market-surplus-label">Tradeable Players</div>' : ''}
              ${surplusMlbHtml}
            </div>
          </div>
        </div>

        <div class="trade-market-targets">
          <h3 class="market-section-title">Trade Targets by Position</h3>
          ${targetsHtml}
        </div>
      </div>
    `;

    // Bind year selector
    container.querySelectorAll<HTMLElement>('.market-year-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const offset = parseInt(btn.dataset.yearOffset ?? '0', 10);
        if (offset === this.tradeMarketYear) return;
        this.tradeMarketYear = offset;
        try { localStorage.setItem('wbl-tp-marketYear', String(offset)); } catch { /* ignore */ }
        // Rebuild profiles at the new year offset and re-render
        this.cachedTradeProfiles = this.buildAllTeamProfiles();
        this.renderTradeMarket();
      });
    });

    // Bind need rows to navigate to grid cell
    container.querySelectorAll<HTMLElement>('.summary-link').forEach(el => {
      el.addEventListener('click', () => {
        const pos = el.dataset.targetPos;
        const yr = el.dataset.targetYear ? parseInt(el.dataset.targetYear, 10) : null;
        if (pos && yr) this.navigateToGridCell(pos, yr);
      });
    });

    // Bind profile clicks in market container
    container.querySelectorAll<HTMLElement>('.cell-name-link').forEach(nameEl => {
      nameEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const playerId = nameEl.dataset.profileId ? parseInt(nameEl.dataset.profileId, 10) : null;
        if (playerId) this.openPlayerProfile(playerId);
      });
    });
  }

  private renderTradeTargetCard(target: TradeTarget): string {
    const twoWayClass = target.complementary ? ' market-two-way' : '';
    const matchBadge = target.complementary && target.matchDetails.length > 0
      ? `<span class="market-match-badge" title="${target.matchDetails.map(d => `${d.positionLabel} ${this.abbreviateName(d.name)} (${d.rating.toFixed(1)})`).join(', ')}">2-Way: send ${this.abbreviateName(target.matchDetails[0].name)} (${target.matchDetails[0].rating.toFixed(1)})</span>`
      : '';

    if (target.isProspect) {
      const p = target.player as SurplusProspect;
      return `
        <div class="market-player-card market-prospect-card${twoWayClass}">
          <span class="market-pos-badge">${p.positionLabel}</span>
          <span class="cell-name-link" data-profile-id="${p.playerId}" title="ID: ${p.playerId}">${this.abbreviateName(p.name)}</span>
          <span class="badge ${this.getRatingClass(p.tfr)} cell-rating">${p.tfr.toFixed(1)} TFR</span>
          <span class="market-org-label">${p.orgName}</span>
          <span class="market-detail">${p.level}, Age ${p.age}</span>
          ${matchBadge}
        </div>`;
    } else {
      const p = target.player as SurplusMlbPlayer;
      return `
        <div class="market-player-card market-mlb-card${twoWayClass}">
          <span class="market-pos-badge">${p.positionLabel}</span>
          <span class="cell-name-link" data-profile-id="${p.playerId}" title="ID: ${p.playerId}">${this.abbreviateName(p.name)}</span>
          <span class="badge ${this.getRatingClass(p.trueRating)} cell-rating">${p.trueRating.toFixed(1)} TR</span>
          <span class="market-org-label">${p.orgName}</span>
          <span class="market-detail">Age ${p.age}, ${p.contractYearsRemaining}yr left</span>
          ${matchBadge}
        </div>`;
    }
  }

  // =====================================================================
  // Utilities
  // =====================================================================

  private formatSalary(salary: number): string {
    if (salary >= 1_000_000) {
      const millions = salary / 1_000_000;
      return millions % 1 === 0 ? `$${millions}M` : `$${millions.toFixed(1)}M`;
    }
    return `$${Math.round(salary / 1000)}K`;
  }

  private abbreviateName(fullName: string): string {
    if (!fullName) return '';
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0][0]}. ${parts[parts.length - 1]}`;
  }

  /** Get the player's best known rating from all loaded Team Planning sources. */
  private resolveBestKnownRating(playerId: number, year?: number): number {
    let rating = 0;

    rating = Math.max(rating, this.playerRatingMap.get(playerId) ?? 0);
    rating = Math.max(rating, this.prospectCurrentRatingMap.get(playerId) ?? 0);
    rating = Math.max(rating, this.playerTfrMap.get(playerId) ?? 0);
    rating = Math.max(rating, this.canonicalPitcherTrMap.get(playerId) ?? 0);
    rating = Math.max(rating, this.canonicalBatterTrMap.get(playerId) ?? 0);

    if (year !== undefined) {
      rating = Math.max(rating, this.getGridRatingForPlayerYear(playerId, year));
    }

    return rating;
  }

  /**
   * Get a player's current ability rating WITHOUT TFR — for use as a projection base.
   * For prospects, uses the development-curve estimate. For MLB vets, uses canonical TR.
   */
  private resolveCurrentRatingForProjection(playerId: number): number {
    // Development-curve estimate for prospects
    let rating = this.prospectCurrentRatingMap.get(playerId) ?? 0;
    // Canonical MLB TR (proven stats-based ability)
    rating = Math.max(rating, this.canonicalPitcherTrMap.get(playerId) ?? 0);
    rating = Math.max(rating, this.canonicalBatterTrMap.get(playerId) ?? 0);
    // Fallback for MLB vets not in prospect/canonical maps (pure power-ranking data).
    // playerRatingMap has TFR mixed in for prospects, but if we reach here with 0,
    // the player isn't a prospect — so playerRatingMap is safe.
    if (rating === 0) {
      rating = this.playerRatingMap.get(playerId) ?? 0;
    }
    return rating;
  }

  /** Find the highest rating this player currently has in the planning grid for a given year. */
  private getGridRatingForPlayerYear(playerId: number, year: number): number {
    let best = 0;
    for (const row of this.gridRows) {
      const cell = row.cells.get(year);
      if (cell?.playerId === playerId) {
        best = Math.max(best, cell.rating);
      }
    }
    return best;
  }

  /**
   * Project a star rating for a future year, applying growth toward peak and aging decline after.
   */
  private projectPlanningRating(
    currentRating: number,
    peakRating: number,
    currentAge: number,
    yearOffset: number,
    peakAge: number = 27,
  ): number {
    let rating = currentRating;

    // Growth phase: linear interpolation toward peakRating
    if (currentAge < peakAge && peakRating > currentRating) {
      const yearsToGo = peakAge - currentAge;
      const fraction = Math.min(yearOffset / yearsToGo, 1.0);
      rating = currentRating + (peakRating - currentRating) * fraction;
    } else {
      // Already at or past peak — start from peakRating (or currentRating if no upside)
      rating = Math.max(currentRating, peakRating);
    }

    // Decline phase: for each projected year, apply decline based on age at start of transition
    for (let yr = 1; yr <= yearOffset; yr++) {
      const ageAtStart = currentAge + yr - 1;
      if (ageAtStart <= 29) continue; // peak plateau
      if (ageAtStart <= 32) rating -= 0.05;
      else if (ageAtStart <= 35) rating -= 0.10;
      else if (ageAtStart <= 38) rating -= 0.20;
      else rating -= 0.30;
    }

    return Math.max(0.5, Math.round(rating * 2) / 2);
  }

  /**
   * Estimate a prospect's current star rating from their developmentTR component ratings.
   */
  private computeProspectCurrentRating(prospect: RatedHitterProspect | RatedProspect): number {
    const tfr = prospect.trueFutureRating;
    const peakAge = 27;

    if ('scoutingRatings' in prospect && 'power' in (prospect as RatedHitterProspect).scoutingRatings) {
      // Hitter prospect
      const hp = prospect as RatedHitterProspect;
      if (hp.developmentTR && hp.trueRatings) {
        const components: { dev: number; peak: number }[] = [
          { dev: hp.developmentTR.eye, peak: hp.trueRatings.eye },
          { dev: hp.developmentTR.avoidK, peak: hp.trueRatings.avoidK },
          { dev: hp.developmentTR.power, peak: hp.trueRatings.power },
          { dev: hp.developmentTR.contact, peak: hp.trueRatings.contact },
          { dev: hp.developmentTR.gap, peak: hp.trueRatings.gap },
          { dev: hp.developmentTR.speed, peak: hp.trueRatings.speed },
        ];
        let totalFraction = 0;
        let count = 0;
        for (const c of components) {
          const range = Math.max(1, c.peak - 20);
          totalFraction += (c.dev - 20) / range;
          count++;
        }
        const avgFraction = Math.min(1, Math.max(0, totalFraction / count));
        const estimated = 0.5 + (tfr - 0.5) * avgFraction;
        return Math.max(0.5, Math.min(tfr, Math.round(estimated * 2) / 2));
      }
    } else {
      // Pitcher prospect
      const pp = prospect as RatedProspect;
      if (pp.developmentTR && pp.trueRatings) {
        const components: { dev: number; peak: number }[] = [
          { dev: pp.developmentTR.stuff, peak: pp.trueRatings.stuff },
          { dev: pp.developmentTR.control, peak: pp.trueRatings.control },
          { dev: pp.developmentTR.hra, peak: pp.trueRatings.hra },
        ];
        let totalFraction = 0;
        let count = 0;
        for (const c of components) {
          const range = Math.max(1, c.peak - 20);
          totalFraction += (c.dev - 20) / range;
          count++;
        }
        const avgFraction = Math.min(1, Math.max(0, totalFraction / count));
        const estimated = 0.5 + (tfr - 0.5) * avgFraction;
        return Math.max(0.5, Math.min(tfr, Math.round(estimated * 2) / 2));
      }
    }

    // Fallback: age-based fraction
    const ageFraction = Math.min(1, Math.max(0, (prospect.age - 18) / (peakAge - 18)));
    const estimated = 0.5 + (tfr - 0.5) * ageFraction;
    return Math.max(0.5, Math.min(tfr, Math.round(estimated * 2) / 2));
  }

  private getRatingClass(rating: number): string {
    if (rating >= 4.5) return 'rating-elite';
    if (rating >= 4.0) return 'rating-plus';
    if (rating >= 3.0) return 'rating-avg';
    if (rating >= 2.0) return 'rating-fringe';
    return 'rating-poor';
  }

  /** Compute average star rating per section per year from grid data. */
  private computeSectionRatings(): Map<string, Map<number, number>> {
    const yearRange = this.getYearRange();
    const result = new Map<string, Map<number, number>>();

    for (const section of ['lineup', 'rotation', 'bullpen']) {
      const sectionRows = this.gridRows.filter(r => r.section === section);
      const yearRatings = new Map<number, number>();

      for (const year of yearRange) {
        let total = 0;
        let count = 0;
        for (const row of sectionRows) {
          const cell = row.cells.get(year);
          if (cell && cell.playerId) {
            total += cell.rating;
            count++;
          }
        }
        yearRatings.set(year, count > 0 ? total / count : 0);
      }

      result.set(section, yearRatings);
    }

    return result;
  }

  /** Render the section header row with per-year average ratings. */
  private renderSectionHeaderRow(
    sectionName: string,
    yearRange: number[],
    sectionRatings: Map<string, Map<number, number>>,
  ): string {
    const isCollapsed = this.collapsedSections.has(sectionName);
    const chevron = isCollapsed ? '▸' : '▾';
    const sectionLabel = sectionName.toUpperCase();
    const ratings = sectionRatings.get(sectionName);

    const ratingCells = yearRange.map(year => {
      const avg = ratings?.get(year) ?? 0;
      if (avg === 0) return `<td class="grid-section-rating-cell"></td>`;
      const cls = this.getRatingClass(avg);
      return `<td class="grid-section-rating-cell"><span class="section-rating-badge ${cls}">${avg.toFixed(1)}</span></td>`;
    }).join('');

    return `
      <tr class="grid-section-row" data-section="${sectionName}">
        <td class="grid-section-header grid-section-toggle">${'<span class="section-chevron">' + chevron + '</span> ' + sectionLabel}</td>
        ${ratingCells}
      </tr>
    `;
  }

  /** Render the overall team rating row using 40/40/20 weighting. */
  private renderTeamRatingRow(
    yearRange: number[],
    sectionRatings: Map<string, Map<number, number>>,
  ): string {
    const lineupRatings = sectionRatings.get('lineup');
    const rotationRatings = sectionRatings.get('rotation');
    const bullpenRatings = sectionRatings.get('bullpen');

    const cells = yearRange.map(year => {
      const lineup = lineupRatings?.get(year) ?? 0;
      const rotation = rotationRatings?.get(year) ?? 0;
      const bullpen = bullpenRatings?.get(year) ?? 0;
      if (lineup === 0 && rotation === 0 && bullpen === 0) {
        return `<td class="grid-section-rating-cell"></td>`;
      }
      const team = (rotation * 0.40) + (lineup * 0.40) + (bullpen * 0.20);
      const cls = this.getRatingClass(team);
      return `<td class="grid-section-rating-cell"><span class="section-rating-badge ${cls}">${team.toFixed(1)}</span></td>`;
    }).join('');

    return `
      <tr class="grid-team-rating-row">
        <td class="grid-section-header">TEAM</td>
        ${cells}
      </tr>
    `;
  }
}
