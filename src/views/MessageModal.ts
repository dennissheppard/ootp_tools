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

  /**
   * Show a confirmation dialog with custom action buttons.
   * Returns a promise that resolves with the label of the clicked button,
   * or null if the user dismissed the dialog.
   */
  confirm(title: string, message: string, buttons: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      if (!this.overlay) this.createDOM();

      const titleEl = this.overlay!.querySelector<HTMLElement>('.modal-title');
      const bodyEl = this.overlay!.querySelector<HTMLElement>('.modal-body');
      const footerEl = this.overlay!.querySelector<HTMLElement>('.modal-footer');

      if (titleEl) titleEl.textContent = title;
      if (bodyEl) bodyEl.innerHTML = message;

      if (footerEl) {
        footerEl.innerHTML = buttons.map((label, i) =>
          `<button class="btn ${i === 0 ? 'btn-primary' : ''} confirm-btn" data-index="${i}" style="margin-left: 0.5rem;">${label}</button>`
        ).join('');

        footerEl.querySelectorAll<HTMLButtonElement>('.confirm-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            this.hide();
            resolve(btn.textContent);
          });
        });
      }

      this.overlay!.classList.add('visible');
      this.overlay!.setAttribute('aria-hidden', 'false');

      // Override close handlers to resolve null
      const dismissHandler = () => {
        this.hide();
        resolve(null);
      };

      // Temporarily replace the close/overlay handlers
      const closeBtn = this.overlay!.querySelector<HTMLElement>('.modal-close');
      const newCloseBtn = closeBtn?.cloneNode(true) as HTMLElement;
      if (closeBtn && newCloseBtn) {
        closeBtn.replaceWith(newCloseBtn);
        newCloseBtn.addEventListener('click', dismissHandler);
      }

      this.boundKeyHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') dismissHandler();
      };
      document.addEventListener('keydown', this.boundKeyHandler);
    });
  }

  hide(): void {
    if (!this.overlay) return;
    this.overlay.classList.remove('visible');
    this.overlay.setAttribute('aria-hidden', 'true');

    // Restore footer to default OK button for future show() calls
    const footerEl = this.overlay.querySelector<HTMLElement>('.modal-footer');
    if (footerEl) {
      footerEl.innerHTML = '<button class="btn btn-primary close-btn">OK</button>';
      footerEl.querySelector('.close-btn')?.addEventListener('click', () => this.hide());
    }

    // Restore close button handler
    const closeBtn = this.overlay.querySelector<HTMLElement>('.modal-close');
    if (closeBtn) {
      const newBtn = closeBtn.cloneNode(true) as HTMLElement;
      closeBtn.replaceWith(newBtn);
      newBtn.addEventListener('click', () => this.hide());
    }

    if (this.boundKeyHandler) {
      document.removeEventListener('keydown', this.boundKeyHandler);
      this.boundKeyHandler = null;
    }
  }
}
