import { teamService } from '../services/TeamService';
import { dateService } from '../services/DateService';
import { playerService } from '../services/PlayerService';
import { contractService, Contract } from '../services/ContractService';
import { trueRatingsService, LEAGUE_START_YEAR } from '../services/TrueRatingsService';
import { teamRatingsService, TeamPowerRanking, RatedPitcher, RatedHitterProspect, RatedProspect } from '../services/TeamRatingsService';
import { draftValueService, RosterGap, DraftRecommendation } from '../services/DraftValueService';
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
}

// --- Constants ---

const LINEUP_POSITIONS = ['C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF', 'DH'];
const ROTATION_POSITIONS = ['SP1', 'SP2', 'SP3', 'SP4', 'SP5'];
const BULLPEN_POSITIONS = ['CL', 'SU1', 'SU2', 'MR1', 'MR2', 'MR3', 'MR4', 'MR5'];

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
  private viewMode: 'grid' | 'analysis' = 'grid';
  private collapsedSections: Set<string> = new Set();

  private allTeams: Team[] = [];
  private teamLookup: Map<number, Team> = new Map();
  private selectedTeamId: number | null = null;
  private gameYear: number = 2021;
  private gridRows: GridRow[] = [];
  private playerMap: Map<number, Player> = new Map();
  private contractMap: Map<number, Contract> = new Map();
  private overrides: Map<string, TeamPlanningOverrideRecord> = new Map();
  private playerRatingMap: Map<number, number> = new Map();
  private playerTfrMap: Map<number, number> = new Map();
  private prospectCurrentRatingMap: Map<number, number> = new Map();
  private playerAgeMap: Map<number, number> = new Map();
  private playerServiceYearsMap: Map<number, number> = new Map();

  // Cached data for profile modals
  private cachedRanking: TeamPowerRanking | null = null;
  private cachedOrgHitters: RatedHitterProspect[] = [];
  private cachedOrgPitchers: RatedProspect[] = [];

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
          <h2 class="view-title">Team Planning</h2>
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
              <button class="toggle-btn active" data-view="grid">Planning Grid</button>
              <button class="toggle-btn" data-view="analysis">Org Analysis</button>
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
        const mode = btn.dataset.view as 'grid' | 'analysis';
        if (!mode || mode === this.viewMode) return;
        this.viewMode = mode;
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
    const draftContainer = this.container.querySelector<HTMLElement>('#tp-draft-container');

    if (this.viewMode === 'grid') {
      if (gridWrapper) gridWrapper.style.display = '';
      if (toolbar) toolbar.style.display = '';
      if (summaryContainer) summaryContainer.style.display = 'none';
      if (draftContainer) draftContainer.style.display = 'none';
    } else {
      if (gridWrapper) gridWrapper.style.display = 'none';
      if (toolbar) toolbar.style.display = 'none';
      if (summaryContainer) summaryContainer.style.display = '';
      if (draftContainer) draftContainer.style.display = '';
    }
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

        const display = this.container.querySelector('#tp-team-display');
        if (display) display.textContent = el.textContent || '';

        menu.querySelectorAll('.filter-dropdown-item').forEach(i => i.classList.remove('selected'));
        el.classList.add('selected');

        el.closest('.filter-dropdown')?.classList.remove('open');

        // Load overrides from DB when team changes
        this.loadOverrides().then(() => this.buildAndRenderGrid());
      });
    });
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
      this.cachedOrgHitters = allOrgHitters;
      this.cachedOrgPitchers = orgPitchers;

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

      // Build prospect current rating map
      this.prospectCurrentRatingMap.clear();
      for (const h of farmHitters) {
        this.prospectCurrentRatingMap.set(h.playerId, this.computeProspectCurrentRating(h));
      }
      for (const p of orgPitchers) {
        this.prospectCurrentRatingMap.set(p.playerId, this.computeProspectCurrentRating(p));
      }

      // Build player age map for buildRow projections
      this.playerAgeMap.clear();
      for (const h of allOrgHitters) this.playerAgeMap.set(h.playerId, h.age);
      for (const p of orgPitchers) this.playerAgeMap.set(p.playerId, p.age);

      this.gridRows = this.buildGridData(teamRanking);

      // Build player rating map before fillProspects — map has TR for MLB-only players,
      // max(TR, TFR) for players in the unified hitter pool.
      // fillProspects uses this to avoid replacing young MLB players whose TFR exceeds their TR.
      this.buildPlayerRatingMap(teamRanking, allOrgHitters, orgPitchers);

      this.fillProspects(farmHitters, orgPitchers);

      // Apply user overrides (in-memory map, loaded on team change)
      this.applyOverrides();

      // Phase 3: Indicators
      this.computeIndicators();

      // Phase 4: Financials
      const financials = this.computeFinancials();

      // Render grid with indicators + salary rows
      this.renderGrid(financials);

      // Phase 3: Summary section
      const assessments = this.assessPositions();
      this.renderSummarySection(assessments);

      // Phase 2.5: Draft reference section
      const gaps = this.analyzePositionGaps();
      const recommendations = draftValueService.analyzeDraftNeeds(gaps, this.gameYear);
      this.renderDraftReferenceSection(recommendations, gaps);

      // Re-apply view mode after summary/draft sections are populated
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

    const positionSlots = [
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

    const lineupRowMap = new Map<string, GridRow>();
    for (const row of this.gridRows) {
      if (row.section === 'lineup') lineupRowMap.set(row.position, row);
    }

    // Start at yi=1: year 0 is the actual current roster, prospect optimization starts from year 1
    for (let yi = 1; yi < yearRange.length; yi++) {
      const year = yearRange[yi];

      // Identify positions open for prospect placement:
      // empty, already a prospect, min contract, or arb-eligible (team control, replaceable)
      const openPositions: string[] = [];
      for (const [posLabel, row] of lineupRowMap) {
        const cell = row.cells.get(year);
        if (!cell || cell.contractStatus === 'empty' || cell.isProspect
          || cell.isMinContract || cell.contractStatus === 'arb-eligible') {
          openPositions.push(posLabel);
        }
      }
      if (openPositions.length === 0) continue;

      const available = sortedHitters.filter(h =>
        hitterETA.get(h.playerId)! <= yi && h.age + yi >= MIN_PROSPECT_GRID_AGE
      );
      if (available.length === 0) continue;

      const slotsToFill = positionSlots.filter(s => openPositions.includes(s.label));

      // Greedy assignment: place each prospect where it provides the biggest upgrade
      const usedThisYear = new Set<number>();
      const filledSlots = new Set<string>();

      // Build all (prospect, slot, improvement) candidates
      type Candidate = { prospect: RatedHitterProspect; slot: typeof positionSlots[0]; projected: number; improvement: number };
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

      // Helper: check if a pitcher cell is open for prospect replacement
      const isPitcherCellOpen = (cell: GridCell | undefined): boolean => {
        if (!cell || cell.contractStatus === 'empty') return true;
        return cell.isProspect || cell.isMinContract || cell.contractStatus === 'arb-eligible';
      };

      // Rotation: greedy by improvement across all SP slots
      const rotationCandidates: { row: GridRow; prospect: RatedProspect; projected: number; improvement: number }[] = [];
      for (const row of this.gridRows) {
        if (row.section !== 'rotation') continue;
        const cell = row.cells.get(year);
        if (!isPitcherCellOpen(cell)) continue;
        const incumbentRating = cell?.rating ?? 0;

        for (const p of spProspects) {
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
        const projectedRating = this.projectPlanningRating(rating, peakRating, baseAge, yearOffset);

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
    const positionSlots: Record<string, number[]> = {
      'C': [2], '1B': [3, 6], '2B': [4, 6], 'SS': [6], '3B': [5, 6],
      'LF': [7, 8, 9], 'CF': [8], 'RF': [9, 7, 8], 'DH': [2, 3, 4, 5, 6, 7, 8, 9, 10],
    };
    const eligible = positionSlots[row.position];
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

    let bodyHtml = '';
    for (let si = 0; si < sections.length; si++) {
      const section = sections[si];
      const isCollapsed = this.collapsedSections.has(section.name);
      const sectionLabel = section.name.toUpperCase();
      const chevron = isCollapsed ? '▸' : '▾';

      bodyHtml += `
        <tr class="grid-section-row" data-section="${section.name}">
          <td class="grid-section-header grid-section-toggle" colspan="${yearRange.length + 1}">
            <span class="section-chevron">${chevron}</span> ${sectionLabel}
          </td>
        </tr>
      `;

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

      // Grand total after last section
      if (si === sections.length - 1) {
        bodyHtml += this.renderGrandTotalRow(yearRange, financials);
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
      <div id="tp-draft-container"></div>
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

    let bodyHtml = '';
    for (let si = 0; si < sections.length; si++) {
      const section = sections[si];
      const isCollapsed = this.collapsedSections.has(section.name);
      const sectionLabel = section.name.toUpperCase();
      const chevron = isCollapsed ? '▸' : '▾';

      bodyHtml += `
        <tr class="grid-section-row" data-section="${section.name}">
          <td class="grid-section-header grid-section-toggle" colspan="${yearRange.length + 1}">
            <span class="section-chevron">${chevron}</span> ${sectionLabel}
          </td>
        </tr>
      `;

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

      return `
        <td class="grid-cell cell-minor-league${overrideClass}" ${dataAttrs}>
          <div class="cell-name${nameClickable}"${nameDataAttr}>${abbrevName}</div>
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

    return `
      <td class="grid-cell ${statusClass}${overrideClass}" ${dataAttrs}>
        <div class="cell-name${nameClickable}"${nameDataAttr}>${abbrevName}</div>
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

  private assessPositions(): PositionAssessment[] {
    const yearRange = this.getYearRange();
    const assessments: PositionAssessment[] = [];

    for (const row of this.gridRows) {
      let emptyYears = 0;
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

      // Check extension candidate: current cell is non-prospect non-min, next year is final-year, rating >= 3.0, age <= 31
      const currentCell = row.cells.get(yearRange[0]);
      const nextCell = yearRange.length > 1 ? row.cells.get(yearRange[1]) : undefined;
      if (currentCell && !currentCell.isProspect && !currentCell.isMinContract
        && currentCell.contractStatus === 'under-contract'
        && nextCell?.contractStatus === 'final-year'
        && currentCell.rating >= 3.0 && currentCell.age <= 31) {
        isExtCandidate = true;
      }

      // Strength: 5+ years filled with high rating — include position label
      if (highRatingYears >= 5) {
        assessments.push({
          position: row.position,
          section: row.section,
          category: 'strength',
          detail: `${row.position} — ${currentPlayer ? this.abbreviateName(currentPlayer) : '?'}: ${highRatingYears} years of 3.5+ coverage`,
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
          assessments.push({
            position: row.position,
            section: row.section,
            category: 'need',
            detail: `${row.position} — ${this.abbreviateName(name)} at ${info.rating.toFixed(1)} (${info.years.join(', ')})`,
          });
        }
      }
      if (emptyYears > 0) {
        assessments.push({
          position: row.position,
          section: row.section,
          category: 'need',
          detail: `${row.position} — ${emptyYears} empty year${emptyYears !== 1 ? 's' : ''}`,
        });
      }

      // Extension priority
      if (isExtCandidate) {
        assessments.push({
          position: row.position,
          section: row.section,
          category: 'extension',
          detail: `${this.abbreviateName(currentPlayer)}: age ${currentAge}, ${currentRating.toFixed(1)} rating, penultimate year`,
        });
      }
    }

    return assessments;
  }

  private renderSummarySection(assessments: PositionAssessment[]): void {
    const container = this.container.querySelector<HTMLElement>('#tp-summary-container');
    if (!container) return;

    const strengths = assessments.filter(a => a.category === 'strength');
    const needs = assessments.filter(a => a.category === 'need');
    const extensions = assessments.filter(a => a.category === 'extension');

    const renderList = (items: PositionAssessment[], emptyMsg: string) => {
      if (items.length === 0) return `<p class="summary-empty">${emptyMsg}</p>`;
      return '<ul class="summary-list">' + items.map(i =>
        `<li>${i.detail}</li>`
      ).join('') + '</ul>';
    };

    container.innerHTML = `
      <div class="planning-summary-section">
        <div class="planning-summary-card summary-card-strength">
          <div class="summary-card-header summary-header-strength">Positions of Strength</div>
          ${renderList(strengths, 'No long-term strengths identified.')}
        </div>
        <div class="planning-summary-card summary-card-need">
          <div class="summary-card-header summary-header-need">Positions of Need</div>
          ${renderList(needs, 'No significant gaps identified.')}
        </div>
        <div class="planning-summary-card summary-card-extension">
          <div class="summary-card-header summary-header-extension">Extension Priorities</div>
          ${renderList(extensions, 'No extension candidates.')}
        </div>
      </div>
    `;
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

  private renderDraftReferenceSection(_recommendations: DraftRecommendation[], gaps: RosterGap[]): void {
    const container = this.container.querySelector<HTMLElement>('#tp-draft-container');
    if (!container) return;

    if (gaps.length === 0) {
      container.innerHTML = `
        <div class="draft-reference-section">
          <div class="draft-section-header">DRAFT STRATEGY</div>
          <p class="summary-empty">No significant roster gaps identified.</p>
        </div>
      `;
      return;
    }

    // Sort by urgency: soonest gap first, then most gap years
    const sorted = [...gaps].sort((a, b) => {
      const yearDiff = a.gapStartYear - b.gapStartYear;
      if (yearDiff !== 0) return yearDiff;
      return b.emptyYears - a.emptyYears;
    });

    const cards = sorted.map(gap => {
      const yearsUntilGap = gap.gapStartYear - this.gameYear;
      let suggestion: string;

      if (yearsUntilGap <= 1) {
        suggestion = `${gap.position} needed now, lean college player or trade target`;
      } else if (yearsUntilGap <= 3) {
        suggestion = `${gap.position} needed, lean college player for gap in ${yearsUntilGap} year${yearsUntilGap !== 1 ? 's' : ''}`;
      } else {
        suggestion = `No long term ${gap.position} depth in the majors, draft now`;
      }

      return `
        <div class="draft-gap-card">
          <div class="draft-gap-recommendation">${suggestion}</div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="draft-reference-section">
        <div class="draft-section-header">DRAFT STRATEGY</div>
        ${cards}
      </div>
    `;
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
    // Unified hitter pool: store max(TR, TFR) for edit modal sorting
    for (const h of orgHitters) {
      const existing = this.playerRatingMap.get(h.playerId) ?? 0;
      this.playerRatingMap.set(h.playerId, Math.max(existing, h.trueFutureRating));
    }
    // Pitcher prospects (TFR)
    for (const p of orgPitchers) this.playerRatingMap.set(p.playerId, p.trueFutureRating);
  }

  private async loadOverrides(): Promise<void> {
    if (!this.selectedTeamId) return;
    const records = await indexedDBService.getTeamPlanningOverrides(this.selectedTeamId);
    this.overrides.clear();
    for (const rec of records) {
      this.overrides.set(rec.key, rec);
    }
  }

  private applyOverrides(): void {
    for (const [, override] of this.overrides) {
      const row = this.gridRows.find(r => r.position === override.position);
      if (!row) continue;

      row.cells.set(override.year, {
        playerId: override.playerId,
        playerName: override.playerName,
        age: override.age,
        rating: override.rating,
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
    // Check farm data first (prospect)
    const prospect = this.cachedOrgPitchers.find(p => p.playerId === playerId);
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
        estimatedStuff: prospect.developmentTR?.stuff,
        estimatedControl: prospect.developmentTR?.control,
        estimatedHra: prospect.developmentTR?.hra,
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

    // MLB pitcher from rankings (or external player with basic info)
    const ranking = this.cachedRanking;
    const ratedPitcher = ranking
      ? [...ranking.rotation, ...ranking.bullpen].find(p => p.playerId === playerId)
      : undefined;
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
    // Check farm data first (prospect)
    const prospect = this.cachedOrgHitters.find(p => p.playerId === playerId);
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
        estimatedPower: prospect.developmentTR?.power,
        estimatedEye: prospect.developmentTR?.eye,
        estimatedAvoidK: prospect.developmentTR?.avoidK,
        estimatedContact: prospect.developmentTR?.contact,
        estimatedGap: prospect.developmentTR?.gap,
        estimatedSpeed: prospect.developmentTR?.speed,
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

    // MLB batter from rankings (or external player with basic info)
    const ranking = this.cachedRanking;
    const ratedBatter = ranking
      ? [...ranking.lineup, ...ranking.bench].find(b => b.playerId === playerId)
      : undefined;
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
      pa: ratedBatter?.stats?.pa,
      avg: ratedBatter?.stats?.avg,
      obp: ratedBatter?.stats?.obp,
      slg: ratedBatter?.stats?.slg,
      hr: ratedBatter?.stats?.hr,
      war: ratedBatter?.stats?.war,
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

    const context: CellEditContext = {
      position,
      year,
      section: row.section,
      currentCell: currentCellData,
      incumbentCell,
      teamId: this.selectedTeamId,
      gameYear: this.gameYear,
    };

    // Build org player list sorted by TFR/TR (highest first)
    const orgPlayers = Array.from(this.playerMap.values())
      .filter(p => p.parentTeamId === this.selectedTeamId || p.teamId === this.selectedTeamId)
      .sort((a, b) => (this.playerRatingMap.get(b.id) ?? 0) - (this.playerRatingMap.get(a.id) ?? 0));
    const allPlayers = Array.from(this.playerMap.values()).filter(p => !p.retired);

    const result = await this.cellEditModal.show(context, orgPlayers, allPlayers, this.contractMap, this.playerRatingMap);
    await this.processEditResult(result, position, year);
  }

  private async processEditResult(result: CellEditResult, position: string, year: number): Promise<void> {
    if (!this.selectedTeamId) return;

    if (result.action === 'cancel') return;

    if (result.action === 'clear') {
      const key = `${this.selectedTeamId}_${position}_${year}`;
      await indexedDBService.deleteTeamPlanningOverride(key);
      this.overrides.delete(key);
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
      const contract = this.contractMap.get(player.id);
      const isMinorLeaguer = player.level !== undefined && player.level > 1;

      // Look up actual rating from playerRatingMap (TR for MLB, TFR for prospects)
      const playerRating = this.playerRatingMap.get(player.id) ?? 0;

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
        const targetYear = yearRange[startIndex + i];
        const yearOffset = targetYear - this.gameYear;
        const key = `${this.selectedTeamId}_${position}_${targetYear}`;

        // Compute salary: use contract salary if available, otherwise estimate from team control
        let cellSalary: number;
        if (contract && !isMinorLeaguer) {
          const contractYearsRemaining = contractService.getYearsRemaining(contract);
          if (i < contractYearsRemaining) {
            cellSalary = contractService.getSalaryForYear(contract, i);
          } else {
            // Beyond contract — arb/team control estimate
            const serviceYear = serviceYearStart + i;
            cellSalary = estimateTeamControlSalary(serviceYear, playerRating);
          }
        } else {
          // Minor leaguer or no contract — full team control estimate
          const serviceYear = i + 1;
          cellSalary = estimateTeamControlSalary(serviceYear, playerRating);
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
          rating: playerRating,
          salary: cellSalary,
          contractStatus: isLastYear ? 'final-year' : 'under-contract',
          isProspect: isMinorLeaguer,
          sourceType: result.sourceType!,
          createdAt: Date.now(),
        };
        records.push(record);
        this.overrides.set(key, record);
      }

      await indexedDBService.saveTeamPlanningOverrides(records);
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
}
