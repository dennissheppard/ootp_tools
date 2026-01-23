(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const r of document.querySelectorAll('link[rel="modulepreload"]'))s(r);new MutationObserver(r=>{for(const a of r)if(a.type==="childList")for(const n of a.addedNodes)n.tagName==="LINK"&&n.rel==="modulepreload"&&s(n)}).observe(document,{childList:!0,subtree:!0});function e(r){const a={};return r.integrity&&(a.integrity=r.integrity),r.referrerPolicy&&(a.referrerPolicy=r.referrerPolicy),r.crossOrigin==="use-credentials"?a.credentials="include":r.crossOrigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function s(r){if(r.ep)return;r.ep=!0;const a=e(r);fetch(r.href,a)}})();const A={1:"P",2:"C",3:"1B",4:"2B",5:"3B",6:"SS",7:"LF",8:"CF",9:"RF",10:"DH"};function E(d){return A[d]||"Unknown"}function B(d){return d.position===1}function j(d){return`${d.firstName} ${d.lastName}`}const M="/api",y="wbl_players_cache",S="wbl_players_cache_timestamp",_=1440*60*1e3;class R{players=[];loading=null;async getAllPlayers(t=!1){if(this.players.length>0&&!t)return this.players;if(!t){const e=this.loadFromCache();if(e)return this.players=e,this.players}if(this.loading)return this.loading;this.loading=this.fetchPlayers();try{return this.players=await this.loading,this.saveToCache(this.players),this.players}finally{this.loading=null}}async searchPlayers(t){const e=await this.getAllPlayers(),s=t.toLowerCase().trim();return s?e.filter(r=>{const a=`${r.firstName} ${r.lastName}`.toLowerCase(),n=`${r.lastName} ${r.firstName}`.toLowerCase();return a.includes(s)||n.includes(s)||r.firstName.toLowerCase().includes(s)||r.lastName.toLowerCase().includes(s)}):[]}async getPlayerById(t){return(await this.getAllPlayers()).find(s=>s.id===t)}async fetchPlayers(){const t=await fetch(`${M}/players/`);if(!t.ok)throw new Error(`Failed to fetch players: ${t.statusText}`);const e=await t.text();return this.parsePlayersCsv(e)}parsePlayersCsv(t){return t.trim().split(`
`).slice(1).map(r=>{const a=this.parseCsvLine(r);return{id:parseInt(a[0],10),firstName:a[1],lastName:a[2],teamId:parseInt(a[3],10),parentTeamId:parseInt(a[4],10),level:parseInt(a[5],10),position:parseInt(a[6],10),role:parseInt(a[7],10),age:parseInt(a[8],10),retired:a[9]==="1"}})}parseCsvLine(t){const e=[];let s="",r=!1;for(let a=0;a<t.length;a++){const n=t[a];n==='"'?r=!r:n===","&&!r?(e.push(s),s=""):s+=n}return e.push(s),e}loadFromCache(){try{const t=localStorage.getItem(S);if(!t)return null;if(Date.now()-parseInt(t,10)>_)return this.clearCache(),null;const s=localStorage.getItem(y);return s?JSON.parse(s):null}catch{return this.clearCache(),null}}saveToCache(t){try{localStorage.setItem(y,JSON.stringify(t)),localStorage.setItem(S,Date.now().toString())}catch{}}clearCache(){localStorage.removeItem(y),localStorage.removeItem(S)}}const x=new R,C="/api";class V{async getPitchingStats(t,e){let s=`${C}/playerpitchstatsv2/?pid=${t}`;e&&(s+=`&year=${e}`);const r=await fetch(s);if(!r.ok)throw new Error(`Failed to fetch pitching stats: ${r.statusText}`);const a=await r.text();return a.trim()?this.parsePitchingStatsCsv(a):[]}async getBattingStats(t,e){let s=`${C}/playerbatstatsv2/?pid=${t}`;e&&(s+=`&year=${e}`);const r=await fetch(s);if(!r.ok)throw new Error(`Failed to fetch batting stats: ${r.statusText}`);const a=await r.text();return a.trim()?this.parseBattingStatsCsv(a):[]}parsePitchingStatsCsv(t){const e=t.trim().split(`
`);if(e.length<2)return[];const s=this.parseCsvLine(e[0]);return e.slice(1).map(a=>{const n=this.parseCsvLine(a),i=this.zipToObject(s,n),o=parseFloat(i.ip)||0,l=parseInt(i.er,10)||0,c=parseInt(i.ha,10)||0,p=parseInt(i.bb,10)||0,h=parseInt(i.k,10)||0,u=o>0?l/o*9:0,b=o>0?(p+c)/o:0,v=o>0?h/o*9:0,m=o>0?p/o*9:0;return{id:parseInt(i.id,10),playerId:parseInt(i.player_id,10),year:parseInt(i.year,10),teamId:parseInt(i.team_id,10),leagueId:parseInt(i.league_id,10),levelId:parseInt(i.level_id,10),splitId:parseInt(i.split_id,10),ip:o,w:parseInt(i.w,10)||0,l:parseInt(i.l,10)||0,era:u,g:parseInt(i.g,10)||0,gs:parseInt(i.gs,10)||0,sv:parseInt(i.s,10)||0,bf:parseInt(i.bf,10)||0,ab:parseInt(i.ab,10)||0,ha:c,er:l,r:parseInt(i.r,10)||0,bb:p,k:h,hr:parseInt(i.hra,10)||0,whip:b,k9:v,bb9:m,war:parseFloat(i.war)||0,cg:parseInt(i.cg,10)||0,sho:parseInt(i.sho,10)||0,hld:parseInt(i.hld,10)||0,bs:parseInt(i.bs,10)||0,qs:parseInt(i.qs,10)||0}})}parseBattingStatsCsv(t){const e=t.trim().split(`
`);if(e.length<2)return[];const s=this.parseCsvLine(e[0]);return e.slice(1).map(a=>{const n=this.parseCsvLine(a),i=this.zipToObject(s,n),o=parseInt(i.ab,10)||0,l=parseInt(i.h,10)||0,c=parseInt(i.bb,10)||0,p=parseInt(i.hp,10)||0,h=parseInt(i.sf,10)||0,u=parseInt(i.d,10)||0,b=parseInt(i.t,10)||0,v=parseInt(i.hr,10)||0,m=parseInt(i.pa,10)||0,T=o>0?l/o:0,$=o+c+p+h,I=$>0?(l+c+p)/$:0,H=l+u+2*b+3*v,k=o>0?H/o:0,N=I+k;return{id:parseInt(i.id,10),playerId:parseInt(i.player_id,10),year:parseInt(i.year,10),teamId:parseInt(i.team_id,10),leagueId:parseInt(i.league_id,10),levelId:parseInt(i.level_id,10),splitId:parseInt(i.split_id,10),g:parseInt(i.g,10)||0,ab:o,pa:m,h:l,d:u,t:b,hr:v,r:parseInt(i.r,10)||0,rbi:parseInt(i.rbi,10)||0,bb:c,k:parseInt(i.k,10)||0,sb:parseInt(i.sb,10)||0,cs:parseInt(i.cs,10)||0,avg:T,obp:I,slg:k,ops:N,war:parseFloat(i.war)||0,ibb:parseInt(i.ibb,10)||0,hp:p,sh:parseInt(i.sh,10)||0,sf:h,gdp:parseInt(i.gdp,10)||0}})}parseCsvLine(t){const e=[];let s="",r=!1;for(let a=0;a<t.length;a++){const n=t[a];n==='"'?r=!r:n===","&&!r?(e.push(s),s=""):s+=n}return e.push(s),e}zipToObject(t,e){const s={};return t.forEach((r,a)=>{s[r]=e[a]??""}),s}}const F=new V;class q{playerService;statsService;onSearch;onStats;onError;onLoading;constructor(t=x,e=F){this.playerService=t,this.statsService=e}setCallbacks(t){this.onSearch=t.onSearch,this.onStats=t.onStats,this.onError=t.onError,this.onLoading=t.onLoading}async searchPlayers(t){if(!t.trim()){this.onSearch?.({players:[],query:t});return}try{this.onLoading?.(!0);const e=await this.playerService.searchPlayers(t);this.onSearch?.({players:e,query:t})}catch(e){this.onError?.(e instanceof Error?e:new Error(String(e)))}finally{this.onLoading?.(!1)}}async getPlayerStats(t,e){try{this.onLoading?.(!0);const s=await this.playerService.getPlayerById(t);if(!s)throw new Error(`Player with ID ${t} not found`);let r=[],a=[];B(s)?(r=await this.statsService.getPitchingStats(t,e),a=await this.statsService.getBattingStats(t,e)):(a=await this.statsService.getBattingStats(t,e),r=await this.statsService.getPitchingStats(t,e)),this.onStats?.({player:s,pitchingStats:r,battingStats:a,year:e})}catch(s){this.onError?.(s instanceof Error?s:new Error(String(s)))}finally{this.onLoading?.(!1)}}async preloadPlayers(){try{this.onLoading?.(!0),await this.playerService.getAllPlayers()}catch(t){this.onError?.(t instanceof Error?t:new Error(String(t)))}finally{this.onLoading?.(!1)}}}class D{container;searchInput;yearSelect;searchButton;onSearch;constructor(t,e){this.container=t,this.onSearch=e.onSearch,this.render(e.years),this.attachEventListeners()}render(t){this.container.innerHTML=`
      <div class="search-container">
        <div class="search-box">
          <input
            type="text"
            id="player-search"
            class="search-input"
            placeholder="Enter player name..."
            autocomplete="off"
          />
          <select id="year-select" class="year-select">
            <option value="">All Years</option>
            ${this.generateYearOptions(t.start,t.end)}
          </select>
          <button id="search-button" class="search-button">Search</button>
        </div>
      </div>
    `,this.searchInput=this.container.querySelector("#player-search"),this.yearSelect=this.container.querySelector("#year-select"),this.searchButton=this.container.querySelector("#search-button")}generateYearOptions(t,e){const s=[];for(let r=e;r>=t;r--)s.push(`<option value="${r}">${r}</option>`);return s.join("")}attachEventListeners(){this.searchButton.addEventListener("click",()=>this.handleSearch()),this.searchInput.addEventListener("keydown",t=>{t.key==="Enter"&&this.handleSearch()})}handleSearch(){const t=this.searchInput.value.trim(),e=this.yearSelect.value,s=e?parseInt(e,10):void 0;this.onSearch(t,s)}setLoading(t){this.searchButton.disabled=t,this.searchButton.textContent=t?"Searching...":"Search"}clear(){this.searchInput.value="",this.yearSelect.value=""}focus(){this.searchInput.focus()}}class K{container;onPlayerSelect;players=[];constructor(t,e){this.container=t,this.onPlayerSelect=e.onPlayerSelect}render(t,e){if(this.players=t,t.length===0&&e){this.container.innerHTML=`
        <div class="player-list-empty">
          <p>No players found matching "${this.escapeHtml(e)}"</p>
        </div>
      `;return}if(t.length===0){this.container.innerHTML="";return}const s=t.slice(0,50).map((n,i)=>this.renderPlayerItem(n,i)).join(""),r=t.length-50,a=r>0?`<p class="player-list-more">And ${r} more results. Try a more specific search.</p>`:"";this.container.innerHTML=`
      <div class="player-list">
        <h3 class="player-list-title">Select a player (${t.length} found)</h3>
        <ul class="player-list-items">
          ${s}
        </ul>
        ${a}
      </div>
    `,this.attachEventListeners()}renderPlayerItem(t,e){const s=E(t.position),r=t.retired?'<span class="badge badge-retired">Retired</span>':"";return`
      <li class="player-list-item" data-index="${e}">
        <span class="player-name">${this.escapeHtml(j(t))}</span>
        <span class="player-position">${s}</span>
        ${r}
      </li>
    `}attachEventListeners(){this.container.querySelectorAll(".player-list-item").forEach(e=>{e.addEventListener("click",()=>{const s=parseInt(e.getAttribute("data-index")||"0",10),r=this.players[s];r&&this.onPlayerSelect(r)})})}clear(){this.container.innerHTML="",this.players=[]}escapeHtml(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}}class O{container;constructor(t){this.container=t}render(t,e,s,r){const a=r?` (${r})`:" (All Years)",n=E(t.position),i=e.filter(u=>u.splitId===1),o=s.filter(u=>u.splitId===1),l=i.length>0?this.renderPitchingTable(i):"",c=o.length>0?this.renderBattingTable(o):"",h=!l&&!c?`<p class="no-stats">No stats found for this player${a}.</p>`:"";this.container.innerHTML=`
      <div class="stats-container">
        <div class="player-header">
          <h2 class="player-title">${this.escapeHtml(j(t))}</h2>
          <span class="player-info">
            <span class="badge badge-position">${n}</span>
            ${t.retired?'<span class="badge badge-retired">Retired</span>':""}
          </span>
        </div>
        <p class="stats-period">Stats${a}</p>
        ${h}
        ${B(t)?l+c:c+l}
      </div>
    `}renderPitchingTable(t){return t.length===0?"":`
      <div class="stats-table-container">
        <h3 class="stats-table-title">Pitching Statistics</h3>
        <div class="table-wrapper">
          <table class="stats-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>G</th>
                <th>GS</th>
                <th>W</th>
                <th>L</th>
                <th>SV</th>
                <th>IP</th>
                <th>H</th>
                <th>ER</th>
                <th>BB</th>
                <th>K</th>
                <th>HR</th>
                <th>ERA</th>
                <th>WHIP</th>
                <th>K/9</th>
                <th>WAR</th>
              </tr>
            </thead>
            <tbody>
              ${t.map(s=>`
      <tr>
        <td>${s.year}</td>
        <td>${s.g}</td>
        <td>${s.gs}</td>
        <td>${s.w}</td>
        <td>${s.l}</td>
        <td>${s.sv}</td>
        <td>${this.formatDecimal(s.ip,1)}</td>
        <td>${s.ha}</td>
        <td>${s.er}</td>
        <td>${s.bb}</td>
        <td>${s.k}</td>
        <td>${s.hr}</td>
        <td>${this.formatDecimal(s.era,2)}</td>
        <td>${this.formatDecimal(s.whip,2)}</td>
        <td>${this.formatDecimal(s.k9,1)}</td>
        <td>${this.formatDecimal(s.war,1)}</td>
      </tr>
    `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `}renderBattingTable(t){return t.length===0?"":`
      <div class="stats-table-container">
        <h3 class="stats-table-title">Batting Statistics</h3>
        <div class="table-wrapper">
          <table class="stats-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>G</th>
                <th>PA</th>
                <th>AB</th>
                <th>H</th>
                <th>2B</th>
                <th>3B</th>
                <th>HR</th>
                <th>R</th>
                <th>RBI</th>
                <th>BB</th>
                <th>K</th>
                <th>SB</th>
                <th>AVG</th>
                <th>OBP</th>
                <th>SLG</th>
                <th>OPS</th>
                <th>WAR</th>
              </tr>
            </thead>
            <tbody>
              ${t.map(s=>`
      <tr>
        <td>${s.year}</td>
        <td>${s.g}</td>
        <td>${s.pa}</td>
        <td>${s.ab}</td>
        <td>${s.h}</td>
        <td>${s.d}</td>
        <td>${s.t}</td>
        <td>${s.hr}</td>
        <td>${s.r}</td>
        <td>${s.rbi}</td>
        <td>${s.bb}</td>
        <td>${s.k}</td>
        <td>${s.sb}</td>
        <td>${this.formatAvg(s.avg)}</td>
        <td>${this.formatAvg(s.obp)}</td>
        <td>${this.formatAvg(s.slg)}</td>
        <td>${this.formatAvg(s.ops)}</td>
        <td>${this.formatDecimal(s.war,1)}</td>
      </tr>
    `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `}clear(){this.container.innerHTML=""}formatDecimal(t,e){return t.toFixed(e)}formatAvg(t){return t>=1?t.toFixed(3):t.toFixed(3).replace(/^0/,"")}escapeHtml(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}}const f={k9:{intercept:-1.654,linear:.22275,quadratic:-.0014204},bb9:{intercept:8.267,linear:-.16971,quadratic:.0010962},hr9:{intercept:3.989,linear:-.0981,quadratic:7065e-7},h9:{intercept:12.914,babipCoef:-.06536,movementCoef:-.03712}},w={avgFIP:4.1,fipConstant:3.1,runsPerWin:10},P=180;class g{static calcPolynomial(t,e){return t.intercept+t.linear*e+t.quadratic*e*e}static calculateK9(t){const e=this.calcPolynomial(f.k9,t);return Math.max(0,Math.min(15,e))}static calculateBB9(t){const e=this.calcPolynomial(f.bb9,t);return Math.max(0,Math.min(10,e))}static calculateHR9(t){const e=this.calcPolynomial(f.hr9,t);return Math.max(0,Math.min(3,e))}static calculateH9(t,e){const s=f.h9.intercept+f.h9.babipCoef*t+f.h9.movementCoef*e;return Math.max(5,Math.min(15,s))}static calculatePitchingStats(t,e=P){const s=this.calculateK9(t.stuff),r=this.calculateBB9(t.control),a=this.calculateHR9(t.hra),n=this.calculateH9(t.babip,t.movement),i=Math.round(s/9*e),o=Math.round(r/9*e),l=Math.round(a/9*e),c=Math.round(n/9*e),p=(o+c)/e,h=(13*l+3*o-2*i)/e+w.fipConstant,u=h+(Math.random()*.4-.2),b=e*2.9+c,v=c/b,m=(w.avgFIP-h)/w.runsPerWin*(e/9);return{k9:Math.round(s*10)/10,bb9:Math.round(r*10)/10,hr9:Math.round(a*10)/10,h9:Math.round(n*10)/10,ip:Math.round(e*10)/10,ha:c,hr:l,bb:o,k:i,era:Math.round(Math.max(0,u)*100)/100,fip:Math.round(Math.max(0,h)*100)/100,whip:Math.round(p*100)/100,oavg:Math.round(v*1e3)/1e3,war:Math.round(m*10)/10}}static getStatRange(t,e){const s={k9:{variance:1.5},bb9:{variance:.8},hr9:{variance:.4},h9:{variance:1.5}};let r;switch(t){case"k9":r=this.calculateK9(e);break;case"bb9":r=this.calculateBB9(e);break;case"hr9":r=this.calculateHR9(e);break;case"h9":r=this.calculateH9(e,50);break}const a=s[t].variance;return{low:Math.max(0,r-a),mid:r,high:r+a}}static calculateBulkStats(t){return t.map((e,s)=>({name:e.name||`Pitcher ${s+1}`,...e,...this.calculatePitchingStats(e,e.ip||P)}))}static parseCSV(t){const e=t.trim().split(`
`),s=[],r=e[0].toLowerCase().includes("stuff")?1:0;for(let a=r;a<e.length;a++){const n=e[a].trim();if(!n)continue;const i=n.split(",").map(c=>c.trim());let o,l;isNaN(Number(i[0]))?(o=i[0],l=i.slice(1).map(Number)):(o=`Pitcher ${s.length+1}`,l=i.map(Number)),l.length>=5&&l.slice(0,5).every(c=>!isNaN(c))&&s.push({name:o,stuff:l[0],control:l[1],hra:l[2],movement:l[3],babip:l[4],ip:l[5]||void 0})}return s}static validateRatings(t){const e=[],s=(r,a,n,i)=>{(a<n||a>i)&&e.push(`${r} must be between ${n} and ${i} (got ${a})`)};return s("Stuff",t.stuff,20,80),s("Control",t.control,20,80),s("HRA",t.hra,20,80),s("Movement",t.movement,20,80),s("BABIP",t.babip,20,80),e}static comparePitchers(t,e,s=P){const r=this.calculatePitchingStats(t,s),a=this.calculatePitchingStats(e,s),n={k:r.k-a.k,bb:r.bb-a.bb,hr:r.hr-a.hr,war:r.war-a.war};return[`Over ${s} IP:`,`  Ks: ${r.k} vs ${a.k} (${n.k>0?"+":""}${n.k})`,`  BBs: ${r.bb} vs ${a.bb} (${n.bb>0?"+":""}${n.bb})`,`  HRs: ${r.hr} vs ${a.hr} (${n.hr>0?"+":""}${n.hr})`,`  WAR: ${r.war.toFixed(1)} vs ${a.war.toFixed(1)} (${n.war>0?"+":""}${n.war.toFixed(1)})`].join(`
`)}}class W{container;results=[];constructor(t){this.container=t,this.render()}render(){this.container.innerHTML=`
      <div class="potential-stats-section">
        <h2 class="section-title">WBL Potential Stats Calculator</h2>
        <p class="section-subtitle">Enter pitcher ratings to calculate projected WBL stats</p>

        <div class="potential-stats-content">
          <!-- Manual Entry Form -->
          <div class="rating-form-container">
            <h3 class="form-title">Enter Ratings (20-80 scale)</h3>
            <form id="rating-form" class="rating-form">
              <div class="rating-inputs">
                <div class="rating-field">
                  <label for="rating-stuff">Stuff</label>
                  <input type="number" id="rating-stuff" min="20" max="80" value="50" required>
                </div>
                <div class="rating-field">
                  <label for="rating-control">Control</label>
                  <input type="number" id="rating-control" min="20" max="80" value="50" required>
                </div>
                <div class="rating-field">
                  <label for="rating-hra">HRA</label>
                  <input type="number" id="rating-hra" min="20" max="80" value="50" required>
                </div>
                <div class="rating-field">
                  <label for="rating-movement">Movement</label>
                  <input type="number" id="rating-movement" min="20" max="80" value="50" required>
                </div>
                <div class="rating-field">
                  <label for="rating-babip">BABIP</label>
                  <input type="number" id="rating-babip" min="20" max="80" value="50" required>
                </div>
              </div>
              <div class="form-actions">
                <input type="text" id="rating-name" placeholder="Player name (optional)" class="name-input">
                <div class="ip-input-wrapper">
                  <label for="rating-ip">IP:</label>
                  <input type="number" id="rating-ip" min="10" max="250" value="180" class="ip-input">
                </div>
                <button type="submit" class="btn btn-primary">Calculate & Add</button>
              </div>
            </form>
          </div>

          <!-- CSV Upload -->
          <div class="csv-upload-container">
            <h3 class="form-title">Or Upload CSV</h3>
            <p class="csv-format">Format: name, stuff, control, hra, movement, babip [, ip]</p>
            <div class="csv-upload-area" id="csv-drop-zone">
              <input type="file" id="csv-file-input" accept=".csv" hidden>
              <p>Drop CSV file here or <button type="button" class="btn-link" id="csv-browse-btn">browse</button></p>
            </div>
            <div class="formula-note">
              <strong>WBL-Calibrated Formulas:</strong><br>
              K/9: R²=0.22 (diminishing returns at high Stuff)<br>
              BB/9: R²=0.43 (strongest predictor)<br>
              HR/9: R²=0.20 | H/9: R²=0.06 (high variance)
            </div>
          </div>
        </div>

        <!-- Results Table -->
        <div class="results-container" id="results-container">
          <div class="results-header">
            <h3 class="form-title">Projected WBL Stats</h3>
            <button type="button" class="btn btn-secondary" id="clear-results-btn" style="display: none;">Clear All</button>
          </div>
          <div id="results-table-wrapper"></div>
        </div>
      </div>
    `,this.bindEvents()}bindEvents(){this.container.querySelector("#rating-form")?.addEventListener("submit",n=>{n.preventDefault(),this.handleManualEntry()});const e=this.container.querySelector("#csv-file-input"),s=this.container.querySelector("#csv-browse-btn"),r=this.container.querySelector("#csv-drop-zone");s?.addEventListener("click",()=>e?.click()),e?.addEventListener("change",n=>{const i=n.target.files?.[0];i&&this.handleCSVFile(i)}),r?.addEventListener("dragover",n=>{n.preventDefault(),r.classList.add("drag-over")}),r?.addEventListener("dragleave",()=>{r.classList.remove("drag-over")}),r?.addEventListener("drop",n=>{n.preventDefault(),r.classList.remove("drag-over");const i=n.dataTransfer?.files[0];i&&i.name.endsWith(".csv")&&this.handleCSVFile(i)}),this.container.querySelector("#clear-results-btn")?.addEventListener("click",()=>{this.results=[],this.renderResults()})}handleManualEntry(){const t=o=>{const l=this.container.querySelector(`#${o}`);return Number(l?.value)||50},e=this.container.querySelector("#rating-name"),s=e?.value.trim()||`Pitcher ${this.results.length+1}`,r={stuff:t("rating-stuff"),control:t("rating-control"),hra:t("rating-hra"),movement:t("rating-movement"),babip:t("rating-babip")},a=t("rating-ip"),n=g.validateRatings(r);if(n.length>0){alert(n.join(`
`));return}const i=g.calculatePitchingStats(r,a);this.results.push({name:s,...r,...i}),e&&(e.value=""),this.renderResults()}handleCSVFile(t){const e=new FileReader;e.onload=s=>{const r=s.target?.result;try{const a=g.parseCSV(r);if(a.length===0){alert("No valid data found in CSV");return}const n=g.calculateBulkStats(a);this.results.push(...n),this.renderResults()}catch(a){alert("Error parsing CSV file"),console.error(a)}},e.readAsText(t)}renderResults(){const t=this.container.querySelector("#results-table-wrapper"),e=this.container.querySelector("#clear-results-btn");if(!t)return;if(this.results.length===0){t.innerHTML='<p class="no-results">No results yet. Enter ratings above to see WBL projections.</p>',e&&(e.style.display="none");return}e&&(e.style.display="block");const s=this.results.map((r,a)=>`
      <tr>
        <td class="name-cell">
          ${this.escapeHtml(r.name)}
          <button type="button" class="btn-remove" data-index="${a}" title="Remove">x</button>
        </td>
        <td>${r.stuff}</td>
        <td>${r.control}</td>
        <td>${r.hra}</td>
        <td>${r.movement}</td>
        <td>${r.babip}</td>
        <td class="divider"></td>
        <td>${r.ip.toFixed(0)}</td>
        <td>${r.k}</td>
        <td>${r.bb}</td>
        <td>${r.hr}</td>
        <td>${r.ha}</td>
        <td class="divider"></td>
        <td>${r.k9.toFixed(1)}</td>
        <td>${r.bb9.toFixed(1)}</td>
        <td>${r.hr9.toFixed(2)}</td>
        <td>${r.h9.toFixed(1)}</td>
        <td class="divider"></td>
        <td>${r.fip.toFixed(2)}</td>
        <td>${r.whip.toFixed(2)}</td>
        <td class="${r.war>=0?"war-positive":"war-negative"}">${r.war.toFixed(1)}</td>
      </tr>
    `).join("");t.innerHTML=`
      <div class="table-wrapper">
        <table class="stats-table potential-stats-table">
          <thead>
            <tr>
              <th class="name-col">Name</th>
              <th title="Stuff">STF</th>
              <th title="Control">CON</th>
              <th title="HR Avoidance">HRA</th>
              <th title="Movement">MOV</th>
              <th title="BABIP">BAB</th>
              <th class="divider"></th>
              <th>IP</th>
              <th>K</th>
              <th>BB</th>
              <th>HR</th>
              <th>H</th>
              <th class="divider"></th>
              <th>K/9</th>
              <th>BB/9</th>
              <th>HR/9</th>
              <th>H/9</th>
              <th class="divider"></th>
              <th>FIP</th>
              <th>WHIP</th>
              <th>WAR</th>
            </tr>
          </thead>
          <tbody>
            ${s}
          </tbody>
        </table>
      </div>
    `,t.querySelectorAll(".btn-remove").forEach(r=>{r.addEventListener("click",a=>{const n=Number(a.target.dataset.index);this.results.splice(n,1),this.renderResults()})})}escapeHtml(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}clear(){this.results=[],this.renderResults()}}const L=[{key:"stu",label:"STU P"},{key:"mov",label:"MOV P"},{key:"con",label:"CON P"},{key:"babip",label:"PBABIP P"},{key:"hra",label:"HRR P"},{key:"fb",label:"FBP"},{key:"ch",label:"CHP"},{key:"cb",label:"CBP"},{key:"sl",label:"SLP"},{key:"si",label:"SIP"},{key:"sp",label:"SPP"},{key:"ct",label:"CTP"},{key:"fo",label:"FOP"},{key:"cc",label:"CCP"},{key:"sc",label:"SCP"},{key:"kc",label:"KCP"},{key:"kn",label:"KNP"},{key:"vt",label:"VT"},{key:"stm",label:"STM"}],U=[{key:"proj_ip",label:"IP"},{key:"proj_k",label:"K"},{key:"proj_bb",label:"BB"},{key:"proj_hr",label:"HR"},{key:"proj_h",label:"H"},{key:"proj_k9",label:"K/9"},{key:"proj_bb9",label:"BB/9"},{key:"proj_hr9",label:"HR/9"},{key:"proj_h9",label:"H/9"},{key:"proj_fip",label:"FIP"},{key:"proj_whip",label:"WHIP"},{key:"proj_war",label:"WAR"}];class z{container;mode="pitchers";pitcherRows=[];sortKey;sortDirection="asc";preferences;prefKey="wbl-prefs";constructor(t){this.container=t,this.preferences=this.loadPreferences(),this.render(),this.bindModeToggle(),this.bindUpload(),this.bindInstructionToggles()}render(){this.container.innerHTML=`
      <div class="draft-board">
        <div class="draft-header">
          <h2>Draft Board</h2>
          <div class="toggle-group" role="tablist" aria-label="Draft type">
            <button class="toggle-btn active" data-mode="pitchers" role="tab" aria-selected="true">Pitchers</button>
            <button class="toggle-btn" data-mode="hitters" role="tab" aria-selected="false">Hitters</button>
          </div>
        </div>

        <div class="draft-section" data-section="pitchers">
          <div class="draft-upload">
            <div class="upload-info ${this.preferences.hideUploadInfo?"collapsed":""}" id="upload-info">
              <button type="button" class="instructions-dismiss" data-dismiss-instructions aria-label="Hide instructions">×</button>
              <p class="draft-subtitle">Upload pitcher CSV (one row per player)</p>
              <pre class="csv-sample"><code>${this.sampleCsv()}</code></pre>
            </div>
            <div class="upload-actions">
              <div class="csv-upload-area" id="draft-drop-zone">
                <input type="file" id="draft-file-input" accept=".csv" hidden>
                <p>Drop CSV here or <button type="button" class="btn-link" id="draft-browse-btn">browse</button></p>
              </div>
              <button type="button" class="btn-link show-instructions" id="show-instructions" ${this.preferences.hideUploadInfo?"":'style="display:none;"'}>
                Show instructions
              </button>
            </div>
          </div>

          <div class="draft-results" id="draft-results"></div>
        </div>

        <div class="draft-section hidden" data-section="hitters">
          <div class="placeholder-card">
            <h3>Hitters</h3>
            <p>We will add hitter support here soon.</p>
          </div>
        </div>
      </div>
    `,this.renderPitcherTable()}bindModeToggle(){this.container.querySelectorAll(".toggle-btn").forEach(e=>{e.addEventListener("click",()=>{const s=e.dataset.mode;s&&s!==this.mode&&this.setMode(s)})})}setMode(t){this.mode=t,this.container.querySelectorAll(".toggle-btn").forEach(r=>{const a=r.dataset.mode===t;r.classList.toggle("active",a),r.setAttribute("aria-selected",a?"true":"false")}),this.container.querySelectorAll(".draft-section").forEach(r=>{const a=r.dataset.section===t;r.classList.toggle("hidden",!a)})}bindUpload(){const t=this.container.querySelector("#draft-file-input"),e=this.container.querySelector("#draft-browse-btn"),s=this.container.querySelector("#draft-drop-zone");e?.addEventListener("click",()=>t?.click()),t?.addEventListener("change",r=>{const a=r.target.files?.[0];a&&this.handleFile(a)}),s?.addEventListener("dragover",r=>{r.preventDefault(),s.classList.add("drag-over")}),s?.addEventListener("dragleave",()=>{s.classList.remove("drag-over")}),s?.addEventListener("drop",r=>{r.preventDefault(),s.classList.remove("drag-over");const a=r.dataTransfer?.files[0];a&&a.name.endsWith(".csv")&&this.handleFile(a)})}bindInstructionToggles(){const t=this.container.querySelector("#upload-info"),e=this.container.querySelector("[data-dismiss-instructions]"),s=this.container.querySelector("#show-instructions"),r=a=>{t&&t.classList.toggle("collapsed",a),s&&(s.style.display=a?"inline-block":"none"),this.preferences.hideUploadInfo=a,this.savePreferences()};e?.addEventListener("click",()=>r(!0)),s?.addEventListener("click",()=>r(!1))}handleFile(t){const e=new FileReader;e.onload=s=>{const r=s.target?.result;this.parseCsv(r),this.renderPitcherTable()},e.readAsText(t)}parseCsv(t){const e=t.split(/\r?\n/).map(n=>n.trim()).filter(Boolean);if(e.length===0){this.pitcherRows=[];return}const s=[];(e[0].toLowerCase().startsWith("name")?e.slice(1):e).forEach((n,i)=>{const o=n.split(",").map(h=>h.trim());if(o.length===0||!o[0])return;const l={};L.forEach((h,u)=>{l[h.key]=o[u+1]??"-"});const c=o[0],p=this.calculateProjection(l);s.push({id:i,name:c,ratings:l,projection:p})}),this.pitcherRows=s,this.sortKey=void 0,this.sortDirection="asc"}renderPitcherTable(){const t=this.container.querySelector("#draft-results");if(!t)return;if(this.pitcherRows.length===0){t.innerHTML='<p class="no-results">Upload a CSV to see pitchers on your board.</p>';return}const e=this.getSortedRows().map((s,r)=>this.renderPlayerRows(s,r)).join("");t.innerHTML=`
      <div class="table-wrapper">
        <table class="stats-table draft-table draft-compact">
          <thead>
            <tr>
              <th class="rank-header" data-sort-key="rank">#</th>
              <th data-sort-key="name">Player</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>${e}</tbody>
        </table>
      </div>
    `,this.bindSortHeaders(),this.bindDragAndDrop()}renderPlayerRows(t,e){const s=e+1,r=s<=10?"rank-badge rank-top":"rank-badge",a=this.ensureProjection(t),n=L.map(o=>{const l=t.ratings[o.key]??"-",c=this.parseNumericValue(l)??0,p=this.getRatingTier(c),h=this.sortKey===o.key;return`
        <div class="cell rating-cell rating-${p} ${h?"sort-active":""}">
          <button type="button" class="cell-label" data-sort-key="${o.key}">
            ${this.escape(o.label)}
          </button>
          <div class="cell-value">${this.escape(l)}</div>
        </div>
      `}).join(""),i=[["proj_ip",0],["proj_k",0],["proj_bb",0],["proj_hr",0],["proj_h",0],["proj_k9",1],["proj_bb9",1],["proj_hr9",2],["proj_h9",1],["proj_fip",2],["proj_whip",2],["proj_war",1]].map(([o,l])=>{const c=a[o];return`
        <div class="cell ${this.sortKey===o?"sort-active":""}">
          <button type="button" class="cell-label" data-sort-key="${o}">
            ${this.escape(this.getProjectionLabel(o))}
          </button>
          <div class="cell-value">${this.formatNumber(c,l)}</div>
        </div>
      `}).join("");return`
      <tr class="draft-row rating-row" draggable="true" data-index="${e}">
        <td class="${r}">${s}.</td>
        <td class="player-cell player-name">
          <div class="cell-label" data-sort-key="name">Name</div>
          <div class="cell-value">${this.escape(t.name)}</div>
        </td>
        <td class="details-cell">
          <div class="grid rating-grid">
            ${n}
          </div>
        </td>
      </tr>
      <tr class="draft-row projection-row" draggable="true" data-index="${e}">
        <td></td>
        <td class="player-cell projection-label">
          <div class="cell-label">Projected</div>
          <div class="cell-value">Stats</div>
        </td>
        <td class="details-cell">
          <div class="grid projection-grid">
            ${i}
          </div>
        </td>
      </tr>
    `}bindSortHeaders(){this.container.querySelectorAll("[data-sort-key]").forEach(e=>{e.addEventListener("click",s=>{const r=e.dataset.sortKey;r&&(this.sortKey===r?this.sortDirection=this.sortDirection==="asc"?"desc":"asc":(this.sortKey=r,this.sortDirection="asc"),this.showSortHint(s),this.renderPitcherTable())})})}bindDragAndDrop(){const t=this.container.querySelectorAll(".draft-row");let e=null;t.forEach(s=>{s.addEventListener("dragstart",r=>{e=Number(s.dataset.index),s.classList.add("dragging"),r.dataTransfer?.setData("text/plain",String(e)),r.dataTransfer?.setDragImage(s,10,10)}),s.addEventListener("dragover",r=>{r.preventDefault(),s.classList.add("drag-over")}),s.addEventListener("dragleave",()=>{s.classList.remove("drag-over")}),s.addEventListener("drop",r=>{r.preventDefault(),s.classList.remove("drag-over");const a=Number(s.dataset.index);e===null||Number.isNaN(a)||(this.reorderRows(e,a),e=null)}),s.addEventListener("dragend",()=>{s.classList.remove("dragging")})})}reorderRows(t,e){if(t===e)return;const s=this.getSortedRows(),[r]=s.splice(t,1);s.splice(e,0,r),this.pitcherRows=s.map((a,n)=>({...a,id:n})),this.sortKey=void 0,this.renderPitcherTable()}getSortedRows(){if(!this.sortKey||this.sortKey==="rank")return[...this.pitcherRows];const t=U.some(r=>r.key===this.sortKey),e=L.some(r=>r.key===this.sortKey),s=[...this.pitcherRows].sort((r,a)=>{const n=this.getSortValue(r,this.sortKey,t,e),i=this.getSortValue(a,this.sortKey,t,e);return typeof n=="number"&&typeof i=="number"?n-i:String(n).localeCompare(String(i))});return this.sortDirection==="desc"&&s.reverse(),s}getSortValue(t,e,s,r){return e==="name"?t.name:e==="rank"?t.id:s?t.projection[e]??0:r?this.parseNumericValue(t.ratings[e])??0:0}calculateProjection(t){const e=n=>{const i=this.parseNumericValue(n);return i===null?50:Math.min(Math.max(i,20),80)},s={stuff:e(t.stu),control:e(t.con),hra:e(t.hra),movement:e(t.mov),babip:e(t.babip)},r=180,a=g.calculatePitchingStats(s,r);return{proj_ip:r,proj_k:this.safeNumber(a.k),proj_bb:this.safeNumber(a.bb),proj_hr:this.safeNumber(a.hr),proj_h:this.safeNumber(a.ha),proj_k9:this.safeNumber(a.k9),proj_bb9:this.safeNumber(a.bb9),proj_hr9:this.safeNumber(a.hr9),proj_h9:this.safeNumber(a.h9),proj_fip:this.safeNumber(a.fip),proj_whip:this.safeNumber(a.whip),proj_war:this.safeNumber(a.war)}}parseNumericValue(t){if(!t||t.trim()==="-")return null;const e=t.match(/(\d+(?:\.\d+)?)/g);if(!e||e.length===0)return null;const s=e.map(Number).filter(a=>!Number.isNaN(a));return s.length===0?null:s.reduce((a,n)=>a+n,0)/s.length}escape(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}formatNumber(t,e){return Number.isFinite(t)?t.toFixed(e):"-"}safeNumber(t){return Number.isFinite(t)?t:0}ensureProjection(t){if(!t.projection)return t.projection=this.calculateProjection(t.ratings),t.projection;const e=Object.keys(t.projection);for(const s of e){const r=t.projection[s];t.projection[s]=Number.isFinite(r)?r:0}return t.projection}getProjectionLabel(t){return{proj_ip:"IP",proj_k:"K",proj_bb:"BB",proj_hr:"HR",proj_h:"H",proj_k9:"K/9",proj_bb9:"BB/9",proj_hr9:"HR/9",proj_h9:"H/9",proj_fip:"FIP",proj_whip:"WHIP",proj_war:"WAR"}[t]??t}getRatingTier(t){return t>=70?"elite":t>=60?"plus":t>=50?"avg":t>=40?"fringe":"poor"}showSortHint(t){const e=document.createElement("div");e.className="sort-fade-hint",e.textContent=this.sortDirection==="asc"?"⬆️":"⬇️";const s=16;e.style.left=`${t.clientX+s}px`,e.style.top=`${t.clientY-s}px`,document.body.appendChild(e),requestAnimationFrame(()=>{e.classList.add("visible")}),setTimeout(()=>{e.classList.add("fade"),e.addEventListener("transitionend",()=>e.remove(),{once:!0}),setTimeout(()=>e.remove(),800)},900)}loadPreferences(){if(typeof window>"u")return{hideUploadInfo:!1};try{const t=localStorage.getItem(this.prefKey);return t?{hideUploadInfo:!!JSON.parse(t).hideUploadInfo}:{hideUploadInfo:!1}}catch{return{hideUploadInfo:!1}}}savePreferences(){if(!(typeof window>"u"))try{localStorage.setItem(this.prefKey,JSON.stringify(this.preferences))}catch{}}sampleCsv(){return["Name,STU P,MOV P,CON P,PBABIP P,HRR P,FBP,CHP,CBP,SLP,SIP,SPP,CTP,FOP,CCP,SCP,KCP,KNP,VT,STM","Hakim Abraha,45,45,45,45,45,80,40,-,60,-,-,-,-,-,-,-,-,100+,50","Brian Acorn,50,50,50,45,55,65,55,-,60,-,-,-,-,-,-,-,-,93-95,65","Tomohito Akamine,55,45,35,40,50,80,55,65,80,50,-,-,-,-,-,-,-,97-99,45"].join(`
`)}}class Y{container;overlay=null;constructor(t){this.container=t}show(t="Loading..."){this.overlay||(this.overlay=document.createElement("div"),this.overlay.className="loading-overlay",this.overlay.innerHTML=`
      <div class="loading-spinner"></div>
      <p class="loading-message">${this.escapeHtml(t)}</p>
    `,this.container.appendChild(this.overlay))}hide(){this.overlay&&(this.overlay.remove(),this.overlay=null)}escapeHtml(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}}class G{container;constructor(t){this.container=t}show(t){this.container.innerHTML=`
      <div class="error-container">
        <p class="error-message">${this.escapeHtml(t.message)}</p>
        <button class="error-dismiss">Dismiss</button>
      </div>
    `,this.container.querySelector(".error-dismiss")?.addEventListener("click",()=>this.hide())}hide(){this.container.innerHTML=""}escapeHtml(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}}class J{controller;searchView;playerListView;statsView;loadingView;errorView;activeTabId="tab-search";selectedYear;constructor(){this.controller=new q,this.initializeDOM(),this.initializeViews(),this.setupTabs(),this.bindController(),this.preloadPlayers()}initializeDOM(){const t=document.querySelector("#app");if(!t)throw new Error("App container not found");t.innerHTML=`
      <header class="app-header">
        <h1 class="app-title">WBL Stats</h1>
        <p class="app-subtitle">World Baseball League Player Statistics</p>
      </header>

      <nav class="tabs">
        <button class="tab-button active" data-tab-target="tab-search">Player Search</button>
        <button class="tab-button" data-tab-target="tab-potential">Stat Calculator</button>
        <button class="tab-button" data-tab-target="tab-draft">Draft Board</button>
      </nav>

      <div class="tab-panels">
        <section id="tab-search" class="tab-panel active">
          <div id="error-container"></div>
          <div id="search-container"></div>
          <div id="player-list-container"></div>
          <div id="stats-container"></div>
        </section>

        <section id="tab-potential" class="tab-panel">
          <div id="potential-stats-container"></div>
        </section>

        <section id="tab-draft" class="tab-panel">
          <div id="draft-board-container"></div>
        </section>
      </div>
      <div id="loading-container"></div>
    `}initializeViews(){const t=document.querySelector("#search-container"),e=document.querySelector("#player-list-container"),s=document.querySelector("#stats-container"),r=document.querySelector("#potential-stats-container"),a=document.querySelector("#draft-board-container"),n=document.querySelector("#loading-container"),i=document.querySelector("#error-container");this.searchView=new D(t,{onSearch:(o,l)=>this.handleSearch(o,l),years:{start:2e3,end:2022}}),this.playerListView=new K(e,{onPlayerSelect:o=>this.handlePlayerSelect(o)}),this.statsView=new O(s),new W(r),new z(a),this.loadingView=new Y(n),this.errorView=new G(i)}setupTabs(){document.querySelectorAll("[data-tab-target]").forEach(e=>{e.addEventListener("click",()=>{const s=e.dataset.tabTarget;s&&this.setActiveTab(s)})})}setActiveTab(t){if(this.activeTabId===t)return;this.activeTabId=t;const e=document.querySelectorAll("[data-tab-target]"),s=document.querySelectorAll(".tab-panel");e.forEach(r=>{r.classList.toggle("active",r.dataset.tabTarget===t)}),s.forEach(r=>{r.classList.toggle("active",r.id===t)}),t==="tab-search"&&this.searchView.focus()}bindController(){this.controller.setCallbacks({onSearch:t=>{this.playerListView.render(t.players,t.query),this.statsView.clear()},onStats:t=>{this.statsView.render(t.player,t.pitchingStats,t.battingStats,t.year),this.playerListView.clear()},onError:t=>{this.errorView.show(t)},onLoading:t=>{t?this.loadingView.show():this.loadingView.hide(),this.searchView.setLoading(t)}})}handleSearch(t,e){this.selectedYear=e,this.controller.searchPlayers(t)}handlePlayerSelect(t){this.controller.getPlayerStats(t.id,this.selectedYear)}preloadPlayers(){this.controller.preloadPlayers()}}document.addEventListener("DOMContentLoaded",()=>{new J});
