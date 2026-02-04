import { PotentialStatsView } from './PotentialStatsView';
import { RatingEstimatorView } from './RatingEstimatorView';

type CalculatorMode = 'potential' | 'estimator';
type PlayerType = 'batters' | 'pitchers';

export class CalculatorsView {
  private container: HTMLElement;
  private potentialView: PotentialStatsView;
  private estimatorView: RatingEstimatorView;
  private activeMode: CalculatorMode = 'potential';
  private playerType: PlayerType = 'pitchers';

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.innerHTML = `
      <div class="draft-header">
        <h2 class="view-title">Calculators</h2>
      </div>
      <div class="true-ratings-controls">
        <div class="filter-bar">
          <label>Filters:</label>
          <div class="filter-group" role="group" aria-label="Calculator filters">
            <button class="toggle-btn" data-player-type="batters" aria-pressed="false">Batters</button>
            <button class="toggle-btn active" data-player-type="pitchers" aria-pressed="true">Pitchers</button>
            <button class="toggle-btn active" data-calculator-mode="potential" role="tab" aria-selected="true">Stat Calculator</button>
            <button class="toggle-btn" data-calculator-mode="estimator" role="tab" aria-selected="false">Rating Estimator</button>
          </div>
        </div>
      </div>
      <div class="calculator-panel active" data-calculator-panel="potential">
        <div id="potential-stats-container"></div>
      </div>
      <div class="calculator-panel" data-calculator-panel="estimator">
        <div id="rating-estimator-container"></div>
      </div>
    `;

    const potentialContainer = this.container.querySelector<HTMLElement>('#potential-stats-container')!;
    const estimatorContainer = this.container.querySelector<HTMLElement>('#rating-estimator-container')!;
    this.potentialView = new PotentialStatsView(potentialContainer, this.playerType);
    this.estimatorView = new RatingEstimatorView(estimatorContainer, this.playerType);

    this.bindToggle();
  }

  setActive(mode: CalculatorMode): void {
    if (this.activeMode === mode) return;
    this.activeMode = mode;

    const buttons = this.container.querySelectorAll<HTMLButtonElement>('[data-calculator-mode]');
    buttons.forEach(button => {
      const isActive = button.dataset.calculatorMode === mode;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', String(isActive));
    });

    const panels = this.container.querySelectorAll<HTMLElement>('[data-calculator-panel]');
    panels.forEach(panel => {
      panel.classList.toggle('active', panel.dataset.calculatorPanel === mode);
    });
  }

  async prefillEstimator(payload: { ip: number; k9: number; bb9: number; hr9: number; year: number }): Promise<void> {
    this.setActive('estimator');
    await this.estimatorView.prefillAndEstimate(payload);
  }

  private bindToggle(): void {
    // Calculator mode toggle (Stat Calculator | Rating Estimator)
    const modeButtons = this.container.querySelectorAll<HTMLButtonElement>('[data-calculator-mode]');
    modeButtons.forEach(button => {
      button.addEventListener('click', () => {
        const mode = button.dataset.calculatorMode as CalculatorMode | undefined;
        if (!mode) return;
        this.setActive(mode);
      });
    });

    // Player type toggle (Batters | Pitchers)
    const playerButtons = this.container.querySelectorAll<HTMLButtonElement>('[data-player-type]');
    playerButtons.forEach(button => {
      button.addEventListener('click', () => {
        const type = button.dataset.playerType as PlayerType | undefined;
        if (!type) return;
        this.setPlayerType(type);
      });
    });
  }

  private setPlayerType(type: PlayerType): void {
    if (this.playerType === type) return;
    this.playerType = type;

    // Update button states
    const buttons = this.container.querySelectorAll<HTMLButtonElement>('[data-player-type]');
    buttons.forEach(button => {
      const isActive = button.dataset.playerType === type;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });

    // Update both views with new player type
    this.potentialView.setPlayerType(type);
    this.estimatorView.setPlayerType(type);
  }
}
