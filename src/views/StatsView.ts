import { Player, getFullName, getPositionLabel, isPitcher } from '../models/Player';
import { PitchingStats, BattingStats } from '../models/Stats';

export class StatsView {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  render(
    player: Player,
    pitchingStats: PitchingStats[],
    battingStats: BattingStats[],
    year?: number
  ): void {
    const yearDisplay = year ? ` (${year})` : ' (All Years)';
    const posLabel = getPositionLabel(player.position);

    // Filter to only show split_id === 1 (total stats) for clarity
    const mainPitching = pitchingStats.filter((s) => s.splitId === 1);
    const mainBatting = battingStats.filter((s) => s.splitId === 1);

    const pitchingTable = mainPitching.length > 0
      ? this.renderPitchingTable(mainPitching)
      : '';
    const battingTable = mainBatting.length > 0
      ? this.renderBattingTable(mainBatting)
      : '';

    const noStats = !pitchingTable && !battingTable;
    const noStatsMessage = noStats
      ? `<p class="no-stats">No stats found for this player${yearDisplay}.</p>`
      : '';

    this.container.innerHTML = `
      <div class="stats-container">
        <div class="player-header">
          <h2 class="player-title">${this.escapeHtml(getFullName(player))}</h2>
          <span class="player-info">
            <span class="badge badge-position">${posLabel}</span>
            ${player.retired ? '<span class="badge badge-retired">Retired</span>' : ''}
          </span>
        </div>
        <p class="stats-period">Stats${yearDisplay}</p>
        ${noStatsMessage}
        ${isPitcher(player) ? pitchingTable + battingTable : battingTable + pitchingTable}
      </div>
    `;
  }

  private renderPitchingTable(stats: PitchingStats[]): string {
    if (stats.length === 0) return '';

    const rows = stats.map((s) => `
      <tr>
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

    return `
      <div class="stats-table-container">
        <h3 class="stats-table-title">Pitching Statistics</h3>
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
      <div class="stats-table-container">
        <h3 class="stats-table-title">Batting Statistics</h3>
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
    // Format like .300 instead of 0.300
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
}
