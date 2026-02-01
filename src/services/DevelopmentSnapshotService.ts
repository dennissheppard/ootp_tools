/**
 * DevelopmentSnapshotService
 *
 * Manages historical snapshots of player development data (scouting ratings, TR, TFR).
 * Snapshots are created automatically when scouting data is uploaded.
 */

import { PitcherScoutingRatings } from '../models/ScoutingData';
import { indexedDBService, DevelopmentSnapshotRecord } from './IndexedDBService';

class DevelopmentSnapshotService {
  /**
   * Create development snapshots from a scouting data upload.
   * Called after scouting ratings are saved.
   *
   * @param date - The date of the scouting upload (YYYY-MM-DD)
   * @param ratings - Array of scouting ratings from the upload
   * @param source - 'my' or 'osa'
   */
  async createSnapshotsFromScoutingUpload(
    date: string,
    ratings: PitcherScoutingRatings[],
    source: 'my' | 'osa'
  ): Promise<number> {
    if (ratings.length === 0) {
      return 0;
    }

    const snapshots: DevelopmentSnapshotRecord[] = ratings
      .filter(r => r.playerId > 0) // Skip invalid player IDs
      .map(r => ({
        key: `${r.playerId}_${date}`,
        playerId: r.playerId,
        date,
        snapshotType: 'data_upload' as const,
        scoutStuff: r.stuff,
        scoutControl: r.control,
        scoutHra: r.hra,
        scoutOvr: r.ovr,
        scoutPot: r.pot,
        source,
        age: r.age,
      }));

    try {
      await indexedDBService.saveDevelopmentSnapshots(snapshots);
      console.log(`📸 Created ${snapshots.length} development snapshots for ${date}`);
      return snapshots.length;
    } catch (error) {
      console.error('Failed to create development snapshots:', error);
      return 0;
    }
  }

  /**
   * Get all development snapshots for a specific player, sorted by date (oldest first).
   *
   * @param playerId - The player ID
   * @returns Array of snapshots sorted by date ascending
   */
  async getPlayerSnapshots(playerId: number): Promise<DevelopmentSnapshotRecord[]> {
    return indexedDBService.getPlayerDevelopmentSnapshots(playerId);
  }

  /**
   * Get the latest snapshot for each player.
   * Useful for showing current state across all players.
   *
   * @returns Map of playerId -> latest snapshot
   */
  async getLatestSnapshots(): Promise<Map<number, DevelopmentSnapshotRecord>> {
    const allSnapshots = await indexedDBService.getAllDevelopmentSnapshots();
    const latestByPlayer = new Map<number, DevelopmentSnapshotRecord>();

    for (const snapshot of allSnapshots) {
      const existing = latestByPlayer.get(snapshot.playerId);
      if (!existing || snapshot.date > existing.date) {
        latestByPlayer.set(snapshot.playerId, snapshot);
      }
    }

    return latestByPlayer;
  }

  /**
   * Get snapshot count for a player (useful for checking if we have enough data for charts).
   *
   * @param playerId - The player ID
   * @returns Number of snapshots available
   */
  async getSnapshotCount(playerId: number): Promise<number> {
    const snapshots = await this.getPlayerSnapshots(playerId);
    return snapshots.length;
  }

  /**
   * Check if a player has enough snapshots for meaningful trend visualization.
   * Returns true if 2+ snapshots exist.
   *
   * @param playerId - The player ID
   */
  async hasEnoughDataForChart(playerId: number): Promise<boolean> {
    const count = await this.getSnapshotCount(playerId);
    return count >= 2;
  }

  /**
   * Delete all snapshots for a player.
   *
   * @param playerId - The player ID
   */
  async deletePlayerSnapshots(playerId: number): Promise<void> {
    const snapshots = await this.getPlayerSnapshots(playerId);
    for (const snapshot of snapshots) {
      await indexedDBService.deleteDevelopmentSnapshot(snapshot.key);
    }
  }

  /**
   * Get all unique players with development snapshots.
   *
   * @returns Array of player IDs that have snapshots
   */
  async getPlayersWithSnapshots(): Promise<number[]> {
    const allSnapshots = await indexedDBService.getAllDevelopmentSnapshots();
    const playerIds = new Set<number>();
    for (const snapshot of allSnapshots) {
      playerIds.add(snapshot.playerId);
    }
    return Array.from(playerIds);
  }

  /**
   * Get statistics about stored snapshots.
   * Useful for debugging and data management UI.
   */
  async getStats(): Promise<{
    totalSnapshots: number;
    uniquePlayers: number;
    oldestDate: string | null;
    newestDate: string | null;
  }> {
    const allSnapshots = await indexedDBService.getAllDevelopmentSnapshots();

    if (allSnapshots.length === 0) {
      return {
        totalSnapshots: 0,
        uniquePlayers: 0,
        oldestDate: null,
        newestDate: null,
      };
    }

    const playerIds = new Set(allSnapshots.map(s => s.playerId));
    const dates = allSnapshots.map(s => s.date).sort();

    return {
      totalSnapshots: allSnapshots.length,
      uniquePlayers: playerIds.size,
      oldestDate: dates[0],
      newestDate: dates[dates.length - 1],
    };
  }

  /**
   * Clear all development snapshots.
   * Use with caution - this is destructive!
   */
  async clearAllSnapshots(): Promise<void> {
    await indexedDBService.deleteAllDevelopmentSnapshots();
    console.log('🗑️ Cleared all development snapshots');
  }
}

export const developmentSnapshotService = new DevelopmentSnapshotService();
