export class ErrorView {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  show(error: Error): void {
    this.container.innerHTML = `
      <div class="error-container">
        <p class="error-message">${this.escapeHtml(error.message)}</p>
        <button class="error-dismiss">Dismiss</button>
      </div>
    `;

    const dismissBtn = this.container.querySelector('.error-dismiss');
    dismissBtn?.addEventListener('click', () => this.hide());
  }

  hide(): void {
    this.container.innerHTML = '';
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
