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
  trueRating?: number;
  percentile?: number;
  estimatedStuff?: number;
  estimatedControl?: number;
  estimatedHra?: number;
  scoutStuff?: number;
  scoutControl?: number;
  scoutHra?: number;
  scoutStamina?: number;
  scoutInjuryProneness?: string;
  scoutOvr?: number;
  scoutPot?: number;
  pitchCount?: number;
  pitches?: string[];  // List of pitch names
  pitchRatings?: Record<string, number>;  // Pitch name -> rating mapping
  isProspect?: boolean;
  trueFutureRating?: number;
  tfrPercentile?: number;
  starGap?: number;
  year?: number;
  showYearLabel?: boolean; // Only show year in badge if this is true (for historical data)
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
    // For prospects, use TFR; for MLB players, use TR
    const isProspect = data.isProspect === true;
    const ratingValue = isProspect ? data.trueFutureRating : data.trueRating;
    const percentileValue = isProspect ? data.tfrPercentile : data.percentile;

    if (typeof ratingValue !== 'number') return null;

    const hasScout = this.hasScoutingData(data);
    const badgeClass = this.getTrueRatingClass(ratingValue);
    const percentileText = typeof percentileValue === 'number'
      ? `${this.formatPercentile(percentileValue)} percentile`
      : '';

    let indicator = '';
    let badgeTitle = '';

    if (isProspect) {
      indicator = '<span class="badge-indicator-tfr" title="True Future Rating (Projected)">F</span>';
      badgeTitle = 'True Future Rating (Projected)';
    } else {
      indicator = hasScout ? '' : '<span class="badge-indicator" title="Stats only - no scouting data">#</span>';
      badgeTitle = hasScout ? 'True Rating (with scouting)' : 'True Rating (stats only)';
    }

    const badgeHtml = `${ratingValue.toFixed(1)}${indicator}`;

    return {
      badgeClass,
      badgeHtml,
      badgeTitle,
      percentileText,
      hasScout,
      isProspect,
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
      const eraCell = isMinorLeague ? '<td class="stat-na">—</td>' : `<td>${s.era.toFixed(2)}</td>`;
      const warCell = isMinorLeague ? '<td class="stat-na">—</td>' : `<td>${s.war.toFixed(1)}</td>`;

      return `
      <tr class="${rowClass}${isMinorLeague ? ' minor-league-row' : ''}" data-index="${index}">
        <td>${s.year}</td>
        ${levelCell}
        <td>${s.ip.toFixed(1)}</td>
        ${eraCell}
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
                <th>ERA</th>
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
    const hasAnyMetadata = data.scoutStamina !== undefined ||
                           data.scoutOvr !== undefined || data.scoutPot !== undefined ||
                           data.scoutInjuryProneness;

    if (!hasAnyMetadata) return '';

    const items: string[] = [];

    // Injury bar
    if (data.scoutInjuryProneness) {
      const injuryMap: Record<string, number> = {
        'wrecked': 0,
        'fragile': 25,
        'normal': 50,
        'durable': 75,
        'iron man': 100
      };
      const injuryValue = injuryMap[data.scoutInjuryProneness.toLowerCase()] ?? 50;
      const injuryClass = injuryValue <= 25 ? 'rating-poor' : injuryValue >= 75 ? 'rating-plus' : 'rating-avg';

      items.push(`
        <div class="header-metadata-item">
          <span class="header-metadata-label">Injury</span>
          <div class="header-metadata-bar ${injuryClass}">
            <div class="header-metadata-bar-fill" style="width: ${injuryValue}%"></div>
          </div>
        </div>
      `);
    }

    // Stamina bar
    if (data.scoutStamina !== undefined) {
      const staminaPercent = Math.max(0, Math.min(100, (data.scoutStamina / 80) * 100));
      const staminaClass = data.scoutStamina >= 60 ? 'rating-plus' : data.scoutStamina >= 40 ? 'rating-avg' : 'rating-poor';

      items.push(`
        <div class="header-metadata-item">
          <span class="header-metadata-label">Stamina</span>
          <div class="header-metadata-bar ${staminaClass}">
            <div class="header-metadata-bar-fill" style="width: ${staminaPercent}%"></div>
          </div>
        </div>
      `);
    }

    // Stars (no label)
    if (data.scoutOvr !== undefined && data.scoutPot !== undefined) {
      items.push(`
        <div class="header-metadata-item">
          <div class="header-metadata-text">${data.scoutOvr.toFixed(1)}★ / ${data.scoutPot.toFixed(1)}★</div>
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
    if (!data.pitches || data.pitches.length === 0) return '';

    const pitchItems = data.pitches.map(pitchName => {
      const rating = data.pitchRatings?.[pitchName] ?? 0;
      const ratingClass = rating >= 60 ? 'rating-plus' : rating >= 45 ? 'rating-avg' : 'rating-poor';
      return `<div class="pitch-item ${ratingClass}">${pitchName} <span class="pitch-rating">(${rating})</span></div>`;
    }).join('');

    return `
      <div class="header-pitches">
        <div class="header-pitches-label">Pitches</div>
        <div class="header-pitches-list">
          ${pitchItems}
        </div>
      </div>
    `;
  }

  /**
   * Render the ratings comparison section (bars)
   */
  static renderRatingsComparison(data: PlayerRatingsData, hasScout: boolean): string {
    if (hasScout) {
      return `
        <div class="ratings-comparison">          
          <div class="rating-row rating-row-header">
            <span class="rating-label"></span>
            <div class="rating-bars">
              <span class="bar-header">True Ratings</span>
              <span class="bar-vs"></span>
              <span class="bar-header">Scout Opinions</span>
              <span class="rating-diff"></span>
            </div>
          </div>
          ${this.renderRatingBar('Stuff', data.estimatedStuff, data.scoutStuff)}
          ${this.renderRatingBar('Control', data.estimatedControl, data.scoutControl)}
          ${this.renderRatingBar('HRA', data.estimatedHra, data.scoutHra)}
        </div>
      `;
    }

    return `
      <div class="ratings-comparison has-scout-placeholder">
        <div class="rating-row rating-row-header">
          <span class="rating-label"></span>
          <div class="rating-bars">
            <span class="bar-header">True Ratings</span>
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
   * Render a comparison bar (estimated vs scout)
   */
  static renderRatingBar(label: string, estimated?: number, scout?: number): string {
    const scoutValue = scout ?? 0;
    const scoutWidth = Math.max(20, Math.min(80, scoutValue));
    const scoutClass = this.getRatingClassForValue(scoutValue);

    // If we have no estimated rating (missing stats), show placeholder on left
    if (estimated === undefined) {
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

    const estValue = estimated;
    const diff = estValue - scoutValue;
    const diffText = diff > 0 ? `+${diff}` : `${diff}`;
    const diffClass = diff > 0 ? 'diff-positive' : diff < 0 ? 'diff-negative' : 'diff-neutral';

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
    return `${team}${parentTeam ? ` <span class="parent-org">(${parentTeam})</span>` : ''}`;
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
    const estValue = estimated ?? 0;
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
    const estValue = estimated ?? 0;
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
    return data.scoutStuff !== undefined
      && data.scoutControl !== undefined
      && data.scoutHra !== undefined;
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
