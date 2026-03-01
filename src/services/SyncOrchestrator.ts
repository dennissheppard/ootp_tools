/**
 * SyncOrchestrator (simplified)
 *
 * DB is now pre-populated by the CLI tool (tools/sync-db.ts).
 * Browser clients are pure readers. This module only checks
 * whether Supabase has data (game_date set = "data ready").
 */

import { supabaseDataService } from './SupabaseDataService';

export type SyncSource = 'db' | 'api';

export interface SyncResult {
  source: SyncSource;
  isHero: false;
}

class SyncOrchestrator {
  private _syncResult: SyncResult | null = null;

  get lastResult(): SyncResult | null {
    return this._syncResult;
  }

  /**
   * Check whether Supabase has data ready.
   * Returns 'db' if game_date is set, 'api' otherwise (legacy non-Supabase mode).
   */
  async checkDataReady(): Promise<SyncResult> {
    if (!supabaseDataService.isConfigured) {
      this._syncResult = { source: 'api', isHero: false };
      return this._syncResult;
    }

    const dbDate = await supabaseDataService.getGameDate();
    if (dbDate) {
      this._syncResult = { source: 'db', isHero: false };
    } else {
      this._syncResult = { source: 'api', isHero: false };
    }
    return this._syncResult;
  }
}

export const syncOrchestrator = new SyncOrchestrator();
