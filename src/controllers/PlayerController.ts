import { Player, isPitcher } from '../models/Player';
import { PitchingStats, BattingStats, MinorLeagueStatsWithLevel } from '../models/Stats';
import { PlayerService, playerService } from '../services/PlayerService';
import { StatsService, statsService } from '../services/StatsService';
import { minorLeagueStatsService } from '../services/MinorLeagueStatsService';
import { dateService } from '../services/DateService';

export interface PlayerSearchResult {
  players: Player[];
  query: string;
}

export interface PlayerStatsResult {
  player: Player;
  pitchingStats: PitchingStats[];
  battingStats: BattingStats[];
  minorLeagueStats: MinorLeagueStatsWithLevel[];
  year?: number;
}

export type SearchCallback = (result: PlayerSearchResult) => void;
export type StatsCallback = (result: PlayerStatsResult) => void;
export type ErrorCallback = (error: Error) => void;
export type LoadingCallback = (isLoading: boolean) => void;

export class PlayerController {
  private playerService: PlayerService;
  private statsService: StatsService;

  private onSearch?: SearchCallback;
  private onStats?: StatsCallback;
  private onError?: ErrorCallback;
  private onLoading?: LoadingCallback;

  constructor(
    playerSvc: PlayerService = playerService,
    statsSvc: StatsService = statsService
  ) {
    this.playerService = playerSvc;
    this.statsService = statsSvc;
  }

  setCallbacks(callbacks: {
    onSearch?: SearchCallback;
    onStats?: StatsCallback;
    onError?: ErrorCallback;
    onLoading?: LoadingCallback;
  }): void {
    this.onSearch = callbacks.onSearch;
    this.onStats = callbacks.onStats;
    this.onError = callbacks.onError;
    this.onLoading = callbacks.onLoading;
  }

  async searchPlayers(query: string): Promise<void> {
    if (!query.trim()) {
      this.onSearch?.({ players: [], query });
      return;
    }

    try {
      this.onLoading?.(true);
      const players = await this.playerService.searchPlayers(query);
      this.onSearch?.({ players, query });
    } catch (error) {
      this.onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.onLoading?.(false);
    }
  }

  async getPlayerStats(playerId: number, year?: number): Promise<void> {
    try {
      this.onLoading?.(true);

      const player = await this.playerService.getPlayerById(playerId);
      if (!player) {
        throw new Error(`Player with ID ${playerId} not found`);
      }

      let pitchingStats: PitchingStats[] = [];
      let battingStats: BattingStats[] = [];
      let minorLeagueStats: MinorLeagueStatsWithLevel[] = [];

      // Fetch stats only from the relevant endpoint to avoid 204 errors on the wrong feed
      // Wrap in try/catch to handle cases where player has no stats (e.g. draftees)
      // We still want to show the profile page even if stats are missing
      try {
        if (isPitcher(player)) {
          pitchingStats = await this.statsService.getPitchingStats(playerId, year);
        } else {
          battingStats = await this.statsService.getBattingStats(playerId, year);
        }
      } catch (error) {
        console.warn(`Could not fetch stats for player ${playerId}:`, error);
        // Continue with empty stats
      }

      // Fetch minor league stats for pitchers (within 2 years of current game date)
      if (isPitcher(player)) {
        try {
          const currentYear = await dateService.getCurrentYear();
          const startYear = currentYear - 2;
          const endYear = currentYear;
          minorLeagueStats = await minorLeagueStatsService.getPlayerStats(playerId, startYear, endYear);
        } catch (error) {
          console.warn(`Could not fetch minor league stats for player ${playerId}:`, error);
          // Continue with empty minor league stats
        }
      }

      this.onStats?.({
        player,
        pitchingStats,
        battingStats,
        minorLeagueStats,
        year,
      });
    } catch (error) {
      this.onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.onLoading?.(false);
    }
  }

  async preloadPlayers(): Promise<void> {
    try {
      this.onLoading?.(true);
      await this.playerService.getAllPlayers();
    } catch (error) {
      this.onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.onLoading?.(false);
    }
  }
}

// Singleton instance for convenience
export const playerController = new PlayerController();
