export interface SearchViewOptions {
  onSearch: (query: string, year?: number) => void;
  years: { start: number; end: number };
}

export class SearchView {
  private container: HTMLElement;
  private searchInput!: HTMLInputElement;
  private yearSelect!: HTMLSelectElement;
  private searchButton!: HTMLButtonElement;
  private onSearch: (query: string, year?: number) => void;

  constructor(container: HTMLElement, options: SearchViewOptions) {
    this.container = container;
    this.onSearch = options.onSearch;
    this.render(options.years);
    this.attachEventListeners();
  }

  private render(years: { start: number; end: number }): void {
    this.container.innerHTML = `
      <div class="search-container">
        <div class="search-box">
          <input
            type="text"
            id="player-search"
            class="search-input"
            placeholder="Enter player name..."
            autocomplete="off"
          />
          <select id="year-select" class="year-select">
            <option value="">All Years</option>
            ${this.generateYearOptions(years.start, years.end)}
          </select>
          <button id="search-button" class="search-button">Search</button>
        </div>
      </div>
    `;

    this.searchInput = this.container.querySelector('#player-search')!;
    this.yearSelect = this.container.querySelector('#year-select')!;
    this.searchButton = this.container.querySelector('#search-button')!;
  }

  private generateYearOptions(start: number, end: number): string {
    const options: string[] = [];
    for (let year = end; year >= start; year--) {
      options.push(`<option value="${year}">${year}</option>`);
    }
    return options.join('');
  }

  private attachEventListeners(): void {
    this.searchButton.addEventListener('click', () => this.handleSearch());

    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.handleSearch();
      }
    });
  }

  private handleSearch(): void {
    const query = this.searchInput.value.trim();
    const yearValue = this.yearSelect.value;
    const year = yearValue ? parseInt(yearValue, 10) : undefined;

    this.onSearch(query, year);
  }

  setLoading(isLoading: boolean): void {
    this.searchButton.disabled = isLoading;
    this.searchButton.textContent = isLoading ? 'Searching...' : 'Search';
  }

  clear(): void {
    this.searchInput.value = '';
    this.yearSelect.value = '';
  }

  focus(): void {
    this.searchInput.focus();
  }
}
