import { Player, getFullName, isPitcher, getPositionLabel } from '../models/Player';
import { playerService } from '../services/PlayerService';
import { teamService } from '../services/TeamService';
import { projectionService, ProjectedPlayer } from '../services/ProjectionService';
import { Team } from '../models/Team';
import { dateService } from '../services/DateService';
import { scoutingDataFallbackService } from '../services/ScoutingDataFallbackService';
import { PitcherScoutingRatings, HitterScoutingRatings } from '../models/ScoutingData';
import { trueFutureRatingService } from '../services/TrueFutureRatingService';
import { minorLeagueStatsService } from '../services/MinorLeagueStatsService';
import { MinorLeagueStatsWithLevel } from '../models/Stats';
import { fipWarService } from '../services/FipWarService';
import { pitcherProfileModal } from './PitcherProfileModal';
import { BatterProfileModal, BatterProfileData } from './BatterProfileModal';
import { batterProjectionService, ProjectedBatter } from '../services/BatterProjectionService';
import { hitterScoutingDataService } from '../services/HitterScoutingDataService';
import { hitterTrueFutureRatingService } from '../services/HitterTrueFutureRatingService';
import { teamRatingsService } from '../services/TeamRatingsService';

interface DraftPick {
  id: string;
  round: number;
  pickPosition?: number;
  displayName: string;
  estimatedValue: number;  // WAR estimate
}

interface TradeTeamState {
  teamId: number;
  minorLevel: string;
  tradingPlayers: ProjectedPlayer[];
  tradingBatters: ProjectedBatter[];
  tradingPicks: DraftPick[];
  showingPitchers: boolean;
  sortKey: 'name' | 'position' | 'rating';
  sortDirection: 'asc' | 'desc';
}

interface TradeAnalysis {
  team1WarChange: number;
  team2WarChange: number;
  team1Gain: boolean;
  team2Gain: boolean;
  summary: string;
}

export class TradeAnalyzerView {
  private container: HTMLElement;
  private allPlayers: Player[] = [];
  private allTeams: Team[] = [];
  private allProjections: Map<number, ProjectedPlayer> = new Map();
  private allScoutingRatings: Map<number, PitcherScoutingRatings> = new Map();
  private allBatterProjections: Map<number, ProjectedBatter> = new Map();
  private allHitterScoutingRatings: Map<number, HitterScoutingRatings> = new Map();
  private minorLeagueStats: Map<number, MinorLeagueStatsWithLevel[]> = new Map();
  private currentYear: number = 2022;
  private batterProfileModal: BatterProfileModal;

  private team1State: TradeTeamState = {
    teamId: 0,
    minorLevel: 'mlb',
    tradingPlayers: [],
    tradingBatters: [],
    tradingPicks: [],
    showingPitchers: true,
    sortKey: 'name',
    sortDirection: 'asc'
  };
  private team2State: TradeTeamState = {
    teamId: 0,
    minorLevel: 'mlb',
    tradingPlayers: [],
    tradingBatters: [],
    tradingPicks: [],
    showingPitchers: true,
    sortKey: 'name',
    sortDirection: 'asc'
  };

  constructor(container: HTMLElement) {
    this.container = container;
    this.batterProfileModal = new BatterProfileModal();
    this.initialize();
  }

  private percentileToRating(percentile: number): number {
    if (percentile >= 97.7) return 5.0;
    if (percentile >= 93.3) return 4.5;
    if (percentile >= 84.1) return 4.0;
    if (percentile >= 69.1) return 3.5;
    if (percentile >= 50.0) return 3.0;
    if (percentile >= 30.9) return 2.5;
    if (percentile >= 15.9) return 2.0;
    if (percentile >= 6.7) return 1.5;
    if (percentile >= 2.3) return 1.0;
    return 0.5;
  }

  private async openPlayerProfile(playerId: number): Promise<void> {
    const player = this.allPlayers.find(p => p.id === playerId);
    if (!player) {
      console.warn(`Player ${playerId} not found`);
      return;
    }

    const team = this.allTeams.find(t => t.id === player.teamId);

    if (isPitcher(player)) {
      // Handle pitcher profile
      const scouting = this.allScoutingRatings.get(playerId);
      const projection = this.allProjections.get(playerId);

      const profileData = {
        playerId: player.id,
        playerName: getFullName(player),
        team: team?.nickname,
        age: player.age,
        trueRating: projection?.currentTrueRating,
        percentile: projection?.currentPercentile,
        estimatedStuff: projection?.projectedRatings.stuff,
        estimatedControl: projection?.projectedRatings.control,
        estimatedHra: projection?.projectedRatings.hra,
        scoutStuff: scouting?.stuff,
        scoutControl: scouting?.control,
        scoutHra: scouting?.hra,
        scoutStamina: scouting?.stamina,
        scoutInjuryProneness: scouting?.injuryProneness,
        scoutOvr: scouting?.ovr,
        scoutPot: scouting?.pot,
      };

      await pitcherProfileModal.show(profileData as any, this.currentYear);
    } else {
      // Handle batter profile
      const batterProjection = this.allBatterProjections.get(playerId);

      // Try to get prospect data from hitter farm data for full projection info
      let projWar: number | undefined;
      let projWoba: number | undefined;
      let projAvg: number | undefined;
      let projObp: number | undefined;
      let projSlg: number | undefined;
      let projPa: number | undefined;
      let projBbPct: number | undefined;
      let projKPct: number | undefined;
      let projHrPct: number | undefined;
      let trueFutureRating: number | undefined;
      let tfrPercentile: number | undefined;
      let estimatedPower: number | undefined;
      let estimatedEye: number | undefined;
      let estimatedAvoidK: number | undefined;
      let estimatedContact: number | undefined;
      let estimatedGap: number | undefined;
      let estimatedSpeed: number | undefined;
      let isProspect = false;
      let batterTfrBySource: any;

      // Check if this is a prospect (no MLB projection or minor leaguer)
      if (!batterProjection || (team && team.parentTeamId !== 0)) {
        isProspect = true;
        try {
          const hitterFarmData = await teamRatingsService.getHitterFarmData(this.currentYear);
          const prospectData = hitterFarmData.prospects.find(p => p.playerId === playerId);
          if (prospectData) {
            projWar = prospectData.projWar;
            projWoba = prospectData.projWoba;
            projAvg = prospectData.projAvg;
            projObp = prospectData.projObp;
            projSlg = prospectData.projSlg;
            projPa = prospectData.projPa;
            projBbPct = prospectData.projBbPct;
            projKPct = prospectData.projKPct;
            projHrPct = prospectData.projHrPct;
            trueFutureRating = prospectData.trueFutureRating;
            tfrPercentile = prospectData.percentile;
            estimatedPower = prospectData.developmentTR?.power ?? prospectData.trueRatings.power;
            estimatedEye = prospectData.developmentTR?.eye ?? prospectData.trueRatings.eye;
            estimatedAvoidK = prospectData.developmentTR?.avoidK ?? prospectData.trueRatings.avoidK;
            estimatedContact = prospectData.developmentTR?.contact ?? prospectData.trueRatings.contact;
            estimatedGap = prospectData.developmentTR?.gap ?? prospectData.trueRatings.gap;
            estimatedSpeed = prospectData.developmentTR?.speed ?? prospectData.trueRatings.speed;
            batterTfrBySource = prospectData.tfrBySource;
          }
        } catch (e) {
          console.warn('Could not load hitter farm data for prospect lookup:', e);
        }
      } else if (batterProjection) {
        // MLB player with projection
        projWar = batterProjection.projectedStats.war;
        projAvg = batterProjection.projectedStats.avg;
        projObp = batterProjection.projectedStats.obp;
        projSlg = batterProjection.projectedStats.slg;
        projPa = batterProjection.projectedStats.pa;
      }

      const profileData: BatterProfileData = {
        playerId: player.id,
        playerName: getFullName(player),
        team: team?.nickname,
        age: player.age,
        position: player.position,
        positionLabel: getPositionLabel(player.position),
        trueRating: isProspect ? undefined : batterProjection?.currentTrueRating,
        percentile: isProspect ? undefined : batterProjection?.percentile,
        estimatedPower,
        estimatedEye,
        estimatedAvoidK,
        estimatedContact,
        estimatedGap,
        estimatedSpeed,
        isProspect,
        trueFutureRating,
        tfrPercentile,
        hasTfrUpside: isProspect ? true : undefined,
        tfrPower: isProspect ? estimatedPower : undefined,
        tfrEye: isProspect ? estimatedEye : undefined,
        tfrAvoidK: isProspect ? estimatedAvoidK : undefined,
        tfrContact: isProspect ? estimatedContact : undefined,
        tfrGap: isProspect ? estimatedGap : undefined,
        tfrSpeed: isProspect ? estimatedSpeed : undefined,
        projWar,
        projWoba,
        projAvg,
        projObp,
        projSlg,
        projPa,
        projBbPct,
        projKPct,
        projHrPct,
        tfrBySource: batterTfrBySource,
      };

      await this.batterProfileModal.show(profileData, this.currentYear);
    }
  }

  private async initialize(): Promise<void> {
    this.render();

    // Get current year from dateService
    try {
      this.currentYear = await dateService.getCurrentYear();
    } catch (e) {
      console.warn('Failed to get current year, using 2022:', e);
      this.currentYear = 2022;
    }

    this.allPlayers = await playerService.getAllPlayers();
    this.allTeams = await teamService.getAllTeams();

    // Load projections for current year - 1 (projection base year)
    try {
      const projectionYear = this.currentYear - 1;
      console.log(`Loading projections for year ${projectionYear}...`);
      const projections = await projectionService.getProjections(projectionYear);
      console.log(`Loaded ${projections.length} projections`);
      projections.forEach(p => {
        this.allProjections.set(p.playerId, p);
      });
      console.log(`Projection map size: ${this.allProjections.size}`);
    } catch (e) {
      console.error('Failed to load projections:', e);
    }

    // Load scouting ratings for fallback (for players without projections)
    try {
      console.log('Loading scouting ratings...');
      const scoutingResult = await scoutingDataFallbackService.getScoutingRatingsWithFallback();
      scoutingResult.ratings.forEach(rating => {
        if (rating.playerId > 0) {
          this.allScoutingRatings.set(rating.playerId, rating);
        }
      });
      console.log(`Loaded ${this.allScoutingRatings.size} scouting ratings`);
    } catch (e) {
      console.error('Failed to load scouting ratings:', e);
    }

    // Load minor league stats for TFR calculations
    try {
      console.log('Loading minor league stats...');
      // Load stats for last 3 years
      const endYear = this.currentYear;
      const startYear = endYear - 3;
      this.minorLeagueStats = await minorLeagueStatsService.getAllPlayerStatsBatch(startYear, endYear);
      console.log(`Loaded minor league stats for ${this.minorLeagueStats.size} players`);
    } catch (e) {
      console.error('Failed to load minor league stats:', e);
    }

    // Load batter projections
    try {
      const projectionYear = this.currentYear - 1;
      console.log(`Loading batter projections for year ${projectionYear}...`);
      const batterProjections = await batterProjectionService.getProjections(projectionYear);
      console.log(`Loaded ${batterProjections.length} batter projections`);
      batterProjections.forEach(p => {
        this.allBatterProjections.set(p.playerId, p);
      });
    } catch (e) {
      console.error('Failed to load batter projections:', e);
    }

    // Load hitter scouting ratings
    try {
      console.log('Loading hitter scouting ratings...');
      const hitterScoutingList = await hitterScoutingDataService.getLatestScoutingRatings('osa');
      hitterScoutingList.forEach(rating => {
        if (rating.playerId > 0) {
          this.allHitterScoutingRatings.set(rating.playerId, rating);
        }
      });
      // Also try "my" scouting ratings (preferred)
      const myHitterScouting = await hitterScoutingDataService.getLatestScoutingRatings('my');
      myHitterScouting.forEach(rating => {
        if (rating.playerId > 0) {
          this.allHitterScoutingRatings.set(rating.playerId, rating);
        }
      });
      console.log(`Loaded ${this.allHitterScoutingRatings.size} hitter scouting ratings`);
    } catch (e) {
      console.error('Failed to load hitter scouting ratings:', e);
    }

    this.setupEventHandlers();
    this.populateTeamDropdowns();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="view-header">
        <h2 class="view-title">Trade Analyzer</h2>
        <p class="view-subtitle">Compare player value and WAR impact across teams</p>
      </div>

      <div class="trade-analyzer-container">
        <!-- Left Column: Team 1 -->
        <div class="trade-column trade-column-left">
          <div class="trade-team-header">
            <select class="trade-team-select" data-team="1">
              <option value="">Select Team 1...</option>
            </select>
          </div>

          <div class="trade-level-selector">
            <label>Level:</label>
            <select class="trade-level-select" data-team="1">
              <option value="mlb" selected>MLB</option>
              <option value="aaa">Triple-A</option>
              <option value="aa">Double-A</option>
              <option value="a">Single-A</option>
              <option value="r">Rookie</option>
              <option value="ic">Int'l Complex</option>
              <option value="draft">Draft Picks</option>
            </select>
          </div>

          <div class="trade-player-type-toggle" data-team="1">
            <button class="toggle-btn active" data-player-type="pitchers" data-team="1">Pitchers</button>
            <button class="toggle-btn" data-player-type="batters" data-team="1">Batters</button>
          </div>

          <div class="trade-sort-control" data-team="1">
            <select class="trade-sort-select" data-team="1">
              <option value="name">Name</option>
              <option value="position">Position</option>
              <option value="rating">True Rating</option>
            </select>
            <button class="trade-sort-direction" data-team="1" title="Toggle sort direction">▴</button>
          </div>

          <div class="trade-player-list" data-team="1">
            <!-- Players will be populated here -->
          </div>

          <div class="trade-bucket-label">Trading:</div>
          <div class="trade-bucket" data-team="1">
            <!-- Dragged players here -->
          </div>
        </div>

        <!-- Middle Column: Analysis -->
        <div class="trade-column trade-column-middle">
          <div class="trade-analysis-header">
            <h3>Trade Analysis</h3>
          </div>

          <div class="trade-analysis-content">
            <div class="analysis-placeholder">
              <p>Select players from both teams to analyze trade impact</p>
            </div>
          </div>

          <div class="trade-clear-buttons">
            <button class="btn btn-secondary clear-trade-btn" data-team="1">Clear Team 1</button>
            <button class="btn btn-secondary clear-trade-btn" data-team="2">Clear Team 2</button>
          </div>
        </div>

        <!-- Right Column: Team 2 -->
        <div class="trade-column trade-column-right">
          <div class="trade-team-header">
            <select class="trade-team-select" data-team="2">
              <option value="">Select Team 2...</option>
            </select>
          </div>

          <div class="trade-level-selector">
            <label>Level:</label>
            <select class="trade-level-select" data-team="2">
              <option value="mlb" selected>MLB</option>
              <option value="aaa">Triple-A</option>
              <option value="aa">Double-A</option>
              <option value="a">Single-A</option>
              <option value="r">Rookie</option>
              <option value="ic">Int'l Complex</option>
              <option value="draft">Draft Picks</option>
            </select>
          </div>

          <div class="trade-player-type-toggle" data-team="2">
            <button class="toggle-btn active" data-player-type="pitchers" data-team="2">Pitchers</button>
            <button class="toggle-btn" data-player-type="batters" data-team="2">Batters</button>
          </div>

          <div class="trade-sort-control" data-team="2">
            <select class="trade-sort-select" data-team="2">
              <option value="name">Name</option>
              <option value="position">Position</option>
              <option value="rating">True Rating</option>
            </select>
            <button class="trade-sort-direction" data-team="2" title="Toggle sort direction">▴</button>
          </div>

          <div class="trade-player-list" data-team="2">
            <!-- Players will be populated here -->
          </div>

          <div class="trade-bucket-label">Trading:</div>
          <div class="trade-bucket" data-team="2">
            <!-- Dragged players here -->
          </div>
        </div>
      </div>
    `;
  }

  private populateTeamDropdowns(): void {
    const mainTeams = this.allTeams.filter(t => t.parentTeamId === 0);

    ['1', '2'].forEach(teamStr => {
      const teamNum = parseInt(teamStr) as 1 | 2;
      const select = this.container.querySelector<HTMLSelectElement>(`.trade-team-select[data-team="${teamNum}"]`);
      if (!select) return;

      mainTeams.forEach(team => {
        const option = document.createElement('option');
        option.value = team.id.toString();
        option.textContent = team.nickname;
        select.appendChild(option);
      });

      select.addEventListener('change', () => this.onTeamChange(teamNum));
    });
  }

  private setupEventHandlers(): void {
    // Team select handlers
    this.container.querySelectorAll('.trade-team-select').forEach(select => {
      select.addEventListener('change', () => {
        const teamNum = parseInt((select as HTMLSelectElement).dataset.team!) as 1 | 2;
        this.onTeamChange(teamNum);
      });
    });

    // Level select handlers
    this.container.querySelectorAll('.trade-level-select').forEach(select => {
      select.addEventListener('change', () => {
        const teamNum = parseInt((select as HTMLSelectElement).dataset.team!) as 1 | 2;
        this.onLevelChange(teamNum);
      });
    });

    // Player type toggle handlers
    this.container.querySelectorAll('.trade-player-type-toggle .toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const teamNum = parseInt((btn as HTMLElement).dataset.team!) as 1 | 2;
        const playerType = (btn as HTMLElement).dataset.playerType;
        this.onPlayerTypeChange(teamNum, playerType === 'pitchers');
      });
    });

    // Sort select handlers
    this.container.querySelectorAll('.trade-sort-select').forEach(select => {
      select.addEventListener('change', () => {
        const teamNum = parseInt((select as HTMLSelectElement).dataset.team!) as 1 | 2;
        const sortKey = (select as HTMLSelectElement).value as 'name' | 'position' | 'rating';
        this.onSortChange(teamNum, sortKey);
      });
    });

    // Sort direction handlers
    this.container.querySelectorAll('.trade-sort-direction').forEach(btn => {
      btn.addEventListener('click', () => {
        const teamNum = parseInt((btn as HTMLElement).dataset.team!) as 1 | 2;
        this.toggleSortDirection(teamNum);
      });
    });

    // Clear buttons
    this.container.querySelectorAll('.clear-trade-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const teamNum = parseInt((btn as HTMLElement).dataset.team!) as 1 | 2;
        this.clearTeamTrade(teamNum);
      });
    });
  }

  private onPlayerTypeChange(teamNum: 1 | 2, showPitchers: boolean): void {
    const state = teamNum === 1 ? this.team1State : this.team2State;
    state.showingPitchers = showPitchers;

    // Update toggle button states
    const toggleContainer = this.container.querySelector(`.trade-player-type-toggle[data-team="${teamNum}"]`);
    if (toggleContainer) {
      toggleContainer.querySelectorAll('.toggle-btn').forEach(btn => {
        const isPitchers = (btn as HTMLElement).dataset.playerType === 'pitchers';
        btn.classList.toggle('active', isPitchers === showPitchers);
      });
    }

    this.updatePlayerList(teamNum);
  }

  private onSortChange(teamNum: 1 | 2, sortKey: 'name' | 'position' | 'rating'): void {
    const state = teamNum === 1 ? this.team1State : this.team2State;
    state.sortKey = sortKey;
    this.updatePlayerList(teamNum);
  }

  private toggleSortDirection(teamNum: 1 | 2): void {
    const state = teamNum === 1 ? this.team1State : this.team2State;
    state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';

    // Update button text
    const btn = this.container.querySelector(`.trade-sort-direction[data-team="${teamNum}"]`);
    if (btn) {
      btn.textContent = state.sortDirection === 'asc' ? '▴' : '▾';
    }

    this.updatePlayerList(teamNum);
  }

  private onTeamChange(teamNum: 1 | 2): void {
    const select = this.container.querySelector<HTMLSelectElement>(`.trade-team-select[data-team="${teamNum}"]`);
    if (!select) return;

    const teamId = parseInt(select.value);
    const state = teamNum === 1 ? this.team1State : this.team2State;
    state.teamId = teamId;
    state.tradingPlayers = [];
    state.tradingBatters = [];
    state.tradingPicks = [];

    this.updatePlayerList(teamNum);
    this.updateAnalysis();
  }

  private onLevelChange(teamNum: 1 | 2): void {
    const select = this.container.querySelector<HTMLSelectElement>(`.trade-level-select[data-team="${teamNum}"]`);
    if (!select) return;

    const state = teamNum === 1 ? this.team1State : this.team2State;
    state.minorLevel = select.value;

    // Toggle visibility of player type toggle and sort controls based on level
    const isDraftPicks = state.minorLevel === 'draft';
    const toggleContainer = this.container.querySelector(`.trade-player-type-toggle[data-team="${teamNum}"]`) as HTMLElement;
    const sortContainer = this.container.querySelector(`.trade-sort-control[data-team="${teamNum}"]`) as HTMLElement;

    if (toggleContainer) {
      toggleContainer.style.display = isDraftPicks ? 'none' : 'flex';
    }
    if (sortContainer) {
      sortContainer.style.display = isDraftPicks ? 'none' : 'flex';
    }

    this.updatePlayerList(teamNum);
  }

  private getPlayersByTeamAndLevel(teamId: number, level: string, showPitchers: boolean): Player[] {
    if (teamId === 0) {
      console.log('No team selected');
      return [];
    }

    console.log(`Filtering players: teamId=${teamId}, level=${level}, showPitchers=${showPitchers}, total players=${this.allPlayers.length}`);

    let filtered = this.allPlayers.filter(p => {
      if (level === 'mlb') {
        // MLB: teamId matches, level is 1, and age > 18 (to exclude International Complex)
        // IC players have the same teamId and level but are 18 or younger
        return p.teamId === teamId && p.level === 1 && p.age > 18;
      } else if (level === 'ic') {
        // International Complex: teamId matches, level is 1, and age <= 18
        return p.teamId === teamId && p.level === 1 && p.age <= 18;
      } else if (level === 'aaa') {
        return p.parentTeamId === teamId && p.level === 2;
      } else if (level === 'aa') {
        return p.parentTeamId === teamId && p.level === 3;
      } else if (level === 'a') {
        return p.parentTeamId === teamId && p.level === 4;
      } else if (level === 'r') {
        return p.parentTeamId === teamId && p.level === 5;
      }
      return false;
    });

    console.log(`After team/level filter: ${filtered.length} players`);

    // Filter by player type (pitchers vs batters)
    const result = filtered.filter(p => showPitchers ? isPitcher(p) : !isPitcher(p));
    console.log(`After player type filter: ${result.length} ${showPitchers ? 'pitchers' : 'batters'}`);

    return result;
  }

  private sortPlayers(players: Player[], sortKey: 'name' | 'position' | 'rating', sortDirection: 'asc' | 'desc', showPitchers: boolean): Player[] {
    const sorted = [...players];
    const multiplier = sortDirection === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
      let comparison = 0;

      switch (sortKey) {
        case 'name':
          comparison = a.lastName.localeCompare(b.lastName);
          break;
        case 'position':
          comparison = a.position - b.position;
          break;
        case 'rating':
          // Get ratings for comparison
          const ratingA = this.getPlayerRating(a, showPitchers);
          const ratingB = this.getPlayerRating(b, showPitchers);
          comparison = ratingA - ratingB;
          break;
      }

      return comparison * multiplier;
    });

    return sorted;
  }

  private getPlayerRating(player: Player, isPitcherPlayer: boolean): number {
    if (isPitcherPlayer) {
      const projection = this.allProjections.get(player.id);
      if (projection?.currentTrueRating) {
        return projection.currentTrueRating;
      }
      // Fallback: calculate from scouting
      const scouting = this.allScoutingRatings.get(player.id);
      if (scouting) {
        const avgScoutRating = (scouting.stuff + scouting.control + scouting.hra) / 3;
        return ((avgScoutRating - 20) / 60) * 4.5 + 0.5;
      }
    } else {
      const projection = this.allBatterProjections.get(player.id);
      if (projection?.currentTrueRating) {
        return projection.currentTrueRating;
      }
      // Fallback: calculate from scouting
      const scouting = this.allHitterScoutingRatings.get(player.id);
      if (scouting) {
        const avgScoutRating = (scouting.power + scouting.eye + scouting.avoidK + scouting.contact) / 4;
        return ((avgScoutRating - 20) / 60) * 4.5 + 0.5;
      }
    }
    return 0;
  }

  private getTrueRatingClass(value: number): string {
    if (value >= 4.5) return 'rating-elite';
    if (value >= 4.0) return 'rating-plus';
    if (value >= 3.0) return 'rating-avg';
    if (value >= 2.0) return 'rating-fringe';
    return 'rating-poor';
  }

  private wobaToRating(woba: number): number {
    // Convert wOBA to 0.5-5.0 scale
    // Elite: .400+ → 4.5-5.0
    // Plus:  .370-.399 → 4.0-4.5
    // Avg:   .320-.369 → 3.0-4.0
    // Below: .280-.319 → 2.0-3.0
    // Poor:  <.280 → 0.5-2.0
    if (woba >= 0.400) return 4.5 + (woba - 0.400) * 10;
    if (woba >= 0.370) return 4.0 + (woba - 0.370) / 0.030 * 0.5;
    if (woba >= 0.320) return 3.0 + (woba - 0.320) / 0.050;
    if (woba >= 0.280) return 2.0 + (woba - 0.280) / 0.040;
    return Math.max(0.5, 0.5 + (woba - 0.200) / 0.080 * 1.5);
  }

  private updatePlayerList(teamNum: 1 | 2): void {
    const state = teamNum === 1 ? this.team1State : this.team2State;
    const listContainer = this.container.querySelector<HTMLElement>(`.trade-player-list[data-team="${teamNum}"]`);
    if (!listContainer) return;

    // Handle draft picks view
    if (state.minorLevel === 'draft') {
      this.renderDraftPicksList(teamNum, listContainer);
      return;
    }

    const players = this.getPlayersByTeamAndLevel(state.teamId, state.minorLevel, state.showingPitchers);
    const sortedPlayers = this.sortPlayers(players, state.sortKey, state.sortDirection, state.showingPitchers);
    const playerTypeLabel = state.showingPitchers ? 'pitchers' : 'batters';
    console.log(`Team ${teamNum}: Found ${sortedPlayers.length} ${playerTypeLabel} for teamId=${state.teamId}, level=${state.minorLevel}`);

    if (sortedPlayers.length === 0) {
      listContainer.innerHTML = `<div class="empty-text">No ${playerTypeLabel} found at this level</div>`;
      return;
    }

    listContainer.innerHTML = sortedPlayers.map((player) => {
      let trueRating = 0;
      let ratingSource = 'projection';

      if (state.showingPitchers) {
        // Pitcher rating logic
        const projection = this.allProjections.get(player.id);
        const scouting = this.allScoutingRatings.get(player.id);

        trueRating = projection?.currentTrueRating ?? 0;

        if (trueRating === 0 && scouting) {
          const playerMinorStats = this.minorLeagueStats.get(player.id) || [];

          try {
            const tfrResult = trueFutureRatingService.calculateTrueFutureRating({
              playerId: player.id,
              playerName: getFullName(player),
              age: player.age,
              scouting,
              minorLeagueStats: playerMinorStats
            });

            const fip = tfrResult.projFip;
            let percentile = 50;
            if (fip < 3.0) percentile = 90;
            else if (fip < 3.5) percentile = 75;
            else if (fip < 4.0) percentile = 60;
            else if (fip < 4.5) percentile = 50;
            else if (fip < 5.0) percentile = 35;
            else if (fip < 5.5) percentile = 20;
            else percentile = 10;

            trueRating = this.percentileToRating(percentile);
            ratingSource = 'tfr';
          } catch {
            const avgScoutRating = (scouting.stuff + scouting.control + scouting.hra) / 3;
            trueRating = ((avgScoutRating - 20) / 60) * 4.5 + 0.5;
            ratingSource = 'scouting';
          }
        }
      } else {
        // Batter rating logic
        const projection = this.allBatterProjections.get(player.id);
        const scouting = this.allHitterScoutingRatings.get(player.id);

        trueRating = projection?.currentTrueRating ?? 0;

        if (trueRating === 0 && scouting) {
          // Calculate TFR for batter from scouting ratings
          try {
            const tfrResult = hitterTrueFutureRatingService.calculateTrueFutureRating({
              playerId: player.id,
              playerName: getFullName(player),
              age: player.age,
              scouting,
              minorLeagueStats: [] // No minor league batting stats available
            });

            trueRating = this.wobaToRating(tfrResult.projWoba);
            ratingSource = 'tfr';
          } catch {
            // Fallback to scouting average
            const avgScoutRating = (scouting.power + scouting.eye + scouting.avoidK + scouting.contact) / 4;
            trueRating = ((avgScoutRating - 20) / 60) * 4.5 + 0.5;
            ratingSource = 'scouting';
          }
        }
      }

      const hasRating = trueRating > 0;
      const rating = hasRating ? trueRating.toFixed(1) : 'N/A';
      const ratingClass = hasRating ? this.getTrueRatingClass(trueRating) : '';
      const tfrBadgeClass = ratingSource === 'tfr' ? 'tfr-badge' : '';

      return `
        <div class="trade-player-item" draggable="true" data-player-id="${player.id}" data-team="${teamNum}" data-is-pitcher="${state.showingPitchers}">
          <div class="player-name player-name-link" data-player-id="${player.id}">${getFullName(player)}</div>
          <div class="player-rating">
            ${hasRating
              ? `<span class="badge ${ratingClass} ${tfrBadgeClass}">${rating}</span>`
              : 'N/A'}
          </div>
        </div>
      `;
    }).join('');

    // Setup drag handlers
    this.setupDragHandlers(teamNum);
  }

  private renderDraftPicksList(teamNum: 1 | 2, container: HTMLElement): void {
    const rounds = [
      { round: 1, label: '1st Round', value: 3.0 },
      { round: 2, label: '2nd Round', value: 1.5 },
      { round: 3, label: '3rd Round', value: 0.8 },
      { round: 4, label: '4th Round', value: 0.4 },
      { round: 5, label: '5th Round', value: 0.2 },
    ];

    container.innerHTML = `
      <div class="draft-picks-list">
        ${rounds.map(r => `
          <div class="trade-pick-item" data-round="${r.round}" data-team="${teamNum}">
            <div class="pick-info">
              <span class="pick-label">${r.label}</span>
              <span class="pick-value">${r.value.toFixed(1)} WAR</span>
            </div>
            <div class="pick-position-group">
              <input type="number" class="pick-position-field" min="1" max="30" placeholder="#" title="Pick position (1-30)">
              <button class="add-pick-btn" data-round="${r.round}" data-team="${teamNum}">+</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    this.setupDraftPickHandlers(teamNum, container);
  }

  private setupDraftPickHandlers(teamNum: 1 | 2, container: HTMLElement): void {
    container.querySelectorAll('.add-pick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const round = parseInt((btn as HTMLElement).dataset.round!);
        const pickItem = btn.closest('.trade-pick-item');
        const positionInput = pickItem?.querySelector('.pick-position-field') as HTMLInputElement;
        const position = positionInput?.value ? parseInt(positionInput.value) : undefined;

        this.addDraftPickToTrade(teamNum, round, position);

        // Clear the input
        if (positionInput) positionInput.value = '';
      });
    });
  }

  private addDraftPickToTrade(teamNum: 1 | 2, round: number, position?: number): void {
    const state = teamNum === 1 ? this.team1State : this.team2State;

    // Generate unique ID
    const id = `pick-${teamNum}-${round}-${position ?? 'general'}-${Date.now()}`;

    // Calculate estimated WAR value
    let estimatedValue: number;
    const roundLabels = ['', '1st', '2nd', '3rd', '4th', '5th'];

    switch (round) {
      case 1:
        // Adjust by position: top 5 = 4.0, 6-10 = 3.5, 11-20 = 3.0, 21-30 = 2.0
        if (position) {
          if (position <= 5) estimatedValue = 4.0;
          else if (position <= 10) estimatedValue = 3.5;
          else if (position <= 20) estimatedValue = 3.0;
          else estimatedValue = 2.0;
        } else {
          estimatedValue = 3.0; // Default for unspecified
        }
        break;
      case 2:
        estimatedValue = 1.5;
        break;
      case 3:
        estimatedValue = 0.8;
        break;
      case 4:
        estimatedValue = 0.4;
        break;
      case 5:
        estimatedValue = 0.2;
        break;
      default:
        estimatedValue = 0.1;
    }

    const displayName = position
      ? `${roundLabels[round]} Round Pick #${position}`
      : `${roundLabels[round]} Round Pick`;

    const pick: DraftPick = {
      id,
      round,
      pickPosition: position,
      displayName,
      estimatedValue,
    };

    state.tradingPicks.push(pick);
    this.updateBucket(teamNum);
    this.updateAnalysis();
  }

  private setupDragHandlers(teamNum: 1 | 2): void {
    const listContainer = this.container.querySelector<HTMLElement>(`.trade-player-list[data-team="${teamNum}"]`);
    const bucket = this.container.querySelector<HTMLElement>(`.trade-bucket[data-team="${teamNum}"]`);
    if (!listContainer || !bucket) return;

    listContainer.querySelectorAll('.trade-player-item').forEach(item => {
      item.addEventListener('dragstart', (e) => {
        const playerId = (item as HTMLElement).dataset.playerId;
        const dataTransfer = (e as DragEvent).dataTransfer;
        if (dataTransfer) {
          dataTransfer.effectAllowed = 'move';
          dataTransfer.setData('playerId', playerId || '');
          dataTransfer.setData('sourceTeam', teamNum.toString());
        }
      });

      // Click on player name opens profile modal
      const playerNameLink = item.querySelector('.player-name-link');
      if (playerNameLink) {
        playerNameLink.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent triggering the item click
          const playerId = parseInt((playerNameLink as HTMLElement).dataset.playerId!);
          this.openPlayerProfile(playerId);
        });
      }

      // Click anywhere else on item adds to trade
      item.addEventListener('click', (e) => {
        // Only add to trade if not clicking on player name
        if (!(e.target as HTMLElement).classList.contains('player-name-link')) {
          this.addPlayerToTrade(teamNum, parseInt((item as HTMLElement).dataset.playerId!));
        }
      });
    });

    // Setup bucket as drop target
    bucket.addEventListener('dragover', (e) => {
      e.preventDefault();
      (e as DragEvent).dataTransfer!.dropEffect = 'move';
      bucket.classList.add('drag-over');
    });

    bucket.addEventListener('dragleave', () => {
      bucket.classList.remove('drag-over');
    });

    bucket.addEventListener('drop', (e) => {
      e.preventDefault();
      bucket.classList.remove('drag-over');
      const dataTransfer = (e as DragEvent).dataTransfer;
      if (!dataTransfer) return;

      const playerId = parseInt(dataTransfer.getData('playerId'));
      this.addPlayerToTrade(teamNum, playerId);
    });
  }

  private addPlayerToTrade(teamNum: 1 | 2, playerId: number): void {
    const state = teamNum === 1 ? this.team1State : this.team2State;
    const player = this.allPlayers.find(p => p.id === playerId);
    if (!player) {
      console.warn(`Player ${playerId} not found`);
      return;
    }

    const playerIsPitcher = isPitcher(player);

    if (playerIsPitcher) {
      // Handle pitcher
      if (state.tradingPlayers.find(p => p.playerId === playerId)) return;

      let projection = this.allProjections.get(playerId);

      if (!projection) {
        const scouting = this.allScoutingRatings.get(playerId);

        if (!scouting) {
          console.warn(`No scouting data for pitcher ${playerId}`);
          return;
        }

        const playerMinorStats = this.minorLeagueStats.get(playerId) || [];
        const team = this.allTeams.find(t => t.id === player.teamId);

        try {
          const tfrResult = trueFutureRatingService.calculateTrueFutureRating({
            playerId: player.id,
            playerName: getFullName(player),
            age: player.age,
            scouting,
            minorLeagueStats: playerMinorStats
          });

          const fip = tfrResult.projFip;
          let percentile = 50;
          if (fip < 3.0) percentile = 90;
          else if (fip < 3.5) percentile = 75;
          else if (fip < 4.0) percentile = 60;
          else if (fip < 4.5) percentile = 50;
          else if (fip < 5.0) percentile = 35;
          else if (fip < 5.5) percentile = 20;
          else percentile = 10;

          const trueRating = this.percentileToRating(percentile);

          const projectedIp = 150;
          const warResult = fipWarService.calculate({
            k9: tfrResult.projK9,
            bb9: tfrResult.projBb9,
            hr9: tfrResult.projHr9,
            ip: projectedIp
          });

          projection = {
            playerId: player.id,
            name: getFullName(player),
            teamId: player.teamId,
            teamName: team?.nickname ?? 'Unknown',
            position: player.position,
            age: player.age,
            currentTrueRating: trueRating,
            projectedTrueRating: trueRating,
            projectedStats: {
              k9: tfrResult.projK9,
              bb9: tfrResult.projBb9,
              hr9: tfrResult.projHr9,
              fip: tfrResult.projFip,
              war: warResult.war,
              ip: projectedIp
            },
            projectedRatings: {
              stuff: scouting.stuff,
              control: scouting.control,
              hra: scouting.hra
            },
            isSp: true,
            isProspect: true
          };

          console.log(`Created TFR projection for pitcher ${getFullName(player)}:`, {
            trueRating,
            projFip: tfrResult.projFip,
            projWar: warResult.war,
            totalMinorIp: tfrResult.totalMinorIp
          });
        } catch (e) {
          console.error(`Failed to calculate TFR for pitcher ${playerId}:`, e);
          return;
        }
      }

      state.tradingPlayers.push(projection);
    } else {
      // Handle batter
      if (state.tradingBatters.find(p => p.playerId === playerId)) return;

      let batterProjection = this.allBatterProjections.get(playerId);

      if (!batterProjection) {
        const scouting = this.allHitterScoutingRatings.get(playerId);

        if (!scouting) {
          console.warn(`No scouting data for batter ${playerId}`);
          return;
        }

        const team = this.allTeams.find(t => t.id === player.teamId);
        const positionLabels: Record<number, string> = {
          1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH',
        };

        try {
          const tfrResult = hitterTrueFutureRatingService.calculateTrueFutureRating({
            playerId: player.id,
            playerName: getFullName(player),
            age: player.age,
            scouting,
            minorLeagueStats: []
          });

          const trueRating = this.wobaToRating(tfrResult.projWoba);

          // Estimate WAR from wOBA (rough calculation)
          const projectedPa = 550;
          const lgWoba = 0.320;
          const wobaScale = 1.25;
          const woba = tfrResult.projWoba;
          const wRaa = ((woba - lgWoba) / wobaScale) * projectedPa;
          const runPerWar = 10;
          const war = wRaa / runPerWar;

          batterProjection = {
            playerId: player.id,
            name: getFullName(player),
            teamId: player.teamId,
            teamName: team?.nickname ?? 'Unknown',
            position: player.position,
            positionLabel: positionLabels[player.position] || 'UT',
            age: player.age,
            currentTrueRating: trueRating,
            percentile: 50,
            projectedStats: {
              woba: tfrResult.projWoba,
              avg: tfrResult.projAvg,
              obp: tfrResult.projAvg + (tfrResult.projBbPct / 100),
              slg: tfrResult.projAvg + (tfrResult.projHrPct / 100) * 3 + 0.05,
              ops: 0,
              wrcPlus: 100,
              war: Math.max(0, war),
              pa: projectedPa,
              hr: Math.round(projectedPa * (tfrResult.projHrPct / 100)),
              rbi: Math.round(projectedPa * 0.12),
              sb: 5,
              hrPct: tfrResult.projHrPct,
              bbPct: tfrResult.projBbPct,
              kPct: tfrResult.projKPct,
            },
            estimatedRatings: {
              power: scouting.power,
              eye: scouting.eye,
              avoidK: scouting.avoidK,
              contact: scouting.contact,
            },
            scoutingRatings: {
              power: scouting.power,
              eye: scouting.eye,
              avoidK: scouting.avoidK,
              contact: scouting.contact,
            },
          };

          // Fix OPS
          batterProjection.projectedStats.ops = batterProjection.projectedStats.obp + batterProjection.projectedStats.slg;

          console.log(`Created TFR projection for batter ${getFullName(player)}:`, {
            trueRating,
            projWoba: tfrResult.projWoba,
            projWar: batterProjection.projectedStats.war,
          });
        } catch (e) {
          console.error(`Failed to calculate TFR for batter ${playerId}:`, e);
          return;
        }
      }

      state.tradingBatters.push(batterProjection);
    }

    this.updateBucket(teamNum);
    this.updateAnalysis();
  }

  private updateBucket(teamNum: 1 | 2): void {
    const state = teamNum === 1 ? this.team1State : this.team2State;
    const bucket = this.container.querySelector<HTMLElement>(`.trade-bucket[data-team="${teamNum}"]`);
    if (!bucket) return;

    // Render pitchers
    const pitcherItems = state.tradingPlayers.map(player => `
      <div class="trade-bucket-item" data-type="pitcher">
        <span class="bucket-player-name">${player.name}</span>
        <button class="bucket-remove-btn" data-player-id="${player.playerId}" data-team="${teamNum}" data-type="pitcher">×</button>
      </div>
    `).join('');

    // Render batters
    const batterItems = state.tradingBatters.map(batter => `
      <div class="trade-bucket-item" data-type="batter">
        <span class="bucket-player-name">${batter.name}</span>
        <button class="bucket-remove-btn" data-player-id="${batter.playerId}" data-team="${teamNum}" data-type="batter">×</button>
      </div>
    `).join('');

    // Render draft picks
    const pickItems = state.tradingPicks.map(pick => `
      <div class="trade-bucket-item trade-bucket-pick" data-type="pick">
        <span class="bucket-player-name">${pick.displayName}</span>
        <span class="pick-war-value">${pick.estimatedValue.toFixed(1)} WAR</span>
        <button class="bucket-remove-btn" data-pick-id="${pick.id}" data-team="${teamNum}" data-type="pick">×</button>
      </div>
    `).join('');

    bucket.innerHTML = pitcherItems + batterItems + pickItems;

    bucket.querySelectorAll('.bucket-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = (btn as HTMLElement).dataset.type;
        if (type === 'pitcher') {
          const playerId = parseInt((btn as HTMLElement).dataset.playerId!);
          state.tradingPlayers = state.tradingPlayers.filter(p => p.playerId !== playerId);
        } else if (type === 'batter') {
          const playerId = parseInt((btn as HTMLElement).dataset.playerId!);
          state.tradingBatters = state.tradingBatters.filter(p => p.playerId !== playerId);
        } else if (type === 'pick') {
          const pickId = (btn as HTMLElement).dataset.pickId!;
          state.tradingPicks = state.tradingPicks.filter(p => p.id !== pickId);
        }
        this.updateBucket(teamNum);
        this.updateAnalysis();
      });
    });
  }

  private clearTeamTrade(teamNum: 1 | 2): void {
    const state = teamNum === 1 ? this.team1State : this.team2State;
    state.tradingPlayers = [];
    state.tradingBatters = [];
    state.tradingPicks = [];
    this.updateBucket(teamNum);
    this.updateAnalysis();
  }

  private updateAnalysis(): void {
    const contentDiv = this.container.querySelector<HTMLElement>('.trade-analysis-content');
    if (!contentDiv) return;

    const team1HasAssets = this.team1State.tradingPlayers.length > 0 ||
      this.team1State.tradingBatters.length > 0 ||
      this.team1State.tradingPicks.length > 0;
    const team2HasAssets = this.team2State.tradingPlayers.length > 0 ||
      this.team2State.tradingBatters.length > 0 ||
      this.team2State.tradingPicks.length > 0;

    if (!team1HasAssets && !team2HasAssets) {
      contentDiv.innerHTML = `
        <div class="analysis-placeholder">
          <p>Select players from both teams to analyze trade impact</p>
        </div>
      `;
      return;
    }

    const analysis = this.calculateTradeAnalysis();

    const team1 = this.allTeams.find(t => t.id === this.team1State.teamId);
    const team2 = this.allTeams.find(t => t.id === this.team2State.teamId);

    const team1Name = team1?.nickname ?? 'Team 1';
    const team2Name = team2?.nickname ?? 'Team 2';

    contentDiv.innerHTML = `
      <div class="analysis-summary">
        <h4>${team1Name} vs ${team2Name}</h4>
        <p class="analysis-description">${analysis.summary}</p>
      </div>

      <div class="analysis-war-comparison">
        <div class="war-column war-column-1">
          <h5>${team1Name}</h5>
          <div class="war-change ${analysis.team1Gain ? 'positive' : 'negative'}">
            ${analysis.team1Gain ? '+' : ''}${analysis.team1WarChange.toFixed(1)} WAR
          </div>
          <div class="war-detail">
            ${this.renderWarDetail(this.team1State)}
          </div>
        </div>

        <div class="war-column war-column-2">
          <h5>${team2Name}</h5>
          <div class="war-change ${analysis.team2Gain ? 'positive' : 'negative'}">
            ${analysis.team2Gain ? '+' : ''}${analysis.team2WarChange.toFixed(1)} WAR
          </div>
          <div class="war-detail">
            ${this.renderWarDetail(this.team2State)}
          </div>
        </div>
      </div>

      <div class="trade-ratings-comparison">
        <h5>Player Ratings Comparison</h5>
        ${this.renderRatingsTable()}
      </div>
    `;
  }

  private renderWarDetail(state: TradeTeamState): string {
    const items: string[] = [];

    // Pitchers
    state.tradingPlayers.forEach(p => {
      items.push(`
        <div class="player-war-item">
          <span>${p.name}</span>
          <span class="war-value">${p.projectedStats.war.toFixed(1)} WAR</span>
        </div>
      `);
    });

    // Batters
    state.tradingBatters.forEach(b => {
      items.push(`
        <div class="player-war-item">
          <span>${b.name}</span>
          <span class="war-value">${b.projectedStats.war.toFixed(1)} WAR</span>
        </div>
      `);
    });

    // Draft picks
    state.tradingPicks.forEach(pick => {
      items.push(`
        <div class="player-war-item">
          <span>${pick.displayName}</span>
          <span class="war-value">${pick.estimatedValue.toFixed(1)} WAR</span>
        </div>
      `);
    });

    if (items.length === 0) {
      return '<p class="empty-text">No assets selected</p>';
    }

    return `<div class="player-war-list">${items.join('')}</div>`;
  }

  private renderRatingsTable(): string {
    const allPitchers = [...this.team1State.tradingPlayers, ...this.team2State.tradingPlayers];
    const allBatters = [...this.team1State.tradingBatters, ...this.team2State.tradingBatters];

    if (allPitchers.length === 0 && allBatters.length === 0) {
      return '<p class="empty-text">Add players to view ratings</p>';
    }

    // Multi-purpose columns for mixed player types
    // Column headers adapt based on what players are in the trade
    return `
      <table class="trade-ratings-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>True Rating</th>
            <th>FIP/wOBA</th>
            <th>K/9 / K%</th>
            <th>BB/9 / BB%</th>
            <th>Stuff/Power</th>
            <th>Control/Eye</th>
          </tr>
        </thead>
        <tbody>
          ${allPitchers.map(p => `
            <tr>
              <td>${p.name}</td>
              <td><span class="badge ${this.getTrueRatingClass(p.currentTrueRating)}">${p.currentTrueRating.toFixed(1)}</span></td>
              <td>${p.projectedStats.fip.toFixed(2)}</td>
              <td>${p.projectedStats.k9.toFixed(2)}</td>
              <td>${p.projectedStats.bb9.toFixed(2)}</td>
              <td>${p.projectedRatings.stuff.toFixed(0)}</td>
              <td>${p.projectedRatings.control.toFixed(0)}</td>
            </tr>
          `).join('')}
          ${allBatters.map(b => `
            <tr>
              <td>${b.name}</td>
              <td><span class="badge ${this.getTrueRatingClass(b.currentTrueRating)}">${b.currentTrueRating.toFixed(1)}</span></td>
              <td>${b.projectedStats.woba.toFixed(3)}</td>
              <td>${b.projectedStats.kPct?.toFixed(1) ?? '-'}%</td>
              <td>${b.projectedStats.bbPct?.toFixed(1) ?? '-'}%</td>
              <td>${b.estimatedRatings.power.toFixed(0)}</td>
              <td>${b.estimatedRatings.eye.toFixed(0)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  private calculateTradeAnalysis(): TradeAnalysis {
    // Calculate total WAR for team 1 (pitchers + batters + picks)
    const team1PitcherWar = this.team1State.tradingPlayers.reduce((sum, p) => sum + p.projectedStats.war, 0);
    const team1BatterWar = this.team1State.tradingBatters.reduce((sum, b) => sum + b.projectedStats.war, 0);
    const team1PickWar = this.team1State.tradingPicks.reduce((sum, pick) => sum + pick.estimatedValue, 0);
    const team1WarChange = team1PitcherWar + team1BatterWar + team1PickWar;

    // Calculate total WAR for team 2 (pitchers + batters + picks)
    const team2PitcherWar = this.team2State.tradingPlayers.reduce((sum, p) => sum + p.projectedStats.war, 0);
    const team2BatterWar = this.team2State.tradingBatters.reduce((sum, b) => sum + b.projectedStats.war, 0);
    const team2PickWar = this.team2State.tradingPicks.reduce((sum, pick) => sum + pick.estimatedValue, 0);
    const team2WarChange = team2PitcherWar + team2BatterWar + team2PickWar;

    const team1Gain = team2WarChange > team1WarChange;
    const team2Gain = team1WarChange > team2WarChange;

    const team1Name = this.allTeams.find(t => t.id === this.team1State.teamId)?.nickname ?? 'Team 1';
    const team2Name = this.allTeams.find(t => t.id === this.team2State.teamId)?.nickname ?? 'Team 2';

    let summary = '';
    const warDiff = Math.abs(team1WarChange - team2WarChange);

    if (Math.abs(warDiff) < 0.5) {
      summary = `This appears to be an even trade, with each team receiving roughly equal WAR value.`;
    } else if (team1Gain) {
      summary = `${team1Name} gains approximately ${warDiff.toFixed(1)} WAR in this deal, making them the clear winner.`;
    } else {
      summary = `${team2Name} gains approximately ${warDiff.toFixed(1)} WAR in this deal, making them the clear winner.`;
    }

    return {
      team1WarChange,
      team2WarChange,
      team1Gain,
      team2Gain,
      summary
    };
  }
}
