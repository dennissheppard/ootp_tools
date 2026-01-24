import { Player, getFullName, getPositionLabel, isPitcher } from '../models/Player';
import { PitchingStats, BattingStats } from '../models/Stats';
import { trueRatingsService } from '../services/TrueRatingsService';
import { trueRatingsCalculationService } from '../services/TrueRatingsCalculationService';
import { scoutingDataService } from '../services/ScoutingDataService';
import { PlayerRatingsCard, PlayerRatingsData } from './PlayerRatingsCard';

export interface SendToEstimatorPayload {
  k9: number;
  bb9: number;
  hr9: number;
  ip: number;
  year: number;
  playerName: string;
}

interface StatsViewOptions {
  onSendToEstimator?: (payload: SendToEstimatorPayload) => void;
}

export class StatsView {
  private container: HTMLElement;
  private onSendToEstimator?: (payload: SendToEstimatorPayload) => void;
  private selectedPitchingIndex: number | null = null;

  constructor(container: HTMLElement, options?: StatsViewOptions) {
    this.container = container;
    this.onSendToEstimator = options?.onSendToEstimator;
  }

  async render(
    player: Player,
    pitchingStats: PitchingStats[],
    battingStats: BattingStats[],
    year?: number
  ): Promise<void> {
    this.selectedPitchingIndex = null;
    const playerName = getFullName(player);

    const yearDisplay = year ? ` (${year})` : ' (All Years)';
    const posLabel = getPositionLabel(player.position);

    // Filter to only show split_id === 1 (total stats) for clarity
    const mainPitching = pitchingStats.filter((s) => s.splitId === 1);
    const mainBatting = battingStats.filter((s) => s.splitId === 1);

    const showSendToEstimator = Boolean(this.onSendToEstimator && isPitcher(player) && mainPitching.length > 0);

    // Determine year for ratings lookup
    // If a specific year was requested, use that; otherwise use the most recent year from stats
    const ratingsYear = year
      ?? (mainPitching.length > 0 ? Math.max(...mainPitching.map(s => s.year)) : new Date().getFullYear());

    // Get True Rating data for pitchers
    let ratingsData: PlayerRatingsData | null = null;
    if (isPitcher(player) && mainPitching.length > 0) {
      ratingsData = await this.fetchPlayerRatings(player.id, playerName, ratingsYear);
    }

    const pitchingTable = mainPitching.length > 0
      ? this.renderPitchingTable(mainPitching, showSendToEstimator)
      : '';
    const battingTable = mainBatting.length > 0
      ? this.renderBattingTable(mainBatting)
      : '';

    const ratingsCard = ratingsData
      ? PlayerRatingsCard.renderInline(ratingsData, ratingsYear)
      : '';

    const noStats = !pitchingTable && !battingTable;
    const noStatsMessage = noStats
      ? `<p class="no-stats">No stats found for this player${yearDisplay}.</p>`
      : '';

    this.container.innerHTML = `
      <div class="stats-container">
        <div class="profile-header profile-header-page">
          <div class="profile-title-group">
            <h2 class="player-title">${this.escapeHtml(playerName)}</h2>
            <span class="stats-period-label">Stats${yearDisplay}</span>
          </div>
          <span class="player-badges">
            <span class="badge badge-position">${posLabel}</span>
            ${player.retired ? '<span class="badge badge-retired">Retired</span>' : ''}
          </span>
        </div>
        ${ratingsCard}
        ${noStatsMessage}
        ${isPitcher(player) ? pitchingTable + battingTable : battingTable + pitchingTable}
      </div>
    `;

    if (showSendToEstimator) {
      this.bindPitchingSelection(mainPitching, playerName);
    }

    this.bindScoutUploadLink();
  }

  private async fetchPlayerRatings(playerId: number, playerName: string, year: number): Promise<PlayerRatingsData | null> {
    try {
      // Try to get True Rating from cached data
      const allPitchers = await trueRatingsService.getTruePitchingStats(year);
      const playerStats = allPitchers.find(p => p.player_id === playerId);

      if (!playerStats) return null;

      const ip = trueRatingsService.parseIp(playerStats.ip);
      if (ip < 10) return null; // Not enough IP

      // Get multi-year stats and league averages for True Rating calculation
      const [multiYearStats, leagueAverages] = await Promise.all([
        trueRatingsService.getMultiYearPitchingStats(year, 3),
        trueRatingsService.getLeagueAverages(year),
      ]);

      // Get scouting data and build lookup (same as TrueRatingsView does)
      const scoutingRatings = scoutingDataService.getScoutingRatings(year);
      const scoutingLookup = this.buildScoutingLookup(scoutingRatings);
      const scoutMatch = this.resolveScoutingFromLookup(playerId, playerName, scoutingLookup);

      // Calculate True Rating with all pitchers for percentile ranking
      // Include scouting data for ALL pitchers to match TrueRatingsView calculation
      // Note: No IP filter here to match TrueRatingsView behavior
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
      const playerResult = results.find(r => r.playerId === playerId);

      if (!playerResult) return null;

      return {
        playerId,
        playerName,
        trueRating: playerResult.trueRating,
        percentile: playerResult.percentile,
        estimatedStuff: playerResult.estimatedStuff,
        estimatedControl: playerResult.estimatedControl,
        estimatedHra: playerResult.estimatedHra,
        scoutStuff: scoutMatch?.stuff,
        scoutControl: scoutMatch?.control,
        scoutHra: scoutMatch?.hra,
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
  ): { stuff: number; control: number; hra: number } | null {
    // Try by ID first
    const byId = lookup.byId.get(playerId);
    if (byId) {
      return { stuff: byId.stuff, control: byId.control, hra: byId.hra };
    }

    // Fall back to name matching
    const normalized = this.normalizeName(playerName);
    const matches = lookup.byName.get(normalized);
    if (matches && matches.length === 1) {
      return { stuff: matches[0].stuff, control: matches[0].control, hra: matches[0].hra };
    }

    return null;
  }

  private normalizeName(name: string): string {
    const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
    const cleaned = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const tokens = cleaned.split(/\s+/).filter(token => token && !suffixes.has(token));
    return tokens.join('');
  }

  private bindScoutUploadLink(): void {
    const link = this.container.querySelector<HTMLAnchorElement>('.scout-upload-link');
    if (!link) return;

    link.addEventListener('click', (e) => {
      e.preventDefault();
      const trueRatingsTab = document.querySelector<HTMLElement>('[data-tab="true-ratings"]');
      if (trueRatingsTab) {
        trueRatingsTab.click();
      }
    });
  }

  private renderPitchingTable(stats: PitchingStats[], includeSendAction: boolean): string {
    if (stats.length === 0) return '';

    const rows = stats.map((s, index) => `
      <tr class="pitching-row stats-row-selectable" data-index="${index}">
        <td>${s.year}</td>
        <td>${s.g}</td>
        <td>${s.gs}</td>
        <td>${s.w}</td>
        <td>${s.l}</td>
        <td>${s.sv}</td>
        <td>${this.formatDecimal(s.ip, 1)}</td>
        <td>${s.ha}</td>
        <td>${s.er}</td>
        <td>${s.bb}</td>
        <td>${s.k}</td>
        <td>${s.hr}</td>
        <td>${this.formatDecimal(s.era, 2)}</td>
        <td>${this.formatDecimal(s.whip, 2)}</td>
        <td>${this.formatDecimal(s.k9, 1)}</td>
        <td>${this.formatDecimal(s.war, 1)}</td>
      </tr>
    `).join('');

    const actions = includeSendAction
      ? `
        <div class="stats-actions">
          <button class="btn btn-secondary send-to-estimator" disabled>Send to Ratings Estimator</button>
        </div>
      `
      : '';

    return `
      <div class="stats-section">
        <div class="stats-section-header">
          <h4 class="section-label">Pitching Statistics</h4>
          ${actions}
        </div>
        <div class="table-wrapper">
          <table class="stats-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>G</th>
                <th>GS</th>
                <th>W</th>
                <th>L</th>
                <th>SV</th>
                <th>IP</th>
                <th>H</th>
                <th>ER</th>
                <th>BB</th>
                <th>K</th>
                <th>HR</th>
                <th>ERA</th>
                <th>WHIP</th>
                <th>K/9</th>
                <th>WAR</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  private renderBattingTable(stats: BattingStats[]): string {
    if (stats.length === 0) return '';

    const rows = stats.map((s) => `
      <tr>
        <td>${s.year}</td>
        <td>${s.g}</td>
        <td>${s.pa}</td>
        <td>${s.ab}</td>
        <td>${s.h}</td>
        <td>${s.d}</td>
        <td>${s.t}</td>
        <td>${s.hr}</td>
        <td>${s.r}</td>
        <td>${s.rbi}</td>
        <td>${s.bb}</td>
        <td>${s.k}</td>
        <td>${s.sb}</td>
        <td>${this.formatAvg(s.avg)}</td>
        <td>${this.formatAvg(s.obp)}</td>
        <td>${this.formatAvg(s.slg)}</td>
        <td>${this.formatAvg(s.ops)}</td>
        <td>${this.formatDecimal(s.war, 1)}</td>
      </tr>
    `).join('');

    return `
      <div class="stats-section">
        <h4 class="section-label">Batting Statistics</h4>
        <div class="table-wrapper">
          <table class="stats-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>G</th>
                <th>PA</th>
                <th>AB</th>
                <th>H</th>
                <th>2B</th>
                <th>3B</th>
                <th>HR</th>
                <th>R</th>
                <th>RBI</th>
                <th>BB</th>
                <th>K</th>
                <th>SB</th>
                <th>AVG</th>
                <th>OBP</th>
                <th>SLG</th>
                <th>OPS</th>
                <th>WAR</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  clear(): void {
    this.container.innerHTML = '';
  }

  private formatDecimal(value: number, decimals: number): string {
    return value.toFixed(decimals);
  }

  private formatAvg(value: number): string {
    if (value >= 1) {
      return value.toFixed(3);
    }
    return value.toFixed(3).replace(/^0/, '');
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private bindPitchingSelection(stats: PitchingStats[], playerName: string): void {
    const rows = Array.from(this.container.querySelectorAll<HTMLTableRowElement>('.pitching-row'));
    const sendBtn = this.container.querySelector<HTMLButtonElement>('.send-to-estimator');

    if (!rows.length || !sendBtn || !this.onSendToEstimator) return;

    rows.forEach((row, idx) => {
      row.addEventListener('click', () => {
        this.selectedPitchingIndex = idx;
        rows.forEach((r) => r.classList.remove('stats-row-selected'));
        row.classList.add('stats-row-selected');
        sendBtn.disabled = false;
      });
    });

    sendBtn.addEventListener('click', () => {
      if (this.selectedPitchingIndex === null) return;
      const stat = stats[this.selectedPitchingIndex];
      if (!stat) return;

      const hr9 = stat.ip > 0 ? (stat.hr / stat.ip) * 9 : 0;

      this.onSendToEstimator?.({
        k9: stat.k9,
        bb9: stat.bb9,
        hr9,
        ip: stat.ip,
        year: stat.year,
        playerName: playerName,
      });
    });
  }
}
