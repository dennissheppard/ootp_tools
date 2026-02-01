import { Player, getFullName, getPositionLabel } from '../models/Player';
import { PlayerProfileModal, PlayerProfileData } from './PlayerProfileModal';
import { OnboardingView } from './OnboardingView';
import { playerService } from '../services/PlayerService';
import { dateService } from '../services/DateService';
import { trueRatingsService, TruePlayerStats } from '../services/TrueRatingsService';
import { trueRatingsCalculationService } from '../services/TrueRatingsCalculationService';
import { scoutingDataService } from '../services/ScoutingDataService';
import { trueFutureRatingService } from '../services/TrueFutureRatingService';
import { minorLeagueStatsService } from '../services/MinorLeagueStatsService';
import { teamService } from '../services/TeamService';

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
  private onboardingView: OnboardingView;

  constructor(container: HTMLElement, options: GlobalSearchBarOptions) {
    this.container = container;
    this.onSearch = options.onSearch;
    this.onLoading = options.onLoading;
    this.playerProfileModal = new PlayerProfileModal();
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
      const ratingsData = await this.fetchPlayerRatingsData(player.id, currentYear);

      if (ratingsData) {
        await this.playerProfileModal.show(ratingsData, currentYear);
      } else {
        console.error('Failed to build ratings data for player', player.id);
        // Show a user-friendly error
        alert(`Unable to load profile for ${player.firstName} ${player.lastName}. Please try again.`);
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

      // If no MLB True Rating and we have scouting data, calculate TFR (prospect)
      if (!playerResult && scoutMatch) {
        try {
          const age = player.age ?? 22;

          // Get minor league stats
          const minorStats = await minorLeagueStatsService.getPlayerStats(playerId, year - 2, year);

          // Only calculate TFR if we have MLB pitchers for comparison
          if (allPitchers.length === 0) {
            console.warn('No MLB pitchers available for TFR calculation, skipping');
            // Still set estimated ratings from scouting
            playerResult = {
              estimatedStuff: scoutMatch.stuff,
              estimatedControl: scoutMatch.control,
              estimatedHra: scoutMatch.hra,
            };
          } else {
            // Calculate TFR for this prospect
          const tfrInput = {
            playerId,
            playerName,
            age,
            scouting: {
              playerId,
              playerName,
              stuff: scoutMatch.stuff,
              control: scoutMatch.control,
              hra: scoutMatch.hra,
              ovr: (scoutMatch as any).ovr,
              pot: (scoutMatch as any).pot,
            },
            minorLeagueStats: minorStats,
          };

          const [tfrResult] = await trueFutureRatingService.calculateTrueFutureRatings([tfrInput]);

          if (tfrResult) {
            isProspect = true;
            tfrData = tfrResult;

            // Set estimated ratings from TFR projections
            playerResult = {
              estimatedStuff: Math.round((tfrResult.projK9 - 2.07) / 0.074),
              estimatedControl: Math.round((5.22 - tfrResult.projBb9) / 0.052),
              estimatedHra: Math.round((2.08 - tfrResult.projHr9) / 0.024),
            };
          }
          } // Close else block for MLB pitchers check
        } catch (error) {
          console.warn('Error calculating TFR:', error);
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
        starGap: tfrData?.starGap,
        year,
        projectionYear: year,
        projectionBaseYear: Math.max(2000, year - 1),
        forceProjection: isProspect, // Force peak projection for prospects
      };
    } catch (error) {
      console.error('Error fetching player ratings:', error);
      return null;
    }
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
