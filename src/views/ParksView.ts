import { ParkFactorRow, ParkDimensions, parseParksCsv, formatParkFactor, getParkCharacterLabel, computeEffectiveParkFactors, computePitcherParkHrFactor } from '../services/ParkFactorService';
import { supabaseDataService } from '../services/SupabaseDataService';
import { teamService } from '../services/TeamService';
import { Team } from '../models/Team';
// playerService import removed — bats data now comes from ProjectedBatter
import { batterProjectionService, ProjectedBatter } from '../services/BatterProjectionService';
import { projectionService, ProjectedPlayer } from '../services/ProjectionService';
import { dateService } from '../services/DateService';
import { batterProfileModal } from './BatterProfileModal';
import { pitcherProfileModal } from './PitcherProfileModal';
import { teamLogoImg } from '../utils/teamLogos';
import { constructOptimalLineup } from '../services/LineupConstructionService';

export class ParksView {
  private container: HTMLElement;
  private parkFactorsMap: Map<number, ParkFactorRow> = new Map();
  private parkDimensionsMap: Map<number, ParkDimensions> = new Map();
  private parkIdByTeam: Map<number, number> = new Map(); // team_id -> park_id
  private selectedTeamId: number = 0;
  private allBatterProjections: ProjectedBatter[] = [];
  private allPitcherProjections: ProjectedPlayer[] = [];
  private teams: Team[] = [];
  private playerBats: Map<number, string> = new Map(); // playerId → L/R/S
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.init();
  }

  /** Kick off initial load and render. */
  private async init(): Promise<void> {
    this.container.innerHTML = '<div style="padding: 2rem; color: var(--color-text-muted);">Loading parks data...</div>';
    await this.ensureLoaded();
    // Only render if selectTeam hasn't already been called while we were loading
    if (!this._pendingTeamId) {
      this.renderContent();
    }
  }

  /** Select a park by team ID and re-render. Called from external navigation. */
  async selectTeam(teamId: number): Promise<void> {
    this.selectedTeamId = teamId;
    this._pendingTeamId = teamId;
    await this.ensureLoaded();
    // Set selection and do a full render (the dropdown + details)
    this.selectedTeamId = teamId;
    this.renderContent();
  }

  private _pendingTeamId: number | null = null;

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadPromise) {
      this.loadPromise = this.loadData();
    }
    await this.loadPromise;
  }

  private async loadData(): Promise<void> {
    if (this.loaded) return;
    const [parkFactorsData, year] = await Promise.all([
      supabaseDataService.getPrecomputed('park_factors'),
      dateService.getCurrentYear(),
    ]);

    if (parkFactorsData) {
      for (const [k, v] of Object.entries(parkFactorsData)) {
        this.parkFactorsMap.set(parseInt(k, 10), v as ParkFactorRow);
      }
    }

    // Load parks.csv for dimensions
    try {
      const resp = await fetch('/data/parks.csv');
      if (resp.ok) {
        const csvText = await resp.text();
        this.parkDimensionsMap = parseParksCsv(csvText);
      }
    } catch { /* no dimensions available */ }

    // Build team->park mapping from park_factors CSV and backfill park_name
    // (precomputed cache may lack park_name if synced before that field was added)
    try {
      const resp = await fetch('/data/park_factors.csv');
      if (resp.ok) {
        const csvText = await resp.text();
        const lines = csvText.trim().split(/\r?\n/);
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',');
          if (parts.length >= 4) {
            const teamId = parseInt(parts[0], 10);
            this.parkIdByTeam.set(teamId, parseInt(parts[2], 10));
            // Backfill park_name on precomputed ParkFactorRow if missing
            const pf = this.parkFactorsMap.get(teamId);
            if (pf && !pf.park_name) {
              pf.park_name = parts[3] ?? '';
            }
          }
        }
      }
    } catch { /* fallback: no park mapping */ }

    // Load projections, teams, and player data
    const [batters, pitchers, teams] = await Promise.all([
      batterProjectionService.getProjections(year),
      projectionService.getProjections(year),
      teamService.getAllTeams(),
    ]);
    this.allBatterProjections = batters;
    this.allPitcherProjections = pitchers;
    this.teams = teams;
    // Build bats map from projections (bats field added to ProjectedBatter)
    for (const b of batters) {
      if (b.bats) this.playerBats.set(b.playerId, b.bats);
    }

    // Default to user's team if set, otherwise no selection (prompt to pick)
    const savedTeam = localStorage.getItem('wbl-selected-team');
    if (savedTeam && savedTeam !== 'all' && this.parkFactorsMap.has(parseInt(savedTeam, 10))) {
      this.selectedTeamId = parseInt(savedTeam, 10);
    } else {
      this.selectedTeamId = 0; // no selection
    }

    this.loaded = true;
  }

  private renderContent(): void {
    // Build dropdown items sorted by team name
    const sortedEntries = [...this.parkFactorsMap.entries()]
      .map(([teamId, park]) => {
        const team = this.teams.find(t => t.id === teamId);
        return { teamId, park, team };
      })
      .sort((a, b) => (a.team?.name ?? '').localeCompare(b.team?.name ?? ''));

    const selectedEntry = this.selectedTeamId ? sortedEntries.find(e => e.teamId === this.selectedTeamId) : undefined;
    const selectedNickname = selectedEntry?.team?.nickname ?? '';
    const selectedLabel = selectedEntry ? `${selectedEntry.team?.name ?? ''} — ${selectedEntry.park.park_name}` : 'Select a ballpark...';

    let menuItems = '';
    for (const { teamId, park, team } of sortedEntries) {
      const nickname = team?.nickname ?? '';
      const logo = teamLogoImg(nickname, 'team-dropdown-logo');
      const selected = teamId === this.selectedTeamId ? 'selected' : '';
      menuItems += `<div class="filter-dropdown-item ${selected}" data-value="${teamId}" data-nickname="${nickname}">${logo}<span>${team?.name ?? ''}</span><span style="color:var(--color-text-muted); font-size:0.75rem; margin-left:auto;">${park.park_name}</span></div>`;
    }

    this.container.innerHTML = `
      <div style="padding: 1rem;">
        <div class="park-dropdown-row">
          <div class="filter-dropdown parks-dropdown" data-selected-id="${this.selectedTeamId}">
            <button class="filter-dropdown-btn parks-dropdown-btn" aria-haspopup="true" aria-expanded="false">
              <span class="parks-dropdown-display">${teamLogoImg(selectedNickname, 'team-btn-logo')}${selectedLabel}</span> ▾
            </button>
            <div class="filter-dropdown-menu parks-dropdown-menu">${menuItems}</div>
          </div>
        </div>
        <div class="parks-layout">
          <div class="parks-left-col">
            <div class="park-svg-container" id="park-svg-area"></div>
            <div id="park-info-area"></div>
          </div>
          <div class="parks-right-col">
            <div id="park-lineup-area"></div>
            <div id="park-fit-area"></div>
          </div>
        </div>
      </div>
    `;

    this.bindDropdown();
    if (this.selectedTeamId) {
      this.renderParkDetails();
    }
  }

  private bindDropdown(): void {
    const dropdown = this.container.querySelector('.parks-dropdown');
    const btn = dropdown?.querySelector('.parks-dropdown-btn');
    const menu = dropdown?.querySelector('.parks-dropdown-menu');
    if (!dropdown || !btn || !menu) return;

    btn.addEventListener('click', () => {
      const isOpen = dropdown.classList.contains('open');
      dropdown.classList.toggle('open', !isOpen);
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.parks-dropdown')) {
        dropdown.classList.remove('open');
      }
    });

    menu.querySelectorAll('.filter-dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        const teamId = parseInt((item as HTMLElement).dataset.value!, 10);
        const nickname = (item as HTMLElement).dataset.nickname ?? '';
        this.selectedTeamId = teamId;

        // Update display
        const entry = [...this.parkFactorsMap.entries()].find(([id]) => id === teamId);
        const team = this.teams.find(t => t.id === teamId);
        const label = entry ? `${team?.name ?? ''} — ${entry[1].park_name}` : '';
        const display = dropdown.querySelector('.parks-dropdown-display');
        if (display) display.innerHTML = `${teamLogoImg(nickname, 'team-btn-logo')}${label}`;

        // Update selected state
        menu.querySelectorAll('.filter-dropdown-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        dropdown.classList.remove('open');

        this.renderParkDetails();
      });
    });
  }

  private renderParkDetails(): void {
    const pf = this.parkFactorsMap.get(this.selectedTeamId);
    if (!pf) return;

    const parkId = this.parkIdByTeam.get(this.selectedTeamId);
    const dims = parkId ? this.parkDimensionsMap.get(parkId) : undefined;

    // SVG
    const svgArea = this.container.querySelector('#park-svg-area');
    if (svgArea) svgArea.innerHTML = this.renderParkSvg(pf, dims);

    // Info table
    const infoArea = this.container.querySelector('#park-info-area');
    if (infoArea) infoArea.innerHTML = this.renderParkInfo(pf, dims);

    // Lineup
    const lineupArea = this.container.querySelector('#park-lineup-area');
    if (lineupArea) lineupArea.innerHTML = this.renderHomeLineup();

    // Best fit
    const fitArea = this.container.querySelector('#park-fit-area');
    if (fitArea) fitArea.innerHTML = this.renderBestFitLists(pf);

    // Bind click handlers for player cards
    this.bindPlayerClicks();
  }

  private renderParkSvg(pf: ParkFactorRow, dims?: ParkDimensions): string {
    if (!dims) {
      return `<div style="padding: 2rem; color: var(--color-text-muted); text-align: center;">No park dimensions available</div>`;
    }

    const { label, class: pfClass } = getParkCharacterLabel(pf);

    // SVG viewBox: home plate at bottom center, fence above
    // Fence spans 90deg arc from LF foul pole (135deg) to RF foul pole (45deg)
    const W = 400, H = 300;
    const homeX = W / 2, homeY = H - 20;
    const SCALE = 0.55; // pixels per foot

    // 7 points interpolated across 90deg arc
    const startAngle = Math.PI * 0.75; // 135deg (LF line)
    const endAngle = Math.PI * 0.25;   // 45deg (RF line)

    const points: { x: number; y: number; dist: number; wallH: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const frac = i / 6;
      const angle = startAngle + (endAngle - startAngle) * frac;
      const dist = dims.distances[i];
      const wallH = dims.wallHeights[i];
      points.push({
        x: homeX + Math.cos(angle) * dist * SCALE,
        y: homeY - Math.sin(angle) * dist * SCALE,
        dist, wallH,
      });
    }

    // Build fence path (smooth curve through 7 points)
    let fencePath = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      fencePath += ` L ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}`;
    }

    // Fence color based on HR factor
    const fenceColor = pf.hr >= 1.05 ? '#e8864a' : pf.hr <= 0.95 ? '#4a9ee8' : '#8b98a5';
    // Wall thickness varies by wall height
    const baseStroke = 3;

    // Distance labels
    let labelsHtml = '';
    for (let i = 0; i < 7; i++) {
      const p = points[i];
      // Offset label outward from the point
      const frac = i / 6;
      const angle = startAngle + (endAngle - startAngle) * frac;
      const labelDist = 14;
      const lx = p.x + Math.cos(angle) * labelDist;
      const ly = p.y - Math.sin(angle) * labelDist;
      labelsHtml += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--color-text-muted)">${p.dist}'</text>`;
      // Wall height indicator (varying stroke width along fence)
      const wallRadius = Math.max(2, p.wallH * 0.3);
      labelsHtml += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${wallRadius}" fill="${fenceColor}" opacity="0.5"/>`;
    }

    // Foul lines
    const foulExtend = 250 * SCALE;
    const lfLineEnd = { x: homeX + Math.cos(startAngle) * foulExtend, y: homeY - Math.sin(startAngle) * foulExtend };
    const rfLineEnd = { x: homeX + Math.cos(endAngle) * foulExtend, y: homeY - Math.sin(endAngle) * foulExtend };

    // Home plate diamond
    const hpSize = 6;
    const homePlate = `M ${homeX} ${homeY - hpSize} L ${homeX + hpSize} ${homeY} L ${homeX + hpSize * 0.6} ${homeY + hpSize * 0.5} L ${homeX - hpSize * 0.6} ${homeY + hpSize * 0.5} L ${homeX - hpSize} ${homeY} Z`;

    // Foul poles (yellow dots at LF and RF fence endpoints)
    const foulPoleHtml = `
      <circle cx="${points[0].x.toFixed(1)}" cy="${points[0].y.toFixed(1)}" r="4" fill="#ffd700" stroke="#333" stroke-width="1"/>
      <circle cx="${points[6].x.toFixed(1)}" cy="${points[6].y.toFixed(1)}" r="4" fill="#ffd700" stroke="#333" stroke-width="1"/>
    `;

    // Grass/infield arc
    const infieldDist = 95 * SCALE;

    return `
      <div style="text-align: center; margin-bottom: 0.5rem;">
        <div style="font-size: 1rem; font-weight: 600; color: var(--color-text);">${pf.park_name}</div>
        <div class="${pfClass}" style="font-size: 0.75rem;">${label}</div>
      </div>
      <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <!-- Grass background -->
        <rect width="${W}" height="${H}" fill="#1a3320" rx="8"/>

        <!-- Infield dirt arc -->
        <circle cx="${homeX}" cy="${homeY}" r="${infieldDist}" fill="#3d2b1f" opacity="0.5"/>

        <!-- Foul lines -->
        <line x1="${homeX}" y1="${homeY}" x2="${lfLineEnd.x.toFixed(1)}" y2="${lfLineEnd.y.toFixed(1)}" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
        <line x1="${homeX}" y1="${homeY}" x2="${rfLineEnd.x.toFixed(1)}" y2="${rfLineEnd.y.toFixed(1)}" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>

        <!-- Fence -->
        <path d="${fencePath}" fill="none" stroke="${fenceColor}" stroke-width="${baseStroke}" stroke-linecap="round" stroke-linejoin="round"/>

        <!-- Fence glow for wall height -->
        <path d="${fencePath}" fill="none" stroke="${fenceColor}" stroke-width="${baseStroke + 4}" stroke-linecap="round" stroke-linejoin="round" opacity="0.15"/>

        <!-- Distance labels and wall height indicators -->
        ${labelsHtml}

        <!-- Foul poles -->
        ${foulPoleHtml}

        <!-- Home plate -->
        <path d="${homePlate}" fill="white" opacity="0.8"/>

        <!-- Base paths -->
        <line x1="${homeX}" y1="${homeY}" x2="${homeX - 45}" y2="${homeY - 45}" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
        <line x1="${homeX - 45}" y1="${homeY - 45}" x2="${homeX}" y2="${homeY - 90}" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
        <line x1="${homeX}" y1="${homeY - 90}" x2="${homeX + 45}" y2="${homeY - 45}" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
        <line x1="${homeX + 45}" y1="${homeY - 45}" x2="${homeX}" y2="${homeY}" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
      </svg>
    `;
  }

  private renderParkInfo(pf: ParkFactorRow, dims?: ParkDimensions): string {
    const fmtImpact = (v: number) => {
      const cls = v >= 1.03 ? 'pf-hitter-friendly' : v <= 0.97 ? 'pf-pitcher-friendly' : 'pf-neutral';
      return `<span class="${cls}">${formatParkFactor(v)}</span>`;
    };

    const tableRows = `
      <tr><td>HR</td><td>${pf.hr.toFixed(3)}</td><td>${fmtImpact(pf.hr)}</td><td>${fmtImpact(pf.hr_l)}</td><td>${fmtImpact(pf.hr_r)}</td></tr>
      <tr><td>AVG</td><td>${pf.avg.toFixed(3)}</td><td>${fmtImpact(pf.avg)}</td><td>${fmtImpact(pf.avg_l)}</td><td>${fmtImpact(pf.avg_r)}</td></tr>
      <tr><td>2B</td><td>${pf.d.toFixed(3)}</td><td>${fmtImpact(pf.d)}</td><td colspan="2" style="text-align:center; color: var(--color-text-muted); font-size:0.7rem;">no split</td></tr>
      <tr><td>3B</td><td>${pf.t.toFixed(3)}</td><td>${fmtImpact(pf.t)}</td><td colspan="2" style="text-align:center; color: var(--color-text-muted); font-size:0.7rem;">no split</td></tr>
    `;

    // Narrative
    const { label } = getParkCharacterLabel(pf);
    let narrative = `${pf.park_name} is a ${label.toLowerCase()} park. `;
    if (pf.avg <= 0.95) narrative += `It suppresses batting average (${formatParkFactor(pf.avg)}). `;
    else if (pf.avg >= 1.05) narrative += `It boosts batting average (${formatParkFactor(pf.avg)}). `;
    if (pf.hr <= 0.95) narrative += `HR rates are below average (${formatParkFactor(pf.hr)}). `;
    else if (pf.hr >= 1.05) narrative += `HR rates are well above average (${formatParkFactor(pf.hr)}). `;
    if (Math.abs(pf.hr_l - pf.hr_r) > 0.15) {
      narrative += `Notable handedness split: LHB HR ${formatParkFactor(pf.hr_l)} vs RHB HR ${formatParkFactor(pf.hr_r)}. `;
    }
    if (Math.abs(pf.avg_l - pf.avg_r) > 0.05) {
      narrative += `AVG split: LHB ${formatParkFactor(pf.avg_l)} vs RHB ${formatParkFactor(pf.avg_r)}. `;
    }
    if (pf.d >= 1.1) narrative += `Doubles are well above average (${formatParkFactor(pf.d)}). `;
    if (pf.t >= 1.1) narrative += `Triples are above average (${formatParkFactor(pf.t)}). `;

    let dimsHtml = '';
    if (dims) {
      dimsHtml = `
        <div style="margin-top: 0.5rem; font-size: 0.75rem; color: var(--color-text-muted);">
          Capacity: ${dims.capacity.toLocaleString()} &middot; ${dims.turf ? 'Turf' : 'Grass'}
        </div>
      `;
    }

    return `
      <table class="park-info-table">
        <thead><tr><th>Factor</th><th>Raw</th><th>Overall</th><th>vs LHB</th><th>vs RHB</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      ${dimsHtml}
      <p class="park-narrative">${narrative}</p>
    `;
  }

  private renderHomeLineup(): string {
    const pf = this.parkFactorsMap.get(this.selectedTeamId);
    const { lineup: teamBatters } = constructOptimalLineup(
      this.allBatterProjections.filter(b => (b.parentTeamId || b.teamId) === this.selectedTeamId && b.projectedStats.pa >= 200),
      b => b.projectedStats.war
    );

    const teamPitchers = this.allPitcherProjections
      .filter(p => (p.parentTeamId || p.teamId) === this.selectedTeamId && p.isSp)
      .sort((a, b) => b.projectedStats.war - a.projectedStats.war)
      .slice(0, 5);

    let html = '<div class="park-section-header">Home Team Lineup</div>';
    html += `<p class="park-narrative" style="margin-top:0;">Stats shown are already park-adjusted projections. The <span class="pf-hitter-friendly">orange</span> and <span class="pf-pitcher-friendly">blue</span> numbers next to each stat show how much the park adds or subtracts vs. a neutral park — e.g. .278 <span class="pf-pitcher-friendly" style="font-size:0.75rem;">-.012</span> means this player would hit .290 in a neutral park but .278 here. Orange = park boosts the stat, blue = park suppresses it. 2B/3B columns show the park's overall rate effect (no handedness splits available).</p>`;

    if (teamBatters.length === 0) {
      html += '<div style="padding: 0.5rem; color: var(--color-text-muted); font-size: 0.8rem;">No batters found for this team</div>';
    } else if (pf) {
      // Table header
      html += `<table class="park-info-table" style="font-size:0.75rem;">
        <thead><tr>
          <th style="min-width:28px;"></th><th>Name</th><th>Bats</th>
          <th>AVG</th><th>HR</th><th>2B</th><th>3B</th>
          <th>wOBA</th><th>WAR</th>
        </tr></thead><tbody>`;

      for (const b of teamBatters) {
        const bats = this.playerBats.get(b.playerId) ?? 'R';
        const eff = computeEffectiveParkFactors(pf, bats);
        const effects = this.computeBatterEffects(b, eff);

        html += `<tr class="park-lineup-card-row" data-player-id="${b.playerId}" data-type="batter" style="cursor:pointer;">
          <td class="pos-badge">${b.positionLabel}</td>
          <td>${b.name}</td>
          <td>${bats}</td>
          <td>${this.fmtStatEffect(b.projectedStats.avg, '.avg', effects.avgDelta)}</td>
          <td>${this.fmtStatEffect(b.projectedStats.hr, 'hr', effects.hrDelta)}</td>
          <td>${this.fmtPctEffect(eff.d)}</td>
          <td>${this.fmtPctEffect(eff.t)}</td>
          <td>${this.fmtStatEffect(b.projectedStats.woba, '.woba', effects.wobaDelta)}</td>
          <td>${this.fmtStatEffect(b.projectedStats.war, 'war', effects.warDelta)}</td>
        </tr>`;
      }
      html += '</tbody></table>';
    }

    if (teamPitchers.length > 0 && pf) {
      html += '<div class="park-section-header" style="margin-top: 0.75rem;">Starting Rotation</div>';
      const pitcherEffHr = computePitcherParkHrFactor(pf);
      // ERA effect: park avg/2B/3B factors affect hits allowed → runs.
      // Hitters face 75% RHB, 25% LHB (from pitcher's perspective)
      const avgFactor = (pf.avg_r * 0.75 + pf.avg_l * 0.25 + 1.0) / 2.0;
      const eraFactor = avgFactor * 0.40 + pitcherEffHr * 0.35 + ((pf.d + 1.0) / 2.0) * 0.15 + ((pf.t + 1.0) / 2.0) * 0.05 + 1.0 * 0.05;

      html += `<table class="park-info-table" style="font-size:0.75rem;">
        <thead><tr>
          <th>Name</th><th>FIP</th><th>HR/9</th>
          <th>HR/9 Eff</th><th>ERA Eff</th><th>WAR</th>
        </tr></thead><tbody>`;

      for (const p of teamPitchers) {
        const warDelta = p.projectedStats.war * (1 - pitcherEffHr) * 0.8;

        html += `<tr class="park-lineup-card-row" data-player-id="${p.playerId}" data-type="pitcher" style="cursor:pointer;">
          <td>${p.name}</td>
          <td>${p.projectedStats.fip.toFixed(2)}</td>
          <td>${p.projectedStats.hr9.toFixed(2)}</td>
          <td>${this.fmtPctEffect(pitcherEffHr)}</td>
          <td>${this.fmtPctEffect(eraFactor)}</td>
          <td>${this.fmtStatEffect(p.projectedStats.war, 'war', warDelta)}</td>
        </tr>`;
      }
      html += '</tbody></table>';
    }

    return html;
  }

  /** Compute park-adjusted stat deltas for a batter. */
  private computeBatterEffects(b: ProjectedBatter, eff: { avg: number; hr: number; d: number; t: number }): {
    avgDelta: number; hrDelta: number; wobaDelta: number; warDelta: number;
  } {
    const s = b.projectedStats;
    // AVG delta
    const avgDelta = s.avg * (eff.avg - 1);
    // HR delta (from HR count)
    const hrDelta = s.hr * (eff.hr - 1);
    // wOBA delta: approximate from component weights (HR ~35%, AVG ~30%, 2B ~20%, 3B ~5%, BB ~10% neutral)
    const combinedFactor = eff.hr * 0.35 + eff.avg * 0.30 + eff.d * 0.20 + eff.t * 0.05 + 1.0 * 0.10;
    const wobaDelta = s.woba * (combinedFactor - 1);
    // WAR delta: offensive WAR (~70%) affected by park
    const offWar = Math.max(0, s.war * 0.7);
    const warDelta = offWar * (combinedFactor - 1);
    return { avgDelta, hrDelta, wobaDelta, warDelta };
  }

  /** Format a stat value with its park delta, e.g. ".285 (+.008)" */
  private fmtStatEffect(base: number, type: string, delta: number): string {
    const absDelta = Math.abs(delta);
    if (absDelta < 0.0005 && type !== 'hr' && type !== 'war') return this.fmtStat(base, type);
    if (type === 'hr' && absDelta < 0.3) return this.fmtStat(base, type);
    if (type === 'war' && absDelta < 0.05) return this.fmtStat(base, type);

    const sign = delta >= 0 ? '+' : '';
    const cls = delta >= 0 ? 'pf-hitter-friendly' : 'pf-pitcher-friendly';
    let deltaStr: string;
    if (type === 'hr') deltaStr = `${sign}${delta.toFixed(0)}`;
    else if (type === 'war') deltaStr = `${sign}${delta.toFixed(1)}`;
    else deltaStr = `${sign}${delta.toFixed(3)}`;

    return `${this.fmtStat(base, type)} <span class="${cls}" style="font-size:0.65rem;">${deltaStr}</span>`;
  }

  private fmtStat(val: number, type: string): string {
    if (type === 'hr') return String(Math.round(val));
    if (type === 'war') return val.toFixed(1);
    return val.toFixed(3);
  }

  /** Format a pure park factor as a colored percentage effect, e.g. "+18%" */
  private fmtPctEffect(factor: number): string {
    const pct = Math.round((factor - 1.0) * 100);
    if (Math.abs(pct) < 1) return `<span class="pf-neutral">0%</span>`;
    const sign = pct > 0 ? '+' : '';
    const cls = pct > 0 ? 'pf-hitter-friendly' : 'pf-pitcher-friendly';
    return `<span class="${cls}">${sign}${pct}%</span>`;
  }

  private renderBestFitLists(pf: ParkFactorRow): string {
    let html = '';

    // Best hitters for this park
    html += '<div class="park-section-header">Best Hitters for This Park</div>';
    const batterDeltas: { batter: ProjectedBatter; delta: number; destWar: number }[] = [];

    for (const b of this.allBatterProjections) {
      if (b.projectedStats.pa < 200) continue;
      const originTeamId = b.parentTeamId || b.teamId;
      if (originTeamId === this.selectedTeamId) continue; // already at this park
      const originPark = this.parkFactorsMap.get(originTeamId);
      if (!originPark) continue;

      const bats = this.playerBats.get(b.playerId) ?? 'R';
      const originEff = computeEffectiveParkFactors(originPark, bats);
      const destEff = computeEffectiveParkFactors(pf, bats);

      // WAR delta from park change using all four components
      const originFactor = originEff.hr * 0.35 + originEff.avg * 0.30 + originEff.d * 0.20 + originEff.t * 0.05 + 1.0 * 0.10;
      const destFactor = destEff.hr * 0.35 + destEff.avg * 0.30 + destEff.d * 0.20 + destEff.t * 0.05 + 1.0 * 0.10;
      const offensiveWar = Math.max(0, b.projectedStats.war * 0.7);
      const delta = offensiveWar * (destFactor - originFactor);
      const destWar = b.projectedStats.war + delta;
      batterDeltas.push({ batter: b, delta, destWar });
    }

    batterDeltas.sort((a, b) => b.delta - a.delta);
    const topBatters = batterDeltas.slice(0, 10);

    html += '<div class="park-fit-list">';
    for (const { batter, delta, destWar } of topBatters) {
      const sign = delta >= 0 ? '+' : '';
      const cls = delta >= 0 ? 'positive' : 'negative';
      html += `
        <div class="park-fit-card" data-player-id="${batter.playerId}" data-type="batter">
          <span class="player-name">${batter.name} <span style="color: var(--color-text-muted); font-size: 0.7rem;">(${batter.teamName})</span></span>
          <span style="font-size: 0.7rem; color: var(--color-text-muted);">${batter.projectedStats.war.toFixed(1)} &rarr; ${destWar.toFixed(1)}</span>
          <span class="fit-delta ${cls}">${sign}${delta.toFixed(1)}</span>
        </div>
      `;
    }
    html += '</div>';

    // Best pitchers for this park
    html += '<div class="park-section-header" style="margin-top: 1rem;">Best Pitchers for This Park</div>';
    const pitcherDeltas: { pitcher: ProjectedPlayer; delta: number; destWar: number }[] = [];

    for (const p of this.allPitcherProjections) {
      if (p.projectedStats.ip < 40) continue;
      const originTeamId = p.parentTeamId || p.teamId;
      if (originTeamId === this.selectedTeamId) continue;
      const originPark = this.parkFactorsMap.get(originTeamId);
      if (!originPark) continue;

      const originHr = computePitcherParkHrFactor(originPark);
      const destHr = computePitcherParkHrFactor(pf);

      // For pitchers, lower HR factor is better. WAR increases when moving to lower HR park.
      const hrDelta = originHr - destHr; // positive means destination is more pitcher-friendly
      const delta = p.projectedStats.war * hrDelta * 0.8;
      const destWar = p.projectedStats.war + delta;
      pitcherDeltas.push({ pitcher: p, delta, destWar });
    }

    pitcherDeltas.sort((a, b) => b.delta - a.delta);
    const topPitchers = pitcherDeltas.slice(0, 10);

    html += '<div class="park-fit-list">';
    for (const { pitcher, delta, destWar } of topPitchers) {
      const sign = delta >= 0 ? '+' : '';
      const cls = delta >= 0 ? 'positive' : 'negative';
      html += `
        <div class="park-fit-card" data-player-id="${pitcher.playerId}" data-type="pitcher">
          <span class="player-name">${pitcher.name} <span style="color: var(--color-text-muted); font-size: 0.7rem;">(${pitcher.teamName})</span></span>
          <span style="font-size: 0.7rem; color: var(--color-text-muted);">${pitcher.projectedStats.war.toFixed(1)} &rarr; ${destWar.toFixed(1)}</span>
          <span class="fit-delta ${cls}">${sign}${delta.toFixed(1)}</span>
        </div>
      `;
    }
    html += '</div>';

    return html;
  }

  private bindPlayerClicks(): void {
    this.container.querySelectorAll('[data-player-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = parseInt((el as HTMLElement).dataset.playerId!, 10);
        const type = (el as HTMLElement).dataset.type;
        if (type === 'pitcher') {
          const p = this.allPitcherProjections.find(x => x.playerId === id);
          pitcherProfileModal.show({
            playerId: id,
            playerName: p?.name ?? '',
            team: p?.teamName,
            age: p?.age,
            trueRating: p?.currentTrueRating,
            estimatedStuff: p?.projectedRatings?.stuff,
            estimatedControl: p?.projectedRatings?.control,
            estimatedHra: p?.projectedRatings?.hra,
            projWar: p?.projectedStats?.war,
            projFip: p?.projectedStats?.fip,
            projK9: p?.projectedStats?.k9,
            projBb9: p?.projectedStats?.bb9,
            projHr9: p?.projectedStats?.hr9,
            projIp: p?.projectedStats?.ip,
          }, 0);
        } else {
          const b = this.allBatterProjections.find(x => x.playerId === id);
          batterProfileModal.show({
            playerId: id,
            playerName: b?.name ?? '',
            team: b?.teamName,
            age: b?.age,
            position: b?.position,
            positionLabel: b?.positionLabel,
            trueRating: b?.currentTrueRating,
            percentile: b?.percentile,
            estimatedPower: b?.estimatedRatings?.power,
            estimatedEye: b?.estimatedRatings?.eye,
            estimatedAvoidK: b?.estimatedRatings?.avoidK,
            estimatedContact: b?.estimatedRatings?.contact,
            projWar: b?.projectedStats?.war,
            projAvg: b?.projectedStats?.avg,
            projObp: b?.projectedStats?.obp,
            projSlg: b?.projectedStats?.slg,
            projPa: b?.projectedStats?.pa,
            projHr: b?.projectedStats?.hr,
            projWrcPlus: b?.projectedStats?.wrcPlus,
          }, 0);
        }
      });
    });
  }
}
