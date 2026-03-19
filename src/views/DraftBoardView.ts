/**
 * DraftBoardView — Hidden draft board accessed via double-tap D.
 *
 * Two panels:
 * 1. Player List — browse draft-eligible players with checkboxes to add to board
 * 2. Draft Board — selected players, drag-reorderable, combined pitchers + batters
 */

import { playerService } from '../services/PlayerService';
import { teamRatingsService } from '../services/TeamRatingsService';
import { scoutingDataService } from '../services/ScoutingDataService';
import { hitterScoutingDataService } from '../services/HitterScoutingDataService';
import { supabaseDataService } from '../services/SupabaseDataService';
import { dateService } from '../services/DateService';
import { projectionService } from '../services/ProjectionService';
import { batterProjectionService } from '../services/BatterProjectionService';
import { pitcherProfileModal } from './PitcherProfileModal';
import type { Player } from '../models/Player';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type PanelMode = 'player-list' | 'draft-board';
type PlayerTypeMode = 'pitchers' | 'batters';
type ColumnMode = 'tfr' | 'scout' | 'projections';

interface DraftPlayer {
  id: number;
  name: string;
  position: number;
  posLabel: string;
  age: number;
  type: 'pitcher' | 'batter';
  tfrStar: number;
  // TFR ratings
  tfrRatings?: Record<string, number>;
  // Scout ratings
  scoutRatings?: Record<string, number>;
  // Projections
  projStats?: Record<string, number>;
}

const POS_LABELS: Record<number, string> = {
  1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH',
};

const BATTER_POSITIONS = ['All', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
const PITCHER_POSITIONS = ['All', 'SP', 'RP'];

const STORAGE_KEY = 'wbl-draft-board';

// ──────────────────────────────────────────────
// View
// ──────────────────────────────────────────────

export class DraftBoardView {
  private container: HTMLElement;
  private panelMode: PanelMode = 'player-list';
  private playerTypeMode: PlayerTypeMode = 'batters';
  private columnMode: ColumnMode = 'projections';
  private selectedPosition = 'All';

  private allPlayers: DraftPlayer[] = [];
  private draftBoardIds: number[] = [];
  private loaded = false;
  private sortKey = 'tfrStar';
  private sortDir: 'asc' | 'desc' = 'desc';

  // Board sort state (null = use board order)
  private boardSortKey: string | null = null;
  private boardSortDir: 'asc' | 'desc' = 'desc';

  // Drag state
  private dragSourceIndex: number | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.loadBoard();
    this.render();

    // Refresh when custom scouting is loaded
    window.addEventListener('scoutingDataUpdated', () => {
      this.loaded = false;
      this.allPlayers = [];
      const content = this.container.querySelector('.draft-content');
      if (content) {
        content.innerHTML = '<div class="loading-message">Refreshing with new scouting data...</div>';
        this.loadData().then(() => this.renderContent());
      }
    });
  }

  // ── Persistence ──

  private loadBoard(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.draftBoardIds = JSON.parse(raw);
    } catch { /* ignore */ }
  }

  private saveBoard(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.draftBoardIds));
    } catch { /* ignore */ }
  }

  // ── Data Loading ──

  private async loadData(): Promise<void> {
    if (this.loaded) return;

    const year = await dateService.getCurrentYear();
    const [allPlayersList, pitcherFarm, hitterFarm] = await Promise.all([
      playerService.getAllPlayers(),
      teamRatingsService.getFarmData(year),
      teamRatingsService.getUnifiedHitterTfrData(year),
    ]);

    // Build draftee player set
    const drafteeIds = new Set<number>();
    for (const p of allPlayersList) {
      if (p.draftEligible) {
        drafteeIds.add(p.id);
      }
    }

    const playerMap = new Map<number, Player>(allPlayersList.map(p => [p.id, p]));

    // Load scouting for both sources
    const [pitcherScoutMy, pitcherScoutOsa, hitterScoutMy, hitterScoutOsa] = await Promise.all([
      scoutingDataService.getLatestScoutingRatings('my'),
      scoutingDataService.getLatestScoutingRatings('osa'),
      hitterScoutingDataService.getLatestScoutingRatings('my'),
      hitterScoutingDataService.getLatestScoutingRatings('osa'),
    ]);

    // Build scouting maps (prefer my over osa)
    const pitcherScoutMap = new Map<number, any>();
    for (const s of pitcherScoutOsa) pitcherScoutMap.set(s.playerId, s);
    for (const s of pitcherScoutMy) pitcherScoutMap.set(s.playerId, s);

    const hitterScoutMap = new Map<number, any>();
    for (const s of hitterScoutOsa) hitterScoutMap.set(s.playerId, s);
    for (const s of hitterScoutMy) hitterScoutMap.set(s.playerId, s);

    // Load projections via services (respects hasCustomScouting — recalculates if needed)
    const statsBaseYear = year - 1;
    const [pitcherProjCtx, batterProjCtx] = await Promise.all([
      projectionService.getProjectionsWithContext(statsBaseYear).catch(() => null),
      batterProjectionService.getProjectionsWithContext(statsBaseYear).catch(() => null),
    ]);

    const pitcherProjMap = new Map<number, any>();
    if (pitcherProjCtx?.projections) {
      for (const p of pitcherProjCtx.projections) {
        if (drafteeIds.has(p.playerId)) pitcherProjMap.set(p.playerId, p);
      }
    }
    const batterProjMap = new Map<number, any>();
    if (batterProjCtx?.projections) {
      for (const p of batterProjCtx.projections) {
        if (drafteeIds.has(p.playerId)) batterProjMap.set(p.playerId, p);
      }
    }

    // Build pitcher TFR map
    const pitcherTfrMap = new Map<number, any>();
    if (pitcherFarm?.prospects) {
      for (const p of pitcherFarm.prospects) {
        if (drafteeIds.has(p.playerId)) pitcherTfrMap.set(p.playerId, p);
      }
    }

    // Build hitter TFR map
    const hitterTfrMap = new Map<number, any>();
    if (hitterFarm?.prospects) {
      for (const p of hitterFarm.prospects) {
        if (drafteeIds.has(p.playerId)) hitterTfrMap.set(p.playerId, p);
      }
    }

    // Build unified player list
    this.allPlayers = [];

    for (const pid of drafteeIds) {
      const player = playerMap.get(pid);
      if (!player) continue;
      const pos = player.position || 0;
      const isPitcher = pos === 1;
      const age = player.age || 0;

      if (isPitcher) {
        const tfr = pitcherTfrMap.get(pid);
        const scout = pitcherScoutMap.get(pid);
        const proj = pitcherProjMap.get(pid);
        if (!tfr && !scout && !proj) continue;

        this.allPlayers.push({
          id: pid,
          name: `${player.firstName} ${player.lastName}`,
          position: pos,
          posLabel: proj?.isSp === false ? 'RP' : 'SP',
          age,
          type: 'pitcher',
          tfrStar: tfr?.trueFutureRating ?? proj?.currentTrueRating ?? 0,
          tfrRatings: tfr?.trueRatings ? {
            stuff: tfr.trueRatings.stuff, control: tfr.trueRatings.control, hra: tfr.trueRatings.hra,
          } : undefined,
          scoutRatings: scout ? {
            stuff: scout.stuff, control: scout.control, hra: scout.hra,
            stamina: scout.stamina,
          } : undefined,
          projStats: proj ? {
            k9: proj.projectedStats.k9, bb9: proj.projectedStats.bb9, hr9: proj.projectedStats.hr9,
            fip: proj.projectedStats.fip, war: proj.projectedStats.war, ip: proj.projectedStats.ip,
          } : undefined,
        });
      } else {
        const tfr = hitterTfrMap.get(pid);
        const scout = hitterScoutMap.get(pid);
        const proj = batterProjMap.get(pid);
        if (!tfr && !scout && !proj) continue;

        this.allPlayers.push({
          id: pid,
          name: `${player.firstName} ${player.lastName}`,
          position: pos,
          posLabel: POS_LABELS[pos] || 'UT',
          age,
          type: 'batter',
          tfrStar: tfr?.trueFutureRating ?? proj?.currentTrueRating ?? 0,
          tfrRatings: tfr?.trueRatings ? {
            power: tfr.trueRatings.power, eye: tfr.trueRatings.eye,
            avoidK: tfr.trueRatings.avoidK, contact: tfr.trueRatings.contact,
            gap: tfr.trueRatings.gap, speed: tfr.trueRatings.speed,
          } : undefined,
          scoutRatings: scout ? {
            power: scout.power, eye: scout.eye, avoidK: scout.avoidK,
            contact: scout.contact, gap: scout.gap, speed: scout.speed,
          } : undefined,
          projStats: proj ? {
            avg: proj.projectedStats.avg, obp: proj.projectedStats.obp, slg: proj.projectedStats.slg,
            ops: proj.projectedStats.ops, opsPlus: proj.projectedStats.wrcPlus,
            war: proj.projectedStats.war, pa: proj.projectedStats.pa, hr: proj.projectedStats.hr,
          } : undefined,
        });
      }
    }

    // Prune stale board IDs
    const validIds = new Set(this.allPlayers.map(p => p.id));
    this.draftBoardIds = this.draftBoardIds.filter(id => validIds.has(id));
    this.saveBoard();

    this.loaded = true;
  }

  // ── Filtering & Sorting ──

  private getFilteredPlayers(): DraftPlayer[] {
    let players = this.allPlayers.filter(p =>
      this.playerTypeMode === 'pitchers' ? p.type === 'pitcher' : p.type === 'batter'
    );

    if (this.selectedPosition !== 'All') {
      players = players.filter(p => p.posLabel === this.selectedPosition);
    }

    const key = this.sortKey;
    const dir = this.sortDir === 'asc' ? 1 : -1;

    players.sort((a, b) => {
      let va: number, vb: number;
      if (key === 'tfrStar') { va = a.tfrStar; vb = b.tfrStar; }
      else if (key === 'age') { va = a.age; vb = b.age; }
      else if (key === 'name') { return dir * a.name.localeCompare(b.name); }
      else if (key.startsWith('tfr.')) {
        const k = key.slice(4);
        va = a.tfrRatings?.[k] ?? 0; vb = b.tfrRatings?.[k] ?? 0;
      } else if (key.startsWith('scout.')) {
        const k = key.slice(6);
        va = a.scoutRatings?.[k] ?? 0; vb = b.scoutRatings?.[k] ?? 0;
      } else if (key.startsWith('proj.')) {
        const k = key.slice(5);
        va = a.projStats?.[k] ?? 0; vb = b.projStats?.[k] ?? 0;
      } else { va = 0; vb = 0; }
      return dir * (va - vb);
    });

    return players;
  }

  // ── Rendering ──

  private render(): void {
    this.container.innerHTML = `
      <div class="draft-board-view">
        <div class="view-header">
          <h2>Draft Board</h2>
          <div class="header-controls">
            <div class="toggle-group panel-toggle">
              <button class="toggle-btn ${this.panelMode === 'player-list' ? 'active' : ''}" data-panel="player-list">Player List</button>
              <button class="toggle-btn ${this.panelMode === 'draft-board' ? 'active' : ''}" data-panel="draft-board">
                My Board <span class="board-count">(${this.draftBoardIds.length})</span>
              </button>
            </div>
          </div>
        </div>
        <div class="draft-content"></div>
      </div>
    `;

    this.bindPanelToggle();

    if (!this.loaded) {
      this.container.querySelector('.draft-content')!.innerHTML = '<div class="loading-message">Loading draft class...</div>';
      this.loadData().then(() => this.renderContent());
    } else {
      this.renderContent();
    }
  }

  private renderContent(): void {
    const content = this.container.querySelector('.draft-content');
    if (!content) return;

    if (this.panelMode === 'player-list') {
      this.renderPlayerList(content as HTMLElement);
    } else {
      this.renderDraftBoard(content as HTMLElement);
    }
  }

  // ── Player List Panel ──

  private renderPlayerList(content: HTMLElement): void {
    const positions = this.playerTypeMode === 'pitchers' ? PITCHER_POSITIONS : BATTER_POSITIONS;
    const filtered = this.getFilteredPlayers();
    const boardSet = new Set(this.draftBoardIds);

    content.innerHTML = `
      <div class="filter-bar" style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap;">
        <div class="toggle-group">
          <button class="toggle-btn ${this.playerTypeMode === 'batters' ? 'active' : ''}" data-ptype="batters">Batters</button>
          <button class="toggle-btn ${this.playerTypeMode === 'pitchers' ? 'active' : ''}" data-ptype="pitchers">Pitchers</button>
        </div>
        <div class="toggle-group">
          ${positions.map(p => `<button class="toggle-btn ${this.selectedPosition === p ? 'active' : ''}" data-pos="${p}">${p}</button>`).join('')}
        </div>
        <div class="toggle-group">
          <button class="toggle-btn ${this.columnMode === 'tfr' ? 'active' : ''}" data-colmode="tfr">TFR Ratings</button>
          <button class="toggle-btn ${this.columnMode === 'scout' ? 'active' : ''}" data-colmode="scout">Scout Ratings</button>
          <button class="toggle-btn ${this.columnMode === 'projections' ? 'active' : ''}" data-colmode="projections">Peak Projections</button>
        </div>
        <button class="btn btn-primary btn-sm" id="draft-add-all" style="margin-left: auto;">Add All (${filtered.filter(p => !boardSet.has(p.id)).length})</button>
      </div>
      <div class="draft-table-wrap" style="max-height: calc(100vh - 200px); overflow-y: auto;">
        <table class="stats-table draft-list-table">
          <thead><tr>${this.getPlayerListHeaders(boardSet)}</tr></thead>
          <tbody>${this.getPlayerListRows(filtered, boardSet)}</tbody>
        </table>
      </div>
      <div style="margin-top: 0.5rem; color: var(--color-text-muted); font-size: 0.8em;">
        ${filtered.length} players shown · ${boardSet.size} on board
      </div>
    `;

    this.bindPlayerListEvents(content);
  }

  private getPlayerListHeaders(boardSet: Set<number>): string {
    const allChecked = this.getFilteredPlayers().every(p => boardSet.has(p.id));
    let cols = `<th style="width:30px"><input type="checkbox" class="draft-check-all" ${allChecked && this.getFilteredPlayers().length > 0 ? 'checked' : ''}></th>`;
    cols += this.sortHeader('name', 'Name');
    cols += this.sortHeader('', 'Pos', false);
    cols += this.sortHeader('age', 'Age');
    cols += this.sortHeader('tfrStar', 'TFR');

    if (this.columnMode === 'tfr') {
      cols += this.getTfrHeaders();
    } else if (this.columnMode === 'scout') {
      cols += this.getScoutHeaders();
    } else {
      cols += this.getProjectionHeaders();
    }
    return cols;
  }

  private sortHeader(key: string, label: string, sortable = true): string {
    if (!sortable) return `<th>${label}</th>`;
    const isActive = this.sortKey === key;
    const arrow = isActive ? (this.sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th class="sortable ${isActive ? 'sort-active' : ''}" data-sort="${key}" style="cursor:pointer">${label}${arrow}</th>`;
  }

  private getTfrHeaders(): string {
    if (this.playerTypeMode === 'pitchers') {
      return ['stuff', 'control', 'hra'].map(k => this.sortHeader(`tfr.${k}`, k.charAt(0).toUpperCase() + k.slice(1))).join('');
    }
    return ['power', 'eye', 'avoidK', 'contact', 'gap', 'speed'].map(k => {
      const labels: Record<string, string> = { power: 'Pow', eye: 'Eye', avoidK: 'AvK', contact: 'Con', gap: 'Gap', speed: 'Spd' };
      return this.sortHeader(`tfr.${k}`, labels[k] || k);
    }).join('');
  }

  private getScoutHeaders(): string {
    if (this.playerTypeMode === 'pitchers') {
      return ['stuff', 'control', 'hra', 'stamina'].map(k => {
        const labels: Record<string, string> = { stuff: 'Stuff', control: 'Ctrl', hra: 'HRA', stamina: 'Stam' };
        return this.sortHeader(`scout.${k}`, labels[k] || k);
      }).join('');
    }
    return ['power', 'eye', 'avoidK', 'contact', 'gap', 'speed'].map(k => {
      const labels: Record<string, string> = { power: 'Pow', eye: 'Eye', avoidK: 'AvK', contact: 'Con', gap: 'Gap', speed: 'Spd' };
      return this.sortHeader(`scout.${k}`, labels[k] || k);
    }).join('');
  }

  private getProjectionHeaders(): string {
    if (this.playerTypeMode === 'pitchers') {
      return ['k9', 'bb9', 'hr9', 'fip', 'war', 'ip'].map(k => {
        const labels: Record<string, string> = { k9: 'K/9', bb9: 'BB/9', hr9: 'HR/9', fip: 'FIP', war: 'WAR', ip: 'IP' };
        return this.sortHeader(`proj.${k}`, labels[k] || k);
      }).join('');
    }
    return ['avg', 'obp', 'slg', 'opsPlus', 'war', 'hr'].map(k => {
      const labels: Record<string, string> = { avg: 'AVG', obp: 'OBP', slg: 'SLG', opsPlus: 'OPS+', war: 'WAR', hr: 'HR' };
      return this.sortHeader(`proj.${k}`, labels[k] || k);
    }).join('');
  }

  private getPlayerListRows(players: DraftPlayer[], boardSet: Set<number>): string {
    return players.map(p => {
      const checked = boardSet.has(p.id) ? 'checked' : '';
      let cells = `<td><input type="checkbox" class="draft-check" data-pid="${p.id}" ${checked}></td>`;
      cells += `<td><button class="player-name-link draft-name" data-pid="${p.id}">${p.name}</button></td>`;
      cells += `<td style="text-align:center">${p.posLabel}</td>`;
      cells += `<td style="text-align:center">${p.age}</td>`;
      cells += `<td style="text-align:center">${this.renderTfrBadge(p.tfrStar)}</td>`;

      if (this.columnMode === 'tfr') {
        cells += this.getTfrCells(p);
      } else if (this.columnMode === 'scout') {
        cells += this.getScoutCells(p);
      } else {
        cells += this.getProjectionCells(p);
      }
      return `<tr class="${checked ? 'row-selected' : ''}">${cells}</tr>`;
    }).join('');
  }

  private getTfrCells(p: DraftPlayer): string {
    const r = p.tfrRatings;
    if (!r) return this.emptyCells(this.playerTypeMode === 'pitchers' ? 3 : 6);
    if (p.type === 'pitcher') {
      return [r.stuff, r.control, r.hra].map(v => `<td style="text-align:center">${this.ratingCell(v)}</td>`).join('');
    }
    return [r.power, r.eye, r.avoidK, r.contact, r.gap, r.speed].map(v => `<td style="text-align:center">${this.ratingCell(v)}</td>`).join('');
  }

  private getScoutCells(p: DraftPlayer): string {
    const r = p.scoutRatings;
    if (p.type === 'pitcher') {
      if (!r) return this.emptyCells(4);
      return [r.stuff, r.control, r.hra, r.stamina].map(v => `<td style="text-align:center">${this.ratingCell(v)}</td>`).join('');
    }
    if (!r) return this.emptyCells(6);
    return [r.power, r.eye, r.avoidK, r.contact, r.gap, r.speed].map(v => `<td style="text-align:center">${this.ratingCell(v)}</td>`).join('');
  }

  private getProjectionCells(p: DraftPlayer): string {
    const s = p.projStats;
    if (p.type === 'pitcher') {
      if (!s) return this.emptyCells(6);
      return [
        s.k9?.toFixed(1), s.bb9?.toFixed(1), s.hr9?.toFixed(1),
        s.fip?.toFixed(2), s.war?.toFixed(1), Math.round(s.ip ?? 0),
      ].map(v => `<td style="text-align:center">${v ?? ''}</td>`).join('');
    }
    if (!s) return this.emptyCells(6);
    return [
      s.avg?.toFixed(3), s.obp?.toFixed(3), s.slg?.toFixed(3),
      Math.round(s.opsPlus ?? 0), s.war?.toFixed(1), Math.round(s.hr ?? 0),
    ].map(v => `<td style="text-align:center">${v ?? ''}</td>`).join('');
  }

  private emptyCells(n: number): string {
    return '<td></td>'.repeat(n);
  }

  private ratingCell(v: number | undefined): string {
    if (v === undefined) return '';
    const cls = v >= 70 ? 'rating-elite' : v >= 60 ? 'rating-plus' : v >= 45 ? 'rating-avg' : 'rating-below';
    return `<span class="${cls}">${v}</span>`;
  }

  private renderTfrBadge(star: number): string {
    if (!star || star <= 0) return '<span class="rating-badge rating-none">--</span>';
    const cls = star >= 4.5 ? 'rating-elite' : star >= 3.5 ? 'rating-plus' : star >= 2.5 ? 'rating-avg' : 'rating-below';
    return `<span class="rating-badge ${cls}">${star.toFixed(1)}</span>`;
  }

  // ── Draft Board Panel ──

  private renderDraftBoard(content: HTMLElement): void {
    const playerMap = new Map(this.allPlayers.map(p => [p.id, p]));
    const boardPlayers = this.draftBoardIds.map(id => playerMap.get(id)).filter(Boolean) as DraftPlayer[];

    // Apply temp sort if active
    let displayPlayers = boardPlayers;
    const isTempSorted = this.boardSortKey !== null;
    if (isTempSorted) {
      displayPlayers = [...boardPlayers];
      const key = this.boardSortKey!;
      const dir = this.boardSortDir === 'asc' ? 1 : -1;
      displayPlayers.sort((a, b) => {
        let va: number, vb: number;
        if (key === 'name') return dir * a.name.localeCompare(b.name);
        if (key === 'tfrStar') { va = a.tfrStar; vb = b.tfrStar; }
        else if (key === 'age') { va = a.age; vb = b.age; }
        else if (key === 'war') { va = a.projStats?.war ?? 0; vb = b.projStats?.war ?? 0; }
        else if (key === 'keyStat') {
          va = a.type === 'pitcher' ? (a.projStats?.fip ?? 99) : (a.projStats?.opsPlus ?? 0);
          vb = b.type === 'pitcher' ? (b.projStats?.fip ?? 99) : (b.projStats?.opsPlus ?? 0);
        }
        else { va = 0; vb = 0; }
        return dir * (va - vb);
      });
    }

    // Build board rank lookup (original order) for the # column
    const boardRank = new Map<number, number>();
    this.draftBoardIds.forEach((id, i) => boardRank.set(id, i + 1));

    const sortArrow = (key: string, defaultDir: 'asc' | 'desc' = 'desc'): string => {
      if (this.boardSortKey !== key) return '';
      return this.boardSortDir === 'asc' ? ' ▲' : ' ▼';
    };

    content.innerHTML = `
      <div class="filter-bar" style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.75rem;">
        <span style="color: var(--color-text-muted); font-size: 0.85em;">${boardPlayers.length} players on board${isTempSorted ? '' : ' — drag to reorder'}</span>
        <button class="btn btn-danger btn-sm" id="draft-clear-all" style="margin-left: auto;" ${boardPlayers.length === 0 ? 'disabled' : ''}>Clear All</button>
      </div>
      ${isTempSorted ? `
        <div class="board-sort-bar" style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.75rem; padding: 0.5rem 0.75rem; background: rgba(99, 102, 241, 0.1); border-radius: var(--border-radius); border: 1px solid rgba(99, 102, 241, 0.3);">
          <span style="font-size: 0.85em;">Sorted by ${this.boardSortKey}. Use this as new board rankings?</span>
          <button class="btn btn-primary btn-sm" id="board-apply-sort">Apply Rankings</button>
          <button class="btn btn-sm" id="board-reset-sort" style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text);">Reset</button>
        </div>
      ` : ''}
      ${boardPlayers.length === 0
        ? '<div style="text-align:center; padding: 3rem; color: var(--color-text-muted);">No players on your board yet. Switch to Player List to add some.</div>'
        : `<div class="draft-table-wrap" style="max-height: calc(100vh - 200px); overflow-y: auto;">
            <table class="stats-table draft-board-table">
              <thead><tr>
                <th style="width:24px"></th>
                <th style="width:30px">#</th>
                <th class="board-sort-header" data-bsort="name" style="cursor:pointer">Name${sortArrow('name')}</th>
                <th>Pos</th>
                <th class="board-sort-header" data-bsort="age" style="cursor:pointer">Age${sortArrow('age')}</th>
                <th class="board-sort-header" data-bsort="tfrStar" style="cursor:pointer">TFR${sortArrow('tfrStar')}</th>
                <th class="board-sort-header" data-bsort="war" style="cursor:pointer">WAR${sortArrow('war')}</th>
                <th class="board-sort-header" data-bsort="keyStat" style="cursor:pointer">Key Stat${sortArrow('keyStat')}</th>
                <th style="width:30px"></th>
              </tr></thead>
              <tbody>${displayPlayers.map(p => this.renderBoardRow(p, boardRank.get(p.id) ?? 0)).join('')}</tbody>
            </table>
          </div>`
      }
    `;

    this.bindDraftBoardEvents(content);
  }

  private renderBoardRow(p: DraftPlayer, rank: number): string {
    const war = p.projStats?.war?.toFixed(1) ?? '--';
    let keyStat = '';
    if (p.type === 'pitcher') {
      keyStat = p.projStats?.fip !== undefined ? `${p.projStats.fip.toFixed(2)} FIP` : '--';
    } else {
      keyStat = p.projStats?.opsPlus !== undefined ? `${Math.round(p.projStats.opsPlus)} OPS+` : '--';
    }

    const isTempSorted = this.boardSortKey !== null;
    return `<tr class="board-row" data-pid="${p.id}" ${isTempSorted ? '' : 'draggable="true"'}>
      <td class="drag-handle" style="cursor:${isTempSorted ? 'default' : 'grab'}; text-align:center; color: var(--color-text-muted);">${isTempSorted ? '' : '⠿'}</td>
      <td style="text-align:center; color: var(--color-text-muted);">${rank}</td>
      <td><button class="player-name-link draft-name" data-pid="${p.id}">${p.name}</button></td>
      <td style="text-align:center">${p.posLabel}</td>
      <td style="text-align:center">${p.age}</td>
      <td style="text-align:center">${this.renderTfrBadge(p.tfrStar)}</td>
      <td style="text-align:center">${war}</td>
      <td style="text-align:center">${keyStat}</td>
      <td><button class="btn-icon draft-remove" data-pid="${p.id}" title="Remove">✕</button></td>
    </tr>`;
  }

  // ── Event Binding ──

  private bindPanelToggle(): void {
    this.container.querySelectorAll<HTMLElement>('.panel-toggle .toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const panel = btn.dataset.panel as PanelMode;
        if (panel && panel !== this.panelMode) {
          this.panelMode = panel;
          this.container.querySelectorAll('.panel-toggle .toggle-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.container.querySelector('.board-count')!.textContent = `(${this.draftBoardIds.length})`;
          this.renderContent();
        }
      });
    });
  }

  private bindPlayerListEvents(content: HTMLElement): void {
    // Player type toggle
    content.querySelectorAll<HTMLElement>('[data-ptype]').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.ptype as PlayerTypeMode;
        if (type && type !== this.playerTypeMode) {
          this.playerTypeMode = type;
          this.selectedPosition = 'All';
          this.renderContent();
        }
      });
    });

    // Position filter
    content.querySelectorAll<HTMLElement>('[data-pos]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pos = btn.dataset.pos;
        if (pos && pos !== this.selectedPosition) {
          this.selectedPosition = pos;
          this.renderContent();
        }
      });
    });

    // Column mode
    content.querySelectorAll<HTMLElement>('[data-colmode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.colmode as ColumnMode;
        if (mode && mode !== this.columnMode) {
          this.columnMode = mode;
          this.renderContent();
        }
      });
    });

    // Sort headers
    content.querySelectorAll<HTMLElement>('[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort!;
        if (this.sortKey === key) {
          this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortKey = key;
          this.sortDir = key === 'name' || key === 'age' ? 'asc' : 'desc';
        }
        this.renderContent();
      });
    });

    // Individual checkboxes
    content.querySelectorAll<HTMLInputElement>('.draft-check').forEach(cb => {
      cb.addEventListener('change', () => {
        const pid = parseInt(cb.dataset.pid!, 10);
        if (cb.checked) {
          if (!this.draftBoardIds.includes(pid)) this.draftBoardIds.push(pid);
        } else {
          this.draftBoardIds = this.draftBoardIds.filter(id => id !== pid);
        }
        this.saveBoard();
        this.updateBoardCount();
        cb.closest('tr')?.classList.toggle('row-selected', cb.checked);
      });
    });

    // Check all
    content.querySelector<HTMLInputElement>('.draft-check-all')?.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      const filtered = this.getFilteredPlayers();
      if (checked) {
        const boardSet = new Set(this.draftBoardIds);
        for (const p of filtered) {
          if (!boardSet.has(p.id)) this.draftBoardIds.push(p.id);
        }
      } else {
        const removeSet = new Set(filtered.map(p => p.id));
        this.draftBoardIds = this.draftBoardIds.filter(id => !removeSet.has(id));
      }
      this.saveBoard();
      this.renderContent();
    });

    // Add All button
    content.querySelector('#draft-add-all')?.addEventListener('click', () => {
      const boardSet = new Set(this.draftBoardIds);
      for (const p of this.getFilteredPlayers()) {
        if (!boardSet.has(p.id)) this.draftBoardIds.push(p.id);
      }
      this.saveBoard();
      this.renderContent();
    });

    this.bindNameClicks(content);
  }

  private bindDraftBoardEvents(content: HTMLElement): void {
    // Remove individual
    content.querySelectorAll<HTMLElement>('.draft-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = parseInt(btn.dataset.pid!, 10);
        this.draftBoardIds = this.draftBoardIds.filter(id => id !== pid);
        this.saveBoard();
        this.renderContent();
        this.updateBoardCount();
      });
    });

    // Clear all
    content.querySelector('#draft-clear-all')?.addEventListener('click', () => {
      this.draftBoardIds = [];
      this.boardSortKey = null;
      this.saveBoard();
      this.renderContent();
      this.updateBoardCount();
    });

    // Board column sort headers
    content.querySelectorAll<HTMLElement>('.board-sort-header').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.bsort!;
        if (this.boardSortKey === key) {
          this.boardSortDir = this.boardSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.boardSortKey = key;
          // Default direction: lower-is-better for FIP/age, higher for everything else
          this.boardSortDir = (key === 'age' || key === 'keyStat') ? 'asc' : 'desc';
        }
        this.renderContent();
      });
    });

    // Apply sorted order as new board rankings
    content.querySelector('#board-apply-sort')?.addEventListener('click', () => {
      if (this.boardSortKey === null) return;
      // Rebuild draftBoardIds in current display order
      const playerMap = new Map(this.allPlayers.map(p => [p.id, p]));
      const boardPlayers = this.draftBoardIds.map(id => playerMap.get(id)).filter(Boolean) as DraftPlayer[];
      const key = this.boardSortKey!;
      const dir = this.boardSortDir === 'asc' ? 1 : -1;
      boardPlayers.sort((a, b) => {
        let va: number, vb: number;
        if (key === 'name') return dir * a.name.localeCompare(b.name);
        if (key === 'tfrStar') { va = a.tfrStar; vb = b.tfrStar; }
        else if (key === 'age') { va = a.age; vb = b.age; }
        else if (key === 'war') { va = a.projStats?.war ?? 0; vb = b.projStats?.war ?? 0; }
        else if (key === 'keyStat') {
          va = a.type === 'pitcher' ? (a.projStats?.fip ?? 99) : (a.projStats?.opsPlus ?? 0);
          vb = b.type === 'pitcher' ? (b.projStats?.fip ?? 99) : (b.projStats?.opsPlus ?? 0);
        }
        else { va = 0; vb = 0; }
        return dir * (va - vb);
      });
      this.draftBoardIds = boardPlayers.map(p => p.id);
      this.boardSortKey = null;
      this.saveBoard();
      this.renderContent();
    });

    // Reset to board order
    content.querySelector('#board-reset-sort')?.addEventListener('click', () => {
      this.boardSortKey = null;
      this.renderContent();
    });

    // Drag and drop reordering (only when not temp-sorted)
    if (this.boardSortKey !== null) return; // Skip drag binding during temp sort
    const rows = content.querySelectorAll<HTMLElement>('.board-row');
    rows.forEach(row => {
      row.addEventListener('dragstart', (e) => {
        this.dragSourceIndex = this.draftBoardIds.indexOf(parseInt(row.dataset.pid!, 10));
        row.classList.add('dragging');
        e.dataTransfer!.effectAllowed = 'move';
      });

      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        this.dragSourceIndex = null;
        content.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      });

      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer!.dropEffect = 'move';
        content.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        row.classList.add('drag-over');
      });

      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over');
      });

      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        if (this.dragSourceIndex === null) return;

        const targetPid = parseInt(row.dataset.pid!, 10);
        const targetIndex = this.draftBoardIds.indexOf(targetPid);
        if (targetIndex === -1 || this.dragSourceIndex === targetIndex) return;

        // Reorder
        const [moved] = this.draftBoardIds.splice(this.dragSourceIndex, 1);
        this.draftBoardIds.splice(targetIndex, 0, moved);
        this.dragSourceIndex = null;
        this.saveBoard();
        this.renderContent();
      });
    });

    this.bindNameClicks(content);
  }

  private updateBoardCount(): void {
    const countEl = this.container.querySelector('.board-count');
    if (countEl) countEl.textContent = `(${this.draftBoardIds.length})`;
  }

  private bindNameClicks(content: HTMLElement): void {
    content.querySelectorAll<HTMLElement>('.draft-name').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const pid = parseInt(btn.dataset.pid!, 10);
        const player = this.allPlayers.find(p => p.id === pid);
        if (!player) return;
        const year = await dateService.getCurrentYear();

        if (player.type === 'pitcher') {
          const profileData: any = {
            playerId: pid,
            playerName: player.name,
            age: player.age,
            position: player.posLabel,
            positionLabel: player.posLabel,
            isProspect: true,
            trueFutureRating: player.tfrStar,
            estimatedStuff: player.tfrRatings?.stuff ?? player.scoutRatings?.stuff,
            estimatedControl: player.tfrRatings?.control ?? player.scoutRatings?.control,
            estimatedHra: player.tfrRatings?.hra ?? player.scoutRatings?.hra,
            projK9: player.projStats?.k9,
            projBb9: player.projStats?.bb9,
            projHr9: player.projStats?.hr9,
            projFip: player.projStats?.fip,
            projWar: player.projStats?.war,
            projIp: player.projStats?.ip,
          };
          await pitcherProfileModal.show(profileData, year);
        } else {
          const BatterProfileModule = await import('./BatterProfileModal');
          const batterData: any = {
            playerId: pid,
            playerName: player.name,
            age: player.age,
            position: player.position,
            positionLabel: player.posLabel,
            isProspect: true,
            hasTfrUpside: true,
            trueFutureRating: player.tfrStar,
            estimatedPower: player.tfrRatings?.power ?? player.scoutRatings?.power,
            estimatedEye: player.tfrRatings?.eye ?? player.scoutRatings?.eye,
            estimatedAvoidK: player.tfrRatings?.avoidK ?? player.scoutRatings?.avoidK,
            estimatedContact: player.tfrRatings?.contact ?? player.scoutRatings?.contact,
            estimatedGap: player.tfrRatings?.gap ?? player.scoutRatings?.gap,
            estimatedSpeed: player.tfrRatings?.speed ?? player.scoutRatings?.speed,
            projWoba: player.projStats?.woba,
            projAvg: player.projStats?.avg,
            projObp: player.projStats?.obp,
            projSlg: player.projStats?.slg,
            projWar: player.projStats?.war,
            projPa: player.projStats?.pa,
            projHr: player.projStats?.hr,
            projWrcPlus: player.projStats?.opsPlus,
          };
          const modal = new BatterProfileModule.BatterProfileModal();
          await modal.show(batterData, year);
        }
      });
    });
  }
}
