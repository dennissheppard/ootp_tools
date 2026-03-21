/**
 * Scouting Login Modal — Allows users to fetch their team's private scouting data.
 * Launched from the header badge. Replaces the login form that was on DataManagementView.
 */

import { teamService } from '../services/TeamService';
import { dateService } from '../services/DateService';
import { scoutingDataService } from '../services/ScoutingDataService';
import { hitterScoutingDataService } from '../services/HitterScoutingDataService';
import { supabaseDataService } from '../services/SupabaseDataService';
import { trueRatingsService } from '../services/TrueRatingsService';
import { teamRatingsService } from '../services/TeamRatingsService';
import { PitcherScoutingRatings, HitterScoutingRatings } from '../models/ScoutingData';
import { getTeamLogoUrl } from '../utils/teamLogos';
import { apiFetch } from '../services/ApiClient';
import { MessageModal } from './MessageModal';

const INJURY_MAP: Record<string, string> = {
  '1': 'Wrecked', '2': 'Fragile', '3': 'Normal', '4': 'Durable', '5': 'Iron Man',
  'WRECKED': 'Wrecked', 'FRAGILE': 'Fragile', 'NORMAL': 'Normal', 'DURABLE': 'Durable', 'IRON MAN': 'Iron Man', 'IRONMAN': 'Iron Man',
};

class ScoutingLoginModal {
  private overlay: HTMLElement | null = null;
  private selectedTeamAbbr = '';
  private selectedTeamNickname = '';
  private teamAbbrMap = new Map<string, string>();
  private messageModal = new MessageModal();
  private progressOverlay: HTMLElement | undefined;
  private progressClickBlocker: ((e: MouseEvent) => void) | undefined;

  show(): void {
    if (this.overlay) {
      this.overlay.classList.add('visible');
      this.overlay.setAttribute('aria-hidden', 'false');
      return;
    }
    this.createDOM();
    this.loadTeamDropdown();
  }

  hide(): void {
    if (!this.overlay) return;
    this.overlay.classList.remove('visible');
    this.overlay.setAttribute('aria-hidden', 'true');
  }

  private createDOM(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';
    this.overlay.setAttribute('aria-hidden', 'false');
    this.overlay.style.zIndex = '1100';
    this.overlay.innerHTML = `
      <div class="modal scouting-login-modal" style="width: min(460px, 90vw);">
        <div class="modal-header">
          <h3 class="modal-title">Load Team Scouting</h3>
          <button class="modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body" style="padding: 1.25rem 1.5rem;">
          <p style="font-size: 0.85em; color: var(--color-text-muted); margin: 0 0 1rem;">
            Load your team's private scouting ratings. These are stored locally in your browser only.
          </p>
          <div style="display: flex; flex-direction: column; gap: 0.75rem;">
            <div class="rating-field">
              <label>Team</label>
              <div class="filter-dropdown" id="scouting-modal-team-dropdown" style="width: 100%;">
                <button class="filter-dropdown-btn" style="width: 100%; text-align: left;" aria-haspopup="true" aria-expanded="false">
                  <span id="scouting-modal-team-display">Select your team...</span> ▾
                </button>
                <div class="filter-dropdown-menu" id="scouting-modal-team-menu" style="max-height: 300px; overflow-y: auto;"></div>
              </div>
            </div>
            <div class="rating-field">
              <label for="scouting-modal-passphrase">Passphrase</label>
              <input type="text" id="scouting-modal-passphrase" placeholder="Enter team passphrase" autocomplete="off" data-lpignore="true" data-form-type="other" style="width: 100%; padding: 0.4rem 0.5rem; background: var(--color-surface); color: var(--color-text); border: 1px solid var(--color-border); border-radius: 4px; -webkit-text-security: disc;">
            </div>
          </div>
          <p style="font-size: 0.75em; color: var(--color-text-muted); margin: 0.75rem 0 0;">
            Your passphrase is not stored. Scouting ratings are saved locally and never uploaded.
          </p>
        </div>
        <div class="modal-footer" style="padding: 0.75rem 1.5rem; border-top: 1px solid var(--color-border); text-align: right;">
          <button id="scouting-modal-fetch-btn" class="btn btn-primary" disabled>Fetch Scouting</button>
        </div>
      </div>
    `;

    this.overlay.classList.add('visible');
    document.body.appendChild(this.overlay);
    this.bindEvents();
  }

  private bindEvents(): void {
    if (!this.overlay) return;

    // Close handlers
    this.overlay.querySelector('.modal-close')?.addEventListener('click', () => this.hide());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.overlay?.classList.contains('visible')) this.hide();
    });

    // Passphrase input → enable/disable fetch
    const passInput = this.overlay.querySelector<HTMLInputElement>('#scouting-modal-passphrase');
    passInput?.addEventListener('input', () => this.updateFetchEnabled());

    // Fetch button
    this.overlay.querySelector('#scouting-modal-fetch-btn')?.addEventListener('click', () => this.handleFetch());

    // Team dropdown toggle
    const dropdownBtn = this.overlay.querySelector('#scouting-modal-team-dropdown .filter-dropdown-btn');
    dropdownBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.overlay?.querySelector('#scouting-modal-team-dropdown')?.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('#scouting-modal-team-dropdown')) {
        this.overlay?.querySelector('#scouting-modal-team-dropdown')?.classList.remove('open');
      }
    });
  }

  private updateFetchEnabled(): void {
    const btn = this.overlay?.querySelector<HTMLButtonElement>('#scouting-modal-fetch-btn');
    const pass = this.overlay?.querySelector<HTMLInputElement>('#scouting-modal-passphrase');
    if (btn) btn.disabled = !this.selectedTeamAbbr || !pass?.value;
  }

  private async loadTeamDropdown(): Promise<void> {
    const menu = this.overlay?.querySelector<HTMLElement>('#scouting-modal-team-menu');
    if (!menu) return;

    try {
      const [allTeams, apiRes] = await Promise.all([
        teamService.getAllTeams(),
        apiFetch('/api/teams?level=wbl').then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      if (apiRes?.teams) {
        for (const t of Object.values(apiRes.teams) as { abbr: string; nickname: string }[]) {
          this.teamAbbrMap.set(t.nickname, t.abbr);
        }
      }

      const orgsWithAffiliates = new Set<number>();
      for (const t of allTeams) {
        if (t.parentTeamId > 0) orgsWithAffiliates.add(t.parentTeamId);
      }
      const mainTeams = allTeams
        .filter(t => t.parentTeamId === 0 && orgsWithAffiliates.has(t.id))
        .sort((a, b) => a.nickname.localeCompare(b.nickname));

      menu.innerHTML = mainTeams.map(t => {
        const logoUrl = getTeamLogoUrl(t.nickname);
        const logoHtml = logoUrl ? `<img class="team-dropdown-logo" src="${logoUrl}" alt="">` : '';
        return `<div class="filter-dropdown-item" data-nickname="${t.nickname}" data-abbr="${this.teamAbbrMap.get(t.nickname) ?? ''}">${logoHtml}${t.nickname}</div>`;
      }).join('');

      menu.querySelectorAll('.filter-dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
          const el = item as HTMLElement;
          this.selectedTeamNickname = el.dataset.nickname ?? '';
          this.selectedTeamAbbr = el.dataset.abbr ?? '';

          const display = this.overlay?.querySelector<HTMLElement>('#scouting-modal-team-display');
          if (display) {
            const logoUrl = getTeamLogoUrl(this.selectedTeamNickname);
            const logoHtml = logoUrl ? `<img class="team-btn-logo" src="${logoUrl}" alt="">` : '';
            display.innerHTML = `${logoHtml}${this.selectedTeamNickname}`;
          }

          menu.querySelectorAll('.filter-dropdown-item').forEach(i => i.classList.remove('selected'));
          el.classList.add('selected');
          this.overlay?.querySelector('#scouting-modal-team-dropdown')?.classList.remove('open');
          this.updateFetchEnabled();
        });
      });
    } catch {
      // Silently fail
    }
  }

  private async handleFetch(): Promise<void> {
    const passInput = this.overlay?.querySelector<HTMLInputElement>('#scouting-modal-passphrase');
    const fetchBtn = this.overlay?.querySelector<HTMLButtonElement>('#scouting-modal-fetch-btn');
    const teamAbbr = this.selectedTeamAbbr;
    const passphrase = passInput?.value;
    if (!teamAbbr || !passphrase) return;

    if (fetchBtn) { fetchBtn.disabled = true; fetchBtn.textContent = 'Fetching...'; }

    // Hide login modal, show progress overlay
    this.hide();
    this.showProgressOverlay();
    this.updateProgress('Fetching scouting data...', 'Connecting to WBL API');

    try {
      const gameDate = await dateService.getCurrentDate();
      const PAGE_SIZE = 2000;
      let allRatings: any[] = [];
      let offset = 0;
      let total = Infinity;

      while (offset < total) {
        const url = `/api/scout?tid=${encodeURIComponent(teamAbbr)}&passphrase=${encodeURIComponent(passphrase)}&limit=${PAGE_SIZE}&offset=${offset}`;
        const res = await apiFetch(url);
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(body || `HTTP ${res.status}`);
        }
        const data = await res.json();
        const pageRatings = data.ratings as any[];
        if (!pageRatings || pageRatings.length === 0) break;

        allRatings = allRatings.concat(pageRatings);
        total = data.total ?? pageRatings.length;
        offset += pageRatings.length;
        this.updateProgress('Fetching scouting data...', `${allRatings.length} of ${total} records`);
        if (pageRatings.length < PAGE_SIZE) break;
      }

      if (allRatings.length === 0) {
        this.dismissProgressOverlay();
        this.messageModal.show('No Results', 'No scouting ratings returned. Check your team and passphrase.');
        if (fetchBtn) { fetchBtn.disabled = false; fetchBtn.textContent = 'Fetch Scouting'; }
        return;
      }

      this.updateProgress('Processing ratings...', `${allRatings.length} records fetched`);

      const pitcherRatings: PitcherScoutingRatings[] = [];
      const hitterRatings: HitterScoutingRatings[] = [];

      for (const r of allRatings) {
        const injury = r.injury_proneness ? (INJURY_MAP[String(r.injury_proneness).toUpperCase()] ?? String(r.injury_proneness)) : undefined;
        if (r.is_pitcher) {
          const pitches: Record<string, number> = {};
          if (r.pitching?.pitches) {
            for (const [k, v] of Object.entries(r.pitching.pitches)) {
              const val = parseInt(String(v), 10);
              if (val > 0) pitches[k] = val;
            }
          }
          pitcherRatings.push({
            playerId: parseInt(r.player_id, 10),
            playerName: r.player_name || undefined,
            stuff: parseInt(r.pitching?.stuff, 10) || 20,
            control: parseInt(r.pitching?.control, 10) || 20,
            hra: parseInt(r.pitching?.hra, 10) || 20,
            stamina: r.pitching?.stamina ? parseInt(r.pitching.stamina, 10) : undefined,
            injuryProneness: injury,
            ovr: r.overall ? parseFloat(r.overall) : undefined,
            pot: r.potential ? parseFloat(r.potential) : undefined,
            pitches: Object.keys(pitches).length > 0 ? pitches : undefined,
            babip: r.pitching?.pbabip ? String(r.pitching.pbabip) : undefined,
          });
        } else {
          hitterRatings.push({
            playerId: parseInt(r.player_id, 10),
            playerName: r.player_name || undefined,
            power: parseInt(r.batting?.power, 10) || 20,
            eye: parseInt(r.batting?.eye, 10) || 20,
            avoidK: parseInt(r.batting?.avoidKs, 10) || 20,
            contact: parseInt(r.batting?.contact, 10) || 20,
            gap: parseInt(r.batting?.gap, 10) || 20,
            speed: parseInt(r.batting?.speed, 10) || 20,
            stealingAggressiveness: r.batting?.sbAgg ? parseInt(r.batting.sbAgg, 10) : undefined,
            stealingAbility: r.batting?.steal ? parseInt(r.batting.steal, 10) : undefined,
            injuryProneness: injury,
            ovr: parseFloat(r.overall) || 2.5,
            pot: parseFloat(r.potential) || 2.5,
            fielding: r.fielding || undefined,
          });
        }
      }

      this.updateProgress('Saving to browser...', `${pitcherRatings.length} pitchers, ${hitterRatings.length} hitters`);
      if (pitcherRatings.length > 0) await scoutingDataService.saveScoutingRatings(gameDate, pitcherRatings, 'my');
      if (hitterRatings.length > 0) await hitterScoutingDataService.saveScoutingRatings(gameDate, hitterRatings, 'my');

      if (passInput) passInput.value = '';

      let resultMessage: string;

      if (supabaseDataService.isConfigured) {
        supabaseDataService.hasCustomScouting = true;
        trueRatingsService.clearCaches();
        teamRatingsService.clearTfrCaches();

        this.updateProgress('Recalculating ratings...', 'This may take a moment');

        try {
          const year = await dateService.getCurrentYear();
          await trueRatingsService.warmCachesForComputation(year);
          const [hitterTr, pitcherTr] = await Promise.all([
            trueRatingsService.getHitterTrueRatings(year),
            trueRatingsService.getPitcherTrueRatings(year),
            teamRatingsService.getUnifiedHitterTfrData(year),
            teamRatingsService.getFarmData(year),
          ]);
          resultMessage = `Loaded ${pitcherRatings.length} pitcher and ${hitterRatings.length} hitter ratings.\nRecalculated: ${hitterTr.size} hitter TRs, ${pitcherTr.size} pitcher TRs.`;
        } catch (err) {
          console.error('Failed to recalculate ratings:', err);
          resultMessage = `Loaded ${pitcherRatings.length} pitcher and ${hitterRatings.length} hitter ratings.\nRating recalculation failed — try refreshing.`;
        }
      } else {
        resultMessage = `Loaded ${pitcherRatings.length} pitcher and ${hitterRatings.length} hitter ratings from ${this.selectedTeamNickname || teamAbbr}.`;
      }

      this.dismissProgressOverlay();
      this.messageModal.show('Scouting Loaded', resultMessage);

      // Notify all views + update header badge
      window.dispatchEvent(new CustomEvent('scoutingDataUpdated', { detail: { source: 'my' } }));
      window.dispatchEvent(new CustomEvent('wbl:scouting-login-changed'));
    } catch (err) {
      console.error('Team scouting fetch failed:', err);
      this.dismissProgressOverlay();
      this.messageModal.show('Fetch Failed', `Could not load scouting data. Check your passphrase and try again.\n\n${err}`);
    } finally {
      if (fetchBtn) { fetchBtn.disabled = false; fetchBtn.textContent = 'Fetch Scouting'; }
    }
  }

  private showProgressOverlay(): void {
    const overlay = document.createElement('div');
    overlay.id = 'scouting-fullscreen-overlay';
    overlay.style.cssText = `position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 1200; background: rgba(0,0,0,0.7); display: flex; flex-direction: column; align-items: center; justify-content: center;`;
    overlay.innerHTML = `
      <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 2rem 2.5rem; display: flex; flex-direction: column; align-items: center; gap: 1.25rem; box-shadow: 0 8px 32px rgba(0,0,0,0.5); min-width: 320px; max-width: 90vw; text-align: center;">
        <div style="width: 40px; height: 40px; border: 3px solid var(--color-border); border-top-color: var(--color-primary); border-radius: 50%; animation: scouting-spin 0.8s linear infinite;"></div>
        <div id="scouting-overlay-status" style="font-size: 0.95rem; color: var(--color-text); font-weight: 500;"></div>
        <div id="scouting-overlay-detail" style="font-size: 0.82rem; color: var(--color-text-muted);"></div>
      </div>
      <style>@keyframes scouting-spin { to { transform: rotate(360deg); } }</style>
    `;
    document.body.appendChild(overlay);
    this.progressOverlay = overlay;

    const blocker = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
    document.addEventListener('click', blocker, true);
    this.progressClickBlocker = blocker;
  }

  private updateProgress(status: string, detail?: string): void {
    if (!this.progressOverlay) return;
    const s = this.progressOverlay.querySelector<HTMLElement>('#scouting-overlay-status');
    const d = this.progressOverlay.querySelector<HTMLElement>('#scouting-overlay-detail');
    if (s) s.textContent = status;
    if (d) d.textContent = detail ?? '';
  }

  private dismissProgressOverlay(): void {
    if (this.progressClickBlocker) {
      document.removeEventListener('click', this.progressClickBlocker, true);
      this.progressClickBlocker = undefined;
    }
    if (this.progressOverlay) {
      this.progressOverlay.remove();
      this.progressOverlay = undefined;
    }
  }
}

export const scoutingLoginModal = new ScoutingLoginModal();
