export class TeamRatingsView {
    private container: HTMLElement;

    constructor(container: HTMLElement) {
        this.container = container;
        this.render();
    }

    render(): void {
        this.container.innerHTML = `
            <h2>Team Ratings</h2>
            <p>This is where the Team Ratings will be displayed.</p>
        `;
    }
}
