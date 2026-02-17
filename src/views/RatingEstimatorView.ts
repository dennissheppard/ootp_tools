import { RatingEstimatorService, StatInput, EstimatedRatings } from '../services/RatingEstimatorService';
import { HitterRatingEstimatorService, HitterStatInput, EstimatedHitterRatings } from '../services/HitterRatingEstimatorService';
import { leagueStatsService } from '../services/LeagueStatsService';
import { LeagueConstants } from '../services/FipWarService';

type PlayerType = 'batters' | 'pitchers';

type ComparisonInputs = {
    stuff: { scout?: number; osa?: number };
    control: { scout?: number; osa?: number };
    hra: { scout?: number; osa?: number };
};

type BatterComparisonInputs = {
    contact: { scout?: number; osa?: number };
    power: { scout?: number; osa?: number };
    eye: { scout?: number; osa?: number };
    avoidK: { scout?: number; osa?: number };
    gap: { scout?: number; osa?: number };
    speed: { scout?: number; osa?: number };
};

const AVAILABLE_YEARS = [2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011, 2010];

export class RatingEstimatorView {
    private container: HTMLElement;
    private playerType: PlayerType;
    private selectedYear: number = 2020;
    private loadedLeagueYear: number | null = null;
    private leagueConstants: Partial<LeagueConstants> = {};
    private lastStats: StatInput | null = null;
    private lastComparison: ComparisonInputs | null = null;
    private lastBatterStats: HitterStatInput | null = null;
    private lastBatterComparison: BatterComparisonInputs | null = null;

    constructor(container: HTMLElement, playerType: PlayerType = 'pitchers') {
        this.container = container;
        this.playerType = playerType;
        this.render();
        // Defer league stats loading until first user interaction
        // This prevents loading data during app initialization
    }

    setPlayerType(playerType: PlayerType): void {
        if (this.playerType === playerType) return;
        this.playerType = playerType;
        // Clear last results when switching player type
        this.lastStats = null;
        this.lastComparison = null;
        this.lastBatterStats = null;
        this.lastBatterComparison = null;
        this.render();
    }

    private render(): void {
        const isPitcher = this.playerType === 'pitchers';

        this.container.innerHTML = `
            <div class="rating-estimator-section">
                <h2 class="section-title">Rating Estimator</h2>                

                ${isPitcher ? this.renderLeagueContextInfo() : ''}

                <form id="estimator-form" class="estimator-form">
                    <div class="rating-estimator-content">
                        ${isPitcher ? this.renderPitcherInputs() : this.renderBatterInputs()}
                        ${isPitcher ? this.renderPitcherComparison() : this.renderBatterComparison()}
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

    private renderLeagueContextInfo(): string {
        return `
            <div class="league-context-info">
                <p id="estimator-league-info" class="league-info-text">Loading league data...</p>
                <div class="year-selector">
                    <label for="estimator-league-year">FIP/WAR based on:</label>
                    <select id="estimator-league-year">
                        ${AVAILABLE_YEARS.map(y => `<option value="${y}" ${y === this.selectedYear ? 'selected' : ''}>${y}</option>`).join('')}
                    </select>
                </div>
            </div>
        `;
    }

    private renderPitcherInputs(): string {
        return `
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
        `;
    }

    private renderBatterInputs(): string {
        return `
            <div class="estimator-input-container">
                <h3 class="form-title">Player Stats</h3>
                <div class="stat-inputs">
                    <div class="stat-field">
                        <label for="stat-pa">PA</label>
                        <input type="number" id="stat-pa" step="1" min="0" value="550">
                    </div>
                    <div class="stat-field">
                        <label for="stat-ab">AB</label>
                        <input type="number" id="stat-ab" step="1" min="0" value="500">
                    </div>
                    <div class="stat-field">
                        <label for="stat-h">H</label>
                        <input type="number" id="stat-h" step="1" min="0" value="135">
                    </div>
                    <div class="stat-field">
                        <label for="stat-d">2B</label>
                        <input type="number" id="stat-d" step="1" min="0" value="27">
                    </div>
                    <div class="stat-field">
                        <label for="stat-t">3B</label>
                        <input type="number" id="stat-t" step="1" min="0" value="3">
                    </div>
                    <div class="stat-field">
                        <label for="stat-hr">HR</label>
                        <input type="number" id="stat-hr" step="1" min="0" value="20">
                    </div>
                    <div class="stat-field">
                        <label for="stat-bb">BB</label>
                        <input type="number" id="stat-bb" step="1" min="0" value="45">
                    </div>
                    <div class="stat-field">
                        <label for="stat-k">K</label>
                        <input type="number" id="stat-k" step="1" min="0" value="100">
                    </div>
                </div>
            </div>
        `;
    }

    private renderPitcherComparison(): string {
        return `
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
        `;
    }

    private renderBatterComparison(): string {
        return `
            <div class="estimator-comparison-container">
                <h3 class="form-title">Comparison (optional)</h3>
                <div class="comparison-inputs">
                    <div class="comparison-header">
                        <span></span>
                        <span>Scout</span>
                        <span>OSA</span>
                    </div>
                    <div class="comparison-field">
                        <label for="comp-contact">Contact</label>
                        <input type="number" id="comp-contact-scout" min="20" max="80" placeholder="--" />
                        <input type="number" id="comp-contact-osa" min="20" max="80" placeholder="--" />
                    </div>
                    <div class="comparison-field">
                        <label for="comp-power">Power</label>
                        <input type="number" id="comp-power-scout" min="20" max="80" placeholder="--" />
                        <input type="number" id="comp-power-osa" min="20" max="80" placeholder="--" />
                    </div>
                    <div class="comparison-field">
                        <label for="comp-eye">Eye</label>
                        <input type="number" id="comp-eye-scout" min="20" max="80" placeholder="--" />
                        <input type="number" id="comp-eye-osa" min="20" max="80" placeholder="--" />
                    </div>
                    <div class="comparison-field">
                        <label for="comp-avoidk">AvoidK</label>
                        <input type="number" id="comp-avoidk-scout" min="20" max="80" placeholder="--" />
                        <input type="number" id="comp-avoidk-osa" min="20" max="80" placeholder="--" />
                    </div>
                    <div class="comparison-field">
                        <label for="comp-gap">Gap</label>
                        <input type="number" id="comp-gap-scout" min="20" max="80" placeholder="--" />
                        <input type="number" id="comp-gap-osa" min="20" max="80" placeholder="--" />
                    </div>
                    <div class="comparison-field">
                        <label for="comp-speed">Speed</label>
                        <input type="number" id="comp-speed-scout" min="20" max="80" placeholder="--" />
                        <input type="number" id="comp-speed-osa" min="20" max="80" placeholder="--" />
                    </div>
                </div>
            </div>
        `;
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
        if (this.playerType === 'pitchers') {
            await this.handlePitcherEstimate();
        } else {
            await this.handleBatterEstimate();
        }
    }

    private async handlePitcherEstimate(): Promise<void> {
        // Ensure league stats are loaded before calculating
        if (this.loadedLeagueYear !== this.selectedYear) {
            await this.loadLeagueStats(this.selectedYear);
        }

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
        this.renderPitcherResults(estimatedRatings, comparison);
    }

    private async handleBatterEstimate(): Promise<void> {
        const getStatValue = (id: string): number => {
            const input = this.container.querySelector<HTMLInputElement>(`#${id}`);
            return Number(input?.value) || 0;
        };

        const getCompValue = (id: string): number | undefined => {
            const input = this.container.querySelector<HTMLInputElement>(`#${id}`);
            return input?.value ? Number(input.value) : undefined;
        };

        const stats: HitterStatInput = {
            pa: getStatValue('stat-pa'),
            ab: getStatValue('stat-ab'),
            h: getStatValue('stat-h'),
            d: getStatValue('stat-d'),
            t: getStatValue('stat-t'),
            hr: getStatValue('stat-hr'),
            bb: getStatValue('stat-bb'),
            k: getStatValue('stat-k'),
        };

        const comparison: BatterComparisonInputs = {
            contact: { scout: getCompValue('comp-contact-scout'), osa: getCompValue('comp-contact-osa') },
            power: { scout: getCompValue('comp-power-scout'), osa: getCompValue('comp-power-osa') },
            eye: { scout: getCompValue('comp-eye-scout'), osa: getCompValue('comp-eye-osa') },
            avoidK: { scout: getCompValue('comp-avoidk-scout'), osa: getCompValue('comp-avoidk-osa') },
            gap: { scout: getCompValue('comp-gap-scout'), osa: getCompValue('comp-gap-osa') },
            speed: { scout: getCompValue('comp-speed-scout'), osa: getCompValue('comp-speed-osa') },
        };

        this.lastBatterStats = stats;
        this.lastBatterComparison = comparison;

        const estimatedRatings = HitterRatingEstimatorService.estimateAll(stats);
        this.renderBatterResults(estimatedRatings, comparison);
    }

    private renderPitcherResults(ratings: EstimatedRatings, comparison: ComparisonInputs): void {
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
                        <th>Estimated</th>
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

    private renderBatterResults(ratings: EstimatedHitterRatings, comparison: BatterComparisonInputs): void {
        const resultsContainer = this.container.querySelector<HTMLDivElement>('#estimator-results');
        if (!resultsContainer) return;

        const renderComparison = (stat: 'contact' | 'power' | 'eye' | 'avoidK' | 'gap' | 'speed') => {
            const scout = comparison[stat].scout;
            const osa = comparison[stat].osa;
            const estimated = ratings[stat];
            const verdict = scout ? HitterRatingEstimatorService.compareToScout(estimated, scout) : '';

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
                        <th>Estimated</th>
                        <th>Scout</th>
                        <th>OSA</th>
                        <th>Verdict</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Contact</td>
                        <td>${ratings.contact.rating}</td>
                        ${renderComparison('contact')}
                    </tr>
                    <tr>
                        <td>Power</td>
                        <td>${ratings.power.rating}</td>
                        ${renderComparison('power')}
                    </tr>
                    <tr>
                        <td>Eye</td>
                        <td>${ratings.eye.rating}</td>
                        ${renderComparison('eye')}
                    </tr>
                    <tr>
                        <td>AvoidK</td>
                        <td>${ratings.avoidK.rating}</td>
                        ${renderComparison('avoidK')}
                    </tr>
                    <tr>
                        <td>Gap</td>
                        <td>${ratings.gap.rating}</td>
                        ${renderComparison('gap')}
                    </tr>
                    <tr>
                        <td>Speed</td>
                        <td>${ratings.speed.rating}</td>
                        ${renderComparison('speed')}
                    </tr>
                </tbody>
            </table>
            <div class="derived-stats-grid">
                ${ratings.woba !== undefined ? `<div><label>wOBA</label><div class="value">${ratings.woba.toFixed(3)}</div></div>` : ''}
            </div>
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
        if (this.playerType === 'pitchers') {
            if (!this.lastStats || !this.lastComparison) return;
            const estimatedRatings = RatingEstimatorService.estimateAll(this.lastStats, this.leagueConstants);
            this.renderPitcherResults(estimatedRatings, this.lastComparison);
        } else {
            if (!this.lastBatterStats || !this.lastBatterComparison) return;
            const estimatedRatings = HitterRatingEstimatorService.estimateAll(this.lastBatterStats);
            this.renderBatterResults(estimatedRatings, this.lastBatterComparison);
        }
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
        this.renderPitcherResults(estimatedRatings, comparison);
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
