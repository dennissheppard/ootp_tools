import { PitcherScoutingRatings, HitterScoutingRatings } from '../models/ScoutingData';
import { Player, getFullName, getPositionLabel, isPitcher, PitcherRole, determinePitcherRole, PitcherRoleInput } from '../models/Player';
import { scoutingDataService } from '../services/ScoutingDataService';
import { scoutingDataFallbackService } from '../services/ScoutingDataFallbackService';
import { trueRatingsCalculationService, YearlyPitchingStats, getYearWeights } from '../services/TrueRatingsCalculationService';
import { hitterTrueRatingsCalculationService, YearlyHittingStats, getYearWeights as getHitterYearWeights } from '../services/HitterTrueRatingsCalculationService';
import { hitterScoutingDataService } from '../services/HitterScoutingDataService';
import { TruePlayerStats, TruePlayerBattingStats, trueRatingsService } from '../services/TrueRatingsService';
import { pitcherProfileModal } from './PitcherProfileModal';
import type { PlayerProfileData } from './PlayerRatingsCard';
import { batterProfileModal, BatterProfileData } from './BatterProfileModal';
import { RatingEstimatorService } from '../services/RatingEstimatorService';
import { playerService } from '../services/PlayerService';
import { teamService } from '../services/TeamService';
import { contractService } from '../services/ContractService';
import { minorLeagueBattingStatsService } from '../services/MinorLeagueBattingStatsService';
import { minorLeagueStatsService } from '../services/MinorLeagueStatsService';
import { MinorLeagueStatsWithLevel, MinorLeagueBattingStatsWithLevel } from '../models/Stats';
import { dateService } from '../services/DateService';
import { fipWarService } from '../services/FipWarService';
import { leagueStatsService } from '../services/LeagueStatsService';
import { leagueBattingAveragesService, LeagueBattingAverages } from '../services/LeagueBattingAveragesService';
import { teamRatingsService, HitterFarmData, FarmData } from '../services/TeamRatingsService';
import { analyticsService } from '../services/AnalyticsService';

type StatsMode = 'pitchers' | 'batters';

interface DerivedPitchingFields {
  ipOuts: number;
  kPer9: number;
  bbPer9: number;
  hraPer9: number;
  fip: number;
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
  /** TFR component ratings (peak potential, 20-80 scale) */
  tfrStuff?: number;
  tfrControl?: number;
  tfrHra?: number;
  /** Flag indicating this is a prospect without MLB stats */
  isProspect?: boolean;
  /** Star gap (POT - OVR) for prospects */
  starGap?: number;
  prospectHasStats?: boolean;
  prospectLevel?: MinorLeagueStatsWithLevel['level'];
}

interface HitterTrueRatingFields {
  trueRating?: number;
  percentile?: number;
  woba?: number;
  /** Blended rate stats */
  blendedBbPct?: number;
  blendedKPct?: number;
  blendedHrPct?: number;
  blendedIso?: number;
  blendedAvg?: number;
  blendedDoublesRate?: number;
  blendedTriplesRate?: number;
  /** Estimated ratings (20-80 scale) */
  estimatedPower?: number;
  estimatedEye?: number;
  estimatedAvoidK?: number;
  estimatedContact?: number;
  estimatedGap?: number;
  estimatedSpeed?: number;
  /** Total PA used in calculation */
  totalPa?: number;
  /** True Future Rating for prospects */
  trueFutureRating?: number;
  tfrPercentile?: number;
  /** TFR component ratings (peak potential) */
  tfrContact?: number;
  tfrPower?: number;
  tfrEye?: number;
  /** Flag indicating this is a prospect without MLB stats */
  isProspect?: boolean;
  /** Star gap (POT - OVR) for prospects */
  starGap?: number;
  prospectHasStats?: boolean;
  prospectLevel?: MinorLeagueBattingStatsWithLevel['level'];
}

interface TeamInfoFields {
  teamDisplay?: string;
  teamFilter?: string;
  teamIsMajor?: boolean;
  age?: number;
}

interface StatsAvailabilityFields {
  hasStats?: boolean;
}

type PitcherRow = TruePlayerStats & DerivedPitchingFields & TrueRatingFields & TeamInfoFields & StatsAvailabilityFields;
type BatterRow = TruePlayerBattingStats & HitterTrueRatingFields & TeamInfoFields & StatsAvailabilityFields;
type TableRow = PitcherRow | BatterRow;

interface PitcherColumn {
  key: keyof PitcherRow | string;
  label: string;
  sortKey?: keyof PitcherRow | string;
  accessor?: (row: PitcherRow) => any;
}

interface BatterColumn {
  key: keyof BatterRow | string;
  label: string;
  sortKey?: keyof BatterRow | string;
  accessor?: (row: BatterRow) => any;
}

interface ScoutingLookup {
  byId: Map<number, PitcherScoutingRatings>;
  byName: Map<string, PitcherScoutingRatings[]>;
}

interface HitterScoutingLookup {
  byId: Map<number, HitterScoutingRatings>;
  byName: Map<string, HitterScoutingRatings[]>;
}

const RAW_PITCHER_COLUMNS: PitcherColumn[] = [
  { key: 'position', label: 'Pos', sortKey: 'position' },
  { key: 'playerName', label: 'Name', accessor: (row: PitcherRow) => `<span class="name-col">${row.playerName}</span>` },
  { key: 'age', label: 'Age', sortKey: 'age' },
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
  { key: 'fip', label: 'FIP' },
];

const RAW_PITCHER_STAT_KEYS = new Set([
  'ip',
  'k',
  'bb',
  'hra',
  'r',
  'er',
  'war',
  'ra9war',
  'wpa',
  'kPer9',
  'bbPer9',
  'hraPer9',
  'fip',
]);

const MISSING_STAT_DISPLAY = '&mdash;';

export class TrueRatingsView {
  private container: HTMLElement;
  private stats: TableRow[] = [];
  private currentPage = 1;
  private itemsPerPage = 50;
  private itemsPerPageSelection: '10' | '50' | '200' | 'all' = '50';
  private selectedYear = 2020;
  private selectedTeam = 'all';
  private selectedPosition = 'all-pitchers';
  private teamOptions: string[] = [];
  private yearOptions = Array.from({ length: 22 }, (_, i) => 2021 - i); // 2021 down to 2000
  private sortKey: string | null = 'ra9war';
  private sortDirection: 'asc' | 'desc' = 'desc';
  private mode: StatsMode = 'pitchers';
  private showTrueRatings = true;
  private showRawStats = false;
  private showProspects = true;
  private showMlbPlayers = true;
  private showUndraftedPlayers = false;
  private allStats: TableRow[] = [];
  private readonly prefKey = 'wbl-prefs';
  private preferences: Record<string, unknown> = {};
  private pitcherColumns: PitcherColumn[] = [];
  private isDraggingColumn = false;
  private scoutingRatings: PitcherScoutingRatings[] = []; // Merged fallback (my > osa)
  private scoutingMetadata: { hasMyScoutData: boolean; fromMyScout: number; fromOSA: number } | null = null;
  // Hitter scouting data
  private hitterScoutingRatings: HitterScoutingRatings[] = [];
  private myHitterScoutingRatings: HitterScoutingRatings[] = [];
  private osaHitterScoutingRatings: HitterScoutingRatings[] = [];
  private hitterScoutingLookup: HitterScoutingLookup | null = null;
  private rawPitcherStats: PitcherRow[] = [];
  private rawBatterStats: BatterRow[] = [];
  private playerRowLookup: Map<number, PitcherRow> = new Map();
  // @ts-ignore - Batter row lookup for future use in PlayerProfileModal
  private _batterRowLookup: Map<number, BatterRow> = new Map();
  private yearDefaultsInitialized = false;
  private currentGameYear: number | null = null;
  private cachedLeagueBattingAverages: LeagueBattingAverages | null = null; // For OPS+ calculation
  private hasLoadedData = false; // Track if data has been loaded (for lazy loading)
  private _cachedUnifiedHitterTfrData: HitterFarmData | null = null;
  // @ts-ignore - Written in buildProspectRows, available for future pitcher modal use
  private _cachedPitcherFarmData: FarmData | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.preferences = this.loadPreferences();
    this.restorePreferences();
    this.updatePitcherColumns();
    this.renderLayout();
    // Defer data loading until tab is activated (lazy loading)
    // This prevents loading data for inactive tabs during app initialization
    this.initializeYearDefaults();

    // Listen for tab activation to load data on first view
    this.setupLazyLoading();
  }

  private setupLazyLoading(): void {
    // Check if tab is already active when view is created
    const tabPanel = this.container.closest<HTMLElement>('.tab-panel');
    const isCurrentlyActive = tabPanel?.classList.contains('active');

    if (!isCurrentlyActive) {
      // Set up observer to detect when tab becomes active
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            const target = mutation.target as HTMLElement;
            if (target.classList.contains('active')) {
              // Tab just became active - load data if not already loaded
              if (!this.hasLoadedData) {
                this.fetchAndRenderStats();
                this.hasLoadedData = true;
              }
              // Stop observing once data is loaded
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

  private restorePreferences(): void {
    // Restore filter settings from preferences
    if (typeof this.preferences.selectedYear === 'number') {
      this.selectedYear = this.preferences.selectedYear;
    }
    if (typeof this.preferences.selectedTeam === 'string') {
      this.selectedTeam = this.preferences.selectedTeam;
    }
    if (typeof this.preferences.selectedPosition === 'string') {
      this.selectedPosition = this.preferences.selectedPosition;
      // Restore mode based on position
      const pitcherPositions = ['all-pitchers', 'SP', 'RP'];
      const batterPositions = ['all-batters', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'all-of', 'all-middle-if'];
      if (pitcherPositions.includes(this.selectedPosition)) {
        this.mode = 'pitchers';
      } else if (batterPositions.includes(this.selectedPosition)) {
        this.mode = 'batters';
      }
    } else if (this.preferences.mode === 'pitchers' || this.preferences.mode === 'batters') {
      // Handle old preferences that only have mode (for backward compatibility)
      this.mode = this.preferences.mode;
      this.selectedPosition = this.mode === 'pitchers' ? 'all-pitchers' : 'all-batters';
    }
    if (this.preferences.itemsPerPageSelection === '10' ||
        this.preferences.itemsPerPageSelection === '50' ||
        this.preferences.itemsPerPageSelection === '200' ||
        this.preferences.itemsPerPageSelection === 'all') {
      this.itemsPerPageSelection = this.preferences.itemsPerPageSelection;
      this.itemsPerPage = this.itemsPerPageSelection === 'all' ? 999999 : parseInt(this.itemsPerPageSelection, 10);
    }
    if (typeof this.preferences.showProspects === 'boolean') {
      this.showProspects = this.preferences.showProspects;
    }
    if (typeof this.preferences.showMlbPlayers === 'boolean') {
      this.showMlbPlayers = this.preferences.showMlbPlayers;
    }
    if (typeof this.preferences.showTrueRatings === 'boolean') {
      this.showTrueRatings = this.preferences.showTrueRatings;
    }
    if (typeof this.preferences.showRawStats === 'boolean') {
      this.showRawStats = this.preferences.showRawStats;
    }
    if (typeof this.preferences.showUndraftedPlayers === 'boolean') {
      this.showUndraftedPlayers = this.preferences.showUndraftedPlayers;
    }
    if (typeof this.preferences.currentPage === 'number') {
      this.currentPage = this.preferences.currentPage;
    }
    if (typeof this.preferences.sortKey === 'string') {
      this.sortKey = this.preferences.sortKey;
    }
    if (this.preferences.sortDirection === 'asc' || this.preferences.sortDirection === 'desc') {
      this.sortDirection = this.preferences.sortDirection;
    }
  }

  private saveFilterPreferences(): void {
    this.updatePreferences({
      selectedYear: this.selectedYear,
      selectedTeam: this.selectedTeam,
      selectedPosition: this.selectedPosition,
      itemsPerPageSelection: this.itemsPerPageSelection,
      showProspects: this.showProspects,
      showMlbPlayers: this.showMlbPlayers,
      showTrueRatings: this.showTrueRatings,
      showRawStats: this.showRawStats,
      showUndraftedPlayers: this.showUndraftedPlayers,
      mode: this.mode,
      currentPage: this.currentPage,
      sortKey: this.sortKey,
      sortDirection: this.sortDirection,
    });
  }

  private renderLayout(): void {
    this.container.innerHTML = `
      <div class="true-ratings-content">
        <div class="draft-header">
            <h2 class="view-title">True Player Ratings</h2>
        </div>
        <div class="true-ratings-controls">
          <div class="filter-bar" id="ratings-view-toggle">
            <label>Filters:</label>
            <div class="filter-group" role="group" aria-label="Ratings filters">
              <div class="filter-dropdown" data-filter="year">
                <button class="filter-dropdown-btn" aria-haspopup="true" aria-expanded="false">
                  Year: <span id="selected-year-display">${this.selectedYear}</span> ▾
                </button>
                <div class="filter-dropdown-menu" id="year-dropdown-menu">
                  ${this.yearOptions.map(year => `<div class="filter-dropdown-item ${year === this.selectedYear ? 'selected' : ''}" data-value="${year}">${year}</div>`).join('')}
                </div>
              </div>
              <div class="filter-dropdown" data-filter="team">
                <button class="filter-dropdown-btn" aria-haspopup="true" aria-expanded="false">
                  Team: <span id="selected-team-display">All Teams</span> ▾
                </button>
                <div class="filter-dropdown-menu" id="team-dropdown-menu">
                  <div class="filter-dropdown-item selected" data-value="all">All Teams</div>
                </div>
              </div>
              <div class="filter-dropdown" data-filter="position">
                <button class="filter-dropdown-btn" aria-haspopup="true" aria-expanded="false">
                  Position: <span id="selected-position-display">${this.getPositionDisplayName(this.selectedPosition)}</span> ▾
                </button>
                <div class="filter-dropdown-menu" id="position-dropdown-menu">
                  ${this.renderPositionDropdownItems()}
                </div>
              </div>
              <button class="toggle-btn ${this.showRawStats ? 'active' : ''}" data-ratings-toggle="raw" aria-pressed="${this.showRawStats}">Raw Stats</button>
              <button class="toggle-btn ${this.showTrueRatings ? 'active' : ''}" data-ratings-toggle="true" aria-pressed="${this.showTrueRatings}">True Ratings</button>
              <button class="toggle-btn ${this.showMlbPlayers ? 'active' : ''}" data-player-toggle="mlb" aria-pressed="${this.showMlbPlayers}">MLB Players</button>
              <button class="toggle-btn ${this.showProspects ? 'active' : ''}" data-player-toggle="prospect" aria-pressed="${this.showProspects}">Prospects</button>
              <button class="toggle-btn ${this.showUndraftedPlayers ? 'active' : ''}" data-player-toggle="undrafted" aria-pressed="${this.showUndraftedPlayers}">Undrafted Players</button>
            </div>
          </div>
        </div>
        
        <div class="scout-upload-notice" id="scouting-notice" style="display: none; margin-bottom: 1rem;">
            No scouting data found. <button class="btn-link" data-tab-target="tab-data-management" type="button">Manage Data</button>
        </div>

        <div id="true-ratings-table-container"></div>
        <div class="pagination-controls">
          <button id="prev-page" disabled>Previous</button>
          <div id="page-info" class="page-info">
            <span class="page-label">Page</span>
            <select id="page-jump-select" class="page-current-select" aria-label="Page"></select>
            <span class="page-total" id="page-total"></span>
          </div>
          <button id="next-page" disabled>Next</button>
          <div class="items-per-page">
            <label for="items-per-page">Show:</label>
            <select id="items-per-page">
              <option value="10" ${this.itemsPerPageSelection === '10' ? 'selected' : ''}>10 per page</option>
              <option value="50" ${this.itemsPerPageSelection === '50' ? 'selected' : ''}>50 per page</option>
              <option value="200" ${this.itemsPerPageSelection === '200' ? 'selected' : ''}>200 per page</option>
              <option value="all" ${this.itemsPerPageSelection === 'all' ? 'selected' : ''}>All</option>
            </select>
          </div>
        </div>
        <div class="ratings-help-text" style="${this.showRawStats ? '' : 'display: none'}">
          <p>* <strong>Estimated Ratings</strong> (visible when hovering over K/9, BB/9, HR/9) are snapshots based solely on that single stat. <strong>True Ratings</strong> use sophisticated multi-year analysis and regression.</p>
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

  private async initializeYearDefaults(): Promise<void> {
    if (this.yearDefaultsInitialized) return;
    this.yearDefaultsInitialized = true;

    try {
      const dateStr = await dateService.getCurrentDateWithFallback();
      const [yearPart, monthPart, dayPart] = dateStr.split('-');
      const gameYear = parseInt(yearPart, 10) || new Date().getFullYear();
      const gameMonth = parseInt(monthPart, 10) || 1;
      const gameDay = parseInt(dayPart, 10) || 1;
      
      // Default to current year only if we are past April 5th (Season Start)
      const isPastSeasonStart = gameMonth > 4 || (gameMonth === 4 && gameDay > 5);
      const defaultYear = isPastSeasonStart ? gameYear : gameYear - 1;
      
      this.currentGameYear = gameYear;

      const startYear = 2000;
      const endYear = Math.max(gameYear, startYear);
      this.yearOptions = Array.from({ length: endYear - startYear + 1 }, (_, i) => endYear - i);

      // Check if we have a saved year preference
      const hasSavedYear = typeof this.preferences.selectedYear === 'number';
      const savedYearIsValid = hasSavedYear &&
                               this.selectedYear >= startYear &&
                               this.selectedYear <= endYear;

      // Only override if no saved preference or saved preference is out of range
      if (!savedYearIsValid) {
        this.selectedYear = Math.min(Math.max(defaultYear, startYear), endYear);
      }

      const yearSelect = this.container.querySelector<HTMLSelectElement>('#true-ratings-year');
      if (yearSelect) {
        yearSelect.innerHTML = this.yearOptions
          .map(year => `<option value="${year}" ${year === this.selectedYear ? 'selected' : ''}>${year}</option>`)
          .join('');
        yearSelect.value = String(this.selectedYear);
      }
    } catch {
      // Keep existing defaults if date load fails
    } finally {
      await this.updateProspectsAvailability();
      await this.loadScoutingRatingsForYear();
      // Only fetch data if this tab is currently active
      // Otherwise, data will be loaded when tab is first activated
      const tabPanel = this.container.closest<HTMLElement>('.tab-panel');
      const isActive = tabPanel?.classList.contains('active') ?? false;
      if (tabPanel && isActive && !this.hasLoadedData) {
        this.fetchAndRenderStats();
        this.hasLoadedData = true;
      }
    }
  }

  private async updateProspectsAvailability(): Promise<void> {
    const currentYear = this.currentGameYear ?? await dateService.getCurrentYear().catch(() => new Date().getFullYear());
    this.currentGameYear = currentYear;
    const disableProspects = this.selectedYear < currentYear;

    if (disableProspects) {
      this.showProspects = false;
      this.showUndraftedPlayers = false;
      if (!this.showMlbPlayers) {
        this.showMlbPlayers = true;
      }
    }

    const prospectToggle = this.container.querySelector<HTMLButtonElement>('[data-player-toggle="prospect"]');
    if (prospectToggle) {
      prospectToggle.disabled = disableProspects;
      prospectToggle.setAttribute('aria-disabled', String(disableProspects));
      prospectToggle.title = disableProspects
        ? 'Prospects are only available for the current season.'
        : '';
    }

    const undraftedToggle = this.container.querySelector<HTMLButtonElement>('[data-player-toggle="undrafted"]');
    if (undraftedToggle) {
      undraftedToggle.disabled = disableProspects;
      undraftedToggle.setAttribute('aria-disabled', String(disableProspects));
      undraftedToggle.title = disableProspects
        ? 'Undrafted players are only available for the current season.'
        : '';
    }

    this.updatePlayerToggleButtons();
  }

  private bindEventListeners(): void {
    // Handle year dropdown item clicks
    this.container.querySelectorAll('#year-dropdown-menu .filter-dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const value = (e.target as HTMLElement).dataset.value;
        if (!value) return;

        this.selectedYear = parseInt(value, 10);
        this.currentPage = 1;
        this.saveFilterPreferences();

        analyticsService.trackYearChanged(this.selectedYear, 'true-ratings');

        // Update display text
        const displaySpan = this.container.querySelector('#selected-year-display');
        if (displaySpan) {
          displaySpan.textContent = value;
        }

        // Update selected state
        this.container.querySelectorAll('#year-dropdown-menu .filter-dropdown-item').forEach(i => i.classList.remove('selected'));
        (e.target as HTMLElement).classList.add('selected');

        // Close dropdown
        (e.target as HTMLElement).closest('.filter-dropdown')?.classList.remove('open');

        this.updateProspectsAvailability().then(async () => {
          await this.loadScoutingRatingsForYear();
          this.fetchAndRenderStats();
        });
      });
    });

    this.container.querySelector('#items-per-page')?.addEventListener('change', (e) => {
      const value = (e.target as HTMLSelectElement).value as '10' | '50' | '200' | 'all';
      this.itemsPerPageSelection = value;
      this.itemsPerPage = value === 'all' ? this.stats.length : parseInt(value, 10);
      this.currentPage = 1;
      this.saveFilterPreferences();
      this.renderStats();
    });

    this.container.querySelector('#page-jump-select')?.addEventListener('change', (e) => {
      const nextPage = parseInt((e.target as HTMLSelectElement).value, 10);
      if (!Number.isNaN(nextPage) && nextPage !== this.currentPage) {
        this.currentPage = nextPage;
        this.saveFilterPreferences();
        this.renderStats();
      }
    });

    // Handle team dropdown item clicks
    this.bindTeamDropdownListeners();

    // Handle position dropdown item clicks
    this.bindPositionDropdownListeners();

    // Handle filter dropdown button clicks
    this.container.querySelectorAll('.filter-dropdown-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dropdown = btn.closest('.filter-dropdown');

        // Close other dropdowns
        this.container.querySelectorAll('.filter-dropdown').forEach(d => {
          if (d !== dropdown) {
            d.classList.remove('open');
          }
        });

        // Toggle this dropdown
        dropdown?.classList.toggle('open');
      });
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.filter-dropdown')) {
        this.container.querySelectorAll('.filter-dropdown').forEach(d => {
          d.classList.remove('open');
        });
      }
    });

    this.container.querySelector('#prev-page')?.addEventListener('click', () => {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.saveFilterPreferences();
        this.renderStats();
      }
    });

    this.container.querySelector('#next-page')?.addEventListener('click', () => {
      const totalPages = this.itemsPerPage === this.stats.length ? 1 : Math.ceil(this.stats.length / this.itemsPerPage);
      if (this.currentPage < totalPages) {
        this.currentPage++;
        this.saveFilterPreferences();
        this.renderStats();
      }
    });

    this.bindRatingsViewToggle();
    this.bindPlayerTypeToggle();
    this.updateRatingsControlsVisibility();

    // Listen for scouting data updates from DataManagementView
    window.addEventListener('scoutingDataUpdated', () => {
      this.loadScoutingRatingsForYear().then(() => {
        // Re-render if we're showing the current year (which uses scouting)
        const currentYear = this.currentGameYear ?? new Date().getFullYear();
        if (this.selectedYear >= currentYear) {
          this.fetchAndRenderStats();
        }
      });
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
          // Make Raw Stats and True Ratings mutually exclusive
          if (this.showRawStats) {
            this.showTrueRatings = false;
            this.showProspects = false;
            this.showUndraftedPlayers = false;
            // Ensure MLB players are visible since they are the only ones with stats
            if (!this.showMlbPlayers) {
              this.showMlbPlayers = true;
            }
          }
        } else if (toggle === 'true') {
          const nextTrue = !this.showTrueRatings;
          if (!nextTrue && !this.showRawStats) return;
          this.showTrueRatings = nextTrue;
          // Make True Ratings and Raw Stats mutually exclusive
          if (this.showTrueRatings) {
            this.showRawStats = false;
          }
        } else {
          return;
        }

        this.saveFilterPreferences();
        this.updateRatingsToggleButtons();
        this.updatePlayerToggleButtons(); // Sync prospect button state

        const helpText = this.container.querySelector<HTMLElement>('.ratings-help-text');
        if (helpText) {
          helpText.style.display = this.showRawStats ? '' : 'none';
        }

        this.updatePitcherColumns();
        this.updateRatingsControlsVisibility();
        this.fetchAndRenderStats();
      });
    });
  }

  private updateRatingsToggleButtons(): void {
    const buttons = this.container.querySelectorAll<HTMLButtonElement>('[data-ratings-toggle]');
    buttons.forEach(btn => {
      const key = btn.dataset.ratingsToggle;
      const isActive = key === 'raw' ? this.showRawStats : this.showTrueRatings;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
  }

  private bindPlayerTypeToggle(): void {
    const buttons = this.container.querySelectorAll<HTMLButtonElement>('[data-player-toggle]');
    buttons.forEach(button => {
      button.addEventListener('click', () => {
        const toggle = button.dataset.playerToggle;
        let ratingsViewChanged = false;

        if (toggle === 'prospect') {
          const nextProspects = !this.showProspects;
          if (!nextProspects && !this.showMlbPlayers && !this.showUndraftedPlayers) return;
          this.showProspects = nextProspects;
          if (this.showProspects && this.showRawStats) {
            this.showRawStats = false;
            this.showTrueRatings = true;
            ratingsViewChanged = true;
          }
        } else if (toggle === 'mlb') {
          const nextMlb = !this.showMlbPlayers;
          if (!nextMlb && !this.showProspects && !this.showUndraftedPlayers) return;
          this.showMlbPlayers = nextMlb;
        } else if (toggle === 'undrafted') {
          const nextUndrafted = !this.showUndraftedPlayers;
          if (!nextUndrafted && !this.showProspects && !this.showMlbPlayers) return;
          this.showUndraftedPlayers = nextUndrafted;
          if (this.showUndraftedPlayers && this.showRawStats) {
            this.showRawStats = false;
            this.showTrueRatings = true;
            ratingsViewChanged = true;
          }
        } else {
          return;
        }

        this.saveFilterPreferences();
        this.updatePlayerToggleButtons();
        this.updateRatingsToggleButtons(); // Sync raw stats button state
        this.updatePitcherColumns(); // Refresh columns (e.g., TFR columns depend on showProspects)

        // If we changed from Raw Stats to True Ratings, we need to refetch the data
        if (ratingsViewChanged) {
          this.fetchAndRenderStats();
        } else {
          this.applyFiltersAndRender();
        }
      });
    });
  }

  private updatePlayerToggleButtons(): void {
    const buttons = this.container.querySelectorAll<HTMLButtonElement>('[data-player-toggle]');
    buttons.forEach(btn => {
      const key = btn.dataset.playerToggle;
      let isActive = false;
      if (key === 'prospect') {
        isActive = this.showProspects;
      } else if (key === 'mlb') {
        isActive = this.showMlbPlayers;
      } else if (key === 'undrafted') {
        isActive = this.showUndraftedPlayers;
      }
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
  }

  private updateRatingsControlsVisibility(): void {
    // Show/hide ratings toggles (Raw Stats is pitcher-only, True Ratings is for both)
    const rawStatsBtn = this.container.querySelector<HTMLElement>('[data-ratings-toggle="raw"]');
    const trueRatingsBtn = this.container.querySelector<HTMLElement>('[data-ratings-toggle="true"]');
    const undraftedBtn = this.container.querySelector<HTMLElement>('[data-player-toggle="undrafted"]');
    const prospectBtn = this.container.querySelector<HTMLElement>('[data-player-toggle="prospect"]');

    // Raw Stats is available for both pitchers and batters
    if (rawStatsBtn) rawStatsBtn.style.display = '';

    // True Ratings is available for both pitchers and batters
    if (trueRatingsBtn) trueRatingsBtn.style.display = '';

    // Prospects toggle is available for both pitchers and batters
    if (prospectBtn) {
      prospectBtn.style.display = '';
    }

    // Disable undrafted toggle if a specific team is selected or year is in the past
    if (undraftedBtn) {
      const isTeamSelected = this.selectedTeam !== 'all';
      const isPastYear = this.currentGameYear != null && this.selectedYear < this.currentGameYear;
      const isDisabled = isTeamSelected || isPastYear;
      (undraftedBtn as HTMLButtonElement).disabled = isDisabled;
      undraftedBtn.style.opacity = isDisabled ? '0.5' : '1';
      undraftedBtn.style.cursor = isDisabled ? 'not-allowed' : 'pointer';
      undraftedBtn.title = isPastYear
        ? 'Undrafted players are only available for the current season.'
        : isTeamSelected ? 'Filter only available when viewing "All Teams"' : '';
    }
  }

  private async fetchAndRenderStats(): Promise<void> {
    const tableContainer = this.container.querySelector<HTMLElement>('#true-ratings-table-container')!;
    tableContainer.innerHTML = this.renderTableLoadingState();

    // Clear cached farm data so it gets re-fetched with fresh data
    this._cachedUnifiedHitterTfrData = null;
    this._cachedPitcherFarmData = null;

    try {
      if (this.mode === 'pitchers') {
        const { rows } = await this.getPitcherStatsWithRosterFallback();
        this.rawPitcherStats = rows;

        await this.enrichWithTeamData(this.rawPitcherStats);

        // Always calculate True Ratings (needed for both table display and modal)
        // The enriched stats contain BOTH True Ratings AND raw stats
        this.stats = await this.buildTrueRatingsStats(this.rawPitcherStats);
        // Note: Column visibility is controlled by getPitcherColumnsForView() based on toggles
      } else {
        const { rows } = await this.getBatterStatsWithRosterFallback();
        this.rawBatterStats = rows;
        await this.enrichWithTeamData(this.rawBatterStats);

        // Fetch league batting averages for OPS+ calculation
        try {
          this.cachedLeagueBattingAverages = await leagueBattingAveragesService.getLeagueAverages(this.selectedYear);
        } catch (error) {
          console.warn('Failed to load league batting averages:', error);
          this.cachedLeagueBattingAverages = null;
        }

        // Always calculate True Ratings (needed for both table display and modal)
        // The enriched stats contain BOTH True Ratings AND raw stats
        this.stats = await this.buildHitterTrueRatingsStats(this.rawBatterStats);
        // Note: Column visibility is controlled by getBatterColumnsForView() based on toggles
      }
      this.allStats = [...this.stats];
      this.updateTeamOptions();
      this.applyFilters();
      this.updateRatingsControlsVisibility();
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
      const [allTeams, allPlayers, allContracts] = await Promise.all([
        teamService.getAllTeams(),
        playerService.getAllPlayers(),
        contractService.getAllContracts()
      ]);
      const teamMap = new Map(allTeams.map(t => [t.id, t]));
      const playerMap = new Map(allPlayers.map(p => [p.id, p]));

      const currentYear = this.currentGameYear ?? new Date().getFullYear();
      const useHistoricalTeams = this.selectedYear < currentYear;
      const ageDiff = currentYear - this.selectedYear;

      rows.forEach(row => {
        const playerId = (row as any).player_id;
        const player = playerMap.get(playerId);

        if (player) {
          // Calculate age for the selected year
          row.age = Math.max(16, player.age - ageDiff);
        }

        // Team Logic
        if (useHistoricalTeams) {
          const teamId = (row as any).team_id;
          const team = teamMap.get(teamId);

          if (!team) return;

          if (team.parentTeamId !== 0) {
            const parent = teamMap.get(team.parentTeamId);
            if (parent) {
              const levelId = (row as any).level_id;
              const levelLabel = this.getLevelLabelFromId(levelId);
              row.teamDisplay = levelLabel ? `${parent.nickname} <span class="league-level">${levelLabel}</span>` : parent.nickname;
              row.teamFilter = parent.nickname;
              row.teamIsMajor = false;
              return;
            }
          }

          row.teamDisplay = team.nickname;
          row.teamFilter = team.nickname;
          row.teamIsMajor = true;
        } else {
          // Current Year Logic (Team from Player Object)
          if (!player) return;

          const team = teamMap.get(player.teamId);
          if (!team) return;

          if (player.parentTeamId !== 0) {
            const parent = teamMap.get(player.parentTeamId);
            if (parent) {
              const levelLabel = this.getLevelLabelFromId(player.level);
              row.teamDisplay = levelLabel ? `${parent.nickname} <span class="league-level">${levelLabel}</span>` : parent.nickname;
              row.teamFilter = parent.nickname;
              row.teamIsMajor = false;
              return;
            }
          }

          // Fallback: player.parentTeamId is 0 but team itself may have a parent (e.g. IC teams)
          if (team.parentTeamId !== 0) {
            const parent = teamMap.get(team.parentTeamId);
            if (parent) {
              const levelLabel = this.getLevelLabelFromId(player.level) || 'IC';
              row.teamDisplay = `${parent.nickname} <span class="league-level">${levelLabel}</span>`;
              row.teamFilter = parent.nickname;
              row.teamIsMajor = false;
              return;
            }
          }

          // Check if this is an IC player via contract (player sits on MLB team but is IC)
          const contract = allContracts.get(player.id);
          if (contract && contract.leagueId === -200) {
            row.teamDisplay = `${team.nickname} <span class="league-level">IC</span>`;
            row.teamFilter = team.nickname;
            row.teamIsMajor = false;
            return;
          }

          row.teamDisplay = team.nickname;
          row.teamFilter = team.nickname;
          row.teamIsMajor = true;
        }
      });
    } catch (err) {
      console.error('Error enriching team data:', err);
    }
  }

  private getLevelLabelFromId(levelId: number): string {
    // OOTP level_id mapping:
    // 1 = MLB, 2 = AAA, 3 = AA, 4 = A, 5 = R (Rookie)
    switch (levelId) {
      case 2: return 'AAA';
      case 3: return 'AA';
      case 4: return 'A';
      case 5: return 'R';
      case 7: return 'Ind'; // Independent
      case 8: return 'IC';  // International Complex
      case 9: return 'IC';  // International Complex (sometimes used)
      case 10: return 'Col'; // College
      case 11: return 'HS';  // High School
      default: return '';
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
    this.triggerBarAnimations();
    this.updatePaginationControls(this.stats.length);
    this.bindSortHeaders();
    this.bindScrollButtons();
    this.bindPitcherColumnDragAndDrop();
    this.bindPlayerNameClicks();
    this.bindFlipCardLocking();
  }

  private triggerBarAnimations(): void {
    requestAnimationFrame(() => {
      const barFills = this.container.querySelectorAll<HTMLElement>('.rating-bar-fill');
      barFills.forEach(bar => {
        bar.style.width = '0%';
        bar.classList.remove('animate-fill');
      });
      window.setTimeout(() => {
        barFills.forEach(bar => {
          void bar.getBoundingClientRect();
          bar.classList.add('animate-fill');
        });
      }, 1000);
    });

    this.bindBarHoverAnimations();
  }

  private bindBarHoverAnimations(): void {
    const ratingCells = this.container.querySelectorAll<HTMLElement>(
      'td[data-col-key="trueRating"], td[data-col-key="estimatedStuff"], td[data-col-key="estimatedControl"], td[data-col-key="estimatedHra"]'
    );

    ratingCells.forEach(cell => {
      cell.addEventListener('mouseenter', () => {
        const barFill = cell.querySelector<HTMLElement>('.rating-bar-fill');
        if (!barFill) return;

        barFill.style.width = '0%';
        barFill.classList.remove('animate-fill');

        requestAnimationFrame(() => {
          void barFill.getBoundingClientRect();
          barFill.classList.add('animate-fill');
        });
      });
    });
  }

  private applyFilters(): void {
    this.stats = this.allStats.filter(row => {
      if (this.mode === 'pitchers') {
        const isProspect = Boolean((row as PitcherRow).isProspect);
        if (isProspect && !this.showProspects) return false;
        if (!isProspect && !this.showMlbPlayers) return false;
      }

      if (this.mode === 'batters') {
        const isProspect = Boolean((row as BatterRow).isProspect);
        if (isProspect && !this.showProspects) return false;
        if (!isProspect && !this.showMlbPlayers) return false;
      }

      // Filter out undrafted players (those without a team) unless showUndraftedPlayers is true
      const teamValue = (row as TeamInfoFields).teamFilter ?? '';
      if (!this.showUndraftedPlayers && teamValue === '') return false;

      // Filter by team
      if (this.selectedTeam !== 'all' && teamValue !== this.selectedTeam) return false;

      // Filter by position
      if (this.selectedPosition !== 'all-pitchers' && this.selectedPosition !== 'all-batters') {
        if (this.mode === 'pitchers') {
          // For pitchers, calculate SP/RP dynamically
          const pitcherRole = this.determinePitcherRoleLabel(row as PitcherRow);
          if (pitcherRole !== this.selectedPosition) return false;
        } else {
          // For batters, use the position field directly
          const position = getPositionLabel((row as BatterRow).position);
          if (this.selectedPosition === 'all-of') {
            if (position !== 'LF' && position !== 'CF' && position !== 'RF') return false;
          } else if (this.selectedPosition === 'all-middle-if') {
            if (position !== '2B' && position !== 'SS') return false;
          } else {
            if (position !== this.selectedPosition) return false;
          }
        }
      }

      return true;
    });
  }

  private applyFiltersAndRender(): void {
    this.applyFilters();
    this.updateRatingsControlsVisibility();
    this.updateItemsPerPageForFilter();
    this.ensureSortKeyForView();
    this.sortStats();
    this.renderStats();
  }

  private updateItemsPerPageForFilter(): void {
    if (this.itemsPerPageSelection === 'all') {
      this.itemsPerPage = Math.max(this.stats.length, 1);
      return;
    }
    // Don't reduce itemsPerPage - keep the user's selection even if there are fewer items
    // The pagination will handle showing just one page automatically
  }

  private renderTableLoadingState(): string {
    const columns = this.getPitcherColumnsForView();
    const columnCount = Math.max(columns.length, 6);
    const rowCount = this.getSkeletonRowCount();
    const headerCells = this.renderSkeletonCells('th', columnCount);
    const bodyRows = this.renderSkeletonRows(columnCount, rowCount);

    return `
      <div class="table-wrapper-outer loading-skeleton">
        <button class="scroll-btn scroll-btn-left" aria-hidden="true" tabindex="-1" disabled></button>
        <div class="table-wrapper">
          <table class="stats-table true-ratings-table skeleton-table">
            <thead>
              <tr>
                ${headerCells}
              </tr>
            </thead>
            <tbody>
              ${bodyRows}
            </tbody>
          </table>
        </div>
        <button class="scroll-btn scroll-btn-right" aria-hidden="true" tabindex="-1" disabled></button>
      </div>
    `;
  }

  private renderSkeletonCells(tag: 'th' | 'td', count: number): string {
    return Array.from({ length: count }, () => `<${tag}><span class="skeleton-line xs"></span></${tag}>`).join('');
  }

  private renderSkeletonRows(columnCount: number, rowCount: number): string {
    const cells = this.renderSkeletonCells('td', columnCount);
    return Array.from({ length: rowCount }, () => `<tr>${cells}</tr>`).join('');
  }

  private getSkeletonRowCount(): number {
    if (this.itemsPerPageSelection === '10') return 10;
    return 12;
  }

  private updatePitcherColumns(): void {
    const columns = this.getPitcherColumnsForView();
    this.pitcherColumns = this.applyPitcherColumnOrder(columns);
    this.ensureSortKeyForView();
  }

  private getPitcherColumnsForView(): PitcherColumn[] {
    if (this.mode !== 'pitchers') {
      const [posColumn, nameColumn, ageColumn, ...rest] = RAW_PITCHER_COLUMNS;
      return [
        posColumn,
        nameColumn,
        ageColumn,
        { key: 'teamDisplay', label: 'Team', sortKey: 'teamDisplay' },
        ...rest
      ];
    }

    const [posColumn, nameColumn, ageColumn, ...rest] = RAW_PITCHER_COLUMNS;
    
    // Use tier badge styling for position column
    const styledPosColumn = {
      ...posColumn,
      accessor: (row: PitcherRow) => this.renderTierBadge(row)
    };

    const columns: PitcherColumn[] = [styledPosColumn, nameColumn, ageColumn];
    
    // Add Team column
    columns.push({ key: 'teamDisplay', label: 'Team', sortKey: 'teamDisplay' });

    if (this.showTrueRatings) {
      columns.push(...this.getTrueRatingColumns());
      columns.push(...this.getEstimatedRatingColumns());
      if (this.showProspects) {
        columns.push(...this.getTfrComponentColumns());
      }
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

  private async withDerivedPitchingFields(pitchingStats: TruePlayerStats[]): Promise<PitcherRow[]> {
    // Get league FIP constant for accurate FIP calculation
    let fipConstant = 3.47; // Default fallback
    try {
      const leagueStats = await leagueStatsService.getLeagueStats(this.selectedYear);
      fipConstant = leagueStats.fipConstant;
    } catch (error) {
      console.warn(`Could not load league stats for ${this.selectedYear}, using default FIP constant`);
    }

    return pitchingStats.map(stat => {
      const outs = this.parseIpToOuts(stat.ip);
      const innings = outs / 3;
      const kPer9 = this.calculatePer9(stat.k, innings);
      const bbPer9 = this.calculatePer9(stat.bb, innings);
      const hraPer9 = this.calculatePer9(stat.hra, innings);

      // Calculate FIP from rate stats
      const fip = fipWarService.calculateFip({ ip: innings, k9: kPer9, bb9: bbPer9, hr9: hraPer9 }, fipConstant);

      return {
        ...stat,
        ipOuts: outs,
        kPer9,
        bbPer9,
        hraPer9,
        fip,
        hasStats: true,
      };
    });
  }

  private async getPitcherStatsWithRosterFallback(): Promise<{ rows: PitcherRow[]; hasStats: boolean }> {
    let pitchingStats: TruePlayerStats[] = [];
    try {
      pitchingStats = await trueRatingsService.getTruePitchingStats(this.selectedYear);
    } catch (error) {
      console.warn(`Pitching stats unavailable for ${this.selectedYear}, falling back to roster.`, error);
    }

    if (pitchingStats.length === 0) {
      const roster = await this.getActiveMlbRoster(false);
      const pitchers = roster.filter(isPitcher);
      return { rows: this.buildPitcherRowsFromRoster(pitchers), hasStats: false };
    }

    return { rows: await this.withDerivedPitchingFields(pitchingStats), hasStats: true };
  }

  private async getBatterStatsWithRosterFallback(): Promise<{ rows: BatterRow[]; hasStats: boolean }> {
    let battingStats: TruePlayerBattingStats[] = [];
    try {
      battingStats = await trueRatingsService.getTrueBattingStats(this.selectedYear);
    } catch (error) {
      console.warn(`Batting stats unavailable for ${this.selectedYear}, falling back to roster.`, error);
    }

    if (battingStats.length === 0) {
      const roster = await this.getActiveMlbRoster(false);
      const batters = roster.filter(player => !isPitcher(player));
      return { rows: this.buildBatterRowsFromRoster(batters), hasStats: false };
    }

    return {
      rows: battingStats.map(stat => ({ ...stat, hasStats: true })) as BatterRow[],
      hasStats: true,
    };
  }

  private async getActiveMlbRoster(forceRefresh: boolean): Promise<Player[]> {
    const players = await playerService.getAllPlayers(forceRefresh);
    return players.filter(player => !player.retired && player.parentTeamId === 0);
  }

  private buildPitcherRowsFromRoster(players: Player[]): PitcherRow[] {
    return players.map(player => {
      const base: TruePlayerStats = {
        id: 0,
        player_id: player.id,
        year: this.selectedYear,
        team_id: player.teamId,
        game_id: 0,
        league_id: 0,
        level_id: player.level,
        split_id: 1,
        ip: '0.0',
        ab: 0,
        tb: 0,
        ha: 0,
        k: 0,
        bf: 0,
        rs: 0,
        bb: 0,
        r: 0,
        er: 0,
        gb: 0,
        fb: 0,
        pi: 0,
        ipf: 0,
        g: 0,
        gs: 0,
        w: 0,
        l: 0,
        s: 0,
        sa: 0,
        da: 0,
        sh: 0,
        sf: 0,
        ta: 0,
        hra: 0,
        bk: 0,
        ci: 0,
        iw: 0,
        wp: 0,
        hp: 0,
        gf: 0,
        dp: 0,
        qs: 0,
        svo: 0,
        bs: 0,
        ra: 0,
        cg: 0,
        sho: 0,
        sb: 0,
        cs: 0,
        hld: 0,
        ir: 0,
        irs: 0,
        wpa: 0,
        li: 0,
        stint: 0,
        outs: 0,
        sd: 0,
        md: 0,
        war: 0,
        ra9war: 0,
        playerName: getFullName(player),
        position: player.position,
      };

      return {
        ...base,
        ipOuts: 0,
        kPer9: 0,
        bbPer9: 0,
        hraPer9: 0,
        fip: 0,
        hasStats: false,
      };
    });
  }

  private buildBatterRowsFromRoster(players: Player[]): BatterRow[] {
    return players.map(player => {
      const base: TruePlayerBattingStats = {
        id: 0,
        player_id: player.id,
        year: this.selectedYear,
        team_id: player.teamId,
        game_id: 0,
        league_id: 0,
        level_id: player.level,
        split_id: 1,
        position: player.position,
        ab: 0,
        h: 0,
        k: 0,
        pa: 0,
        pitches_seen: 0,
        g: 0,
        gs: 0,
        d: 0,
        t: 0,
        hr: 0,
        r: 0,
        rbi: 0,
        sb: 0,
        cs: 0,
        bb: 0,
        ibb: 0,
        gdp: 0,
        sh: 0,
        sf: 0,
        hp: 0,
        ci: 0,
        wpa: 0,
        stint: 0,
        ubr: 0,
        war: 0,
        avg: 0,
        obp: 0,
        playerName: getFullName(player),
      };

      return {
        ...base,
        hasStats: false,
      };
    });
  }

  private async buildTrueRatingsStats(pitchers: PitcherRow[]): Promise<PitcherRow[]> {
    // Determine if we should use dynamic season weighting
    const currentYear = await dateService.getCurrentYear();
    const isCurrentYear = this.selectedYear === currentYear;

    // Get dynamic year weights if viewing current year, otherwise use standard weights
    let yearWeights: number[] | undefined;
    if (isCurrentYear) {
      const stage = await dateService.getSeasonStage();
      yearWeights = getYearWeights(stage);
    }

    const [multiYearStats, leagueAverages] = await Promise.all([
      trueRatingsService.getMultiYearPitchingStats(this.selectedYear),
      trueRatingsService.getLeagueAverages(this.selectedYear),
    ]);
    // Store league averages for passing to modal (ensures consistent recalculation)
    // leagueAverages used by TR calculation above
    const scoutingLookup = this.buildScoutingLookup(this.scoutingRatings);
    const scoutingMatchMap = new Map<number, PitcherScoutingRatings>();

    const inputs: Array<{ playerId: number; playerName: string; yearlyStats: YearlyPitchingStats[]; scoutingRatings?: PitcherScoutingRatings; role?: PitcherRole }> = [];
    const pitchersWithStats: PitcherRow[] = [];

    // Get all players for role determination
    const allPlayers = await playerService.getAllPlayers();
    const playerMap = new Map(allPlayers.map(p => [p.id, p]));

    pitchers.forEach((pitcher) => {
      const scouting = this.resolveScoutingRating(pitcher, scoutingLookup);
      if (scouting) {
        scoutingMatchMap.set(pitcher.player_id, scouting);
      }
      const yearlyStats = multiYearStats.get(pitcher.player_id) ?? [];
      if (yearlyStats.length === 0) {
        return;
      }

      // Minimum IP threshold: Don't calculate TR for pitchers with <50 total IP
      // These players should appear as prospects with TFR, not in MLB table with TR
      // 50 IP aligns with the TFR calculation threshold for young players
      const totalIp = yearlyStats.reduce((sum, stat) => sum + stat.ip, 0);
      if (totalIp < 50) {
        return;
      }

      // Determine pitcher role from scouting data and player attributes
      const player = playerMap.get(pitcher.player_id);
      const role = this.determinePitcherRoleFromAttributes(scouting, player, pitcher);

      inputs.push({
        playerId: pitcher.player_id,
        playerName: pitcher.playerName,
        yearlyStats,
        scoutingRatings: scouting,
        role,
      });
      pitchersWithStats.push(pitcher);
    });

    const results = trueRatingsCalculationService.calculateTrueRatings(inputs, leagueAverages, yearWeights);
    const resultMap = new Map(results.map(result => [result.playerId, result]));

    const enrichedPitchers: PitcherRow[] = pitchersWithStats.map((pitcher) => {
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
        role: result.role,
      };
    });

    // Find prospects (scouting entries without MLB stats)
    const mlbPlayerIds = new Set(pitchersWithStats.map(p => p.player_id));
    const prospects = await this.buildProspectRows(mlbPlayerIds);

    // Merge MLB pitchers with prospects
    const allPitchers = [...enrichedPitchers, ...prospects];

    // Build player row lookup for modal access
    this.playerRowLookup = new Map(allPitchers.map(p => [p.player_id, p]));

    return allPitchers;
  }

  /**
   * Build True Ratings stats for hitters.
   * Uses multi-year batting stats and optional hitter scouting data.
   */
  private async buildHitterTrueRatingsStats(batters: BatterRow[]): Promise<BatterRow[]> {
    // Determine if we should use dynamic season weighting
    const currentYear = await dateService.getCurrentYear();
    const isCurrentYear = this.selectedYear === currentYear;

    // Get dynamic year weights if viewing current year
    let yearWeights: number[] | undefined;
    if (isCurrentYear) {
      const stage = await dateService.getSeasonStage();
      yearWeights = getHitterYearWeights(stage);
    }

    // Fetch multi-year batting stats
    const multiYearStats = await trueRatingsService.getMultiYearBattingStats(this.selectedYear);

    // Build hitter scouting lookup
    this.hitterScoutingLookup = this.buildHitterScoutingLookup(this.hitterScoutingRatings);

    // Build inputs for True Rating calculation
    const inputs: Array<{
      playerId: number;
      playerName: string;
      yearlyStats: YearlyHittingStats[];
      scoutingRatings?: HitterScoutingRatings;
    }> = [];
    const battersWithStats: BatterRow[] = [];

    batters.forEach((batter) => {
      const scouting = this.resolveHitterScoutingRating(batter, this.hitterScoutingLookup!);
      const yearlyStats = multiYearStats.get(batter.player_id) ?? [];

      if (yearlyStats.length === 0) {
        return;
      }

      // Minimum PA threshold: Don't calculate TR for batters with <100 total PA
      const totalPa = yearlyStats.reduce((sum, stat) => sum + stat.pa, 0);
      if (totalPa < 100) {
        return;
      }

      inputs.push({
        playerId: batter.player_id,
        playerName: batter.playerName,
        yearlyStats,
        scoutingRatings: scouting,
      });
      battersWithStats.push(batter);
    });

    // Calculate True Ratings (pass league batting averages for WAR-based ranking)
    const leagueAverages = hitterTrueRatingsCalculationService.getDefaultLeagueAverages();
    const results = hitterTrueRatingsCalculationService.calculateTrueRatings(inputs, leagueAverages, yearWeights, this.cachedLeagueBattingAverages ?? undefined);
    const resultMap = new Map(results.map(result => [result.playerId, result]));

    // Enrich batter rows with True Rating data
    const enrichedBatters: BatterRow[] = battersWithStats.map((batter) => {
      const result = resultMap.get(batter.player_id);
      if (!result) return batter;

      return {
        ...batter,
        trueRating: result.trueRating,
        percentile: result.percentile,
        woba: result.woba,
        blendedBbPct: result.blendedBbPct,
        blendedKPct: result.blendedKPct,
        blendedHrPct: result.blendedHrPct,
        blendedIso: result.blendedIso,
        blendedAvg: result.blendedAvg,
        blendedDoublesRate: result.blendedDoublesRate,
        blendedTriplesRate: result.blendedTriplesRate,
        estimatedPower: result.estimatedPower,
        estimatedEye: result.estimatedEye,
        estimatedAvoidK: result.estimatedAvoidK,
        estimatedContact: result.estimatedContact,
        estimatedGap: result.estimatedGap,
        estimatedSpeed: result.estimatedSpeed,
        totalPa: result.totalPa,
      };
    });

    // Find batter prospects (scouting entries without MLB stats)
    const mlbPlayerIds = new Set(battersWithStats.map(b => b.player_id));
    const prospects = await this.buildBatterProspectRows(mlbPlayerIds);

    // Merge MLB batters with prospects
    const allBatters = [...enrichedBatters, ...prospects];

    // Build batter row lookup for modal access (used for PlayerProfileModal)
    this._batterRowLookup = new Map(allBatters.map(b => [b.player_id, b]));

    return allBatters;
  }

  private buildHitterScoutingLookup(ratings: HitterScoutingRatings[]): HitterScoutingLookup {
    const byId = new Map<number, HitterScoutingRatings>();
    const byName = new Map<string, HitterScoutingRatings[]>();

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

  private resolveHitterScoutingRating(
    batter: BatterRow,
    lookup: HitterScoutingLookup
  ): HitterScoutingRatings | undefined {
    // Try by ID first
    const byId = lookup.byId.get(batter.player_id);
    if (byId) return byId;

    // Try by name
    const normalized = this.normalizeName(batter.playerName);
    const byName = lookup.byName.get(normalized);
    if (byName && byName.length === 1) return byName[0];

    return undefined;
  }

  /**
   * Build batter prospect rows for hitters with scouting data but no MLB stats.
   * Mirrors buildProspectRows() (pitcher version) for batters.
   */
  private async buildBatterProspectRows(
    mlbPlayerIds: Set<number>
  ): Promise<BatterRow[]> {
    // Use getUnifiedHitterTfrData() for expanded TFR pool (includes young MLB players)
    // Then filter to farm-eligible for the prospect table rows
    const unifiedData = await teamRatingsService.getUnifiedHitterTfrData(this.selectedYear);
    this._cachedUnifiedHitterTfrData = unifiedData;
    // Farm-eligible subset for prospect table rows
    const hitterFarmData: HitterFarmData = {
        reports: unifiedData.reports,
        systems: unifiedData.systems,
        prospects: unifiedData.prospects.filter(p => p.isFarmEligible),
    };

    // Filter to prospects not shown in the MLB table
    const farmProspects = hitterFarmData.prospects.filter(p => !mlbPlayerIds.has(p.playerId));

    if (farmProspects.length === 0) {
      return [];
    }

    // Batch fetch minor league batting stats for current season display
    const allMinorBattingStats = await minorLeagueBattingStatsService.getAllPlayerStatsBatch(
      this.selectedYear - 2,
      this.selectedYear
    );

    // Fetch player/team data for prospect rows
    const [allPlayers, allTeams, allContracts] = await Promise.all([
      playerService.getAllPlayers(),
      teamService.getAllTeams(),
      contractService.getAllContracts()
    ]);
    const playerMap = new Map(allPlayers.map(p => [p.id, p]));
    const teamMap = new Map(allTeams.map(t => [t.id, t]));

    // Build prospect rows
    const prospectRows: BatterRow[] = [];

    for (const farmProspect of farmProspects) {
      const player = playerMap.get(farmProspect.playerId);
      let teamDisplay = '';
      let teamFilter = '';
      let teamIsMajor = false;

      // Determine highest minor league level for current season
      const playerMinorStats = allMinorBattingStats.get(farmProspect.playerId) ?? [];
      const currentSeasonStats = playerMinorStats.filter(s => s.year === this.selectedYear);
      const seasonStats = this.getHighestMinorLeagueBattingStats(currentSeasonStats);

      if (player) {
        const team = teamMap.get(player.teamId);
        if (team) {
          if (player.parentTeamId !== 0) {
            const parent = teamMap.get(player.parentTeamId);
            if (parent) {
              let levelLabel = this.getLevelLabelFromId(player.level) || (seasonStats?.level.toUpperCase() ?? '');

              if (!levelLabel) {
                 const contract = allContracts.get(player.id);
                 if (contract && contract.leagueId === -200) {
                     levelLabel = 'IC';
                 }
              }

              teamDisplay = levelLabel ? `${parent.nickname} <span class="league-level">(${levelLabel})</span>` : parent.nickname;
              teamFilter = parent.nickname;
            }
          } else {
            // Check if this is an IC player via contract
            const contract = allContracts.get(player.id);
            if (contract && contract.leagueId === -200) {
              teamDisplay = `${team.nickname} <span class="league-level">(IC)</span>`;
              teamFilter = team.nickname;
            } else {
              teamDisplay = team.nickname;
              teamFilter = team.nickname;
              teamIsMajor = true;
            }
          }
        }
      }

      const scoutOverall = farmProspect.scoutingRatings.ovr;
      const prospectHasStats = Boolean(seasonStats);

      // Create a prospect row using farm data TFR values (single source of truth)
      const prospectRow = {
        // Required TruePlayerBattingStats fields (placeholders)
        player_id: farmProspect.playerId,
        playerName: farmProspect.name,
        id: 0,
        year: this.selectedYear,
        team_id: player?.teamId ?? 0,
        game_id: 0,
        league_id: 0,
        level_id: player?.level ?? 0,
        split_id: 0,
        position: farmProspect.position ?? player?.position ?? 0,
        ab: seasonStats?.ab ?? 0,
        h: seasonStats?.h ?? 0,
        k: seasonStats?.k ?? 0,
        pa: seasonStats?.pa ?? 0,
        pitches_seen: 0,
        g: 0,
        gs: 0,
        d: seasonStats?.d ?? 0,
        t: seasonStats?.t ?? 0,
        hr: seasonStats?.hr ?? 0,
        r: 0,
        rbi: 0,
        sb: seasonStats?.sb ?? 0,
        cs: 0,
        bb: seasonStats?.bb ?? 0,
        ibb: 0,
        gdp: 0,
        sh: 0,
        sf: 0,
        hp: 0,
        ci: 0,
        wpa: 0,
        stint: 0,
        ubr: 0,
        war: 0,
        avg: seasonStats?.avg ?? 0,
        obp: seasonStats?.obp ?? 0,
        // Age
        age: farmProspect.age,
        // Team info
        teamDisplay,
        teamFilter,
        teamIsMajor,
        // Hitter True Rating fields - from farm data (single source of truth)
        trueFutureRating: farmProspect.trueFutureRating,
        tfrPercentile: farmProspect.percentile,
        tfrContact: farmProspect.trueRatings.contact,
        tfrPower: farmProspect.trueRatings.power,
        tfrEye: farmProspect.trueRatings.eye,
        estimatedPower: farmProspect.developmentTR?.power ?? farmProspect.trueRatings.power,
        estimatedEye: farmProspect.developmentTR?.eye ?? farmProspect.trueRatings.eye,
        estimatedAvoidK: farmProspect.developmentTR?.avoidK ?? farmProspect.trueRatings.avoidK,
        estimatedContact: farmProspect.developmentTR?.contact ?? farmProspect.trueRatings.contact,
        estimatedGap: farmProspect.developmentTR?.gap ?? farmProspect.trueRatings.gap,
        estimatedSpeed: farmProspect.developmentTR?.speed ?? farmProspect.trueRatings.speed,
        woba: farmProspect.projWoba,
        isProspect: true,
        starGap: Math.max(0, (farmProspect.scoutingRatings.pot ?? scoutOverall) - scoutOverall),
        prospectHasStats,
        prospectLevel: seasonStats?.level,
        hasStats: false,
      } as unknown as BatterRow;

      prospectRows.push(prospectRow);
    }

    return prospectRows;
  }

  private getHighestMinorLeagueBattingStats(
    stats: MinorLeagueBattingStatsWithLevel[]
  ): MinorLeagueBattingStatsWithLevel | null {
    if (stats.length === 0) return null;
    const levelRank: Record<MinorLeagueBattingStatsWithLevel['level'], number> = {
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

  /**
   * Build prospect rows for players with scouting data but no MLB stats.
   * These rows will have isProspect=true and show TFR instead of TR.
   */
  private async buildProspectRows(
    mlbPlayerIds: Set<number>
  ): Promise<PitcherRow[]> {
    // Use getFarmData() as the single source of truth for TFR calculations
    // This ensures TFR values match across True Ratings table, Farm Rankings, and modal
    const pitcherFarmData = await teamRatingsService.getFarmData(this.selectedYear);
    this._cachedPitcherFarmData = pitcherFarmData;

    // Filter to prospects not shown in the MLB table
    const farmProspects = pitcherFarmData.prospects.filter(p => !mlbPlayerIds.has(p.playerId));

    if (farmProspects.length === 0) {
      return [];
    }

    // Batch fetch minor league stats for current season display
    const allMinorStats = await minorLeagueStatsService.getAllPlayerStatsBatch(
      this.selectedYear - 2,
      this.selectedYear
    );

    // Fetch player/team data for prospect rows
    const [allPlayers, allTeams, allContracts] = await Promise.all([
      playerService.getAllPlayers(),
      teamService.getAllTeams(),
      contractService.getAllContracts()
    ]);
    const playerMap = new Map(allPlayers.map(p => [p.id, p]));
    const teamMap = new Map(allTeams.map(t => [t.id, t]));

    // Also load scouting data for role determination and scoutOverall
    const scoutingMap = new Map(this.scoutingRatings.map(s => [s.playerId, s]));

    // Build prospect rows
    const prospectRows: PitcherRow[] = [];

    for (const farmProspect of farmProspects) {
      const player = playerMap.get(farmProspect.playerId);
      const scouting = scoutingMap.get(farmProspect.playerId);
      let teamDisplay = '';
      let teamFilter = '';
      let teamIsMajor = false;

      // Use already-fetched batch data for current season display stats
      const playerMinorStats = allMinorStats.get(farmProspect.playerId) ?? [];
      const currentSeasonStats = playerMinorStats.filter(s => s.year === this.selectedYear);
      const seasonStats = this.getHighestMinorLeagueStats(currentSeasonStats);

      if (player) {
        const team = teamMap.get(player.teamId);
        if (team) {
          if (player.parentTeamId !== 0) {
            const parent = teamMap.get(player.parentTeamId);
            if (parent) {
              let levelLabel = this.getLevelLabelFromId(player.level);

              if (!levelLabel) {
                 const contract = allContracts.get(player.id);
                 if (contract && contract.leagueId === -200) {
                     levelLabel = 'IC';
                 }
              }

              teamDisplay = levelLabel ? `${parent.nickname} <span class="league-level">(${levelLabel})</span>` : parent.nickname;
              teamFilter = parent.nickname;
            }
          } else {
            // Check if this is an IC player via contract
            const contract = allContracts.get(player.id);
            if (contract && contract.leagueId === -200) {
              teamDisplay = `${team.nickname} <span class="league-level">(IC)</span>`;
              teamFilter = team.nickname;
            } else {
              teamDisplay = team.nickname;
              teamFilter = team.nickname;
              teamIsMajor = true;
            }
          }
        }
      }

      const scoutOverall = scouting
        ? this.averageRating(scouting.stuff, scouting.control, scouting.hra)
        : this.averageRating(farmProspect.scoutingRatings.stuff, farmProspect.scoutingRatings.control, farmProspect.scoutingRatings.hra);
      const prospectHasStats = Boolean(seasonStats);
      const prospectIp = seasonStats?.ip ?? 0;
      const prospectOuts = prospectHasStats ? this.parseIpToOuts(prospectIp) : 0;
      const prospectK = seasonStats?.k ?? 0;
      const prospectBb = seasonStats?.bb ?? 0;
      const prospectHr = seasonStats?.hr ?? 0;
      const prospectK9 = seasonStats?.k9 ?? (prospectIp > 0 ? (prospectK / prospectIp) * 9 : 0);
      const prospectBb9 = seasonStats?.bb9 ?? (prospectIp > 0 ? (prospectBb / prospectIp) * 9 : 0);
      const prospectHr9 = seasonStats?.hr9 ?? (prospectIp > 0 ? (prospectHr / prospectIp) * 9 : 0);

      // Determine role for prospect
      const prospectRole = determinePitcherRole({
        pitchRatings: scouting?.pitches,
        stamina: scouting?.stamina ?? farmProspect.scoutingRatings.stamina,
        ootpRole: player?.role,
        inningsPitched: prospectIp,
      });

      // Use development-curve-based TR (precomputed), falling back to TFR true ratings
      const estimatedStuff = farmProspect.developmentTR?.stuff
        ?? farmProspect.trueRatings?.stuff
        ?? Math.round(20 + ((Math.max(3.0, Math.min(11.0, farmProspect.projK9 ?? 0)) - 3.0) / (11.0 - 3.0)) * 60);
      const estimatedControl = farmProspect.developmentTR?.control
        ?? farmProspect.trueRatings?.control
        ?? Math.round(20 + ((7.0 - Math.max(0.85, Math.min(7.0, farmProspect.projBb9 ?? 0))) / (7.0 - 0.85)) * 60);
      const estimatedHra = farmProspect.developmentTR?.hra
        ?? farmProspect.trueRatings?.hra
        ?? Math.round(20 + ((2.5 - Math.max(0.20, Math.min(2.5, farmProspect.projHr9 ?? 0))) / (2.5 - 0.20)) * 60);

      // Create a prospect row using farm data TFR values (single source of truth)
      const prospectRow = {
        // Required TruePlayerStats fields (will show as "-")
        player_id: farmProspect.playerId,
        playerName: farmProspect.name,
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
        position: 1,
        // Derived fields
        ipOuts: prospectOuts,
        kPer9: prospectK9,
        bbPer9: prospectBb9,
        hraPer9: prospectHr9,
        fip: prospectHasStats ? fipWarService.calculateFip({ ip: prospectIp, k9: prospectK9, bb9: prospectBb9, hr9: prospectHr9 }, 3.47) : 0,
        // Age
        age: farmProspect.age,
        // Team info
        teamDisplay,
        teamFilter,
        teamIsMajor,
        // True Ratings fields - from farm data (single source of truth)
        trueFutureRating: farmProspect.trueFutureRating,
        tfrPercentile: farmProspect.percentile,
        tfrStuff: farmProspect.trueRatings?.stuff,
        tfrControl: farmProspect.trueRatings?.control,
        tfrHra: farmProspect.trueRatings?.hra,
        fipLike: farmProspect.peakFip - 3.47,
        estimatedStuff,
        estimatedControl,
        estimatedHra,
        scoutOverall,
        starGap: Math.max(0, ((scouting?.pot ?? scoutOverall) - scoutOverall)),
        isProspect: true,
        prospectHasStats,
        prospectLevel: seasonStats?.level,
        hasStats: prospectHasStats,
        role: prospectRole,
      } as unknown as PitcherRow;

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
    return undefined;
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

    // Always force position to be first if it exists
    if (lookup.has('position')) {
      ordered.push(lookup.get('position')!);
      lookup.delete('position');
    }

    // Always force age to be after name if name is in rawOrder, or just ensure it's not lost
    // Actually, let's just make sure it's included in the ordered list if it's missing from rawOrder
    
    for (const key of rawOrder) {
      if (typeof key !== 'string') continue;
      const column = lookup.get(key);
      if (column) {
        ordered.push(column);
        lookup.delete(key);
      }
    }

    // Add any remaining columns (like the new 'age' column if it wasn't in preferences)
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
      const nameClass = column.key === 'playerName' ? 'name-col' : '';
      return `<th data-sort-key="${sortKey}" data-col-key="${column.key}" class="${activeClass} ${nameClass}" draggable="true">${column.label}</th>`;
    }).join('');

    const rows = stats.map(player => {
      const isProspect = player.isProspect === true;
      const prospectHasStats = Boolean(player.prospectHasStats);
      const hasStats = player.hasStats !== false;
      const cells = this.pitcherColumns.map(column => {
        const rawValue = column.accessor ? column.accessor(player) : (player as any)[column.key];
        const columnKey = String(column.key);
        
        const displayValue = this.formatValue(rawValue, columnKey, player);

        if (isProspect) {
          const prospectAllowedStatKeys = ['ip', 'k', 'bb', 'hra'];
          const prospectUnavailableStatKeys = ['r', 'er', 'war', 'ra9war', 'wpa'];
          if (prospectUnavailableStatKeys.includes(columnKey)) {
            return `<td data-col-key="${column.key}" class="prospect-stat">${MISSING_STAT_DISPLAY}</td>`;
          }
          if (prospectAllowedStatKeys.includes(columnKey) && !prospectHasStats) {
            return `<td data-col-key="${column.key}" class="prospect-stat">${MISSING_STAT_DISPLAY}</td>`;
          }
        }

        if (!isProspect && !hasStats && RAW_PITCHER_STAT_KEYS.has(columnKey)) {
          return `<td data-col-key="${column.key}" class="prospect-stat">${MISSING_STAT_DISPLAY}</td>`;
        }

        if (column.key === 'kPer9' || column.key === 'bbPer9' || column.key === 'hraPer9') {
          if ((isProspect && !prospectHasStats) || (!hasStats && RAW_PITCHER_STAT_KEYS.has(columnKey))) {
            return `<td data-col-key="${column.key}" class="prospect-stat">${MISSING_STAT_DISPLAY}</td>`;
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

        // Make player name clickable regardless of view mode
        if (column.key === 'playerName') {
          const prospectBadge = isProspect ? ' <span class="prospect-badge">P</span>' : '';
          const tooltip = `Player ID: ${player.player_id}`;
          return `<td data-col-key="${column.key}" class="name-col"><button class="btn-link player-name-link" data-player-id="${player.player_id}" title="${tooltip}">${displayValue}${prospectBadge}</button></td>`;
        }

        // Add rating bars for True Rating columns
        if (column.key === 'estimatedStuff' || column.key === 'estimatedControl' || column.key === 'estimatedHra') {
          const ratingValue = rawValue;
          if (typeof ratingValue === 'number' && !isNaN(ratingValue)) {
            const barType = column.key === 'estimatedStuff' ? 'stuff' :
                           column.key === 'estimatedControl' ? 'control' : 'hra';

            // 20-80 scale
            const percentage = Math.min(Math.max((ratingValue - 20) / 60 * 100, 0), 100);

            const highValueClass = ratingValue >= 65 ? 'high-value' : '';
            return `<td data-col-key="${column.key}">
              <div class="rating-with-bar">
                <div class="rating-bar">
                  <div class="rating-bar-fill ${barType} ${highValueClass} animate-fill" style="--bar-width: ${percentage}%"></div>
                </div>
                <span class="rating-value ${barType}">${displayValue}</span>
              </div>
            </td>`;
          }
        }

        // Add rating bars for TFR component columns (only populated for prospects)
        if (column.key === 'tfrStuff' || column.key === 'tfrControl' || column.key === 'tfrHra') {
          const ratingValue = rawValue;
          if (typeof ratingValue === 'number' && !isNaN(ratingValue)) {
            const barType = column.key === 'tfrStuff' ? 'stuff' :
                           column.key === 'tfrControl' ? 'control' : 'hra';
            const percentage = Math.min(Math.max((ratingValue - 20) / 60 * 100, 0), 100);
            const highValueClass = ratingValue >= 65 ? 'high-value' : '';
            return `<td data-col-key="${column.key}">
              <div class="rating-with-bar">
                <div class="rating-bar">
                  <div class="rating-bar-fill ${barType} ${highValueClass} animate-fill" style="--bar-width: ${percentage}%"></div>
                </div>
                <span class="rating-value ${barType}">${displayValue}</span>
              </div>
            </td>`;
          }
          return `<td data-col-key="${column.key}"></td>`;
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

    this.bindFlipTooltipPositioning();
  }

  private bindFlipTooltipPositioning(): void {
    const flipCells = this.container.querySelectorAll<HTMLElement>('.flip-cell');

    flipCells.forEach((cell) => {
      cell.addEventListener('mouseenter', () => {
        // Check if this cell is in the first tbody row
        const row = cell.closest('tr');
        if (!row) return;

        const tbody = row.closest('tbody');
        if (!tbody) return;

        const firstRow = tbody.querySelector('tr');
        if (row === firstRow) {
          cell.classList.add('tooltip-below');
        } else {
          cell.classList.remove('tooltip-below');
        }
      });

      cell.addEventListener('mouseleave', () => {
        cell.classList.remove('tooltip-below');
      });
    });
  }

  private renderBattersTable(stats: BatterRow[]): string {
    // Define columns based on view mode
    const columns: BatterColumn[] = this.getBatterColumnsForView();

    const headerRow = columns.map(col => {
      const activeClass = this.sortKey === (col.sortKey ?? col.key) ? 'sort-active' : '';
      const nameClass = col.key === 'playerName' ? 'name-col' : '';
      return `<th data-sort-key="${col.sortKey ?? col.key}" data-col-key="${col.key}" class="${activeClass} ${nameClass}">${col.label}</th>`;
    }).join('');

    const rows = stats.map(s => {
      const isProspect = Boolean(s.isProspect);
      const hasStats = s.hasStats !== false;
      const cells = columns.map(col => {
        const key = col.key as string;
        const nameColClass = key === 'playerName' ? ' class="name-col"' : '';

        // Use accessor if provided
        if (col.accessor) {
          return `<td data-col-key="${key}"${nameColClass}>${col.accessor(s)}</td>`;
        }

        // Handle missing stats for prospects
        if (isProspect && key !== 'playerName' && key !== 'teamDisplay' && key !== 'position' && key !== 'age'
            && key !== 'trueRating' && key !== 'percentile' && key !== 'estimatedPower'
            && key !== 'estimatedEye' && key !== 'estimatedAvoidK' && key !== 'estimatedContact'
            && key !== 'tfrContact' && key !== 'tfrPower' && key !== 'tfrEye') {
          return `<td data-col-key="${key}" class="prospect-stat">${MISSING_STAT_DISPLAY}</td>`;
        }

        // Handle missing stats for non-prospects without stats
        if (!hasStats && !isProspect && key !== 'playerName' && key !== 'teamDisplay' && key !== 'position' && key !== 'age') {
          return `<td data-col-key="${key}" class="prospect-stat">${MISSING_STAT_DISPLAY}</td>`;
        }

        const value: any = (s as any)[key];
        if (key === 'playerName') {
          return `<td data-col-key="${key}" class="name-col" title="Player ID: ${s.player_id}">${this.formatBatterValue(value, key, s)}</td>`;
        }

        // Add rating bars for TFR component columns (batter prospects)
        if (key === 'tfrContact' || key === 'tfrPower' || key === 'tfrEye') {
          const ratingValue = value;
          if (typeof ratingValue === 'number' && !isNaN(ratingValue)) {
            const barType = key === 'tfrContact' ? 'contact' :
                           key === 'tfrPower' ? 'power' : 'eye';
            const percentage = Math.min(Math.max((ratingValue - 20) / 60 * 100, 0), 100);
            const highValueClass = ratingValue >= 65 ? 'high-value' : '';
            const displayValue = this.formatBatterValue(value, key, s);
            return `<td data-col-key="${key}">
              <div class="rating-with-bar">
                <div class="rating-bar">
                  <div class="rating-bar-fill ${barType} ${highValueClass} animate-fill" style="--bar-width: ${percentage}%"></div>
                </div>
                <span class="rating-value ${barType}">${displayValue}</span>
              </div>
            </td>`;
          }
          return `<td data-col-key="${key}"></td>`;
        }

        // Add rating bars for True Rating columns
        if (key === 'estimatedContact' || key === 'estimatedPower' || key === 'estimatedEye' || key === 'estimatedAvoidK') {
          const ratingValue = value;
          if (typeof ratingValue === 'number' && !isNaN(ratingValue)) {
            const barType = key === 'estimatedContact' ? 'contact' :
                           key === 'estimatedPower' ? 'power' :
                           key === 'estimatedEye' ? 'eye' : 'avoidk';

            // 20-80 scale
            const percentage = Math.min(Math.max((ratingValue - 20) / 60 * 100, 0), 100);

            const highValueClass = ratingValue >= 65 ? 'high-value' : '';
            const displayValue = this.formatBatterValue(value, key, s);
            return `<td data-col-key="${key}">
              <div class="rating-with-bar">
                <div class="rating-bar">
                  <div class="rating-bar-fill ${barType} ${highValueClass} animate-fill" style="--bar-width: ${percentage}%"></div>
                </div>
                <span class="rating-value ${barType}">${displayValue}</span>
              </div>
            </td>`;
          }
        }

        return `<td data-col-key="${key}">${this.formatBatterValue(value, key, s)}</td>`;
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

  private getBatterColumnsForView(): BatterColumn[] {
    const baseColumns: BatterColumn[] = [
      {
        key: 'position',
        label: 'Pos',
        sortKey: 'position',
        accessor: (row) => this.renderBatterPositionBadge(row)
      },
      {
        key: 'playerName',
        label: 'Name',
        sortKey: 'playerName',
        accessor: (row) => {
          const prospectBadge = row.isProspect ? ' <span class="prospect-badge">P</span>' : '';
          return `<button class="btn-link player-name-link" data-player-id="${row.player_id}" title="Player ID: ${row.player_id}">${row.playerName}${prospectBadge}</button>`;
        }
      },
      { key: 'age', label: 'Age', sortKey: 'age' },
      { key: 'teamDisplay', label: 'Team', sortKey: 'teamDisplay' },
    ];

    // Show True Ratings columns when showTrueRatings is on (mutually exclusive with showRawStats)
    if (this.showTrueRatings) {
      // True Ratings columns for hitters
      const trueRatingColumns: BatterColumn[] = [
        {
          key: 'trueRating',
          label: 'TR',
          sortKey: 'percentile', // Sort by percentile, not TR value
          accessor: (row) => {
            // For prospects, show TFR instead of TR
            if (row.isProspect) {
              return this.renderTrueFutureRatingBadge(row.trueFutureRating);
            }
            return this.renderHitterTrueRatingBadge(row.trueRating);
          },
        },
        { key: 'estimatedContact', label: 'True Contact', sortKey: 'estimatedContact' },
        { key: 'estimatedPower', label: 'True Pow', sortKey: 'estimatedPower' },
        { key: 'estimatedEye', label: 'True Eye', sortKey: 'estimatedEye' },
      ];

      const columns = [...baseColumns, ...trueRatingColumns];

      // Add TFR component columns when prospects are visible
      if (this.showProspects) {
        columns.push(
          { key: 'tfrContact', label: 'Future Contact', sortKey: 'tfrContact' },
          { key: 'tfrPower', label: 'Future Pow', sortKey: 'tfrPower' },
          { key: 'tfrEye', label: 'Future Eye', sortKey: 'tfrEye' },
        );
      }

      return columns;
    }

    // Raw stats mode (no True Ratings)
    const rawColumns: BatterColumn[] = [
      {
        key: 'trueRating',
        label: 'TR',
        sortKey: 'percentile', // Sort by percentile, not TR value
        accessor: (row) => {
          if (row.isProspect) {
            return this.renderTrueFutureRatingBadge(row.trueFutureRating);
          }
          return this.renderHitterTrueRatingBadge(row.trueRating);
        },
      },
      { key: 'pa', label: 'PA', sortKey: 'pa' },
      {
        key: 'avg',
        label: 'AVG',
        sortKey: 'avg',
        accessor: (row) => typeof row.avg === 'number' ? row.avg.toFixed(3) : ''
      },
      {
        key: 'obp',
        label: 'OBP',
        sortKey: 'obp',
        accessor: (row) => typeof row.obp === 'number' ? row.obp.toFixed(3) : ''
      },
      { key: 'hr', label: 'HR', sortKey: 'hr' },
      {
        key: 'hrPct',
        label: 'HR%',
        sortKey: 'hr',
        accessor: (row) => {
          if (typeof row.hr === 'number' && typeof row.pa === 'number' && row.pa > 0) {
            return ((row.hr / row.pa) * 100).toFixed(1);
          }
          return '';
        }
      },
      { key: 'bb', label: 'BB', sortKey: 'bb' },
      {
        key: 'bbPct',
        label: 'BB%',
        sortKey: 'bb',
        accessor: (row) => {
          if (typeof row.bb === 'number' && typeof row.pa === 'number' && row.pa > 0) {
            return ((row.bb / row.pa) * 100).toFixed(1);
          }
          return '';
        }
      },
      { key: 'k', label: 'K', sortKey: 'k' },
      {
        key: 'kPct',
        label: 'K%',
        sortKey: 'k',
        accessor: (row) => {
          if (typeof row.k === 'number' && typeof row.pa === 'number' && row.pa > 0) {
            return ((row.k / row.pa) * 100).toFixed(1);
          }
          return '';
        }
      },
      {
        key: 'ops',
        label: 'OPS',
        sortKey: 'ops',
        accessor: (row) => {
          if (typeof row.obp === 'number' && row.ab && row.ab > 0) {
            const singles = (row.h ?? 0) - (row.d ?? 0) - (row.t ?? 0) - (row.hr ?? 0);
            const slg = (singles + 2 * (row.d ?? 0) + 3 * (row.t ?? 0) + 4 * (row.hr ?? 0)) / row.ab;
            const ops = row.obp + slg;
            return ops.toFixed(3);
          }
          return '';
        }
      },
      {
        key: 'opsPlus',
        label: 'OPS+',
        sortKey: 'opsPlus',
        accessor: (row) => {
          // Calculate OPS+ = 100 × (OBP/lgOBP + SLG/lgSLG - 1)
          if (!this.cachedLeagueBattingAverages || typeof row.obp !== 'number' || !row.ab || row.ab <= 0) {
            return '';
          }
          const singles = (row.h ?? 0) - (row.d ?? 0) - (row.t ?? 0) - (row.hr ?? 0);
          const slg = (singles + 2 * (row.d ?? 0) + 3 * (row.t ?? 0) + 4 * (row.hr ?? 0)) / row.ab;
          const opsPlus = leagueBattingAveragesService.calculateOpsPlus(
            row.obp,
            slg,
            this.cachedLeagueBattingAverages
          );
          return Math.round(opsPlus).toString();
        }
      },
      {
        key: 'woba',
        label: 'wOBA',
        sortKey: 'woba',
        accessor: (row) => typeof row.woba === 'number' ? row.woba.toFixed(3) : '',
      },
      {
        key: 'war',
        label: 'WAR',
        sortKey: 'war',
        accessor: (row) => {
          const war = this.calculateOffensiveWar(row);
          return war !== undefined ? war.toFixed(1) : '';
        }
      },
    ];

    return [...baseColumns, ...rawColumns];
  }

  private renderHitterTrueRatingBadge(value?: number): string {
    if (typeof value !== 'number') return '';
    const className = this.getTrueRatingClass(value);
    return `<span class="badge ${className}">${value.toFixed(1)}</span>`;
  }

  private formatBatterValue(value: any, key: string, row?: BatterRow): string {
    if (key === 'position' && row) {
      return getPositionLabel(row.position);
    }
    if (typeof value === 'number') {
      // Clamp estimated ratings for display (20-80 scale)
      if (key === 'estimatedPower' || key === 'estimatedEye' || key === 'estimatedAvoidK' || key === 'estimatedContact'
          || key === 'tfrContact' || key === 'tfrPower' || key === 'tfrEye') {
        const clamped = Math.max(20, Math.min(80, Math.round(value)));
        return clamped.toString();
      }

      if (Number.isInteger(value)) {
        return value.toString();
      }
      const threeDecimalKeys = ['avg', 'obp', 'woba', 'blendedAvg', 'blendedIso'];
      return threeDecimalKeys.includes(key.toLowerCase()) || threeDecimalKeys.includes(key) ? value.toFixed(3) : value.toFixed(2);
    }

    return value ?? '';
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
        this.saveFilterPreferences();
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

  private calculateOffensiveWar(row: any): number | undefined {
    if (!this.cachedLeagueBattingAverages || typeof row.obp !== 'number' || !row.ab || row.ab <= 0 || !row.pa) {
      return undefined;
    }
    const singles = (row.h ?? 0) - (row.d ?? 0) - (row.t ?? 0) - (row.hr ?? 0);
    const slg = (singles + 2 * (row.d ?? 0) + 3 * (row.t ?? 0) + 4 * (row.hr ?? 0)) / row.ab;
    const opsPlus = leagueBattingAveragesService.calculateOpsPlus(row.obp, slg, this.cachedLeagueBattingAverages);
    const runsPerWin = 10;
    const runsAboveAvg = ((opsPlus - 100) / 10) * (row.pa / 600) * 10;
    const replacementRuns = (row.pa / 600) * 20;
    const sbRuns = (row.sb ?? 0) * 0.2 - (row.cs ?? 0) * 0.4;
    return (runsAboveAvg + replacementRuns + sbRuns) / runsPerWin;
  }

  private sortStats(): void {
    if (!this.sortKey) return;
    const key = this.sortKey;

    this.stats.sort((a, b) => {
      let aVal = (a as any)[key];
      let bVal = (b as any)[key];

      // For trueRating sort, use trueFutureRating for prospects (works for both PitcherRow and BatterRow)
      if (key === 'trueRating') {
        const aProspect = (a as any).isProspect;
        const bProspect = (b as any).isProspect;
        if (aProspect) aVal = (a as any).trueFutureRating;
        if (bProspect) bVal = (b as any).trueFutureRating;
      }

      // For percentile sort, use tfrPercentile for prospects (works for both PitcherRow and BatterRow)
      if (key === 'percentile') {
        const aProspect = (a as any).isProspect;
        const bProspect = (b as any).isProspect;
        if (aProspect) aVal = (a as any).tfrPercentile;
        if (bProspect) bVal = (b as any).tfrPercentile;
      }

      // For batter WAR sort, use calculated offensive WAR (matches displayed value)
      if (key === 'war' && this.mode === 'batters') {
        aVal = this.calculateOffensiveWar(a) ?? -999;
        bVal = this.calculateOffensiveWar(b) ?? -999;
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
  
  /**
   * Determine pitcher role from player attributes (scouting, stamina, pitches)
   * Uses the centralized determinePitcherRole function from Player model
   */
  private determinePitcherRoleFromAttributes(
    scouting: PitcherScoutingRatings | undefined,
    player: Player | null | undefined,
    pitcher: PitcherRow
  ): PitcherRole {
    const input: PitcherRoleInput = {
      pitchRatings: scouting?.pitches,
      stamina: scouting?.stamina,
      ootpRole: player?.role,
      gamesStarted: pitcher.gs,
      inningsPitched: pitcher.ipOuts ? pitcher.ipOuts / 3 : undefined,
    };

    return determinePitcherRole(input);
  }

  private determinePitcherRoleLabel(row: PitcherRow): 'SP' | 'RP' {
    // If we have gs (Games Started) and ip, use that
    if (typeof row.gs === 'number' && typeof row.ip === 'string') {
      const ip = parseFloat(row.ip);
      if (row.gs >= 5 || (ip > 0 && row.gs / (parseFloat(row.g as any) || 1) > 0.5)) {
        return 'SP';
      }
    }

    // Fallback to role from player model or prospect role determination
    const role = (row as any).role;
    if (role === 'SP' || role === 'SW') return 'SP';
    if (role === 'RP') return 'RP';
    if (role === 11 || role === 12) return 'SP'; // Numeric OOTP role codes

    return 'RP';
  }

  private renderPositionLabel(row: TableRow): string {
    if (this.mode === 'pitchers') {
      return this.renderTierBadge(row as PitcherRow);
    }
    return getPositionLabel((row as BatterRow).position);
  }

  private formatValue(value: any, key: string, row?: TableRow): string {
    if (key === 'position' && row) {
      return this.renderPositionLabel(row);
    }
    if (typeof value === 'number') {
      // Clamp True Ratings for display (20-80 scale)
      // Backend calculations use actual values, UI shows clamped values (matches OOTP)
      if (key === 'estimatedStuff' || key === 'estimatedControl' || key === 'estimatedHra') {
        const clamped = Math.max(20, Math.min(80, Math.round(value)));
        return clamped.toString();
      }

      if (Number.isInteger(value)) {
        return value.toString();
      }
      const threeDecimalKeys = ['avg', 'obp'];
      return threeDecimalKeys.includes(key.toLowerCase()) ? value.toFixed(3) : value.toFixed(2);
    }

    return value ?? '';
  }

  // @ts-ignore - kept for future use
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
    ];
  }

  private getEstimatedRatingColumns(): PitcherColumn[] {
    return [
      { key: 'estimatedStuff', label: 'True Stuff' },
      { key: 'estimatedControl', label: 'True Con' },
      { key: 'estimatedHra', label: 'True HRA' },
    ];
  }

  private getTfrComponentColumns(): PitcherColumn[] {
    return [
      { key: 'tfrStuff', label: 'Future Stuff', sortKey: 'tfrStuff' },
      { key: 'tfrControl', label: 'Future Con', sortKey: 'tfrControl' },
      { key: 'tfrHra', label: 'Future HRA', sortKey: 'tfrHra' },
    ];
  }

  // @ts-ignore - Unused for now, kept for future feature
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

  private renderTierBadge(row: PitcherRow): string {
    // Use role if available (from player attributes), otherwise fall back to IP
    let tier: string;
    let className: string;
    let title: string;

    // Check if row has a role field (from TrueRatingResult)
    const role = (row as any).role;
    if (role === 'SP' || role === 'SW' || role === 'RP') {
      tier = role;
    } else {
      // Fallback to IP-based determination
      const ipOuts = row.ipOuts ?? 0;
      const ip = ipOuts / 3;
      if (ip >= 130) {
        tier = 'SP';
      } else if (ip >= 70) {
        tier = 'SW';
      } else {
        tier = 'RP';
      }
    }

    if (tier === 'SP') {
      className = 'tier-starter';
      title = 'Starter - Percentile ranked vs other starters';
    } else if (tier === 'SW') {
      className = 'tier-swingman';
      title = 'Swingman - Percentile ranked vs other swingmen';
    } else {
      className = 'tier-reliever';
      title = 'Reliever - Percentile ranked vs other relievers';
    }

    return `<span class="badge ${className}" title="${title}">${tier}</span>`;
  }

  private renderBatterPositionBadge(row: BatterRow): string {
    const posLabel = getPositionLabel(row.position);
    let className: string;
    let title: string;

    // Group positions by type for styling
    // Catchers are premium defensive position
    // Middle infielders (SS, 2B) are premium
    // Corner positions (1B, 3B, LF, RF) are standard
    // CF is premium outfield
    // DH is offense-only
    switch (row.position) {
      case 2: // C
        className = 'pos-catcher';
        title = 'Catcher - Premium defensive position';
        break;
      case 6: // SS
        className = 'pos-middle-infield';
        title = 'Shortstop - Premium defensive position';
        break;
      case 4: // 2B
        className = 'pos-middle-infield';
        title = 'Second Base - Premium defensive position';
        break;
      case 8: // CF
        className = 'pos-center-field';
        title = 'Center Field - Premium outfield position';
        break;
      case 5: // 3B
        className = 'pos-corner';
        title = 'Third Base - Corner infield position';
        break;
      case 3: // 1B
        className = 'pos-corner';
        title = 'First Base - Corner infield position';
        break;
      case 7: // LF
      case 9: // RF
        className = 'pos-corner-outfield';
        title = `${posLabel} - Corner outfield position`;
        break;
      case 10: // DH
        className = 'pos-dh';
        title = 'Designated Hitter - Offense only';
        break;
      default:
        className = 'pos-utility';
        title = posLabel;
    }

    return `<span class="badge ${className}" title="${title}">${posLabel}</span>`;
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
    const pageTotal = this.container.querySelector<HTMLElement>('#page-total');
    const pageJumpSelect = this.container.querySelector<HTMLSelectElement>('#page-jump-select');
    const prevButton = this.container.querySelector<HTMLButtonElement>('#prev-page')!;
    const nextButton = this.container.querySelector<HTMLButtonElement>('#next-page')!;

    if (totalPages <= 1) {
      pageInfo.style.display = 'none';
      prevButton.disabled = true;
      nextButton.disabled = true;
      return;
    }

    pageInfo.style.display = '';
    if (pageTotal) {
      pageTotal.textContent = `of ${totalPages}`;
    }

    if (pageJumpSelect) {
      if (pageJumpSelect.options.length !== totalPages) {
        pageJumpSelect.innerHTML = Array.from({ length: totalPages }, (_, index) => {
          const page = index + 1;
          return `<option value="${page}">${page}</option>`;
        }).join('');
      }
      pageJumpSelect.value = String(this.currentPage);
    }

    prevButton.disabled = this.currentPage === 1;
    nextButton.disabled = this.currentPage === totalPages;
  }

  private async loadScoutingRatingsForYear(): Promise<void> {
    const currentYear = this.currentGameYear ?? new Date().getFullYear();
    const useScouting = this.selectedYear >= currentYear;

    if (useScouting) {
      // Fetch merged scouting data for current year (pitchers)
      const fallback = await scoutingDataFallbackService.getScoutingRatingsWithFallback();
      this.scoutingRatings = fallback.ratings;
      this.scoutingMetadata = fallback.metadata;

      // Fetch hitter scouting data
      [this.myHitterScoutingRatings, this.osaHitterScoutingRatings] = await Promise.all([
        hitterScoutingDataService.getLatestScoutingRatings('my'),
        hitterScoutingDataService.getLatestScoutingRatings('osa')
      ]);
      // Merge hitter scouting (my takes priority over osa)
      this.hitterScoutingRatings = this.mergeHitterScoutingData(
        this.myHitterScoutingRatings,
        this.osaHitterScoutingRatings
      );
    } else {
      this.scoutingRatings = [];
      this.scoutingMetadata = null;
      this.hitterScoutingRatings = [];
      this.myHitterScoutingRatings = [];
      this.osaHitterScoutingRatings = [];
    }

    // this.updateScoutingUploadLabel(); // Removed
    this.updatePitcherColumns();
    this.updateScoutingStatus();
  }

  private mergeHitterScoutingData(
    myRatings: HitterScoutingRatings[],
    osaRatings: HitterScoutingRatings[]
  ): HitterScoutingRatings[] {
    const byId = new Map<number, HitterScoutingRatings>();

    // OSA first (lower priority)
    for (const rating of osaRatings) {
      if (rating.playerId > 0) {
        byId.set(rating.playerId, rating);
      }
    }

    // My ratings override OSA
    for (const rating of myRatings) {
      if (rating.playerId > 0) {
        byId.set(rating.playerId, rating);
      }
    }

    return Array.from(byId.values());
  }

  private updateScoutingUploadVisibility(): void {
    const notice = this.container.querySelector<HTMLElement>('#scouting-notice');
    if (!notice) return;

    const currentYear = this.currentGameYear ?? new Date().getFullYear();
    const allowScouting = this.selectedYear >= currentYear;

    if (this.mode === 'pitchers' && allowScouting) {
      if (this.scoutingMetadata) {
        const { hasMyScoutData, fromOSA, fromMyScout } = this.scoutingMetadata;

        if (!hasMyScoutData && fromOSA > 0) {
          // Using OSA fallback
          notice.innerHTML = `
            <span class="banner-icon">ℹ️</span>
            Using OSA scouting data (${fromOSA} players).
            <button class="btn-link" data-tab-target="tab-data-management" type="button">Upload your scout reports</button> for custom scouting.
          `;
          notice.style.display = 'block';
          notice.className = 'info-banner osa-fallback';
        } else if (hasMyScoutData && fromOSA > 0) {
          // Using both sources
          notice.innerHTML = `
            <span class="banner-icon">📊</span>
            ${fromMyScout} players from My Scout, ${fromOSA} from OSA.
          `;
          notice.style.display = 'block';
          notice.className = 'info-banner mixed-sources';
        } else if (!hasMyScoutData && fromOSA === 0) {
          // No scouting at all
          notice.innerHTML = `
            No scouting data found. <button class="btn-link" data-tab-target="tab-data-management" type="button">Manage Data</button>
          `;
          notice.style.display = 'block';
          notice.className = 'scout-upload-notice';
        } else {
          notice.style.display = 'none';
        }
      } else if (this.scoutingRatings.length === 0) {
        // Legacy fallback for old code
        notice.innerHTML = `
          No scouting data found. <button class="btn-link" data-tab-target="tab-data-management" type="button">Manage Data</button>
        `;
        notice.style.display = 'block';
        notice.className = 'scout-upload-notice';
      } else {
        notice.style.display = 'none';
      }
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
    // For pitchers, check against pitcher columns
    if (this.mode === 'pitchers') {
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
        this.sortKey = 'percentile';
        this.sortDirection = 'desc';
        return;
      }

      if (this.showRawStats) {
        this.sortKey = 'ra9war';
        this.sortDirection = 'desc';
      }
    } else {
      // For batters, check against batter columns
      const batterColumns = this.getBatterColumnsForView();
      const availableKeys = new Set<string>();
      batterColumns.forEach(column => {
        availableKeys.add(String(column.key));
        if (column.sortKey) {
          availableKeys.add(String(column.sortKey));
        }
      });

      if (this.sortKey && availableKeys.has(this.sortKey)) {
        return;
      }

      // Default sort by percentile (TR) for True Ratings view, WAR for Raw Stats
      if (this.showTrueRatings) {
        this.sortKey = 'percentile';
        this.sortDirection = 'desc';
        return;
      }

      if (this.showRawStats) {
        this.sortKey = 'war';
        this.sortDirection = 'desc';
      }
    }
  }

  private normalizeName(name: string): string {
    const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
    const cleaned = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const tokens = cleaned.split(/\s+/).filter((token) => token && !suffixes.has(token));
    return tokens.join('');
  }

  private bindPlayerNameClicks(): void {
    const links = this.container.querySelectorAll<HTMLButtonElement>('.player-name-link');
    links.forEach(link => {
      link.addEventListener('click', (e) => {
        e.stopPropagation();
        const playerId = parseInt(link.dataset.playerId ?? '', 10);
        if (!playerId) return;
        if (this.mode === 'pitchers') {
          this.openPlayerProfile(playerId);
        } else {
          this.openBatterProfile(playerId);
        }
      });
    });
  }

  private async openPlayerProfile(playerId: number): Promise<void> {
    const row = this.playerRowLookup.get(playerId);
    if (!row) return;

    analyticsService.trackPlayerProfileOpened({
      playerId,
      playerName: row.playerName,
      playerType: 'pitcher',
      team: row.teamFilter,
      trueRating: row.trueRating,
      isProspect: row.isProspect,
    });

    // Fetch scouting data fresh (more reliable than cached class properties)
    const [myRatings, osaRatings] = await Promise.all([
      scoutingDataService.getLatestScoutingRatings('my'),
      scoutingDataService.getLatestScoutingRatings('osa')
    ]);
    const myScouting = myRatings.find(s => s.playerId === playerId);
    const osaScouting = osaRatings.find(s => s.playerId === playerId);

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

    // For prospects, look up farm data to get consistent projection values
    let prospectEstimatedStuff = row.estimatedStuff;
    let prospectEstimatedControl = row.estimatedControl;
    let prospectEstimatedHra = row.estimatedHra;
    // TFR values (peak potential) — separate from TR (current ability)
    let prospectTfrStuff: number | undefined;
    let prospectTfrControl: number | undefined;
    let prospectTfrHra: number | undefined;
    let prospectTfrBySource: any;
    let projectionOverride: PlayerProfileData['projectionOverride'];

    if (row.isProspect) {
      try {
        const pitcherFarmData = this._cachedPitcherFarmData
            ?? await teamRatingsService.getFarmData(this.selectedYear);
        const prospectData = pitcherFarmData.prospects.find(p => p.playerId === playerId);
        if (prospectData) {
          // TFR = peak potential from percentile-ranked true ratings (blended scouting + stats)
          if (prospectData.trueRatings) {
            prospectTfrStuff = prospectData.trueRatings.stuff;
            prospectTfrControl = prospectData.trueRatings.control;
            prospectTfrHra = prospectData.trueRatings.hra;
          }
          prospectTfrBySource = prospectData.tfrBySource;
          // TR = current ability from development curves (precomputed on RatedProspect)
          prospectEstimatedStuff = prospectData.developmentTR?.stuff ?? prospectData.trueRatings?.stuff ?? row.estimatedStuff;
          prospectEstimatedControl = prospectData.developmentTR?.control ?? prospectData.trueRatings?.control ?? row.estimatedControl;
          prospectEstimatedHra = prospectData.developmentTR?.hra ?? prospectData.trueRatings?.hra ?? row.estimatedHra;
          // Build projectionOverride so the modal doesn't run its own independent projection
          // Use TFR values for peak projection ratings
          projectionOverride = {
            projectedStats: {
              k9: prospectData.projK9 ?? 0,
              bb9: prospectData.projBb9 ?? 0,
              hr9: prospectData.projHr9 ?? 0,
              fip: prospectData.peakFip,
              war: prospectData.peakWar,
              ip: prospectData.peakIp ?? prospectData.stats.ip,
            },
            projectedRatings: {
              stuff: prospectTfrStuff ?? prospectEstimatedStuff ?? 0,
              control: prospectTfrControl ?? prospectEstimatedControl ?? 0,
              hra: prospectTfrHra ?? prospectEstimatedHra ?? 0,
            },
          };
        }
      } catch (e) {
        console.warn('Could not load pitcher farm data for prospect lookup:', e);
      }
    }

    const profileData: PlayerProfileData = {
      playerId: row.player_id,
      playerName: row.playerName,
      team: teamLabel,
      parentTeam: parentLabel,
      age: player?.age,
      positionLabel: player ? getPositionLabel(player.position) : undefined,
      trueRating: row.trueRating,
      percentile: row.percentile,
      fipLike: row.fipLike,
      estimatedStuff: prospectEstimatedStuff,
      estimatedControl: prospectEstimatedControl,
      estimatedHra: prospectEstimatedHra,

      // My Scout data
      scoutStuff: myScouting?.stuff,
      scoutControl: myScouting?.control,
      scoutHra: myScouting?.hra,
      scoutStamina: myScouting?.stamina,
      scoutInjuryProneness: myScouting?.injuryProneness,
      scoutOvr: myScouting?.ovr,
      scoutPot: myScouting?.pot,

      // OSA data
      osaStuff: osaScouting?.stuff,
      osaControl: osaScouting?.control,
      osaHra: osaScouting?.hra,
      osaStamina: osaScouting?.stamina,
      osaInjuryProneness: osaScouting?.injuryProneness,
      osaOvr: osaScouting?.ovr,
      osaPot: osaScouting?.pot,

      // Toggle state
      activeScoutSource: myScouting ? 'my' : 'osa',
      hasMyScout: !!myScouting,
      hasOsaScout: !!osaScouting,

      // My Scout pitch data
      myPitches: myScouting?.pitches ? Object.keys(myScouting.pitches) : undefined,
      myPitchRatings: myScouting?.pitches,

      // OSA pitch data
      osaPitches: osaScouting?.pitches ? Object.keys(osaScouting.pitches) : undefined,
      osaPitchRatings: osaScouting?.pitches,
      // TFR fields for prospects — use TFR (peak potential), distinct from TR (current ability)
      trueFutureRating: row.trueFutureRating,
      tfrPercentile: row.tfrPercentile,
      hasTfrUpside: row.isProspect ? true : undefined,
      tfrStuff: row.isProspect ? (prospectTfrStuff ?? prospectEstimatedStuff) : undefined,
      tfrControl: row.isProspect ? (prospectTfrControl ?? prospectEstimatedControl) : undefined,
      tfrHra: row.isProspect ? (prospectTfrHra ?? prospectEstimatedHra) : undefined,
      isProspect: row.isProspect,
      year: this.selectedYear,
      projectionYear: this.selectedYear,
      projectionBaseYear: Math.max(2000, this.selectedYear - 1),
      forceProjection: row.isProspect, // Force peak projection for prospects
      projectionOverride, // Use farm data projection for consistency

      // Pass projection data directly so the modal doesn't recalculate
      projIp: projectionOverride?.projectedStats?.ip,
      projWar: projectionOverride?.projectedStats?.war,
      projK9: projectionOverride?.projectedStats?.k9,
      projBb9: projectionOverride?.projectedStats?.bb9,
      projHr9: projectionOverride?.projectedStats?.hr9,
      projFip: projectionOverride?.projectedStats?.fip,
      tfrBySource: row.isProspect ? prospectTfrBySource : undefined,
    };

    await pitcherProfileModal.show(profileData as any, this.selectedYear);
  }

  private async openBatterProfile(playerId: number): Promise<void> {
    const row = this._batterRowLookup?.get(playerId);
    if (!row) return;

    analyticsService.trackPlayerProfileOpened({
      playerId,
      playerName: row.playerName,
      playerType: 'batter',
      team: row.teamFilter,
      trueRating: row.trueRating,
      isProspect: row.isProspect,
    });

    // Fetch player and team info
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

    // Calculate SLG from raw data if available
    const singles = (row.h ?? 0) - (row.d ?? 0) - (row.t ?? 0) - (row.hr ?? 0);
    const slg = row.ab && row.ab > 0
      ? (singles + 2 * (row.d ?? 0) + 3 * (row.t ?? 0) + 4 * (row.hr ?? 0)) / row.ab
      : undefined;

    // For prospects, fetch full data from hitter farm data
    // For MLB players, pass blended rates so the modal doesn't re-derive from percentile-based True Ratings
    let projWar: number | undefined = row.isProspect ? row.war : undefined;
    let projWoba: number | undefined = !row.isProspect ? row.woba : undefined;
    let projAvg: number | undefined = !row.isProspect ? row.blendedAvg : undefined;
    let projObp: number | undefined = !row.isProspect && row.blendedAvg !== undefined && row.blendedBbPct !== undefined
      ? Math.min(0.450, row.blendedAvg + (row.blendedBbPct / 100)) : undefined;
    let projSlg: number | undefined = !row.isProspect && row.blendedAvg !== undefined && row.blendedIso !== undefined
      ? row.blendedAvg + row.blendedIso : undefined;
    let projPa: number | undefined;
    let projBbPct: number | undefined = !row.isProspect ? row.blendedBbPct : undefined;
    let projKPct: number | undefined = !row.isProspect ? row.blendedKPct : undefined;
    let projHrPct: number | undefined = !row.isProspect ? row.blendedHrPct : undefined;
    let projDoublesRate: number | undefined = !row.isProspect ? row.blendedDoublesRate : undefined;
    let projTriplesRate: number | undefined = !row.isProspect ? row.blendedTriplesRate : undefined;
    let trueFutureRating = row.trueFutureRating;
    let tfrPercentile = row.tfrPercentile;
    let estimatedPower = row.estimatedPower;
    let estimatedEye = row.estimatedEye;
    let estimatedAvoidK = row.estimatedAvoidK;
    let estimatedContact = row.estimatedContact;
    let estimatedGap = row.estimatedGap;
    let estimatedSpeed = row.estimatedSpeed;

    // TFR ceiling data — look up from unified TFR data for both prospects and MLB players
    let hasTfrUpside = false;
    let tfrPower: number | undefined;
    let tfrEye: number | undefined;
    let tfrAvoidK: number | undefined;
    let tfrContact: number | undefined;
    let tfrGap: number | undefined;
    let tfrSpeed: number | undefined;
    // TFR blended rates for peak projection (avoids lossy rating→rate round-trip)
    let tfrBbPct: number | undefined;
    let tfrKPct: number | undefined;
    let tfrHrPct: number | undefined;
    let tfrAvg: number | undefined;
    let tfrObp: number | undefined;
    let tfrSlg: number | undefined;
    let tfrPa: number | undefined;
    let batterTfrBySource: any;

    try {
      const unifiedData = this._cachedUnifiedHitterTfrData
          ?? await teamRatingsService.getUnifiedHitterTfrData(this.selectedYear);
      const tfrEntry = unifiedData.prospects.find(p => p.playerId === playerId);
      if (tfrEntry) {
        trueFutureRating = tfrEntry.trueFutureRating;
        tfrPercentile = tfrEntry.percentile;
        tfrPower = tfrEntry.trueRatings.power;
        tfrEye = tfrEntry.trueRatings.eye;
        tfrAvoidK = tfrEntry.trueRatings.avoidK;
        tfrContact = tfrEntry.trueRatings.contact;
        tfrGap = tfrEntry.trueRatings.gap;
        tfrSpeed = tfrEntry.trueRatings.speed;
        // Always extract blended rates for peak projection use
        tfrBbPct = tfrEntry.projBbPct;
        tfrKPct = tfrEntry.projKPct;
        tfrHrPct = tfrEntry.projHrPct;
        tfrAvg = tfrEntry.projAvg;
        tfrObp = tfrEntry.projObp;
        tfrSlg = tfrEntry.projSlg;
        tfrPa = tfrEntry.projPa;
        batterTfrBySource = tfrEntry.tfrBySource;

        if (row.isProspect) {
          // Pure prospect: projected stats from TFR
          projWar = tfrEntry.projWar;
          projWoba = tfrEntry.projWoba;
          projAvg = tfrEntry.projAvg;
          projObp = tfrEntry.projObp;
          projSlg = tfrEntry.projSlg;
          projPa = tfrEntry.projPa;
          projBbPct = tfrEntry.projBbPct;
          projKPct = tfrEntry.projKPct;
          projHrPct = tfrEntry.projHrPct;

          // TR from development curves (precomputed on RatedHitterProspect)
          const devTR = tfrEntry.developmentTR;
          estimatedEye = devTR?.eye ?? tfrEntry.trueRatings.eye;
          estimatedAvoidK = devTR?.avoidK ?? tfrEntry.trueRatings.avoidK;
          estimatedPower = devTR?.power ?? tfrEntry.trueRatings.power;
          estimatedContact = devTR?.contact ?? tfrEntry.trueRatings.contact;
          estimatedGap = devTR?.gap ?? tfrEntry.trueRatings.gap;
          estimatedSpeed = devTR?.speed ?? tfrEntry.trueRatings.speed;
          hasTfrUpside = true; // Pure prospects always show TFR
        } else {
          // MLB player: check if TFR > TR
          hasTfrUpside = row.trueRating !== undefined && trueFutureRating > row.trueRating;
        }
      }
    } catch (e) {
      console.warn('Could not load unified hitter TFR data:', e);
    }

    // Build profile data for the modal
    // trueRating = actual MLB TR (undefined for pure prospects)
    // trueFutureRating = TFR (if available from unified data)
    const profileData: BatterProfileData = {
      playerId: row.player_id,
      playerName: row.playerName,
      team: teamLabel,
      parentTeam: parentLabel,
      age: player?.age,
      position: player?.position,
      positionLabel: player ? getPositionLabel(player.position) : undefined,

      // True Ratings — always use actual TR from MLB stats (undefined for prospects)
      trueRating: row.isProspect ? undefined : row.trueRating,
      percentile: row.isProspect ? undefined : row.percentile,
      woba: row.woba,

      // Estimated ratings
      estimatedPower,
      estimatedEye,
      estimatedAvoidK,
      estimatedContact,
      estimatedGap,
      estimatedSpeed,

      // Raw stats
      pa: row.pa,
      avg: row.avg,
      obp: row.obp,
      slg: slg ? Math.round(slg * 1000) / 1000 : undefined,
      hr: row.hr,
      rbi: row.rbi,
      sb: row.sb,
      war: row.war,
      projWar,
      projWoba,
      projAvg,
      projObp,
      projSlg,
      projPa,
      projBbPct,
      projKPct,
      projHrPct,
      projDoublesRate,
      projTriplesRate,

      // TFR data
      isProspect: Boolean(row.isProspect),
      trueFutureRating,
      tfrPercentile,

      // TFR ceiling data
      hasTfrUpside,
      tfrPower,
      tfrEye,
      tfrAvoidK,
      tfrContact,
      tfrGap,
      tfrSpeed,

      // TFR blended rates for peak projection
      tfrBbPct,
      tfrKPct,
      tfrHrPct,
      tfrAvg,
      tfrObp,
      tfrSlg,
      tfrPa,
      tfrBySource: batterTfrBySource,
    };

    await batterProfileModal.show(profileData, this.selectedYear);
  }

  private bindTeamDropdownListeners(): void {
    this.container.querySelectorAll('#team-dropdown-menu .filter-dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const value = (e.target as HTMLElement).dataset.value;
        if (!value) return;

        this.selectedTeam = value;
        this.currentPage = 1;
        this.saveFilterPreferences();

        analyticsService.trackTeamSelected(value, 'true-ratings');

        // Update display text
        const displaySpan = this.container.querySelector('#selected-team-display');
        const itemText = (e.target as HTMLElement).textContent;
        if (displaySpan && itemText) {
          displaySpan.textContent = itemText;
        }

        // Update selected state
        this.container.querySelectorAll('#team-dropdown-menu .filter-dropdown-item').forEach(i => i.classList.remove('selected'));
        (e.target as HTMLElement).classList.add('selected');

        // Close dropdown
        (e.target as HTMLElement).closest('.filter-dropdown')?.classList.remove('open');

        this.applyFiltersAndRender();
      });
    });
  }

  private bindPositionDropdownListeners(): void {
    this.container.querySelectorAll('#position-dropdown-menu .filter-dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const value = (e.target as HTMLElement).dataset.value;
        if (!value) return;

        const previousMode = this.mode;
        this.selectedPosition = value;
        this.currentPage = 1;

        // Determine mode based on position selection
        const pitcherPositions = ['all-pitchers', 'SP', 'RP'];
        const batterPositions = ['all-batters', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'all-of', 'all-middle-if'];

        if (pitcherPositions.includes(value)) {
          this.mode = 'pitchers';
        } else if (batterPositions.includes(value)) {
          this.mode = 'batters';
        }

        // If mode changed, update sort key
        if (previousMode !== this.mode) {
          analyticsService.trackModeSwitched(this.mode, 'true-ratings');

          // Use Percentile as default sort for True Ratings view, WAR for Raw Stats view
          if (this.mode === 'pitchers') {
            this.sortKey = this.showRawStats ? 'ra9war' : 'percentile';
          } else {
            this.sortKey = this.showRawStats ? 'war' : 'percentile';
          }
          this.sortDirection = 'desc';
        }

        this.saveFilterPreferences();

        // Update display text
        const displaySpan = this.container.querySelector('#selected-position-display');
        const itemText = (e.target as HTMLElement).textContent;
        if (displaySpan && itemText) {
          displaySpan.textContent = itemText;
        }

        // Update selected state
        this.container.querySelectorAll('#position-dropdown-menu .filter-dropdown-item').forEach(i => i.classList.remove('selected'));
        (e.target as HTMLElement).classList.add('selected');

        // Close dropdown
        (e.target as HTMLElement).closest('.filter-dropdown')?.classList.remove('open');

        // Update visibility of controls based on mode
        this.updateRatingsControlsVisibility();
        this.updateScoutingUploadVisibility();

        // If mode changed, we need to fetch new data
        if (previousMode !== this.mode) {
          this.fetchAndRenderStats();
        } else {
          this.applyFiltersAndRender();
        }
      });
    });
  }

  private updateTeamOptions(): void {
    const menu = this.container.querySelector('#team-dropdown-menu');
    if (!menu) return;

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

    menu.innerHTML = [
      `<div class="filter-dropdown-item ${this.selectedTeam === 'all' ? 'selected' : ''}" data-value="all">All Teams</div>`,
      ...this.teamOptions.map(team => `<div class="filter-dropdown-item ${team === this.selectedTeam ? 'selected' : ''}" data-value="${team}">${team}</div>`)
    ].join('');

    // Update display text
    const displaySpan = this.container.querySelector('#selected-team-display');
    if (displaySpan) {
      const selectedItem = menu.querySelector('.filter-dropdown-item.selected');
      displaySpan.textContent = selectedItem?.textContent || 'All Teams';
    }

    // Re-bind event listeners after updating the menu
    this.bindTeamDropdownListeners();
  }

  private getPositionDisplayName(position: string): string {
    if (position === 'all-pitchers') return 'All Pitchers';
    if (position === 'all-batters') return 'All Batters';
    if (position === 'all-of') return 'All OFers';
    if (position === 'all-middle-if') return 'All Middle IFers';
    return position;
  }

  private renderPositionDropdownItems(): string {
    const positions = [
      { value: 'all-pitchers', label: 'All Pitchers' },
      { value: 'SP', label: 'SP' },
      { value: 'RP', label: 'RP' },
      { value: 'all-batters', label: 'All Batters' },
      { value: 'C', label: 'C' },
      { value: '1B', label: '1B' },
      { value: 'all-middle-if', label: 'All Middle IFers' },
      { value: '2B', label: '2B' },
      { value: 'SS', label: 'SS' },
      { value: '3B', label: '3B' },
      { value: 'all-of', label: 'All OFers' },
      { value: 'LF', label: 'LF' },
      { value: 'CF', label: 'CF' },
      { value: 'RF', label: 'RF' },
      { value: 'DH', label: 'DH' },
    ];

    return positions.map(pos =>
      `<div class="filter-dropdown-item ${pos.value === this.selectedPosition ? 'selected' : ''}" data-value="${pos.value}">${pos.label}</div>`
    ).join('');
  }
}
