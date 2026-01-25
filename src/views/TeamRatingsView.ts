import { teamRatingsService, TeamRatingResult, RatedPlayer } from '../services/TeamRatingsService';
import { RatingEstimatorService } from '../services/RatingEstimatorService';

export class TeamRatingsView {
  private container: HTMLElement;
  private selectedYear: number = 2020;
  private results: TeamRatingResult[] = [];
  private yearOptions = Array.from({ length: 22 }, (_, i) => 2021 - i); // 2021 down to 2000

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderLayout();
    this.loadData();
  }

  private renderLayout(): void {
    this.container.innerHTML = `
      <div class="true-ratings-content">
        <h2 class="view-title">Team Ratings</h2>
        
        <div class="true-ratings-controls">
          <div class="form-field">
            <label for="team-ratings-year">Year:</label>
            <select id="team-ratings-year">
              ${this.yearOptions.map(year => `<option value="${year}" ${year === this.selectedYear ? 'selected' : ''}>${year}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="team-ratings-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-top: 1rem;">
            <div id="rotation-rankings">
                <h3 class="section-title">Top Rotations</h3>
                <div class="loading-message">Loading...</div>
            </div>
            <div id="bullpen-rankings">
                <h3 class="section-title">Top Bullpens</h3>
                <div class="loading-message">Loading...</div>
            </div>
        </div>
      </div>
    `;

    this.container.querySelector('#team-ratings-year')?.addEventListener('change', (e) => {
      this.selectedYear = parseInt((e.target as HTMLSelectElement).value, 10);
      this.loadData();
    });
  }

  private async loadData(): Promise<void> {
    const rotContainer = this.container.querySelector('#rotation-rankings .loading-message');
    const penContainer = this.container.querySelector('#bullpen-rankings .loading-message');
    
    if (rotContainer) rotContainer.innerHTML = 'Loading...';
    if (penContainer) penContainer.innerHTML = 'Loading...';

    try {
        this.results = await teamRatingsService.getTeamRatings(this.selectedYear);
        this.renderLists();
    } catch (err) {
        console.error(err);
        this.container.innerHTML += `<div class="error-message">Error loading team ratings: ${err}</div>`;
    }
  }

  private renderLists(): void {
      const rotContainer = this.container.querySelector('#rotation-rankings');
      const penContainer = this.container.querySelector('#bullpen-rankings');
      
      if (!rotContainer || !penContainer) return;

      // Render Rotation List
      const rotSorted = [...this.results].sort((a, b) => b.rotationScore - a.rotationScore);
      rotContainer.innerHTML = `
        <h3 class="section-title">Top Rotations</h3>
        <div class="team-list">
            ${rotSorted.map((team, idx) => this.renderTeamRow(team, idx + 1, 'rotation')).join('')}
        </div>
      `;

      // Render Bullpen List
      const penSorted = [...this.results].sort((a, b) => b.bullpenScore - a.bullpenScore);
      penContainer.innerHTML = `
        <h3 class="section-title">Top Bullpens</h3>
        <div class="team-list">
            ${penSorted.map((team, idx) => this.renderTeamRow(team, idx + 1, 'bullpen')).join('')}
        </div>
      `;

      this.bindToggleEvents();
      this.bindFlipCardLocking();
  }

  private renderTeamRow(team: TeamRatingResult, rank: number, type: 'rotation' | 'bullpen'): string {
      const score = type === 'rotation' ? team.rotationScore : team.bullpenScore;
      const players = type === 'rotation' ? team.rotation : team.bullpen;
      const top5 = players.slice(0, 5); // Show top 5
      
      const scoreClass = score >= 20 ? 'rating-elite' : score >= 15 ? 'rating-plus' : score >= 10 ? 'rating-avg' : 'rating-poor';
      
      return `
        <div class="team-card">
            <div class="team-header" data-team-id="${team.teamId}" data-type="${type}" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 4px; margin-bottom: 0.5rem;">
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <span style="font-weight: bold; color: var(--color-text-muted); width: 20px;">#${rank}</span>
                    <span style="font-weight: 600;">${team.teamName}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 1rem;">
                     <span class="badge ${scoreClass}" style="font-size: 1.1em;">${score.toFixed(1)}</span>
                     <span class="toggle-icon">▼</span>
                </div>
            </div>
            <div class="team-details" id="details-${type}-${team.teamId}" style="display: none; padding: 0.5rem; background: var(--color-surface-hover); margin-bottom: 1rem; border-radius: 4px;">
                <table class="stats-table" style="width: 100%; font-size: 0.9em;">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>TR</th>
                            <th>IP</th>
                            <th>K/9</th>
                            <th>BB/9</th>
                            <th>HR/9</th>
                            <th>ERA</th>
                            <th>FIP</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${top5.map(p => {
                            const estStuff = RatingEstimatorService.estimateStuff(p.stats.k9, p.stats.ip).rating;
                            const estControl = RatingEstimatorService.estimateControl(p.stats.bb9, p.stats.ip).rating;
                            const estHra = RatingEstimatorService.estimateHRA(p.stats.hr9, p.stats.ip).rating;
                            
                            return `
                            <tr>
                                <td>${p.name}</td>
                                <td>${this.renderRatingBadge(p)}</td>
                                <td>${p.stats.ip.toFixed(1)}</td>
                                <td>${this.renderFlipCell(p.stats.k9.toFixed(2), estStuff.toString(), 'Est Stuff Rating')}</td>
                                <td>${this.renderFlipCell(p.stats.bb9.toFixed(2), estControl.toString(), 'Est Control Rating')}</td>
                                <td>${this.renderFlipCell(p.stats.hr9.toFixed(2), estHra.toString(), 'Est HRA Rating')}</td>
                                <td>${p.stats.era.toFixed(2)}</td>
                                <td>${p.stats.fip.toFixed(2)}</td>
                            </tr>
                        `}).join('')}
                        ${players.length === 0 ? '<tr><td colspan="8" style="text-align: center; color: var(--color-text-muted)">No qualified pitchers</td></tr>' : ''}
                    </tbody>
                </table>
            </div>
        </div>
      `;
  }

  private renderRatingBadge(player: RatedPlayer): string {
    const value = player.trueRating;
    let className = 'rating-poor';
    if (value >= 4.5) className = 'rating-elite';
    else if (value >= 4.0) className = 'rating-plus';
    else if (value >= 3.0) className = 'rating-avg';
    else if (value >= 2.0) className = 'rating-fringe';

    const title = `True Stuff: ${player.trueStuff}, True Control: ${player.trueControl}, True HRA: ${player.trueHra}`;

    return `<span class="badge ${className}" title="${title}" style="cursor: help;">${value.toFixed(1)}</span>`;
  }

  private renderFlipCell(front: string, back: string, title: string): string {
    return `
      <div class="flip-cell">
        <div class="flip-cell-inner">
          <div class="flip-cell-front">${front}</div>
          <div class="flip-cell-back">
            ${back}
            <span class="flip-tooltip">${title}</span>
          </div>
        </div>
      </div>
    `;
  }

  private bindToggleEvents(): void {
      this.container.querySelectorAll('.team-header').forEach(header => {
          header.addEventListener('click', () => {
              const teamId = (header as HTMLElement).dataset.teamId;
              const type = (header as HTMLElement).dataset.type;
              const details = this.container.querySelector(`#details-${type}-${teamId}`);
              const icon = header.querySelector('.toggle-icon');
              
              if (details && icon) {
                  const isHidden = (details as HTMLElement).style.display === 'none';
                  (details as HTMLElement).style.display = isHidden ? 'block' : 'none';
                  icon.textContent = isHidden ? '▲' : '▼';
                  
                  // Re-bind flip events if becoming visible (though checking querySelector inside might be safer globally)
                  // But flip events are bound on renderLists, so they should persist.
              }
          });
      });
  }

  private bindFlipCardLocking(): void {
    const cells = this.container.querySelectorAll<HTMLElement>('.flip-cell');
    cells.forEach((cell) => {
      // Remove old listener to avoid duplicates if re-rendering? 
      // renderLists completely replaces innerHTML, so no dupes.
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        cell.classList.toggle('is-flipped');
      });
    });
  }
}