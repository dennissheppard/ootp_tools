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
      <span class="data-source-chip ${scoutClass}">Scouting: ${scoutingLabel(scoutingMode)}</span>
    </div>
  `;
}
