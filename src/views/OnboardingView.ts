export class OnboardingView {
  private overlay: HTMLElement | null = null;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    this.createDOM();
  }

  private createDOM(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'onboarding-overlay modal-overlay';
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.style.zIndex = '1400';
    this.overlay.innerHTML = `
      <div class="onboarding-modal modal" style="max-width: 1400px; width: 95vw; max-height: 95vh; overflow-y: auto;">
        <div class="onboarding-header modal-header">
          <h2 class="onboarding-title modal-title">🚀 Engineer Onboarding Guide</h2>
          <button class="modal-close onboarding-close" aria-label="Close">&times;</button>
        </div>
        <div class="onboarding-body modal-body">

          <!-- Quick Start -->
          <div class="onboarding-section">
            <h3>🎯 Quick Start</h3>
            <div class="quick-start-grid">
              <div class="quick-start-card">
                <div class="quick-start-icon">📦</div>
                <h4>Project Type</h4>
                <p>OOTP Baseball Analytics Suite</p>
              </div>
              <div class="quick-start-card">
                <div class="quick-start-icon">⚡</div>
                <h4>Tech Stack</h4>
                <p>TypeScript + Vite + Vanilla CSS</p>
              </div>
              <div class="quick-start-card">
                <div class="quick-start-icon">🏗️</div>
                <h4>Architecture</h4>
                <p>MVC with Service Layer</p>
              </div>
              <div class="quick-start-card">
                <div class="quick-start-icon">💾</div>
                <h4>Storage</h4>
                <p>IndexedDB + localStorage</p>
              </div>
            </div>
          </div>

          <!-- System Architecture Diagram -->
          <div class="onboarding-section">
            <h3>🏛️ System Architecture</h3>
            <div class="mermaid">
graph TB
    subgraph "Browser Layer"
        UI[View Components]
        STATE[State Management]
    end

    subgraph "Application Layer"
        CTRL[Controllers]
        SRVC[Services Layer]
        CALC[Calculation Engine]
    end

    subgraph "Data Layer"
        IDB[(IndexedDB)]
        LS[(localStorage)]
        MEM[In-Memory Cache]
    end

    subgraph "External APIs"
        API[StatsPlus API]
        CSV[CSV Uploads]
    end

    UI --> CTRL
    CTRL --> SRVC
    SRVC --> CALC
    SRVC --> IDB
    SRVC --> LS
    SRVC --> MEM
    SRVC --> API
    UI --> CSV
    CSV --> SRVC

    style UI fill:#4a90e2
    style CALC fill:#e94b3c
    style IDB fill:#50c878
    style API fill:#f39c12
            </div>
          </div>

          <!-- Data Flow Diagram -->
          <div class="onboarding-section">
            <h3>🔄 Core Data Flow</h3>
            <div class="mermaid">
sequenceDiagram
    participant User
    participant View
    participant Controller
    participant Service
    participant API
    participant Cache

    User->>View: Search Player
    View->>Controller: handleSearch()
    Controller->>Service: searchPlayers()
    Service->>Cache: Check cache
    alt Cache Hit
        Cache-->>Service: Return cached data
    else Cache Miss
        Service->>API: Fetch players CSV
        API-->>Service: Player data
        Service->>Cache: Store in cache
    end
    Service-->>Controller: Player list
    Controller-->>View: Render results
    View-->>User: Display players
            </div>
          </div>

          <!-- Service Architecture -->
          <div class="onboarding-section">
            <h3>🔧 Service Layer Architecture</h3>
            <div class="services-diagram">
              <div class="service-tier">
                <h4>📊 Data Source Services</h4>
                <div class="service-grid">
                  <div class="service-item">PlayerService</div>
                  <div class="service-item">StatsService</div>
                  <div class="service-item">TeamService</div>
                  <div class="service-item">DateService</div>
                  <div class="service-item">ScoutingDataService</div>
                  <div class="service-item">MinorLeagueStatsService</div>
                </div>
              </div>

              <div class="service-arrow">↓</div>

              <div class="service-tier">
                <h4>🧮 Calculation Services</h4>
                <div class="service-grid">
                  <div class="service-item highlight">TrueRatingsCalculationService</div>
                  <div class="service-item highlight">ProjectionService</div>
                  <div class="service-item highlight">EnsembleProjectionService</div>
                  <div class="service-item">FipWarService</div>
                  <div class="service-item">RatingEstimatorService</div>
                  <div class="service-item">TrueFutureRatingService</div>
                  <div class="service-item">AgingService</div>
                </div>
              </div>

              <div class="service-arrow">↓</div>

              <div class="service-tier">
                <h4>💾 Storage Services</h4>
                <div class="service-grid">
                  <div class="service-item">IndexedDBService</div>
                  <div class="service-item">StorageMigration</div>
                  <div class="service-item">ApiClient</div>
                </div>
              </div>
            </div>
          </div>

          <!-- True Rating Calculation Flow -->
          <div class="onboarding-section">
            <h3>⭐ True Rating Calculation Pipeline</h3>
            <div class="mermaid">
graph LR
    A[Multi-Year Stats] --> B[Weight Recent Years]
    C[Scouting Ratings] --> D[Blend Ratings]
    B --> E[Calculate Weighted K/BB/HR]
    E --> F[Calculate FIP]
    F --> G{Performance Tier?}
    G -->|FIP ≤ 4.5| H[Regress to League Avg]
    G -->|4.5 < FIP ≤ 6.0| I[Regress to Replacement]
    G -->|FIP > 6.0| J[Minimal Regression]
    D --> K[Blend with Stats]
    H --> K
    I --> K
    J --> K
    K --> L[Calculate Percentile]
    L --> M[Convert to 0.5-5.0 Stars]

    style M fill:#ffd700
    style K fill:#4a90e2
    style G fill:#e94b3c
            </div>
          </div>

          <!-- Key Formulas -->
          <div class="onboarding-section">
            <h3>📐 Key Formulas & Constants</h3>
            <div class="formula-grid">
              <div class="formula-card">
                <h4>FIP (Fielding Independent Pitching)</h4>
                <code>FIP = ((13×HR/9) + (3×BB/9) - (2×K/9)) / 9 + 3.47</code>
                <p class="formula-note">Constant calibrated for WBL (~3.47)</p>
              </div>

              <div class="formula-card">
                <h4>WAR (Wins Above Replacement)</h4>
                <code>WAR = ((5.20 - FIP) / 8.50) × (IP / 9)</code>
                <p class="formula-note">Replacement FIP: 5.20, Runs/Win: 8.50</p>
              </div>

              <div class="formula-card">
                <h4>True Rating (Stars)</h4>
                <code>Stars = percentile to 0.5-5.0 scale</code>
                <p class="formula-note">97.7th% = 5.0★, 50th% = 3.0★, 2.3rd% = 0.5★</p>
              </div>

              <div class="formula-card">
                <h4>Minor League Adjustments</h4>
                <code>AAA: K9 +0.30, BB9 -0.42<br>AA: K9 +0.35, BB9 -0.48<br>Rookie: K9 +0.45, BB9 -0.58</code>
                <p class="formula-note">Level translation to MLB equivalent</p>
              </div>
            </div>
          </div>

          <!-- Projection Models -->
          <div class="onboarding-section">
            <h3>🔮 Ensemble Projection System</h3>
            <div class="mermaid">
graph TD
    START[Player Input] --> M1[Optimistic Model]
    START --> M2[Neutral Model]
    START --> M3[Pessimistic Model]

    M1 --> W1[Standard Aging Curves]
    M2 --> W2[Conservative Status Quo]
    M3 --> W3[Trend-Based Analysis]

    W1 --> E[Weighted Ensemble]
    W2 --> E
    W3 --> E

    E --> F[Final Projection]
    F --> OUT1[Projected K9/BB9/HR9]
    F --> OUT2[Projected FIP]
    F --> OUT3[Projected WAR]
    F --> OUT4[Projected True Rating]

    style M1 fill:#50c878
    style M2 fill:#4a90e2
    style M3 fill:#e94b3c
    style F fill:#ffd700
            </div>
          </div>

          <!-- Caching Strategy -->
          <div class="onboarding-section">
            <h3>💾 Multi-Tier Caching Strategy</h3>
            <div class="cache-diagram">
              <div class="cache-tier tier-1">
                <h4>🚀 Tier 1: In-Memory</h4>
                <p>Active view state, current calculations</p>
                <span class="cache-speed">~1ms access</span>
              </div>
              <div class="cache-arrow">↓ Miss</div>
              <div class="cache-tier tier-2">
                <h4>💿 Tier 2: localStorage</h4>
                <p>Player roster (24h), Teams (30d), Stats (24h for current year)</p>
                <span class="cache-speed">~5ms access</span>
              </div>
              <div class="cache-arrow">↓ Miss</div>
              <div class="cache-tier tier-3">
                <h4>🗄️ Tier 3: IndexedDB</h4>
                <p>Scouting reports, Minor league stats, Historical data</p>
                <span class="cache-speed">~20ms access</span>
              </div>
              <div class="cache-arrow">↓ Miss</div>
              <div class="cache-tier tier-4">
                <h4>🌐 Tier 4: API</h4>
                <p>StatsPlus backend (CSV data)</p>
                <span class="cache-speed">~500ms+ access</span>
              </div>
            </div>
          </div>

          <!-- File Structure -->
          <div class="onboarding-section">
            <h3>📁 Project Structure</h3>
            <div class="file-tree">
              <div class="file-tree-item folder">
                <span class="file-icon">📦</span>
                <strong>wbl/</strong>
              </div>
              <div class="file-tree-item folder indent-1">
                <span class="file-icon">📂</span>
                <strong>src/</strong>
              </div>
              <div class="file-tree-item folder indent-2">
                <span class="file-icon">📂</span>
                <strong>models/</strong>
                <span class="file-count">10 interfaces</span>
              </div>
              <div class="file-tree-item folder indent-2">
                <span class="file-icon">📂</span>
                <strong>services/</strong>
                <span class="file-count">30+ services</span>
              </div>
              <div class="file-tree-item indent-3">
                <span class="file-icon">⚙️</span>
                TrueRatingsCalculationService.ts
              </div>
              <div class="file-tree-item indent-3">
                <span class="file-icon">⚙️</span>
                ProjectionService.ts
              </div>
              <div class="file-tree-item indent-3">
                <span class="file-icon">⚙️</span>
                EnsembleProjectionService.ts
              </div>
              <div class="file-tree-item folder indent-2">
                <span class="file-icon">📂</span>
                <strong>views/</strong>
                <span class="file-count">22+ views</span>
              </div>
              <div class="file-tree-item indent-3">
                <span class="file-icon">🎨</span>
                TrueRatingsView.ts
              </div>
              <div class="file-tree-item indent-3">
                <span class="file-icon">🎨</span>
                ProjectionsView.ts
              </div>
              <div class="file-tree-item indent-3">
                <span class="file-icon">🎨</span>
                FarmRankingsView.ts
              </div>
              <div class="file-tree-item folder indent-2">
                <span class="file-icon">📂</span>
                <strong>controllers/</strong>
              </div>
              <div class="file-tree-item indent-3">
                <span class="file-icon">🎮</span>
                PlayerController.ts
              </div>
              <div class="file-tree-item indent-2">
                <span class="file-icon">🚀</span>
                main.ts
              </div>
              <div class="file-tree-item indent-2">
                <span class="file-icon">🎨</span>
                styles.css
              </div>
            </div>
          </div>

          <!-- API Endpoints -->
          <div class="onboarding-section">
            <h3>🌐 API Endpoints Reference</h3>
            <div class="api-table">
              <table>
                <thead>
                  <tr>
                    <th>Endpoint</th>
                    <th>Method</th>
                    <th>Purpose</th>
                    <th>Cache</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>/api/players/</code></td>
                    <td>GET</td>
                    <td>All players (roster)</td>
                    <td>24h</td>
                  </tr>
                  <tr>
                    <td><code>/api/teams/</code></td>
                    <td>GET</td>
                    <td>All teams metadata</td>
                    <td>30d</td>
                  </tr>
                  <tr>
                    <td><code>/api/date/</code></td>
                    <td>GET</td>
                    <td>Current game date</td>
                    <td>None</td>
                  </tr>
                  <tr>
                    <td><code>/api/playerpitchstatsv2/?pid={id}</code></td>
                    <td>GET</td>
                    <td>Pitcher stats (single player)</td>
                    <td>None</td>
                  </tr>
                  <tr>
                    <td><code>/api/playerpitchstatsv2/?year={year}</code></td>
                    <td>GET</td>
                    <td>All pitchers (league-wide)</td>
                    <td>24h (current), ∞ (historical)</td>
                  </tr>
                  <tr>
                    <td><code>/api/playerbatstatsv2/?pid={id}</code></td>
                    <td>GET</td>
                    <td>Batter stats (single player)</td>
                    <td>None</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Error Handling -->
          <div class="onboarding-section">
            <h3>⚠️ Error Handling & Rate Limits</h3>
            <div class="mermaid">
graph LR
    A[API Request] --> B{Response Code?}
    B -->|200 OK| C[Process Data]
    B -->|204 No Content| D[Return Empty Array]
    B -->|404 Not Found| D
    B -->|429 Rate Limited| E[Exponential Backoff]
    B -->|500 Server Error| F[Throw Error]

    E --> G{Retry Count?}
    G -->|< 3| H[Wait 4s-12s]
    H --> A
    G -->|≥ 3| F

    C --> I[Cache Result]
    D --> J[Show Empty State]
    F --> K[ErrorView]

    style E fill:#ffa500
    style F fill:#e94b3c
    style C fill:#50c878
            </div>
            <div class="error-notes">
              <h4>Rate Limit Handling:</h4>
              <ul>
                <li>Max 3 retry attempts</li>
                <li>Exponential backoff: 4s → 8s → 12s</li>
                <li>Custom events: <code>wbl:rate-limited</code>, <code>wbl:rate-limit-clear</code></li>
                <li>User notification with countdown timer</li>
              </ul>
            </div>
          </div>

          <!-- Development Workflow -->
          <div class="onboarding-section">
            <h3>🛠️ Development Workflow</h3>
            <div class="workflow-grid">
              <div class="workflow-step">
                <div class="workflow-number">1</div>
                <h4>Setup</h4>
                <code>npm install</code>
                <p>Install dependencies</p>
              </div>
              <div class="workflow-arrow">→</div>
              <div class="workflow-step">
                <div class="workflow-number">2</div>
                <h4>Dev Server</h4>
                <code>npm run dev</code>
                <p>Start Vite dev server (port 3000)</p>
              </div>
              <div class="workflow-arrow">→</div>
              <div class="workflow-step">
                <div class="workflow-number">3</div>
                <h4>Build</h4>
                <code>npm run build</code>
                <p>TypeScript check + bundle to dist/</p>
              </div>
              <div class="workflow-arrow">→</div>
              <div class="workflow-step">
                <div class="workflow-number">4</div>
                <h4>Deploy</h4>
                <code>Push to Netlify</code>
                <p>Auto-deploy from main branch</p>
              </div>
            </div>
          </div>

          <!-- Common Tasks -->
          <div class="onboarding-section">
            <h3>📝 Common Development Tasks</h3>
            <div class="tasks-grid">
              <div class="task-card">
                <h4>🆕 Add New Service</h4>
                <ol>
                  <li>Create service file in <code>src/services/</code></li>
                  <li>Define singleton instance</li>
                  <li>Export from <code>services/index.ts</code></li>
                  <li>Import in views/controllers as needed</li>
                </ol>
              </div>

              <div class="task-card">
                <h4>🎨 Add New View</h4>
                <ol>
                  <li>Create view file in <code>src/views/</code></li>
                  <li>Add container div in <code>main.ts</code></li>
                  <li>Add tab button in header nav</li>
                  <li>Initialize view in <code>initializeViews()</code></li>
                </ol>
              </div>

              <div class="task-card">
                <h4>🧮 Add Calculation</h4>
                <ol>
                  <li>Add method to existing service or create new one</li>
                  <li>Write tests in <code>tests/</code></li>
                  <li>Integrate into calculation pipeline</li>
                  <li>Update relevant views to display results</li>
                </ol>
              </div>

              <div class="task-card">
                <h4>🐛 Debug Data Issues</h4>
                <ol>
                  <li>Check browser DevTools → Application → Storage</li>
                  <li>Clear localStorage/IndexedDB if stale</li>
                  <li>Check Network tab for API errors</li>
                  <li>Console logs in service layer</li>
                </ol>
              </div>
            </div>
          </div>

          <!-- Key Design Patterns -->
          <div class="onboarding-section">
            <h3>🎨 Key Design Patterns</h3>
            <div class="patterns-grid">
              <div class="pattern-card">
                <h4>Singleton Services</h4>
                <p>All services are singletons to ensure single source of truth and prevent duplicate API calls</p>
                <code>export const myService = new MyService();</code>
              </div>

              <div class="pattern-card">
                <h4>MVC Architecture</h4>
                <p>Models define data, Views handle UI, Controllers orchestrate between them, Services contain business logic</p>
              </div>

              <div class="pattern-card">
                <h4>Observer Pattern</h4>
                <p>Custom events for cross-component communication (rate limits, navigation)</p>
                <code>window.dispatchEvent(new CustomEvent('wbl:navigate-tab'))</code>
              </div>

              <div class="pattern-card">
                <h4>Lazy Loading</h4>
                <p>Heavy views (Projections, TeamRatings) only instantiated when tab first clicked</p>
              </div>

              <div class="pattern-card">
                <h4>Fallback Strategy</h4>
                <p>My Scout → OSA for scouting data, cache → API for stats</p>
              </div>

              <div class="pattern-card">
                <h4>Service Composition</h4>
                <p>Complex calculations composed from smaller services (FIP, WAR, Aging, etc.)</p>
              </div>
            </div>
          </div>

          <!-- Testing -->
          <div class="onboarding-section">
            <h3>🧪 Testing</h3>
            <div class="testing-info">
              <div class="test-framework">
                <h4>Framework: Jest + ts-jest</h4>
                <code>npm run test</code>
              </div>
              <div class="test-structure">
                <h4>Test Structure</h4>
                <ul>
                  <li>Unit tests for calculation services</li>
                  <li>Integration tests for data pipelines</li>
                  <li>Mock API responses for reproducibility</li>
                  <li>Snapshot tests for complex outputs</li>
                </ul>
              </div>
            </div>
          </div>

          <!-- Performance Tips -->
          <div class="onboarding-section">
            <h3>⚡ Performance Best Practices</h3>
            <div class="perf-grid">
              <div class="perf-tip">
                <span class="perf-icon">✅</span>
                <strong>DO:</strong> Use Promise.all() for parallel API calls
              </div>
              <div class="perf-tip">
                <span class="perf-icon">✅</span>
                <strong>DO:</strong> Cache derived stats (K9, BB9, FIP) in view state
              </div>
              <div class="perf-tip">
                <span class="perf-icon">✅</span>
                <strong>DO:</strong> Use IndexedDB for large datasets (>5MB)
              </div>
              <div class="perf-tip">
                <span class="perf-icon">✅</span>
                <strong>DO:</strong> Debounce search inputs (300ms)
              </div>
              <div class="perf-tip">
                <span class="perf-icon">❌</span>
                <strong>DON'T:</strong> Fetch all years of stats at once
              </div>
              <div class="perf-tip">
                <span class="perf-icon">❌</span>
                <strong>DON'T:</strong> Recalculate on every render (memoize)
              </div>
              <div class="perf-tip">
                <span class="perf-icon">❌</span>
                <strong>DON'T:</strong> Store large objects in localStorage
              </div>
              <div class="perf-tip">
                <span class="perf-icon">❌</span>
                <strong>DON'T:</strong> Make synchronous API calls
              </div>
            </div>
          </div>

          <!-- Hidden Features -->
          <div class="onboarding-section">
            <h3>🎁 Easter Eggs & Hidden Features</h3>
            <div class="easter-eggs">
              <div class="easter-egg-item">
                <span class="easter-icon">🖱️</span>
                <strong>Double-click logo</strong> → Data Management tab
              </div>
              <div class="easter-egg-item">
                <span class="easter-icon">🖱️</span>
                <strong>Double-click game date</strong> → About page
              </div>
              <div class="easter-egg-item">
                <span class="easter-icon">🔍</span>
                <strong>Search "aboutTR"</strong> → This onboarding guide!
              </div>
              <div class="easter-egg-item">
                <span class="easter-icon">🔄</span>
                <strong>Click flip cells in Projections</strong> → Toggle stats/ratings view
              </div>
            </div>
          </div>

          <!-- Resources -->
          <div class="onboarding-section">
            <h3>📚 Additional Resources</h3>
            <div class="resources-list">
              <div class="resource-item">
                <h4>📖 OOTP Formulas</h4>
                <p>Understanding FIP, WAR, and OOTP-specific calculations</p>
                <a href="https://www.ootpdevelopments.com/out-of-the-park-baseball-home/" target="_blank">OOTP Official Site</a>
              </div>
              <div class="resource-item">
                <h4>🎯 Vite Docs</h4>
                <p>Build tool configuration and optimization</p>
                <a href="https://vitejs.dev/" target="_blank">vitejs.dev</a>
              </div>
              <div class="resource-item">
                <h4>📘 TypeScript Handbook</h4>
                <p>Language features and best practices</p>
                <a href="https://www.typescriptlang.org/docs/" target="_blank">TypeScript Docs</a>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="onboarding-footer">
            <p>💡 <strong>Pro Tip:</strong> Search for "aboutTR" anytime to return to this guide</p>
            <p><em>Built with ❤️ for the World Baseball League</em></p>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);
    this.setupEventHandlers();
    this.loadMermaid();
  }

  private loadMermaid(): void {
    // Check if Mermaid is already loaded
    if (!(window as any).mermaid) {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
      script.onload = () => {
        (window as any).mermaid.initialize({
          startOnLoad: true,
          theme: 'dark',
          themeVariables: {
            primaryColor: '#4a90e2',
            primaryTextColor: '#fff',
            primaryBorderColor: '#7cb342',
            lineColor: '#f5a623',
            secondaryColor: '#50c878',
            tertiaryColor: '#1a1a2e'
          }
        });
      };
      document.head.appendChild(script);
    } else {
      // Re-render Mermaid diagrams if already loaded
      setTimeout(() => {
        (window as any).mermaid.contentLoaded();
      }, 100);
    }
  }

  private setupEventHandlers(): void {
    const closeBtn = this.overlay?.querySelector('.onboarding-close');
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

    // Render Mermaid diagrams
    if ((window as any).mermaid) {
      setTimeout(() => {
        (window as any).mermaid.contentLoaded();
      }, 100);
    }
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
