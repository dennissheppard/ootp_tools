import { Contract } from '../services/ContractService';
import { contractService } from '../services/ContractService';
import { Player, getPositionLabel } from '../models/Player';

// Position compatibility: which player positions (enum values) can play each grid slot
const POSITION_ELIGIBILITY: Record<string, number[]> = {
  'C':   [2],
  '1B':  [3, 6],
  '2B':  [4, 6],
  'SS':  [6],
  '3B':  [5, 6],
  'LF':  [7, 8, 9],
  'CF':  [8],
  'RF':  [9, 7, 8],
  'DH':  [2, 3, 4, 5, 6, 7, 8, 9, 10],
};

// --- Types ---

export type CellEditAction = 'cancel' | 'clear' | 'extend' | 'org-select' | 'search-select' | 'dev-override-set' | 'dev-override-remove';
export type OverrideSourceType = 'extend' | 'org' | 'trade-target' | 'fa-target';

export interface CellEditResult {
  action: CellEditAction;
  player?: Player;
  sourceType?: OverrideSourceType;
  extensionYears?: number;
  rating?: number;
  level?: string;
  devOverridePlayerId?: number;
}

export interface CellEditContext {
  position: string;
  year: number;
  section: 'lineup' | 'rotation' | 'bullpen';
  currentCell: { playerId: number | null; playerName: string; age: number; rating: number } | null;
  incumbentCell: { playerId: number | null; playerName: string; age: number; rating: number } | null;
  teamId: number;
  gameYear: number;
  currentPlayerTfr?: number;
  currentPlayerDevOverride?: boolean;
}

type OrgSortColumn = 'name' | 'position' | 'age' | 'rating';
type OrgSortDirection = 'asc' | 'desc';

export class CellEditModal {
  private overlay: HTMLElement;
  private resolvePromise: ((result: CellEditResult) => void) | null = null;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private orgSortColumn: OrgSortColumn = 'rating';
  private orgSortDirection: OrgSortDirection = 'desc';

  // Drag state
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private boundDragMove: ((e: MouseEvent) => void) | null = null;
  private boundDragEnd: ((e: MouseEvent) => void) | null = null;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'cell-edit-modal-overlay';
    this.overlay.innerHTML = '<div class="cell-edit-modal"></div>';
    document.body.appendChild(this.overlay);

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.dismiss();
    });
  }

  show(
    context: CellEditContext,
    orgPlayers: Player[],
    allPlayers: Player[],
    contractMap: Map<number, Contract>,
    playerRatingMap?: Map<number, number>,
    projectedDataMap?: Map<number, { projectedAge: number; projectedRating: number }>,
  ): Promise<CellEditResult> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      const modal = this.overlay.querySelector<HTMLElement>('.cell-edit-modal')!;

      const hasIncumbent = context.incumbentCell && context.incumbentCell.playerId;
      const incumbentPlayer = hasIncumbent ? allPlayers.find(p => p.id === context.incumbentCell!.playerId) : null;

      let currentInfo = '';
      if (context.currentCell && context.currentCell.playerId) {
        const tfrStr = context.currentPlayerTfr !== undefined
          ? ` | ${context.currentPlayerTfr.toFixed(1)} TFR` : '';

        let devBtn = '';
        if (context.currentPlayerDevOverride) {
          // Override is active — show remove option
          devBtn = `<button class="cell-edit-dev-btn cell-edit-dev-remove" data-player-id="${context.currentCell.playerId}">Remove development override</button>`;
        } else if (context.currentPlayerTfr !== undefined && context.currentPlayerTfr > context.currentCell.rating) {
          // Player has unrealized upside — show set option
          devBtn = `<button class="cell-edit-dev-btn" data-player-id="${context.currentCell.playerId}">Set as fully developed</button>`;
        }

        currentInfo = `
          <div class="cell-edit-current">
            <div class="cell-edit-current-label">Current occupant</div>
            <div class="cell-edit-current-name">${context.currentCell.playerName}</div>
            <div class="cell-edit-current-meta">Age ${context.currentCell.age} | ${context.currentCell.rating.toFixed(1)} rating${tfrStr}</div>
            ${devBtn}
          </div>
        `;
      }

      let extendSection = '';
      if (hasIncumbent && incumbentPlayer) {
        extendSection = `
          <div class="cell-edit-action-section">
            <button class="cell-edit-action-btn" data-action="extend-toggle">
              <span class="action-icon">&#x21A9;</span>
              Extend ${context.incumbentCell!.playerName}
            </button>
            <div class="cell-edit-extend-options" style="display:none;">
              <div class="extend-label">Extension length:</div>
              <div class="extend-buttons">
                ${[1,2,3,4,5].map(y =>
                  `<button class="extend-year-btn" data-years="${y}">${y} yr${y > 1 ? 's' : ''}</button>`
                ).join('')}
              </div>
            </div>
          </div>
        `;
      }

      modal.innerHTML = `
        <div class="cell-edit-header">
          <h3>Edit: ${context.position} — ${context.year}</h3>
          <button class="cell-edit-close">&times;</button>
        </div>
        ${currentInfo}
        <div class="cell-edit-actions">
          ${extendSection}
          <div class="cell-edit-action-section">
            <button class="cell-edit-action-btn" data-action="org-toggle">
              <span class="action-icon">&#x1F3E2;</span>
              Choose from your org
            </button>
            <div class="cell-edit-player-list cell-edit-org-list" style="display:none;"></div>
          </div>
          <div class="cell-edit-action-section">
            <button class="cell-edit-action-btn" data-action="search-toggle">
              <span class="action-icon">&#x1F50D;</span>
              Search for a player
            </button>
            <div class="cell-edit-search-section" style="display:none;">
              <input type="text" class="cell-edit-search-input" placeholder="Type player name..." />
              <div class="cell-edit-player-list cell-edit-search-list"></div>
            </div>
          </div>
        </div>
        <div class="cell-edit-footer">
          <button class="cell-edit-footer-btn cell-edit-clear-btn">Clear Cell</button>
          <button class="cell-edit-footer-btn cell-edit-cancel-btn">Cancel</button>
        </div>
      `;

      // Bind close/cancel/clear
      modal.querySelector('.cell-edit-close')?.addEventListener('click', () => this.dismiss());
      modal.querySelector('.cell-edit-cancel-btn')?.addEventListener('click', () => this.dismiss());
      modal.querySelector('.cell-edit-clear-btn')?.addEventListener('click', () => {
        this.resolve({ action: 'clear' });
      });

      // Dev override toggle
      const devBtn = modal.querySelector<HTMLButtonElement>('.cell-edit-dev-btn');
      if (devBtn) {
        const playerId = parseInt(devBtn.dataset.playerId!, 10);
        const isRemove = devBtn.classList.contains('cell-edit-dev-remove');
        devBtn.addEventListener('click', () => {
          this.resolve({
            action: isRemove ? 'dev-override-remove' : 'dev-override-set',
            devOverridePlayerId: playerId,
          });
        });
      }

      // Extend toggle
      modal.querySelector('[data-action="extend-toggle"]')?.addEventListener('click', () => {
        const opts = modal.querySelector<HTMLElement>('.cell-edit-extend-options');
        if (opts) opts.style.display = opts.style.display === 'none' ? 'block' : 'none';
      });

      // Extend year buttons
      modal.querySelectorAll<HTMLButtonElement>('.extend-year-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const years = parseInt(btn.dataset.years!, 10);
          this.resolve({
            action: 'extend',
            player: incumbentPlayer ?? undefined,
            sourceType: 'extend',
            extensionYears: years,
            rating: context.incumbentCell?.rating ?? 0,
          });
        });
      });

      // Org list toggle
      modal.querySelector('[data-action="org-toggle"]')?.addEventListener('click', () => {
        const list = modal.querySelector<HTMLElement>('.cell-edit-org-list');
        if (!list) return;
        if (list.style.display === 'none') {
          list.style.display = 'block';
          this.populateOrgList(list, orgPlayers, context, playerRatingMap, projectedDataMap);
        } else {
          list.style.display = 'none';
        }
      });

      // Search toggle
      modal.querySelector('[data-action="search-toggle"]')?.addEventListener('click', () => {
        const section = modal.querySelector<HTMLElement>('.cell-edit-search-section');
        if (!section) return;
        section.style.display = section.style.display === 'none' ? 'block' : 'none';
        if (section.style.display === 'block') {
          const input = section.querySelector<HTMLInputElement>('.cell-edit-search-input');
          input?.focus();
        }
      });

      // Search input
      const searchInput = modal.querySelector<HTMLInputElement>('.cell-edit-search-input');
      const searchList = modal.querySelector<HTMLElement>('.cell-edit-search-list');
      if (searchInput && searchList) {
        let debounceTimer: number | undefined;
        searchInput.addEventListener('input', () => {
          clearTimeout(debounceTimer);
          debounceTimer = window.setTimeout(() => {
            this.populateSearchList(searchList, allPlayers, contractMap, context, searchInput.value.trim());
          }, 200);
        });
      }

      // Reset modal position for each show (center it)
      modal.style.left = '';
      modal.style.top = '';
      modal.style.transform = '';
      modal.classList.remove('cell-edit-modal-dragged');

      // Make modal draggable by its header
      this.initDrag(modal);

      // Show overlay
      this.overlay.style.display = 'flex';

      this.boundKeyHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') this.dismiss();
      };
      document.addEventListener('keydown', this.boundKeyHandler);
    });
  }

  private initDrag(modal: HTMLElement): void {
    const header = modal.querySelector<HTMLElement>('.cell-edit-header');
    if (!header) return;

    header.style.cursor = 'move';

    header.addEventListener('mousedown', (e: MouseEvent) => {
      // Don't drag if clicking the close button
      if ((e.target as HTMLElement).closest('.cell-edit-close')) return;

      e.preventDefault();
      this.isDragging = true;

      const rect = modal.getBoundingClientRect();
      this.dragOffsetX = e.clientX - rect.left;
      this.dragOffsetY = e.clientY - rect.top;

      // Switch from centered to absolute positioning on first drag
      if (!modal.classList.contains('cell-edit-modal-dragged')) {
        modal.style.left = `${rect.left}px`;
        modal.style.top = `${rect.top}px`;
        modal.classList.add('cell-edit-modal-dragged');
      }

      this.boundDragMove = (ev: MouseEvent) => {
        if (!this.isDragging) return;
        const x = Math.max(0, Math.min(ev.clientX - this.dragOffsetX, window.innerWidth - rect.width));
        const y = Math.max(0, Math.min(ev.clientY - this.dragOffsetY, window.innerHeight - 40));
        modal.style.left = `${x}px`;
        modal.style.top = `${y}px`;
      };

      this.boundDragEnd = () => {
        this.isDragging = false;
        if (this.boundDragMove) document.removeEventListener('mousemove', this.boundDragMove);
        if (this.boundDragEnd) document.removeEventListener('mouseup', this.boundDragEnd);
        this.boundDragMove = null;
        this.boundDragEnd = null;
      };

      document.addEventListener('mousemove', this.boundDragMove);
      document.addEventListener('mouseup', this.boundDragEnd);
    });
  }

  private populateOrgList(
    container: HTMLElement,
    orgPlayers: Player[],
    context: CellEditContext,
    ratingMap?: Map<number, number>,
    projectedDataMap?: Map<number, { projectedAge: number; projectedRating: number }>,
  ): void {
    const isPitcherSlot = context.section === 'rotation' || context.section === 'bullpen';
    const eligible = POSITION_ELIGIBILITY[context.position];
    const filtered = orgPlayers.filter(p => {
      if (isPitcherSlot) return p.position === 1;
      if (eligible) return eligible.includes(p.position);
      return p.position !== 1;
    });

    if (filtered.length === 0) {
      container.innerHTML = '<div class="cell-edit-no-results">No eligible org players found.</div>';
      return;
    }

    // Build display data for sorting
    const displayData = filtered.map(p => {
      const proj = projectedDataMap?.get(p.id);
      const displayAge = proj ? proj.projectedAge : p.age;
      const rating = proj ? proj.projectedRating : ratingMap?.get(p.id) ?? 0;
      return { player: p, displayAge, rating };
    });

    const renderList = () => {
      // Sort
      displayData.sort((a, b) => {
        const dir = this.orgSortDirection === 'asc' ? 1 : -1;
        switch (this.orgSortColumn) {
          case 'name':
            return dir * (`${a.player.firstName} ${a.player.lastName}`).localeCompare(`${b.player.firstName} ${b.player.lastName}`);
          case 'position':
            return dir * (getPositionLabel(a.player.position).localeCompare(getPositionLabel(b.player.position)));
          case 'age':
            return dir * (a.displayAge - b.displayAge);
          case 'rating':
            return dir * (a.rating - b.rating);
          default:
            return 0;
        }
      });

      const noteHtml = context.year > context.gameYear
        ? `<div class="cell-edit-projection-note">Projected age &amp; rating for ${context.year}</div>`
        : '';

      const arrow = (col: OrgSortColumn) =>
        this.orgSortColumn === col ? (this.orgSortDirection === 'asc' ? ' \u25B2' : ' \u25BC') : '';

      const headerHtml = `
        <div class="cell-edit-org-header">
          <span class="org-header-col org-header-name" data-sort="name">Name${arrow('name')}</span>
          <span class="org-header-col org-header-pos" data-sort="position">Pos${arrow('position')}</span>
          <span class="org-header-col org-header-age" data-sort="age">Age${arrow('age')}</span>
          <span class="org-header-col org-header-rating" data-sort="rating">Rating${arrow('rating')}</span>
        </div>
      `;

      const rowsHtml = displayData.map(d => {
        const ratingStr = d.rating ? `<span class="player-item-rating">${d.rating.toFixed(1)}</span>` : '';
        return `
          <div class="cell-edit-player-item" data-player-id="${d.player.id}">
            <span class="player-item-name">${d.player.firstName} ${d.player.lastName}</span>
            <span class="player-item-pos">${getPositionLabel(d.player.position)}</span>
            <span class="player-item-age">${d.displayAge}</span>
            ${ratingStr}
          </div>
        `;
      }).join('');

      container.innerHTML = noteHtml + headerHtml + rowsHtml;

      // Bind sort headers
      container.querySelectorAll<HTMLElement>('.org-header-col').forEach(hdr => {
        hdr.addEventListener('click', () => {
          const col = hdr.dataset.sort as OrgSortColumn;
          if (this.orgSortColumn === col) {
            this.orgSortDirection = this.orgSortDirection === 'asc' ? 'desc' : 'asc';
          } else {
            this.orgSortColumn = col;
            this.orgSortDirection = col === 'name' || col === 'position' ? 'asc' : 'desc';
          }
          renderList();
        });
      });

      // Bind player selection
      container.querySelectorAll<HTMLElement>('.cell-edit-player-item').forEach(el => {
        el.addEventListener('click', () => {
          const id = parseInt(el.dataset.playerId!, 10);
          const player = orgPlayers.find(p => p.id === id);
          if (player) {
            this.resolve({
              action: 'org-select',
              player,
              sourceType: 'org',
            });
          }
        });
      });
    };

    renderList();
  }

  private populateSearchList(
    container: HTMLElement,
    allPlayers: Player[],
    contractMap: Map<number, Contract>,
    context: CellEditContext,
    query: string,
  ): void {
    if (query.length < 2) {
      container.innerHTML = '<div class="cell-edit-no-results">Type at least 2 characters...</div>';
      return;
    }

    const lowerQuery = query.toLowerCase();
    const results = allPlayers.filter(p => {
      const name = `${p.firstName} ${p.lastName}`.toLowerCase();
      return name.includes(lowerQuery);
    }).slice(0, 50);

    if (results.length === 0) {
      container.innerHTML = '<div class="cell-edit-no-results">No players found.</div>';
      return;
    }

    container.innerHTML = results.map(p => {
      const sourceType = this.determineSourceType(p, contractMap, context);
      const badge = sourceType === 'trade-target' ? '<span class="search-badge badge-trade">TRADE</span>'
        : sourceType === 'fa-target' ? '<span class="search-badge badge-fa">FA</span>'
        : '<span class="search-badge badge-org">ORG</span>';
      return `
        <div class="cell-edit-player-item" data-player-id="${p.id}" data-source-type="${sourceType}">
          <span class="player-item-name">${p.firstName} ${p.lastName}</span>
          <span class="player-item-meta">${getPositionLabel(p.position)} | Age ${p.age} ${badge}</span>
        </div>
      `;
    }).join('');

    container.querySelectorAll<HTMLElement>('.cell-edit-player-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = parseInt(el.dataset.playerId!, 10);
        const sourceType = el.dataset.sourceType as OverrideSourceType;
        const player = allPlayers.find(p => p.id === id);
        if (player) {
          this.resolve({
            action: 'search-select',
            player,
            sourceType,
          });
        }
      });
    });
  }

  private determineSourceType(
    player: Player,
    contractMap: Map<number, Contract>,
    context: CellEditContext,
  ): OverrideSourceType {
    // If the player is in the user's org
    if (player.parentTeamId === context.teamId || player.teamId === context.teamId) {
      return 'org';
    }

    const contract = contractMap.get(player.id);
    if (!contract) return 'fa-target';

    const faYear = context.gameYear + contractService.getYearsRemaining(contract);
    return context.year < faYear ? 'trade-target' : 'fa-target';
  }

  private resolve(result: CellEditResult): void {
    this.hide();
    if (this.resolvePromise) {
      this.resolvePromise(result);
      this.resolvePromise = null;
    }
  }

  private dismiss(): void {
    this.resolve({ action: 'cancel' });
  }

  private hide(): void {
    this.overlay.style.display = 'none';
    if (this.boundKeyHandler) {
      document.removeEventListener('keydown', this.boundKeyHandler);
      this.boundKeyHandler = null;
    }
    // Clean up any in-progress drag
    if (this.boundDragMove) {
      document.removeEventListener('mousemove', this.boundDragMove);
      this.boundDragMove = null;
    }
    if (this.boundDragEnd) {
      document.removeEventListener('mouseup', this.boundDragEnd);
      this.boundDragEnd = null;
    }
    this.isDragging = false;
  }
}
