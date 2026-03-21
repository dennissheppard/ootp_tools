export type SeasonDataMode = 'current-ytd' | 'preseason-model';
export type ScoutingDataMode = 'my' | 'osa' | 'mixed' | 'none';

function seasonLabel(mode: SeasonDataMode): string {
  return mode === 'current-ytd' ? 'Current YTD' : 'Pre-season Model';
}

export function emitDataSourceBadges(seasonMode: SeasonDataMode, scoutingMode: ScoutingDataMode): void {
  window.dispatchEvent(new CustomEvent('wbl:data-source-badges-changed', {
    detail: { seasonMode, scoutingMode }
  }));
}

export function renderDataSourceBadges(
  seasonMode: SeasonDataMode,
  _scoutingMode: ScoutingDataMode
): string {
  const seasonClass = seasonMode === 'current-ytd' ? 'data-chip-current' : 'data-chip-preseason';
  // Scouting chip removed from header — login badge in upper-right handles this now.
  return `
    <div class="data-source-badges">
      <span class="data-source-chip ${seasonClass}">Season Data: ${seasonLabel(seasonMode)}</span>
    </div>
  `;
}
