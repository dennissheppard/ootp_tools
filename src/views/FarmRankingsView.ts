export class FarmRankingsView {
    private container: HTMLElement;

    constructor(container: HTMLElement) {
        this.container = container;
        this.render();
    }

    render(): void {
        this.container.innerHTML = `
            <h2>Farm Rankings</h2>
            <p>This is where the Farm Rankings will be displayed.</p>
        `;
    }
}
