import { RatingEstimatorService, StatInput, EstimatedRatings } from '../services/RatingEstimatorService';
import { leagueStatsService } from '../services';

export class RatingEstimatorView {
    private container: HTMLElement;

    constructor(container: HTMLElement) {
        this.container = container;
        this.render();
    }

    private render(): void {
        this.container.innerHTML = `
            <div class="rating-estimator-section">
                <h2 class="section-title">Rating Estimator</h2>
                <p class="section-subtitle">"How Accurate Is Your Scout?"</p>

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

        const comparison = {
            stuff: { scout: getCompValue('comp-stuff-scout'), osa: getCompValue('comp-stuff-osa') },
            control: { scout: getCompValue('comp-control-scout'), osa: getCompValue('comp-control-osa') },
            hra: { scout: getCompValue('comp-hra-scout'), osa: getCompValue('comp-hra-osa') },
        };

        const lgEra = await leagueStatsService.getLeagueEra(2021);
        const estimatedRatings = RatingEstimatorService.estimateAll(stats, lgEra);
        this.renderResults(estimatedRatings, comparison);
    }

    private renderResults(ratings: EstimatedRatings, comparison: any): void {
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
                ${ratings.fip ? `<div><label>Est. FIP</label><div class="value">${ratings.fip.toFixed(2)}</div></div>` : ''}
                ${ratings.war ? `<div><label>Est. WAR</label><div class="value">${ratings.war.toFixed(1)}</div></div>` : ''}
            </div>
        `;
    }
}
