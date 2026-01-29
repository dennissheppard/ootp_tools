export class AboutView {
  private overlay: HTMLElement | null = null;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    this.createDOM();
  }

  private createDOM(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'about-overlay modal-overlay';
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.style.zIndex = '1400';
    this.overlay.innerHTML = `
      <div class="about-modal modal">
        <div class="about-header modal-header">
          <h2 class="about-title modal-title">True Ratings</h2>
          <button class="modal-close about-close" aria-label="Close">&times;</button>
        </div>
        <div class="about-body modal-body">
          <!-- Hero Section -->
          <div class="about-section hero">
            <h3>Advanced OOTP Analysis & Projection Suite</h3>
            <p class="lead-text">Reveal the "true" performance levels of your players and make data-driven decisions that win championships.</p>
          </div>

          <!-- Why It Exists -->
          <div class="about-section">
            <h4>Why True Ratings?</h4>
            <p>In Out of the Park Baseball, scouting ratings tell only part of the story. A pitcher with 55 Stuff might underperform expectations, or a lower-rated arm might exceed them. <strong>True Ratings</strong> solves this problem by blending scouting data with actual performance statistics to reveal the actual caliber of your players.</p>
            <p>Instead of guessing based on ratings alone, you get a clear, data-driven assessment of:</p>
            <ul class="feature-list">
              <li>Peak performance potential for developing prospects</li>
              <li>True skill level vs. scouting assessment misses</li>
              <li>Reliable projections for trade negotiations</li>
              <li>Team strength rankings across your league</li>
            </ul>
          </div>

          <!-- The Problem -->
          <div class="about-section">
            <h4>The Challenge</h4>
            <p>OOTP ratings are static snapshots. They don't account for:</p>
            <ul class="problem-list">
              <li><strong>Performance Reality:</strong> Pitcher A has 60 Stuff but a 4.20 ERA. Is the rating wrong or has he declined?</li>
              <li><strong>Level Translation:</strong> Your Triple-A prospect is dominant—but how will they perform in the majors?</li>
              <li><strong>Aging & Development:</strong> Young players improve; veterans decline. When and how much?</li>
              <li><strong>Small Sample Noise:</strong> Relievers with 40 IP tell us little about true ability.</li>
            </ul>
          </div>

          <!-- Our Solution -->
          <div class="about-section">
            <h4>Our Approach</h4>
            <p>True Ratings employs a multi-layered analytical framework:</p>

            <div class="solution-item">
              <h5>1. Scout + Stats Blending</h5>
              <p>We merge scouting ratings (Stuff, Control, HRA) with historical performance data to create a "True Rating" (0.5–5.0 stars) that reflects actual ability.</p>
            </div>

            <div class="solution-item">
              <h5>2. Three-Model Projection Ensemble</h5>
              <p>Instead of a single projection, we use three complementary models:</p>
              <ul>
                <li><strong>Optimistic:</strong> Standard aging curves (great for developing youth)</li>
                <li><strong>Neutral:</strong> Conservative "status quo" approach</li>
                <li><strong>Pessimistic:</strong> Trend-based analysis to catch declines early</li>
              </ul>
              <p>Weights adjust dynamically based on age, IP confidence, and performance volatility.</p>
            </div>

            <div class="solution-item">
              <h5>3. Level-Adjusted Prospect Analysis</h5>
              <p>Minor league stats are translated to MLB equivalents before blending with scouting ratings. Example:</p>
              <ul>
                <li>AAA: K/9 +0.30, BB/9 -0.42</li>
                <li>Rookie: K/9 +0.45, BB/9 -0.58</li>
              </ul>
            </div>

            <div class="solution-item">
              <h5>4. Role-Aware Metrics</h5>
              <p>WAR and FIP calculations adjust for pitcher role (Starter vs. Reliever), using different replacement levels and run values for each.</p>
            </div>
          </div>

          <!-- Architecture -->
          <div class="about-section">
            <h4>Architecture</h4>
            <div class="architecture-diagram">
              <div class="arch-layer">
                <h6>Data Layer</h6>
                <p>IndexedDB (local storage) • OOTP/StatsPlus CSV imports • Historical datasets</p>
              </div>
              <div class="arch-arrow">↓</div>
              <div class="arch-layer">
                <h6>Service Layer</h6>
                <p>TrueRatingsCalculationService • ProjectionAnalysisService • FipWarService • TrueFutureRatingService</p>
              </div>
              <div class="arch-arrow">↓</div>
              <div class="arch-layer">
                <h6>View Layer</h6>
                <p>True Ratings Dashboard • Projections • Farm Rankings • Team Ratings • Trade Analyzer • Calculators</p>
              </div>
            </div>
          </div>

          <!-- Technical Highlights -->
          <div class="about-section">
            <h4>Technical Stack</h4>
            <ul class="tech-list">
              <li><strong>Frontend:</strong> TypeScript, Vite, Vanilla CSS</li>
              <li><strong>State:</strong> Browser IndexedDB for large historical datasets</li>
              <li><strong>Architecture:</strong> MVC pattern (Models, Views, Controllers, Services)</li>
              <li><strong>Theme:</strong> Dark mode with modern UI/UX</li>
            </ul>
          </div>

          <!-- Key Challenges -->
          <div class="about-section">
            <h4>Technical Challenges</h4>

            <div class="challenge">
              <h5>1. Small Sample Volatility</h5>
              <p>Relievers with 40 IP or position players with limited ABs create noisy data. We use regression-to-mean logic tiered by FIP quality to stabilize projections.</p>
            </div>

            <div class="challenge">
              <h5>2. Ensemble Weight Calibration</h5>
              <p>The three-model ensemble weights must be tuned for accuracy. We use grid-search optimization against historical data to find optimal weights, then periodically re-calibrate after major data updates.</p>
            </div>

            <div class="challenge">
              <h5>3. Level Translation Accuracy</h5>
              <p>Converting minor league performance to MLB equivalents requires careful environment-specific adjustments. The WBL has ~64% of neutral MLB home run rates, requiring custom calibration.</p>
            </div>

            <div class="challenge">
              <h5>4. Scout Rating Variability</h5>
              <p>Different scouts assign different ratings. We blend "My Scout" with "OSA" (OOTP Scouting Assistant) fallback, but conflicting data requires intelligent merging logic.</p>
            </div>

            <div class="challenge">
              <h5>5. Real-Time Performance at Scale</h5>
              <p>Processing thousands of players across multiple seasons and projection models must be fast. We cache derived stats (K/9, FIP, WAR) and use efficient filtering/sorting in IndexedDB.</p>
            </div>
          </div>

          <!-- Performance Metrics -->
          <div class="about-section">
            <h4>Accuracy Benchmarks</h4>
            <p>Based on 2015–2020 historical data validation:</p>
            <ul class="benchmark-list">
              <li><strong>Elite Pitchers (75+ IP):</strong> K/9 MAE ≈ 0.64 • FIP MAE ≈ 0.42</li>
              <li><strong>Low-IP Relievers:</strong> Higher variance due to small sample sizes</li>
              <li><strong>Projections:</strong> FIP accuracy rivals professional baseball systems</li>
            </ul>
          </div>

          <!-- Key Features -->
          <div class="about-section">
            <h4>Core Features</h4>
            <div class="features-grid">
              <div class="feature-card">
                <h6>True Ratings</h6>
                <p>Blended ratings combining scouting data with performance stats</p>
              </div>
              <div class="feature-card">
                <h6>Projections</h6>
                <p>Three-model ensemble for reliable future performance predictions</p>
              </div>
              <div class="feature-card">
                <h6>Farm Rankings</h6>
                <p>True Future Ratings for prospects with level-adjusted stats</p>
              </div>
              <div class="feature-card">
                <h6>Team Ratings</h6>
                <p>Aggregate team pitching strength and projected improvement</p>
              </div>
              <div class="feature-card">
                <h6>Trade Analyzer</h6>
                <p>Compare prospect and player value in proposed trades</p>
              </div>
              <div class="feature-card">
                <h6>Calculators</h6>
                <p>Convert ratings to stats and vice versa for validation</p>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="about-section footer">
            <p><em>Double-click the Game Date to return here anytime.</em></p>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    const closeBtn = this.overlay?.querySelector('.about-close');
    closeBtn?.addEventListener('click', () => this.hide());

    this.overlay?.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
  }

  show(): void {
    if (!this.overlay) this.createDOM();

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
