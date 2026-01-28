export class DevTrackerView {
    private container: HTMLElement;

    constructor(container: HTMLElement) {
        this.container = container;
        this.render();
    }

    render(): void {
        this.container.innerHTML = `
            <div class="view-header">
                <h2 class="view-title">Development Tracker</h2>
            </div>
            <div class="placeholder-card">
                <p>Tracking player development trends, ratings bumps, and performance trajectories.</p>
                <p><strong>Coming Soon</strong></p>
            </div>
        `;
    }
}
