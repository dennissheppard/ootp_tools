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
import { teamRatingsService, RatedProspect, RatedHitterProspect, TeamPowerRanking, RatedPitcher, RatedBatter } from '../services/TeamRatingsService';
import { contractService, Contract } from '../services/ContractService';
import { aiTradeAnalysisService, TradeContext, TradePlayerContext, TradePickContext } from '../services/AITradeAnalysisService';
import { markdownToHtml } from '../services/AIScoutingService';
import { hasComponentUpside } from '../utils/tfrUpside';

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
  team1CurrentWar: number;
  team2CurrentWar: number;
  team1FutureWar: number;
  team2FutureWar: number;
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

  // Full-pool farm data maps (Improvement 1)
  private pitcherProspectMap: Map<number, RatedProspect> = new Map();
  private hitterProspectMap: Map<number, RatedHitterProspect> = new Map();

  // Power rankings for team impact (Improvement 2)
  private powerRankingsMap: Map<number, TeamPowerRanking> = new Map();

  // Contracts for AI analysis (Improvement 3)
  private allContracts: Map<number, Contract> = new Map();

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
    let parentTeam: string | undefined;
    if (team && team.parentTeamId !== 0) {
      const parent = this.allTeams.find(t => t.id === team.parentTeamId);
      parentTeam = parent?.nickname;
    }

    if (isPitcher(player)) {
      // Handle pitcher profile
      const scouting = this.allScoutingRatings.get(playerId);
      const projection = this.allProjections.get(playerId);
      const prospect = this.pitcherProspectMap.get(playerId);
      const isProspect = !projection || (team && team.parentTeamId !== 0);

      // Estimated ratings: use development TR for prospects, projection for MLB
      let estimatedStuff = projection?.projectedRatings?.stuff;
      let estimatedControl = projection?.projectedRatings?.control;
      let estimatedHra = projection?.projectedRatings?.hra;

      // TFR fields for prospects
      let trueFutureRating: number | undefined;
      let tfrPercentile: number | undefined;
      let tfrStuff: number | undefined;
      let tfrControl: number | undefined;
      let tfrHra: number | undefined;
      let tfrBySource: any;

      // Projection stats
      let projWar: number | undefined;
      let projIp: number | undefined;
      let projFip: number | undefined;
      let projK9: number | undefined;
      let projBb9: number | undefined;
      let projHr9: number | undefined;

      if (isProspect && prospect) {
        // Use farm data for prospect
        estimatedStuff = prospect.developmentTR?.stuff ?? prospect.trueRatings?.stuff ?? estimatedStuff;
        estimatedControl = prospect.developmentTR?.control ?? prospect.trueRatings?.control ?? estimatedControl;
        estimatedHra = prospect.developmentTR?.hra ?? prospect.trueRatings?.hra ?? estimatedHra;

        trueFutureRating = prospect.trueFutureRating;
        tfrPercentile = prospect.percentile;
        tfrStuff = prospect.trueRatings?.stuff;
        tfrControl = prospect.trueRatings?.control;
        tfrHra = prospect.trueRatings?.hra;
        tfrBySource = prospect.tfrBySource;

        projWar = prospect.peakWar;
        projIp = prospect.peakIp ?? prospect.stats.ip;
        projFip = prospect.peakFip;
        projK9 = prospect.projK9 ?? prospect.stats.k9;
        projBb9 = prospect.projBb9 ?? prospect.stats.bb9;
        projHr9 = prospect.projHr9 ?? prospect.stats.hr9;
      } else if (projection) {
        // Use MLB projection
        projWar = projection.projectedStats.war;
        projIp = projection.projectedStats.ip;
        projFip = projection.projectedStats.fip;
        projK9 = projection.projectedStats.k9;
        projBb9 = projection.projectedStats.bb9;
        projHr9 = projection.projectedStats.hr9;

        // MLB player may still have TFR data from farm system
        if (prospect) {
          trueFutureRating = prospect.trueFutureRating;
          tfrPercentile = prospect.percentile;
          tfrStuff = prospect.trueRatings?.stuff;
          tfrControl = prospect.trueRatings?.control;
          tfrHra = prospect.trueRatings?.hra;
          tfrBySource = prospect.tfrBySource;
        }
      }

      const hasTfrUpside = isProspect ? true
        : (prospect ? ((trueFutureRating !== undefined && trueFutureRating > (projection?.currentTrueRating ?? 0))
            || hasComponentUpside(
              [estimatedStuff, estimatedControl, estimatedHra],
              [tfrStuff, tfrControl, tfrHra]
            ))
          : false);

      const profileData = {
        playerId: player.id,
        playerName: getFullName(player),
        team: team ? `${team.name} ${team.nickname}` : undefined,
        parentTeam,
        age: player.age,
        positionLabel: getPositionLabel(player.position),
        trueRating: projection?.currentTrueRating,
        percentile: (projection as any)?.currentPercentile,
        fipLike: (projection as any)?.fipLike,
        estimatedStuff,
        estimatedControl,
        estimatedHra,
        scoutStuff: scouting?.stuff,
        scoutControl: scouting?.control,
        scoutHra: scouting?.hra,
        scoutStamina: scouting?.stamina,
        injuryProneness: scouting?.injuryProneness,
        scoutOvr: scouting?.ovr,
        scoutPot: scouting?.pot,
        pitchRatings: scouting?.pitches,
        isProspect: Boolean(isProspect),
        trueFutureRating,
        tfrPercentile,
        hasTfrUpside,
        tfrStuff: tfrStuff ?? (isProspect ? estimatedStuff : undefined),
        tfrControl: tfrControl ?? (isProspect ? estimatedControl : undefined),
        tfrHra: tfrHra ?? (isProspect ? estimatedHra : undefined),
        tfrBySource,
        projWar,
        projIp,
        projFip,
        projK9,
        projBb9,
        projHr9,
      };

      await pitcherProfileModal.show(profileData as any, this.currentYear);
    } else {
      // Handle batter profile
      const batterProjection = this.allBatterProjections.get(playerId);
      const prospect = this.hitterProspectMap.get(playerId);
      const hitterScouting = this.allHitterScoutingRatings.get(playerId);
      const isProspect = !batterProjection || (team && team.parentTeamId !== 0);

      // Projected stats
      let projWar: number | undefined;
      let projWoba: number | undefined;
      let projAvg: number | undefined;
      let projObp: number | undefined;
      let projSlg: number | undefined;
      let projPa: number | undefined;
      let projBbPct: number | undefined;
      let projKPct: number | undefined;
      let projHrPct: number | undefined;
      let projWrcPlus: number | undefined;

      // True Ratings estimates
      let estimatedPower: number | undefined;
      let estimatedEye: number | undefined;
      let estimatedAvoidK: number | undefined;
      let estimatedContact: number | undefined;
      let estimatedGap: number | undefined;
      let estimatedSpeed: number | undefined;

      // TFR fields
      let trueFutureRating: number | undefined;
      let tfrPercentile: number | undefined;
      let hasTfrUpside: boolean | undefined;
      let tfrPower: number | undefined;
      let tfrEye: number | undefined;
      let tfrAvoidK: number | undefined;
      let tfrContact: number | undefined;
      let tfrGap: number | undefined;
      let tfrSpeed: number | undefined;
      let tfrBbPct: number | undefined;
      let tfrKPct: number | undefined;
      let tfrHrPct: number | undefined;
      let tfrAvg: number | undefined;
      let tfrObp: number | undefined;
      let tfrSlg: number | undefined;
      let tfrPa: number | undefined;
      let batterTfrBySource: any;

      // Raw stats for MLB players
      let pa: number | undefined;
      let avg: number | undefined;
      let obp: number | undefined;
      let slg: number | undefined;
      let hr: number | undefined;
      let war: number | undefined;

      if (isProspect && prospect) {
        // Prospect: use farm data
        projWar = prospect.projWar;
        projWoba = prospect.projWoba;
        projAvg = prospect.projAvg;
        projObp = prospect.projObp;
        projSlg = prospect.projSlg;
        projPa = prospect.projPa;
        projBbPct = prospect.projBbPct;
        projKPct = prospect.projKPct;
        projHrPct = prospect.projHrPct;
        projWrcPlus = prospect.wrcPlus;

        trueFutureRating = prospect.trueFutureRating;
        tfrPercentile = prospect.percentile;
        hasTfrUpside = true;

        estimatedPower = prospect.developmentTR?.power ?? prospect.trueRatings.power;
        estimatedEye = prospect.developmentTR?.eye ?? prospect.trueRatings.eye;
        estimatedAvoidK = prospect.developmentTR?.avoidK ?? prospect.trueRatings.avoidK;
        estimatedContact = prospect.developmentTR?.contact ?? prospect.trueRatings.contact;
        estimatedGap = prospect.developmentTR?.gap ?? prospect.trueRatings.gap;
        estimatedSpeed = prospect.developmentTR?.speed ?? prospect.trueRatings.speed;

        // TFR ceiling = true ratings (peak potential)
        tfrPower = prospect.trueRatings.power;
        tfrEye = prospect.trueRatings.eye;
        tfrAvoidK = prospect.trueRatings.avoidK;
        tfrContact = prospect.trueRatings.contact;
        tfrGap = prospect.trueRatings.gap;
        tfrSpeed = prospect.trueRatings.speed;

        // TFR blended rates
        tfrBbPct = prospect.projBbPct;
        tfrKPct = prospect.projKPct;
        tfrHrPct = prospect.projHrPct;
        tfrAvg = prospect.projAvg;
        tfrObp = prospect.projObp;
        tfrSlg = prospect.projSlg;
        tfrPa = prospect.projPa;
        batterTfrBySource = prospect.tfrBySource;
      } else if (batterProjection) {
        // MLB player with projection
        projWar = batterProjection.projectedStats.war;
        projAvg = batterProjection.projectedStats.avg;
        projObp = batterProjection.projectedStats.obp;
        projSlg = batterProjection.projectedStats.slg;
        projPa = batterProjection.projectedStats.pa;
        projBbPct = batterProjection.projectedStats.bbPct;
        projKPct = batterProjection.projectedStats.kPct;
        projHrPct = batterProjection.projectedStats.hrPct;
        projWoba = batterProjection.projectedStats.woba;

        // Estimated ratings from projection
        estimatedPower = batterProjection.estimatedRatings?.power;
        estimatedEye = batterProjection.estimatedRatings?.eye;
        estimatedAvoidK = batterProjection.estimatedRatings?.avoidK;
        estimatedContact = batterProjection.estimatedRatings?.contact;

        // Raw stats (if available on projection)
        pa = batterProjection.projectedStats.pa;
        avg = batterProjection.projectedStats.avg;
        obp = batterProjection.projectedStats.obp;
        slg = batterProjection.projectedStats.slg;
        hr = batterProjection.projectedStats.hr;
        war = batterProjection.projectedStats.war;

        // MLB player may still have TFR data from farm system
        if (prospect) {
          trueFutureRating = prospect.trueFutureRating;
          tfrPercentile = prospect.percentile;
          tfrPower = prospect.trueRatings.power;
          tfrEye = prospect.trueRatings.eye;
          tfrAvoidK = prospect.trueRatings.avoidK;
          tfrContact = prospect.trueRatings.contact;
          tfrGap = prospect.trueRatings.gap;
          tfrSpeed = prospect.trueRatings.speed;
          tfrBbPct = prospect.projBbPct;
          tfrKPct = prospect.projKPct;
          tfrHrPct = prospect.projHrPct;
          tfrAvg = prospect.projAvg;
          tfrObp = prospect.projObp;
          tfrSlg = prospect.projSlg;
          tfrPa = prospect.projPa;
          batterTfrBySource = prospect.tfrBySource;
          hasTfrUpside = (trueFutureRating > (batterProjection.currentTrueRating ?? 0))
            || hasComponentUpside(
              [estimatedPower, estimatedEye, estimatedAvoidK, estimatedContact, estimatedGap, estimatedSpeed],
              [tfrPower, tfrEye, tfrAvoidK, tfrContact, tfrGap, tfrSpeed]
            );
        }
      }

      const profileData: BatterProfileData = {
        playerId: player.id,
        playerName: getFullName(player),
        team: team ? `${team.name} ${team.nickname}` : undefined,
        parentTeam,
        age: player.age,
        position: player.position,
        positionLabel: getPositionLabel(player.position),
        trueRating: isProspect ? undefined : batterProjection?.currentTrueRating,
        percentile: isProspect ? undefined : batterProjection?.percentile,

        // Estimated ratings
        estimatedPower,
        estimatedEye,
        estimatedAvoidK,
        estimatedContact,
        estimatedGap,
        estimatedSpeed,

        // Scouting ratings
        scoutPower: hitterScouting?.power,
        scoutEye: hitterScouting?.eye,
        scoutAvoidK: hitterScouting?.avoidK,
        scoutContact: hitterScouting?.contact,
        scoutGap: hitterScouting?.gap,
        scoutSpeed: hitterScouting?.speed,
        scoutOvr: hitterScouting?.ovr,
        scoutPot: hitterScouting?.pot,
        injuryProneness: (hitterScouting as any)?.injuryProneness ?? prospect?.injuryProneness,

        // Raw stats
        pa,
        avg,
        obp,
        slg,
        hr,
        war,

        // Projected stats
        projWar,
        projWoba,
        projAvg,
        projObp,
        projSlg,
        projPa,
        projBbPct,
        projKPct,
        projHrPct,
        projWrcPlus,

        // TFR data
        isProspect: Boolean(isProspect),
        trueFutureRating,
        tfrPercentile,
        hasTfrUpside,
        tfrPower,
        tfrEye,
        tfrAvoidK,
        tfrContact,
        tfrGap,
        tfrSpeed,

        // TFR blended rates
        tfrBbPct,
        tfrKPct,
        tfrHrPct,
        tfrAvg,
        tfrObp,
        tfrSlg,
        tfrPa,
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

    // Load farm data, power rankings, and contracts in parallel
    try {
      const projectionYear = this.currentYear - 1;
      const [farmData, hitterFarmData, powerRankings, contracts] = await Promise.all([
        teamRatingsService.getFarmData(this.currentYear).catch(e => { console.warn('Failed to load pitcher farm data:', e); return null; }),
        teamRatingsService.getHitterFarmData(this.currentYear).catch(e => { console.warn('Failed to load hitter farm data:', e); return null; }),
        teamRatingsService.getPowerRankings(projectionYear).catch(e => { console.warn('Failed to load power rankings:', e); return null; }),
        contractService.getAllContracts().catch(e => { console.warn('Failed to load contracts:', e); return null; }),
      ]);

      if (farmData) {
        farmData.prospects.forEach(p => this.pitcherProspectMap.set(p.playerId, p));
        console.log(`Loaded ${this.pitcherProspectMap.size} pitcher prospects into map`);
      }
      if (hitterFarmData) {
        hitterFarmData.prospects.forEach(p => this.hitterProspectMap.set(p.playerId, p));
        console.log(`Loaded ${this.hitterProspectMap.size} hitter prospects into map`);
      }
      if (powerRankings) {
        powerRankings.forEach(r => this.powerRankingsMap.set(r.teamId, r));
        console.log(`Loaded ${this.powerRankingsMap.size} power rankings`);
      }
      if (contracts) {
        this.allContracts = contracts;
        console.log(`Loaded ${this.allContracts.size} contracts`);
      }
    } catch (e) {
      console.error('Failed to load farm/ranking/contract data:', e);
    }

    this.setupEventHandlers();
    this.populateTeamDropdowns();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="view-header">
        <h2 class="view-title">Trade Analyzer</h2>        
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
              <option value="all-prospects">All Prospects</option>
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

          <div class="trade-player-list" data-team="1">
            <!-- Players will be populated here -->
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
              <option value="all-prospects">All Prospects</option>
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

          <div class="trade-player-list" data-team="2">
            <!-- Players will be populated here -->
          </div>
        </div>
      </div>
    `;
  }

  private populateTeamDropdowns(): void {
    // Only include MLB parent teams that actually have players assigned
    const teamsWithPlayers = new Set<number>();
    this.allPlayers.forEach(p => {
      if (p.teamId) teamsWithPlayers.add(p.teamId);
    });

    const mainTeams = this.allTeams
      .filter(t => t.parentTeamId === 0 && teamsWithPlayers.has(t.id))
      .sort((a, b) => a.nickname.localeCompare(b.nickname));

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

      select.addEventListener('change', () => {
        // Save team 1 selection globally
        if (teamNum === 1) {
          const selectedOption = select.options[select.selectedIndex];
          if (selectedOption?.textContent) {
            try { localStorage.setItem('wbl-selected-team', selectedOption.textContent); } catch { /* ignore */ }
          }
        }
        this.onTeamChange(teamNum);
      });

      // Restore saved team for Team 1
      if (teamNum === 1) {
        const savedTeam = localStorage.getItem('wbl-selected-team');
        if (savedTeam) {
          const match = mainTeams.find(t => t.nickname === savedTeam);
          if (match) {
            select.value = match.id.toString();
            this.onTeamChange(1);
          }
        }
      }
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

    // Clear buttons
    this.container.querySelectorAll('.clear-trade-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const teamNum = parseInt((btn as HTMLElement).dataset.team!) as 1 | 2;
        this.clearTeamTrade(teamNum);
      });
    });

    // Middle column as drop target
    const middleColumn = this.container.querySelector<HTMLElement>('.trade-column-middle');
    if (middleColumn) {
      middleColumn.addEventListener('dragover', (e) => {
        e.preventDefault();
        (e as DragEvent).dataTransfer!.dropEffect = 'move';
        middleColumn.classList.add('drag-over');
      });

      middleColumn.addEventListener('dragleave', (e) => {
        // Only remove if leaving the middle column itself, not entering a child
        if (!middleColumn.contains(e.relatedTarget as Node)) {
          middleColumn.classList.remove('drag-over');
        }
      });

      middleColumn.addEventListener('drop', (e) => {
        e.preventDefault();
        middleColumn.classList.remove('drag-over');
        const dataTransfer = (e as DragEvent).dataTransfer;
        if (!dataTransfer) return;

        const playerId = parseInt(dataTransfer.getData('playerId'));
        const sourceTeam = parseInt(dataTransfer.getData('sourceTeam')) as 1 | 2;
        this.addPlayerToTrade(sourceTeam, playerId);
      });
    }
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
    if (state.sortKey === sortKey) {
      // Toggle direction when clicking the same column
      state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortKey = sortKey;
      state.sortDirection = sortKey === 'rating' ? 'desc' : 'asc';
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

    // Toggle visibility of player type toggle based on level
    const isDraftPicks = state.minorLevel === 'draft';
    const toggleContainer = this.container.querySelector(`.trade-player-type-toggle[data-team="${teamNum}"]`) as HTMLElement;

    if (toggleContainer) {
      toggleContainer.style.display = isDraftPicks ? 'none' : 'flex';
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
      } else if (level === 'all-prospects') {
        // All minor league levels (AAA through Rookie) + IC players
        const isMinorLeaguer = p.parentTeamId === teamId && p.level >= 2 && p.level <= 5;
        const isIcPlayer = p.teamId === teamId && p.level === 1 && p.age <= 18;
        return isMinorLeaguer || isIcPlayer;
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
      // Check farm data map for full-pool TFR
      const prospect = this.pitcherProspectMap.get(player.id);
      if (prospect) {
        return prospect.developmentTR
          ? this.percentileToRating(prospect.percentile ?? 50)
          : this.percentileToRating(prospect.percentile ?? 50);
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
      // Check farm data map for full-pool TFR
      const prospect = this.hitterProspectMap.get(player.id);
      if (prospect) {
        return this.wobaToRating(prospect.projWoba);
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

    const sortIndicator = (key: string) => state.sortKey === key ? (state.sortDirection === 'asc' ? ' ▴' : ' ▾') : '';

    const headerHtml = `
      <div class="trade-list-header" data-team="${teamNum}">
        <span class="trade-header-col trade-header-pos" data-sort="position" data-team="${teamNum}">Pos${sortIndicator('position')}</span>
        <span class="trade-header-col trade-header-name" data-sort="name" data-team="${teamNum}">Name${sortIndicator('name')}</span>
        <span class="trade-header-col trade-header-rating" data-sort="rating" data-team="${teamNum}">Rating${sortIndicator('rating')}</span>
      </div>
    `;

    listContainer.innerHTML = headerHtml + sortedPlayers.map((player) => {
      let trueRating = 0;
      let ratingSource = 'projection';

      if (state.showingPitchers) {
        // Pitcher rating logic: MLB projection > farm data map > on-the-fly TFR > scouting
        const projection = this.allProjections.get(player.id);
        trueRating = projection?.currentTrueRating ?? 0;

        if (trueRating === 0) {
          const prospect = this.pitcherProspectMap.get(player.id);
          if (prospect) {
            trueRating = this.percentileToRating(prospect.percentile ?? 50);
            ratingSource = 'tfr';
          } else {
            const scouting = this.allScoutingRatings.get(player.id);
            if (scouting) {
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
          }
        }
      } else {
        // Batter rating logic: MLB projection > farm data map > on-the-fly TFR > scouting
        const projection = this.allBatterProjections.get(player.id);
        trueRating = projection?.currentTrueRating ?? 0;

        if (trueRating === 0) {
          const prospect = this.hitterProspectMap.get(player.id);
          if (prospect) {
            trueRating = this.wobaToRating(prospect.projWoba);
            ratingSource = 'tfr';
          } else {
            const scouting = this.allHitterScoutingRatings.get(player.id);
            if (scouting) {
              try {
                const tfrResult = hitterTrueFutureRatingService.calculateTrueFutureRating({
                  playerId: player.id,
                  playerName: getFullName(player),
                  age: player.age,
                  scouting,
                  minorLeagueStats: []
                });
                trueRating = this.wobaToRating(tfrResult.projWoba);
                ratingSource = 'tfr';
              } catch {
                const avgScoutRating = (scouting.power + scouting.eye + scouting.avoidK + scouting.contact) / 4;
                trueRating = ((avgScoutRating - 20) / 60) * 4.5 + 0.5;
                ratingSource = 'scouting';
              }
            }
          }
        }
      }

      const hasRating = trueRating > 0;
      const rating = hasRating ? trueRating.toFixed(1) : 'N/A';
      const ratingClass = hasRating ? this.getTrueRatingClass(trueRating) : '';
      const tfrBadgeClass = ratingSource === 'tfr' ? 'tfr-badge' : '';

      return `
        <div class="trade-player-item" draggable="true" data-player-id="${player.id}" data-team="${teamNum}" data-is-pitcher="${state.showingPitchers}">
          <div class="player-position">${getPositionLabel(player.position)}</div>
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
    this.updateAnalysis();
  }

  private setupDragHandlers(teamNum: 1 | 2): void {
    const listContainer = this.container.querySelector<HTMLElement>(`.trade-player-list[data-team="${teamNum}"]`);
    if (!listContainer) return;

    // Sort header click handlers
    listContainer.querySelectorAll('.trade-header-col').forEach(col => {
      col.addEventListener('click', () => {
        const sortKey = (col as HTMLElement).dataset.sort as 'name' | 'position' | 'rating';
        this.onSortChange(teamNum, sortKey);
      });
    });

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
        // Try farm data map first for full-pool TFR
        const prospect = this.pitcherProspectMap.get(playerId);
        const team = this.allTeams.find(t => t.id === player.teamId);

        if (prospect) {
          const trueRating = this.percentileToRating(prospect.percentile ?? 50);
          projection = {
            playerId: player.id,
            name: getFullName(player),
            teamId: player.teamId,
            teamName: team?.nickname ?? 'Unknown',
            position: player.position,
            age: player.age,
            currentTrueRating: trueRating,
            projectedTrueRating: prospect.trueFutureRating,
            projectedStats: {
              k9: prospect.projK9 ?? prospect.stats.k9,
              bb9: prospect.projBb9 ?? prospect.stats.bb9,
              hr9: prospect.projHr9 ?? prospect.stats.hr9,
              fip: prospect.peakFip,
              war: prospect.peakWar,
              ip: prospect.peakIp ?? 150
            },
            projectedRatings: {
              stuff: prospect.potentialRatings.stuff,
              control: prospect.potentialRatings.control,
              hra: prospect.potentialRatings.hra
            },
            isSp: true,
            isProspect: true
          };

          console.log(`Used farm data for pitcher ${getFullName(player)}:`, {
            trueRating,
            tfr: prospect.trueFutureRating,
            projFip: prospect.peakFip,
            projWar: prospect.peakWar,
          });
        } else {
          // Fall back to on-the-fly TFR calculation
          const scouting = this.allScoutingRatings.get(playerId);

          if (!scouting) {
            console.warn(`No scouting data for pitcher ${playerId}`);
            return;
          }

          const playerMinorStats = this.minorLeagueStats.get(playerId) || [];

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
          } catch (e) {
            console.error(`Failed to calculate TFR for pitcher ${playerId}:`, e);
            return;
          }
        }
      }

      state.tradingPlayers.push(projection);
    } else {
      // Handle batter
      if (state.tradingBatters.find(p => p.playerId === playerId)) return;

      let batterProjection = this.allBatterProjections.get(playerId);

      if (!batterProjection) {
        // Try farm data map first for full-pool TFR
        const prospect = this.hitterProspectMap.get(playerId);
        const team = this.allTeams.find(t => t.id === player.teamId);
        const positionLabels: Record<number, string> = {
          1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH',
        };

        if (prospect) {
          const trueRating = this.wobaToRating(prospect.projWoba);
          batterProjection = {
            playerId: player.id,
            name: getFullName(player),
            teamId: player.teamId,
            teamName: team?.nickname ?? 'Unknown',
            position: player.position,
            positionLabel: positionLabels[player.position] || 'UT',
            age: player.age,
            currentTrueRating: trueRating,
            percentile: prospect.percentile,
            projectedStats: {
              woba: prospect.projWoba,
              avg: prospect.projAvg,
              obp: prospect.projObp,
              slg: prospect.projSlg,
              ops: prospect.projOps,
              wrcPlus: prospect.wrcPlus,
              war: prospect.projWar,
              pa: prospect.projPa,
              hr: Math.round(prospect.projPa * (prospect.projHrPct / 100)),
              rbi: Math.round(prospect.projPa * 0.12),
              sb: 5,
              hrPct: prospect.projHrPct,
              bbPct: prospect.projBbPct,
              kPct: prospect.projKPct,
            },
            estimatedRatings: {
              power: prospect.trueRatings.power,
              eye: prospect.trueRatings.eye,
              avoidK: prospect.trueRatings.avoidK,
              contact: prospect.trueRatings.contact,
            },
            scoutingRatings: {
              power: prospect.scoutingRatings.power,
              eye: prospect.scoutingRatings.eye,
              avoidK: prospect.scoutingRatings.avoidK,
              contact: prospect.scoutingRatings.contact,
            },
          };

          console.log(`Used farm data for batter ${getFullName(player)}:`, {
            trueRating,
            projWoba: prospect.projWoba,
            projWar: prospect.projWar,
          });
        } else {
          // Fall back to on-the-fly TFR calculation
          const scouting = this.allHitterScoutingRatings.get(playerId);

          if (!scouting) {
            console.warn(`No scouting data for batter ${playerId}`);
            return;
          }

          try {
            const tfrResult = hitterTrueFutureRatingService.calculateTrueFutureRating({
              playerId: player.id,
              playerName: getFullName(player),
              age: player.age,
              scouting,
              minorLeagueStats: []
            });

            const trueRating = this.wobaToRating(tfrResult.projWoba);
            const projectedPa = 550;
            const lgWoba = 0.320;
            const wobaScale = 1.25;
            const wRaa = ((tfrResult.projWoba - lgWoba) / wobaScale) * projectedPa;
            const war = wRaa / 10;

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
            batterProjection.projectedStats.ops = batterProjection.projectedStats.obp + batterProjection.projectedStats.slg;
          } catch (e) {
            console.error(`Failed to calculate TFR for batter ${playerId}:`, e);
            return;
          }
        }
      }

      state.tradingBatters.push(batterProjection);
    }

    this.updateAnalysis();
  }

  private clearTeamTrade(teamNum: 1 | 2): void {
    const state = teamNum === 1 ? this.team1State : this.team2State;
    state.tradingPlayers = [];
    state.tradingBatters = [];
    state.tradingPicks = [];
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

    const teamImpactHtml = this.renderTeamImpact(team1Name, team2Name);

    contentDiv.innerHTML = `
      <div class="analysis-summary">
        <h4>${team1Name} vs ${team2Name}</h4>
        <p class="analysis-description">${analysis.summary}</p>
      </div>

      <div class="analysis-war-comparison">
        <div class="war-column war-column-1">
          <h5>${team1Name}</h5>
          ${analysis.team1CurrentWar > 0 ? `
            <div class="war-comparison-row">
              <span class="war-type-label">Now</span>
              <span class="war-change-inline ${analysis.team1CurrentWar >= analysis.team2CurrentWar ? 'positive' : ''}">${analysis.team1CurrentWar.toFixed(1)} WAR</span>
            </div>
          ` : ''}
          ${analysis.team1FutureWar > 0 ? `
            <div class="war-comparison-row">
              <span class="war-type-label">Future</span>
              <span class="war-change-inline ${analysis.team1FutureWar >= analysis.team2FutureWar ? 'positive' : ''}">${analysis.team1FutureWar.toFixed(1)} WAR <span class="war-peak-label">(peak)</span></span>
            </div>
          ` : ''}
          <div class="war-comparison-row war-total-row">
            <span class="war-type-label">Total</span>
            <span class="war-change-inline ${analysis.team1Gain ? 'positive' : ''}">${analysis.team1WarChange.toFixed(1)} WAR</span>
          </div>
          <div class="war-detail">
            ${this.renderWarDetail(this.team1State, 1)}
          </div>
        </div>

        <div class="war-column war-column-2">
          <h5>${team2Name}</h5>
          ${analysis.team2CurrentWar > 0 ? `
            <div class="war-comparison-row">
              <span class="war-type-label">Now</span>
              <span class="war-change-inline ${analysis.team2CurrentWar >= analysis.team1CurrentWar ? 'positive' : ''}">${analysis.team2CurrentWar.toFixed(1)} WAR</span>
            </div>
          ` : ''}
          ${analysis.team2FutureWar > 0 ? `
            <div class="war-comparison-row">
              <span class="war-type-label">Future</span>
              <span class="war-change-inline ${analysis.team2FutureWar >= analysis.team1FutureWar ? 'positive' : ''}">${analysis.team2FutureWar.toFixed(1)} WAR <span class="war-peak-label">(peak)</span></span>
            </div>
          ` : ''}
          <div class="war-comparison-row war-total-row">
            <span class="war-type-label">Total</span>
            <span class="war-change-inline ${analysis.team2Gain ? 'positive' : ''}">${analysis.team2WarChange.toFixed(1)} WAR</span>
          </div>
          <div class="war-detail">
            ${this.renderWarDetail(this.team2State, 2)}
          </div>
        </div>
      </div>

      ${teamImpactHtml}

      <div class="trade-ratings-comparison">
        <h5>Player Ratings Comparison</h5>
        ${this.renderRatingsTable()}
      </div>

      <div class="ai-trade-analysis-section">
        <button class="btn ai-trade-btn">Get AI Analysis</button>
        <div class="ai-trade-result"></div>
      </div>
    `;

    // Setup AI analysis button handler
    const aiBtn = contentDiv.querySelector('.ai-trade-btn');
    if (aiBtn) {
      aiBtn.addEventListener('click', () => this.requestAIAnalysis());
    }

    // Clickable player names in analysis panel
    contentDiv.querySelectorAll('.player-name-link').forEach(link => {
      link.addEventListener('click', () => {
        const playerId = parseInt((link as HTMLElement).dataset.playerId!);
        this.openPlayerProfile(playerId);
      });
    });

    // Remove buttons in war detail
    contentDiv.querySelectorAll('.war-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const teamNum = parseInt((btn as HTMLElement).dataset.team!) as 1 | 2;
        const type = (btn as HTMLElement).dataset.type;
        const state = teamNum === 1 ? this.team1State : this.team2State;

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
        this.updateAnalysis();
      });
    });

    // Impact tab toggle handlers
    contentDiv.querySelectorAll('.impact-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = (btn as HTMLElement).dataset.tab!;
        const section = btn.closest('.team-impact-section');
        if (!section) return;

        section.querySelectorAll('.impact-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        section.querySelectorAll<HTMLElement>('.impact-tab-content').forEach(content => {
          content.style.display = content.dataset.tab === tab ? '' : 'none';
        });
      });
    });
  }

  private renderWarDetail(state: TradeTeamState, teamNum: 1 | 2): string {
    const items: string[] = [];

    // Pitchers
    state.tradingPlayers.forEach(p => {
      const badge = this.isProspectPitcher(p)
        ? '<span class="asset-type-badge badge-prospect">Prospect</span>'
        : '<span class="asset-type-badge badge-mlb">MLB</span>';
      items.push(`
        <div class="player-war-item">
          ${badge}
          <span class="war-player-name player-name-link" data-player-id="${p.playerId}">${p.name}</span>
          <span class="war-value">${p.projectedStats.war.toFixed(1)} WAR</span>
          <button class="war-remove-btn" data-player-id="${p.playerId}" data-team="${teamNum}" data-type="pitcher" title="Remove">×</button>
        </div>
      `);
    });

    // Batters
    state.tradingBatters.forEach(b => {
      const badge = this.isProspectBatter(b)
        ? '<span class="asset-type-badge badge-prospect">Prospect</span>'
        : '<span class="asset-type-badge badge-mlb">MLB</span>';
      items.push(`
        <div class="player-war-item">
          ${badge}
          <span class="war-player-name player-name-link" data-player-id="${b.playerId}">${b.name}</span>
          <span class="war-value">${b.projectedStats.war.toFixed(1)} WAR</span>
          <button class="war-remove-btn" data-player-id="${b.playerId}" data-team="${teamNum}" data-type="batter" title="Remove">×</button>
        </div>
      `);
    });

    // Draft picks
    state.tradingPicks.forEach(pick => {
      items.push(`
        <div class="player-war-item">
          <span class="asset-type-badge badge-pick">Pick</span>
          <span>${pick.displayName}</span>
          <span class="war-value">${pick.estimatedValue.toFixed(1)} WAR</span>
          <button class="war-remove-btn" data-pick-id="${pick.id}" data-team="${teamNum}" data-type="pick" title="Remove">×</button>
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
              <td><span class="player-name-link" data-player-id="${p.playerId}">${p.name}</span></td>
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
              <td><span class="player-name-link" data-player-id="${b.playerId}">${b.name}</span></td>
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

  private calculateTeamImpact(teamNum: 1 | 2): {
    before: { rotation: number; bullpen: number; lineup: number; bench: number; overall: number };
    after: { rotation: number; bullpen: number; lineup: number; bench: number; overall: number };
    losing: { name: string; slot: string; rating: number }[];
    gaining: { name: string; slot: string; rating: number }[];
  } | null {
    const state = teamNum === 1 ? this.team1State : this.team2State;
    const otherState = teamNum === 1 ? this.team2State : this.team1State;
    const ranking = this.powerRankingsMap.get(state.teamId);

    if (!ranking) return null;

    const before = {
      rotation: ranking.rotationRating,
      bullpen: ranking.bullpenRating,
      lineup: ranking.lineupRating,
      bench: ranking.benchRating,
      overall: ranking.teamRating,
    };

    // Clone rosters
    let rotation = [...ranking.rotation];
    let bullpen = [...ranking.bullpen];
    let lineup = [...ranking.lineup];
    let bench = [...ranking.bench];

    const losing: { name: string; slot: string; rating: number }[] = [];
    const gaining: { name: string; slot: string; rating: number }[] = [];

    // Remove outgoing players
    const outgoingPitcherIds = new Set(state.tradingPlayers.map(p => p.playerId));
    const outgoingBatterIds = new Set(state.tradingBatters.map(b => b.playerId));

    rotation.forEach((p, i) => {
      if (outgoingPitcherIds.has(p.playerId)) {
        losing.push({ name: p.name, slot: `SP${i + 1}`, rating: p.trueRating });
      }
    });
    bullpen.forEach(p => {
      if (outgoingPitcherIds.has(p.playerId)) {
        losing.push({ name: p.name, slot: 'RP', rating: p.trueRating });
      }
    });
    lineup.forEach(b => {
      if (outgoingBatterIds.has(b.playerId)) {
        losing.push({ name: b.name, slot: b.positionLabel, rating: b.trueRating });
      }
    });
    bench.forEach(b => {
      if (outgoingBatterIds.has(b.playerId)) {
        losing.push({ name: b.name, slot: 'Bench', rating: b.trueRating });
      }
    });

    rotation = rotation.filter(p => !outgoingPitcherIds.has(p.playerId));
    bullpen = bullpen.filter(p => !outgoingPitcherIds.has(p.playerId));
    lineup = lineup.filter(b => !outgoingBatterIds.has(b.playerId));
    bench = bench.filter(b => !outgoingBatterIds.has(b.playerId));

    // Add incoming players from the other team
    for (const p of otherState.tradingPlayers) {
      const incoming: RatedPitcher = {
        playerId: p.playerId,
        name: p.name,
        trueRating: p.currentTrueRating,
        trueStuff: p.projectedRatings.stuff,
        trueControl: p.projectedRatings.control,
        trueHra: p.projectedRatings.hra,
        role: p.isSp ? 'SP' : 'RP',
      };
      if (incoming.role === 'SP' && rotation.length < 5) {
        rotation.push(incoming);
        gaining.push({ name: p.name, slot: `SP${rotation.length}`, rating: p.currentTrueRating });
      } else {
        bullpen.push(incoming);
        gaining.push({ name: p.name, slot: 'RP', rating: p.currentTrueRating });
      }
    }

    for (const b of otherState.tradingBatters) {
      const posLabels: Record<number, string> = { 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH' };
      const incoming: RatedBatter = {
        playerId: b.playerId,
        name: b.name,
        position: b.position,
        positionLabel: posLabels[b.position] || 'UT',
        trueRating: b.currentTrueRating,
        estimatedPower: b.estimatedRatings.power,
        estimatedEye: b.estimatedRatings.eye,
        estimatedAvoidK: b.estimatedRatings.avoidK,
        estimatedContact: b.estimatedRatings.contact,
      };
      if (lineup.length < 9) {
        lineup.push(incoming);
        gaining.push({ name: b.name, slot: incoming.positionLabel, rating: b.currentTrueRating });
      } else {
        bench.push(incoming);
        gaining.push({ name: b.name, slot: 'Bench', rating: b.currentTrueRating });
      }
    }

    // Sort and trim
    rotation.sort((a, b) => b.trueRating - a.trueRating);
    if (rotation.length > 5) {
      bullpen.push(...rotation.slice(5));
      rotation = rotation.slice(0, 5);
    }
    bullpen.sort((a, b) => b.trueRating - a.trueRating);
    bullpen = bullpen.slice(0, 8);

    lineup.sort((a, b) => b.trueRating - a.trueRating);
    if (lineup.length > 9) {
      bench.push(...lineup.slice(9));
      lineup = lineup.slice(0, 9);
    }
    bench.sort((a, b) => b.trueRating - a.trueRating);
    bench = bench.slice(0, 4);

    // Recalculate ratings
    const afterRotation = rotation.length > 0 ? rotation.reduce((s, p) => s + p.trueRating, 0) / rotation.length : 0;
    const afterBullpen = bullpen.length > 0 ? bullpen.reduce((s, p) => s + p.trueRating, 0) / bullpen.length : 0;
    const afterLineup = lineup.length > 0 ? lineup.reduce((s, b) => s + b.trueRating, 0) / lineup.length : 0;
    const afterBench = bench.length > 0 ? bench.reduce((s, b) => s + b.trueRating, 0) / bench.length : 0;
    const afterOverall = (afterRotation * 0.40) + (afterLineup * 0.40) + (afterBullpen * 0.15) + (afterBench * 0.05);

    return {
      before,
      after: { rotation: afterRotation, bullpen: afterBullpen, lineup: afterLineup, bench: afterBench, overall: afterOverall },
      losing,
      gaining,
    };
  }

  private getTfrTierLabel(tfr: number): { label: string; cls: string } {
    if (tfr >= 4.5) return { label: 'Elite', cls: 'tier-elite' };
    if (tfr >= 3.5) return { label: 'Good', cls: 'tier-good' };
    if (tfr >= 2.5) return { label: 'Average', cls: 'tier-avg' };
    return { label: 'Depth', cls: 'tier-depth' };
  }

  private calculateFarmImpact(teamNum: 1 | 2): {
    losing: { name: string; playerId: number; tfr: number; tier: { label: string; cls: string } }[];
    gaining: { name: string; playerId: number; tfr: number; tier: { label: string; cls: string } }[];
    netTiers: Map<string, number>;
  } {
    const state = teamNum === 1 ? this.team1State : this.team2State;
    const otherState = teamNum === 1 ? this.team2State : this.team1State;

    const getProspectTfr = (playerId: number): number | null => {
      const pitcher = this.pitcherProspectMap.get(playerId);
      if (pitcher?.trueFutureRating != null) return pitcher.trueFutureRating;
      const hitter = this.hitterProspectMap.get(playerId);
      if (hitter?.trueFutureRating != null) return hitter.trueFutureRating;
      return null;
    };

    const losing: { name: string; playerId: number; tfr: number; tier: { label: string; cls: string } }[] = [];
    const gaining: { name: string; playerId: number; tfr: number; tier: { label: string; cls: string } }[] = [];

    // Prospects this team is sending away
    for (const p of state.tradingPlayers) {
      if (this.isProspectPitcher(p)) {
        const tfr = getProspectTfr(p.playerId);
        if (tfr != null) losing.push({ name: p.name, playerId: p.playerId, tfr, tier: this.getTfrTierLabel(tfr) });
      }
    }
    for (const b of state.tradingBatters) {
      if (this.isProspectBatter(b)) {
        const tfr = getProspectTfr(b.playerId);
        if (tfr != null) losing.push({ name: b.name, playerId: b.playerId, tfr, tier: this.getTfrTierLabel(tfr) });
      }
    }

    // Prospects this team is gaining (from the other team)
    for (const p of otherState.tradingPlayers) {
      if (this.isProspectPitcher(p)) {
        const tfr = getProspectTfr(p.playerId);
        if (tfr != null) gaining.push({ name: p.name, playerId: p.playerId, tfr, tier: this.getTfrTierLabel(tfr) });
      }
    }
    for (const b of otherState.tradingBatters) {
      if (this.isProspectBatter(b)) {
        const tfr = getProspectTfr(b.playerId);
        if (tfr != null) gaining.push({ name: b.name, playerId: b.playerId, tfr, tier: this.getTfrTierLabel(tfr) });
      }
    }

    // Sort by TFR descending
    losing.sort((a, b) => b.tfr - a.tfr);
    gaining.sort((a, b) => b.tfr - a.tfr);

    // Calculate net tier counts
    const netTiers = new Map<string, number>();
    for (const tier of ['Elite', 'Good', 'Average', 'Depth']) {
      netTiers.set(tier, 0);
    }
    for (const item of losing) {
      netTiers.set(item.tier.label, (netTiers.get(item.tier.label) ?? 0) - 1);
    }
    for (const item of gaining) {
      netTiers.set(item.tier.label, (netTiers.get(item.tier.label) ?? 0) + 1);
    }

    return { losing, gaining, netTiers };
  }

  private renderTeamImpact(team1Name: string, team2Name: string): string {
    const impact1 = this.calculateTeamImpact(1);
    const impact2 = this.calculateTeamImpact(2);

    if (!impact1 && !impact2) return '';

    const renderColumn = (teamName: string, impact: ReturnType<typeof this.calculateTeamImpact>) => {
      if (!impact) return `<div class="team-impact-column"><h5>${teamName}</h5><p class="empty-text">No power ranking data</p></div>`;

      const overallDelta = impact.after.overall - impact.before.overall;
      const deltaClass = overallDelta >= 0 ? 'positive' : 'negative';
      const deltaSign = overallDelta >= 0 ? '+' : '';

      const renderRow = (label: string, before: number, after: number) => {
        const d = after - before;
        const cls = d >= 0.005 ? 'positive' : d <= -0.005 ? 'negative' : '';
        const sign = d >= 0 ? '+' : '';
        return `
          <div class="team-impact-row">
            <span class="impact-label">${label}</span>
            <span class="impact-values">${before.toFixed(2)} &rarr; ${after.toFixed(2)}</span>
            <span class="impact-delta ${cls}">${sign}${d.toFixed(2)}</span>
          </div>
        `;
      };

      const slotTags = [
        ...impact.losing.map(s => `<span class="slot-tag slot-out">&minus; ${s.slot} ${s.name} (${s.rating.toFixed(1)})</span>`),
        ...impact.gaining.map(s => `<span class="slot-tag slot-in">+ ${s.slot} ${s.name} (${s.rating.toFixed(1)})</span>`),
      ].join('');

      return `
        <div class="team-impact-column">
          <h5>${teamName}</h5>
          <div class="team-impact-overall ${deltaClass}">
            ${impact.before.overall.toFixed(2)} &rarr; ${impact.after.overall.toFixed(2)}
            <span class="impact-delta ${deltaClass}">${deltaSign}${overallDelta.toFixed(2)}</span>
          </div>
          ${renderRow('Rotation', impact.before.rotation, impact.after.rotation)}
          ${renderRow('Lineup', impact.before.lineup, impact.after.lineup)}
          ${renderRow('Bullpen', impact.before.bullpen, impact.after.bullpen)}
          ${renderRow('Bench', impact.before.bench, impact.after.bench)}
          <div class="team-impact-slots">${slotTags}</div>
        </div>
      `;
    };

    const renderFarmColumn = (teamName: string, farmImpact: ReturnType<typeof this.calculateFarmImpact>) => {
      const renderProspectItem = (item: { name: string; playerId: number; tfr: number; tier: { label: string; cls: string } }, type: 'lost' | 'gained') => {
        const icon = type === 'lost' ? '&minus;' : '+';
        const cls = type === 'lost' ? 'slot-out' : 'slot-in';
        return `
          <div class="farm-impact-item ${cls}">
            <span class="farm-impact-icon">${icon}</span>
            <span class="player-name-link" data-player-id="${item.playerId}">${item.name}</span>
            <span class="farm-impact-tfr">${item.tfr.toFixed(1)}</span>
            <span class="farm-impact-tier ${item.tier.cls}">${item.tier.label}</span>
          </div>
        `;
      };

      const netParts: string[] = [];
      for (const [tier, count] of farmImpact.netTiers) {
        if (count !== 0) {
          const sign = count > 0 ? '+' : '';
          netParts.push(`${sign}${count} ${tier}`);
        }
      }
      const netSummary = netParts.length > 0 ? netParts.join(', ') : 'No change';

      return `
        <div class="team-impact-column">
          <h5>${teamName}</h5>
          ${farmImpact.losing.length > 0 ? `
            <div class="farm-impact-group">
              <div class="farm-impact-group-label">Losing</div>
              ${farmImpact.losing.map(item => renderProspectItem(item, 'lost')).join('')}
            </div>
          ` : ''}
          ${farmImpact.gaining.length > 0 ? `
            <div class="farm-impact-group">
              <div class="farm-impact-group-label">Gaining</div>
              ${farmImpact.gaining.map(item => renderProspectItem(item, 'gained')).join('')}
            </div>
          ` : ''}
          ${farmImpact.losing.length === 0 && farmImpact.gaining.length === 0 ? `
            <p class="empty-text">No prospects in this side of the trade</p>
          ` : `
            <div class="farm-impact-net">Net: ${netSummary}</div>
          `}
        </div>
      `;
    };

    const farm1 = this.calculateFarmImpact(1);
    const farm2 = this.calculateFarmImpact(2);
    const hasFarmAssets = farm1.losing.length > 0 || farm1.gaining.length > 0 || farm2.losing.length > 0 || farm2.gaining.length > 0;

    return `
      <div class="team-impact-section">
        <div class="impact-tab-header">
          <h5>Team Impact</h5>
          ${hasFarmAssets ? `
            <div class="impact-tab-toggle">
              <button class="impact-tab-btn active" data-tab="roster">Roster</button>
              <button class="impact-tab-btn" data-tab="farm">Farm</button>
            </div>
          ` : ''}
        </div>
        <div class="impact-tab-content" data-tab="roster">
          <div class="team-impact-grid">
            ${renderColumn(team1Name, impact1)}
            ${renderColumn(team2Name, impact2)}
          </div>
        </div>
        ${hasFarmAssets ? `
          <div class="impact-tab-content" data-tab="farm" style="display: none;">
            <div class="team-impact-grid">
              ${renderFarmColumn(team1Name, farm1)}
              ${renderFarmColumn(team2Name, farm2)}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  private async requestAIAnalysis(): Promise<void> {
    const btn = this.container.querySelector<HTMLButtonElement>('.ai-trade-btn');
    const resultDiv = this.container.querySelector<HTMLElement>('.ai-trade-result');
    if (!btn || !resultDiv) return;

    btn.disabled = true;
    btn.textContent = 'Analyzing...';
    resultDiv.innerHTML = '<div class="ai-loading"><span class="ai-loading-text">Generating trade analysis...</span></div>';

    try {
      const team1 = this.allTeams.find(t => t.id === this.team1State.teamId);
      const team2 = this.allTeams.find(t => t.id === this.team2State.teamId);
      const team1Name = team1?.nickname ?? 'Team 1';
      const team2Name = team2?.nickname ?? 'Team 2';

      const posLabels: Record<number, string> = { 1: 'SP', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH' };

      const buildPlayerContexts = (state: TradeTeamState): TradePlayerContext[] => {
        const contexts: TradePlayerContext[] = [];
        for (const p of state.tradingPlayers) {
          const contract = this.allContracts.get(p.playerId);
          contexts.push({
            name: p.name,
            role: p.isSp ? 'SP' : 'RP',
            age: p.age,
            trueRating: p.currentTrueRating,
            trueFutureRating: p.projectedTrueRating !== p.currentTrueRating ? p.projectedTrueRating : undefined,
            projectedWar: p.projectedStats.war,
            projectedFip: p.projectedStats.fip,
            salary: contract ? contractService.getCurrentSalary(contract) : undefined,
            contractYears: contract ? contractService.getYearsRemaining(contract) : undefined,
            isProspect: p.isProspect ?? false,
          });
        }
        for (const b of state.tradingBatters) {
          const contract = this.allContracts.get(b.playerId);
          contexts.push({
            name: b.name,
            role: posLabels[b.position] || 'UT',
            age: b.age,
            trueRating: b.currentTrueRating,
            projectedWar: b.projectedStats.war,
            projectedWoba: b.projectedStats.woba,
            salary: contract ? contractService.getCurrentSalary(contract) : undefined,
            contractYears: contract ? contractService.getYearsRemaining(contract) : undefined,
            isProspect: !this.allBatterProjections.has(b.playerId),
          });
        }
        return contexts;
      };

      const buildPickContexts = (state: TradeTeamState): TradePickContext[] => {
        return state.tradingPicks.map(p => ({ displayName: p.displayName, estimatedValue: p.estimatedValue }));
      };

      const ranking1 = this.powerRankingsMap.get(this.team1State.teamId);
      const ranking2 = this.powerRankingsMap.get(this.team2State.teamId);
      const impact1 = this.calculateTeamImpact(1);
      const impact2 = this.calculateTeamImpact(2);

      const analysis = this.calculateTradeAnalysis();

      const context: TradeContext = {
        team1: {
          teamName: team1Name,
          teamRating: ranking1?.teamRating,
          rotationRating: ranking1?.rotationRating,
          bullpenRating: ranking1?.bullpenRating,
          lineupRating: ranking1?.lineupRating,
          benchRating: ranking1?.benchRating,
          sending: buildPlayerContexts(this.team1State),
          sendingPicks: buildPickContexts(this.team1State),
          postTradeRating: impact1?.after.overall,
          postRotationRating: impact1?.after.rotation,
          postBullpenRating: impact1?.after.bullpen,
          postLineupRating: impact1?.after.lineup,
          postBenchRating: impact1?.after.bench,
        },
        team2: {
          teamName: team2Name,
          teamRating: ranking2?.teamRating,
          rotationRating: ranking2?.rotationRating,
          bullpenRating: ranking2?.bullpenRating,
          lineupRating: ranking2?.lineupRating,
          benchRating: ranking2?.benchRating,
          sending: buildPlayerContexts(this.team2State),
          sendingPicks: buildPickContexts(this.team2State),
          postTradeRating: impact2?.after.overall,
          postRotationRating: impact2?.after.rotation,
          postBullpenRating: impact2?.after.bullpen,
          postLineupRating: impact2?.after.lineup,
          postBenchRating: impact2?.after.bench,
        },
        team1TotalWar: analysis.team1WarChange,
        team2TotalWar: analysis.team2WarChange,
      };

      const blurb = await aiTradeAnalysisService.getTradeAnalysis(context);
      resultDiv.innerHTML = `<div class="ai-trade-content">${markdownToHtml(blurb)}</div>`;
    } catch (e: any) {
      console.error('AI trade analysis failed:', e);
      resultDiv.innerHTML = `<div class="ai-error">Failed to generate analysis: ${e.message || 'Unknown error'}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Get AI Analysis';
    }
  }

  private isProspectPitcher(p: ProjectedPlayer): boolean {
    return p.isProspect === true;
  }

  private isProspectBatter(b: ProjectedBatter): boolean {
    return !this.allBatterProjections.has(b.playerId);
  }

  private calculateTeamWar(state: TradeTeamState): { current: number; future: number; total: number } {
    let current = 0;
    let future = 0;

    for (const p of state.tradingPlayers) {
      if (this.isProspectPitcher(p)) {
        future += p.projectedStats.war;
      } else {
        current += p.projectedStats.war;
      }
    }

    for (const b of state.tradingBatters) {
      if (this.isProspectBatter(b)) {
        future += b.projectedStats.war;
      } else {
        current += b.projectedStats.war;
      }
    }

    // Draft picks are always future
    for (const pick of state.tradingPicks) {
      future += pick.estimatedValue;
    }

    return { current, future, total: current + future };
  }

  private calculateTradeAnalysis(): TradeAnalysis {
    const team1War = this.calculateTeamWar(this.team1State);
    const team2War = this.calculateTeamWar(this.team2State);

    const team1WarChange = team1War.total;
    const team2WarChange = team2War.total;

    const team1Gain = team2WarChange > team1WarChange;
    const team2Gain = team1WarChange > team2WarChange;

    const team1Name = this.allTeams.find(t => t.id === this.team1State.teamId)?.nickname ?? 'Team 1';
    const team2Name = this.allTeams.find(t => t.id === this.team2State.teamId)?.nickname ?? 'Team 2';

    // Determine trade archetype for summary
    const totalCurrent = team1War.current + team2War.current;
    const totalFuture = team1War.future + team2War.future;
    const totalWar = totalCurrent + totalFuture;

    let summary = '';
    const warDiff = Math.abs(team1WarChange - team2WarChange);

    if (totalWar > 0) {
      const currentPct = totalCurrent / totalWar;
      const team1CurrentPct = team1War.total > 0 ? team1War.current / team1War.total : 0;
      const team2CurrentPct = team2War.total > 0 ? team2War.current / team2War.total : 0;

      // One side mostly current, other mostly future → win-now vs future
      if (Math.abs(team1CurrentPct - team2CurrentPct) > 0.5 && totalCurrent > 0 && totalFuture > 0) {
        const winNowTeam = team1CurrentPct > team2CurrentPct ? team2Name : team1Name;
        const futureTeam = team1CurrentPct > team2CurrentPct ? team1Name : team2Name;
        summary = `Win-now vs. future: ${winNowTeam} acquires MLB talent while ${futureTeam} stocks the farm.`;
      } else if (currentPct > 0.7) {
        summary = `Roster swap: both teams are exchanging current MLB value.`;
      } else if (currentPct < 0.3) {
        summary = `Prospect swap: both teams are exchanging future assets.`;
      }
    }

    // Append WAR comparison
    if (warDiff < 0.5) {
      summary += summary ? ' ' : '';
      summary += `Roughly even WAR value on both sides.`;
    } else if (team1Gain) {
      summary += summary ? ' ' : '';
      summary += `${team1Name} gains ~${warDiff.toFixed(1)} more WAR in total value.`;
    } else {
      summary += summary ? ' ' : '';
      summary += `${team2Name} gains ~${warDiff.toFixed(1)} more WAR in total value.`;
    }

    return {
      team1WarChange,
      team2WarChange,
      team1CurrentWar: team1War.current,
      team2CurrentWar: team2War.current,
      team1FutureWar: team1War.future,
      team2FutureWar: team2War.future,
      team1Gain,
      team2Gain,
      summary
    };
  }
}
