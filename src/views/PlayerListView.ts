import { Player, getFullName, getPositionLabel } from '../models/Player';

export interface PlayerListViewOptions {
  onPlayerSelect: (player: Player) => void;
}

export class PlayerListView {
  private container: HTMLElement;
  private onPlayerSelect: (player: Player) => void;
  private players: Player[] = [];

  constructor(container: HTMLElement, options: PlayerListViewOptions) {
    this.container = container;
    this.onPlayerSelect = options.onPlayerSelect;
  }

  render(players: Player[], query: string): void {
    this.players = players;

    if (players.length === 0 && query) {
      this.container.innerHTML = `
        <div class="player-list-empty">
          <p>No players found matching "${this.escapeHtml(query)}"</p>
        </div>
      `;
      return;
    }

    if (players.length === 0) {
      this.container.innerHTML = '';
      return;
    }

    const listItems = players
      .slice(0, 50) // Limit to first 50 results
      .map((player, index) => this.renderPlayerItem(player, index))
      .join('');

    const moreCount = players.length - 50;
    const moreMessage = moreCount > 0
      ? `<p class="player-list-more">And ${moreCount} more results. Try a more specific search.</p>`
      : '';

    this.container.innerHTML = `
      <div class="player-list">
        <h3 class="player-list-title">Select a player (${players.length} found)</h3>
        <ul class="player-list-items">
          ${listItems}
        </ul>
        ${moreMessage}
      </div>
    `;

    this.attachEventListeners();
  }

  private renderPlayerItem(player: Player, index: number): string {
    const posLabel = getPositionLabel(player.position);
    const retiredBadge = player.retired ? '<span class="badge badge-retired">Retired</span>' : '';

    return `
      <li class="player-list-item" data-index="${index}">
        <span class="player-name">${this.escapeHtml(getFullName(player))}</span>
        <span class="player-position">${posLabel}</span>
        ${retiredBadge}
      </li>
    `;
  }

  private attachEventListeners(): void {
    const items = this.container.querySelectorAll('.player-list-item');
    items.forEach((item) => {
      item.addEventListener('click', () => {
        const index = parseInt(item.getAttribute('data-index') || '0', 10);
        const player = this.players[index];
        if (player) {
          this.onPlayerSelect(player);
        }
      });
    });
  }

  clear(): void {
    this.container.innerHTML = '';
    this.players = [];
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
