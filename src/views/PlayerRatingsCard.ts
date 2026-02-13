/**
 * Shared component for rendering player ratings card
 * Used by both PlayerProfileModal and StatsView for consistent display
 */

import { PlayerYearlyDetail } from '../services/TrueRatingsService';
import { RatingEstimatorService } from '../services/RatingEstimatorService';
import { MinorLeagueLevel, getLevelLabel } from '../models/Stats';

export interface SeasonStatsRow extends PlayerYearlyDetail {
  level?: MinorLeagueLevel | 'MLB';
}

export interface PlayerRatingsData {
  playerId: number;
  playerName: string;
  team?: string;
  parentTeam?: string;
  age?: number;
  position?: 'SP' | 'RP';
  positionLabel?: string;
  trueRating?: number;
  percentile?: number;
  fipLike?: number;
  estimatedStuff?: number;
  estimatedControl?: number;
  estimatedHra?: number;

  // My Scout data
  scoutStuff?: number;
  scoutControl?: number;
  scoutHra?: number;
  scoutStamina?: number;
  scoutInjuryProneness?: string;
  scoutOvr?: number;
  scoutPot?: number;

  // OSA data (parallel structure for toggle)
  osaStuff?: number;
  osaControl?: number;
  osaHra?: number;
  osaStamina?: number;
  osaInjuryProneness?: string;
  osaOvr?: number;
  osaPot?: number;

  // My Scout pitch data
  myPitches?: string[];
  myPitchRatings?: Record<string, number>;

  // OSA pitch data
  osaPitches?: string[];
  osaPitchRatings?: Record<string, number>;

  // Legacy single-source fields (deprecated, use my/osa variants)
  pitchCount?: number;
  pitches?: string[];  // List of pitch names
  pitchRatings?: Record<string, number>;  // Pitch name -> rating mapping
  isProspect?: boolean;
  trueFutureRating?: number;
  tfrPercentile?: number;
  year?: number;
  showYearLabel?: boolean; // Only show year in badge if this is true (for historical data)
  projectionYear?: number;
  projectionBaseYear?: number;
  forceProjection?: boolean;
  projectionOverride?: {
    projectedStats: {
      k9: number;
      bb9: number;
      hr9: number;
      fip: number;
      war: number;
      ip: number;
    };
    projectedRatings: {
      stuff: number;
      control: number;
      hra: number;
    };
  };

  // Projected stats (passed through to modal so it doesn't recalculate)
  projIp?: number;
  projWar?: number;
  projK9?: number;
  projBb9?: number;
  projHr9?: number;
  projFip?: number;

  // TFR ceiling data (for ceiling bars when both TR and TFR exist)
  hasTfrUpside?: boolean;
  tfrStuff?: number;
  tfrControl?: number;
  tfrHra?: number;

  // TFR by scout source (for toggle in modal)
  tfrBySource?: { my?: any; osa?: any };

  // Toggle state
  activeScoutSource?: 'my' | 'osa';  // Which source is currently displayed
  hasMyScout?: boolean;               // Does 'my' data exist for this player?
  hasOsaScout?: boolean;              // Does 'osa' data exist for this player?
}

export class PlayerRatingsCard {
  static getRatingBadgeInfo(data: PlayerRatingsData): {
    badgeClass: string;
    badgeHtml: string;
    badgeTitle: string;
    percentileText: string;
    hasScout: boolean;
    isProspect: boolean;
    ratingValue: number;
  } | null {
    // Unified TFR/TR display logic:
    // - Has TR → show TR as primary badge
    // - No TR but has TFR → show TFR as primary badge (pure prospect)
    const hasTfr = typeof data.trueFutureRating === 'number';
    const hasTr = typeof data.trueRating === 'number';

    const useTfr = !hasTr && hasTfr;
    const ratingValue = useTfr ? data.trueFutureRating : data.trueRating;
    const percentileValue = useTfr ? data.tfrPercentile : data.percentile;

    if (typeof ratingValue !== 'number' || isNaN(ratingValue)) return null;

    const hasScout = this.hasScoutingData(data);
    const badgeClass = this.getTrueRatingClass(ratingValue);
    const percentileText = typeof percentileValue === 'number' && !isNaN(percentileValue)
      ? `${this.formatPercentile(percentileValue)} percentile`
      : '';

    let indicator = '';
    let badgeTitle = '';

    if (useTfr) {
      indicator = '<span class="badge-indicator-tfr" title="True Future Rating (Projected)">F</span>';
      badgeTitle = 'True Future Rating (Projected)\nDerived from a secret blend of scouting potential, minor league performance, and the ashes of Hank Aaron\'s bat.';
    } else {
      indicator = hasScout ? '' : '<span class="badge-indicator" title="Stats only - no scouting data">#</span>';
      badgeTitle = hasScout
        ? 'True Rating (with scouting)\nDerived from a proprietary blend of scouting reports, advanced metrics, and the tears of Nolan Ryan\'s victims.'
        : 'True Rating (stats only)\nBased purely on performance metrics (and a pinch of wizardry).';
    }

    const badgeHtml = `${ratingValue.toFixed(1)}${indicator}`;

    return {
      badgeClass,
      badgeHtml,
      badgeTitle,
      percentileText,
      hasScout,
      isProspect: useTfr, // Return useTfr to indicate we're showing TFR (not just isProspect flag)
      ratingValue,
    };
  }

  /**
   * Render the complete ratings card (header + bars)
   * Used inline on search results page
   */
  static renderInline(data: PlayerRatingsData, options: { includeHeader?: boolean } = {}): string {
    const hasScout = this.hasScoutingData(data);
    const includeHeader = options.includeHeader !== false;

    return `
      <div class="ratings-card">
        ${includeHeader ? this.renderHeader(data) : ''}
        ${this.renderRatingsComparison(data, hasScout)}
      </div>
    `;
  }

  /**
   * Render just the header with badge and percentile
   */
  static renderHeader(data: PlayerRatingsData): string {
    const badgeInfo = this.getRatingBadgeInfo(data);
    const teamInfo = this.formatTeamInfo(data.team, data.parentTeam);
    
    if (!badgeInfo) {
      // If no badge info (e.g. not enough IP), still show team info if available
      if (teamInfo) {
         return `
          <div class="ratings-card-header">
            <div class="ratings-card-meta">
               <div class="player-team-info">${teamInfo}</div>
            </div>
          </div>
        `;
      }
      return '';
    }

    return `
      <div class="ratings-card-header">
        <div class="ratings-card-meta">
          <span class="percentile-label">${badgeInfo.percentileText}</span>
          ${teamInfo ? `<div class="player-team-info">${teamInfo}</div>` : ''}
        </div>
        <span class="badge ${badgeInfo.badgeClass}" title="${badgeInfo.badgeTitle}">${badgeInfo.badgeHtml}</span>
      </div>
    `;
  }

  static renderRatingEmblem(data: PlayerRatingsData): string {
    const badgeInfo = this.getRatingBadgeInfo(data);
    if (!badgeInfo) return '';

    const ratingClass = badgeInfo.badgeClass;
    const ratingValue = badgeInfo.ratingValue.toFixed(1);
    const percentileText = badgeInfo.percentileText || '';
    const barWidth = Math.max(10, Math.min(100, (badgeInfo.ratingValue / 5) * 100));

    // Label and class differ for prospects (TFR) vs MLB (TR)
    const baseLabel = badgeInfo.isProspect ? 'True Future Rating' : 'True Rating';
    const shouldShowYear = data.showYearLabel && data.year;
    const yearText = shouldShowYear ? ` (${data.year})` : '';
    const label = shouldShowYear
      ? `${baseLabel} <span class="rating-year">(${data.year})</span>`
      : baseLabel;
    const ariaLabel = `${baseLabel}${yearText}`;
    const emblemClass = badgeInfo.isProspect ? 'rating-emblem tfr-emblem' : 'rating-emblem';

    // Check for "Upside" display (MLB player with higher TFR)
    // Show "Peak" indicator when player has TFR upside (TFR > TR by ≥ 0.25 stars)
    let upsideHtml = '';
    if (data.hasTfrUpside && data.trueRating && data.trueFutureRating && (data.trueFutureRating - data.trueRating >= 0.25)) {
        upsideHtml = `<div class="rating-emblem-upside" title="True Future Rating: ${data.trueFutureRating.toFixed(1)}">
            <span class="upside-label">↗ Peak</span>
            <span class="upside-value">${data.trueFutureRating.toFixed(1)}</span>
        </div>`;
    }

    return `
      <div class="${emblemClass} ${ratingClass}" title="${badgeInfo.badgeTitle}" aria-label="${ariaLabel} ${ratingValue}">
        <div class="rating-emblem-header">
          <span class="rating-emblem-label">${label}</span>
        </div>
        <div class="rating-emblem-body">
          <div class="rating-emblem-bar">
            <div class="rating-emblem-bar-fill" style="width: ${barWidth}%"></div>
          </div>
          <div class="rating-emblem-score">${ratingValue}</div>
        </div>
        ${percentileText ? `<div class="rating-emblem-meta">${percentileText}</div>` : ''}
        ${upsideHtml}
      </div>
    `;
  }

  static renderSeasonStatsTable(
    stats: SeasonStatsRow[],
    options: { selectable?: boolean; hasScouting?: boolean; showLevel?: boolean } = {}
  ): string {
    if (stats.length === 0) {
      const message = options.hasScouting
        ? 'No pitching stats found for this player.'
        : 'No stats or scouting data found for this player.';

      const uploadLink = options.hasScouting
        ? ''
        : `
          <p class="scout-upload-notice">
            <a href="#" class="scout-upload-link" data-tab-target="tab-data-management">Upload scouting data</a>
          </p>
        `;

      return `
        <div class="stats-history">
          <h4 class="section-label">Season Stats</h4>
          <p class="no-stats">${message}</p>
          ${uploadLink}
        </div>
      `;
    }

    const showLevel = options.showLevel ?? stats.some(s => s.level && s.level !== 'MLB');
    const rowClass = options.selectable ? 'pitching-row stats-row-selectable' : '';

    const rows = stats.map((s, index) => {
      const stuff = RatingEstimatorService.estimateStuff(s.k9, s.ip).rating;
      const control = RatingEstimatorService.estimateControl(s.bb9, s.ip).rating;
      const hra = RatingEstimatorService.estimateHRA(s.hr9, s.ip).rating;
      const levelLabel = s.level ? (s.level === 'MLB' ? 'MLB' : getLevelLabel(s.level)) : 'MLB';
      const levelCell = showLevel ? `<td><span class="level-badge level-${s.level?.toLowerCase() || 'mlb'}">${levelLabel}</span></td>` : '';
      const isMinorLeague = s.level && s.level !== 'MLB';
      const warCell = isMinorLeague ? '<td class="stat-na">—</td>' : `<td>${s.war.toFixed(1)}</td>`;

      return `
      <tr class="${rowClass}${isMinorLeague ? ' minor-league-row' : ''}" data-index="${index}">
        <td>${s.year}</td>
        ${levelCell}
        <td>${s.ip.toFixed(1)}</td>
        <td>${s.fip.toFixed(2)}</td>
        <td>${this.renderFlipCell(s.k9.toFixed(2), stuff.toString(), 'Estimated Stuff Rating*')}</td>
        <td>${this.renderFlipCell(s.bb9.toFixed(2), control.toString(), 'Estimated Control Rating*')}</td>
        <td>${this.renderFlipCell(s.hr9.toFixed(2), hra.toString(), 'Estimated HRA Rating*')}</td>
        ${warCell}
      </tr>
    `;
    }).join('');

    const levelHeader = showLevel ? '<th>Level</th>' : '';

    return `
      <div class="stats-history">
        <h4 class="section-label">Season Stats</h4>
        <div class="table-wrapper">
          <table class="stats-table">
            <thead>
              <tr>
                <th>Year</th>
                ${levelHeader}
                <th>IP</th>
                <th>FIP</th>
                <th>K/9</th>
                <th>BB/9</th>
                <th>HR/9</th>
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

  /**
   * Render header metadata (injury bar, stamina bar, stars) - stacked vertically
   */
  static renderHeaderMetadata(data: PlayerRatingsData): string {
    // Determine which scout source to use based on active source
    const activeSource = data.activeScoutSource ?? 'my';
    const stamina = activeSource === 'my' ? data.scoutStamina : data.osaStamina;
    const injury = activeSource === 'my' ? data.scoutInjuryProneness : data.osaInjuryProneness;
    const ovr = activeSource === 'my' ? data.scoutOvr : data.osaOvr;
    const pot = activeSource === 'my' ? data.scoutPot : data.osaPot;

    const hasAnyMetadata = stamina !== undefined ||
                           ovr !== undefined || pot !== undefined ||
                           injury;

    if (!hasAnyMetadata) return '';

    const items: string[] = [];

    // Injury bar
    if (injury) {
      const injuryMap: Record<string, number> = {
        'wrecked': 0,
        'fragile': 25,
        'normal': 50,
        'durable': 75,
        'iron man': 100
      };
      const injuryValue = injuryMap[injury.toLowerCase()] ?? 50;
      const injuryClass = injuryValue <= 25 ? 'rating-poor' : injuryValue >= 75 ? 'rating-plus' : 'rating-avg';
      const injuryLabel = injury;

      items.push(`
        <div class="header-metadata-item" title="${injuryLabel}">
          <span class="header-metadata-label">Injury</span>
          <div class="header-metadata-bar ${injuryClass}">
            <div class="header-metadata-bar-fill" style="width: ${injuryValue}%"></div>
          </div>
        </div>
      `);
    }

    // Stamina bar
    if (stamina !== undefined) {
      const staminaPercent = Math.max(0, Math.min(100, (stamina / 80) * 100));
      const staminaClass = stamina >= 60 ? 'rating-plus' : stamina >= 40 ? 'rating-avg' : 'rating-poor';

      items.push(`
        <div class="header-metadata-item" title="${stamina}">
          <span class="header-metadata-label">Stamina</span>
          <div class="header-metadata-bar ${staminaClass}">
            <div class="header-metadata-bar-fill" style="width: ${staminaPercent}%"></div>
          </div>
        </div>
      `);
    }

    // Stars (no label)
    if (ovr !== undefined && pot !== undefined) {
      items.push(`
        <div class="header-metadata-item">
          <div class="header-metadata-text">${ovr.toFixed(1)}★ / ${pot.toFixed(1)}★</div>
        </div>
      `);
    }

    if (items.length === 0) return '';

    return `<div class="header-metadata-stack">${items.join('')}</div>`;
  }

  /**
   * Render header pitches list (pitch names with ratings)
   */
  static renderHeaderPitches(data: PlayerRatingsData): string {
    // Select pitches based on active scout source
    const activeSource = data.activeScoutSource ?? 'my';

    // Use source-specific pitch data, falling back to legacy fields
    let pitches: string[];
    let pitchRatings: Record<string, number>;

    if (activeSource === 'my' && data.myPitches) {
      pitches = data.myPitches;
      pitchRatings = data.myPitchRatings ?? {};
    } else if (activeSource === 'osa' && data.osaPitches) {
      pitches = data.osaPitches;
      pitchRatings = data.osaPitchRatings ?? {};
    } else {
      // Fallback to legacy single-source fields
      pitches = data.pitches ?? [];
      pitchRatings = data.pitchRatings ?? {};
    }

    if (pitches.length === 0) return '';

    const pitchNameMap: Record<string, string> = {
      fbp: 'Fastball',
      chp: 'Changeup',
      spp: 'Splitter',
      cbp: 'Curveball',
      slp: 'Slider',
      ctp: 'Cutter',
      fop: 'Forkball',
      ccp: 'CircleChange',
      scp: 'Screwball',
      kcp: 'Knucklecurve',
      knp: 'Knuckle'
    };

    const normalizePitchName = (pitchName: string): string => {
      const normalized = pitchName.trim().toLowerCase();
      return pitchNameMap[normalized]
        ?? pitchNameMap[normalized.replace(/[^a-z]/g, '')]
        ?? (pitchName.endsWith('p') ? pitchName.slice(0, -1) : pitchName);
    };

    const pitchList = pitches.map(pitchName => ({
      raw: pitchName,
      rating: pitchRatings[pitchName] ?? 0,
      display: normalizePitchName(pitchName)
    }));

    pitchList.sort((a, b) => b.rating - a.rating);
    const topPitches = pitchList.slice(0, 3);
    const extraPitches = pitchList.slice(3);

    const renderPitchItem = (pitch: { raw: string; rating: number; display: string }, showName = true): string => {
      const rating = pitch.rating;
      const ratingClass = rating >= 70 ? 'rating-elite' : rating >= 60 ? 'rating-plus' : rating >= 45 ? 'rating-avg' : 'rating-poor';

      // Calculate percentage (20-80 scale, where 20 = 0% and 80 = 100%)
      const percentage = Math.max(0, Math.min(100, ((rating - 20) / 60) * 100));

      // SVG circle parameters
      const radius = 7;
      const circumference = 2 * Math.PI * radius;
      const strokeDashoffset = circumference - (percentage / 100) * circumference;

      const cleanPitchName = pitch.display;

      return `
        <div class="pitch-item" title="${cleanPitchName}: ${rating}">
          <svg class="pitch-donut" viewBox="0 0 18 18" width="18" height="18">
            <circle class="pitch-donut-bg" cx="9" cy="9" r="${radius}" />
            <circle
              class="pitch-donut-fill ${ratingClass}"
              cx="9"
              cy="9"
              r="${radius}"
              stroke-dasharray="${circumference}"
              style="--donut-offset: ${strokeDashoffset}; --donut-circumference: ${circumference};"
            />
          </svg>
          ${showName ? `<span class="pitch-name">${cleanPitchName}</span>` : ''}
        </div>
      `;
    };

    const pitchItems = topPitches.map(pitch => renderPitchItem(pitch, true)).join('');

    const overflow = extraPitches.length > 0
      ? `
        <div class="pitch-overflow">
          <span class="pitch-overflow-indicator" aria-label="More pitches">▲</span>
          <div class="pitch-overflow-tooltip">
            ${pitchList.map(pitch => renderPitchItem(pitch, true)).join('')}
          </div>
        </div>
      `
      : '';

    return `
      <div class="header-pitches">
        <div class="header-pitches-label">Pitches</div>
        <div class="header-pitches-list">
          ${pitchItems}
          ${overflow}
        </div>
      </div>
    `;
  }

  /**
   * Render the ratings comparison section (bars)
   */
  static renderRatingsComparison(data: PlayerRatingsData, hasScout: boolean): string {
    if (hasScout) {
      // Determine which scout data to display
      const activeSource = data.activeScoutSource ?? 'my'; // Default to 'my'
      const hasMyScout = data.hasMyScout ?? (data.scoutStuff !== undefined);
      const hasOsaScout = data.hasOsaScout ?? (data.osaStuff !== undefined);
      const hasAlternative = hasMyScout && hasOsaScout;

      // Get active scout values based on toggle state
      const scoutStuff = activeSource === 'my' ? data.scoutStuff : data.osaStuff;
      const scoutControl = activeSource === 'my' ? data.scoutControl : data.osaControl;
      const scoutHra = activeSource === 'my' ? data.scoutHra : data.osaHra;

      // Build header with toggle (if both sources exist) or badge (if only one)
      let headerLabel = '';
      if (hasAlternative) {
        headerLabel = `
          <div class="scout-header-toggle custom-dropdown">
            <span class="dropdown-trigger" data-player-id="${data.playerId}">${activeSource === 'my' ? 'My' : 'OSA'}</span>
            <div class="dropdown-menu">
              <div class="dropdown-item ${activeSource === 'my' ? 'active' : ''}" data-value="my">My</div>
              <div class="dropdown-item ${activeSource === 'osa' ? 'active' : ''}" data-value="osa">OSA</div>
            </div>
          </div>
          Scout Opinions`;
      } else {
        const sourceLabel = activeSource === 'my' ? 'My Scout' : 'OSA';
        const sourceClass = activeSource === 'my' ? 'my' : 'osa';
        headerLabel = `<span class="source-badge ${sourceClass}">${sourceLabel}</span> Scout Opinions`;
      }

      return `
        <div class="ratings-comparison">
          <div class="rating-row rating-row-header">
            <span class="rating-label"></span>
            <div class="rating-bars">
              <span class="bar-header" title="Derived from a proprietary blend of scouting reports, advanced metrics, and the tears of Nolan Ryan's victims." style="cursor: help;">True Ratings</span>
              <span class="bar-vs"></span>
              <span class="bar-header">${headerLabel}</span>
              <span class="rating-diff"></span>
            </div>
          </div>
          ${this.renderRatingBar('Stuff', data.estimatedStuff, scoutStuff, data.tfrStuff)}
          ${this.renderRatingBar('Control', data.estimatedControl, scoutControl, data.tfrControl)}
          ${this.renderRatingBar('HRA', data.estimatedHra, scoutHra, data.tfrHra)}
        </div>
      `;
    }

    return `
      <div class="ratings-comparison has-scout-placeholder">
        <div class="rating-row rating-row-header">
          <span class="rating-label"></span>
          <div class="rating-bars">
            <span class="bar-header" title="Derived from a proprietary blend of scouting reports, advanced metrics, and the tears of Nolan Ryan's victims." style="cursor: help;">True Ratings</span>
            <span class="bar-vs"></span>
            <span class="bar-header bar-header-missing">Scout Opinions</span>
            <span class="rating-diff"></span>
          </div>
        </div>
        ${this.renderPlaceholderBar('Stuff', data.estimatedStuff)}
        ${this.renderPlaceholderBar('Control', data.estimatedControl)}
        ${this.renderPlaceholderBar('HRA', data.estimatedHra)}
        <p class="scout-upload-notice">
          No scouting data available.
          <a href="#" class="scout-upload-link" data-tab-target="tab-data-management">Manage Data</a>
        </p>
      </div>
    `;
  }

  /**
   * Clamp True Ratings for display purposes (20-80 scale)
   * Backend calculations use actual values, but UI shows clamped values
   * This matches OOTP's approach of hiding extreme overages
   */
  private static clampRatingForDisplay(rating: number): number {
    return Math.max(20, Math.min(80, Math.round(rating)));
  }

  /**
   * Render a comparison bar (estimated vs scout)
   */
  static renderRatingBar(label: string, estimated?: number, scout?: number, ceiling?: number): string {
    const scoutValue = scout ?? 0;
    const scoutWidth = Math.max(20, Math.min(80, scoutValue));
    const scoutClass = this.getRatingClassForValue(scoutValue);

    // If we have no estimated rating (missing stats or NaN), show placeholder on left
    if (estimated === undefined || isNaN(estimated)) {
      return `
        <div class="rating-row">
          <span class="rating-label">${label}</span>
          <div class="rating-bars">
            <div class="bar-container bar-container-placeholder">
              <span class="bar-placeholder-text">?</span>
            </div>
            <span class="bar-vs">vs</span>
            <div class="bar-container">
              <div class="bar bar-scout ${scoutClass}" style="width: ${scoutWidth}%"></div>
              <span class="bar-value">${scoutValue}</span>
            </div>
            <span class="rating-diff">—</span>
          </div>
        </div>
      `;
    }

    // Clamp estimated rating for display (backend may have values >80 for elite prospects)
    const estValue = this.clampRatingForDisplay(estimated);
    const estWidth = Math.max(20, Math.min(80, estValue));
    const estClass = this.getRatingClassForValue(estValue);

    // Ceiling bar (TFR component extension) — only show when ceiling > true value
    // Diff uses TFR (peak) vs scout (also peak) when ceiling available, otherwise TR vs scout
    let ceilingHtml = '';
    let barInnerHtml = '';
    let barValueHtml = `<span class="bar-value">${estValue}</span>`;
    let diffValue = estValue;
    if (ceiling !== undefined && !isNaN(ceiling)) {
      const ceilingClamped = this.clampRatingForDisplay(ceiling);
      if (ceilingClamped > estValue) {
        diffValue = ceilingClamped;
        const ceilingClass = this.getRatingClassForValue(ceilingClamped);
        const truePercent = estWidth;
        const ceilingWidth = Math.max(20, Math.min(80, ceilingClamped));
        const extensionPercent = ceilingWidth - truePercent;
        ceilingHtml = `<div class="bar bar-ceiling ${ceilingClass}" style="left: ${truePercent}%; width: ${extensionPercent}%" title="TFR Ceiling: ${ceilingClamped}"></div>`;
        barInnerHtml = `<span class="bar-value-inner">${estValue}</span>`;
        barValueHtml = `<span class="bar-value">${ceilingClamped}</span>`;
      }
    }

    const diff = diffValue - scoutValue;
    const diffText = diff > 0 ? `+${diff}` : `${diff}`;
    const diffClass = diff > 0 ? 'diff-positive' : diff < 0 ? 'diff-negative' : 'diff-neutral';

    return `
      <div class="rating-row">
        <span class="rating-label">${label}</span>
          <div class="rating-bars">
            <div class="bar-container">
              <div class="bar bar-estimated ${estClass}" style="width: ${estWidth}%">${barInnerHtml}</div>
              ${ceilingHtml}
              ${barValueHtml}
            </div>
            <span class="rating-diff ${diffClass}">${diffText}</span>
            <span class="bar-vs">vs</span>
            <div class="bar-container">
              <div class="bar bar-scout ${scoutClass}" style="width: ${scoutWidth}%"></div>
              <span class="bar-value">${scoutValue}</span>
            </div>
          </div>
        </div>
      `;
  }

  static formatTeamInfo(team?: string, parentTeam?: string): string {
    if (!team) return '';
    return `<span class="team-main">${team}</span>${parentTeam ? `<span class="parent-org">(${parentTeam})</span>` : ''}`;
  }

  static formatPositionAge(position?: 'SP' | 'RP', age?: number): string {
    const parts: string[] = [];
    if (position) parts.push(position);
    if (age !== undefined) parts.push(`Age: ${age}`);
    return parts.join(', ');
  }

  private static renderFlipCell(front: string, back: string, title: string): string {
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

  /**
   * Render a placeholder bar (no scout data)
   */
  static renderPlaceholderBar(label: string, estimated?: number): string {
    // If no estimated rating (no MLB stats or NaN), show placeholder on left too
    if (estimated === undefined || isNaN(estimated)) {
      return `
        <div class="rating-row">
          <span class="rating-label">${label}</span>
          <div class="rating-bars">
            <div class="bar-container bar-container-placeholder">
              <span class="bar-placeholder-text">?</span>
            </div>
            <span class="bar-vs">vs</span>
            <div class="bar-container bar-container-placeholder">
              <span class="bar-placeholder-text">?</span>
            </div>
            <span class="rating-diff">—</span>
          </div>
        </div>
      `;
    }

    // Clamp estimated rating for display (backend may have values >80 for elite prospects)
    const estValue = this.clampRatingForDisplay(estimated);
    const estWidth = Math.max(20, Math.min(80, estValue));
    const estClass = this.getRatingClassForValue(estValue);

    return `
      <div class="rating-row">
        <span class="rating-label">${label}</span>
        <div class="rating-bars">
          <div class="bar-container">
            <div class="bar bar-estimated ${estClass}" style="width: ${estWidth}%"></div>
            <span class="bar-value">${estValue}</span>
          </div>
          <span class="bar-vs">vs</span>
          <div class="bar-container bar-container-placeholder">
            <span class="bar-placeholder-text">?</span>
          </div>
          <span class="rating-diff">—</span>
        </div>
      </div>
    `;
  }

  /**
   * Render estimated-only bar (for modal when no scout data)
   */
  static renderEstimatedOnlyBar(label: string, estimated?: number): string {
    // If no estimated rating or NaN, show placeholder
    if (estimated === undefined || isNaN(estimated)) {
      return `
        <div class="rating-row">
          <span class="rating-label">${label}</span>
          <div class="rating-bars single">
            <div class="bar-container bar-container-placeholder">
              <span class="bar-placeholder-text">?</span>
            </div>
          </div>
        </div>
      `;
    }

    const estValue = estimated;
    const estWidth = Math.max(20, Math.min(80, estValue));
    const estClass = this.getRatingClassForValue(estValue);

    return `
      <div class="rating-row">
        <span class="rating-label">${label}</span>
        <div class="rating-bars single">
          <div class="bar-container">
            <div class="bar bar-estimated ${estClass}" style="width: ${estWidth}%"></div>
            <span class="bar-value">${estValue}</span>
          </div>
        </div>
      </div>
    `;
  }

  private static getRatingClassForValue(value: number): string {
    if (value >= 70) return 'rating-elite';
    if (value >= 60) return 'rating-plus';
    if (value >= 50) return 'rating-avg';
    if (value >= 40) return 'rating-fringe';
    return 'rating-poor';
  }

  static hasScoutingData(data: PlayerRatingsData): boolean {
    // Has scouting data if either 'my' or 'osa' source has complete data
    const hasMy = data.scoutStuff !== undefined
      && data.scoutControl !== undefined
      && data.scoutHra !== undefined;
    const hasOsa = data.osaStuff !== undefined
      && data.osaControl !== undefined
      && data.osaHra !== undefined;
    return hasMy || hasOsa;
  }

  static getTrueRatingClass(value: number): string {
    if (value >= 4.5) return 'rating-elite';
    if (value >= 4.0) return 'rating-plus';
    if (value >= 3.0) return 'rating-avg';
    if (value >= 2.0) return 'rating-fringe';
    return 'rating-poor';
  }

  static formatPercentile(value: number): string {
    const rounded = Math.round(value);
    const suffix = this.getOrdinalSuffix(rounded);
    return `${rounded}${suffix}`;
  }

  private static getOrdinalSuffix(n: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  }
}
