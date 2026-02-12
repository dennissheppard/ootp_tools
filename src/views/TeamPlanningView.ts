import { teamService } from '../services/TeamService';
import { dateService } from '../services/DateService';
import { playerService } from '../services/PlayerService';
import { contractService, Contract } from '../services/ContractService';
import { teamRatingsService, TeamPowerRanking, RatedPitcher, RatedHitterProspect, RatedProspect } from '../services/TeamRatingsService';
import { draftValueService, RosterGap, DraftRecommendation } from '../services/DraftValueService';
import { pitcherProfileModal } from './PitcherProfileModal';
import { BatterProfileModal } from './BatterProfileModal';
import { Team } from '../models/Team';
import { Player } from '../models/Player';

// --- Types ---

type IndicatorType = 'CLIFF' | 'EXT' | 'FA' | 'TR' | 'EXPENSIVE';

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

const MIN_SALARY_THRESHOLD = 300_000;
const TEAM_CONTROL_YEARS = 6;
const TYPICAL_DEBUT_AGE = 23;
const PROSPECT_SALARY = 300_000; // league minimum for financial calcs

export class TeamPlanningView {
  private container: HTMLElement;
  private batterProfileModal: BatterProfileModal;
  private hasLoadedData = false;

  private allTeams: Team[] = [];
  private teamLookup: Map<number, Team> = new Map();
  private selectedTeamId: number | null = null;
  private gameYear: number = 2021;
  private gridRows: GridRow[] = [];
  private playerMap: Map<number, Player> = new Map();
  private contractMap: Map<number, Contract> = new Map();

  constructor(container: HTMLElement) {
    this.container = container;
    this.batterProfileModal = new BatterProfileModal();
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
      <div class="team-planning-view">
        <div class="view-title-row">
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
            </div>
          </div>
        </div>
        <div id="team-planning-grid-container" class="team-planning-grid-container">
          <p class="empty-text">Select a team to view roster planning grid.</p>
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
        gridContainer.innerHTML = '<p class="empty-text">Select a team to view roster planning grid.</p>';
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

        this.buildAndRenderGrid();
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
      const [rankings, hitterFarmData, pitcherFarmData] = await Promise.all([
        teamRatingsService.getPowerRankings(this.gameYear),
        teamRatingsService.getHitterFarmData(this.gameYear),
        teamRatingsService.getFarmData(this.gameYear),
      ]);

      const teamRanking = rankings.find(r => r.teamId === this.selectedTeamId);

      if (!teamRanking) {
        if (gridContainer) {
          gridContainer.innerHTML = '<p class="empty-text">No roster data found for this team.</p>';
        }
        return;
      }

      const orgHitters = hitterFarmData.prospects.filter(p => p.orgId === this.selectedTeamId);
      const orgPitchers = pitcherFarmData.prospects.filter(p => p.orgId === this.selectedTeamId);

      this.gridRows = this.buildGridData(teamRanking);
      this.fillProspects(orgHitters, orgPitchers);

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

    } catch (err) {
      console.error('Failed to build grid:', err);
      if (gridContainer) {
        gridContainer.innerHTML = '<p class="empty-text">Failed to load roster data.</p>';
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

    for (let yi = 0; yi < yearRange.length; yi++) {
      const year = yearRange[yi];

      const openPositions: string[] = [];
      for (const [posLabel, row] of lineupRowMap) {
        const cell = row.cells.get(year);
        if (cell && (cell.contractStatus === 'empty' || cell.isProspect || cell.isMinContract)) {
          openPositions.push(posLabel);
        }
      }
      if (openPositions.length === 0) continue;

      const available = sortedHitters.filter(h => hitterETA.get(h.playerId)! <= yi);
      if (available.length === 0) continue;

      const slotsToFill = positionSlots.filter(s => openPositions.includes(s.label));
      const usedThisYear = new Set<number>();
      const assignments: { posLabel: string; prospect: RatedHitterProspect }[] = [];

      const remainingSlots = [...slotsToFill];
      while (remainingSlots.length > 0) {
        const slotScarcity = remainingSlots.map(slot => {
          const eligible = available.filter(h =>
            !usedThisYear.has(h.playerId) && slot.canPlay.includes(h.position)
          ).length;
          return { slot, eligible };
        });
        slotScarcity.sort((a, b) => a.eligible - b.eligible);

        const { slot } = slotScarcity[0];

        for (const h of available) {
          if (usedThisYear.has(h.playerId)) continue;
          if (slot.canPlay.includes(h.position)) {
            assignments.push({ posLabel: slot.label, prospect: h });
            usedThisYear.add(h.playerId);
            break;
          }
        }

        remainingSlots.splice(remainingSlots.findIndex(s => s.label === slot.label), 1);
      }

      for (const { posLabel, prospect } of assignments) {
        const row = lineupRowMap.get(posLabel)!;
        const current = row.cells.get(year);
        if (current && current.contractStatus !== 'empty' && (current.isProspect || current.isMinContract) && current.rating >= prospect.trueFutureRating) {
          continue;
        }
        row.cells.set(year, {
          playerId: prospect.playerId,
          playerName: prospect.name,
          age: prospect.age + yi,
          rating: prospect.trueFutureRating,
          salary: 0,
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

    for (let yi = 0; yi < yearRange.length; yi++) {
      const year = yearRange[yi];
      const usedThisYear = new Set<number>();

      for (const row of this.gridRows) {
        if (row.section !== 'rotation') continue;
        const cell = row.cells.get(year);
        if (!cell || (cell.contractStatus !== 'empty' && !cell.isProspect && !cell.isMinContract)) continue;

        const best = this.findBestPitcher(spProspects, usedThisYear, pitcherETA, yi);
        if (!best) continue;

        if ((cell.isProspect || cell.isMinContract) && cell.rating >= best.trueFutureRating) continue;

        usedThisYear.add(best.playerId);
        row.cells.set(year, {
          playerId: best.playerId,
          playerName: best.name,
          age: best.age + yi,
          rating: best.trueFutureRating,
          salary: 0,
          contractStatus: 'prospect',
          level: best.level,
          isProspect: true,
        });
      }

      for (const row of this.gridRows) {
        if (row.section !== 'bullpen') continue;
        const cell = row.cells.get(year);
        if (!cell || (cell.contractStatus !== 'empty' && !cell.isProspect && !cell.isMinContract)) continue;

        const best = this.findBestPitcher(rpProspects, usedThisYear, pitcherETA, yi)
          ?? this.findBestPitcher(spProspects, usedThisYear, pitcherETA, yi);
        if (!best) continue;

        if ((cell.isProspect || cell.isMinContract) && cell.rating >= best.trueFutureRating) continue;

        usedThisYear.add(best.playerId);
        row.cells.set(year, {
          playerId: best.playerId,
          playerName: best.name,
          age: best.age + yi,
          rating: best.trueFutureRating,
          salary: 0,
          contractStatus: 'prospect',
          level: best.level,
          isProspect: true,
        });
      }
    }
  }

  private findBestPitcher(
    prospects: RatedProspect[],
    usedThisYear: Set<number>,
    etaMap: Map<number, number>,
    yearOffset: number,
  ): RatedProspect | null {
    for (const p of prospects) {
      if (usedThisYear.has(p.playerId)) continue;
      if (etaMap.get(p.playerId)! <= yearOffset) return p;
    }
    return null;
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

      let effectiveYearsRemaining = contractYearsRemaining;
      if (isMinDeal && baseAge > 0) {
        const estimatedServiceYears = Math.max(0, baseAge - TYPICAL_DEBUT_AGE);
        const teamControlLeft = Math.max(1, TEAM_CONTROL_YEARS - estimatedServiceYears);
        effectiveYearsRemaining = Math.max(contractYearsRemaining, teamControlLeft);
      }

      if (yearOffset < effectiveYearsRemaining) {
        const isLastYear = yearOffset === effectiveYearsRemaining - 1;
        const salary = yearOffset < contractYearsRemaining
          ? contractService.getSalaryForYear(contract, yearOffset)
          : currentSalary;
        cells.set(year, {
          playerId,
          playerName,
          age: baseAge + yearOffset,
          rating,
          salary,
          contractStatus: isLastYear ? 'final-year' : 'under-contract',
          isMinContract: isMinDeal,
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

        const salary = cell.isProspect ? PROSPECT_SALARY
          : cell.salary > 0 ? cell.salary
          : PROSPECT_SALARY;

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

    let currentSection = '';
    let bodyHtml = '';
    let lastSection = '';

    for (let ri = 0; ri < this.gridRows.length; ri++) {
      const row = this.gridRows[ri];

      // Section header when section changes
      if (row.section !== currentSection) {
        // Insert salary subtotal for previous section
        if (lastSection) {
          bodyHtml += this.renderSalaryRow(lastSection, yearRange, financials);
        }
        currentSection = row.section;
        lastSection = currentSection;
        const sectionLabel = currentSection.toUpperCase();
        bodyHtml += `
          <tr class="grid-section-row">
            <td class="grid-section-header" colspan="${yearRange.length + 1}">${sectionLabel}</td>
          </tr>
        `;
      }

      bodyHtml += `<tr class="grid-data-row">`;
      bodyHtml += `<td class="grid-position-label">${row.position}</td>`;

      for (const year of yearRange) {
        const cell = row.cells.get(year);
        bodyHtml += this.renderCell(cell);
      }

      bodyHtml += '</tr>';

      // After last row, close out the final section salary row
      if (ri === this.gridRows.length - 1) {
        bodyHtml += this.renderSalaryRow(currentSection, yearRange, financials);
        bodyHtml += this.renderGrandTotalRow(yearRange, financials);
      }
    }

    gridContainer.innerHTML = `
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

    // Bind cell click events
    gridContainer.querySelectorAll<HTMLElement>('.grid-cell[data-player-id]').forEach(cell => {
      cell.addEventListener('click', () => {
        const playerId = parseInt(cell.dataset.playerId!, 10);
        const isProspect = cell.dataset.prospect === 'true';
        this.openPlayerModal(playerId, isProspect);
      });
    });
  }

  private renderCell(cell: GridCell | undefined): string {
    if (!cell || cell.contractStatus === 'empty') {
      const indicators = cell?.indicators ?? [];
      const indicatorHtml = this.renderIndicators(indicators);
      return `<td class="grid-cell cell-empty">
        <span class="cell-empty-label">---</span>
        ${indicatorHtml}
      </td>`;
    }

    if (cell.isProspect) {
      const ratingClass = this.getRatingClass(cell.rating);
      const abbrevName = this.abbreviateName(cell.playerName);
      const clickAttr = cell.playerId ? `data-player-id="${cell.playerId}" data-prospect="true"` : '';
      const levelLabel = cell.level || '';
      const indicatorHtml = this.renderIndicators(cell.indicators ?? []);

      return `
        <td class="grid-cell cell-minor-league" ${clickAttr}>
          <div class="cell-name">${abbrevName}</div>
          <div class="cell-meta">
            <span class="cell-age">${cell.age}</span>
            <span class="badge ${ratingClass} cell-rating">${cell.rating.toFixed(1)}</span>
          </div>
          ${levelLabel ? `<div class="cell-salary">${levelLabel}</div>` : ''}
          ${indicatorHtml}
        </td>
      `;
    }

    const statusClass = `cell-${cell.contractStatus}`;
    const ratingClass = this.getRatingClass(cell.rating);
    const abbrevName = this.abbreviateName(cell.playerName);
    const salaryStr = cell.salary > 0 ? this.formatSalary(cell.salary) : '';
    const clickAttr = cell.playerId ? `data-player-id="${cell.playerId}"` : '';
    const indicatorHtml = this.renderIndicators(cell.indicators ?? []);

    return `
      <td class="grid-cell ${statusClass}" ${clickAttr}>
        <div class="cell-name">${abbrevName}</div>
        <div class="cell-meta">
          <span class="cell-age">${cell.age}</span>
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
      let filledYears = 0;
      let emptyYears = 0;
      let highRatingYears = 0;
      let currentPlayer = '';
      let currentRating = 0;
      let currentAge = 0;
      let isExtCandidate = false;

      for (let yi = 0; yi < yearRange.length; yi++) {
        const cell = row.cells.get(yearRange[yi]);
        if (!cell || cell.contractStatus === 'empty') {
          emptyYears++;
        } else {
          filledYears++;
          if (cell.rating >= 3.5) highRatingYears++;
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

      // Strength: 5+ years filled with high rating
      if (highRatingYears >= 5) {
        assessments.push({
          position: row.position,
          section: row.section,
          category: 'strength',
          detail: `${currentPlayer ? this.abbreviateName(currentPlayer) : row.position}: ${highRatingYears} years of ${currentRating.toFixed(1)}+ coverage`,
        });
      }

      // Need: 3+ empty years, or 2+ empty with current player < 2.5
      if (emptyYears >= 3 || (emptyYears >= 2 && currentRating < 2.5 && currentRating > 0)) {
        assessments.push({
          position: row.position,
          section: row.section,
          category: 'need',
          detail: `${row.position}: ${emptyYears} empty years${currentRating > 0 && currentRating < 2.5 ? `, current ${currentRating.toFixed(1)}` : ''}`,
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
      let emptyYears = 0;
      let gapStartYear = 0;
      let hasProspect = false;

      for (let yi = 0; yi < yearRange.length; yi++) {
        const cell = row.cells.get(yearRange[yi]);
        if (!cell || cell.contractStatus === 'empty') {
          if (emptyYears === 0) gapStartYear = yearRange[yi];
          emptyYears++;
        } else if (cell.isProspect) {
          hasProspect = true;
        }
      }

      // Report if 2+ empty years or 1+ empty with no prospect coverage
      if (emptyYears >= 2 || (emptyYears >= 1 && !hasProspect)) {
        gaps.push({
          position: row.position,
          section: row.section,
          gapStartYear,
          emptyYears,
          hasProspectCoverage: hasProspect,
        });
      }
    }

    return gaps;
  }

  private renderDraftReferenceSection(recommendations: DraftRecommendation[], _gaps: RosterGap[]): void {
    const container = this.container.querySelector<HTMLElement>('#tp-draft-container');
    if (!container) return;

    if (recommendations.length === 0) {
      container.innerHTML = `
        <div class="draft-reference-section">
          <div class="draft-section-header">DRAFT STRATEGY</div>
          <p class="summary-empty">No significant roster gaps identified.</p>
        </div>
      `;
      return;
    }

    const cards = recommendations.map(rec => {
      const posStats = rec.positionData
        ? `<span class="draft-stat">${rec.positionData.mlbPct}% MLB</span>
           <span class="draft-stat">${rec.positionData.avgWar} avg WAR</span>
           <span class="draft-stat">${rec.positionData.avgYrsToMlb}yr to MLB</span>`
        : '';

      return `
        <div class="draft-gap-card">
          <div class="draft-gap-header">${rec.position} — gap starting ${rec.gapStartYear} (${rec.emptyYears} year${rec.emptyYears !== 1 ? 's' : ''})</div>
          <div class="draft-gap-recommendation">${rec.roundSuggestion}</div>
          ${posStats ? `<div class="draft-gap-stats">${posStats}</div>` : ''}
          <div class="draft-gap-timeline">${rec.arrivalEstimate}</div>
          <div class="draft-gap-insight">${rec.insight}</div>
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
  // Player modals + utilities
  // =====================================================================

  private async openPlayerModal(playerId: number, isProspect = false): Promise<void> {
    const player = this.playerMap.get(playerId);
    if (!player) return;

    const name = `${player.firstName} ${player.lastName}`;

    if (player.position === 1) {
      const profileData = {
        playerId: player.id,
        playerName: name,
        age: player.age,
        position: 'SP' as const,
        positionLabel: 'P',
        trueRating: 0,
        percentile: 0,
        isProspect,
      };
      await pitcherProfileModal.show(profileData as any, this.gameYear);
    } else {
      const profileData = {
        playerId: player.id,
        playerName: name,
        age: player.age,
        position: player.position,
        positionLabel: String(player.position),
        trueRating: 0,
        percentile: 0,
        isProspect,
      };
      await this.batterProfileModal.show(profileData as any, this.gameYear);
    }
  }

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

  private getRatingClass(rating: number): string {
    if (rating >= 4.5) return 'rating-elite';
    if (rating >= 4.0) return 'rating-plus';
    if (rating >= 3.0) return 'rating-avg';
    if (rating >= 2.0) return 'rating-fringe';
    return 'rating-poor';
  }
}
