import { supabaseDataService } from '../services/SupabaseDataService';
import { scoutingLoginModal } from '../views/ScoutingLoginModal';

const DISMISSED_KEY = 'wbl-osa-banner-dismissed';

/**
 * Returns HTML for an OSA-only scouting banner, or empty string if custom scouting is loaded
 * or the user has dismissed the banner this session.
 */
export function osaBannerHtml(): string {
  if (supabaseDataService.hasCustomScouting) return '';
  if (sessionStorage.getItem(DISMISSED_KEY) === '1') return '';

  return `
    <div class="osa-scouting-banner" id="osa-scouting-banner">
      <div class="osa-scouting-banner-content">
        <span class="osa-scouting-banner-text">
          📊 <strong>Using OSA scouting only!</strong>
          Your scout is usually more accurate than OSA ratings. This mainly impacts True Future Ratings for prospects — True Ratings rely mostly on stats.
          <a href="#" class="osa-scouting-banner-link" data-action="open-scouting-login">Load your team's scouting</a>
        </span>
        <button class="osa-scouting-banner-close" data-action="dismiss-osa-banner" aria-label="Dismiss">&times;</button>
      </div>
    </div>
  `;
}

/** Bind banner events (dismiss + login modal link). Call once after rendering. */
export function bindOsaBannerEvents(container: HTMLElement): void {
  const banner = container.querySelector<HTMLElement>('#osa-scouting-banner');
  if (!banner) return;

  banner.querySelector('[data-action="dismiss-osa-banner"]')?.addEventListener('click', () => {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    banner.remove();
  });

  banner.querySelector('[data-action="open-scouting-login"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    scoutingLoginModal.show();
  });

  // Auto-hide when scouting is uploaded
  window.addEventListener('scoutingDataUpdated', () => {
    banner.remove();
  }, { once: true });
}
