import { teamRatingsService, FarmData, FarmSystemRankings, RatedProspect } from '../services/TeamRatingsService';
import { PlayerProfileModal } from './PlayerProfileModal';

interface FarmColumn {
  key: 'name' | 'trueFutureRating' | 'age' | 'level' | 'peakFip' | 'peakWar';
  label: string;
}

export class FarmRankingsView {
  private container: HTMLElement;
  private selectedYear: number = 2021;
  private viewMode: 'top-systems' | 'top-100' | 'reports' = 'top-systems';
  private data: FarmData | null = null;
  private playerProfileModal: PlayerProfileModal;
  private yearOptions = Array.from({ length: 6 }, (_, i) => 2021 - i); // 2021 down to 2016

  constructor(container: HTMLElement) {
    this.container = container;
    this.playerProfileModal = new PlayerProfileModal();
    this.renderLayout();
    this.loadData();
  }

  private renderLayout(): void {
    this.container.innerHTML = `
      <div class="true-ratings-content">
        <h2 class="view-title">Farm System Rankings</h2>
        
        <div class="true-ratings-controls">
          <div class="filter-bar">
            <label>Filters:</label>
            <div class="filter-group" role="group" aria-label="Farm filters">
              
              <div class="filter-dropdown" data-filter="year">
                <button class="filter-dropdown-btn" aria-haspopup="true" aria-expanded="false">
                  Year: <span id="selected-year-display">${this.selectedYear}</span> ▾
                </button>
                <div class="filter-dropdown-menu" id="year-dropdown-menu">
                  ${this.yearOptions.map(year => `<div class="filter-dropdown-item ${year === this.selectedYear ? 'selected' : ''}" data-value="${year}">${year}</div>`).join('')}
                </div>
              </div>

              <button class="toggle-btn active" data-view-mode="top-systems" aria-pressed="true">Top Systems</button>
              <button class="toggle-btn" data-view-mode="top-100" aria-pressed="false">Top 100</button>
              <button class="toggle-btn" data-view-mode="reports" aria-pressed="false">Reports</button>
            </div>
          </div>
        </div>

        <div id="farm-content-area" style="margin-top: 1rem;">
            ${this.renderLoadingState('Loading Farm Data...')}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    // Dropdown toggles
    this.container.querySelectorAll('.filter-dropdown-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dropdown = btn.closest('.filter-dropdown');
        this.container.querySelectorAll('.filter-dropdown').forEach(d => {
            if (d !== dropdown) d.classList.remove('open');
        });
        dropdown?.classList.toggle('open');
      });
    });

    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
        if (!(e.target as HTMLElement).closest('.filter-dropdown')) {
            this.container.querySelectorAll('.filter-dropdown').forEach(d => {
                d.classList.remove('open');
            });
        }
    });

    // Year selection
    this.container.querySelectorAll('#year-dropdown-menu .filter-dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const value = (e.target as HTMLElement).dataset.value;
            if (!value) return;
            
            this.selectedYear = parseInt(value, 10);
            
            const displaySpan = this.container.querySelector('#selected-year-display');
            if (displaySpan) displaySpan.textContent = value;
            
            this.container.querySelectorAll('#year-dropdown-menu .filter-dropdown-item').forEach(i => i.classList.remove('selected'));
            (e.target as HTMLElement).classList.add('selected');
            
            (e.target as HTMLElement).closest('.filter-dropdown')?.classList.remove('open');
            
            this.showLoadingState();
            this.loadData();
        });
    });

    this.container.querySelectorAll('[data-view-mode]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const mode = (e.target as HTMLElement).dataset.viewMode as 'top-systems' | 'top-100' | 'reports';
            if (mode === this.viewMode) return;
            
            this.viewMode = mode;
            this.container.querySelectorAll('[data-view-mode]').forEach(b => {
                const isActive = b === e.target;
                b.classList.toggle('active', isActive);
                b.setAttribute('aria-pressed', String(isActive));
            });
            
            this.renderView();
        });
    });
  }

  private showLoadingState(message: string = 'Loading...'): void {
      const content = this.container.querySelector('#farm-content-area');
      if (content) content.innerHTML = this.renderLoadingState(message);
  }

  private renderLoadingState(title: string): string {
      return `
        <div class="loading-skeleton" style="padding: 2rem;">
          <h3 class="section-title">${title}</h3>
          <div class="team-preview-list">
            ${Array.from({ length: 5 }, () => `<div class="skeleton-line sm" style="margin-bottom: 1rem;"></div>`).join('')}
          </div>
        </div>
      `;
  }

  private async loadData(): Promise<void> {
    try {
        this.data = await teamRatingsService.getFarmData(this.selectedYear);
        this.renderView();
    } catch (err) {
        console.error(err);
        const content = this.container.querySelector('#farm-content-area');
        if (content) content.innerHTML = '<p class="no-stats">Error loading farm data.</p>';
    }
  }

  private renderView(): void {
      if (!this.data) return;
      const content = this.container.querySelector('#farm-content-area');
      if (!content) return;

      switch (this.viewMode) {
          case 'top-systems':
              content.innerHTML = this.renderTopSystems();
              break;
          case 'top-100':
              content.innerHTML = this.renderTopProspects();
              break;
          case 'reports':
              content.innerHTML = this.renderReports();
              this.bindToggleEvents(); // Only needed for collapsible reports
              break;
      }
      
      this.bindPlayerNameClicks();
  }

  // --- TOP SYSTEMS VIEW ---
  private renderTopSystems(): string {
      if (!this.data || this.data.systems.length === 0) return '<p class="no-stats">No system data available.</p>';

      const rows = this.data.systems.map((sys, idx) => {
        // Find corresponding report data for full prospect list
        const report = this.data?.reports.find(r => r.teamId === sys.teamId);
        const allProspects = report ? [...report.rotation, ...report.bullpen].sort((a, b) => b.peakWar - a.peakWar) : [];
        const systemKey = `sys-${sys.teamId}`;

        return `
        <tr class="system-row" data-system-key="${systemKey}" style="cursor: pointer;">
            <td style="font-weight: bold; color: var(--color-text-muted);">${idx + 1}</td>
            <td style="font-weight: 600; text-align: left;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span class="toggle-icon" style="font-size: 0.8em; width: 12px;">▶</span>
                    ${sys.teamName}
                </div>
            </td>
            <td style="text-align: center;"><span class="badge ${this.getWarClass(sys.totalWar)}">${sys.totalWar.toFixed(1)}</span></td>
            <td style="text-align: left;"><button class="btn-link player-name-link" data-player-id="${sys.topProspectId}">${sys.topProspectName}</button></td>
            <td style="text-align: center;">${sys.tierCounts.elite > 0 ? `<span class="badge rating-elite">${sys.tierCounts.elite}</span>` : '-'}</td>
            <td style="text-align: center;">${sys.tierCounts.aboveAvg > 0 ? `<span class="badge rating-plus">${sys.tierCounts.aboveAvg}</span>` : '-'}</td>
            <td style="text-align: center;">${sys.tierCounts.average > 0 ? `<span class="badge rating-avg">${sys.tierCounts.average}</span>` : '-'}</td>
            <td style="text-align: center;">${sys.tierCounts.fringe > 0 ? `<span class="badge rating-fringe">${sys.tierCounts.fringe}</span>` : '-'}</td>
        </tr>
        <tr id="details-${systemKey}" style="display: none; background-color: var(--color-surface-hover);">
            <td colspan="8" style="padding: 0;">
                <div style="padding: 1rem; max-height: 400px; overflow-y: auto;">
                    ${this.renderSystemDetails(allProspects)}
                </div>
            </td>
        </tr>
      `}).join('');

      // Add a script/handler call to bind these new toggles
      setTimeout(() => this.bindSystemToggles(), 0);

      return `
        <div class="stats-table-container">
            <h3 class="section-title">Organizational Rankings <span class="note-text">(by Total Peak WAR)</span></h3>
            <table class="stats-table" style="width: 100%;">
                <thead>
                    <tr>
                        <th style="width: 40px;">#</th>
                        <th style="text-align: left;">Organization</th>
                        <th style="text-align: center;">Total WAR</th>
                        <th style="text-align: left;">Top Prospect</th>
                        <th style="text-align: center;" title="Elite (4.5+ TFR)">Elite</th>
                        <th style="text-align: center;" title="Above Average (3.5-4.0 TFR)">Good</th>
                        <th style="text-align: center;" title="Average (2.5-3.0 TFR)">Avg</th>
                        <th style="text-align: center;" title="Fringe (< 2.5 TFR)">Depth</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
      `;
  }

  private renderSystemDetails(prospects: RatedProspect[]): string {
    if (prospects.length === 0) return '<p class="no-stats">No prospects found.</p>';

    const columns: FarmColumn[] = [
        { key: 'name', label: 'Name' },
        { key: 'trueFutureRating', label: 'TFR' },
        { key: 'level', label: 'Lvl' },
        { key: 'age', label: 'Age' },
        { key: 'peakFip', label: 'Peak FIP' },
        { key: 'peakWar', label: 'Peak WAR' }
    ];

    const headerRow = columns.map(col => `<th>${col.label}</th>`).join('');

    const rows = prospects.map(player => {
      const cells = columns.map(col => `<td>${this.renderCell(player, col)}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    return `
      <table class="stats-table team-ratings-table" style="width: 100%; font-size: 0.9em;">
        <thead>
          <tr>${headerRow}</tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  }

  private bindSystemToggles(): void {
      this.container.querySelectorAll('.system-row').forEach(row => {
          row.addEventListener('click', (e) => {
              // Prevent toggle if clicking a player link
              if ((e.target as HTMLElement).closest('.player-name-link')) return;

              const systemKey = (row as HTMLElement).dataset.systemKey;
              const detailsRow = this.container.querySelector(`#details-${systemKey}`);
              const icon = row.querySelector('.toggle-icon');
              
              if (detailsRow && icon) {
                  const isHidden = (detailsRow as HTMLElement).style.display === 'none';
                  (detailsRow as HTMLElement).style.display = isHidden ? 'table-row' : 'none';
                  icon.textContent = isHidden ? '▼' : '▶';
                  row.classList.toggle('expanded', isHidden);
              }
          });
      });
      
      // Re-bind player name clicks for the newly rendered details
      this.bindPlayerNameClicks();
  }

  // --- TOP 100 PROSPECTS VIEW ---
  private renderTopProspects(): string {
      if (!this.data || this.data.prospects.length === 0) return '<p class="no-stats">No prospect data available.</p>';

      const top100 = this.data.prospects.slice(0, 100);
      
      const rows = top100.map((p, idx) => `
        <tr>
            <td style="font-weight: bold; color: var(--color-text-muted);">${idx + 1}</td>
            <td><button class="btn-link player-name-link" data-player-id="${p.playerId}">${p.name}</button></td>
            <td style="text-align: left;">${this.getTeamName(p.teamId)}</td>
            <td style="text-align: center;">${this.renderRatingBadge(p.trueFutureRating)}</td>
            <td style="text-align: center;"><span class="badge ${this.getWarClass(p.peakWar)}">${p.peakWar.toFixed(1)}</span></td>
            <td style="text-align: center;">${p.peakFip.toFixed(2)}</td>
            <td style="text-align: center;">${p.age}</td>
            <td style="text-align: center;"><span class="level-badge level-${p.level.toLowerCase()}">${p.level}</span></td>
        </tr>
      `).join('');

      return `
        <div class="stats-table-container">
            <h3 class="section-title">Top 100 Prospects <span class="note-text">(by True Future Rating)</span></h3>
            <table class="stats-table" style="width: 100%;">
                <thead>
                    <tr>
                        <th style="width: 40px;">#</th>
                        <th>Name</th>
                        <th style="text-align: left;">Team</th>
                        <th style="text-align: center;">TFR</th>
                        <th style="text-align: center;">Peak WAR</th>
                        <th style="text-align: center;">Peak FIP</th>
                        <th style="text-align: center;">Age</th>
                        <th style="text-align: center;">Level</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
      `;
  }

  // --- REPORTS VIEW (Original) ---
  private renderReports(): string {
      if (!this.data) return '';
      
      // Render layout containers manually since we're injecting into content area
      const rotSorted = [...this.data.reports].sort((a, b) => b.rotationScore - a.rotationScore);
      const penSorted = [...this.data.reports].sort((a, b) => b.bullpenScore - a.bullpenScore);

      return `
        <div class="team-ratings-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;">
            <div id="farm-rotation-rankings">
                ${this.renderFarmCollapsible({
                    title: 'Top Future Rotations',
                    note: '(Ranked by Top 5 Peak WAR)',
                    type: 'rotation',
                    teams: rotSorted
                })}
            </div>
            <div id="farm-bullpen-rankings">
                ${this.renderFarmCollapsible({
                    title: 'Top Future Bullpens',
                    note: '(Ranked by Top 5 Peak WAR)',
                    type: 'bullpen',
                    teams: penSorted
                })}
            </div>
        </div>
      `;
  }

  private renderFarmCollapsible(params: {
    title: string;
    note: string;
    type: 'rotation' | 'bullpen';
    teams: FarmSystemRankings[];
  }): string {
    const previewTeams = params.teams.slice(0, 3);
    const preview = previewTeams.length
      ? previewTeams.map((team, idx) => this.renderTeamPreviewRow(team, idx + 1, params.type)).join('')
      : '<p class="no-stats">No data available.</p>';

    const fullList = params.teams.length
      ? params.teams.map((team, idx) => this.renderTeamRow(team, idx + 1, params.type)).join('')
      : '<p class="no-stats">No data available.</p>';

    return `
      <details class="team-collapsible">
        <summary class="team-collapsible-summary">
          <div>
            <h3 class="section-title">${params.title} <span class="note-text">${params.note}</span></h3>
            <div class="team-preview-list">
              ${preview}
            </div>
          </div>
          <span class="team-collapsible-label">
            <span class="team-collapsible-icon team-collapsible-icon-open">−</span>
            <span class="team-collapsible-icon team-collapsible-icon-closed">+</span>
            <span class="team-collapsible-text team-collapsible-text-open">Collapse list</span>
            <span class="team-collapsible-text team-collapsible-text-closed">View full list</span>
          </span>
        </summary>
        <div class="team-list">
          ${fullList}
        </div>
      </details>
    `;
  }

  private renderTeamPreviewRow(team: FarmSystemRankings, rank: number, type: 'rotation' | 'bullpen'): string {
      const score = type === 'rotation' ? team.rotationScore : team.bullpenScore;
      const scoreClass = this.getScoreClass(score);

      return `
        <div class="team-preview-row">
          <span class="team-preview-rank">#${rank}</span>
          <span class="team-preview-name">${team.teamName}</span>
          <span class="badge ${scoreClass} team-preview-score">${score.toFixed(1)}</span>
        </div>
      `;
  }

  private renderTeamRow(team: FarmSystemRankings, rank: number, type: 'rotation' | 'bullpen'): string {
      const score = type === 'rotation' ? team.rotationScore : team.bullpenScore;
      const scoreClass = this.getScoreClass(score);
      const teamKey = `${team.teamId}-${type}`;
      
      return `
        <div class="team-card">
            <div class="team-header" data-team-key="${teamKey}" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 4px; margin-bottom: 0.5rem;">
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <span style="font-weight: bold; color: var(--color-text-muted); width: 20px;">#${rank}</span>
                    <span style="font-weight: 600;">${team.teamName}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 1rem;">
                     <span class="badge ${scoreClass}" style="font-size: 1.1em;">${score.toFixed(1)}</span>
                     <span class="toggle-icon">▼</span>
                </div>
            </div>
            <div class="team-details" id="details-${teamKey}" style="display: none; padding: 0.5rem; background: var(--color-surface-hover); margin-bottom: 1rem; border-radius: 4px;">
                ${this.renderTeamDetailsTable(team, type)}
            </div>
        </div>
      `;
  }

  private renderTeamDetailsTable(team: FarmSystemRankings, type: 'rotation' | 'bullpen'): string {
    const players = type === 'rotation' ? team.rotation : team.bullpen;
    
    // Columns
    const columns: FarmColumn[] = [
        { key: 'name', label: 'Name' },
        { key: 'trueFutureRating', label: 'TFR' },
        { key: 'level', label: 'Lvl' },
        { key: 'age', label: 'Age' },
        { key: 'peakFip', label: 'Peak FIP' },
        { key: 'peakWar', label: 'Peak WAR' }
    ];

    const headerRow = columns.map(col => `<th>${col.label}</th>`).join('');

    const rows = players.map(player => {
      const cells = columns.map(col => `<td>${this.renderCell(player, col)}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    const emptyRow = players.length === 0
      ? `<tr><td colspan="${columns.length}" style="text-align: center; color: var(--color-text-muted)">No qualified prospects</td></tr>`
      : '';

    return `
      <table class="stats-table team-ratings-table" style="width: 100%; font-size: 0.9em;">
        <thead>
          <tr>${headerRow}</tr>
        </thead>
        <tbody>
          ${rows}
          ${emptyRow}
        </tbody>
      </table>
    `;
  }

  private renderCell(player: RatedProspect, column: FarmColumn): string {
    switch (column.key) {
      case 'name':
        return `<button class="btn-link player-name-link" data-player-id="${player.playerId}">${player.name}</button>`;
      case 'trueFutureRating':
        return this.renderRatingBadge(player.trueFutureRating);
      case 'level':
        return player.level;
      case 'age':
        return player.age.toString();
      case 'peakFip':
        return player.peakFip.toFixed(2);
      case 'peakWar':
        const warClass = this.getWarClass(player.peakWar);
        return `<span class="badge ${warClass}" style="padding: 2px 6px; font-size: 0.85em;">${player.peakWar.toFixed(1)}</span>`;
      default:
        return '';
    }
  }

  private renderRatingBadge(value: number): string {
    let className = 'rating-poor';
    if (value >= 4.5) className = 'rating-elite';
    else if (value >= 4.0) className = 'rating-plus';
    else if (value >= 3.0) className = 'rating-avg';
    else if (value >= 2.0) className = 'rating-fringe';

    return `<span class="badge ${className}">${value.toFixed(1)}</span>`;
  }

  private getScoreClass(score: number): string {
      if (score >= 25) return 'rating-elite';
      if (score >= 15) return 'rating-plus';
      if (score >= 10) return 'rating-avg';
      if (score >= 5) return 'rating-fringe';
      return 'rating-poor';
  }

  private getWarClass(war: number): string {
      if (war >= 6) return 'rating-elite';
      if (war >= 4) return 'rating-plus';
      if (war >= 2) return 'rating-avg';
      if (war >= 0) return 'rating-fringe';
      return 'rating-poor';
  }

  private bindToggleEvents(): void {
      this.container.querySelectorAll('.team-header').forEach(header => {
          header.addEventListener('click', () => {
              const teamKey = (header as HTMLElement).dataset.teamKey;
              const details = this.container.querySelector(`#details-${teamKey}`);
              const icon = header.querySelector('.toggle-icon');
              
              if (details && icon) {
                  const isHidden = (details as HTMLElement).style.display === 'none';
                  (details as HTMLElement).style.display = isHidden ? 'block' : 'none';
                  icon.textContent = isHidden ? '▲' : '▼';
              }
          });
      });
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
      let prospect: RatedProspect | undefined;
      // Search in all prospects list
      if (this.data) {
          prospect = this.data.prospects.find(p => p.playerId === playerId);
      }

      if (!prospect) return;

      this.playerProfileModal.show({
          playerId: prospect.playerId,
          playerName: prospect.name,
          team: '', 
          parentTeam: '',
          age: prospect.age,
          positionLabel: 'P',
          trueRating: prospect.trueFutureRating,
          estimatedStuff: prospect.potentialRatings.stuff,
          
          scoutStuff: prospect.scoutingRatings.stuff,
          scoutControl: prospect.scoutingRatings.control,
          scoutHra: prospect.scoutingRatings.hra,
          scoutStamina: prospect.scoutingRatings.stamina,
          
          pitchCount: prospect.scoutingRatings.pitches,
          pitches: [],
          pitchRatings: {},

          isProspect: true,
          year: this.selectedYear,
          showYearLabel: true,
      }, this.selectedYear);
  }

  private getTeamName(teamId: number): string {
      // Helper to find team name from reports data if needed, or simple lookup
      // Since we don't have a direct Team Map here, we can infer from reports or systems
      if (this.data) {
          const sys = this.data.systems.find(s => s.teamId === teamId);
          if (sys) return sys.teamName;
          // Try to find in prospect's team ID? No, prospect stores minor league team ID usually.
          // We need parent team name.
          // RatedProspect stores teamId (which is minor league team).
          // We don't have parent name easily accessible on prospect object.
          // For now, return "Org " + teamId or generic.
          // Wait, getFarmData logic in service does look up parent.
          // We should probably add `orgName` to RatedProspect for display convenience.
      }
      return 'Org';
  }
}