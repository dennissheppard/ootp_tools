import { PotentialStatsView } from './PotentialStatsView';
import { RatingEstimatorView } from './RatingEstimatorView';

type CalculatorMode = 'potential' | 'estimator';

export class CalculatorsView {
  private container: HTMLElement;
  private estimatorView: RatingEstimatorView;
  private activeMode: CalculatorMode = 'potential';

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.innerHTML = `
      <div class="draft-header">
        <h2 class="view-title">Calculators</h2>
        <div class="toggle-group" role="tablist" aria-label="Calculator type">
          <button class="toggle-btn active" data-calculator-mode="potential" role="tab" aria-selected="true">Stat Calculator</button>
          <button class="toggle-btn" data-calculator-mode="estimator" role="tab" aria-selected="false">Rating Estimator</button>
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
    new PotentialStatsView(potentialContainer);
    this.estimatorView = new RatingEstimatorView(estimatorContainer);

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
    const buttons = this.container.querySelectorAll<HTMLButtonElement>('[data-calculator-mode]');
    buttons.forEach(button => {
      button.addEventListener('click', () => {
        const mode = button.dataset.calculatorMode as CalculatorMode | undefined;
        if (!mode) return;
        this.setActive(mode);
      });
    });
  }
}
