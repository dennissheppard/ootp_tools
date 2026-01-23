import { TruePlayerStats, TruePlayerBattingStats, trueRatingsService } from '../services/TrueRatingsService';

type StatsMode = 'pitchers' | 'batters';

export class TrueRatingsView {
  private container: HTMLElement;
  private stats: (TruePlayerStats | TruePlayerBattingStats)[] = [];
  private currentPage = 1;
  private itemsPerPage = 50;
  private selectedYear = 2020;
  private yearOptions = Array.from({ length: 22 }, (_, i) => 2021 - i); // 2021 down to 2000
  private sortKey: string | null = 'war';
  private sortDirection: 'asc' | 'desc' = 'desc';
  private mode: StatsMode = 'pitchers';

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderLayout();
    this.fetchAndRenderStats();
  }

  private renderLayout(): void {
    this.container.innerHTML = `
      <div class="true-ratings-content">
        <div class="draft-header">
            <h2 class="view-title">True Player Ratings</h2>
            <div class="toggle-group" role="tablist" aria-label="Stats type">
                <button class="toggle-btn active" data-mode="pitchers" role="tab" aria-selected="true">Pitchers</button>
                <button class="toggle-btn" data-mode="batters" role="tab" aria-selected="false">Batters</button>
            </div>
        </div>
        <div class="true-ratings-controls">
          <div class="form-field">
            <label for="true-ratings-year">Year:</label>
            <select id="true-ratings-year">
              ${this.yearOptions.map(year => `<option value="${year}" ${year === this.selectedYear ? 'selected' : ''}>${year}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label for="items-per-page">Per Page:</label>
            <select id="items-per-page">
              <option value="10">10</option>
              <option value="50" selected>50</option>
              <option value="200">200</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>
        <div id="true-ratings-table-container"></div>
        <div class="pagination-controls">
          <button id="prev-page" disabled>Previous</button>
          <span id="page-info"></span>
          <button id="next-page" disabled>Next</button>
        </div>
      </div>
    `;

    this.bindEventListeners();
  }

  private bindEventListeners(): void {
    this.container.querySelector('#true-ratings-year')?.addEventListener('change', (e) => {
      this.selectedYear = parseInt((e.target as HTMLSelectElement).value, 10);
      this.currentPage = 1;
      this.fetchAndRenderStats();
    });

    this.container.querySelector('#items-per-page')?.addEventListener('change', (e) => {
      const value = (e.target as HTMLSelectElement).value;
      this.itemsPerPage = value === 'all' ? this.stats.length : parseInt(value, 10);
      this.currentPage = 1;
      this.renderStats();
    });

    this.container.querySelector('#prev-page')?.addEventListener('click', () => {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.renderStats();
      }
    });

    this.container.querySelector('#next-page')?.addEventListener('click', () => {
      const totalPages = this.itemsPerPage === this.stats.length ? 1 : Math.ceil(this.stats.length / this.itemsPerPage);
      if (this.currentPage < totalPages) {
        this.currentPage++;
        this.renderStats();
      }
    });

    this.container.querySelectorAll<HTMLButtonElement>('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const newMode = btn.dataset.mode as StatsMode;
        if (this.mode !== newMode) {
          this.mode = newMode;
          this.sortKey = 'war';
          this.sortDirection = 'desc';
          this.container.querySelectorAll<HTMLButtonElement>('.toggle-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.fetchAndRenderStats();
        }
      });
    });
  }

  private async fetchAndRenderStats(): Promise<void> {
    const tableContainer = this.container.querySelector<HTMLElement>('#true-ratings-table-container')!;
    tableContainer.innerHTML = '<div class="loading-message">Loading stats...</div>';
    
    try {
      this.stats = this.mode === 'pitchers'
        ? await trueRatingsService.getTruePitchingStats(this.selectedYear)
        : await trueRatingsService.getTrueBattingStats(this.selectedYear);
      
      if (this.itemsPerPage > this.stats.length) {
          this.itemsPerPage = this.stats.length;
      }
      this.sortStats();
      this.renderStats();
    } catch (error) {
      tableContainer.innerHTML = `<div class="error-message">Failed to load stats. ${error}</div>`;
    }
  }

  private renderStats(): void {
    const tableContainer = this.container.querySelector<HTMLElement>('#true-ratings-table-container')!;
    if (this.stats.length === 0) {
      tableContainer.innerHTML = `<p class="no-stats">No ${this.mode} stats found for this year.</p>`;
      this.updatePaginationControls(0);
      return;
    }

    const paginatedStats = this.getPaginatedStats();
    tableContainer.innerHTML = this.renderTable(paginatedStats);
    this.updatePaginationControls(this.stats.length);
    this.bindSortHeaders();
    this.bindScrollButtons();
  }

  private getPaginatedStats(): (TruePlayerStats | TruePlayerBattingStats)[] {
      if (this.itemsPerPage === this.stats.length) {
          return this.stats;
      }
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = this.currentPage * this.itemsPerPage;
    return this.stats.slice(startIndex, endIndex);
  }

  private renderTable(stats: (TruePlayerStats | TruePlayerBattingStats)[]): string {
    if (stats.length === 0) return '';

    const batterExcludedKeys = ['ci', 'd', 'game_id', 'id', 'league_id', 'level_id', 'pitches_seen', 'position', 'sf', 'sh', 'split_id', 'stint', 't'];
    const excludedKeys = ['id', 'player_id', 'team_id', 'game_id', 'league_id', 'level_id', 'split_id', 'year', ...(this.mode === 'batters' ? batterExcludedKeys : [])];
    let headers = Object.keys(this.stats[0]).filter(key => !excludedKeys.includes(key));
    
    headers = headers.filter(h => h !== 'playerName');
    headers.unshift('playerName');

    const headerRow = headers.map(header => {
      const activeClass = this.sortKey === header ? 'sort-active' : '';
      return `<th data-sort-key="${header}" class="${activeClass}">${this.formatHeader(header)}</th>`;
    }).join('');
    
    const rows = stats.map(s => {
      const cells = headers.map(header => {
        let value: any = (s as any)[header];
        if (typeof value === 'number') {
            if (value % 1 !== 0) {
                value = (header === 'avg' || header === 'obp') ? value.toFixed(3) : value.toFixed(2);
            }        }
        return `<td>${value}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    return `
      <div class="table-wrapper-outer">
        <button class="scroll-btn scroll-btn-left" aria-label="Scroll left"></button>
        <div class="table-wrapper">
          <table class="stats-table true-ratings-table">
            <thead>
              <tr>
                ${headerRow}
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
        <button class="scroll-btn scroll-btn-right" aria-label="Scroll right"></button>
      </div>
    `;
  }

    private bindScrollButtons(): void {
        const wrapper = this.container.querySelector<HTMLElement>('.table-wrapper-outer');
        if (!wrapper) return;

        const tableWrapper = wrapper.querySelector<HTMLElement>('.table-wrapper');
        const scrollLeftBtn = wrapper.querySelector<HTMLButtonElement>('.scroll-btn-left');
        const scrollRightBtn = wrapper.querySelector<HTMLButtonElement>('.scroll-btn-right');

        if (!tableWrapper || !scrollLeftBtn || !scrollRightBtn) return;

        const handleScroll = () => {
            const { scrollLeft, scrollWidth, clientWidth } = tableWrapper;
            const canScrollLeft = scrollLeft > 0;
            const canScrollRight = scrollLeft < scrollWidth - clientWidth -1;
            
            scrollLeftBtn.classList.toggle('visible', canScrollLeft);
            scrollRightBtn.classList.toggle('visible', canScrollRight);
        };
        
        wrapper.addEventListener('mouseenter', handleScroll);
        wrapper.addEventListener('mouseleave', () => {
            scrollLeftBtn.classList.remove('visible');
            scrollRightBtn.classList.remove('visible');
        });
        tableWrapper.addEventListener('scroll', handleScroll);

        scrollLeftBtn.addEventListener('click', () => {
            tableWrapper.scrollBy({ left: -200, behavior: 'smooth' });
        });

        scrollRightBtn.addEventListener('click', () => {
            tableWrapper.scrollBy({ left: 200, behavior: 'smooth' });
        });

        handleScroll();
    }

  private bindSortHeaders(): void {
    const headers = this.container.querySelectorAll<HTMLElement>('[data-sort-key]');
    headers.forEach(header => {
      header.addEventListener('click', (e) => {
        const key = header.dataset.sortKey;
        if (!key) return;

        if (this.sortKey === key) {
          this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortKey = key;
          this.sortDirection = 'desc';
        }
        this.showSortHint(e as MouseEvent);
        this.sortStats();
        this.renderStats();
      });
    });
  }

  private sortStats(): void {
    if (!this.sortKey) return;
    const key = this.sortKey as keyof (TruePlayerStats | TruePlayerBattingStats);

    this.stats.sort((a, b) => {
      const aVal = a[key];
      const bVal = b[key];
      
      let compare = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        compare = aVal - bVal;
      } else if (typeof aVal === 'string' && typeof bVal === 'string') {
        compare = aVal.localeCompare(bVal);
      }

      return this.sortDirection === 'asc' ? compare : -compare;
    });
  }
  
  private formatHeader(header: string): string {
    return header
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .replace(/_id/g, '')
      .replace(/^ip$/, 'IP')
      .replace(/^ha$/, 'H')
      .replace(/^er$/, 'ER')
      .replace(/^k$/, 'K')
      .replace(/^hr$/, 'HR')
      .replace(/^war$/, 'WAR')
      .replace(/^bb$/, 'BB')
      .replace(/^obp$/, 'OBP')
      .replace(/^avg$/, 'AVG')
      .replace(/^\w/, c => c.toUpperCase())
      .trim();
  }

  private showSortHint(event: MouseEvent): void {
    const arrow = document.createElement('div');
    arrow.className = 'sort-fade-hint';
    arrow.textContent = this.sortDirection === 'asc' ? '⬆️' : '⬇️';
    const offset = 16;
    arrow.style.left = `${event.clientX + offset}px`;
    arrow.style.top = `${event.clientY - offset}px`;
    document.body.appendChild(arrow);

    requestAnimationFrame(() => {
      arrow.classList.add('visible');
    });

    setTimeout(() => {
      arrow.classList.add('fade');
      arrow.addEventListener('transitionend', () => arrow.remove(), { once: true });
      setTimeout(() => arrow.remove(), 800);
    }, 900);
  }

  private updatePaginationControls(totalItems: number): void {
    const totalPages = this.itemsPerPage === totalItems ? 1 : Math.ceil(totalItems / this.itemsPerPage);
    const pageInfo = this.container.querySelector<HTMLElement>('#page-info')!;
    const prevButton = this.container.querySelector<HTMLButtonElement>('#prev-page')!;
    const nextButton = this.container.querySelector<HTMLButtonElement>('#next-page')!;

    if (totalPages <= 1) {
        pageInfo.textContent = '';
        prevButton.disabled = true;
        nextButton.disabled = true;
        return;
    }
    
    pageInfo.textContent = `Page ${this.currentPage} of ${totalPages}`;
    prevButton.disabled = this.currentPage === 1;
    nextButton.disabled = this.currentPage === totalPages;
  }
}
