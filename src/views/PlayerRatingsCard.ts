/**
 * Shared component for rendering player ratings card
 * Used by both PlayerProfileModal and StatsView for consistent display
 */

export interface PlayerRatingsData {
  playerId: number;
  playerName: string;
  trueRating?: number;
  percentile?: number;
  estimatedStuff?: number;
  estimatedControl?: number;
  estimatedHra?: number;
  scoutStuff?: number;
  scoutControl?: number;
  scoutHra?: number;
}

export class PlayerRatingsCard {
  /**
   * Render the complete ratings card (header + bars)
   * Used inline on search results page
   */
  static renderInline(data: PlayerRatingsData, year: number): string {
    const hasScout = this.hasScoutingData(data);

    return `
      <div class="ratings-card">
        ${this.renderHeader(data)}
        ${this.renderRatingsComparison(data, hasScout, year)}
      </div>
    `;
  }

  /**
   * Render just the header with badge and percentile
   */
  static renderHeader(data: PlayerRatingsData): string {
    const hasTrueRating = typeof data.trueRating === 'number';
    const hasScout = this.hasScoutingData(data);

    if (!hasTrueRating) return '';

    const badgeClass = this.getTrueRatingClass(data.trueRating!);
    const percentileText = typeof data.percentile === 'number'
      ? `${this.formatPercentile(data.percentile)} percentile`
      : '';

    // Indicator for data completeness
    const indicator = hasScout ? '' : '<span class="badge-indicator" title="Stats only - no scouting data">○</span>';

    return `
      <div class="ratings-card-header">
        <div class="ratings-card-meta">
          <span class="percentile-label">${percentileText}</span>
        </div>
        <span class="badge ${badgeClass}" title="${hasScout ? 'True Rating (with scouting)' : 'True Rating (stats only)'}">${data.trueRating!.toFixed(1)}${indicator}</span>
      </div>
    `;
  }

  /**
   * Render the ratings comparison section (bars)
   */
  static renderRatingsComparison(data: PlayerRatingsData, hasScout: boolean, year: number): string {
    if (hasScout) {
      return `
        <div class="ratings-comparison">
          <h4 class="section-label">True Ratings</h4>
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
        <h4 class="section-label">True Ratings</h4>
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
          No scouting data for ${year}.
          <a href="#" class="scout-upload-link" data-tab="true-ratings">Upload on True Ratings page</a>
        </p>
      </div>
    `;
  }

  /**
   * Render a comparison bar (estimated vs scout)
   */
  static renderRatingBar(label: string, estimated?: number, scout?: number): string {
    const estValue = estimated ?? 0;
    const scoutValue = scout ?? 0;
    const diff = scoutValue - estValue;
    const diffText = diff > 0 ? `+${diff}` : `${diff}`;
    const diffClass = diff > 0 ? 'diff-positive' : diff < 0 ? 'diff-negative' : 'diff-neutral';

    const estWidth = Math.max(20, Math.min(80, estValue));
    const scoutWidth = Math.max(20, Math.min(80, scoutValue));

    return `
      <div class="rating-row">
        <span class="rating-label">${label}</span>
        <div class="rating-bars">
          <div class="bar-container">
            <div class="bar bar-estimated" style="width: ${estWidth}%"></div>
            <span class="bar-value">${estValue}</span>
          </div>
          <span class="bar-vs">vs</span>
          <div class="bar-container">
            <div class="bar bar-scout" style="width: ${scoutWidth}%"></div>
            <span class="bar-value">${scoutValue}</span>
          </div>
          <span class="rating-diff ${diffClass}">${diffText}</span>
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

    return `
      <div class="rating-row">
        <span class="rating-label">${label}</span>
        <div class="rating-bars">
          <div class="bar-container">
            <div class="bar bar-estimated" style="width: ${estWidth}%"></div>
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

    return `
      <div class="rating-row">
        <span class="rating-label">${label}</span>
        <div class="rating-bars single">
          <div class="bar-container">
            <div class="bar bar-estimated" style="width: ${estWidth}%"></div>
            <span class="bar-value">${estValue}</span>
          </div>
        </div>
      </div>
    `;
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
