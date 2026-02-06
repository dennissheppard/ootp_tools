import { devTrackerService, OrgDevRanking, OrgPlayerDevelopment, TradeEvent } from '../services/DevTrackerService';
import { playerService } from '../services/PlayerService';
import { isPitcher } from '../models/Player';
import { PlayerProfileModal } from './PlayerProfileModal';
import { BatterProfileModal } from './BatterProfileModal';

type SortKey = 'devScore' | 'developmentScore' | 'peakScore' | 'agingScore' | 'tradeImpactScore' | 'playerCount';
type SortDir = 'asc' | 'desc';

export class DevTrackerView {
  private container: HTMLElement;
  private rankings: OrgDevRanking[] = [];
  private sortKey: SortKey = 'devScore';
  private sortDir: SortDir = 'desc';
  private hasLoadedData = false;
  private playerProfileModal: PlayerProfileModal;
  private batterProfileModal: BatterProfileModal;

  constructor(container: HTMLElement) {
    this.container = container;
    this.playerProfileModal = new PlayerProfileModal();
    this.batterProfileModal = new BatterProfileModal();
    this.renderLoading();
    this.setupLazyLoading();
  }

  // --- Lazy Loading ---

  private setupLazyLoading(): void {
    const tabPanel = this.container.closest<HTMLElement>('.tab-panel');
    const isCurrentlyActive = tabPanel?.classList.contains('active');

    if (isCurrentlyActive) {
      this.loadData();
      this.hasLoadedData = true;
    } else {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            const target = mutation.target as HTMLElement;
            if (target.classList.contains('active')) {
              if (!this.hasLoadedData) {
                this.loadData();
                this.hasLoadedData = true;
              }
              observer.disconnect();
              break;
            }
          }
        }
      });

      if (tabPanel) {
        observer.observe(tabPanel, { attributes: true });
      }
    }
  }

  // --- Data Loading ---

  private async loadData(): Promise<void> {
    try {
      this.rankings = await devTrackerService.getOrgRankings();
      this.renderTable();
    } catch (error) {
      console.error('DevTracker: failed to load rankings', error);
      this.renderError();
    }
  }

  // --- Sorting ---

  private sortRankings(): void {
    const key = this.sortKey;
    this.rankings.sort((a, b) => {
      const aVal = a[key] as number;
      const bVal = b[key] as number;
      return this.sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }

  // --- Rating CSS class ---

  private getScoreClass(score: number): string {
    if (score >= 80) return 'rating-elite';
    if (score >= 60) return 'rating-plus';
    if (score >= 40) return 'rating-avg';
    if (score >= 20) return 'rating-fringe';
    return 'rating-poor';
  }

  private renderScoreCell(score: number, tooltip: string): string {
    return `<td style="text-align: center; position: relative;"><span class="badge ${this.getScoreClass(score)}">${score}</span><div class="stat-tooltip">${tooltip}</div></td>`;
  }

  // --- Rendering ---

  private renderLoading(): void {
    this.container.innerHTML = `
      <div class="view-header">
        <h2 class="view-title">Development Tracker</h2>
        <p class="note-text">Org-level player development rankings (2015-2021 WAR data)</p>
      </div>
      <div class="loading-container" style="padding: 3rem; text-align: center;">
        <div class="loading-spinner"></div>
        <p style="margin-top: 1rem; color: var(--color-text-muted);">Loading development data across 7 seasons...</p>
      </div>
    `;
  }

  private renderError(): void {
    this.container.innerHTML = `
      <div class="view-header">
        <h2 class="view-title">Development Tracker</h2>
      </div>
      <div class="placeholder-card">
        <p>Failed to load development data. Check console for details.</p>
      </div>
    `;
  }

  private renderTable(): void {
    this.sortRankings();

    const columns: { key: SortKey | 'rank' | 'orgName'; label: string; sortable: boolean; tooltip?: string }[] = [
      { key: 'rank', label: '#', sortable: false },
      { key: 'orgName', label: 'Organization', sortable: false },
      { key: 'devScore', label: 'Dev Score', sortable: true,
        tooltip: 'Composite development score (0-100). Weighted blend of Youth Dev (40%), Peak (25%), Aging (20%), and Trade Impact (15%). Each component is percentile-ranked among all orgs.' },
      { key: 'developmentScore', label: 'Youth Dev', sortable: true,
        tooltip: 'Youth Development (40% of Dev Score). Measures avg WAR improvement for players age 20-26 with 2+ seasons on the org. Higher = better at growing young talent.' },
      { key: 'peakScore', label: 'Peak', sortable: true,
        tooltip: 'Peak Achievement (25% of Dev Score). Avg peak single-season WAR across all qualifying players on the org. Higher = org\'s players reach higher ceilings.' },
      { key: 'agingScore', label: 'Aging', sortable: true,
        tooltip: 'Aging Curve (20% of Dev Score). Avg WAR change for players age 27+ with 2+ seasons on the org. Higher = veterans maintain or improve production longer.' },
      { key: 'tradeImpactScore', label: 'Trade Impact', sortable: true,
        tooltip: 'Trade Impact (15% of Dev Score). Net WAR gained from acquired players who improved minus WAR lost from departed players who improved elsewhere. Higher = org wins more trades.' },
      { key: 'playerCount', label: 'Players', sortable: true,
        tooltip: 'Total qualifying players tracked for this org across 2015-2021 (min 30 IP for pitchers, 100 PA for batters).' },
    ];

    const sortIndicator = (key: string) => {
      if (!columns.find(c => c.key === key)?.sortable) return '';
      if (this.sortKey === key) return this.sortDir === 'asc' ? ' ▲' : ' ▼';
      return '';
    };

    const headerRow = columns.map(col => {
      const cursor = col.sortable ? 'cursor: pointer; user-select: none;' : '';
      const sortAttr = col.sortable ? `data-sort-key="${col.key}"` : '';
      const tooltipHtml = col.tooltip ? `<div class="stat-tooltip">${col.tooltip}</div>` : '';
      const posStyle = col.tooltip ? ' position: relative;' : '';
      return `<th style="text-align: ${col.key === 'orgName' ? 'left' : 'center'}; ${cursor}${posStyle}" ${sortAttr}>${col.label}${sortIndicator(col.key)}${tooltipHtml}</th>`;
    }).join('');

    const rows = this.rankings.map((org, idx) => {
      const rank = idx + 1;
      const sign = (v: number) => v >= 0 ? '+' : '';
      return `
        <tr class="org-row" data-org-id="${org.orgId}" style="cursor: pointer;">
          <td style="text-align: center; color: var(--color-text-muted); width: 40px;">
            <span class="toggle-icon" style="margin-right: 4px;">▶</span>${rank}
          </td>
          <td>${org.orgName}</td>
          ${this.renderScoreCell(org.devScore,
            `${org.developmentScore}×.40 + ${org.peakScore}×.25 + ${org.agingScore}×.20 + ${org.tradeImpactScore}×.15 = ${org.devScore}`)}
          ${this.renderScoreCell(org.developmentScore,
            `${org.developerCount} young players (20-26) tracked | Avg WAR delta: ${sign(org.rawYouthAvgDelta)}${org.rawYouthAvgDelta} | ${org.developmentScore}th percentile`)}
          ${this.renderScoreCell(org.peakScore,
            `Avg peak season WAR: ${org.rawPeakAvgWar} | ${org.peakScore}th percentile`)}
          ${this.renderScoreCell(org.agingScore,
            `${org.veteranCount} veterans (27+) tracked | Avg WAR delta: ${sign(org.rawAgingAvgDelta)}${org.rawAgingAvgDelta} | ${org.agingScore}th percentile`)}
          ${this.renderScoreCell(org.tradeImpactScore,
            `Net trade WAR: ${sign(org.rawTradeNetWar)}${org.rawTradeNetWar} | ${org.tradeImpactScore}th percentile`)}
          <td style="text-align: center;">${org.playerCount}</td>
        </tr>
        <tr id="details-org-${org.orgId}" style="display: none; background-color: var(--color-surface-hover);">
          <td colspan="${columns.length}" style="padding: 1rem;">
            ${this.renderOrgDetails(org)}
          </td>
        </tr>
      `;
    }).join('');

    this.container.innerHTML = `
      <div class="view-header">
        <h2 class="view-title">Development Tracker</h2>
        <p class="note-text">Org-level player development rankings (2015-2021 WAR data)</p>
      </div>
      <div class="stats-table-container">
        <table class="stats-table dev-tracker-table" style="width: 100%;">
          <thead><tr>${headerRow}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    this.bindEvents();
  }

  // --- Expanded Row Details ---

  private renderOrgDetails(org: OrgDevRanking): string {
    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;">
        <div>
          <h4 class="section-title" style="margin-bottom: 0.5rem;">Top Developers (20-26) <span class="note-text">(${org.developerCount} tracked)</span></h4>
          ${this.renderPlayerDevTable(org.topRisers, org.orgId)}
        </div>
        <div>
          <h4 class="section-title" style="margin-bottom: 0.5rem;">Aging Well (27+) <span class="note-text">(${org.veteranCount} tracked)</span></h4>
          ${this.renderPlayerDevTable(org.topAgers, org.orgId)}
        </div>
        <div>
          <h4 class="section-title" style="margin-bottom: 0.5rem;">Trade Gains</h4>
          ${this.renderTradeTable(org.tradeGains, 'gain')}
        </div>
        <div>
          <h4 class="section-title" style="margin-bottom: 0.5rem;">Trade Losses</h4>
          ${this.renderTradeTable(org.tradeLosses, 'loss')}
        </div>
      </div>
    `;
  }

  private renderPlayerDevTable(players: OrgPlayerDevelopment[], _orgId: number): string {
    if (players.length === 0) return '<p class="no-stats">No qualifying players</p>';

    const rows = players.map((p, i) => `
      <tr>
        <td style="color: var(--color-text-muted); width: 30px;">${i + 1}</td>
        <td><button class="btn-link player-name-link" data-player-id="${p.playerId}">${p.playerName}</button></td>
        <td style="text-align: center;">${p.type}</td>
        <td style="text-align: center;">${p.ageStart}-${p.ageEnd}</td>
        <td style="text-align: center;">${p.warStart.toFixed(1)}</td>
        <td style="text-align: center;">${p.warEnd.toFixed(1)}</td>
        <td style="text-align: center;"><span class="badge ${p.warDelta >= 0 ? 'rating-plus' : 'rating-poor'}">${p.warDelta >= 0 ? '+' : ''}${p.warDelta.toFixed(1)}</span></td>
        <td style="text-align: center;">${p.peakWar.toFixed(1)}</td>
      </tr>
    `).join('');

    return `
      <table class="stats-table" style="width: 100%; font-size: 0.9em;">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th style="text-align: center;">Type</th>
            <th style="text-align: center;">Ages</th>
            <th style="text-align: center;">Start WAR</th>
            <th style="text-align: center;">End WAR</th>
            <th style="text-align: center;">Delta</th>
            <th style="text-align: center;">Peak</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  private renderTradeTable(trades: TradeEvent[], type: 'gain' | 'loss'): string {
    if (trades.length === 0) return '<p class="no-stats">No qualifying trades</p>';

    const otherOrgLabel = type === 'gain' ? 'From' : 'To';
    const rows = trades.map((t, i) => {
      const otherOrg = type === 'gain' ? t.fromOrgName : t.toOrgName;
      return `
        <tr>
          <td style="color: var(--color-text-muted); width: 30px;">${i + 1}</td>
          <td><button class="btn-link player-name-link" data-player-id="${t.playerId}">${t.playerName}</button></td>
          <td style="text-align: left;" title="${otherOrg}">${this.truncate(otherOrg, 18)}</td>
          <td style="text-align: center;">${t.year}</td>
          <td style="text-align: center;">${t.warBefore.toFixed(1)}</td>
          <td style="text-align: center;">${t.warAfter.toFixed(1)}</td>
          <td style="text-align: center;"><span class="badge ${t.warDelta >= 0 ? 'rating-plus' : 'rating-poor'}">${t.warDelta >= 0 ? '+' : ''}${t.warDelta.toFixed(1)}</span></td>
        </tr>
      `;
    }).join('');

    return `
      <table class="stats-table" style="width: 100%; font-size: 0.9em;">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th style="text-align: left;">${otherOrgLabel}</th>
            <th style="text-align: center;">Year</th>
            <th style="text-align: center;">WAR Before</th>
            <th style="text-align: center;">WAR After</th>
            <th style="text-align: center;">Delta</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  private truncate(str: string, max: number): string {
    return str.length > max ? str.slice(0, max - 1) + '\u2026' : str;
  }

  // --- Event Binding ---

  private bindEvents(): void {
    // Row expand/collapse
    this.container.querySelectorAll('tr.org-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.player-name-link')) return;

        const orgId = (row as HTMLElement).dataset.orgId;
        const detailsRow = this.container.querySelector(`#details-org-${orgId}`) as HTMLElement;
        const icon = row.querySelector('.toggle-icon');

        if (detailsRow && icon) {
          const isHidden = detailsRow.style.display === 'none';
          detailsRow.style.display = isHidden ? 'table-row' : 'none';
          icon.textContent = isHidden ? '▼' : '▶';
        }
      });
    });

    // Sort headers
    this.container.querySelectorAll('.dev-tracker-table th[data-sort-key]').forEach(header => {
      header.addEventListener('click', () => {
        const key = (header as HTMLElement).dataset.sortKey as SortKey;
        if (!key) return;

        if (this.sortKey === key) {
          this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortKey = key;
          this.sortDir = 'desc';
        }
        this.renderTable();
      });
    });

    // Player name links -> open profile modal
    this.container.querySelectorAll('.player-name-link').forEach(link => {
      link.addEventListener('click', async (e) => {
        e.stopPropagation();
        const playerId = parseInt((link as HTMLElement).dataset.playerId ?? '0', 10);
        if (!playerId) return;
        await this.openPlayerModal(playerId);
      });
    });
  }

  // --- Modal ---

  private async openPlayerModal(playerId: number): Promise<void> {
    try {
      const player = await playerService.getPlayerById(playerId);
      if (!player) return;

      const name = `${player.firstName} ${player.lastName}`;

      if (isPitcher(player)) {
        const profileData = {
          playerId: player.id,
          playerName: name,
          age: player.age,
          position: player.position,
          positionLabel: 'P',
          trueRating: 0,
          percentile: 0,
          fip: 0,
          k9: 0,
          bb9: 0,
          hr9: 0,
          ip: 0,
          war: 0,
          isProspect: false,
          year: 2021,
          showYearLabel: false,
        };
        await this.playerProfileModal.show(profileData as any, 2021);
      } else {
        const profileData = {
          playerId: player.id,
          playerName: name,
          age: player.age,
          position: player.position,
          positionLabel: player.position ? String(player.position) : '-',
          trueRating: 0,
          percentile: 0,
          isProspect: false,
        };
        await this.batterProfileModal.show(profileData as any, 2021);
      }
    } catch (error) {
      console.error('DevTracker: failed to open player modal', error);
    }
  }
}
