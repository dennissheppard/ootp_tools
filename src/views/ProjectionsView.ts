import { projectionService, ProjectedPlayer } from '../services/ProjectionService';
import { dateService } from '../services/DateService';
import { trueFutureRatingService } from '../services/TrueFutureRatingService';
import { scoutingDataService } from '../services/ScoutingDataService';
import { playerService } from '../services/PlayerService';
import { teamService } from '../services/TeamService';
import { PlayerProfileModal, PlayerProfileData } from './PlayerProfileModal';

interface ColumnConfig {
  key: keyof ProjectedPlayer | string;
  label: string;
  sortKey?: string;
  accessor?: (row: ProjectedPlayer) => any;
}

export class ProjectionsView {
  private container: HTMLElement;
  private stats: ProjectedPlayer[] = [];
  private allStats: ProjectedPlayer[] = [];
  private currentPage = 1;
  private itemsPerPage = 50;
  private selectedYear = 2020;
  private selectedTeam = 'all';
  private teamOptions: string[] = [];
  private yearOptions = Array.from({ length: 22 }, (_, i) => 2021 - i);
  private isOffseason = false;
  private statsYearUsed: number | null = null;
  private usedFallbackStats = false;
  private sortKey: string = 'projectedStats.fip';
  private sortDirection: 'asc' | 'desc' = 'asc';
  private columns: ColumnConfig[] = [];
  private isDraggingColumn = false;
  private prefKey = 'wbl-projections-prefs';
  private playerProfileModal: PlayerProfileModal;
  private playerRowLookup: Map<number, ProjectedPlayer> = new Map();

  constructor(container: HTMLElement) {
    this.container = container;
    this.playerProfileModal = new PlayerProfileModal();
    this.initColumns();
    this.renderLayout();
    this.initializeFromGameDate();
  }

  private initColumns(): void {
    const defaults: ColumnConfig[] = [
        { key: 'name', label: 'Name', accessor: p => this.renderPlayerName(p) },
        { key: 'teamName', label: 'Team' },
        { key: 'age', label: 'Age' },
        { key: 'currentTrueRating', label: 'Current TR', sortKey: 'currentTrueRating', accessor: p => this.renderRatingBadge(p) },
        { key: 'projK9', label: 'Proj K/9', sortKey: 'projectedStats.k9', accessor: p => p.projectedStats.k9.toFixed(2) },
        { key: 'projBB9', label: 'Proj BB/9', sortKey: 'projectedStats.bb9', accessor: p => p.projectedStats.bb9.toFixed(2) },
        { key: 'projHR9', label: 'Proj HR/9', sortKey: 'projectedStats.hr9', accessor: p => p.projectedStats.hr9.toFixed(2) },
        { key: 'projFIP', label: 'Proj FIP', sortKey: 'projectedStats.fip', accessor: p => p.projectedStats.fip.toFixed(2) },
        { key: 'projIP', label: 'Proj IP', sortKey: 'projectedStats.ip', accessor: p => p.projectedStats.ip }
    ];
    this.columns = this.loadColumnPrefs(defaults);
  }

  private renderLayout(): void {
    this.container.innerHTML = `
      <div class="true-ratings-content">
        <h2 class="view-title">Stat Projections</h2>
        <p class="section-subtitle" id="projections-subtitle"></p>
        
        <div class="true-ratings-controls">
          <div class="form-field">
            <label for="proj-year">Base Year:</label>
            <select id="proj-year">
              ${this.yearOptions.map(year => `<option value="${year}" ${year === this.selectedYear ? 'selected' : ''}>${year}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label for="proj-team">Team:</label>
            <select id="proj-team">
              <option value="all">All</option>
            </select>
          </div>
        </div>

        <div id="projections-table-container">
            <div class="loading-message">Loading projections...</div>
        </div>
        
        <div class="pagination-controls">
          <button id="prev-page" disabled>Previous</button>
          <span id="page-info"></span>
          <button id="next-page" disabled>Next</button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
      this.container.querySelector('#proj-year')?.addEventListener('change', (e) => {
          this.selectedYear = parseInt((e.target as HTMLSelectElement).value, 10);
          this.fetchData();
      });

      this.container.querySelector('#proj-team')?.addEventListener('change', (e) => {
          this.selectedTeam = (e.target as HTMLSelectElement).value;
          this.currentPage = 1;
          this.filterAndRender();
      });

      this.container.querySelector('#prev-page')?.addEventListener('click', () => {
          if (this.currentPage > 1) {
              this.currentPage--;
              this.renderTable();
          }
      });

      this.container.querySelector('#next-page')?.addEventListener('click', () => {
          const totalPages = Math.ceil(this.stats.length / this.itemsPerPage);
          if (this.currentPage < totalPages) {
              this.currentPage++;
              this.renderTable();
          }
      });
  }

  private async fetchData(): Promise<void> {
      const container = this.container.querySelector('#projections-table-container');
      if (container) container.innerHTML = '<div class="loading-message">Calculating projections...</div>';

      try {
          const context = await projectionService.getProjectionsWithContext(this.selectedYear);
          let allPlayers = context.projections;
          this.statsYearUsed = context.statsYear;
          this.usedFallbackStats = context.usedFallbackStats;

          // Also fetch prospects with TFR
          const prospects = await this.fetchProspects(allPlayers);
          allPlayers = [...allPlayers, ...prospects];

          this.allStats = allPlayers;

          // Populate team filter
          const teams = new Set(this.allStats.map(p => p.teamName).filter(t => t && t !== 'FA'));
          this.teamOptions = Array.from(teams).sort();
          this.updateTeamFilter();

          this.updateSubtitle();
          this.filterAndRender();
      } catch (err) {
          console.error(err);
          if (container) container.innerHTML = `<div class="error-message">Error: ${err}</div>`;
      }
  }

  /**
   * Fetch prospects with TFR who aren't already in the MLB projections
   */
  private async fetchProspects(mlbPlayers: ProjectedPlayer[]): Promise<ProjectedPlayer[]> {
      try {
          const scoutingRatings = scoutingDataService.getLatestScoutingRatings('my');
          if (scoutingRatings.length === 0) return [];

          const mlbPlayerIds = new Set(mlbPlayers.map(p => p.playerId));

          // Get TFR results for prospects
          const tfrResults = await trueFutureRatingService.getProspectTrueFutureRatings(this.selectedYear, 'my');

          // Filter to only prospects (not in MLB stats)
          const prospectTfrs = tfrResults.filter(tfr => !mlbPlayerIds.has(tfr.playerId));

          // Fetch player/team data
          const [allPlayers, allTeams] = await Promise.all([
              playerService.getAllPlayers(),
              teamService.getAllTeams()
          ]);
          const playerMap = new Map(allPlayers.map(p => [p.id, p]));
          const teamMap = new Map(allTeams.map(t => [t.id, t]));

          // Convert to ProjectedPlayer format
          const prospectPlayers: ProjectedPlayer[] = [];

          for (const tfr of prospectTfrs) {
              const player = playerMap.get(tfr.playerId);
              if (!player) continue;

              const team = teamMap.get(player.teamId);
              let teamName = 'FA';
              if (team) {
                  if (player.parentTeamId !== 0) {
                      const parent = teamMap.get(player.parentTeamId);
                      teamName = parent?.nickname ?? team.nickname;
                  } else {
                      teamName = team.nickname;
                  }
              }

              // Get scouting for role determination
              const scouting = scoutingRatings.find(s => s.playerId === tfr.playerId);
              const pitchCount = scouting?.pitches ? Object.keys(scouting.pitches).length : 0;
              const isSp = pitchCount > 2;
              const projectedIp = isSp ? 160 : 60;

              // Calculate projected WAR using FIP
              const runsPerWin = 9.0;
              const replacementFip = isSp ? 5.25 : 4.60;
              const projectedWar = ((replacementFip - tfr.projFip) / runsPerWin) * (projectedIp / 9);

              prospectPlayers.push({
                  playerId: tfr.playerId,
                  name: tfr.playerName,
                  teamId: player.teamId,
                  teamName,
                  age: tfr.age,
                  currentTrueRating: tfr.trueFutureRating, // Use TFR as "current" rating
                  projectedTrueRating: tfr.trueFutureRating,
                  projectedStats: {
                      k9: tfr.projK9,
                      bb9: tfr.projBb9,
                      hr9: tfr.projHr9,
                      fip: tfr.projFip,
                      war: Math.max(0, projectedWar),
                      ip: projectedIp,
                  },
                  projectedRatings: {
                      stuff: Math.round((tfr.projK9 - 2.07) / 0.074),
                      control: Math.round((5.22 - tfr.projBb9) / 0.052),
                      hra: Math.round((2.08 - tfr.projHr9) / 0.024),
                  },
                  isProspect: true,
              });
          }

          return prospectPlayers;
      } catch (err) {
          console.warn('Failed to fetch prospects:', err);
          return [];
      }
  }

  private updateTeamFilter(): void {
      const select = this.container.querySelector<HTMLSelectElement>('#proj-team');
      if (!select) return;
      select.innerHTML = '<option value="all">All</option>' + 
          this.teamOptions.map(t => `<option value="${t}">${t}</option>`).join('');
      select.value = this.selectedTeam;
  }

  private filterAndRender(): void {
      if (this.selectedTeam === 'all') {
          this.stats = [...this.allStats];
      } else {
          this.stats = this.allStats.filter(p => p.teamName === this.selectedTeam);
      }
      this.sortStats();
      this.renderTable();
  }

  private sortStats(): void {
      const key = this.sortKey;
      const getVal = (obj: any, path: string) => path.split('.').reduce((o, k) => (o || {})[k], obj);

      this.stats.sort((a, b) => {
          let valA = getVal(a, key);
          let valB = getVal(b, key);

          if (typeof valA === 'string') valA = valA.toLowerCase();
          if (typeof valB === 'string') valB = valB.toLowerCase();

          if (valA < valB) return this.sortDirection === 'asc' ? -1 : 1;
          if (valA > valB) return this.sortDirection === 'asc' ? 1 : -1;
          return 0;
      });
  }

  private renderTable(): void {
      const container = this.container.querySelector('#projections-table-container');
      if (!container) return;

      if (this.stats.length === 0) {
          container.innerHTML = '<p class="no-stats">No projections found.</p>';
          this.updatePagination(0);
          return;
      }

      const start = (this.currentPage - 1) * this.itemsPerPage;
      const end = start + this.itemsPerPage;
      const pageData = this.stats.slice(start, end);

      // Populate lookup for modal access
      this.playerRowLookup = new Map(pageData.map(p => [p.playerId, p]));

      const headerHtml = this.columns.map(col => {
          // Actually match exactly or loosely
          const isActive = this.sortKey === col.sortKey;
          return `<th data-key="${col.key}" data-sort="${col.sortKey || ''}" class="${isActive ? 'sort-active' : ''}" draggable="true">${col.label}</th>`;
      }).join('');

      const rowsHtml = pageData.map(p => {
          const cells = this.columns.map(col => {
              const val = col.accessor ? col.accessor(p) : (p as any)[col.key];
              return `<td>${val ?? ''}</td>`;
          }).join('');
          const rowClass = p.isProspect ? 'prospect-row' : '';
          return `<tr class="${rowClass}">${cells}</tr>`;
      }).join('');

      container.innerHTML = `
        <div class="table-wrapper-outer">
            <div class="table-wrapper">
                <table class="stats-table true-ratings-table">
                    <thead><tr>${headerHtml}</tr></thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        </div>
      `;

      this.updatePagination(this.stats.length);
      this.bindTableEvents();
  }

  private bindTableEvents(): void {
      // Player Names
      this.bindPlayerNameClicks();

      // Sorting
      this.container.querySelectorAll('th[data-sort]').forEach(th => {
          th.addEventListener('click', () => {
              if (this.isDraggingColumn) return;
              const key = (th as HTMLElement).dataset.sort;
              if (!key) return;
              
              if (this.sortKey === key) {
                  this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
              } else {
                  this.sortKey = key;
                  this.sortDirection = 'asc'; // Default to asc for FIP usually, but let's stick to simple
                  // Actually FIP lower is better. Default asc is correct for "best".
              }
              this.sortStats();
              this.renderTable();
          });
      });

      // Drag and Drop
      const headers = this.container.querySelectorAll<HTMLTableCellElement>('th[draggable="true"]');
      let draggedKey: string | null = null;

      headers.forEach(header => {
          header.addEventListener('dragstart', (e) => {
              draggedKey = header.dataset.key || null;
              this.isDraggingColumn = true;
              header.classList.add('dragging');
              if (e.dataTransfer) {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', draggedKey || '');
              }
          });

          header.addEventListener('dragover', (e) => {
              e.preventDefault();
              if (!draggedKey) return;
              const targetKey = header.dataset.key;
              if (targetKey === draggedKey) return;
              
              // Visual indicator logic (simplified)
              header.style.borderLeft = '2px solid var(--color-primary)';
          });

          header.addEventListener('dragleave', () => {
              header.style.borderLeft = '';
          });

          header.addEventListener('drop', (e) => {
              e.preventDefault();
              header.style.borderLeft = '';
              const targetKey = header.dataset.key;
              
              if (draggedKey && targetKey && draggedKey !== targetKey) {
                  this.reorderColumns(draggedKey, targetKey);
              }
              draggedKey = null;
          });

          header.addEventListener('dragend', () => {
              header.classList.remove('dragging');
              this.isDraggingColumn = false;
              headers.forEach(h => h.style.borderLeft = '');
          });
      });
  }

  private reorderColumns(fromKey: string, toKey: string): void {
      const fromIdx = this.columns.findIndex(c => c.key === fromKey);
      const toIdx = this.columns.findIndex(c => c.key === toKey);
      
      if (fromIdx > -1 && toIdx > -1) {
          const item = this.columns.splice(fromIdx, 1)[0];
          this.columns.splice(toIdx, 0, item);
          this.saveColumnPrefs();
          this.renderTable();
      }
  }

  private renderPlayerName(player: ProjectedPlayer): string {
    const prospectBadge = player.isProspect ? ' <span class="prospect-badge">P</span>' : '';
    return `<button class="btn-link player-name-link" data-player-id="${player.playerId}">${player.name}${prospectBadge}</button>`;
  }

  private renderRatingBadge(player: ProjectedPlayer): string {
    const value = player.currentTrueRating;
    let className = 'rating-poor';
    if (value >= 4.5) className = 'rating-elite';
    else if (value >= 4.0) className = 'rating-plus';
    else if (value >= 3.0) className = 'rating-avg';
    else if (value >= 2.0) className = 'rating-fringe';

    // For prospects, add TFR indicator
    const tfrClass = player.isProspect ? ' tfr-badge' : '';
    const title = player.isProspect ? 'True Future Rating (Projected)' : 'Current True Rating';

    return `<span class="badge ${className}${tfrClass}" title="${title}">${value.toFixed(1)}</span>`;
  }

  private bindPlayerNameClicks(): void {
    const links = this.container.querySelectorAll<HTMLButtonElement>('.player-name-link');
    links.forEach(link => {
      link.addEventListener('click', (e) => {
        e.stopPropagation();
        const playerId = parseInt(link.dataset.playerId ?? '', 10);
        if (!playerId) return;
        this.openPlayerProfile(playerId);
      });
    });
  }

  private async openPlayerProfile(playerId: number): Promise<void> {
    const row = this.playerRowLookup.get(playerId);
    if (!row) return;

    // Fetch full player info for team labels
    const player = await playerService.getPlayerById(playerId);
    let teamLabel = '';
    let parentLabel = '';
    
    if (player) {
      const team = await teamService.getTeamById(player.teamId);
      if (team) {
        teamLabel = `${team.name} ${team.nickname}`;
        if (team.parentTeamId !== 0) {
          const parent = await teamService.getTeamById(team.parentTeamId);
          if (parent) {
            parentLabel = parent.nickname;
          }
        }
      }
    }

    // Get scouting
    const scoutingRatings = scoutingDataService.getLatestScoutingRatings('my');
    const scouting = scoutingRatings.find(s => s.playerId === playerId);

    const profileData: PlayerProfileData = {
      playerId: row.playerId,
      playerName: row.name,
      team: teamLabel,
      parentTeam: parentLabel,
      trueRating: row.currentTrueRating,
      estimatedStuff: row.projectedRatings.stuff,
      estimatedControl: row.projectedRatings.control,
      estimatedHra: row.projectedRatings.hra,
      scoutStuff: scouting?.stuff,
      scoutControl: scouting?.control,
      scoutHra: scouting?.hra,
      scoutStamina: scouting?.stamina,
      scoutInjuryProneness: scouting?.injuryProneness,
      scoutOvr: scouting?.ovr,
      scoutPot: scouting?.pot,
      isProspect: row.isProspect
    };

    await this.playerProfileModal.show(profileData, this.selectedYear);
  }

  private updatePagination(total: number): void {
      const info = this.container.querySelector('#page-info');
      const prev = this.container.querySelector<HTMLButtonElement>('#prev-page');
      const next = this.container.querySelector<HTMLButtonElement>('#next-page');
      
      if (info) {
          const totalPages = Math.ceil(total / this.itemsPerPage);
          info.textContent = total > 0 ? `Page ${this.currentPage} of ${totalPages}` : '';
      }
      
      if (prev) prev.disabled = this.currentPage <= 1;
      if (next) next.disabled = this.currentPage >= Math.ceil(total / this.itemsPerPage);
  }

  private loadColumnPrefs(defaults: ColumnConfig[]): ColumnConfig[] {
      try {
          const saved = localStorage.getItem(this.prefKey);
          if (saved) {
              const keys = JSON.parse(saved) as string[];
              // Reconstruct order based on keys, filtering out any that no longer exist
              const ordered: ColumnConfig[] = [];
              keys.forEach(k => {
                  const found = defaults.find(c => c.key === k);
                  if (found) ordered.push(found);
              });
              // Add any new columns that weren't in prefs
              defaults.forEach(d => {
                  if (!ordered.find(o => o.key === d.key)) ordered.push(d);
              });
              return ordered;
          }
      } catch {}
      return defaults;
  }

  private saveColumnPrefs(): void {
      try {
          const keys = this.columns.map(c => c.key);
          localStorage.setItem(this.prefKey, JSON.stringify(keys));
      } catch {}
  }

  private async initializeFromGameDate(): Promise<void> {
    const dateStr = await dateService.getCurrentDateWithFallback();
    const parsed = this.parseGameDate(dateStr);

    if (parsed) {
      const { year, month } = parsed;
      this.selectedYear = year;
      this.isOffseason = month >= 10;
      this.updateYearOptions(year);
      this.updateYearSelect();
    }

    this.updateSubtitle();
    this.fetchData();
  }

  private parseGameDate(dateStr: string): { year: number; month: number } | null {
    const [yearStr, monthStr] = dateStr.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    if (!Number.isFinite(year) || !Number.isFinite(month)) {
      return null;
    }
    return { year, month };
  }

  private updateYearOptions(currentYear: number): void {
    const endYear = Math.max(2021, currentYear);
    const startYear = 2000;
    this.yearOptions = Array.from({ length: endYear - startYear + 1 }, (_, i) => endYear - i);
  }

  private updateYearSelect(): void {
    const select = this.container.querySelector<HTMLSelectElement>('#proj-year');
    if (!select) return;
    select.innerHTML = this.yearOptions
      .map(year => `<option value="${year}" ${year === this.selectedYear ? 'selected' : ''}>${year}</option>`)
      .join('');
    select.value = String(this.selectedYear);
  }

  private updateSubtitle(): void {
    const subtitle = this.container.querySelector<HTMLElement>('#projections-subtitle');
    if (!subtitle) return;

    const targetYear = this.selectedYear + (this.isOffseason ? 1 : 0);
    if (this.isOffseason) {
      const baseYear = this.statsYearUsed ?? this.selectedYear;
      subtitle.innerHTML = `Projections for the <em>next</em> season (${targetYear}) based on ${baseYear} True Ratings and standard aging curves.`;
    } else {
      const baseYear = this.statsYearUsed ?? this.selectedYear;
      const fallbackNote = this.usedFallbackStats && baseYear !== targetYear
        ? ` <span class="note-text">No ${targetYear} stats yet&mdash;using ${baseYear} data.</span>`
        : '';
      subtitle.innerHTML = `Projections for the ${targetYear} season (rest of year) based on current True Ratings and standard aging curves.${fallbackNote}`;
    }
  }
}
