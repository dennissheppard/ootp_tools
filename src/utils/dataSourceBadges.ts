export type SeasonDataMode = 'current-ytd' | 'preseason-model';
export type ScoutingDataMode = 'my' | 'osa' | 'mixed' | 'none';

function seasonLabel(mode: SeasonDataMode): string {
  return mode === 'current-ytd' ? 'Current YTD' : 'Pre-season Model';
}

function scoutingLabel(mode: ScoutingDataMode): string {
  if (mode === 'my') return 'My Scout';
  if (mode === 'osa') return 'OSA';
  if (mode === 'mixed') return 'My > OSA Fallback';
  return 'Unavailable';
}

function scoutingTooltip(mode: ScoutingDataMode): string {
  if (mode === 'osa') return 'Using OSA scouting data. Click to upload your scout reports for custom scouting.';
  if (mode === 'mixed') return 'Using your scout reports with OSA fallback for remaining players. Click to manage scouting data.';
  if (mode === 'none') return 'No scouting data found. Click to upload scouting reports.';
  return 'Using your uploaded scout reports. Click to manage scouting data.';
}

export function emitDataSourceBadges(seasonMode: SeasonDataMode, scoutingMode: ScoutingDataMode): void {
  window.dispatchEvent(new CustomEvent('wbl:data-source-badges-changed', {
    detail: { seasonMode, scoutingMode }
  }));
}

export function renderDataSourceBadges(
  seasonMode: SeasonDataMode,
  scoutingMode: ScoutingDataMode
): string {
  const seasonClass = seasonMode === 'current-ytd' ? 'data-chip-current' : 'data-chip-preseason';
  const scoutClass =
    scoutingMode === 'my'
      ? 'data-chip-scout-my'
      : scoutingMode === 'osa'
        ? 'data-chip-scout-osa'
        : scoutingMode === 'mixed'
          ? 'data-chip-scout-mixed'
          : 'data-chip-scout-none';

  return `
    <div class="data-source-badges">
      <span class="data-source-chip ${seasonClass}">Season Data: ${seasonLabel(seasonMode)}</span>
      <span class="data-source-chip ${scoutClass} scouting-chip-link" title="${scoutingTooltip(scoutingMode)}" data-tab-target="tab-data-management" role="button" tabindex="0">Scouting: ${scoutingLabel(scoutingMode)}</span>
    </div>
  `;
}
