export class AboutView {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
  }

  private render(): void {
    this.container.innerHTML = `
      <style>
        .about-view {
          max-width: 920px;
          margin: 0 auto;
          padding: .5rem 1.5rem 5rem;
        }
        .about-hero {
          text-align: center;
          padding: 0 1rem 2rem;
          border-bottom: 1px solid var(--color-border);
          margin-bottom: 1rem;
        }
        .about-hero h1 {
          font-size: 2.2rem;
          color: var(--color-primary);
          margin: 0 0 0.75rem;
        }
        .about-tagline {
          font-size: 1.05rem;
          color: var(--color-text-muted);
          line-height: 1.65;
          margin: 0;
        }
        .about-section {
          margin-bottom: 3.5rem;
        }
        .about-section-title {
          font-size: 1.35rem;
          color: var(--color-text);
          margin: 0 0 0.6rem;
          padding-bottom: 0.4rem;
          border-bottom: 2px solid var(--color-primary);
          display: inline-block;
        }
        .about-section-desc {
          color: var(--color-text-muted);
          line-height: 1.75;
          margin: 0.75rem 0 1.5rem;
        }
        /* Flow diagram shared styles */
        .flow-diagram {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0;
        }
        .flow-row {
          display: flex;
          align-items: stretch;
          gap: 0.75rem;
          width: 100%;
          justify-content: center;
          flex-wrap: wrap;
        }
        .flow-box {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          padding: 1rem 1.2rem;
          flex: 1;
          min-width: 180px;
          max-width: 300px;
        }
        .flow-box.primary {
          border-color: var(--color-primary);
          background: rgba(0, 186, 124, 0.09);
        }
        .flow-box.accent {
          border-color: #6366f1;
          background: rgba(99, 102, 241, 0.09);
        }
        .flow-box.highlight {
          border-color: #f59e0b;
          background: rgba(245, 158, 11, 0.09);
        }
        .flow-box-title {
          font-weight: 600;
          font-size: 0.88rem;
          color: var(--color-text);
          margin-bottom: 0.5rem;
          letter-spacing: 0.01em;
        }
        .flow-box-body {
          font-size: 0.81rem;
          color: var(--color-text-muted);
          line-height: 1.65;
        }
        .flow-box-note {
          font-size: 0.74rem;
          font-style: italic;
          opacity: 0.7;
          display: block;
          margin-top: 0.35rem;
        }
        .flow-connector {
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--color-text-muted);
          font-size: 1.3rem;
          flex-shrink: 0;
          padding: 0 0.25rem;
          align-self: center;
        }
        .flow-arrow-down {
          text-align: center;
          font-size: 1.4rem;
          color: var(--color-text-muted);
          margin: 0.35rem 0;
          line-height: 1;
        }
        .tr-scale-demo {
          display: flex;
          gap: 0.3rem;
          flex-wrap: wrap;
          margin: 0.5rem 0 0.25rem;
        }
        /* Projections ensemble */
        .ensemble-wrap {
          display: flex;
          align-items: center;
          gap: 1rem;
          justify-content: center;
          flex-wrap: wrap;
        }
        .ensemble-models {
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
        }
        .ensemble-model {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 6px;
          padding: 0.45rem 0.9rem;
          font-size: 0.84rem;
          color: var(--color-text-muted);
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }
        .ensemble-weight {
          font-weight: 700;
          color: var(--color-primary);
          min-width: 2.4rem;
        }
        .pipeline-steps {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          flex-wrap: wrap;
          justify-content: center;
          margin-top: 1.25rem;
        }
        .pipeline-step {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 20px;
          padding: 0.3rem 0.75rem;
          font-size: 0.78rem;
          color: var(--color-text-muted);
        }
        .pipeline-step.lit {
          border-color: var(--color-primary);
          color: var(--color-text);
          background: rgba(0, 186, 124, 0.07);
        }
        .pipeline-sep {
          color: var(--color-text-muted);
          font-size: 0.85rem;
          opacity: 0.6;
        }
        /* App section cards */
        .app-sections-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
          gap: 0.9rem;
          margin-top: 1rem;
        }
        .app-section-card {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          padding: 1.1rem 1.1rem 1rem;
          cursor: pointer;
          transition: border-color 0.15s ease, background 0.15s ease;
          text-align: left;
        }
        .app-section-card:hover {
          border-color: var(--color-primary);
          background: rgba(0, 186, 124, 0.07);
        }
        .app-section-card-icon {
          font-size: 1.4rem;
          margin-bottom: 0.45rem;
          line-height: 1;
        }
        .app-section-card-title {
          font-weight: 600;
          font-size: 0.92rem;
          color: var(--color-text);
          margin-bottom: 0.35rem;
        }
        .app-section-card-desc {
          font-size: 0.8rem;
          color: var(--color-text-muted);
          line-height: 1.5;
        }
        /* Scouting blend visualizer */
        .blend-spectrum {
          display: flex;
          align-items: stretch;
          border-radius: 8px;
          overflow: hidden;
          margin: 1rem 0;
          height: 48px;
          font-size: 0.78rem;
          font-weight: 600;
        }
        .blend-spectrum-scout {
          background: rgba(99, 102, 241, 0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #a5b4fc;
          transition: flex 0.3s;
        }
        .blend-spectrum-stats {
          background: rgba(0, 186, 124, 0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--color-primary);
          transition: flex 0.3s;
        }
        .blend-labels {
          display: flex;
          justify-content: space-between;
          font-size: 0.74rem;
          color: var(--color-text-muted);
          margin-top: 0.3rem;
        }
      </style>

      <div class="about-view">
        ${this.renderHero()}
        ${this.renderTrSection()}
        ${this.renderTfrSection()}
        ${this.renderProjectionsSection()}
        ${this.renderAppOverview()}
      </div>
    `;

    this.bindNavigationCards();
  }

  private renderHero(): string {
    return `
      <div class="about-hero">
        <h1>True Ratings</h1>
        <p class="about-tagline">
          Synthesizing scouting intelligence and historical performance<br>
          into actionable ratings and projections for Out of the Park Baseball
        </p>
      </div>
    `;
  }

  private renderTrSection(): string {
    return `
      <section class="about-section">
        <h2 class="about-section-title">How True Ratings Are Derived</h2>
        <p class="about-section-desc">
          <strong>True Ratings (TR)</strong> measure a player's <em>current ability</em> on a 0.5–5.0 scale.
          They blend scouting <em>potential</em> with actual MLB performance stats, with the balance shifting
          based on how proven the player is. A raw prospect leans on scouting; an established veteran
          leans on his track record.
        </p>

        <div class="flow-diagram">
          <!-- Inputs row -->
          <div class="flow-row">
            <div class="flow-box accent">
              <div class="flow-box-title">⚡ Scouting Potential Ratings</div>
              <div class="flow-box-body">
                <strong>Batters:</strong> Power · Eye · AvoidK · Contact · Gap · Speed<br>
                <strong>Pitchers:</strong> Stuff · Control · HRA<br>
                <span class="flow-box-note">These are ceiling potential ratings — not current ability</span>
                <span class="flow-box-note" style="margin-top:0.5rem; opacity:1; font-style:normal; color:var(--color-text-muted);">Selected from historical OOTP data analysis — these are the ratings that best isolate each outcome category (HR%, BB%, K%, AVG; K/9, BB/9, HR/9) with minimal redundancy and maximum predictive validity.</span>
              </div>
            </div>

            <div class="flow-connector">+</div>

            <div class="flow-box accent">
              <div class="flow-box-title">📊 MLB Performance Stats</div>
              <div class="flow-box-body">
                <strong>Batters:</strong> BB% · K% · HR% · AVG<br>
                <strong>Pitchers:</strong> K/9 · BB/9 · HR/9 → FIP<br>
                <span class="flow-box-note">4-year rolling window — current year weighted highest</span>
              </div>
            </div>
          </div>

          <div class="flow-arrow-down">↓</div>

          <!-- Blend box -->
          <div class="flow-row">
            <div class="flow-box highlight" style="max-width: 520px;">
              <div class="flow-box-title">⚖️ 3-Layer Development Blend</div>
              <div class="flow-box-body">
                A <strong>dev ratio</strong> is computed from two signals:
                how close OVR stars are to POT stars, and how much MLB PA/IP the player has accumulated.
                <br><br>
                <!-- Blend spectrum visual -->
                <div>
                  <div style="display:flex; gap: 0.5rem; margin-bottom:0.25rem; font-size:0.75rem; color:var(--color-text-muted);">
                    <span style="flex:1; text-align:center;">Raw Prospect</span>
                    <span style="flex:1; text-align:center;">Developing</span>
                    <span style="flex:1; text-align:center;">Established</span>
                  </div>
                  <div class="blend-spectrum">
                    <div class="blend-spectrum-scout" style="flex:7;">Scout heavy</div>
                    <div class="blend-spectrum-stats" style="flex:3;">Stats</div>
                  </div>
                  <div class="blend-spectrum" style="margin-top:3px;">
                    <div class="blend-spectrum-scout" style="flex:4;">Scout</div>
                    <div class="blend-spectrum-stats" style="flex:6;">Stats blend</div>
                  </div>
                  <div class="blend-spectrum" style="margin-top:3px;">
                    <div class="blend-spectrum-scout" style="flex:1;">Scout</div>
                    <div class="blend-spectrum-stats" style="flex:9;">Stats dominant</div>
                  </div>
                </div>
                <span class="flow-box-note">Directionally neutral — anchors lucky hot-streaks AND corrects fluky slumps</span>
              </div>
            </div>
          </div>

          <div class="flow-arrow-down">↓</div>

          <!-- Output -->
          <div class="flow-row">
            <div class="flow-box primary" style="max-width: 420px;">
              <div class="flow-box-title">True Rating (TR)</div>
              <div class="flow-box-body">
                Blended component rates → percentile-ranked vs. league → WAR/600 PA (includes baserunning)
                <div class="tr-scale-demo">
                  <span class="badge rating-elite">5.0</span>
                  <span class="badge rating-elite">4.5</span>
                  <span class="badge rating-plus">4.0</span>
                  <span class="badge rating-avg">3.5</span>
                  <span class="badge rating-avg">3.0</span>
                  <span class="badge rating-fringe">2.0</span>
                  <span class="badge rating-poor">1.0</span>
                </div>
                <span style="font-size:0.74rem; color:var(--color-text-muted);">Elite · Good · Avg · Fringe · Poor · 0.5 – 5.0 scale</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  private renderTfrSection(): string {
    return `
      <section class="about-section">
        <h2 class="about-section-title">What True Future Ratings Are</h2>
        <p class="about-section-desc">
          <strong>True Future Ratings (TFR)</strong> are a <em>pure ceiling projection</em> — what a prospect would produce
          at their age-27 peak if their scouting potential is fully realized.
          TFR uses <strong>100% scouting potential ratings</strong> with no MiLB stat blending,
          then ranks the projected peak against historical MLB peak-age distributions.
          MiLB stats inform TR development curves, not TFR ceilings.
        </p>

        <div class="flow-diagram">
          <div class="flow-row">
            <div class="flow-box accent" style="max-width:195px;">
              <div class="flow-box-title">Scout Potential</div>
              <div class="flow-box-body">
                Power · Eye · AvoidK<br>Contact · Gap · Speed<br>
                <em>— or —</em><br>
                Stuff · Control · HRA
              </div>
            </div>

            <div class="flow-connector">→</div>

            <div class="flow-box" style="max-width:195px;">
              <div class="flow-box-title">Project Peak Rates</div>
              <div class="flow-box-body">
                Rating → expected peak stat<br>
                (HR%, BB%, K%, AVG,<br>K/9, BB/9, HR/9...)<br>
                via fitted coefficients
              </div>
            </div>

            <div class="flow-connector">→</div>

            <div class="flow-box highlight" style="max-width:195px;">
              <div class="flow-box-title">Ceiling Boost</div>
              <div class="flow-box-body">
                Projects the optimistic<br>tail, not the mean<br>
                <br>
                Batters: +0.35σ<br>
                Pitchers: +0.27σ
              </div>
            </div>
          </div>

          <div class="flow-arrow-down">↓</div>

          <div class="flow-row">
            <div class="flow-box" style="max-width:320px;">
              <div class="flow-box-title">MLB Distribution Ranking</div>
              <div class="flow-box-body">
                Projected peak compared against <strong>real MLB peak-age seasons</strong><br>
                (2015–2020 · ages 25–32 · 300+ PA or 50+ IP)<br>
                Batters: wOBA → WAR/600 PA<br>
                Pitchers: FIP → WAR/IP
                <span class="flow-box-note">Same distribution TR uses — TFR and TR share one scale</span>
              </div>
            </div>

            <div class="flow-connector">→</div>

            <div class="flow-box primary" style="max-width:220px;">
              <div class="flow-box-title">True Future Rating (TFR)</div>
              <div class="flow-box-body">
                <div class="tr-scale-demo" style="margin-bottom:0.35rem;">
                  <span class="badge rating-elite">5.0</span>
                  <span class="badge rating-plus">4.0</span>
                  <span class="badge rating-avg">3.0</span>
                  <span class="badge rating-poor">1.5</span>
                </div>
                <span style="color:var(--color-primary); font-weight:600;">Ceiling on the TR scale</span>
              </div>
            </div>
          </div>
        </div>

        <p class="about-section-desc" style="margin-top:1.5rem; font-size:0.87rem;">
          <strong>TR vs TFR in the UI:</strong> When TFR significantly exceeds TR, the player profile shows
          both — TR as current ability (solid bar), TFR as ceiling (outlined bar end).
          Prospects with no MLB stats show development-curve TR (estimated current) alongside their TFR ceiling.
          When TFR ≤ TR the prospect display collapses — no ceiling upside to show.
        </p>
      </section>
    `;
  }

  private renderProjectionsSection(): string {
    return `
      <section class="about-section">
        <h2 class="about-section-title">How Projections Are Created</h2>
        <p class="about-section-desc">
          Season projections use a <strong>three-model ensemble</strong> that captures optimistic, neutral, and pessimistic
          aging trajectories. Multi-year historical data feeds into a scouting-blended regression pipeline,
          producing per-player WAR projections that roll up to team win totals.
        </p>

        <div class="ensemble-wrap">
          <div class="flow-box accent" style="max-width:240px; flex-shrink:0;">
            <div class="flow-box-title">📈 Input Data</div>
            <div class="flow-box-body">
              Multi-year weighted stats<br>
              (4-year rolling window)<br>
              + FIP-aware regression<br>
              + Scouting blend at<br>
              &nbsp;&nbsp;IP/(IP+60) weight
            </div>
          </div>

          <div class="flow-connector">→</div>

          <div class="ensemble-models">
            <div class="ensemble-model">
              <span class="ensemble-weight">40%</span>
              Optimistic — standard aging curves
            </div>
            <div class="ensemble-model">
              <span class="ensemble-weight">30%</span>
              Neutral — status quo
            </div>
            <div class="ensemble-model">
              <span class="ensemble-weight">30%</span>
              Pessimistic — trend-based decline
            </div>
          </div>

          <div class="flow-connector">→</div>

          <div class="flow-box primary" style="max-width:200px; flex-shrink:0;">
            <div class="flow-box-title">Projected WAR</div>
            <div class="flow-box-body">
              Per player, per year<br>
              Rolls up to team WAR<br>
              Piecewise WAR→Wins<br>
              → Projected standings
            </div>
          </div>
        </div>

        <div class="pipeline-steps">
          <div class="pipeline-step lit">Weighted stats</div>
          <div class="pipeline-sep">→</div>
          <div class="pipeline-step lit">FIP regression</div>
          <div class="pipeline-sep">→</div>
          <div class="pipeline-step lit">Scouting blend</div>
          <div class="pipeline-sep">→</div>
          <div class="pipeline-step lit">Ensemble aging</div>
          <div class="pipeline-sep">→</div>
          <div class="pipeline-step lit">Rate → WAR</div>
          <div class="pipeline-sep">→</div>
          <div class="pipeline-step lit">Team WAR</div>
          <div class="pipeline-sep">→</div>
          <div class="pipeline-step lit">Win totals</div>
        </div>
      </section>
    `;
  }

  private renderAppOverview(): string {
    const sections: { icon: string; title: string; tab: string; desc: string }[] = [
      {
        icon: '🏆',
        title: 'True Ratings',
        tab: 'tab-true-ratings',
        desc: 'Current MLB player ratings — TR and TFR side by side. Filter by team, level, or position.',
      },
      {
        icon: '🌱',
        title: 'Farm Rankings',
        tab: 'tab-farm-rankings',
        desc: 'Top 100 prospects ranked by TFR ceiling. Org depth scores and farm system tiers.',
      },
      {
        icon: '👥',
        title: 'Team Ratings',
        tab: 'tab-team-ratings',
        desc: 'Power Rankings, projected WAR, and full standings with historical backtesting.',
      },
      {
        icon: '📅',
        title: 'Team Planner',
        tab: 'tab-team-planning',
        desc: '6-year roster grid with contracts, prospect ETAs, and trade market analysis.',
      },
      {
        icon: '🔄',
        title: 'Trade Analyzer',
        tab: 'tab-trade-analyzer',
        desc: 'Multi-asset trade evaluation — MLB players, prospects, and draft picks.',
      },
      {
        icon: '📈',
        title: 'Projections',
        tab: 'tab-projections',
        desc: 'Season-by-season player projections with year selector and backtesting.',
      },
      {
        icon: '🔢',
        title: 'Calculators',
        tab: 'tab-calculators',
        desc: 'Rating estimators, FIP/WAR calculators, and scouting conversion tools.',
      },
      {
        icon: '💾',
        title: 'Data Management',
        tab: 'tab-data-management',
        desc: 'Upload custom scouting CSVs and manage historical stat data.',
      },
    ];

    const cards = sections
      .map(
        (s) => `
      <button class="app-section-card" data-nav-tab="${s.tab}" type="button">
        <div class="app-section-card-icon">${s.icon}</div>
        <div class="app-section-card-title">${s.title}</div>
        <div class="app-section-card-desc">${s.desc}</div>
      </button>
    `
      )
      .join('');

    return `
      <section class="about-section">
        <h2 class="about-section-title">Explore the App</h2>
        <p class="about-section-desc">Each section answers a different question about your league. Click any card to jump there.</p>
        <div class="app-sections-grid">
          ${cards}
        </div>
      </section>
    `;
  }

  private bindNavigationCards(): void {
    this.container.querySelectorAll<HTMLElement>('[data-nav-tab]').forEach((card) => {
      card.addEventListener('click', () => {
        const tabId = card.dataset.navTab;
        if (tabId) {
          window.dispatchEvent(new CustomEvent('wbl:navigate-tab', { detail: { tabId } }));
        }
      });
    });
  }
}
