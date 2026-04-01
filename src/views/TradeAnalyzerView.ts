import { Player, getFullName, isPitcher, getPositionLabel } from '../models/Player';
import { playerService } from '../services/PlayerService';
import { teamService } from '../services/TeamService';
import type { ProjectedPlayer } from '../services/ProjectionService';
import { Team } from '../models/Team';
import { dateService } from '../services/DateService';
import { scoutingDataFallbackService } from '../services/ScoutingDataFallbackService';
import { pitcherProfileModal } from './PitcherProfileModal';
import { BatterProfileModal, BatterProfileData } from './BatterProfileModal';
import type { ProjectedBatter } from '../services/BatterProjectionService';
import { teamRatingsService, RatedProspect, RatedHitterProspect, TeamPowerRanking, RatedPitcher, RatedBatter } from '../services/TeamRatingsService';
import { contractService, Contract } from '../services/ContractService';
import { trueRatingsService } from '../services/TrueRatingsService';
import { TrueRatingResult } from '../services/TrueRatingsCalculationService';
import { HitterTrueRatingResult } from '../services/HitterTrueRatingsCalculationService';
import { aiTradeAnalysisService, TradeContext, TradePlayerContext, TradePickContext } from '../services/AITradeAnalysisService';
import { markdownToHtml } from '../services/AIScoutingService';
import { resolveCanonicalPitcherData, resolveCanonicalBatterData, computePitcherProjection, computeBatterProjection } from '../services/ModalDataService';
import type { PitcherProfileData } from './PitcherProfileModal';
import { HitterRatingEstimatorService } from '../services/HitterRatingEstimatorService';
import { hitterAgingService } from '../services/HitterAgingService';
import { leagueBattingAveragesService } from '../services/LeagueBattingAveragesService';
import { fipWarService } from '../services/FipWarService';
import { emitDataSourceBadges } from '../utils/dataSourceBadges';
import { teamLogoImg } from '../utils/teamLogos';
import { analyticsService } from '../services/AnalyticsService';
import { ParkFactorRow, computeEffectiveParkFactors, computePitcherParkHrFactor } from '../services/ParkFactorService';
import { supabaseDataService } from '../services/SupabaseDataService';

interface DraftPick {
  id: string;
  round: number;
  pickPosition?: number;
  displayName: string;
  estimatedValue: number;  // WAR estimate
}

interface TradeTeamState {
  teamId: number;
  minorLevel: string;
  tradingPlayers: ProjectedPlayer[];
  tradingBatters: ProjectedBatter[];
  tradingPicks: DraftPick[];
  showingPitchers: boolean;
  sortKey: 'name' | 'position' | 'rating';
  sortDirection: 'asc' | 'desc';
}

interface TradeAnalysis {
  team1WarChange: number;
  team2WarChange: number;
  team1CurrentWar: number;
  team2CurrentWar: number;
  team1FutureWar: number;
  team2FutureWar: number;
  team1Gain: boolean;
  team2Gain: boolean;
  summary: string;
}

export class TradeAnalyzerView {
  private container: HTMLElement;
  private teamPlayers: Map<number, Player[]> = new Map(); // per-org player cache
  private allTeams: Team[] = [];
  private allProjections: Map<number, ProjectedPlayer> = new Map();
  private allBatterProjections: Map<number, ProjectedBatter> = new Map();
  private currentYear: number = 2022;
  private batterProfileModal: BatterProfileModal;
  private scoutingDataMode: 'my' | 'osa' | 'mixed' | 'none' = 'none';

  // Full-pool farm data maps (Improvement 1)
  private pitcherProspectMap: Map<number, RatedProspect> = new Map();
  private hitterProspectMap: Map<number, RatedHitterProspect> = new Map();

  // Power rankings for team impact — lazy-loaded on first trade analysis
  private powerRankingsMap: Map<number, TeamPowerRanking> = new Map();
  private powerRankingsLoaded = false;

  // Contracts — lazy-loaded on first team selection
  private allContracts: Map<number, Contract> = new Map();
  private contractsLoaded = false;

  // Canonical True Ratings (consistent with profile modals)
  private canonicalPitcherTR: Map<number, TrueRatingResult> = new Map();
  private canonicalBatterTR: Map<number, HitterTrueRatingResult> = new Map();

  // Park factors for WAR re-projection to destination parks
  private parkFactorsMap: Map<number, ParkFactorRow> = new Map();
  private parkFactorsLoaded = false;

  // Initialization promise — awaited by initWithTrade to ensure data is ready
  private initPromise: Promise<void> | null = null;
  // Scroll position to restore when returning to Trade Market
  private tradeMarketScrollY: number | null = null;

  private team1State: TradeTeamState = {
    teamId: 0,
    minorLevel: 'mlb',
    tradingPlayers: [],
    tradingBatters: [],
    tradingPicks: [],
    showingPitchers: true,
    sortKey: 'rating',
    sortDirection: 'desc'
  };
  private team2State: TradeTeamState = {
    teamId: 0,
    minorLevel: 'mlb',
    tradingPlayers: [],
    tradingBatters: [],
    tradingPicks: [],
    showingPitchers: true,
    sortKey: 'rating',
    sortDirection: 'desc'
  };

  constructor(container: HTMLElement) {
    this.container = container;
    this.batterProfileModal = new BatterProfileModal();
    this.initPromise = this.initialize();

    window.addEventListener('wbl:request-data-source-badges', () => {
      if (this.container.closest('.tab-panel.active')) this.updateDataSourceBadges();
    });
  }

  private findPlayer(playerId: number): Player | undefined {
    for (const players of this.teamPlayers.values()) {
      const found = players.find(p => p.id === playerId);
      if (found) return found;
    }
    return undefined;
  }

  private async openPlayerProfile(playerId: number): Promise<void> {
    const player = this.findPlayer(playerId);
    if (!player) {
      console.warn(`Player ${playerId} not found`);
      return;
    }

    const team = this.allTeams.find(t => t.id === player.teamId);
    let parentTeam: string | undefined;
    if (team && team.parentTeamId !== 0) {
      const parent = this.allTeams.find(t => t.id === team.parentTeamId);
      parentTeam = parent?.nickname;
    }
    const teamLabel = team ? `${team.name} ${team.nickname}` : undefined;

    if (isPitcher(player)) {
      // Minimal profile data — the modal applies canonical TR/TFR overrides internally
      const projection = this.allProjections.get(playerId);
      const profileData = {
        playerId: player.id,
        playerName: getFullName(player),
        team: teamLabel,
        parentTeam,
        age: player.age,
        position: player.position,
        positionLabel: getPositionLabel(player.position),
        // Seed with projection data if available; modal overrides with canonical TR/TFR
        trueRating: projection?.currentTrueRating,
        estimatedStuff: projection?.projectedRatings?.stuff,
        estimatedControl: projection?.projectedRatings?.control,
        estimatedHra: projection?.projectedRatings?.hra,
        projWar: projection?.projectedStats.war,
        projIp: projection?.projectedStats.ip,
        projFip: projection?.projectedStats.fip,
        projK9: projection?.projectedStats.k9,
        projBb9: projection?.projectedStats.bb9,
        projHr9: projection?.projectedStats.hr9,
        isProspect: projection?.isProspect,
      };

      await pitcherProfileModal.show(profileData as any, this.currentYear);
    } else {
      // Minimal profile data — the modal applies canonical TR/TFR overrides internally
      const projection = this.allBatterProjections.get(playerId);
      const profileData: BatterProfileData = {
        playerId: player.id,
        playerName: getFullName(player),
        team: teamLabel,
        parentTeam,
        age: player.age,
        position: player.position,
        positionLabel: getPositionLabel(player.position),
        // Seed with projection data if available; modal overrides with canonical TR/TFR
        trueRating: projection?.currentTrueRating,
        percentile: projection?.percentile,
        estimatedPower: projection?.estimatedRatings?.power,
        estimatedEye: projection?.estimatedRatings?.eye,
        estimatedAvoidK: projection?.estimatedRatings?.avoidK,
        estimatedContact: projection?.estimatedRatings?.contact,
        projWar: projection?.projectedStats?.war,
        projPa: projection?.projectedStats?.pa,
        isProspect: projection?.isProspect,
      };

      await this.batterProfileModal.show(profileData, this.currentYear);
    }
  }

  private async initialize(): Promise<void> {
    this.render();

    // Get current year from dateService
    try {
      this.currentYear = await dateService.getCurrentYear();
    } catch (e) {
      console.warn('Failed to get current year, using 2022:', e);
      this.currentYear = 2022;
    }

    this.allTeams = await teamService.getAllTeams();

    // Detect scouting data mode for badges (don't need to store all ratings —
    // CanonicalCurrentProjectionService loads them internally)
    try {
      const scoutingResult = await scoutingDataFallbackService.getScoutingRatingsWithFallback();
      this.scoutingDataMode = scoutingResult.metadata.fromMyScout > 0 && scoutingResult.metadata.fromOSA > 0
        ? 'mixed'
        : scoutingResult.metadata.fromMyScout > 0
          ? 'my'
          : scoutingResult.metadata.fromOSA > 0
            ? 'osa'
            : 'none';
      this.updateDataSourceBadges();
    } catch (e) {
      console.error('Failed to detect scouting data mode:', e);
    }

    // Load TFR prospects from precomputed cache (1 request each), canonical TR,
    // and cached projections in parallel. No bulk stats fetches.
    try {
      // All reads from precomputed cache — zero stats fetches.
      const [pitcherTfrCache, hitterTfrCache, pitcherTR, batterTR, pitcherProjCache, batterProjCache, contractLookup, parkFactors, playerLookup] = await Promise.all([
        supabaseDataService.getPrecomputed('pitcher_tfr_prospects').catch(() => null),
        supabaseDataService.getPrecomputed('hitter_tfr_prospects').catch(() => null),
        trueRatingsService.getPitcherTrueRatings(this.currentYear).catch(e => { console.warn('Failed to load canonical pitcher TR:', e); return null; }),
        trueRatingsService.getHitterTrueRatings(this.currentYear).catch(e => { console.warn('Failed to load canonical batter TR:', e); return null; }),
        supabaseDataService.getPrecomputed('pitcher_projections').catch(() => null),
        supabaseDataService.getPrecomputed('batter_projections').catch(() => null),
        supabaseDataService.getPrecomputed('contract_lookup').catch(() => null),
        supabaseDataService.getPrecomputed('park_factors').catch(() => null),
        supabaseDataService.getPrecomputed('player_lookup').catch(() => null),
      ]);

      if (Array.isArray(pitcherTfrCache)) {
        for (const p of pitcherTfrCache) this.pitcherProspectMap.set(p.playerId, p as RatedProspect);
      }
      if (Array.isArray(hitterTfrCache)) {
        for (const p of hitterTfrCache) this.hitterProspectMap.set(p.playerId, p as RatedHitterProspect);
      }
      if (pitcherTR) {
        this.canonicalPitcherTR = pitcherTR;
      }
      if (batterTR) {
        this.canonicalBatterTR = batterTR;
      }
      if (pitcherProjCache?.projections) {
        for (const p of pitcherProjCache.projections) {
          this.allProjections.set(p.playerId, (p as any));
        }
      }
      if (batterProjCache?.projections) {
        for (const b of batterProjCache.projections) {
          this.allBatterProjections.set(b.playerId, (b as any));
        }
      }
      // Build power rankings from cached TR + projections (no stats fetches).
      // Group MLB players by team, assign ratings, sort into rotation/lineup/bullpen/bench.
      if (pitcherTR && batterTR) {
        const posLabels: Record<number, string> = { 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH' };
        const teamPitchers = new Map<number, RatedPitcher[]>();
        const teamBatters = new Map<number, RatedBatter[]>();

        // Use player_lookup to get team/position for TR-rated players
        // player_lookup: pid → [firstName, lastName, position, age, teamId, parentTeamId, level, status, ...]
        const lookup = playerLookup as Record<string, any[]> | null;

        if (lookup) {
          for (const [pid, tr] of pitcherTR) {
            const pl = lookup[pid];
            if (!pl) continue;
            const level = typeof pl[6] === 'string' ? parseInt(pl[6], 10) : (pl[6] ?? 1);
            if (level !== 1) continue; // MLB only
            const teamId = pl[5] || pl[4]; // parentTeamId || teamId
            if (!teamId) continue;
            const proj = this.allProjections.get(pid);
            const pitcher: RatedPitcher = {
              playerId: pid, name: `${pl[0]} ${pl[1]}`, trueRating: tr.trueRating,
              trueStuff: tr.estimatedStuff ?? 50, trueControl: tr.estimatedControl ?? 50,
              trueHra: tr.estimatedHra ?? 50,
              role: proj?.isSp ? 'SP' : 'RP',
            };
            if (!teamPitchers.has(teamId)) teamPitchers.set(teamId, []);
            teamPitchers.get(teamId)!.push(pitcher);
          }

          for (const [pid, tr] of batterTR) {
            const pl = lookup[pid];
            if (!pl) continue;
            const level = typeof pl[6] === 'string' ? parseInt(pl[6], 10) : (pl[6] ?? 1);
            if (level !== 1) continue;
            const teamId = pl[5] || pl[4];
            if (!teamId) continue;
            const pos = typeof pl[2] === 'string' ? parseInt(pl[2], 10) : (pl[2] ?? 10);
            const batter: RatedBatter = {
              playerId: pid, name: `${pl[0]} ${pl[1]}`, trueRating: tr.trueRating,
              position: pos, positionLabel: posLabels[pos] || 'DH',
              estimatedPower: tr.estimatedPower ?? 50, estimatedEye: tr.estimatedEye ?? 50,
              estimatedAvoidK: tr.estimatedAvoidK ?? 50, estimatedContact: tr.estimatedContact ?? 50,
            };
            if (!teamBatters.has(teamId)) teamBatters.set(teamId, []);
            teamBatters.get(teamId)!.push(batter);
          }
        }

        const allTeamIds = new Set([...teamPitchers.keys(), ...teamBatters.keys()]);
        for (const teamId of allTeamIds) {
          const pitchers = (teamPitchers.get(teamId) ?? []).sort((a, b) => b.trueRating - a.trueRating);
          const batters = (teamBatters.get(teamId) ?? []).sort((a, b) => b.trueRating - a.trueRating);

          const sps = pitchers.filter(p => p.role === 'SP');
          const rps = pitchers.filter(p => p.role !== 'SP');
          const rotation = sps.slice(0, 5);
          // Excess SPs go to bullpen
          const bullpen = [...rps, ...sps.slice(5)].sort((a, b) => b.trueRating - a.trueRating).slice(0, 8);
          const lineup = batters.slice(0, 9);
          const bench = batters.slice(9);

          const avg = (arr: { trueRating: number }[]) => arr.length > 0 ? arr.reduce((s, p) => s + p.trueRating, 0) / arr.length : 0;
          const rotationRating = avg(rotation);
          const bullpenRating = avg(bullpen);
          const lineupRating = avg(lineup);
          const benchRating = avg(bench);
          const teamRating = (rotationRating * 0.30 + lineupRating * 0.35 + bullpenRating * 0.20 + benchRating * 0.15);

          this.powerRankingsMap.set(teamId, {
            teamId, teamName: '', teamRating,
            rotationRating, bullpenRating, lineupRating, benchRating,
            rotation, bullpen, lineup, bench,
            totalRosterSize: rotation.length + bullpen.length + lineup.length + bench.length,
          });
        }
        this.powerRankingsLoaded = true;
      }
      if (contractLookup) {
        for (const [pid, entry] of Object.entries(contractLookup)) {
          const [salary, leagueId, yearsRemaining] = entry as [number, number, number];
          this.allContracts.set(parseInt(pid, 10), {
            playerId: parseInt(pid, 10), teamId: 0, leagueId, isMajor: leagueId === 200,
            seasonYear: 0, years: yearsRemaining, currentYear: 0,
            salaries: [salary], noTrade: false,
            lastYearTeamOption: false, lastYearPlayerOption: false, lastYearVestingOption: false,
          } as Contract);
        }
        this.contractsLoaded = true;
      }
      if (parkFactors) {
        for (const [k, v] of Object.entries(parkFactors)) {
          this.parkFactorsMap.set(parseInt(k, 10), v as any);
        }
        this.parkFactorsLoaded = true;
      }
    } catch (e) {
      console.error('Failed to load farm/ranking data:', e);
    }

    this.setupEventHandlers();
    this.populateTeamDropdowns();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="view-header">
        <p class="section-subtitle">Fill in potential trades to view projected war swappage</p>
      </div>

      <div class="trade-analyzer-container">
        <!-- Left Column: Team 1 -->
        <div class="trade-column trade-column-left">
          <div class="trade-team-header">
            <div class="trade-team-dropdown filter-dropdown" data-team="1" data-selected-id="">
              <button class="filter-dropdown-btn trade-team-dropdown-btn" aria-haspopup="true" aria-expanded="false">
                <span class="trade-team-display">Select Team 1...</span> ▾
              </button>
              <div class="filter-dropdown-menu trade-team-menu"></div>
            </div>
          </div>

          <div class="trade-level-selector">
            <label>Level:</label>
            <select class="trade-level-select" data-team="1">
              <option value="mlb" selected>MLB</option>
              <option value="all-prospects">All Prospects</option>
              <option value="aaa">Triple-A</option>
              <option value="aa">Double-A</option>
              <option value="a">Single-A</option>
              <option value="r">Rookie</option>
              <option value="ic">Int'l Complex</option>
              <option value="draft">Draft Picks</option>
            </select>
          </div>

          <div class="trade-player-type-toggle" data-team="1">
            <button class="toggle-btn active" data-player-type="pitchers" data-team="1">Pitchers</button>
            <button class="toggle-btn" data-player-type="batters" data-team="1">Batters</button>
          </div>

          <div class="trade-player-list" data-team="1">
            <!-- Players will be populated here -->
          </div>
        </div>

        <!-- Middle Column: Analysis -->
        <div class="trade-column trade-column-middle">
          <div class="trade-analysis-header">
            <h3>Trade Analysis</h3>
          </div>

          <div class="trade-analysis-content">
            <div class="analysis-placeholder">
              <p>Select players from both teams to analyze trade impact</p>
            </div>
          </div>

          <div class="trade-clear-buttons">
            <button class="btn btn-secondary clear-trade-btn" data-team="1">Clear Team 1</button>
            <button class="btn btn-secondary clear-trade-btn" data-team="2">Clear Team 2</button>
          </div>
        </div>

        <!-- Right Column: Team 2 -->
        <div class="trade-column trade-column-right">
          <div class="trade-team-header">
            <div class="trade-team-dropdown filter-dropdown" data-team="2" data-selected-id="">
              <button class="filter-dropdown-btn trade-team-dropdown-btn" aria-haspopup="true" aria-expanded="false">
                <span class="trade-team-display">Select Team 2...</span> ▾
              </button>
              <div class="filter-dropdown-menu trade-team-menu"></div>
            </div>
          </div>

          <div class="trade-level-selector">
            <label>Level:</label>
            <select class="trade-level-select" data-team="2">
              <option value="mlb" selected>MLB</option>
              <option value="all-prospects">All Prospects</option>
              <option value="aaa">Triple-A</option>
              <option value="aa">Double-A</option>
              <option value="a">Single-A</option>
              <option value="r">Rookie</option>
              <option value="ic">Int'l Complex</option>
              <option value="draft">Draft Picks</option>
            </select>
          </div>

          <div class="trade-player-type-toggle" data-team="2">
            <button class="toggle-btn active" data-player-type="pitchers" data-team="2">Pitchers</button>
            <button class="toggle-btn" data-player-type="batters" data-team="2">Batters</button>
          </div>

          <div class="trade-player-list" data-team="2">
            <!-- Players will be populated here -->
          </div>
        </div>
      </div>
    `;
  }

  private updateDataSourceBadges(): void {
    emitDataSourceBadges('current-ytd', this.scoutingDataMode);
  }

  public async initWithTrade(myTeamId: number, targetTeamId: number, targetPlayerId: number, targetIsProspect: boolean, scrollY?: number, matchPlayerId?: number, matchPlayerIsProspect?: boolean): Promise<void> {
    // Wait for async initialization to complete before touching the DOM
    if (this.initPromise) await this.initPromise;

    this.tradeMarketScrollY = scrollY ?? null;
    this.renderBackButton();

    await this.setTeamById(1, myTeamId);

    // targetTeamId = 0 means "add player to team 1 side" (same-team / no saved team)
    const addToTeam1 = !targetTeamId;
    if (!addToTeam1) {
      await this.setTeamById(2, targetTeamId);
    }

    const targetSide: 1 | 2 = addToTeam1 ? 1 : 2;
    if (targetIsProspect) {
      const select = this.container.querySelector<HTMLSelectElement>(`.trade-level-select[data-team="${targetSide}"]`);
      if (select) {
        const state = targetSide === 1 ? this.team1State : this.team2State;
        select.value = 'all-prospects';
        state.minorLevel = 'all-prospects';
        const toggleContainer = this.container.querySelector<HTMLElement>(`.trade-player-type-toggle[data-team="${targetSide}"]`);
        if (toggleContainer) toggleContainer.style.display = 'flex';
        this.updatePlayerList(targetSide);
      }
    }

    this.addPlayerToTrade(targetSide, targetPlayerId);

    // Add the trade-match player to Team 1 if present (two-way match)
    if (matchPlayerId) {
      if (matchPlayerIsProspect) {
        const select = this.container.querySelector<HTMLSelectElement>('.trade-level-select[data-team="1"]');
        if (select) {
          select.value = 'all-prospects';
          this.team1State.minorLevel = 'all-prospects';
          const toggleContainer = this.container.querySelector<HTMLElement>('.trade-player-type-toggle[data-team="1"]');
          if (toggleContainer) toggleContainer.style.display = 'flex';
          this.updatePlayerList(1);
        }
      }
      this.addPlayerToTrade(1, matchPlayerId);
    }
  }

  private renderBackButton(): void {
    const header = this.container.querySelector<HTMLElement>('.view-header');
    if (!header) return;
    // Remove any existing back button
    header.querySelector('.trade-back-btn')?.remove();
    const btn = document.createElement('button');
    btn.className = 'trade-back-btn btn btn-ghost';
    btn.textContent = '← Back to Trade Market';
    btn.addEventListener('click', () => {
      const scrollY = this.tradeMarketScrollY ?? 0;
      window.dispatchEvent(new CustomEvent('wbl:navigate-tab', { detail: { tabId: 'tab-team-planning' } }));
      // Restore scroll after the tab panel becomes visible
      requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' })));
    });
    header.prepend(btn);
  }

  private async setTeamById(teamNum: 1 | 2, teamId: number): Promise<void> {
    const dropdown = this.container.querySelector<HTMLElement>(`.trade-team-dropdown[data-team="${teamNum}"]`);
    if (!dropdown) return;
    const item = dropdown.querySelector<HTMLElement>(`.filter-dropdown-item[data-value="${teamId}"]`);
    if (!item) return;

    const nickname = item.dataset.nickname ?? '';
    dropdown.dataset.selectedId = String(teamId);
    const display = dropdown.querySelector<HTMLElement>('.trade-team-display');
    if (display) display.innerHTML = `${teamLogoImg(nickname, 'team-btn-logo')}${nickname}`;
    dropdown.querySelectorAll('.filter-dropdown-item').forEach(i => i.classList.remove('selected'));
    item.classList.add('selected');

    await this.onTeamChange(teamNum);
  }

  public syncTeamSelection(): void {
    const saved = localStorage.getItem('wbl-selected-team');
    if (!saved) return;

    const dropdown = this.container.querySelector<HTMLElement>('.trade-team-dropdown[data-team="1"]');
    if (!dropdown) return;

    const item = dropdown.querySelector<HTMLElement>(`.filter-dropdown-item[data-nickname="${saved}"]`);
    if (!item) return;

    // Already selected
    if (item.classList.contains('selected')) return;

    const id = item.dataset.value ?? '';
    dropdown.dataset.selectedId = id;

    const display = dropdown.querySelector<HTMLElement>('.trade-team-display');
    if (display) display.innerHTML = `${teamLogoImg(saved, 'team-btn-logo')}${saved}`;

    dropdown.querySelectorAll('.filter-dropdown-item').forEach(i => i.classList.remove('selected'));
    item.classList.add('selected');

    this.onTeamChange(1);
  }

  private populateTeamDropdowns(): void {
    // Filter to real MLB orgs — teams with minor league affiliates (excludes All-Star teams)
    const orgsWithAffiliates = new Set<number>();
    for (const t of this.allTeams) {
      if (t.parentTeamId > 0) orgsWithAffiliates.add(t.parentTeamId);
    }
    const mainTeams = this.allTeams
      .filter(t => t.parentTeamId === 0 && orgsWithAffiliates.has(t.id))
      .sort((a, b) => a.nickname.localeCompare(b.nickname));

    ([1, 2] as const).forEach(teamNum => {
      const dropdown = this.container.querySelector<HTMLElement>(`.trade-team-dropdown[data-team="${teamNum}"]`);
      const menu = dropdown?.querySelector<HTMLElement>('.trade-team-menu');
      if (!dropdown || !menu) return;

      menu.innerHTML = mainTeams.map(team => {
        const logoHtml = teamLogoImg(team.nickname, 'team-dropdown-logo');
        return `<div class="filter-dropdown-item" data-value="${team.id}" data-nickname="${team.nickname}">${logoHtml}${team.nickname}</div>`;
      }).join('');

      menu.querySelectorAll<HTMLElement>('.filter-dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
          const id = item.dataset.value ?? '';
          const nickname = item.dataset.nickname ?? '';
          dropdown.dataset.selectedId = id;

          const display = dropdown.querySelector<HTMLElement>('.trade-team-display');
          if (display) {
            const logoHtml = teamLogoImg(nickname, 'team-btn-logo');
            display.innerHTML = `${logoHtml}${nickname}`;
          }

          menu.querySelectorAll('.filter-dropdown-item').forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
          dropdown.classList.remove('open');

          if (teamNum === 1) {
            try { localStorage.setItem('wbl-selected-team', nickname); } catch { /* ignore */ }
            analyticsService.trackTeamSelected(nickname, 'trade-analyzer');
          }
          this.onTeamChange(teamNum);
        });
      });

      // Restore saved team for Team 1
      if (teamNum === 1) {
        const savedTeam = localStorage.getItem('wbl-selected-team');
        if (savedTeam) {
          const match = mainTeams.find(t => t.nickname === savedTeam);
          if (match) {
            dropdown.dataset.selectedId = match.id.toString();
            const display = dropdown.querySelector<HTMLElement>('.trade-team-display');
            if (display) {
              const logoHtml = teamLogoImg(match.nickname, 'team-btn-logo');
              display.innerHTML = `${logoHtml}${match.nickname}`;
            }
            menu.querySelector<HTMLElement>(`.filter-dropdown-item[data-value="${match.id}"]`)?.classList.add('selected');
            this.onTeamChange(1);
          }
        }
      }
    });
  }

  private setupEventHandlers(): void {
    // Level select handlers
    this.container.querySelectorAll('.trade-level-select').forEach(select => {
      select.addEventListener('change', () => {
        const teamNum = parseInt((select as HTMLSelectElement).dataset.team!) as 1 | 2;
        this.onLevelChange(teamNum);
      });
    });

    // Player type toggle handlers
    this.container.querySelectorAll('.trade-player-type-toggle .toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const teamNum = parseInt((btn as HTMLElement).dataset.team!) as 1 | 2;
        const playerType = (btn as HTMLElement).dataset.playerType;
        this.onPlayerTypeChange(teamNum, playerType === 'pitchers');
      });
    });

    // Clear buttons
    this.container.querySelectorAll('.clear-trade-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const teamNum = parseInt((btn as HTMLElement).dataset.team!) as 1 | 2;
        this.clearTeamTrade(teamNum);
      });
    });

    // Trade team dropdown open/close
    this.container.querySelectorAll('.trade-team-dropdown-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dropdown = btn.closest('.trade-team-dropdown');
        this.container.querySelectorAll('.trade-team-dropdown').forEach(d => {
          if (d !== dropdown) d.classList.remove('open');
        });
        dropdown?.classList.toggle('open');
      });
    });

    document.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.trade-team-dropdown')) {
        this.container.querySelectorAll('.trade-team-dropdown').forEach(d => d.classList.remove('open'));
      }
    });

    // Middle column as drop target
    const middleColumn = this.container.querySelector<HTMLElement>('.trade-column-middle');
    if (middleColumn) {
      middleColumn.addEventListener('dragover', (e) => {
        e.preventDefault();
        (e as DragEvent).dataTransfer!.dropEffect = 'move';
        middleColumn.classList.add('drag-over');
      });

      middleColumn.addEventListener('dragleave', (e) => {
        // Only remove if leaving the middle column itself, not entering a child
        if (!middleColumn.contains(e.relatedTarget as Node)) {
          middleColumn.classList.remove('drag-over');
        }
      });

      middleColumn.addEventListener('drop', (e) => {
        e.preventDefault();
        middleColumn.classList.remove('drag-over');
        const dataTransfer = (e as DragEvent).dataTransfer;
        if (!dataTransfer) return;

        const playerId = parseInt(dataTransfer.getData('playerId'));
        const sourceTeam = parseInt(dataTransfer.getData('sourceTeam')) as 1 | 2;
        this.addPlayerToTrade(sourceTeam, playerId);
      });
    }
  }

  private onPlayerTypeChange(teamNum: 1 | 2, showPitchers: boolean): void {
    const state = teamNum === 1 ? this.team1State : this.team2State;
    state.showingPitchers = showPitchers;

    // Update toggle button states
    const toggleContainer = this.container.querySelector(`.trade-player-type-toggle[data-team="${teamNum}"]`);
    if (toggleContainer) {
      toggleContainer.querySelectorAll('.toggle-btn').forEach(btn => {
        const isPitchers = (btn as HTMLElement).dataset.playerType === 'pitchers';
        btn.classList.toggle('active', isPitchers === showPitchers);
      });
    }

    this.updatePlayerList(teamNum);
  }

  private onSortChange(teamNum: 1 | 2, sortKey: 'name' | 'position' | 'rating'): void {
    const state = teamNum === 1 ? this.team1State : this.team2State;
    if (state.sortKey === sortKey) {
      // Toggle direction when clicking the same column
      state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortKey = sortKey;
      state.sortDirection = sortKey === 'rating' ? 'desc' : 'asc';
    }
    this.updatePlayerList(teamNum);
  }

  private async onTeamChange(teamNum: 1 | 2): Promise<void> {
    const dropdown = this.container.querySelector<HTMLElement>(`.trade-team-dropdown[data-team="${teamNum}"]`);
    if (!dropdown) return;

    const teamId = parseInt(dropdown.dataset.selectedId ?? '');
    const state = teamNum === 1 ? this.team1State : this.team2State;
    state.teamId = teamId;
    state.tradingPlayers = [];
    state.tradingBatters = [];
    state.tradingPicks = [];

    // Show skeleton placeholder while data loads
    if (teamId > 0) {
      this.showPlayerListSkeleton(teamNum);
    }

    // Load players lazily for this team (projections computed on-demand when added to trade)
    if (teamId > 0 && !this.teamPlayers.has(teamId)) {
      try {
        const teamPlayerList = await playerService.getPlayersByOrgId(teamId);
        this.teamPlayers.set(teamId, teamPlayerList);
      } catch (e) {
        console.warn('Failed to load players for team:', e);
      }
    }

    this.updatePlayerList(teamNum);
    this.updateAnalysis();
  }

  private showPlayerListSkeleton(teamNum: 1 | 2): void {
    const listContainer = this.container.querySelector<HTMLElement>(`.trade-player-list[data-team="${teamNum}"]`);
    if (!listContainer) return;
    const rows = Array.from({ length: 12 }, () =>
      `<div class="trade-player-item trade-skeleton-row loading-skeleton">
        <div class="player-position"><span class="skeleton-line xs"></span></div>
        <div class="player-name"><span class="skeleton-line sm"></span></div>
        <div class="player-rating"><span class="skeleton-line xs"></span></div>
      </div>`
    ).join('');
    listContainer.innerHTML = rows;
  }

  private onLevelChange(teamNum: 1 | 2): void {
    const select = this.container.querySelector<HTMLSelectElement>(`.trade-level-select[data-team="${teamNum}"]`);
    if (!select) return;

    const state = teamNum === 1 ? this.team1State : this.team2State;
    state.minorLevel = select.value;

    // Toggle visibility of player type toggle based on level
    const isDraftPicks = state.minorLevel === 'draft';
    const toggleContainer = this.container.querySelector(`.trade-player-type-toggle[data-team="${teamNum}"]`) as HTMLElement;

    if (toggleContainer) {
      toggleContainer.style.display = isDraftPicks ? 'none' : 'flex';
    }

    this.updatePlayerList(teamNum);
  }

  private getPlayersByTeamAndLevel(teamId: number, level: string, showPitchers: boolean): Player[] {
    if (teamId === 0) return [];

    const teamPlayerList = this.teamPlayers.get(teamId) ?? [];

    let filtered = teamPlayerList.filter(p => {
      // Guard: level may be string from PostgREST — coerce to number
      const lv = typeof p.level === 'string' ? parseInt(p.level as any, 10) : (p.level ?? 0);
      if (level === 'mlb') {
        return (p.teamId === teamId) && lv === 1;
      } else if (level === 'all-prospects') {
        return (lv >= 2 && lv <= 5) || lv === 6;
      } else if (level === 'ic') {
        return lv === 6;
      } else if (level === 'aaa') {
        return lv === 2;
      } else if (level === 'aa') {
        return lv === 3;
      } else if (level === 'a') {
        return lv === 4;
      } else if (level === 'r') {
        return lv === 5;
      }
      return false;
    });

    return filtered.filter(p => showPitchers ? isPitcher(p) : !isPitcher(p));
  }

  private sortPlayers(players: Player[], sortKey: 'name' | 'position' | 'rating', sortDirection: 'asc' | 'desc', showPitchers: boolean): Player[] {
    const sorted = [...players];
    const multiplier = sortDirection === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
      let comparison = 0;

      switch (sortKey) {
        case 'name':
          comparison = a.lastName.localeCompare(b.lastName);
          break;
        case 'position':
          comparison = a.position - b.position;
          break;
        case 'rating':
          // Get ratings for comparison
          const ratingA = this.getPlayerRating(a, showPitchers);
          const ratingB = this.getPlayerRating(b, showPitchers);
          comparison = ratingA - ratingB;
          break;
      }

      return comparison * multiplier;
    });

    return sorted;
  }

  private getPlayerRating(player: Player, isPitcherPlayer: boolean): number {
    if (isPitcherPlayer) {
      // Canonical TR for MLB players (same source as profile modal)
      const canonicalTR = this.canonicalPitcherTR.get(player.id);
      if (canonicalTR) {
        return canonicalTR.trueRating;
      }
      // Canonical TFR for prospects (precomputed, same source as profile modal)
      const prospect = this.pitcherProspectMap.get(player.id);
      if (prospect) {
        return prospect.trueFutureRating;
      }
      // Fallback: projection data
      const projection = this.allProjections.get(player.id);
      if (projection?.currentTrueRating) {
        return projection.currentTrueRating;
      }
    } else {
      // Canonical TR for MLB batters (same source as profile modal)
      const canonicalTR = this.canonicalBatterTR.get(player.id);
      if (canonicalTR) {
        return canonicalTR.trueRating;
      }
      // Canonical TFR for prospects (precomputed, same source as profile modal)
      const prospect = this.hitterProspectMap.get(player.id);
      if (prospect) {
        return prospect.trueFutureRating;
      }
      // Fallback: projection data
      const projection = this.allBatterProjections.get(player.id);
      if (projection?.currentTrueRating) {
        return projection.currentTrueRating;
      }
    }
    return 0;
  }

  private getTrueRatingClass(value: number): string {
    if (value >= 4.5) return 'rating-elite';
    if (value >= 4.0) return 'rating-plus';
    if (value >= 3.0) return 'rating-avg';
    if (value >= 2.0) return 'rating-fringe';
    return 'rating-poor';
  }

  private buildPitcherFallbackFromCanonical(player: Player): ProjectedPlayer | undefined {
    console.warn(`[TradeAnalyzer] Player ${player.id} ${getFullName(player)} missing from pitcher_projections cache — using fallback computation`);
    const tr = this.canonicalPitcherTR.get(player.id);
    const prospect = this.pitcherProspectMap.get(player.id);
    if (!tr && !prospect) return undefined;

    const team = this.allTeams.find(t => t.id === player.teamId);
    const teamName = team?.nickname ?? 'Unknown';
    const currentRating = tr?.trueRating ?? prospect?.trueFutureRating ?? 0.5;
    const projectedTrue = prospect?.trueFutureRating ?? currentRating;

    // Build profile data and apply canonical TR/TFR
    const data: PitcherProfileData = {
      playerId: player.id,
      playerName: getFullName(player),
      team: teamName,
      parentTeam: teamName,
      age: player.age,
      position: player.position,
      positionLabel: getPositionLabel(player.position),
    };
    resolveCanonicalPitcherData(data, tr, prospect);

    // Compute projection through canonical pipeline
    const proj = computePitcherProjection(data, [], {
      projectionMode: 'current',
      scoutingData: null,
      projectedIp: null,
      estimateIp: (stamina, injury) => {
        let baseIp: number;
        if (stamina >= 65) baseIp = 180 + (stamina - 65) * 1.5;
        else if (stamina >= 50) baseIp = 120 + (stamina - 50) * 4;
        else if (stamina >= 35) baseIp = 65 + (stamina - 35) * 3.67;
        else baseIp = 40 + (stamina - 20) * 1.67;
        const mult: Record<string, number> = { 'Iron Man': 1.15, Durable: 1.10, Normal: 1.0, Fragile: 0.90, Wrecked: 0.75 };
        return Math.round(baseIp * (mult[injury ?? 'Normal'] ?? 0.95));
      },
      calculateWar: (fip, ip) => fipWarService.calculateWar(fip, ip),
    });

    const role = tr?.role;
    const isSp = role ? role !== 'RP' : proj.projIp >= 100;

    return {
      playerId: player.id,
      name: getFullName(player),
      teamId: player.teamId,
      teamName,
      position: player.position,
      age: player.age,
      currentTrueRating: currentRating,
      currentPercentile: tr?.percentile,
      projectedTrueRating: projectedTrue,
      projectedStats: {
        k9: proj.projK9,
        bb9: proj.projBb9,
        hr9: proj.projHr9,
        fip: proj.projFip,
        war: proj.projWar,
        ip: proj.projIp,
      },
      projectedRatings: {
        stuff: proj.ratings.stuff,
        control: proj.ratings.control,
        hra: proj.ratings.hra,
      },
      isSp,
      fipLike: tr?.fipLike,
      isProspect: data.isProspect === true,
    };
  }

  private buildBatterFallbackFromCanonical(player: Player): ProjectedBatter | undefined {
    console.warn(`[TradeAnalyzer] Player ${player.id} ${getFullName(player)} missing from batter_projections cache — using fallback computation`);
    const tr = this.canonicalBatterTR.get(player.id);
    const prospect = this.hitterProspectMap.get(player.id);
    if (!tr && !prospect) return undefined;

    const team = this.allTeams.find(t => t.id === player.teamId);
    const teamName = team?.nickname ?? 'Unknown';
    const currentRating = tr?.trueRating ?? prospect?.trueFutureRating ?? 0.5;

    // Build profile data and apply canonical TR/TFR
    const data: BatterProfileData = {
      playerId: player.id,
      playerName: getFullName(player),
      team: teamName,
      parentTeam: teamName,
      age: player.age,
      position: player.position,
      positionLabel: getPositionLabel(player.position),
    };
    resolveCanonicalBatterData(data, tr, prospect);

    // Compute projection through canonical pipeline
    const computeWoba = (bbRate: number, avg: number, d: number, t: number, hr: number) => {
      const abRate = 1 - bbRate;
      const singlesPerAb = Math.max(0, avg - d - t - hr);
      return 0.69 * bbRate + abRate * (0.89 * singlesPerAb + 1.27 * d + 1.62 * t + 2.10 * hr);
    };

    const proj = computeBatterProjection(data, [], {
      projectionMode: 'current',
      projectionYear: this.currentYear,
      leagueAvg: null,
      scoutingData: null,
      expectedBbPct: (eye) => HitterRatingEstimatorService.expectedBbPct(eye),
      expectedKPct: (avoidK) => HitterRatingEstimatorService.expectedKPct(avoidK),
      expectedAvg: (contact) => HitterRatingEstimatorService.expectedAvg(contact),
      expectedHrPct: (power) => HitterRatingEstimatorService.expectedHrPct(power),
      expectedDoublesRate: (gap) => HitterRatingEstimatorService.expectedDoublesRate(gap),
      expectedTriplesRate: (speed) => HitterRatingEstimatorService.expectedTriplesRate(speed),
      getProjectedPa: (injury, age) => leagueBattingAveragesService.getProjectedPa(injury, age),
      getProjectedPaWithHistory: (history, age, injury) => leagueBattingAveragesService.getProjectedPaWithHistory(history, age, injury),
      calculateOpsPlus: (obp, slg, lg) => leagueBattingAveragesService.calculateOpsPlus(obp, slg, lg),
      computeWoba,
      calculateBaserunningRuns: (sb, cs) => leagueBattingAveragesService.calculateBaserunningRuns(sb, cs),
      calculateBattingWar: (woba, pa, lg, sbRuns) => leagueBattingAveragesService.calculateBattingWar(woba, pa, lg, sbRuns),
      projectStolenBases: (sr, ste, pa) => HitterRatingEstimatorService.projectStolenBases(sr, ste, pa),
      applyAgingToRates: (rates, a) => HitterRatingEstimatorService.applyAgingToBlendedRates(rates, hitterAgingService.getAgingModifiers(a)),
    });

    return {
      playerId: player.id,
      name: getFullName(player),
      teamId: player.teamId,
      teamName,
      position: player.position,
      positionLabel: getPositionLabel(player.position),
      age: player.age,
      currentTrueRating: currentRating,
      percentile: tr?.percentile ?? prospect?.percentile ?? 0,
      projectedStats: {
        woba: proj.projWoba,
        avg: proj.projAvg,
        obp: proj.projObp,
        slg: proj.projSlg,
        ops: proj.projOps,
        wrcPlus: proj.projOpsPlus,
        war: proj.projWar,
        pa: proj.projPa,
        hr: proj.projHr,
        rbi: Math.round(proj.projPa * 0.12),
        sb: proj.projSb,
        hrPct: proj.projHrPct,
        bbPct: proj.projBbPct,
        kPct: proj.projKPct,
      },
      estimatedRatings: {
        power: proj.ratings.power,
        eye: proj.ratings.eye,
        avoidK: proj.ratings.avoidK,
        contact: proj.ratings.contact,
      },
      isProspect: data.isProspect === true,
    } as ProjectedBatter;
  }

  private updatePlayerList(teamNum: 1 | 2): void {
    const state = teamNum === 1 ? this.team1State : this.team2State;
    const listContainer = this.container.querySelector<HTMLElement>(`.trade-player-list[data-team="${teamNum}"]`);
    if (!listContainer) return;

    // Handle draft picks view
    if (state.minorLevel === 'draft') {
      this.renderDraftPicksList(teamNum, listContainer);
      return;
    }

    const players = this.getPlayersByTeamAndLevel(state.teamId, state.minorLevel, state.showingPitchers);
    const sortedPlayers = this.sortPlayers(players, state.sortKey, state.sortDirection, state.showingPitchers);
    const playerTypeLabel = state.showingPitchers ? 'pitchers' : 'batters';
    console.log(`Team ${teamNum}: Found ${sortedPlayers.length} ${playerTypeLabel} for teamId=${state.teamId}, level=${state.minorLevel}`);

    if (sortedPlayers.length === 0) {
      listContainer.innerHTML = `<div class="empty-text">No ${playerTypeLabel} found at this level</div>`;
      return;
    }

    const sortIndicator = (key: string) => state.sortKey === key ? (state.sortDirection === 'asc' ? ' ▴' : ' ▾') : '';

    const headerHtml = `
      <div class="trade-list-header" data-team="${teamNum}">
        <span class="trade-header-col trade-header-pos" data-sort="position" data-team="${teamNum}">Pos${sortIndicator('position')}</span>
        <span class="trade-header-col trade-header-name" data-sort="name" data-team="${teamNum}">Name${sortIndicator('name')}</span>
        <span class="trade-header-col trade-header-rating" data-sort="rating" data-team="${teamNum}">Rating${sortIndicator('rating')}</span>
      </div>
    `;

    listContainer.innerHTML = headerHtml + sortedPlayers.map((player) => {
      let trueRating = 0;
      let ratingSource = 'projection';

      if (state.showingPitchers) {
        // Pitcher rating: canonical TR > canonical TFR > projection fallback
        const canonicalTR = this.canonicalPitcherTR.get(player.id);
        if (canonicalTR) {
          trueRating = canonicalTR.trueRating;
          ratingSource = 'tr';
        } else {
          const prospect = this.pitcherProspectMap.get(player.id);
          if (prospect) {
            trueRating = prospect.trueFutureRating;
            ratingSource = 'tfr';
          } else {
            const projection = this.allProjections.get(player.id);
            if (projection?.currentTrueRating) {
              trueRating = projection.currentTrueRating;
            }
          }
        }
      } else {
        // Batter rating: canonical TR > canonical TFR > projection fallback
        const canonicalTR = this.canonicalBatterTR.get(player.id);
        if (canonicalTR) {
          trueRating = canonicalTR.trueRating;
          ratingSource = 'tr';
        } else {
          const prospect = this.hitterProspectMap.get(player.id);
          if (prospect) {
            trueRating = prospect.trueFutureRating;
            ratingSource = 'tfr';
          } else {
            const projection = this.allBatterProjections.get(player.id);
            if (projection?.currentTrueRating) {
              trueRating = projection.currentTrueRating;
            }
          }
        }
      }

      // Last resort: estimate from projected WAR → approximate star rating
      if (trueRating <= 0) {
        const pitcherProj = this.allProjections.get(player.id);
        const batterProj = this.allBatterProjections.get(player.id);
        const projWar = pitcherProj?.projectedStats?.war ?? (batterProj as any)?.projectedStats?.war ?? 0;
        if (projWar > 0) {
          // Rough WAR→stars: 0.5-star increments, capped at 5
          trueRating = Math.min(5, Math.max(0.5, Math.round(projWar * 2) / 2));
          ratingSource = 'projection';
        }
      }

      const hasRating = trueRating > 0;
      const rating = hasRating ? trueRating.toFixed(1) : '—';
      const ratingClass = hasRating ? this.getTrueRatingClass(trueRating) : '';
      const tfrBadgeClass = ratingSource === 'tfr' ? 'tfr-badge' : '';

      return `
        <div class="trade-player-item" draggable="true" data-player-id="${player.id}" data-team="${teamNum}" data-is-pitcher="${state.showingPitchers}">
          <div class="player-position">${getPositionLabel(player.position)}</div>
          <div class="player-name player-name-link" data-player-id="${player.id}">${getFullName(player)}</div>
          <div class="player-rating">
            ${hasRating
              ? `<span class="badge ${ratingClass} ${tfrBadgeClass}">${rating}</span>`
              : 'N/A'}
          </div>
        </div>
      `;
    }).join('');

    // Setup drag handlers
    this.setupDragHandlers(teamNum);
  }

  private renderDraftPicksList(teamNum: 1 | 2, container: HTMLElement): void {
    const rounds = [
      { round: 1, label: '1st Round', value: 3.0 },
      { round: 2, label: '2nd Round', value: 1.5 },
      { round: 3, label: '3rd Round', value: 0.8 },
      { round: 4, label: '4th Round', value: 0.4 },
      { round: 5, label: '5th Round', value: 0.2 },
    ];

    container.innerHTML = `
      <div class="draft-picks-list">
        ${rounds.map(r => `
          <div class="trade-pick-item" data-round="${r.round}" data-team="${teamNum}">
            <div class="pick-info">
              <span class="pick-label">${r.label}</span>
              <span class="pick-value">${r.value.toFixed(1)} WAR</span>
            </div>
            <div class="pick-position-group">
              <input type="number" class="pick-position-field" min="1" max="30" placeholder="#" title="Pick position (1-30)">
              <button class="add-pick-btn" data-round="${r.round}" data-team="${teamNum}">+</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    this.setupDraftPickHandlers(teamNum, container);
  }

  private setupDraftPickHandlers(teamNum: 1 | 2, container: HTMLElement): void {
    container.querySelectorAll('.add-pick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const round = parseInt((btn as HTMLElement).dataset.round!);
        const pickItem = btn.closest('.trade-pick-item');
        const positionInput = pickItem?.querySelector('.pick-position-field') as HTMLInputElement;
        const position = positionInput?.value ? parseInt(positionInput.value) : undefined;

        this.addDraftPickToTrade(teamNum, round, position);

        // Clear the input
        if (positionInput) positionInput.value = '';
      });
    });
  }

  private addDraftPickToTrade(teamNum: 1 | 2, round: number, position?: number): void {
    const state = teamNum === 1 ? this.team1State : this.team2State;

    // Generate unique ID
    const id = `pick-${teamNum}-${round}-${position ?? 'general'}-${Date.now()}`;

    // Calculate estimated WAR value
    let estimatedValue: number;
    const roundLabels = ['', '1st', '2nd', '3rd', '4th', '5th'];

    switch (round) {
      case 1:
        // Adjust by position: top 5 = 4.0, 6-10 = 3.5, 11-20 = 3.0, 21-30 = 2.0
        if (position) {
          if (position <= 5) estimatedValue = 4.0;
          else if (position <= 10) estimatedValue = 3.5;
          else if (position <= 20) estimatedValue = 3.0;
          else estimatedValue = 2.0;
        } else {
          estimatedValue = 3.0; // Default for unspecified
        }
        break;
      case 2:
        estimatedValue = 1.5;
        break;
      case 3:
        estimatedValue = 0.8;
        break;
      case 4:
        estimatedValue = 0.4;
        break;
      case 5:
        estimatedValue = 0.2;
        break;
      default:
        estimatedValue = 0.1;
    }

    const displayName = position
      ? `${roundLabels[round]} Round Pick #${position}`
      : `${roundLabels[round]} Round Pick`;

    const pick: DraftPick = {
      id,
      round,
      pickPosition: position,
      displayName,
      estimatedValue,
    };

    state.tradingPicks.push(pick);
    this.updateAnalysis();
  }

  private setupDragHandlers(teamNum: 1 | 2): void {
    const listContainer = this.container.querySelector<HTMLElement>(`.trade-player-list[data-team="${teamNum}"]`);
    if (!listContainer) return;

    // Sort header click handlers
    listContainer.querySelectorAll('.trade-header-col').forEach(col => {
      col.addEventListener('click', () => {
        const sortKey = (col as HTMLElement).dataset.sort as 'name' | 'position' | 'rating';
        this.onSortChange(teamNum, sortKey);
      });
    });

    listContainer.querySelectorAll('.trade-player-item').forEach(item => {
      item.addEventListener('dragstart', (e) => {
        const playerId = (item as HTMLElement).dataset.playerId;
        const dataTransfer = (e as DragEvent).dataTransfer;
        if (dataTransfer) {
          dataTransfer.effectAllowed = 'move';
          dataTransfer.setData('playerId', playerId || '');
          dataTransfer.setData('sourceTeam', teamNum.toString());
        }
      });

      // Click on player name opens profile modal
      const playerNameLink = item.querySelector('.player-name-link');
      if (playerNameLink) {
        playerNameLink.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent triggering the item click
          const playerId = parseInt((playerNameLink as HTMLElement).dataset.playerId!);
          this.openPlayerProfile(playerId);
        });
      }

      // Click anywhere else on item adds to trade
      item.addEventListener('click', (e) => {
        // Only add to trade if not clicking on player name
        if (!(e.target as HTMLElement).classList.contains('player-name-link')) {
          this.addPlayerToTrade(teamNum, parseInt((item as HTMLElement).dataset.playerId!));
        }
      });
    });
  }

  private addPlayerToTrade(teamNum: 1 | 2, playerId: number): void {
    const state = teamNum === 1 ? this.team1State : this.team2State;
    const player = this.findPlayer(playerId);
    if (!player) {
      console.warn(`Player ${playerId} not found`);
      return;
    }

    const playerIsPitcher = isPitcher(player);

    if (playerIsPitcher) {
      if (state.tradingPlayers.find(p => p.playerId === playerId)) return;
      let projection = this.allProjections.get(playerId);
      if (!projection) {
        projection = this.buildPitcherFallbackFromCanonical(player);
      }
      if (!projection) {
        console.warn(`No canonical pitcher snapshot available for player ${playerId}`);
        return;
      }

      state.tradingPlayers.push(projection);
    } else {
      if (state.tradingBatters.find(p => p.playerId === playerId)) return;
      let batterProjection = this.allBatterProjections.get(playerId);
      if (!batterProjection) {
        batterProjection = this.buildBatterFallbackFromCanonical(player);
      }
      if (!batterProjection) {
        console.warn(`No canonical batter snapshot available for player ${playerId}`);
        return;
      }

      state.tradingBatters.push(batterProjection);
    }

    this.updateAnalysis();
  }

  private clearTeamTrade(teamNum: 1 | 2): void {
    const state = teamNum === 1 ? this.team1State : this.team2State;
    state.tradingPlayers = [];
    state.tradingBatters = [];
    state.tradingPicks = [];
    this.updateAnalysis();
  }

  private async ensureTradeAnalysisData(): Promise<void> {
    const promises: Promise<void>[] = [];
    if (!this.powerRankingsLoaded) {
      promises.push(
        teamRatingsService.getPowerRankings(this.currentYear)
          .then(rankings => {
            rankings.forEach(r => this.powerRankingsMap.set(r.teamId, r));
            this.powerRankingsLoaded = true;
          })
          .catch(e => { console.warn('Failed to load power rankings:', e); this.powerRankingsLoaded = true; })
      );
    }
    if (!this.contractsLoaded) {
      // Use precomputed contract_lookup (1 request) instead of getAllContracts (7 paginated requests)
      promises.push(
        supabaseDataService.getPrecomputed('contract_lookup')
          .then(data => {
            if (data) {
              for (const [pid, entry] of Object.entries(data)) {
                const [salary, leagueId, yearsRemaining] = entry as [number, number, number];
                this.allContracts.set(parseInt(pid, 10), {
                  playerId: parseInt(pid, 10), teamId: 0, leagueId, isMajor: leagueId === 200,
                  seasonYear: 0, years: yearsRemaining, currentYear: 0,
                  salaries: [salary], noTrade: false,
                  lastYearTeamOption: false, lastYearPlayerOption: false, lastYearVestingOption: false,
                } as Contract);
              }
            }
            this.contractsLoaded = true;
          })
          .catch(e => { console.warn('Failed to load contracts:', e); this.contractsLoaded = true; })
      );
    }
    if (!this.parkFactorsLoaded) {
      promises.push(
        supabaseDataService.getPrecomputed('park_factors')
          .then(data => {
            if (data) {
              for (const [k, v] of Object.entries(data)) {
                this.parkFactorsMap.set(parseInt(k, 10), v as ParkFactorRow);
              }
            }
            this.parkFactorsLoaded = true;
          })
          .catch(e => { console.warn('Failed to load park factors:', e); this.parkFactorsLoaded = true; })
      );
    }
    if (promises.length > 0) await Promise.all(promises);
  }

  private updateAnalysis(): void {
    const contentDiv = this.container.querySelector<HTMLElement>('.trade-analysis-content');
    if (!contentDiv) return;

    const team1HasAssets = this.team1State.tradingPlayers.length > 0 ||
      this.team1State.tradingBatters.length > 0 ||
      this.team1State.tradingPicks.length > 0;
    const team2HasAssets = this.team2State.tradingPlayers.length > 0 ||
      this.team2State.tradingBatters.length > 0 ||
      this.team2State.tradingPicks.length > 0;

    if (!team1HasAssets && !team2HasAssets) {
      contentDiv.innerHTML = `
        <div class="analysis-placeholder">
          <p>Select players from both teams to analyze trade impact</p>
        </div>
      `;
      return;
    }

    // Kick off lazy-load of power rankings + contracts; re-render when ready
    if (!this.powerRankingsLoaded || !this.contractsLoaded) {
      this.ensureTradeAnalysisData().then(() => this.updateAnalysis());
    }

    const analysis = this.calculateTradeAnalysis();

    const team1 = this.allTeams.find(t => t.id === this.team1State.teamId);
    const team2 = this.allTeams.find(t => t.id === this.team2State.teamId);

    const team1Name = team1?.nickname ?? 'Team 1';
    const team2Name = team2?.nickname ?? 'Team 2';

    const teamImpactHtml = this.renderTeamImpact(team1Name, team2Name);

    contentDiv.innerHTML = `
      <div class="analysis-war-comparison">
        <div class="war-column war-column-1">
          <h5>${team1Name}</h5>
          ${analysis.team1CurrentWar > 0 ? `
            <div class="war-comparison-row">
              <span class="war-type-label">Now</span>
              <span class="war-change-inline ${analysis.team1CurrentWar >= analysis.team2CurrentWar ? 'positive' : ''}">${analysis.team1CurrentWar.toFixed(1)} WAR</span>
            </div>
          ` : ''}
          ${analysis.team1FutureWar > 0 ? `
            <div class="war-comparison-row">
              <span class="war-type-label">Future</span>
              <span class="war-change-inline ${analysis.team1FutureWar >= analysis.team2FutureWar ? 'positive' : ''}">${analysis.team1FutureWar.toFixed(1)} WAR <span class="war-peak-label">(peak)</span></span>
            </div>
          ` : ''}
          <div class="war-comparison-row war-total-row">
            <span class="war-type-label">Total</span>
            <span class="war-change-inline ${analysis.team1Gain ? 'positive' : ''}">${analysis.team1WarChange.toFixed(1)} WAR</span>
          </div>
          <div class="war-detail">
            ${this.renderWarDetail(this.team1State, 1, this.team2State.teamId || undefined)}
          </div>
        </div>

        <div class="war-column war-column-2">
          <h5>${team2Name}</h5>
          ${analysis.team2CurrentWar > 0 ? `
            <div class="war-comparison-row">
              <span class="war-type-label">Now</span>
              <span class="war-change-inline ${analysis.team2CurrentWar >= analysis.team1CurrentWar ? 'positive' : ''}">${analysis.team2CurrentWar.toFixed(1)} WAR</span>
            </div>
          ` : ''}
          ${analysis.team2FutureWar > 0 ? `
            <div class="war-comparison-row">
              <span class="war-type-label">Future</span>
              <span class="war-change-inline ${analysis.team2FutureWar >= analysis.team1FutureWar ? 'positive' : ''}">${analysis.team2FutureWar.toFixed(1)} WAR <span class="war-peak-label">(peak)</span></span>
            </div>
          ` : ''}
          <div class="war-comparison-row war-total-row">
            <span class="war-type-label">Total</span>
            <span class="war-change-inline ${analysis.team2Gain ? 'positive' : ''}">${analysis.team2WarChange.toFixed(1)} WAR</span>
          </div>
          <div class="war-detail">
            ${this.renderWarDetail(this.team2State, 2, this.team1State.teamId || undefined)}
          </div>
        </div>
      </div>

      ${teamImpactHtml}

      <div class="trade-ratings-comparison">
        <h5>Player Comparison</h5>
        ${this.renderRatingsTable()}
      </div>

      <div class="ai-trade-analysis-section">
        <button class="btn ai-trade-btn">Get AI Analysis</button>
        <div class="ai-trade-result"></div>
      </div>
    `;

    // Setup AI analysis button handler
    const aiBtn = contentDiv.querySelector('.ai-trade-btn');
    if (aiBtn) {
      aiBtn.addEventListener('click', () => this.requestAIAnalysis());
    }

    // Clickable player names in analysis panel
    contentDiv.querySelectorAll('.player-name-link').forEach(link => {
      link.addEventListener('click', () => {
        const playerId = parseInt((link as HTMLElement).dataset.playerId!);
        this.openPlayerProfile(playerId);
      });
    });

    // Remove buttons in war detail
    contentDiv.querySelectorAll('.war-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const teamNum = parseInt((btn as HTMLElement).dataset.team!) as 1 | 2;
        const type = (btn as HTMLElement).dataset.type;
        const state = teamNum === 1 ? this.team1State : this.team2State;

        if (type === 'pitcher') {
          const playerId = parseInt((btn as HTMLElement).dataset.playerId!);
          state.tradingPlayers = state.tradingPlayers.filter(p => p.playerId !== playerId);
        } else if (type === 'batter') {
          const playerId = parseInt((btn as HTMLElement).dataset.playerId!);
          state.tradingBatters = state.tradingBatters.filter(p => p.playerId !== playerId);
        } else if (type === 'pick') {
          const pickId = (btn as HTMLElement).dataset.pickId!;
          state.tradingPicks = state.tradingPicks.filter(p => p.id !== pickId);
        }
        this.updateAnalysis();
      });
    });

    // Impact tab toggle handlers
    contentDiv.querySelectorAll('.impact-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = (btn as HTMLElement).dataset.tab!;
        const section = btn.closest('.team-impact-section');
        if (!section) return;

        section.querySelectorAll('.impact-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        section.querySelectorAll<HTMLElement>('.impact-tab-content').forEach(content => {
          content.style.display = content.dataset.tab === tab ? '' : 'none';
        });
      });
    });
  }

  private renderWarDetail(state: TradeTeamState, teamNum: 1 | 2, destTeamId?: number): string {
    const items: string[] = [];

    // Pitchers
    state.tradingPlayers.forEach(p => {
      const badge = this.isProspectPitcher(p)
        ? '<span class="asset-type-badge badge-prospect">Prospect</span>'
        : '<span class="asset-type-badge badge-mlb">MLB</span>';
      const parkDelta = destTeamId ? this.computePitcherParkWarDelta(p, destTeamId) : undefined;
      const deltaHtml = parkDelta ? this.formatWarParkDelta(p.projectedStats.war, parkDelta.delta) : '';
      items.push(`
        <div class="player-war-item">
          ${badge}
          <span class="war-player-name player-name-link" data-player-id="${p.playerId}">${p.name}</span>
          <span class="war-value">${p.projectedStats.war.toFixed(1)} WAR${deltaHtml}</span>
          <button class="war-remove-btn" data-player-id="${p.playerId}" data-team="${teamNum}" data-type="pitcher" title="Remove">×</button>
        </div>
      `);
    });

    // Batters
    state.tradingBatters.forEach(b => {
      const badge = this.isProspectBatter(b)
        ? '<span class="asset-type-badge badge-prospect">Prospect</span>'
        : '<span class="asset-type-badge badge-mlb">MLB</span>';
      const parkDelta = destTeamId ? this.computeBatterParkWarDelta(b, destTeamId) : undefined;
      const deltaHtml = parkDelta ? this.formatWarParkDelta(b.projectedStats.war, parkDelta.delta) : '';
      items.push(`
        <div class="player-war-item">
          ${badge}
          <span class="war-player-name player-name-link" data-player-id="${b.playerId}">${b.name}</span>
          <span class="war-value">${b.projectedStats.war.toFixed(1)} WAR${deltaHtml}</span>
          <button class="war-remove-btn" data-player-id="${b.playerId}" data-team="${teamNum}" data-type="batter" title="Remove">×</button>
        </div>
      `);
    });

    // Draft picks
    state.tradingPicks.forEach(pick => {
      items.push(`
        <div class="player-war-item">
          <span class="asset-type-badge badge-pick">Pick</span>
          <span>${pick.displayName}</span>
          <span class="war-value">${pick.estimatedValue.toFixed(1)} WAR</span>
          <button class="war-remove-btn" data-pick-id="${pick.id}" data-team="${teamNum}" data-type="pick" title="Remove">×</button>
        </div>
      `);
    });

    if (items.length === 0) {
      return '<p class="empty-text">No assets selected</p>';
    }

    return `<div class="player-war-list">${items.join('')}</div>`;
  }

  private renderRatingsTable(): string {
    // Tag each player with their destination team for park-adjusted WAR
    const team1Pitchers = this.team1State.tradingPlayers.map(p => ({ p, destTeamId: this.team2State.teamId || undefined }));
    const team2Pitchers = this.team2State.tradingPlayers.map(p => ({ p, destTeamId: this.team1State.teamId || undefined }));
    const allPitchers = [...team1Pitchers, ...team2Pitchers];

    const team1Batters = this.team1State.tradingBatters.map(b => ({ b, destTeamId: this.team2State.teamId || undefined }));
    const team2Batters = this.team2State.tradingBatters.map(b => ({ b, destTeamId: this.team1State.teamId || undefined }));
    const allBatters = [...team1Batters, ...team2Batters];

    if (allPitchers.length === 0 && allBatters.length === 0) {
      return '<p class="empty-text">Add players to view ratings</p>';
    }

    return `
      <table class="trade-ratings-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>TR</th>
            <th>WAR</th>
            <th title="Pitchers: K/9 · Batters: AVG">Stuff · Contact</th>
            <th title="Pitchers: BB/9 · Batters: BB%">Control · Eye</th>
            <th title="Pitchers: HR/9 · Batters: HR%">HRA · Power</th>
          </tr>
        </thead>
        <tbody>
          ${allPitchers.map(({ p, destTeamId }) => {
            const parkDelta = destTeamId ? this.computePitcherParkWarDelta(p, destTeamId) : undefined;
            const deltaHtml = parkDelta ? this.formatWarParkDelta(p.projectedStats.war, parkDelta.delta) : '';
            return `
            <tr>
              <td><span class="player-name-link" data-player-id="${p.playerId}">${p.name}</span></td>
              <td><span class="badge ${this.getTrueRatingClass(p.currentTrueRating)}">${p.currentTrueRating.toFixed(1)}</span></td>
              <td>${p.projectedStats.war.toFixed(1)}${deltaHtml}</td>
              <td>${p.projectedStats.k9.toFixed(2)}</td>
              <td>${p.projectedStats.bb9.toFixed(2)}</td>
              <td>${p.projectedStats.hr9.toFixed(2)}</td>
            </tr>
          `; }).join('')}
          ${allBatters.map(({ b, destTeamId }) => {
            const parkDelta = destTeamId ? this.computeBatterParkWarDelta(b, destTeamId) : undefined;
            const deltaHtml = parkDelta ? this.formatWarParkDelta(b.projectedStats.war, parkDelta.delta) : '';
            return `
            <tr>
              <td><span class="player-name-link" data-player-id="${b.playerId}">${b.name}</span></td>
              <td><span class="badge ${this.getTrueRatingClass(b.currentTrueRating)}">${b.currentTrueRating.toFixed(1)}</span></td>
              <td>${b.projectedStats.war.toFixed(1)}${deltaHtml}</td>
              <td>${b.projectedStats.avg.toFixed(3)}</td>
              <td>${b.projectedStats.bbPct != null ? b.projectedStats.bbPct.toFixed(1) + '%' : '-'}</td>
              <td>${b.projectedStats.hrPct != null ? b.projectedStats.hrPct.toFixed(1) + '%' : '-'}</td>
            </tr>
          `; }).join('')}
        </tbody>
      </table>
    `;
  }

  private calculateTeamImpact(teamNum: 1 | 2): {
    before: { rotation: number; bullpen: number; lineup: number; bench: number; overall: number };
    after: { rotation: number; bullpen: number; lineup: number; bench: number; overall: number };
    losing: { name: string; slot: string; rating: number }[];
    gaining: { name: string; slot: string; rating: number }[];
  } | null {
    const state = teamNum === 1 ? this.team1State : this.team2State;
    const otherState = teamNum === 1 ? this.team2State : this.team1State;
    const ranking = this.powerRankingsMap.get(state.teamId);

    if (!ranking) return null;

    const before = {
      rotation: ranking.rotationRating,
      bullpen: ranking.bullpenRating,
      lineup: ranking.lineupRating,
      bench: ranking.benchRating,
      overall: ranking.teamRating,
    };

    // Clone rosters
    let rotation = [...ranking.rotation];
    let bullpen = [...ranking.bullpen];
    let lineup = [...ranking.lineup];
    let bench = [...ranking.bench];

    const losing: { name: string; slot: string; rating: number }[] = [];
    const gaining: { name: string; slot: string; rating: number }[] = [];

    // Remove outgoing players
    const outgoingPitcherIds = new Set(state.tradingPlayers.map(p => p.playerId));
    const outgoingBatterIds = new Set(state.tradingBatters.map(b => b.playerId));

    rotation.forEach((p, i) => {
      if (outgoingPitcherIds.has(p.playerId)) {
        losing.push({ name: p.name, slot: `SP${i + 1}`, rating: p.trueRating });
      }
    });
    bullpen.forEach(p => {
      if (outgoingPitcherIds.has(p.playerId)) {
        losing.push({ name: p.name, slot: 'RP', rating: p.trueRating });
      }
    });
    lineup.forEach(b => {
      if (outgoingBatterIds.has(b.playerId)) {
        losing.push({ name: b.name, slot: b.positionLabel, rating: b.trueRating });
      }
    });
    bench.forEach(b => {
      if (outgoingBatterIds.has(b.playerId)) {
        losing.push({ name: b.name, slot: 'Bench', rating: b.trueRating });
      }
    });

    rotation = rotation.filter(p => !outgoingPitcherIds.has(p.playerId));
    bullpen = bullpen.filter(p => !outgoingPitcherIds.has(p.playerId));
    lineup = lineup.filter(b => !outgoingBatterIds.has(b.playerId));
    bench = bench.filter(b => !outgoingBatterIds.has(b.playerId));

    // Add incoming players from the other team
    // Skip prospects (minor leaguers) — they go to the farm system, not the MLB roster
    for (const p of otherState.tradingPlayers) {
      const playerData = this.findPlayer(p.playerId);
      const lv = playerData ? (typeof playerData.level === 'string' ? parseInt(playerData.level as any, 10) : (playerData.level ?? 1)) : 1;
      if (lv > 1) continue; // minor leaguer / IC — no MLB roster impact

      const incoming: RatedPitcher = {
        playerId: p.playerId,
        name: p.name,
        trueRating: p.currentTrueRating,
        trueStuff: p.projectedRatings.stuff,
        trueControl: p.projectedRatings.control,
        trueHra: p.projectedRatings.hra,
        role: p.isSp ? 'SP' : 'RP',
      };
      if (incoming.role === 'SP') {
        if (rotation.length < 5) {
          rotation.push(incoming);
          gaining.push({ name: p.name, slot: `SP${rotation.length}`, rating: p.currentTrueRating });
        } else {
          // Rotation full — replace the worst starter if incoming is better
          const worstIdx = rotation.reduce((min, r, i) => r.trueRating < rotation[min].trueRating ? i : min, 0);
          if (incoming.trueRating > rotation[worstIdx].trueRating) {
            const demoted = rotation[worstIdx];
            rotation[worstIdx] = incoming;
            bullpen.push(demoted);
            rotation.sort((a, b) => b.trueRating - a.trueRating);
            const newIdx = rotation.indexOf(incoming);
            gaining.push({ name: p.name, slot: `SP${newIdx + 1}`, rating: p.currentTrueRating });
          } else {
            bullpen.push(incoming);
            gaining.push({ name: p.name, slot: 'RP', rating: p.currentTrueRating });
          }
        }
      } else {
        bullpen.push(incoming);
        gaining.push({ name: p.name, slot: 'RP', rating: p.currentTrueRating });
      }
    }

    for (const b of otherState.tradingBatters) {
      const playerData = this.findPlayer(b.playerId);
      const lv = playerData ? (typeof playerData.level === 'string' ? parseInt(playerData.level as any, 10) : (playerData.level ?? 1)) : 1;
      if (lv > 1) continue; // minor leaguer / IC — no MLB roster impact

      const posLabels: Record<number, string> = { 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH' };
      const incoming: RatedBatter = {
        playerId: b.playerId,
        name: b.name,
        position: b.position,
        positionLabel: posLabels[b.position] || 'UT',
        trueRating: b.currentTrueRating,
        estimatedPower: b.estimatedRatings.power,
        estimatedEye: b.estimatedRatings.eye,
        estimatedAvoidK: b.estimatedRatings.avoidK,
        estimatedContact: b.estimatedRatings.contact,
      };
      if (lineup.length < 9) {
        lineup.push(incoming);
        gaining.push({ name: b.name, slot: incoming.positionLabel, rating: b.currentTrueRating });
      } else {
        bench.push(incoming);
        gaining.push({ name: b.name, slot: 'Bench', rating: b.currentTrueRating });
      }
    }

    // Sort and trim
    rotation.sort((a, b) => b.trueRating - a.trueRating);
    if (rotation.length > 5) {
      bullpen.push(...rotation.slice(5));
      rotation = rotation.slice(0, 5);
    }
    bullpen.sort((a, b) => b.trueRating - a.trueRating);
    bullpen = bullpen.slice(0, 8);

    lineup.sort((a, b) => b.trueRating - a.trueRating);
    if (lineup.length > 9) {
      bench.push(...lineup.slice(9));
      lineup = lineup.slice(0, 9);
    }
    bench.sort((a, b) => b.trueRating - a.trueRating);
    bench = bench.slice(0, 4);

    // Recalculate ratings — use fixed slot counts so losing a player without replacement correctly lowers the average
    const afterRotation = rotation.reduce((s, p) => s + p.trueRating, 0) / Math.max(rotation.length, 5);
    const afterBullpen = bullpen.reduce((s, p) => s + p.trueRating, 0) / Math.max(bullpen.length, 8);
    const afterLineup = lineup.reduce((s, b) => s + b.trueRating, 0) / Math.max(lineup.length, 9);
    const afterBench = bench.reduce((s, b) => s + b.trueRating, 0) / Math.max(bench.length, 4);
    const afterOverall = (afterRotation * 0.40) + (afterLineup * 0.40) + (afterBullpen * 0.15) + (afterBench * 0.05);

    return {
      before,
      after: { rotation: afterRotation, bullpen: afterBullpen, lineup: afterLineup, bench: afterBench, overall: afterOverall },
      losing,
      gaining,
    };
  }

  private getTfrTierLabel(tfr: number): { label: string; cls: string } {
    if (tfr >= 4.5) return { label: 'Elite', cls: 'tier-elite' };
    if (tfr >= 3.5) return { label: 'Good', cls: 'tier-good' };
    if (tfr >= 2.5) return { label: 'Average', cls: 'tier-avg' };
    return { label: 'Depth', cls: 'tier-depth' };
  }

  /** Farm score: Elite(≥4.5)=10, Good(≥3.5)=5, Average(≥2.5)=1 */
  private computeFarmScore(tfrValues: number[]): number {
    let score = 0;
    for (const tfr of tfrValues) {
      if (tfr >= 4.5) score += 10;
      else if (tfr >= 3.5) score += 5;
      else if (tfr >= 2.5) score += 1;
    }
    return score;
  }

  private calculateFarmImpact(teamNum: 1 | 2): {
    losing: { name: string; playerId: number; tfr: number; tier: { label: string; cls: string } }[];
    gaining: { name: string; playerId: number; tfr: number; tier: { label: string; cls: string } }[];
    netTiers: Map<string, number>;
    scoreBefore: number;
    scoreAfter: number;
  } {
    const state = teamNum === 1 ? this.team1State : this.team2State;
    const otherState = teamNum === 1 ? this.team2State : this.team1State;

    const getProspectTfr = (playerId: number): number | null => {
      const pitcher = this.pitcherProspectMap.get(playerId);
      if (pitcher?.trueFutureRating != null) return pitcher.trueFutureRating;
      const hitter = this.hitterProspectMap.get(playerId);
      if (hitter?.trueFutureRating != null) return hitter.trueFutureRating;
      return null;
    };

    // Build current farm TFR values for this team's org
    const teamId = state.teamId;
    const currentFarmTfrs: number[] = [];
    for (const [, p] of this.pitcherProspectMap) {
      if (p.orgId === teamId && p.trueFutureRating >= 2.5) currentFarmTfrs.push(p.trueFutureRating);
    }
    for (const [, h] of this.hitterProspectMap) {
      if (h.orgId === teamId && h.trueFutureRating >= 2.5) currentFarmTfrs.push(h.trueFutureRating);
    }

    const losing: { name: string; playerId: number; tfr: number; tier: { label: string; cls: string } }[] = [];
    const gaining: { name: string; playerId: number; tfr: number; tier: { label: string; cls: string } }[] = [];

    // Prospects this team is sending away
    for (const p of state.tradingPlayers) {
      if (this.isProspectPitcher(p)) {
        const tfr = getProspectTfr(p.playerId);
        if (tfr != null) losing.push({ name: p.name, playerId: p.playerId, tfr, tier: this.getTfrTierLabel(tfr) });
      }
    }
    for (const b of state.tradingBatters) {
      if (this.isProspectBatter(b)) {
        const tfr = getProspectTfr(b.playerId);
        if (tfr != null) losing.push({ name: b.name, playerId: b.playerId, tfr, tier: this.getTfrTierLabel(tfr) });
      }
    }

    // Prospects this team is gaining (from the other team)
    for (const p of otherState.tradingPlayers) {
      if (this.isProspectPitcher(p)) {
        const tfr = getProspectTfr(p.playerId);
        if (tfr != null) gaining.push({ name: p.name, playerId: p.playerId, tfr, tier: this.getTfrTierLabel(tfr) });
      }
    }
    for (const b of otherState.tradingBatters) {
      if (this.isProspectBatter(b)) {
        const tfr = getProspectTfr(b.playerId);
        if (tfr != null) gaining.push({ name: b.name, playerId: b.playerId, tfr, tier: this.getTfrTierLabel(tfr) });
      }
    }

    // Sort by TFR descending
    losing.sort((a, b) => b.tfr - a.tfr);
    gaining.sort((a, b) => b.tfr - a.tfr);

    // Calculate net tier counts
    const netTiers = new Map<string, number>();
    for (const tier of ['Elite', 'Good', 'Average', 'Depth']) {
      netTiers.set(tier, 0);
    }
    for (const item of losing) {
      netTiers.set(item.tier.label, (netTiers.get(item.tier.label) ?? 0) - 1);
    }
    for (const item of gaining) {
      netTiers.set(item.tier.label, (netTiers.get(item.tier.label) ?? 0) + 1);
    }

    // Compute farm score before and after
    const scoreBefore = this.computeFarmScore(currentFarmTfrs);
    // Rebuild: remove lost, add gained
    const afterFarmTfrs: number[] = [];
    const lostIds = new Set(losing.map(l => l.playerId));
    for (const [, p] of this.pitcherProspectMap) {
      if (p.orgId === teamId && p.trueFutureRating >= 2.5 && !lostIds.has(p.playerId)) afterFarmTfrs.push(p.trueFutureRating);
    }
    for (const [, h] of this.hitterProspectMap) {
      if (h.orgId === teamId && h.trueFutureRating >= 2.5 && !lostIds.has(h.playerId)) afterFarmTfrs.push(h.trueFutureRating);
    }
    for (const g of gaining) {
      if (g.tfr >= 2.5) afterFarmTfrs.push(g.tfr);
    }
    const scoreAfter = this.computeFarmScore(afterFarmTfrs);

    return { losing, gaining, netTiers, scoreBefore, scoreAfter };
  }

  private renderTeamImpact(team1Name: string, team2Name: string): string {
    const impact1 = this.calculateTeamImpact(1);
    const impact2 = this.calculateTeamImpact(2);

    if (!impact1 && !impact2) return '';

    const renderColumn = (teamName: string, impact: ReturnType<typeof this.calculateTeamImpact>) => {
      if (!impact) return `<div class="team-impact-column"><h5>${teamName}</h5><p class="empty-text">No power ranking data</p></div>`;

      const overallDelta = impact.after.overall - impact.before.overall;
      const deltaClass = overallDelta >= 0 ? 'positive' : 'negative';
      const deltaSign = overallDelta >= 0 ? '+' : '';

      const renderRow = (label: string, before: number, after: number) => {
        const d = after - before;
        const cls = d >= 0.005 ? 'positive' : d <= -0.005 ? 'negative' : '';
        const sign = d >= 0 ? '+' : '';
        return `
          <div class="team-impact-row">
            <span class="impact-label">${label}</span>
            <span class="impact-values">${before.toFixed(2)} &rarr; ${after.toFixed(2)}</span>
            <span class="impact-delta ${cls}">${sign}${d.toFixed(2)}</span>
          </div>
        `;
      };

      const slotTags = [
        ...impact.losing.map(s => `<span class="slot-tag slot-out">&minus; ${s.slot} ${s.name} (${s.rating.toFixed(1)})</span>`),
        ...impact.gaining.map(s => `<span class="slot-tag slot-in">+ ${s.slot} ${s.name} (${s.rating.toFixed(1)})</span>`),
      ].join('');

      return `
        <div class="team-impact-column">
          <h5>${teamName}</h5>
          <div class="team-impact-overall ${deltaClass}">
            ${impact.before.overall.toFixed(2)} &rarr; ${impact.after.overall.toFixed(2)}
            <span class="impact-delta ${deltaClass}">${deltaSign}${overallDelta.toFixed(2)}</span>
          </div>
          ${renderRow('Rotation', impact.before.rotation, impact.after.rotation)}
          ${renderRow('Lineup', impact.before.lineup, impact.after.lineup)}
          ${renderRow('Bullpen', impact.before.bullpen, impact.after.bullpen)}
          ${renderRow('Bench', impact.before.bench, impact.after.bench)}
          <div class="team-impact-slots">${slotTags}</div>
        </div>
      `;
    };

    const renderFarmColumn = (teamName: string, farmImpact: ReturnType<typeof this.calculateFarmImpact>) => {
      const renderProspectItem = (item: { name: string; playerId: number; tfr: number; tier: { label: string; cls: string } }, type: 'lost' | 'gained') => {
        const icon = type === 'lost' ? '&minus;' : '+';
        const cls = type === 'lost' ? 'slot-out' : 'slot-in';
        return `
          <div class="farm-impact-item ${cls}">
            <span class="farm-impact-icon">${icon}</span>
            <span class="player-name-link" data-player-id="${item.playerId}">${item.name}</span>
            <span class="farm-impact-tfr">${item.tfr.toFixed(1)}</span>
            <span class="farm-impact-tier ${item.tier.cls}">${item.tier.label}</span>
          </div>
        `;
      };

      const netParts: string[] = [];
      for (const [tier, count] of farmImpact.netTiers) {
        if (count !== 0) {
          const sign = count > 0 ? '+' : '';
          netParts.push(`${sign}${count} ${tier}`);
        }
      }
      const netSummary = netParts.length > 0 ? netParts.join(', ') : 'No change';

      return `
        <div class="team-impact-column">
          <h5>${teamName}</h5>
          ${farmImpact.losing.length > 0 ? `
            <div class="farm-impact-group">
              <div class="farm-impact-group-label">Losing</div>
              ${farmImpact.losing.map(item => renderProspectItem(item, 'lost')).join('')}
            </div>
          ` : ''}
          ${farmImpact.gaining.length > 0 ? `
            <div class="farm-impact-group">
              <div class="farm-impact-group-label">Gaining</div>
              ${farmImpact.gaining.map(item => renderProspectItem(item, 'gained')).join('')}
            </div>
          ` : ''}
          ${farmImpact.losing.length === 0 && farmImpact.gaining.length === 0 ? `
            <p class="empty-text">No prospects in this side of the trade</p>
          ` : `
            <div class="farm-impact-score">
              <span class="impact-label">Farm Score</span>
              <span class="impact-values">${farmImpact.scoreBefore} &rarr; ${farmImpact.scoreAfter}</span>
              <span class="impact-delta ${farmImpact.scoreAfter > farmImpact.scoreBefore ? 'positive' : farmImpact.scoreAfter < farmImpact.scoreBefore ? 'negative' : ''}">${farmImpact.scoreAfter >= farmImpact.scoreBefore ? '+' : ''}${farmImpact.scoreAfter - farmImpact.scoreBefore}</span>
            </div>
            <div class="farm-impact-net">${netSummary}</div>
          `}
        </div>
      `;
    };

    const farm1 = this.calculateFarmImpact(1);
    const farm2 = this.calculateFarmImpact(2);
    const hasFarmAssets = farm1.losing.length > 0 || farm1.gaining.length > 0 || farm2.losing.length > 0 || farm2.gaining.length > 0;

    return `
      <div class="team-impact-section">
        <div class="impact-tab-header">
          <h5>Team Impact</h5>
          ${hasFarmAssets ? `
            <div class="impact-tab-toggle">
              <button class="impact-tab-btn active" data-tab="roster">Roster</button>
              <button class="impact-tab-btn" data-tab="farm">Farm</button>
            </div>
          ` : ''}
        </div>
        <div class="impact-tab-content" data-tab="roster">
          <div class="team-impact-grid">
            ${renderColumn(team1Name, impact1)}
            ${renderColumn(team2Name, impact2)}
          </div>
        </div>
        ${hasFarmAssets ? `
          <div class="impact-tab-content" data-tab="farm" style="display: none;">
            <div class="team-impact-grid">
              ${renderFarmColumn(team1Name, farm1)}
              ${renderFarmColumn(team2Name, farm2)}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  private async requestAIAnalysis(): Promise<void> {
    const btn = this.container.querySelector<HTMLButtonElement>('.ai-trade-btn');
    const resultDiv = this.container.querySelector<HTMLElement>('.ai-trade-result');
    if (!btn || !resultDiv) return;

    btn.disabled = true;
    btn.textContent = 'Analyzing...';
    resultDiv.innerHTML = '<div class="ai-loading"><span class="ai-loading-text">Generating trade analysis...</span></div>';

    // Ensure power rankings + contracts are loaded before AI analysis
    await this.ensureTradeAnalysisData();

    try {
      const team1 = this.allTeams.find(t => t.id === this.team1State.teamId);
      const team2 = this.allTeams.find(t => t.id === this.team2State.teamId);
      const team1Name = team1?.nickname ?? 'Team 1';
      const team2Name = team2?.nickname ?? 'Team 2';

      const posLabels: Record<number, string> = { 1: 'SP', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH' };

      const buildPlayerContexts = (state: TradeTeamState): TradePlayerContext[] => {
        const contexts: TradePlayerContext[] = [];
        for (const p of state.tradingPlayers) {
          const contract = this.allContracts.get(p.playerId);
          contexts.push({
            name: p.name,
            role: p.isSp ? 'SP' : 'RP',
            age: p.age,
            trueRating: p.currentTrueRating,
            trueFutureRating: p.projectedTrueRating !== p.currentTrueRating ? p.projectedTrueRating : undefined,
            projectedWar: p.projectedStats.war,
            projectedFip: p.projectedStats.fip,
            salary: contract ? contractService.getCurrentSalary(contract) : undefined,
            contractYears: contract ? contractService.getYearsRemaining(contract) : undefined,
            isProspect: p.isProspect ?? false,
          });
        }
        for (const b of state.tradingBatters) {
          const contract = this.allContracts.get(b.playerId);
          contexts.push({
            name: b.name,
            role: posLabels[b.position] || 'UT',
            age: b.age,
            trueRating: b.currentTrueRating,
            projectedWar: b.projectedStats.war,
            projectedWoba: b.projectedStats.woba,
            salary: contract ? contractService.getCurrentSalary(contract) : undefined,
            contractYears: contract ? contractService.getYearsRemaining(contract) : undefined,
            isProspect: this.isProspectBatter(b),
          });
        }
        return contexts;
      };

      const buildPickContexts = (state: TradeTeamState): TradePickContext[] => {
        return state.tradingPicks.map(p => ({ displayName: p.displayName, estimatedValue: p.estimatedValue }));
      };

      const ranking1 = this.powerRankingsMap.get(this.team1State.teamId);
      const ranking2 = this.powerRankingsMap.get(this.team2State.teamId);
      const impact1 = this.calculateTeamImpact(1);
      const impact2 = this.calculateTeamImpact(2);

      const analysis = this.calculateTradeAnalysis();

      const context: TradeContext = {
        team1: {
          teamName: team1Name,
          teamRating: ranking1?.teamRating,
          rotationRating: ranking1?.rotationRating,
          bullpenRating: ranking1?.bullpenRating,
          lineupRating: ranking1?.lineupRating,
          benchRating: ranking1?.benchRating,
          sending: buildPlayerContexts(this.team1State),
          sendingPicks: buildPickContexts(this.team1State),
          postTradeRating: impact1?.after.overall,
          postRotationRating: impact1?.after.rotation,
          postBullpenRating: impact1?.after.bullpen,
          postLineupRating: impact1?.after.lineup,
          postBenchRating: impact1?.after.bench,
        },
        team2: {
          teamName: team2Name,
          teamRating: ranking2?.teamRating,
          rotationRating: ranking2?.rotationRating,
          bullpenRating: ranking2?.bullpenRating,
          lineupRating: ranking2?.lineupRating,
          benchRating: ranking2?.benchRating,
          sending: buildPlayerContexts(this.team2State),
          sendingPicks: buildPickContexts(this.team2State),
          postTradeRating: impact2?.after.overall,
          postRotationRating: impact2?.after.rotation,
          postBullpenRating: impact2?.after.bullpen,
          postLineupRating: impact2?.after.lineup,
          postBenchRating: impact2?.after.bench,
        },
        team1TotalWar: analysis.team1WarChange,
        team2TotalWar: analysis.team2WarChange,
      };

      const blurb = await aiTradeAnalysisService.getTradeAnalysis(context);
      resultDiv.innerHTML = `<div class="ai-trade-content">${markdownToHtml(blurb)}</div>`;
    } catch (e: any) {
      console.error('AI trade analysis failed:', e);
      resultDiv.innerHTML = `<div class="ai-error">Failed to generate analysis: ${e.message || 'Unknown error'}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Get AI Analysis';
    }
  }

  private isProspectPitcher(p: ProjectedPlayer): boolean {
    if (p.isProspect === true) return true;
    const player = this.findPlayer(p.playerId);
    if (!player) return false;
    const lv = typeof player.level === 'string' ? parseInt(player.level as any, 10) : (player.level ?? 1);
    return lv > 1;
  }

  private isProspectBatter(b: ProjectedBatter): boolean {
    if (b.isProspect === true) return true;
    const player = this.findPlayer(b.playerId);
    if (!player) return false;
    const lv = typeof player.level === 'string' ? parseInt(player.level as any, 10) : (player.level ?? 1);
    return lv > 1;
  }

  /**
   * Resolve the MLB parent team ID for a player (minors use parentTeamId).
   */
  private resolveOrgTeamId(teamId: number, parentTeamId?: number): number {
    if (parentTeamId && parentTeamId !== 0) return parentTeamId;
    // Check if this team itself has a parent (minor league affiliate)
    const team = this.allTeams.find(t => t.id === teamId);
    if (team && team.parentTeamId && team.parentTeamId !== 0) return team.parentTeamId;
    return teamId;
  }

  /**
   * Compute park-adjusted WAR delta for a batter moving to a destination team.
   * Uses the HR factor ratio as the primary driver (HR factor dominates park-adjusted WAR).
   * Returns { destWar, delta } or undefined if park factors unavailable.
   */
  private computeBatterParkWarDelta(
    batter: ProjectedBatter,
    destTeamId: number
  ): { destWar: number; delta: number } | undefined {
    const originOrgId = this.resolveOrgTeamId(batter.teamId, batter.parentTeamId);
    const destOrgId = this.resolveOrgTeamId(destTeamId);
    if (originOrgId === destOrgId) return undefined; // same park

    const originPark = this.parkFactorsMap.get(originOrgId);
    const destPark = this.parkFactorsMap.get(destOrgId);
    if (!originPark || !destPark) return undefined;

    // Look up batter handedness for hand-specific factors
    const player = this.findPlayer(batter.playerId);
    const bats = player?.bats || 'R';

    const originEff = computeEffectiveParkFactors(originPark, bats);
    const destEff = computeEffectiveParkFactors(destPark, bats);

    // HR factor is the dominant driver of batter WAR variation by park.
    // Approximate: WAR delta ~= currentWAR * (originHr - destHr) * scaleFactor
    // A lower HR factor at destination means fewer HR → lower offensive WAR for batters.
    // Scale factor of 0.5 captures that HR accounts for ~50% of park-driven WAR variation.
    const war = batter.projectedStats.war;
    const delta = war * (destEff.hr - originEff.hr) * 0.5;
    return { destWar: war + delta, delta };
  }

  /**
   * Compute park-adjusted WAR delta for a pitcher moving to a destination team.
   * Lower HR factor at destination = fewer HR allowed = better for pitchers.
   */
  private computePitcherParkWarDelta(
    pitcher: ProjectedPlayer,
    destTeamId: number
  ): { destWar: number; delta: number } | undefined {
    const originOrgId = this.resolveOrgTeamId(pitcher.teamId, pitcher.parentTeamId);
    const destOrgId = this.resolveOrgTeamId(destTeamId);
    if (originOrgId === destOrgId) return undefined; // same park

    const originPark = this.parkFactorsMap.get(originOrgId);
    const destPark = this.parkFactorsMap.get(destOrgId);
    if (!originPark || !destPark) return undefined;

    const originHr = computePitcherParkHrFactor(originPark);
    const destHr = computePitcherParkHrFactor(destPark);

    // For pitchers, lower HR factor = fewer HR allowed = higher WAR.
    // WAR delta ~= currentWAR * (originHr - destHr) * scaleFactor
    const war = pitcher.projectedStats.war;
    const delta = war * (originHr - destHr) * 0.4;
    return { destWar: war + delta, delta };
  }

  /**
   * Format a WAR park delta indicator as an HTML string.
   * Shows: "3.2 -> 3.5 (+0.3)" with green/red coloring.
   */
  private formatWarParkDelta(origWar: number, delta: number): string {
    if (Math.abs(delta) < 0.05) return '';
    const destWar = origWar + delta;
    const sign = delta > 0 ? '+' : '';
    const cls = delta > 0 ? 'war-park-up' : 'war-park-down';
    return ` <span class="war-park-delta ${cls}" title="Park-adjusted WAR at destination">\u2192 ${destWar.toFixed(1)} (${sign}${delta.toFixed(1)})</span>`;
  }

  private calculateTeamWar(state: TradeTeamState, destTeamId?: number): { current: number; future: number; total: number } {
    let current = 0;
    let future = 0;

    for (const p of state.tradingPlayers) {
      let war = p.projectedStats.war;
      if (destTeamId) {
        const adj = this.computePitcherParkWarDelta(p, destTeamId);
        if (adj) war = adj.destWar;
      }
      if (this.isProspectPitcher(p)) {
        future += war;
      } else {
        current += war;
      }
    }

    for (const b of state.tradingBatters) {
      let war = b.projectedStats.war;
      if (destTeamId) {
        const adj = this.computeBatterParkWarDelta(b, destTeamId);
        if (adj) war = adj.destWar;
      }
      if (this.isProspectBatter(b)) {
        future += war;
      } else {
        current += war;
      }
    }

    // Draft picks are always future
    for (const pick of state.tradingPicks) {
      future += pick.estimatedValue;
    }

    return { current, future, total: current + future };
  }

  private calculateTradeAnalysis(): TradeAnalysis {
    // Team 1's players go to Team 2's park and vice versa
    const team1War = this.calculateTeamWar(this.team1State, this.team2State.teamId || undefined);
    const team2War = this.calculateTeamWar(this.team2State, this.team1State.teamId || undefined);

    const team1WarChange = team1War.total;
    const team2WarChange = team2War.total;

    const team1Gain = team2WarChange > team1WarChange;
    const team2Gain = team1WarChange > team2WarChange;

    const team1Name = this.allTeams.find(t => t.id === this.team1State.teamId)?.nickname ?? 'Team 1';
    const team2Name = this.allTeams.find(t => t.id === this.team2State.teamId)?.nickname ?? 'Team 2';

    // Determine trade archetype for summary
    const totalCurrent = team1War.current + team2War.current;
    const totalFuture = team1War.future + team2War.future;
    const totalWar = totalCurrent + totalFuture;

    let summary = '';
    const warDiff = Math.abs(team1WarChange - team2WarChange);

    if (totalWar > 0) {
      const currentPct = totalCurrent / totalWar;
      const team1CurrentPct = team1War.total > 0 ? team1War.current / team1War.total : 0;
      const team2CurrentPct = team2War.total > 0 ? team2War.current / team2War.total : 0;

      // One side mostly current, other mostly future → win-now vs future
      if (Math.abs(team1CurrentPct - team2CurrentPct) > 0.5 && totalCurrent > 0 && totalFuture > 0) {
        const winNowTeam = team1CurrentPct > team2CurrentPct ? team2Name : team1Name;
        const futureTeam = team1CurrentPct > team2CurrentPct ? team1Name : team2Name;
        summary = `Win-now vs. future: ${winNowTeam} acquires MLB talent while ${futureTeam} stocks the farm.`;
      } else if (currentPct > 0.7) {
        summary = `Roster swap: both teams are exchanging current MLB value.`;
      } else if (currentPct < 0.3) {
        summary = `Prospect swap: both teams are exchanging future assets.`;
      }
    }

    // Append WAR comparison
    if (warDiff < 0.5) {
      summary += summary ? ' ' : '';
      summary += `Roughly even WAR value on both sides.`;
    } else if (team1Gain) {
      summary += summary ? ' ' : '';
      summary += `${team1Name} gains ~${warDiff.toFixed(1)} more WAR in total value.`;
    } else {
      summary += summary ? ' ' : '';
      summary += `${team2Name} gains ~${warDiff.toFixed(1)} more WAR in total value.`;
    }

    return {
      team1WarChange,
      team2WarChange,
      team1CurrentWar: team1War.current,
      team2CurrentWar: team2War.current,
      team1FutureWar: team1War.future,
      team2FutureWar: team2War.future,
      team1Gain,
      team2Gain,
      summary
    };
  }
}
