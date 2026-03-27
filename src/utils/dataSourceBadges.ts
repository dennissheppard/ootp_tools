export type SeasonDataMode = 'current-ytd' | 'preseason-model' | 'opening-day-snapshot';
export type ScoutingDataMode = 'my' | 'osa' | 'mixed' | 'none';

function seasonLabel(mode: SeasonDataMode): string {
  if (mode === 'current-ytd') return 'Updated';
  if (mode === 'opening-day-snapshot') return 'Opening Day';
  return 'Pre-season';
}

export function emitDataSourceBadges(seasonMode: SeasonDataMode, scoutingMode: ScoutingDataMode): void {
  window.dispatchEvent(new CustomEvent('wbl:data-source-badges-changed', {
    detail: { seasonMode, scoutingMode }
  }));
}

export function renderDataSourceBadges(
  seasonMode: SeasonDataMode,
  _scoutingMode: ScoutingDataMode,
  hasSnapshots: boolean = false,
): string {
  const seasonClass = seasonMode === 'opening-day-snapshot' ? 'data-chip-snapshot'
    : seasonMode === 'current-ytd' ? 'data-chip-current'
    : 'data-chip-preseason';
  const clickable = hasSnapshots && seasonMode !== 'preseason-model';
  const tooltip = seasonMode === 'opening-day-snapshot'
    ? 'Projections frozen from opening day. Click to switch to updated.'
    : seasonMode === 'current-ytd'
    ? 'Projections incorporate current season stats into True Ratings. Click to view opening day projections.'
    : 'Pre-season projections based on prior year True Ratings.';
  const clickAttr = clickable ? `data-action="toggle-snapshot" style="cursor: pointer;" title="${tooltip}"` : `title="${tooltip}"`;
  return `
    <div class="data-source-badges">
      <span class="data-source-chip ${seasonClass}" ${clickAttr}>Projections: ${seasonLabel(seasonMode)}</span>
    </div>
  `;
}
