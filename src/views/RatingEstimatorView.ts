import { RatingEstimatorService, StatInput, EstimatedRatings } from '../services/RatingEstimatorService';
import { leagueStatsService } from '../services/LeagueStatsService';
import { LeagueConstants } from '../services/FipWarService';

type ComparisonInputs = {
    stuff: { scout?: number; osa?: number };
    control: { scout?: number; osa?: number };
    hra: { scout?: number; osa?: number };
};

const AVAILABLE_YEARS = [2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011, 2010];

export class RatingEstimatorView {
    private container: HTMLElement;
    private selectedYear: number = 2020;
    private loadedLeagueYear: number | null = null;
    private leagueConstants: Partial<LeagueConstants> = {};
    private lastStats: StatInput | null = null;
    private lastComparison: ComparisonInputs | null = null;

    constructor(container: HTMLElement) {
        this.container = container;
        this.render();
        this.loadLeagueStats(this.selectedYear);
    }

    private render(): void {
        this.container.innerHTML = `
            <div class="rating-estimator-section">
                <h2 class="section-title">Rating Estimator</h2>
                <p class="section-subtitle">"How Accurate Is Your Scout?"</p>

                <div class="league-context-info">
                    <p id="estimator-league-info" class="league-info-text">Loading league data...</p>
                    <div class="year-selector">
                        <label for="estimator-league-year">FIP/WAR based on:</label>
                        <select id="estimator-league-year">
                            ${AVAILABLE_YEARS.map(y => `<option value="${y}" ${y === this.selectedYear ? 'selected' : ''}>${y}</option>`).join('')}
                        </select>
                    </div>
                </div>

                <form id="estimator-form" class="estimator-form">
                    <div class="rating-estimator-content">
                        <div class="estimator-input-container">
                            <h3 class="form-title">Player Stats</h3>
                            <div class="stat-inputs">
                                <div class="stat-field">
                                    <label for="stat-ip">IP</label>
                                    <input type="number" id="stat-ip" step="any" min="0" value="180">
                                </div>
                                <div class="stat-field">
                                    <label for="stat-k9">K/9</label>
                                    <input type="number" id="stat-k9" step="any" min="0" value="7.2">
                                </div>
                                <div class="stat-field">
                                    <label for="stat-bb9">BB/9</label>
                                    <input type="number" id="stat-bb9" step="any" min="0" value="2.5">
                                </div>
                                <div class="stat-field">
                                    <label for="stat-hr9">HR/9</label>
                                    <input type="number" id="stat-hr9" step="any" min="0" value="0.8">
                                </div>
                            </div>
                        </div>

                        <div class="estimator-comparison-container">
                            <h3 class="form-title">Comparison (optional)</h3>
                            <div class="comparison-inputs">
                                <div class="comparison-header">
                                    <span></span>
                                    <span>Scout</span>
                                    <span>OSA</span>
                                </div>
                                <div class="comparison-field">
                                    <label for="comp-stuff">Stuff</label>
                                    <input type="number" id="comp-stuff-scout" min="20" max="80" placeholder="--" />
                                    <input type="number" id="comp-stuff-osa" min="20" max="80" placeholder="--" />
                                </div>
                                <div class="comparison-field">
                                    <label for="comp-control">Control</label>
                                    <input type="number" id="comp-control-scout" min="20" max="80" placeholder="--" />
                                    <input type="number" id="comp-control-osa" min="20" max="80" placeholder="--" />
                                </div>
                                <div class="comparison-field">
                                    <label for="comp-hra">HRA</label>
                                    <input type="number" id="comp-hra-scout" min="20" max="80" placeholder="--" />
                                    <input type="number" id="comp-hra-osa" min="20" max="80" placeholder="--" />
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="btn btn-primary">Estimate Ratings</button>
                    </div>
                </form>

                <div class="estimator-output-container">
                    <h3 class="form-title">Estimated Ratings</h3>
                    <div id="estimator-results">
                        <p class="no-results">Enter stats and click "Estimate Ratings" to see results.</p>
                    </div>
                </div>
            </div>
        `;
        this.bindEvents();
    }

    private bindEvents(): void {
        const form = this.container.querySelector<HTMLFormElement>('#estimator-form');
        form?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleEstimate();
        });

        const yearSelect = this.container.querySelector<HTMLSelectElement>('#estimator-league-year');
        yearSelect?.addEventListener('change', (e) => {
            const year = Number((e.target as HTMLSelectElement).value);
            this.loadLeagueStats(year);
        });
    }

    private async handleEstimate(): Promise<void> {
        const getStatValue = (id: string): number => {
            const input = this.container.querySelector<HTMLInputElement>(`#${id}`);
            return Number(input?.value) || 0;
        };

        const getCompValue = (id: string): number | undefined => {
            const input = this.container.querySelector<HTMLInputElement>(`#${id}`);
            return input?.value ? Number(input.value) : undefined;
        };

        const stats: StatInput = {
            ip: getStatValue('stat-ip'),
            k9: getStatValue('stat-k9'),
            bb9: getStatValue('stat-bb9'),
            hr9: getStatValue('stat-hr9'),
        };

        const comparison: ComparisonInputs = {
            stuff: { scout: getCompValue('comp-stuff-scout'), osa: getCompValue('comp-stuff-osa') },
            control: { scout: getCompValue('comp-control-scout'), osa: getCompValue('comp-control-osa') },
            hra: { scout: getCompValue('comp-hra-scout'), osa: getCompValue('comp-hra-osa') },
        };

        this.lastStats = stats;
        this.lastComparison = comparison;

        const estimatedRatings = RatingEstimatorService.estimateAll(stats, this.leagueConstants);
        this.renderResults(estimatedRatings, comparison);
    }

    private renderResults(ratings: EstimatedRatings, comparison: ComparisonInputs): void {
        const resultsContainer = this.container.querySelector<HTMLDivElement>('#estimator-results');
        if (!resultsContainer) return;

        const renderComparison = (stat: 'control' | 'stuff' | 'hra') => {
            const scout = comparison[stat].scout;
            const osa = comparison[stat].osa;
            const estimated = ratings[stat];
            const verdict = scout ? RatingEstimatorService.compareToScout(estimated, scout) : '';

            return `
                <td>${scout ?? '--'}</td>
                <td>${osa ?? '--'}</td>
                <td class="verdict">${verdict}</td>
            `;
        }

        resultsContainer.innerHTML = `
            <table class="stats-table estimator-results-table">
                <thead>
                    <tr>
                        <th>Rating</th>
                        <th>Rating</th>
                        <th>Scout</th>
                        <th>OSA</th>
                        <th>Verdict</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Control</td>
                        <td>${ratings.control.rating}</td>
                        ${renderComparison('control')}
                    </tr>
                    <tr>
                        <td>Stuff</td>
                        <td>${ratings.stuff.rating}</td>
                        ${renderComparison('stuff')}
                    </tr>
                    <tr>
                        <td>HRA</td>
                        <td>${ratings.hra.rating}</td>
                        ${renderComparison('hra')}
                    </tr>
                </tbody>
            </table>
            <div class="derived-stats-grid">
                ${ratings.fip !== undefined ? `<div><label>Est. FIP</label><div class="value">${ratings.fip.toFixed(2)}</div></div>` : ''}
                ${ratings.war !== undefined ? `<div><label>Est. WAR</label><div class="value">${ratings.war.toFixed(1)}</div></div>` : ''}
            </div>
            <p class="league-info-text" style="margin-top: 0.5rem;">Using ${this.selectedYear} league context (Replacement FIP: ${(this.leagueConstants.replacementFip ?? 5.20).toFixed(2)}, FIP constant: ${(this.leagueConstants.fipConstant ?? 3.47).toFixed(2)})</p>
        `;
    }

    private async loadLeagueStats(year: number): Promise<void> {
        this.selectedYear = year;
        this.updateLeagueInfo('Loading league data...');

        try {
            const stats = await leagueStatsService.getLeagueStats(year);
            this.leagueConstants = {
                fipConstant: stats.fipConstant,
                replacementFip: stats.replacementFip,
            };
            this.loadedLeagueYear = year;
            this.updateLeagueInfo();
            this.recomputeIfPossible();
        } catch (e) {
            console.warn('Could not load league stats, using defaults', e);
            this.leagueConstants = {};  // Will use FipWarService defaults
            this.loadedLeagueYear = null;
            this.updateLeagueInfo('Using default league context (Replacement FIP: 5.20, FIP constant: 3.47)');
            this.recomputeIfPossible();
        }
    }

    private updateLeagueInfo(message?: string): void {
        const infoEl = this.container.querySelector<HTMLElement>('#estimator-league-info');
        if (!infoEl) return;

        if (message) {
            infoEl.textContent = message;
            return;
        }

        const displayYear = this.loadedLeagueYear ?? this.selectedYear;
        const replacementFip = this.leagueConstants.replacementFip ?? 5.20;
        const fipConstant = this.leagueConstants.fipConstant ?? 3.47;
        infoEl.textContent = `Using ${displayYear} league data (Replacement FIP: ${replacementFip.toFixed(2)}, FIP constant: ${fipConstant.toFixed(2)})`;
    }

    private recomputeIfPossible(): void {
        if (!this.lastStats || !this.lastComparison) return;
        const estimatedRatings = RatingEstimatorService.estimateAll(this.lastStats, this.leagueConstants);
        this.renderResults(estimatedRatings, this.lastComparison);
    }

    public async prefillAndEstimate(payload: { ip: number; k9: number; bb9: number; hr9: number; year: number }): Promise<void> {
        this.ensureYearOption(payload.year);
        this.setYearSelection(payload.year);

        const stats: StatInput = {
            ip: payload.ip,
            k9: payload.k9,
            bb9: payload.bb9,
            hr9: payload.hr9,
        };

        this.setInputValue('stat-ip', payload.ip);
        this.setInputValue('stat-k9', payload.k9);
        this.setInputValue('stat-bb9', payload.bb9);
        this.setInputValue('stat-hr9', payload.hr9);

        const comparison: ComparisonInputs = {
            stuff: {},
            control: {},
            hra: {},
        };

        this.lastStats = stats;
        this.lastComparison = comparison;

        if (this.loadedLeagueYear !== payload.year) {
            await this.loadLeagueStats(payload.year);
            return; // loadLeagueStats will recompute using lastStats/lastComparison
        }

        const estimatedRatings = RatingEstimatorService.estimateAll(stats, this.leagueConstants);
        this.renderResults(estimatedRatings, comparison);
    }

    private setYearSelection(year: number): void {
        const yearSelect = this.container.querySelector<HTMLSelectElement>('#estimator-league-year');
        if (yearSelect) {
            yearSelect.value = String(year);
        }
        this.selectedYear = year;
    }

    private ensureYearOption(year: number): void {
        if (AVAILABLE_YEARS.includes(year)) return;
        const yearSelect = this.container.querySelector<HTMLSelectElement>('#estimator-league-year');
        if (!yearSelect) return;
        const optionExists = Array.from(yearSelect.options).some(opt => Number(opt.value) === year);
        if (!optionExists) {
            const option = document.createElement('option');
            option.value = String(year);
            option.textContent = String(year);
            yearSelect.appendChild(option);
        }
    }

    private setInputValue(id: string, value: number): void {
        const input = this.container.querySelector<HTMLInputElement>(`#${id}`);
        if (input) {
            input.value = String(value);
        }
    }
}
