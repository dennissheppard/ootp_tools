/**
 * Responsive breakpoint detection singleton.
 * Breakpoints: mobile < 640px, tablet 640–1023px, desktop ≥ 1024px
 */
export class ViewportService {
  private static readonly _mobile = window.matchMedia('(max-width: 639px)');
  private static readonly _tablet = window.matchMedia('(max-width: 1023px)');

  static isMobile(): boolean {
    return ViewportService._mobile.matches;
  }

  static isTablet(): boolean {
    return ViewportService._tablet.matches && !ViewportService._mobile.matches;
  }

  static isDesktop(): boolean {
    return !ViewportService._tablet.matches;
  }

  /**
   * Register a callback that fires when crossing the mobile or tablet breakpoint.
   * Returns a cleanup function to remove the listeners.
   */
  static onBreakpointChange(cb: () => void): () => void {
    ViewportService._mobile.addEventListener('change', cb);
    ViewportService._tablet.addEventListener('change', cb);
    return () => {
      ViewportService._mobile.removeEventListener('change', cb);
      ViewportService._tablet.removeEventListener('change', cb);
    };
  }
}
