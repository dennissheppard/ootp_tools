export class LoadingView {
  private container: HTMLElement;
  private overlay: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  show(message = 'Loading...'): void {
    if (this.overlay) return;

    const safeMessage = this.escapeHtml(message);
    this.overlay = document.createElement('div');
    this.overlay.className = 'loading-overlay';
    this.overlay.innerHTML = `
      <div class="loading-spinner"></div>
      <div class="loading-message loading-skeleton" role="status" aria-live="polite">
        <span class="skeleton-line md"></span>
        <span class="loading-text">${safeMessage}</span>
      </div>
    `;

    this.container.appendChild(this.overlay);
  }

  hide(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
