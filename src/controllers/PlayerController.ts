import { Player, isPitcher } from '../models/Player';
import { PitchingStats, BattingStats } from '../models/Stats';
import { PlayerService, playerService } from '../services/PlayerService';
import { StatsService, statsService } from '../services/StatsService';

export interface PlayerSearchResult {
  players: Player[];
  query: string;
}

export interface PlayerStatsResult {
  player: Player;
  pitchingStats: PitchingStats[];
  battingStats: BattingStats[];
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

      // Fetch stats only from the relevant endpoint to avoid 204 errors on the wrong feed
      if (isPitcher(player)) {
        pitchingStats = await this.statsService.getPitchingStats(playerId, year);
      } else {
        battingStats = await this.statsService.getBattingStats(playerId, year);
      }

      this.onStats?.({
        player,
        pitchingStats,
        battingStats,
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
