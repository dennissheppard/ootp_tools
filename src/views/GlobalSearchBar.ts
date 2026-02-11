import { Player, getFullName, getPositionLabel, isPitcher } from '../models/Player';
import { PlayerProfileModal, PlayerProfileData } from './PlayerProfileModal';
import { BatterProfileModal, BatterProfileData } from './BatterProfileModal';
import { OnboardingView } from './OnboardingView';
import { playerService } from '../services/PlayerService';
import { dateService } from '../services/DateService';
import { trueRatingsService, TruePlayerStats, TruePlayerBattingStats } from '../services/TrueRatingsService';
import { trueRatingsCalculationService } from '../services/TrueRatingsCalculationService';
import { hitterTrueRatingsCalculationService } from '../services/HitterTrueRatingsCalculationService';
import { scoutingDataService } from '../services/ScoutingDataService';
import { hitterScoutingDataService } from '../services/HitterScoutingDataService';
import { trueFutureRatingService } from '../services/TrueFutureRatingService';
import { teamService } from '../services/TeamService';
import { teamRatingsService } from '../services/TeamRatingsService';
import { fipWarService } from '../services/FipWarService';
import { leagueStatsService } from '../services/LeagueStatsService';

export interface GlobalSearchBarOptions {
  onSearch: (query: string) => void;
  onLoading?: (isLoading: boolean) => void;
}

export class GlobalSearchBar {
  private container: HTMLElement;
  private searchInput!: HTMLInputElement;
  private dropdown!: HTMLElement;
  private onSearch: (query: string) => void;
  private onLoading?: (isLoading: boolean) => void;
  private players: Player[] = [];
  private isOpen = false;
  private selectedIndex = -1;
  private debounceTimer?: number;
  private playerProfileModal: PlayerProfileModal;
  private batterProfileModal: BatterProfileModal;
  private onboardingView: OnboardingView;

  constructor(container: HTMLElement, options: GlobalSearchBarOptions) {
    this.container = container;
    this.onSearch = options.onSearch;
    this.onLoading = options.onLoading;
    this.playerProfileModal = new PlayerProfileModal();
    this.batterProfileModal = new BatterProfileModal();
    this.onboardingView = new OnboardingView();
    this.render();
    this.attachEventListeners();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="global-search">
        <div class="global-search-input-wrapper">
          <svg class="global-search-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            class="global-search-input"
            placeholder="Search players..."
            autocomplete="off"
          />
          <button class="global-search-clear" style="display: none;" aria-label="Clear search">
            &times;
          </button>
        </div>
        <div class="global-search-dropdown" style="display: none;">
          <div class="global-search-results"></div>
        </div>
      </div>
    `;

    this.searchInput = this.container.querySelector('.global-search-input')!;
    this.dropdown = this.container.querySelector('.global-search-dropdown')!;
  }

  private attachEventListeners(): void {
    // Input event with debounce
    this.searchInput.addEventListener('input', () => {
      this.updateClearButton();

      if (this.debounceTimer) {
        window.clearTimeout(this.debounceTimer);
      }

      const query = this.searchInput.value.trim();
      if (query.length === 0) {
        this.closeDropdown();
        return;
      }

      this.debounceTimer = window.setTimeout(() => {
        this.handleSearch(query);
      }, 300);
    });

    // Keyboard navigation
    this.searchInput.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.players.length - 1);
        this.updateSelection();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, -1);
        this.updateSelection();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.selectedIndex >= 0 && this.players[this.selectedIndex]) {
          this.handlePlayerSelect(this.players[this.selectedIndex]);
        } else if (this.players.length === 1) {
          this.handlePlayerSelect(this.players[0]);
        }
      } else if (e.key === 'Escape') {
        this.closeDropdown();
      }
    });

    // Clear button
    const clearButton = this.container.querySelector<HTMLButtonElement>('.global-search-clear')!;
    clearButton.addEventListener('click', () => {
      this.searchInput.value = '';
      this.updateClearButton();
      this.closeDropdown();
      this.searchInput.focus();
    });

    // Click outside to close
    document.addEventListener('click', (e) => {
      if (!this.container.contains(e.target as Node)) {
        this.closeDropdown();
      }
    });

    // Focus to open if there are results
    this.searchInput.addEventListener('focus', () => {
      if (this.players.length > 0) {
        this.openDropdown();
      }
    });
  }

  private handleSearch(query: string): void {
    // Check for special "aboutTR" query to show onboarding guide
    if (query.toLowerCase() === 'abouttr') {
      this.closeDropdown();
      this.onboardingView.show();
      if (this.onLoading) {
        this.onLoading(false);
      }
      return;
    }

    if (this.onLoading) {
      this.onLoading(true);
    }
    this.onSearch(query);
  }

  private updateClearButton(): void {
    const clearButton = this.container.querySelector<HTMLButtonElement>('.global-search-clear')!;
    clearButton.style.display = this.searchInput.value.length > 0 ? 'flex' : 'none';
  }

  renderResults(players: Player[]): void {
    this.players = players;
    this.selectedIndex = -1;

    if (this.onLoading) {
      this.onLoading(false);
    }

    if (players.length === 0) {
      const resultsContainer = this.dropdown.querySelector<HTMLElement>('.global-search-results')!;
      resultsContainer.innerHTML = `
        <div class="global-search-empty">
          No players found
        </div>
      `;
      this.openDropdown();
      return;
    }

    const resultsContainer = this.dropdown.querySelector<HTMLElement>('.global-search-results')!;
    const limitedPlayers = players.slice(0, 50);

    resultsContainer.innerHTML = `
      <div class="global-search-count">${players.length} player${players.length !== 1 ? 's' : ''} found</div>
      <ul class="global-search-list">
        ${limitedPlayers.map((player, index) => this.renderPlayerItem(player, index)).join('')}
      </ul>
      ${players.length > 50 ? `<div class="global-search-more">+${players.length - 50} more results. Refine your search.</div>` : ''}
    `;

    this.attachResultListeners();
    this.openDropdown();
  }

  private renderPlayerItem(player: Player, index: number): string {
    const posLabel = getPositionLabel(player.position);
    const retiredBadge = player.retired ? '<span class="badge badge-retired">Retired</span>' : '';

    return `
      <li class="global-search-item" data-index="${index}">
        <span class="player-name">${this.escapeHtml(getFullName(player))}</span>
        <span class="player-position">${posLabel}</span>
        ${retiredBadge}
      </li>
    `;
  }

  private attachResultListeners(): void {
    const items = this.dropdown.querySelectorAll('.global-search-item');
    items.forEach((item) => {
      item.addEventListener('click', () => {
        const index = parseInt(item.getAttribute('data-index') || '0', 10);
        const player = this.players[index];
        if (player) {
          this.handlePlayerSelect(player);
        }
      });

      item.addEventListener('mouseenter', () => {
        const index = parseInt(item.getAttribute('data-index') || '0', 10);
        this.selectedIndex = index;
        this.updateSelection();
      });
    });
  }

  private async handlePlayerSelect(player: Player): Promise<void> {
    this.closeDropdown();

    // Fetch the player's ratings data and show modal
    try {
      const currentYear = await dateService.getCurrentYear();

      // Check if player is a pitcher or batter
      if (isPitcher(player)) {
        const ratingsData = await this.fetchPlayerRatingsData(player.id, currentYear);
        if (ratingsData) {
          await this.playerProfileModal.show(ratingsData, currentYear);
        } else {
          console.error('Failed to build ratings data for player', player.id);
          alert(`Unable to load profile for ${player.firstName} ${player.lastName}. Please try again.`);
        }
      } else {
        const batterData = await this.fetchBatterRatingsData(player.id, currentYear);
        if (batterData) {
          await this.batterProfileModal.show(batterData, currentYear);
        } else {
          console.error('Failed to build batter data for player', player.id);
          alert(`Unable to load profile for ${player.firstName} ${player.lastName}. Please try again.`);
        }
      }
    } catch (error) {
      console.error('Failed to load player profile:', error);
    }
  }

  private async fetchPlayerRatingsData(playerId: number, year: number): Promise<PlayerProfileData | null> {
    try {
      // Get player info
      const player = await playerService.getPlayerById(playerId);
      if (!player) {
        return null;
      }

      const playerName = getFullName(player);

      // Get team info
      let teamLabel: string | undefined;
      let parentLabel: string | undefined;

      if (player.teamId) {
        const team = await teamService.getTeamById(player.teamId);
        if (team) {
          const currentTeamLabel = `${team.name} ${team.nickname}`;

          if (team.parentTeamId !== 0) {
            // Player is on a minor league team
            const parent = await teamService.getTeamById(team.parentTeamId);
            if (parent) {
              // Show parent team as main, minor league team in parens
              teamLabel = parent.nickname;
              parentLabel = currentTeamLabel;
            } else {
              // Fallback if parent not found
              teamLabel = currentTeamLabel;
            }
          } else {
            // Player is on a major league team
            teamLabel = currentTeamLabel;
          }
        }
      }

      // Fetch both 'my' and OSA scout data for UI display toggle
      const [myScoutingRatings, osaScoutingRatings] = await Promise.all([
        scoutingDataService.getLatestScoutingRatings('my'),
        scoutingDataService.getLatestScoutingRatings('osa')
      ]);

      const myScoutingLookup = this.buildScoutingLookup(myScoutingRatings);
      const osaScoutingLookup = this.buildScoutingLookup(osaScoutingRatings);

      const myScoutMatch = this.resolveScoutingFromLookup(playerId, playerName, myScoutingLookup);
      const osaScoutMatch = this.resolveScoutingFromLookup(playerId, playerName, osaScoutingLookup);

      // For calculations, use fallback (my > osa)
      const scoutingLookup = myScoutingRatings.length > 0 ? myScoutingLookup : osaScoutingLookup;
      const scoutMatch = myScoutMatch || osaScoutMatch;

      // Try to get True Rating from cached data
      let allPitchers: TruePlayerStats[] = [];
      try {
        allPitchers = await trueRatingsService.getTruePitchingStats(year);
      } catch (error) {
        console.warn('No MLB pitching stats available for year:', year, error);
      }
      const playerStats = allPitchers.find(p => p.player_id === playerId);

      let playerResult: any = null;
      let isProspect = false;
      let tfrData: any = null;

      // Only calculate True Ratings if we have stats and enough IP
      if (playerStats) {
        const ip = trueRatingsService.parseIp(playerStats.ip);
        if (ip >= 10) {
          // Get multi-year stats and league averages for True Rating calculation
          const [multiYearStats, leagueAverages] = await Promise.all([
            trueRatingsService.getMultiYearPitchingStats(year, 3),
            trueRatingsService.getLeagueAverages(year),
          ]);

          // Calculate True Rating with all pitchers for percentile ranking
          // Include scouting data for ALL pitchers to match TrueRatingsView calculation
          const allInputs = allPitchers
            .map(p => {
              const scouting = this.resolveScoutingFromLookup(p.player_id, p.playerName, scoutingLookup);
              return {
                playerId: p.player_id,
                playerName: p.playerName,
                yearlyStats: multiYearStats.get(p.player_id) ?? [],
                scoutingRatings: scouting ? {
                  playerId: p.player_id,
                  playerName: p.playerName,
                  stuff: scouting.stuff,
                  control: scouting.control,
                  hra: scouting.hra,
                } : undefined,
              };
            });

          const results = trueRatingsCalculationService.calculateTrueRatings(allInputs, leagueAverages);
          playerResult = results.find(r => r.playerId === playerId);
        }
      }

      // If no MLB True Rating and we have scouting data, get TFR from full prospect rankings
      let projectionOverride: PlayerProfileData['projectionOverride'] = undefined;

      if (!playerResult && scoutMatch) {
        try {
          // Get TFR for ALL prospects (required for proper percentile ranking)
          // Single-prospect calculation produces NaN due to division by zero in ranking
          const allTfrResults = await trueFutureRatingService.getProspectTrueFutureRatings(year);
          const tfrResult = allTfrResults.find(r => r.playerId === playerId);

          if (tfrResult) {
            isProspect = true;
            tfrData = tfrResult;

            // Use True Ratings from TFR (normalized from percentiles, 20-80 scale)
            playerResult = {
              estimatedStuff: tfrResult.trueStuff,
              estimatedControl: tfrResult.trueControl,
              estimatedHra: tfrResult.trueHra,
            };

            // Build projectionOverride to match FarmRankingsView
            // Calculate peakIp from stamina and injury ratings
            const stamina = scoutMatch.stamina ?? 50;
            const injury = scoutMatch.injuryProneness ?? 'Normal';
            const pitchCount = scoutMatch.pitches ? Object.values(scoutMatch.pitches).filter((r: any) => r >= 45).length : 0;
            const isSp = pitchCount >= 3 && stamina >= 30;

            let peakIp: number;
            if (isSp) {
              // SP: Peak workload formula (stamina 50 → 180 IP, 60 → 210 IP, 70 → 240 IP)
              const baseIp = 30 + (stamina * 3.0);
              let injuryFactor = 1.0;
              if (injury === 'Fragile') injuryFactor = 0.90;
              else if (injury === 'Durable') injuryFactor = 1.10;
              else if (injury === 'Wrecked') injuryFactor = 0.75;
              else if (injury === 'Ironman' || injury === 'Iron Man') injuryFactor = 1.15;
              peakIp = Math.round(Math.max(120, Math.min(260, baseIp * injuryFactor)));
            } else {
              // RP: 50-75 IP typical range
              const baseIp = 50 + (stamina * 0.5);
              let injuryFactor = 1.0;
              if (injury === 'Fragile') injuryFactor = 0.90;
              else if (injury === 'Durable') injuryFactor = 1.10;
              else if (injury === 'Wrecked') injuryFactor = 0.75;
              else if (injury === 'Ironman' || injury === 'Iron Man') injuryFactor = 1.15;
              peakIp = Math.round(Math.max(40, Math.min(80, baseIp * injuryFactor)));
            }

            // Calculate peakWar
            const leagueStats = await leagueStatsService.getLeagueStats(2020); // Use 2020 for consistent context
            const replacementFip = leagueStats.avgFip + 1.0;
            const runsPerWin = 8.5;
            const peakWar = fipWarService.calculateWar(tfrResult.projFip, peakIp, replacementFip, runsPerWin);

            projectionOverride = {
              projectedStats: {
                k9: tfrResult.projK9,
                bb9: tfrResult.projBb9,
                hr9: tfrResult.projHr9,
                fip: tfrResult.projFip,
                war: peakWar,
                ip: peakIp,
              },
              projectedRatings: {
                stuff: tfrResult.trueStuff,
                control: tfrResult.trueControl,
                hra: tfrResult.trueHra,
              },
            };
          } else {
            // Player not in TFR results - use scouting ratings directly
            playerResult = {
              estimatedStuff: scoutMatch.stuff,
              estimatedControl: scoutMatch.control,
              estimatedHra: scoutMatch.hra,
            };
          }
        } catch (error) {
          console.warn('Error getting TFR:', error);
          // Fallback to scouting ratings
          playerResult = {
            estimatedStuff: scoutMatch.stuff,
            estimatedControl: scoutMatch.control,
            estimatedHra: scoutMatch.hra,
          };
        }
      }

      // Always show the modal, even without scouting or MLB data
      // We can still display player info, team, and minor league stats

      // Extract pitch data from scouting
      const pitchData = (scoutMatch as any)?.pitches;
      const pitches = pitchData ? Object.keys(pitchData) : [];
      const pitchRatings = pitchData ?? {};
      const pitchCount = pitchData ? Object.values(pitchData).filter((rating: any) => rating >= 45).length : 0;

      // Build the profile data - undefined values will show as placeholders in the modal
      return {
        playerId,
        playerName,
        team: teamLabel,
        parentTeam: parentLabel,
        age: player.age,
        positionLabel: getPositionLabel(player.position),
        trueRating: playerResult?.trueRating,
        percentile: playerResult?.percentile,
        estimatedStuff: playerResult?.estimatedStuff,
        estimatedControl: playerResult?.estimatedControl,
        estimatedHra: playerResult?.estimatedHra,

        // My Scout data
        scoutStuff: myScoutMatch?.stuff,
        scoutControl: myScoutMatch?.control,
        scoutHra: myScoutMatch?.hra,
        scoutStamina: myScoutMatch?.stamina,
        scoutInjuryProneness: myScoutMatch?.injuryProneness,
        scoutOvr: (myScoutMatch as any)?.ovr,
        scoutPot: (myScoutMatch as any)?.pot,

        // OSA data
        osaStuff: osaScoutMatch?.stuff,
        osaControl: osaScoutMatch?.control,
        osaHra: osaScoutMatch?.hra,
        osaStamina: osaScoutMatch?.stamina,
        osaInjuryProneness: osaScoutMatch?.injuryProneness,
        osaOvr: (osaScoutMatch as any)?.ovr,
        osaPot: (osaScoutMatch as any)?.pot,

        // Toggle state
        activeScoutSource: myScoutMatch ? 'my' : 'osa',
        hasMyScout: !!myScoutMatch,
        hasOsaScout: !!osaScoutMatch,

        pitchCount,
        pitches,
        pitchRatings,
        isProspect,
        trueFutureRating: tfrData?.trueFutureRating,
        tfrPercentile: tfrData?.percentile,
        year,
        projectionYear: year,
        projectionBaseYear: Math.max(2000, year - 1),
        forceProjection: isProspect, // Force peak projection for prospects
        projectionOverride, // Pass pre-calculated TFR projection to match FarmRankingsView
      };
    } catch (error) {
      console.error('Error fetching player ratings:', error);
      return null;
    }
  }

  private async fetchBatterRatingsData(playerId: number, year: number): Promise<BatterProfileData | null> {
    try {
      // Get player info
      const player = await playerService.getPlayerById(playerId);
      if (!player) {
        return null;
      }

      const playerName = getFullName(player);

      // Get team info
      let teamLabel: string | undefined;
      let parentLabel: string | undefined;

      if (player.teamId) {
        const team = await teamService.getTeamById(player.teamId);
        if (team) {
          const currentTeamLabel = `${team.name} ${team.nickname}`;

          if (team.parentTeamId !== 0) {
            const parent = await teamService.getTeamById(team.parentTeamId);
            if (parent) {
              teamLabel = parent.nickname;
              parentLabel = currentTeamLabel;
            } else {
              teamLabel = currentTeamLabel;
            }
          } else {
            teamLabel = currentTeamLabel;
          }
        }
      }

      // Get batting stats
      let allBatters: TruePlayerBattingStats[] = [];
      try {
        allBatters = await trueRatingsService.getTrueBattingStats(year);
      } catch (error) {
        console.warn('No MLB batting stats available for year:', year, error);
      }
      const batterStats = allBatters.find(b => b.player_id === playerId);

      let trueRating: number | undefined;
      let percentile: number | undefined;
      let woba: number | undefined;
      let estimatedPower: number | undefined;
      let estimatedEye: number | undefined;
      let estimatedAvoidK: number | undefined;
      let estimatedContact: number | undefined;
      let isProspect = false;

      // Calculate True Ratings if we have stats
      if (batterStats && batterStats.pa && batterStats.pa >= 50) {
        const [multiYearStats] = await Promise.all([
          trueRatingsService.getMultiYearBattingStats(year),
        ]);

        const batterYearlyStats = multiYearStats.get(playerId) ?? [];

        if (batterYearlyStats.length > 0) {
          // Get hitter scouting data
          const [myHitterScoutingRatings, osaHitterScoutingRatings] = await Promise.all([
            hitterScoutingDataService.getLatestScoutingRatings('my'),
            hitterScoutingDataService.getLatestScoutingRatings('osa')
          ]);

          const myHitterLookup = this.buildHitterScoutingLookup(myHitterScoutingRatings);
          const osaHitterLookup = this.buildHitterScoutingLookup(osaHitterScoutingRatings);

          // Calculate True Rating with all batters for percentile ranking
          const leagueAverages = hitterTrueRatingsCalculationService.getDefaultLeagueAverages();
          const allInputs = allBatters
            .map(b => {
              const yearlyStats = multiYearStats.get(b.player_id) ?? [];
              if (yearlyStats.length === 0) return null;

              const totalPa = yearlyStats.reduce((sum, stat) => sum + stat.pa, 0);
              if (totalPa < 100) return null;

              const scouting = this.resolveHitterScoutingFromLookup(b.player_id, b.playerName, myHitterLookup) ||
                               this.resolveHitterScoutingFromLookup(b.player_id, b.playerName, osaHitterLookup);

              return {
                playerId: b.player_id,
                playerName: b.playerName,
                yearlyStats,
                scoutingRatings: scouting ? {
                  playerId: b.player_id,
                  playerName: b.playerName,
                  power: scouting.power,
                  contact: scouting.contact,
                  eye: scouting.eye,
                  avoidK: scouting.avoidK,
                  gap: scouting.gap,
                  speed: scouting.speed,
                  ovr: scouting.ovr ?? 0,
                  pot: scouting.pot ?? 0,
                } : undefined,
              };
            })
            .filter((input): input is NonNullable<typeof input> => input !== null);

          const results = hitterTrueRatingsCalculationService.calculateTrueRatings(allInputs, leagueAverages);
          const batterResult = results.find(r => r.playerId === playerId);

          if (batterResult) {
            trueRating = batterResult.trueRating;
            percentile = batterResult.percentile;
            woba = batterResult.woba;
            estimatedPower = batterResult.estimatedPower;
            estimatedEye = batterResult.estimatedEye;
            estimatedAvoidK = batterResult.estimatedAvoidK;
            estimatedContact = batterResult.estimatedContact;
          }
        }
      } else {
        isProspect = true;
      }

      // Calculate SLG from raw data if available
      let slg: number | undefined;
      if (batterStats && batterStats.ab && batterStats.ab > 0) {
        const singles = (batterStats.h ?? 0) - (batterStats.d ?? 0) - (batterStats.t ?? 0) - (batterStats.hr ?? 0);
        slg = (singles + 2 * (batterStats.d ?? 0) + 3 * (batterStats.t ?? 0) + 4 * (batterStats.hr ?? 0)) / batterStats.ab;
      }

      // Look up TFR data from unified hitter TFR data (covers both prospects and young MLB players)
      let trueFutureRating: number | undefined;
      let tfrPercentile: number | undefined;
      let projWar: number | undefined;
      let projWoba: number | undefined;
      let projAvg: number | undefined;
      let projObp: number | undefined;
      let projSlg: number | undefined;
      let projPa: number | undefined;
      let projBbPct: number | undefined;
      let projKPct: number | undefined;
      let projHrPct: number | undefined;
      let estimatedGap: number | undefined;
      let estimatedSpeed: number | undefined;
      let hasTfrUpside = false;
      let tfrPower: number | undefined;
      let tfrEye: number | undefined;
      let tfrAvoidK: number | undefined;
      let tfrContact: number | undefined;
      let tfrGap: number | undefined;
      let tfrSpeed: number | undefined;

      try {
        const unifiedData = await teamRatingsService.getUnifiedHitterTfrData(year);
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

          if (isProspect) {
            // Pure prospect: use TFR data for everything
            projWar = tfrEntry.projWar;
            projWoba = tfrEntry.projWoba;
            projAvg = tfrEntry.projAvg;
            projObp = tfrEntry.projObp;
            projSlg = tfrEntry.projSlg;
            projPa = tfrEntry.projPa;
            projBbPct = tfrEntry.projBbPct;
            projKPct = tfrEntry.projKPct;
            projHrPct = tfrEntry.projHrPct;
            estimatedPower = tfrEntry.trueRatings.power;
            estimatedEye = tfrEntry.trueRatings.eye;
            estimatedAvoidK = tfrEntry.trueRatings.avoidK;
            estimatedContact = tfrEntry.trueRatings.contact;
            estimatedGap = tfrEntry.trueRatings.gap;
            estimatedSpeed = tfrEntry.trueRatings.speed;
            hasTfrUpside = true;
          } else {
            // MLB player: check if TFR > TR
            hasTfrUpside = trueRating !== undefined && trueFutureRating > trueRating;
            projWar = batterStats?.war;
          }
        } else if (!isProspect) {
          projWar = batterStats?.war;
        }
      } catch (e) {
        console.warn('Could not load unified hitter TFR data:', e);
        if (!isProspect) {
          projWar = batterStats?.war;
        }
      }

      return {
        playerId,
        playerName,
        team: teamLabel,
        parentTeam: parentLabel,
        age: player.age,
        position: player.position,
        positionLabel: getPositionLabel(player.position),
        trueRating: isProspect ? undefined : trueRating,
        percentile: isProspect ? undefined : percentile,
        woba,
        estimatedPower,
        estimatedEye,
        estimatedAvoidK,
        estimatedContact,
        estimatedGap,
        estimatedSpeed,
        pa: batterStats?.pa,
        avg: batterStats?.avg,
        obp: batterStats?.obp,
        slg: slg ? Math.round(slg * 1000) / 1000 : undefined,
        hr: batterStats?.hr,
        rbi: batterStats?.rbi,
        sb: batterStats?.sb,
        war: batterStats?.war,
        isProspect,
        trueFutureRating,
        tfrPercentile,
        projWar,
        projWoba,
        projAvg,
        projObp,
        projSlg,
        projPa,
        projBbPct,
        projKPct,
        projHrPct,
        hasTfrUpside,
        tfrPower,
        tfrEye,
        tfrAvoidK,
        tfrContact,
        tfrGap,
        tfrSpeed,
      };
    } catch (error) {
      console.error('Error fetching batter ratings:', error);
      return null;
    }
  }

  private buildHitterScoutingLookup(
    scoutingData: Array<{ playerId: number; playerName?: string; power: number; contact: number; eye: number; avoidK: number; gap: number; speed: number }>
  ): { byId: Map<number, typeof scoutingData[0]>; byName: Map<string, typeof scoutingData[0][]> } {
    const byId = new Map<number, typeof scoutingData[0]>();
    const byName = new Map<string, typeof scoutingData[0][]>();

    for (const rating of scoutingData) {
      if (rating.playerId > 0) {
        byId.set(rating.playerId, rating);
      }
      if (rating.playerName) {
        const normalized = this.normalizeName(rating.playerName);
        if (normalized) {
          const list = byName.get(normalized) ?? [];
          list.push(rating);
          byName.set(normalized, list);
        }
      }
    }

    return { byId, byName };
  }

  private resolveHitterScoutingFromLookup(
    playerId: number,
    playerName: string,
    lookup: { byId: Map<number, any>; byName: Map<string, any[]> }
  ): any | null {
    // Try ID lookup first
    if (playerId > 0) {
      const match = lookup.byId.get(playerId);
      if (match) return match;
    }

    // Try name lookup
    const normalized = this.normalizeName(playerName);
    if (normalized) {
      const matches = lookup.byName.get(normalized);
      if (matches && matches.length > 0) {
        return matches[0];
      }
    }

    return null;
  }

  private buildScoutingLookup(
    scoutingData: Array<{ playerId: number; playerName?: string; stuff: number; control: number; hra: number }>
  ): { byId: Map<number, typeof scoutingData[0]>; byName: Map<string, typeof scoutingData[0][]> } {
    const byId = new Map<number, typeof scoutingData[0]>();
    const byName = new Map<string, typeof scoutingData[0][]>();

    for (const rating of scoutingData) {
      if (rating.playerId > 0) {
        byId.set(rating.playerId, rating);
      }
      if (rating.playerName) {
        const normalized = this.normalizeName(rating.playerName);
        if (normalized) {
          const list = byName.get(normalized) ?? [];
          list.push(rating);
          byName.set(normalized, list);
        }
      }
    }

    return { byId, byName };
  }

  private resolveScoutingFromLookup(
    playerId: number,
    playerName: string,
    lookup: { byId: Map<number, any>; byName: Map<string, any[]> }
  ): any | null {
    // Try by ID first
    const byId = lookup.byId.get(playerId);
    if (byId) {
      return byId; // Return full scouting object
    }

    // Fall back to name matching
    const normalized = this.normalizeName(playerName);
    const matches = lookup.byName.get(normalized);
    if (matches && matches.length === 1) {
      return matches[0]; // Return full scouting object
    }

    return null;
  }

  private normalizeName(name: string): string {
    // Remove accents, lowercase, trim whitespace
    return name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private updateSelection(): void {
    const items = this.dropdown.querySelectorAll('.global-search-item');
    items.forEach((item, index) => {
      item.classList.toggle('selected', index === this.selectedIndex);
    });

    // Scroll selected item into view
    if (this.selectedIndex >= 0) {
      const selectedItem = items[this.selectedIndex] as HTMLElement;
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  private openDropdown(): void {
    this.isOpen = true;
    this.dropdown.style.display = 'block';
  }

  private closeDropdown(): void {
    this.isOpen = false;
    this.dropdown.style.display = 'none';
    this.selectedIndex = -1;
  }

  clear(): void {
    this.searchInput.value = '';
    this.updateClearButton();
    this.closeDropdown();
    this.players = [];
  }

  focus(): void {
    this.searchInput.focus();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
