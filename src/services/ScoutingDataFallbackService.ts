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
  async getScoutingRatingsWithFallback(year?: number, scoutPriority: 'my' | 'osa' = 'my'): Promise<ScoutingFallbackResult> {
    // 1. Load both sources in parallel
    const [myRatings, osaRatings] = await Promise.all([
      year ? scoutingDataService.getScoutingRatings(year, 'my')
           : scoutingDataService.getLatestScoutingRatings('my'),
      year ? scoutingDataService.getScoutingRatings(year, 'osa')
           : scoutingDataService.getLatestScoutingRatings('osa')
    ]);

    // 2. Determine priority/secondary based on scoutPriority param
    const primaryRatings = scoutPriority === 'my' ? myRatings : osaRatings;
    const secondaryRatings = scoutPriority === 'my' ? osaRatings : myRatings;
    const primarySource = scoutPriority;
    const secondarySource = scoutPriority === 'my' ? 'osa' : 'my';

    // 3. Build name lookup for primary source (for dedup)
    const primaryNameMap = new Map<string, PitcherScoutingRatings[]>();
    primaryRatings.forEach(r => {
      if (r.playerName) {
        const norm = this.normalizeName(r.playerName);
        const list = primaryNameMap.get(norm) ?? [];
        list.push(r);
        primaryNameMap.set(norm, list);
      }
    });

    // 4. Merge with priority
    const merged: PitcherScoutingRatings[] = [];
    const processedIds = new Set<number>();
    let fromMyScout = 0;
    let fromOSA = 0;

    // Add all primary source data first
    primaryRatings.forEach(r => {
      merged.push({ ...r, source: primarySource });
      if (r.playerId > 0) processedIds.add(r.playerId);
      if (primarySource === 'my') fromMyScout++; else fromOSA++;
    });

    // Add secondary data only if not in primary
    secondaryRatings.forEach(r => {
      if (r.playerId > 0 && processedIds.has(r.playerId)) {
        return; // Skip: already have primary data for this player
      }

      // Check name-based duplicate
      if (r.playerName) {
        const norm = this.normalizeName(r.playerName);
        const primaryMatches = primaryNameMap.get(norm);
        if (primaryMatches && primaryMatches.length > 0) {
          return; // Skip: primary has this player by name
        }
      }

      merged.push({ ...r, source: secondarySource });
      if (secondarySource === 'my') fromMyScout++; else fromOSA++;
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
