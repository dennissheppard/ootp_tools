import { supabaseDataService } from '../services/SupabaseDataService';

const BANNER_ID = 'snapshot-mode-banner';

/**
 * Show or hide the global snapshot mode banner.
 * When snapshot mode is active, a fixed banner appears at the top of the page
 * so the user always knows they're viewing frozen data.
 */
export function updateSnapshotBanner(): void {
  const snapshotMode = supabaseDataService.getSnapshotMode();

  if (!snapshotMode) {
    // Remove banner if present
    const existing = document.getElementById(BANNER_ID);
    if (existing) existing.remove();
    return;
  }

  // Format label from snapshot ID (e.g., "opening_day_2022" → "Opening Day 2022")
  const label = snapshotMode
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  let banner = document.getElementById(BANNER_ID);
  if (!banner) {
    banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 99998;
      background: #0c2d48; color: #7dd3fc; font-size: 13px; font-family: system-ui, sans-serif;
      padding: 6px 16px; border-bottom: 2px solid #0ea5e9;
      display: flex; align-items: center; gap: 10px;
    `;
    document.body.prepend(banner);
  }

  banner.innerHTML = `
    <span style="font-weight: 600;">Viewing ${label} Projections</span>
    <span style="color: #94a3b8; font-size: 12px;">All projections are frozen from opening day.</span>
    <button id="snapshot-banner-switch" style="
      margin-left: auto; background: #0ea5e9; color: #fff; border: none;
      border-radius: 4px; padding: 3px 10px; cursor: pointer; font-size: 12px;
      font-weight: 500;
    ">Switch to Updated</button>
  `;

  const switchBtn = banner.querySelector('#snapshot-banner-switch');
  if (switchBtn) {
    switchBtn.addEventListener('click', () => {
      supabaseDataService.setSnapshotMode(null);
      try { localStorage.removeItem('wbl-snapshot-mode'); } catch { /* ignore */ }
      updateSnapshotBanner();
      // Notify views to re-fetch with live data
      window.dispatchEvent(new CustomEvent('wbl:snapshot-mode-changed', { detail: { snapshotMode: null } }));
    });
  }
}

/**
 * Set snapshot mode and update the banner + notify views.
 */
export function setSnapshotModeWithBanner(snapshotId: string | null): void {
  supabaseDataService.setSnapshotMode(snapshotId);
  try {
    if (snapshotId) {
      localStorage.setItem('wbl-snapshot-mode', snapshotId);
    } else {
      localStorage.removeItem('wbl-snapshot-mode');
    }
  } catch { /* ignore */ }
  updateSnapshotBanner();
  window.dispatchEvent(new CustomEvent('wbl:snapshot-mode-changed', { detail: { snapshotMode: snapshotId } }));
}
