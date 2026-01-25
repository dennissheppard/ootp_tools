import { teamRatingsService, TeamRatingResult, RatedPlayer } from '../services/TeamRatingsService';
import { RatingEstimatorService } from '../services/RatingEstimatorService';
import { dateService } from '../services/DateService';
import { PlayerProfileModal, PlayerProfileData } from './PlayerProfileModal';
import { playerService } from '../services/PlayerService';
import { teamService } from '../services/TeamService';
import { scoutingDataService } from '../services/ScoutingDataService';

export class TeamRatingsView {
  private container: HTMLElement;
  private selectedYear: number = 2020;
  private viewMode: 'actual' | 'projected' = 'actual';
  private results: TeamRatingResult[] = [];
  private yearOptions = Array.from({ length: 22 }, (_, i) => 2021 - i); // 2021 down to 2000
  private currentGameYear: number | null = null;
  private playerProfileModal: PlayerProfileModal;
  private playerRowLookup: Map<number, RatedPlayer> = new Map();

  constructor(container: HTMLElement) {
    this.container = container;
    this.playerProfileModal = new PlayerProfileModal();
    this.renderLayout();
    this.loadCurrentGameYear();
    this.loadData();
  }

  private renderLayout(): void {
    this.container.innerHTML = `
      <div class="true-ratings-content">
        <h2 class="view-title">Team Ratings</h2>
        
        <div class="true-ratings-controls">          
          <div class="form-field">
            <label>View:</label>
            <div class="toggle-group" role="group" aria-label="View mode">
              <button class="toggle-btn active" data-view-mode="actual" aria-pressed="true">Actual</button>
              <button class="toggle-btn" data-view-mode="projected" aria-pressed="false">Projections</button>
            </div>
          </div>
          <div class="form-field" id="year-selector-field">
            <label for="team-ratings-year">Base Year:</label>
            <select id="team-ratings-year">
              ${this.yearOptions.map(year => `<option value="${year}" ${year === this.selectedYear ? 'selected' : ''}>${year}</option>`).join('')}
            </select>
          </div>
        </div>

        <div id="projection-notice" style="display: none; margin-bottom: 1rem; padding: 0.5rem; background: rgba(var(--color-primary-rgb), 0.1); border-radius: 4px; border: 1px solid rgba(var(--color-primary-rgb), 0.2);">
            <strong>Projections:</strong> Showing projected ratings for the <em>upcoming</em> season (${this.selectedYear + 1}) based on historical data and wizardry. These will not update throughout the year. Use 'actual' to show current team ratings.
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

    this.bindEvents();
  }

  private bindEvents(): void {
    this.container.querySelector('#team-ratings-year')?.addEventListener('change', (e) => {
      this.selectedYear = parseInt((e.target as HTMLSelectElement).value, 10);
      this.updateProjectionNotice();
      this.loadData();
    });

    this.container.querySelectorAll('[data-view-mode]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const mode = (e.target as HTMLElement).dataset.viewMode as 'actual' | 'projected';
            if (mode === this.viewMode) return;
            
            this.viewMode = mode;
            
            // If switching to projections, force latest year (2020)
            if (this.viewMode === 'projected') {
                this.selectedYear = 2020;
                const yearSelect = this.container.querySelector<HTMLSelectElement>('#team-ratings-year');
                if (yearSelect) yearSelect.value = '2020';
            }

            this.container.querySelectorAll('[data-view-mode]').forEach(btn => {
                const b = btn as HTMLElement;
                const isActive = b.dataset.viewMode === mode;
                b.classList.toggle('active', isActive);
                b.setAttribute('aria-pressed', String(isActive));
            });
            
            this.updateProjectionNotice();
            this.loadData();
        });
    });
  }

  private updateProjectionNotice(): void {
      const notice = this.container.querySelector<HTMLElement>('#projection-notice');
      const yearField = this.container.querySelector<HTMLElement>('#year-selector-field');
      
      if (notice) {
          notice.style.display = this.viewMode === 'projected' ? 'block' : 'none';
          notice.innerHTML = `<strong>Projections:</strong> Showing projected ratings for the <em>upcoming</em> season (${this.selectedYear + 1}) based on historical data and wizardry. These will not update throughout the year. Use 'actual' to show current team ratings.`;
      }
      
      if (yearField) {
          yearField.style.display = this.viewMode === 'projected' ? 'none' : 'block';
      }
  }

  private async loadData(): Promise<void> {
    const rotContainer = this.container.querySelector('#rotation-rankings .loading-message');
    const penContainer = this.container.querySelector('#bullpen-rankings .loading-message');
    
    if (rotContainer) rotContainer.innerHTML = 'Loading...';
    if (penContainer) penContainer.innerHTML = 'Loading...';

    try {
        if (this.viewMode === 'actual') {
            this.results = await teamRatingsService.getTeamRatings(this.selectedYear);
        } else {
            console.log('Fetching projections...', teamRatingsService);
            if (typeof teamRatingsService.getProjectedTeamRatings !== 'function') {
                console.error('getProjectedTeamRatings is missing on teamRatingsService!', teamRatingsService);
                throw new Error('Service method missing. Please refresh the page.');
            }
            this.results = await teamRatingsService.getProjectedTeamRatings(this.selectedYear);
        }
        if (this.results.length === 0) {
            await this.renderNoData();
            return;
        }
        this.renderLists();
    } catch (err) {
        console.error(err);
        await this.renderNoData(err);
    }
  }

  private renderLists(): void {
      const rotContainer = this.container.querySelector('#rotation-rankings');
      const penContainer = this.container.querySelector('#bullpen-rankings');

      if (!rotContainer || !penContainer) return;

      // Build player lookup for modal access
      this.playerRowLookup = new Map();
      this.results.forEach(team => {
        team.rotation.forEach(p => this.playerRowLookup.set(p.playerId, p));
        team.bullpen.forEach(p => this.playerRowLookup.set(p.playerId, p));
      });

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
      this.bindPlayerNameClicks();
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
                            <th>${this.viewMode === 'projected' ? 'WAR' : 'ERA'}</th>
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
                                <td><button class="btn-link player-name-link" data-player-id="${p.playerId}">${p.name}</button></td>
                                <td>${this.renderRatingBadge(p)}</td>
                                <td>${p.stats.ip.toFixed(1)}</td>
                                <td>${this.renderFlipCell(p.stats.k9.toFixed(2), estStuff.toString(), 'Est Stuff Rating')}</td>
                                <td>${this.renderFlipCell(p.stats.bb9.toFixed(2), estControl.toString(), 'Est Control Rating')}</td>
                                <td>${this.renderFlipCell(p.stats.hr9.toFixed(2), estHra.toString(), 'Est HRA Rating')}</td>
                                <td>${this.viewMode === 'projected' ? (p.stats.war?.toFixed(1) ?? '0.0') : p.stats.era.toFixed(2)}</td>
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
    if (typeof player.trueRating !== 'number') {
        console.warn('Missing trueRating for player:', player);
        return '<span class="badge rating-poor">N/A</span>';
    }
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

    // Extract pitch names and ratings if available
    const pitches = scouting?.pitches ? Object.keys(scouting.pitches) : [];
    const pitchRatings = scouting?.pitches ?? {};
    const usablePitchCount = row.pitchCount; // Already calculated in TeamRatingsService

    // Determine if we should show the year label (only for historical data)
    const currentYear = this.currentGameYear ?? await dateService.getCurrentYear();
    const isHistorical = this.selectedYear < currentYear - 1;

    const profileData: PlayerProfileData = {
      playerId: row.playerId,
      playerName: row.name,
      team: teamLabel,
      parentTeam: parentLabel,
      position: row.isSp ? 'SP' : 'RP',
      trueRating: row.trueRating,
      estimatedStuff: row.trueStuff,
      estimatedControl: row.trueControl,
      estimatedHra: row.trueHra,
      scoutStuff: scouting?.stuff,
      scoutControl: scouting?.control,
      scoutHra: scouting?.hra,
      scoutStamina: scouting?.stamina,
      scoutInjuryProneness: scouting?.injuryProneness,
      scoutOvr: scouting?.ovr,
      scoutPot: scouting?.pot,
      pitchCount: usablePitchCount,
      pitches,
      pitchRatings,
      isProspect: false,
      year: this.selectedYear,
      showYearLabel: isHistorical
    };

    await this.playerProfileModal.show(profileData, this.selectedYear);
  }

  private async loadCurrentGameYear(): Promise<void> {
      try {
          this.currentGameYear = await dateService.getCurrentYear();
      } catch {
          this.currentGameYear = null;
      }
  }

  private async renderNoData(_error?: unknown): Promise<void> {
      if (this.currentGameYear === null) {
          await this.loadCurrentGameYear();
      }
      const year = this.selectedYear;
      const isCurrentOrFuture = this.currentGameYear !== null && year >= this.currentGameYear;
      const baseMessage = isCurrentOrFuture
          ? `No ${year} data yet. Try a previous year or check back once the season starts. For now, check out the team projections!`
          : `No data found for ${year}.`;

      const message = this.viewMode === 'projected'
          ? `Unable to load projections for ${year}.`
          : baseMessage;

      const rotContainer = this.container.querySelector('#rotation-rankings');
      const penContainer = this.container.querySelector('#bullpen-rankings');
      if (rotContainer) {
          rotContainer.innerHTML = `
            <h3 class="section-title">Top Rotations</h3>
            <p class="no-stats">${message}</p>
          `;
      }
      if (penContainer) {
          penContainer.innerHTML = `
            <h3 class="section-title">Top Bullpens</h3>
            <p class="no-stats">${message}</p>
          `;
      }
  }
}
