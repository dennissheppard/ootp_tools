import { Player, getFullName, isPitcher } from '../models/Player';
import { playerService } from '../services/PlayerService';
import { teamService } from '../services/TeamService';
import { projectionService, ProjectedPlayer } from '../services/ProjectionService';
import { Team } from '../models/Team';
import { dateService } from '../services/DateService';
import { scoutingDataFallbackService } from '../services/ScoutingDataFallbackService';
import { PitcherScoutingRatings } from '../models/ScoutingData';
import { trueFutureRatingService } from '../services/TrueFutureRatingService';
import { minorLeagueStatsService } from '../services/MinorLeagueStatsService';
import { MinorLeagueStatsWithLevel } from '../models/Stats';
import { fipWarService } from '../services/FipWarService';
import { PlayerProfileModal } from './PlayerProfileModal';

interface TradeTeamState {
  teamId: number;
  minorLevel: string;
  tradingPlayers: ProjectedPlayer[];
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
  private minorLeagueStats: Map<number, MinorLeagueStatsWithLevel[]> = new Map();
  private currentYear: number = 2022;
  private playerProfileModal: PlayerProfileModal;

  private team1State: TradeTeamState = { teamId: 0, minorLevel: 'mlb', tradingPlayers: [] };
  private team2State: TradeTeamState = { teamId: 0, minorLevel: 'mlb', tradingPlayers: [] };

  constructor(container: HTMLElement) {
    this.container = container;
    this.playerProfileModal = new PlayerProfileModal();
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

    const scouting = this.allScoutingRatings.get(playerId);
    const projection = this.allProjections.get(playerId);
    const team = this.allTeams.find(t => t.id === player.teamId);

    // Construct PlayerRatingsData
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

    await this.playerProfileModal.show(profileData, this.currentYear);
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
            </select>
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
            </select>
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

    // Clear buttons
    this.container.querySelectorAll('.clear-trade-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const teamNum = parseInt((btn as HTMLElement).dataset.team!) as 1 | 2;
        this.clearTeamTrade(teamNum);
      });
    });
  }

  private onTeamChange(teamNum: 1 | 2): void {
    const select = this.container.querySelector<HTMLSelectElement>(`.trade-team-select[data-team="${teamNum}"]`);
    if (!select) return;

    const teamId = parseInt(select.value);
    const state = teamNum === 1 ? this.team1State : this.team2State;
    state.teamId = teamId;
    state.tradingPlayers = [];

    this.updatePlayerList(teamNum);
    this.updateAnalysis();
  }

  private onLevelChange(teamNum: 1 | 2): void {
    const select = this.container.querySelector<HTMLSelectElement>(`.trade-level-select[data-team="${teamNum}"]`);
    if (!select) return;

    const state = teamNum === 1 ? this.team1State : this.team2State;
    state.minorLevel = select.value;

    this.updatePlayerList(teamNum);
  }

  private getPlayersByTeamAndLevel(teamId: number, level: string): Player[] {
    if (teamId === 0) {
      console.log('No team selected');
      return [];
    }

    console.log(`Filtering players: teamId=${teamId}, level=${level}, total players=${this.allPlayers.length}`);

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

    // Filter for pitchers only
    const pitchers = filtered.filter(p => isPitcher(p));
    console.log(`After pitcher filter: ${pitchers.length} pitchers`);

    return pitchers.sort((a, b) => a.lastName.localeCompare(b.lastName));
  }

  private updatePlayerList(teamNum: 1 | 2): void {
    const state = teamNum === 1 ? this.team1State : this.team2State;
    const listContainer = this.container.querySelector<HTMLElement>(`.trade-player-list[data-team="${teamNum}"]`);
    if (!listContainer) return;

    const players = this.getPlayersByTeamAndLevel(state.teamId, state.minorLevel);
    console.log(`Team ${teamNum}: Found ${players.length} players for teamId=${state.teamId}, level=${state.minorLevel}`);

    if (players.length === 0) {
      listContainer.innerHTML = '<div class="empty-text">No pitchers found at this level</div>';
      return;
    }

    listContainer.innerHTML = players.map((player, index) => {
      const projection = this.allProjections.get(player.id);
      const scouting = this.allScoutingRatings.get(player.id);

      // Debug first few players
      if (index < 3) {
        console.log(`Player ${getFullName(player)} (ID: ${player.id}):`, {
          hasProjection: !!projection,
          currentTrueRating: projection?.currentTrueRating,
          hasScouting: !!scouting,
          scoutingRatings: scouting ? { stuff: scouting.stuff, control: scouting.control, hra: scouting.hra } : null,
          teamId: player.teamId,
          parentTeamId: player.parentTeamId,
          level: player.level,
          age: player.age
        });
      }

      // Try to get rating from projection first, then fall back to TFR (True Future Rating)
      let trueRating = projection?.currentTrueRating ?? 0;
      let ratingSource = 'projection';

      // If no projection, calculate TFR from scouting + minor league stats
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

          // Calculate TFR from projected FIP percentile
          // We'll use a simple mapping since we don't have full MLB context here
          const fip = tfrResult.projFip;
          let percentile = 50; // Default to average
          if (fip < 3.0) percentile = 90;
          else if (fip < 3.5) percentile = 75;
          else if (fip < 4.0) percentile = 60;
          else if (fip < 4.5) percentile = 50;
          else if (fip < 5.0) percentile = 35;
          else if (fip < 5.5) percentile = 20;
          else percentile = 10;

          // Convert percentile to 0.5-5.0 rating scale
          trueRating = this.percentileToRating(percentile);
          ratingSource = 'tfr';
        } catch (e) {
          // Fallback to simple scouting average if TFR calculation fails
          const avgScoutRating = (scouting.stuff + scouting.control + scouting.hra) / 3;
          trueRating = ((avgScoutRating - 20) / 60) * 4.5 + 0.5;
          ratingSource = 'scouting';
        }
      }

      const hasRating = trueRating > 0;
      const rating = hasRating ? trueRating.toFixed(1) : 'N/A';
      const ratingLabel = hasRating ? (ratingSource === 'projection' ? '⭐ ' : '◈ ') : '';

      return `
        <div class="trade-player-item" draggable="true" data-player-id="${player.id}" data-team="${teamNum}">
          <div class="player-name player-name-link" data-player-id="${player.id}">${getFullName(player)}</div>
          <div class="player-rating">${hasRating ? ratingLabel + rating : rating}</div>
        </div>
      `;
    }).join('');

    // Setup drag handlers
    this.setupDragHandlers(teamNum);
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

    // Avoid duplicates
    if (state.tradingPlayers.find(p => p.playerId === playerId)) return;

    let projection = this.allProjections.get(playerId);

    // If no projection exists, create one using TFR (True Future Rating)
    if (!projection) {
      const player = this.allPlayers.find(p => p.id === playerId);
      const scouting = this.allScoutingRatings.get(playerId);

      if (!player) {
        console.warn(`Player ${playerId} not found`);
        return;
      }

      if (!scouting) {
        console.warn(`No scouting data for player ${playerId}`);
        return;
      }

      const playerMinorStats = this.minorLeagueStats.get(playerId) || [];
      const team = this.allTeams.find(t => t.id === player.teamId);

      try {
        // Calculate True Future Rating (peak projection)
        const tfrResult = trueFutureRatingService.calculateTrueFutureRating({
          playerId: player.id,
          playerName: getFullName(player),
          age: player.age,
          scouting,
          minorLeagueStats: playerMinorStats
        });

        // Estimate percentile from FIP (simplified - ideally we'd use actual MLB distribution)
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

        // Calculate projected WAR using FIP and estimated IP
        const projectedIp = 150; // Assume SP projection for prospects
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

        console.log(`Created TFR projection for ${getFullName(player)}:`, {
          trueRating,
          projFip: tfrResult.projFip,
          projWar: warResult.war,
          totalMinorIp: tfrResult.totalMinorIp
        });
      } catch (e) {
        console.error(`Failed to calculate TFR for player ${playerId}:`, e);
        return;
      }
    }

    state.tradingPlayers.push(projection);
    this.updateBucket(teamNum);
    this.updateAnalysis();
  }

  private updateBucket(teamNum: 1 | 2): void {
    const state = teamNum === 1 ? this.team1State : this.team2State;
    const bucket = this.container.querySelector<HTMLElement>(`.trade-bucket[data-team="${teamNum}"]`);
    if (!bucket) return;

    bucket.innerHTML = state.tradingPlayers.map(player => `
      <div class="trade-bucket-item">
        <span class="bucket-player-name">${player.name}</span>
        <button class="bucket-remove-btn" data-player-id="${player.playerId}" data-team="${teamNum}">×</button>
      </div>
    `).join('');

    bucket.querySelectorAll('.bucket-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const playerId = parseInt((btn as HTMLElement).dataset.playerId!);
        state.tradingPlayers = state.tradingPlayers.filter(p => p.playerId !== playerId);
        this.updateBucket(teamNum);
        this.updateAnalysis();
      });
    });
  }

  private clearTeamTrade(teamNum: 1 | 2): void {
    const state = teamNum === 1 ? this.team1State : this.team2State;
    state.tradingPlayers = [];
    this.updateBucket(teamNum);
    this.updateAnalysis();
  }

  private updateAnalysis(): void {
    const contentDiv = this.container.querySelector<HTMLElement>('.trade-analysis-content');
    if (!contentDiv) return;

    if (this.team1State.tradingPlayers.length === 0 && this.team2State.tradingPlayers.length === 0) {
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
            ${this.team1State.tradingPlayers.length > 0 ? `
              <div class="player-war-list">
                ${this.team1State.tradingPlayers.map(p => `
                  <div class="player-war-item">
                    <span>${p.name}</span>
                    <span class="war-value">${p.projectedStats.war.toFixed(1)} WAR</span>
                  </div>
                `).join('')}
              </div>
            ` : '<p class="empty-text">No players selected</p>'}
          </div>
        </div>

        <div class="war-column war-column-2">
          <h5>${team2Name}</h5>
          <div class="war-change ${analysis.team2Gain ? 'positive' : 'negative'}">
            ${analysis.team2Gain ? '+' : ''}${analysis.team2WarChange.toFixed(1)} WAR
          </div>
          <div class="war-detail">
            ${this.team2State.tradingPlayers.length > 0 ? `
              <div class="player-war-list">
                ${this.team2State.tradingPlayers.map(p => `
                  <div class="player-war-item">
                    <span>${p.name}</span>
                    <span class="war-value">${p.projectedStats.war.toFixed(1)} WAR</span>
                  </div>
                `).join('')}
              </div>
            ` : '<p class="empty-text">No players selected</p>'}
          </div>
        </div>
      </div>

      <div class="trade-ratings-comparison">
        <h5>Player Ratings Comparison</h5>
        ${this.renderRatingsTable()}
      </div>
    `;
  }

  private renderRatingsTable(): string {
    const allPlayers = [...this.team1State.tradingPlayers, ...this.team2State.tradingPlayers];

    if (allPlayers.length === 0) {
      return '<p class="empty-text">Add players to view ratings</p>';
    }

    return `
      <table class="trade-ratings-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>True Rating</th>
            <th>Projected FIP</th>
            <th>K/9</th>
            <th>BB/9</th>
            <th>Stuff</th>
            <th>Control</th>
          </tr>
        </thead>
        <tbody>
          ${allPlayers.map(p => `
            <tr>
              <td>${p.name}</td>
              <td>${p.currentTrueRating.toFixed(1)}⭐</td>
              <td>${p.projectedStats.fip.toFixed(2)}</td>
              <td>${p.projectedStats.k9.toFixed(2)}</td>
              <td>${p.projectedStats.bb9.toFixed(2)}</td>
              <td>${p.projectedRatings.stuff.toFixed(0)}</td>
              <td>${p.projectedRatings.control.toFixed(0)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  private calculateTradeAnalysis(): TradeAnalysis {
    const team1WarChange = this.team1State.tradingPlayers.reduce((sum, p) => sum + p.projectedStats.war, 0);
    const team2WarChange = this.team2State.tradingPlayers.reduce((sum, p) => sum + p.projectedStats.war, 0);

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
