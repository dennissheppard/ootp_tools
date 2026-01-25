export class MessageModal {
  private overlay: HTMLElement | null = null;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    this.createDOM();
  }

  private createDOM(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.style.zIndex = '1300'; // Higher than profile modal
    this.overlay.innerHTML = `
      <div class="modal" style="width: min(500px, 90vw);">
        <div class="modal-header">
          <h3 class="modal-title">Message</h3>
          <button class="modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body" style="padding: 1.5rem; white-space: pre-wrap; line-height: 1.6;"></div>
        <div class="modal-footer" style="padding: 1rem 1.5rem; border-top: 1px solid var(--color-border); text-align: right;">
          <button class="btn btn-primary close-btn">OK</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);

    const closeHandler = () => this.hide();
    this.overlay.querySelector('.modal-close')?.addEventListener('click', closeHandler);
    this.overlay.querySelector('.close-btn')?.addEventListener('click', closeHandler);
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) closeHandler();
    });
  }

  show(title: string, message: string): void {
    if (!this.overlay) this.createDOM();
    
    const titleEl = this.overlay!.querySelector<HTMLElement>('.modal-title');
    const bodyEl = this.overlay!.querySelector<HTMLElement>('.modal-body');

    if (titleEl) titleEl.textContent = title;
    if (bodyEl) bodyEl.textContent = message;

    this.overlay!.classList.add('visible');
    this.overlay!.setAttribute('aria-hidden', 'false');

    this.boundKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.hide();
    };
    document.addEventListener('keydown', this.boundKeyHandler);
  }

  hide(): void {
    if (!this.overlay) return;
    this.overlay.classList.remove('visible');
    this.overlay.setAttribute('aria-hidden', 'true');

    if (this.boundKeyHandler) {
      document.removeEventListener('keydown', this.boundKeyHandler);
      this.boundKeyHandler = null;
    }
  }
}
