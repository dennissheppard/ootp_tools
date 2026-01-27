import { PitcherScoutingRatings } from '../models/ScoutingData';
import { scoutingDataService } from './ScoutingDataService';

export interface ScoutingFallbackResult {
  ratings: PitcherScoutingRatings[];
  metadata: {
    totalPlayers: number;
    fromMyScout: number;
    fromOSA: number;
    hasMyScoutData: boolean;  // User has uploaded ANY 'my' data
  };
}

export interface PlayerScoutingFallbackResult {
  my: PitcherScoutingRatings | null;
  osa: PitcherScoutingRatings | null;
  active: PitcherScoutingRatings | null;
  activeSource: 'my' | 'osa' | null;
  hasAlternative: boolean;
}

class ScoutingDataFallbackService {
  /**
   * Get scouting ratings with My Scout > OSA fallback
   * Returns per-player best available source
   */
  async getScoutingRatingsWithFallback(year?: number): Promise<ScoutingFallbackResult> {
    // 1. Load both sources in parallel
    const [myRatings, osaRatings] = await Promise.all([
      year ? scoutingDataService.getScoutingRatings(year, 'my')
           : scoutingDataService.getLatestScoutingRatings('my'),
      year ? scoutingDataService.getScoutingRatings(year, 'osa')
           : scoutingDataService.getLatestScoutingRatings('osa')
    ]);

    // 2. Build lookup maps
    const myMap = new Map<number, PitcherScoutingRatings>();
    const myNameMap = new Map<string, PitcherScoutingRatings[]>();

    myRatings.forEach(r => {
      if (r.playerId > 0) myMap.set(r.playerId, r);
      if (r.playerName) {
        const norm = this.normalizeName(r.playerName);
        const list = myNameMap.get(norm) ?? [];
        list.push(r);
        myNameMap.set(norm, list);
      }
    });

    const osaMap = new Map<number, PitcherScoutingRatings>();
    const osaNameMap = new Map<string, PitcherScoutingRatings[]>();

    osaRatings.forEach(r => {
      if (r.playerId > 0) osaMap.set(r.playerId, r);
      if (r.playerName) {
        const norm = this.normalizeName(r.playerName);
        const list = osaNameMap.get(norm) ?? [];
        list.push(r);
        osaNameMap.set(norm, list);
      }
    });

    // 3. Merge with priority: My Scout > OSA
    const merged: PitcherScoutingRatings[] = [];
    const processedIds = new Set<number>();
    let fromMyScout = 0;
    let fromOSA = 0;

    // Add all 'my' scout data first
    myRatings.forEach(r => {
      merged.push({ ...r, source: 'my' });
      if (r.playerId > 0) processedIds.add(r.playerId);
      fromMyScout++;
    });

    // Add OSA data only if not in 'my'
    osaRatings.forEach(r => {
      if (r.playerId > 0 && processedIds.has(r.playerId)) {
        return; // Skip: already have 'my' data for this player
      }

      // Check name-based duplicate (if 'my' has this name, skip OSA)
      if (r.playerName) {
        const norm = this.normalizeName(r.playerName);
        const myMatches = myNameMap.get(norm);
        if (myMatches && myMatches.length > 0) {
          return; // Skip: 'my' has this player by name
        }
      }

      merged.push({ ...r, source: 'osa' });
      fromOSA++;
    });

    return {
      ratings: merged,
      metadata: {
        totalPlayers: merged.length,
        fromMyScout,
        fromOSA,
        hasMyScoutData: myRatings.length > 0
      }
    };
  }

  /**
   * Get scouting for a specific player with fallback
   * Returns: { my, osa, active, activeSource, hasAlternative }
   */
  async getPlayerScoutingWithFallback(
    playerId: number,
    playerName: string,
    year?: number
  ): Promise<PlayerScoutingFallbackResult> {
    const [myRatings, osaRatings] = await Promise.all([
      year ? scoutingDataService.getScoutingRatings(year, 'my')
           : scoutingDataService.getLatestScoutingRatings('my'),
      year ? scoutingDataService.getScoutingRatings(year, 'osa')
           : scoutingDataService.getLatestScoutingRatings('osa')
    ]);

    // Find player in both sources
    const my = this.findPlayer(playerId, playerName, myRatings);
    const osa = this.findPlayer(playerId, playerName, osaRatings);

    // Determine active source (my > osa)
    const active = my ?? osa;
    const activeSource = my ? 'my' : osa ? 'osa' : null;
    const hasAlternative = !!(my && osa); // Both exist

    return { my, osa, active, activeSource, hasAlternative };
  }

  /**
   * Find a player in a ratings array by ID or name
   */
  private findPlayer(
    playerId: number,
    playerName: string,
    ratings: PitcherScoutingRatings[]
  ): PitcherScoutingRatings | null {
    // Try ID match first
    if (playerId > 0) {
      const byId = ratings.find(r => r.playerId === playerId);
      if (byId) return byId;
    }

    // Fall back to name match
    if (playerName) {
      const norm = this.normalizeName(playerName);
      const matches = ratings.filter(r => {
        if (!r.playerName) return false;
        return this.normalizeName(r.playerName) === norm;
      });
      if (matches.length === 1) return matches[0]; // Only if unique match
    }

    return null;
  }

  /**
   * Normalize player name for matching
   * Removes punctuation, suffixes, and standardizes case
   */
  private normalizeName(name: string): string {
    const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
    const cleaned = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const tokens = cleaned.split(/\s+/).filter(t => t && !suffixes.has(t));
    return tokens.join('');
  }
}

export const scoutingDataFallbackService = new ScoutingDataFallbackService();
