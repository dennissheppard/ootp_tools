(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))a(s);new MutationObserver(s=>{for(const r of s)if(r.type==="childList")for(const n of r.addedNodes)n.tagName==="LINK"&&n.rel==="modulepreload"&&a(n)}).observe(document,{childList:!0,subtree:!0});function e(s){const r={};return s.integrity&&(r.integrity=s.integrity),s.referrerPolicy&&(r.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?r.credentials="include":s.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function a(s){if(s.ep)return;s.ep=!0;const r=e(s);fetch(s.href,r)}})();const N={1:"P",2:"C",3:"1B",4:"2B",5:"3B",6:"SS",7:"LF",8:"CF",9:"RF",10:"DH"};function B(d){return N[d]||"Unknown"}function E(d){return d.position===1}function j(d){return`${d.firstName} ${d.lastName}`}const _="/api",y="wbl_players_cache",S="wbl_players_cache_timestamp",A=1440*60*1e3;class R{players=[];loading=null;async getAllPlayers(t=!1){if(this.players.length>0&&!t)return this.players;if(!t){const e=this.loadFromCache();if(e)return this.players=e,this.players}if(this.loading)return this.loading;this.loading=this.fetchPlayers();try{return this.players=await this.loading,this.saveToCache(this.players),this.players}finally{this.loading=null}}async searchPlayers(t){const e=await this.getAllPlayers(),a=t.toLowerCase().trim();return a?e.filter(s=>{const r=`${s.firstName} ${s.lastName}`.toLowerCase(),n=`${s.lastName} ${s.firstName}`.toLowerCase();return r.includes(a)||n.includes(a)||s.firstName.toLowerCase().includes(a)||s.lastName.toLowerCase().includes(a)}):[]}async getPlayerById(t){return(await this.getAllPlayers()).find(a=>a.id===t)}async fetchPlayers(){const t=await fetch(`${_}/players/`);if(!t.ok)throw new Error(`Failed to fetch players: ${t.statusText}`);const e=await t.text();return this.parsePlayersCsv(e)}parsePlayersCsv(t){return t.trim().split(`
`).slice(1).map(s=>{const r=this.parseCsvLine(s);return{id:parseInt(r[0],10),firstName:r[1],lastName:r[2],teamId:parseInt(r[3],10),parentTeamId:parseInt(r[4],10),level:parseInt(r[5],10),position:parseInt(r[6],10),role:parseInt(r[7],10),age:parseInt(r[8],10),retired:r[9]==="1"}})}parseCsvLine(t){const e=[];let a="",s=!1;for(let r=0;r<t.length;r++){const n=t[r];n==='"'?s=!s:n===","&&!s?(e.push(a),a=""):a+=n}return e.push(a),e}loadFromCache(){try{const t=localStorage.getItem(S);if(!t)return null;if(Date.now()-parseInt(t,10)>A)return this.clearCache(),null;const a=localStorage.getItem(y);return a?JSON.parse(a):null}catch{return this.clearCache(),null}}saveToCache(t){try{localStorage.setItem(y,JSON.stringify(t)),localStorage.setItem(S,Date.now().toString())}catch{}}clearCache(){localStorage.removeItem(y),localStorage.removeItem(S)}}const x=new R,k="/api";class V{async getPitchingStats(t,e){let a=`${k}/playerpitchstatsv2/?pid=${t}`;e&&(a+=`&year=${e}`);const s=await fetch(a);if(!s.ok)throw new Error(`Failed to fetch pitching stats: ${s.statusText}`);const r=await s.text();return r.trim()?this.parsePitchingStatsCsv(r):[]}async getBattingStats(t,e){let a=`${k}/playerbatstatsv2/?pid=${t}`;e&&(a+=`&year=${e}`);const s=await fetch(a);if(!s.ok)throw new Error(`Failed to fetch batting stats: ${s.statusText}`);const r=await s.text();return r.trim()?this.parseBattingStatsCsv(r):[]}parsePitchingStatsCsv(t){const e=t.trim().split(`
`);if(e.length<2)return[];const a=this.parseCsvLine(e[0]);return e.slice(1).map(r=>{const n=this.parseCsvLine(r),i=this.zipToObject(a,n),o=parseFloat(i.ip)||0,l=parseInt(i.er,10)||0,c=parseInt(i.ha,10)||0,p=parseInt(i.bb,10)||0,h=parseInt(i.k,10)||0,u=o>0?l/o*9:0,b=o>0?(p+c)/o:0,v=o>0?h/o*9:0,f=o>0?p/o*9:0;return{id:parseInt(i.id,10),playerId:parseInt(i.player_id,10),year:parseInt(i.year,10),teamId:parseInt(i.team_id,10),leagueId:parseInt(i.league_id,10),levelId:parseInt(i.level_id,10),splitId:parseInt(i.split_id,10),ip:o,w:parseInt(i.w,10)||0,l:parseInt(i.l,10)||0,era:u,g:parseInt(i.g,10)||0,gs:parseInt(i.gs,10)||0,sv:parseInt(i.s,10)||0,bf:parseInt(i.bf,10)||0,ab:parseInt(i.ab,10)||0,ha:c,er:l,r:parseInt(i.r,10)||0,bb:p,k:h,hr:parseInt(i.hra,10)||0,whip:b,k9:v,bb9:f,war:parseFloat(i.war)||0,cg:parseInt(i.cg,10)||0,sho:parseInt(i.sho,10)||0,hld:parseInt(i.hld,10)||0,bs:parseInt(i.bs,10)||0,qs:parseInt(i.qs,10)||0}})}parseBattingStatsCsv(t){const e=t.trim().split(`
`);if(e.length<2)return[];const a=this.parseCsvLine(e[0]);return e.slice(1).map(r=>{const n=this.parseCsvLine(r),i=this.zipToObject(a,n),o=parseInt(i.ab,10)||0,l=parseInt(i.h,10)||0,c=parseInt(i.bb,10)||0,p=parseInt(i.hp,10)||0,h=parseInt(i.sf,10)||0,u=parseInt(i.d,10)||0,b=parseInt(i.t,10)||0,v=parseInt(i.hr,10)||0,f=parseInt(i.pa,10)||0,H=o>0?l/o:0,$=o+c+p+h,I=$>0?(l+c+p)/$:0,T=l+u+2*b+3*v,C=o>0?T/o:0,M=I+C;return{id:parseInt(i.id,10),playerId:parseInt(i.player_id,10),year:parseInt(i.year,10),teamId:parseInt(i.team_id,10),leagueId:parseInt(i.league_id,10),levelId:parseInt(i.level_id,10),splitId:parseInt(i.split_id,10),g:parseInt(i.g,10)||0,ab:o,pa:f,h:l,d:u,t:b,hr:v,r:parseInt(i.r,10)||0,rbi:parseInt(i.rbi,10)||0,bb:c,k:parseInt(i.k,10)||0,sb:parseInt(i.sb,10)||0,cs:parseInt(i.cs,10)||0,avg:H,obp:I,slg:C,ops:M,war:parseFloat(i.war)||0,ibb:parseInt(i.ibb,10)||0,hp:p,sh:parseInt(i.sh,10)||0,sf:h,gdp:parseInt(i.gdp,10)||0}})}parseCsvLine(t){const e=[];let a="",s=!1;for(let r=0;r<t.length;r++){const n=t[r];n==='"'?s=!s:n===","&&!s?(e.push(a),a=""):a+=n}return e.push(a),e}zipToObject(t,e){const a={};return t.forEach((s,r)=>{a[s]=e[r]??""}),a}}const F=new V;class q{playerService;statsService;onSearch;onStats;onError;onLoading;constructor(t=x,e=F){this.playerService=t,this.statsService=e}setCallbacks(t){this.onSearch=t.onSearch,this.onStats=t.onStats,this.onError=t.onError,this.onLoading=t.onLoading}async searchPlayers(t){if(!t.trim()){this.onSearch?.({players:[],query:t});return}try{this.onLoading?.(!0);const e=await this.playerService.searchPlayers(t);this.onSearch?.({players:e,query:t})}catch(e){this.onError?.(e instanceof Error?e:new Error(String(e)))}finally{this.onLoading?.(!1)}}async getPlayerStats(t,e){try{this.onLoading?.(!0);const a=await this.playerService.getPlayerById(t);if(!a)throw new Error(`Player with ID ${t} not found`);let s=[],r=[];E(a)?(s=await this.statsService.getPitchingStats(t,e),r=await this.statsService.getBattingStats(t,e)):(r=await this.statsService.getBattingStats(t,e),s=await this.statsService.getPitchingStats(t,e)),this.onStats?.({player:a,pitchingStats:s,battingStats:r,year:e})}catch(a){this.onError?.(a instanceof Error?a:new Error(String(a)))}finally{this.onLoading?.(!1)}}async preloadPlayers(){try{this.onLoading?.(!0),await this.playerService.getAllPlayers()}catch(t){this.onError?.(t instanceof Error?t:new Error(String(t)))}finally{this.onLoading?.(!1)}}}class D{container;searchInput;yearSelect;searchButton;onSearch;constructor(t,e){this.container=t,this.onSearch=e.onSearch,this.render(e.years),this.attachEventListeners()}render(t){this.container.innerHTML=`
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
    `,this.searchInput=this.container.querySelector("#player-search"),this.yearSelect=this.container.querySelector("#year-select"),this.searchButton=this.container.querySelector("#search-button")}generateYearOptions(t,e){const a=[];for(let s=e;s>=t;s--)a.push(`<option value="${s}">${s}</option>`);return a.join("")}attachEventListeners(){this.searchButton.addEventListener("click",()=>this.handleSearch()),this.searchInput.addEventListener("keydown",t=>{t.key==="Enter"&&this.handleSearch()})}handleSearch(){const t=this.searchInput.value.trim(),e=this.yearSelect.value,a=e?parseInt(e,10):void 0;this.onSearch(t,a)}setLoading(t){this.searchButton.disabled=t,this.searchButton.textContent=t?"Searching...":"Search"}clear(){this.searchInput.value="",this.yearSelect.value=""}focus(){this.searchInput.focus()}}class O{container;onPlayerSelect;players=[];constructor(t,e){this.container=t,this.onPlayerSelect=e.onPlayerSelect}render(t,e){if(this.players=t,t.length===0&&e){this.container.innerHTML=`
        <div class="player-list-empty">
          <p>No players found matching "${this.escapeHtml(e)}"</p>
        </div>
      `;return}if(t.length===0){this.container.innerHTML="";return}const a=t.slice(0,50).map((n,i)=>this.renderPlayerItem(n,i)).join(""),s=t.length-50,r=s>0?`<p class="player-list-more">And ${s} more results. Try a more specific search.</p>`:"";this.container.innerHTML=`
      <div class="player-list">
        <h3 class="player-list-title">Select a player (${t.length} found)</h3>
        <ul class="player-list-items">
          ${a}
        </ul>
        ${r}
      </div>
    `,this.attachEventListeners()}renderPlayerItem(t,e){const a=B(t.position),s=t.retired?'<span class="badge badge-retired">Retired</span>':"";return`
      <li class="player-list-item" data-index="${e}">
        <span class="player-name">${this.escapeHtml(j(t))}</span>
        <span class="player-position">${a}</span>
        ${s}
      </li>
    `}attachEventListeners(){this.container.querySelectorAll(".player-list-item").forEach(e=>{e.addEventListener("click",()=>{const a=parseInt(e.getAttribute("data-index")||"0",10),s=this.players[a];s&&this.onPlayerSelect(s)})})}clear(){this.container.innerHTML="",this.players=[]}escapeHtml(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}}class K{container;constructor(t){this.container=t}render(t,e,a,s){const r=s?` (${s})`:" (All Years)",n=B(t.position),i=e.filter(u=>u.splitId===1),o=a.filter(u=>u.splitId===1),l=i.length>0?this.renderPitchingTable(i):"",c=o.length>0?this.renderBattingTable(o):"",h=!l&&!c?`<p class="no-stats">No stats found for this player${r}.</p>`:"";this.container.innerHTML=`
      <div class="stats-container">
        <div class="player-header">
          <h2 class="player-title">${this.escapeHtml(j(t))}</h2>
          <span class="player-info">
            <span class="badge badge-position">${n}</span>
            ${t.retired?'<span class="badge badge-retired">Retired</span>':""}
          </span>
        </div>
        <p class="stats-period">Stats${r}</p>
        ${h}
        ${E(t)?l+c:c+l}
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
              ${t.map(a=>`
      <tr>
        <td>${a.year}</td>
        <td>${a.g}</td>
        <td>${a.gs}</td>
        <td>${a.w}</td>
        <td>${a.l}</td>
        <td>${a.sv}</td>
        <td>${this.formatDecimal(a.ip,1)}</td>
        <td>${a.ha}</td>
        <td>${a.er}</td>
        <td>${a.bb}</td>
        <td>${a.k}</td>
        <td>${a.hr}</td>
        <td>${this.formatDecimal(a.era,2)}</td>
        <td>${this.formatDecimal(a.whip,2)}</td>
        <td>${this.formatDecimal(a.k9,1)}</td>
        <td>${this.formatDecimal(a.war,1)}</td>
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
              ${t.map(a=>`
      <tr>
        <td>${a.year}</td>
        <td>${a.g}</td>
        <td>${a.pa}</td>
        <td>${a.ab}</td>
        <td>${a.h}</td>
        <td>${a.d}</td>
        <td>${a.t}</td>
        <td>${a.hr}</td>
        <td>${a.r}</td>
        <td>${a.rbi}</td>
        <td>${a.bb}</td>
        <td>${a.k}</td>
        <td>${a.sb}</td>
        <td>${this.formatAvg(a.avg)}</td>
        <td>${this.formatAvg(a.obp)}</td>
        <td>${this.formatAvg(a.slg)}</td>
        <td>${this.formatAvg(a.ops)}</td>
        <td>${this.formatDecimal(a.war,1)}</td>
      </tr>
    `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `}clear(){this.container.innerHTML=""}formatDecimal(t,e){return t.toFixed(e)}formatAvg(t){return t>=1?t.toFixed(3):t.toFixed(3).replace(/^0/,"")}escapeHtml(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}}const m={k9:{intercept:-1.654,linear:.22275,quadratic:-.0014204},bb9:{intercept:8.267,linear:-.16971,quadratic:.0010962},hr9:{intercept:3.989,linear:-.0981,quadratic:7065e-7},h9:{intercept:12.914,babipCoef:-.06536,movementCoef:-.03712}},P={avgFIP:4.1,fipConstant:3.1,runsPerWin:10},w=180;class g{static calcPolynomial(t,e){return t.intercept+t.linear*e+t.quadratic*e*e}static calculateK9(t){const e=this.calcPolynomial(m.k9,t);return Math.max(0,Math.min(15,e))}static calculateBB9(t){const e=this.calcPolynomial(m.bb9,t);return Math.max(0,Math.min(10,e))}static calculateHR9(t){const e=this.calcPolynomial(m.hr9,t);return Math.max(0,Math.min(3,e))}static calculateH9(t,e){const a=m.h9.intercept+m.h9.babipCoef*t+m.h9.movementCoef*e;return Math.max(5,Math.min(15,a))}static calculatePitchingStats(t,e=w){const a=this.calculateK9(t.stuff),s=this.calculateBB9(t.control),r=this.calculateHR9(t.hra),n=this.calculateH9(t.babip,t.movement),i=Math.round(a/9*e),o=Math.round(s/9*e),l=Math.round(r/9*e),c=Math.round(n/9*e),p=(o+c)/e,h=(13*l+3*o-2*i)/e+P.fipConstant,u=h+(Math.random()*.4-.2),b=e*2.9+c,v=c/b,f=(P.avgFIP-h)/P.runsPerWin*(e/9);return{k9:Math.round(a*10)/10,bb9:Math.round(s*10)/10,hr9:Math.round(r*10)/10,h9:Math.round(n*10)/10,ip:Math.round(e*10)/10,ha:c,hr:l,bb:o,k:i,era:Math.round(Math.max(0,u)*100)/100,fip:Math.round(Math.max(0,h)*100)/100,whip:Math.round(p*100)/100,oavg:Math.round(v*1e3)/1e3,war:Math.round(f*10)/10}}static getStatRange(t,e){const a={k9:{variance:1.5},bb9:{variance:.8},hr9:{variance:.4},h9:{variance:1.5}};let s;switch(t){case"k9":s=this.calculateK9(e);break;case"bb9":s=this.calculateBB9(e);break;case"hr9":s=this.calculateHR9(e);break;case"h9":s=this.calculateH9(e,50);break}const r=a[t].variance;return{low:Math.max(0,s-r),mid:s,high:s+r}}static calculateBulkStats(t){return t.map((e,a)=>({name:e.name||`Pitcher ${a+1}`,...e,...this.calculatePitchingStats(e,e.ip||w)}))}static parseCSV(t){const e=t.trim().split(`
`),a=[],s=e[0].toLowerCase().includes("stuff")?1:0;for(let r=s;r<e.length;r++){const n=e[r].trim();if(!n)continue;const i=n.split(",").map(c=>c.trim());let o,l;isNaN(Number(i[0]))?(o=i[0],l=i.slice(1).map(Number)):(o=`Pitcher ${a.length+1}`,l=i.map(Number)),l.length>=5&&l.slice(0,5).every(c=>!isNaN(c))&&a.push({name:o,stuff:l[0],control:l[1],hra:l[2],movement:l[3],babip:l[4],ip:l[5]||void 0})}return a}static validateRatings(t){const e=[],a=(s,r,n,i)=>{(r<n||r>i)&&e.push(`${s} must be between ${n} and ${i} (got ${r})`)};return a("Stuff",t.stuff,20,80),a("Control",t.control,20,80),a("HRA",t.hra,20,80),a("Movement",t.movement,20,80),a("BABIP",t.babip,20,80),e}static comparePitchers(t,e,a=w){const s=this.calculatePitchingStats(t,a),r=this.calculatePitchingStats(e,a),n={k:s.k-r.k,bb:s.bb-r.bb,hr:s.hr-r.hr,war:s.war-r.war};return[`Over ${a} IP:`,`  Ks: ${s.k} vs ${r.k} (${n.k>0?"+":""}${n.k})`,`  BBs: ${s.bb} vs ${r.bb} (${n.bb>0?"+":""}${n.bb})`,`  HRs: ${s.hr} vs ${r.hr} (${n.hr>0?"+":""}${n.hr})`,`  WAR: ${s.war.toFixed(1)} vs ${r.war.toFixed(1)} (${n.war>0?"+":""}${n.war.toFixed(1)})`].join(`
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
    `,this.bindEvents()}bindEvents(){this.container.querySelector("#rating-form")?.addEventListener("submit",n=>{n.preventDefault(),this.handleManualEntry()});const e=this.container.querySelector("#csv-file-input"),a=this.container.querySelector("#csv-browse-btn"),s=this.container.querySelector("#csv-drop-zone");a?.addEventListener("click",()=>e?.click()),e?.addEventListener("change",n=>{const i=n.target.files?.[0];i&&this.handleCSVFile(i)}),s?.addEventListener("dragover",n=>{n.preventDefault(),s.classList.add("drag-over")}),s?.addEventListener("dragleave",()=>{s.classList.remove("drag-over")}),s?.addEventListener("drop",n=>{n.preventDefault(),s.classList.remove("drag-over");const i=n.dataTransfer?.files[0];i&&i.name.endsWith(".csv")&&this.handleCSVFile(i)}),this.container.querySelector("#clear-results-btn")?.addEventListener("click",()=>{this.results=[],this.renderResults()})}handleManualEntry(){const t=o=>{const l=this.container.querySelector(`#${o}`);return Number(l?.value)||50},e=this.container.querySelector("#rating-name"),a=e?.value.trim()||`Pitcher ${this.results.length+1}`,s={stuff:t("rating-stuff"),control:t("rating-control"),hra:t("rating-hra"),movement:t("rating-movement"),babip:t("rating-babip")},r=t("rating-ip"),n=g.validateRatings(s);if(n.length>0){alert(n.join(`
`));return}const i=g.calculatePitchingStats(s,r);this.results.push({name:a,...s,...i}),e&&(e.value=""),this.renderResults()}handleCSVFile(t){const e=new FileReader;e.onload=a=>{const s=a.target?.result;try{const r=g.parseCSV(s);if(r.length===0){alert("No valid data found in CSV");return}const n=g.calculateBulkStats(r);this.results.push(...n),this.renderResults()}catch(r){alert("Error parsing CSV file"),console.error(r)}},e.readAsText(t)}renderResults(){const t=this.container.querySelector("#results-table-wrapper"),e=this.container.querySelector("#clear-results-btn");if(!t)return;if(this.results.length===0){t.innerHTML='<p class="no-results">No results yet. Enter ratings above to see WBL projections.</p>',e&&(e.style.display="none");return}e&&(e.style.display="block");const a=this.results.map((s,r)=>`
      <tr>
        <td class="name-cell">
          ${this.escapeHtml(s.name)}
          <button type="button" class="btn-remove" data-index="${r}" title="Remove">x</button>
        </td>
        <td>${s.stuff}</td>
        <td>${s.control}</td>
        <td>${s.hra}</td>
        <td>${s.movement}</td>
        <td>${s.babip}</td>
        <td class="divider"></td>
        <td>${s.ip.toFixed(0)}</td>
        <td>${s.k}</td>
        <td>${s.bb}</td>
        <td>${s.hr}</td>
        <td>${s.ha}</td>
        <td class="divider"></td>
        <td>${s.k9.toFixed(1)}</td>
        <td>${s.bb9.toFixed(1)}</td>
        <td>${s.hr9.toFixed(2)}</td>
        <td>${s.h9.toFixed(1)}</td>
        <td class="divider"></td>
        <td>${s.fip.toFixed(2)}</td>
        <td>${s.whip.toFixed(2)}</td>
        <td class="${s.war>=0?"war-positive":"war-negative"}">${s.war.toFixed(1)}</td>
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
            ${a}
          </tbody>
        </table>
      </div>
    `,t.querySelectorAll(".btn-remove").forEach(s=>{s.addEventListener("click",r=>{const n=Number(r.target.dataset.index);this.results.splice(n,1),this.renderResults()})})}escapeHtml(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}clear(){this.results=[],this.renderResults()}}const L=[{key:"stu",label:"STU P"},{key:"mov",label:"MOV P"},{key:"con",label:"CON P"},{key:"babip",label:"PBABIP P"},{key:"hra",label:"HRR P"},{key:"fb",label:"FBP"},{key:"ch",label:"CHP"},{key:"cb",label:"CBP"},{key:"sl",label:"SLP"},{key:"si",label:"SIP"},{key:"sp",label:"SPP"},{key:"ct",label:"CTP"},{key:"fo",label:"FOP"},{key:"cc",label:"CCP"},{key:"sc",label:"SCP"},{key:"kc",label:"KCP"},{key:"kn",label:"KNP"},{key:"vt",label:"VT"},{key:"stm",label:"STM"}],U=[{key:"proj_ip",label:"IP"},{key:"proj_k",label:"K"},{key:"proj_bb",label:"BB"},{key:"proj_hr",label:"HR"},{key:"proj_h",label:"H"},{key:"proj_k9",label:"K/9"},{key:"proj_bb9",label:"BB/9"},{key:"proj_hr9",label:"HR/9"},{key:"proj_h9",label:"H/9"},{key:"proj_fip",label:"FIP"},{key:"proj_whip",label:"WHIP"},{key:"proj_war",label:"WAR"}];class z{container;mode="pitchers";pitcherRows=[];sortKey;sortDirection="asc";constructor(t){this.container=t,this.render(),this.bindModeToggle(),this.bindUpload()}render(){this.container.innerHTML=`
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
            <div class="upload-info">
              <p class="draft-subtitle">Upload pitcher CSV (one row per player)</p>
              <pre class="csv-sample"><code>${this.sampleCsv()}</code></pre>
            </div>
            <div class="upload-actions">
              <div class="csv-upload-area" id="draft-drop-zone">
                <input type="file" id="draft-file-input" accept=".csv" hidden>
                <p>Drop CSV here or <button type="button" class="btn-link" id="draft-browse-btn">browse</button></p>
              </div>
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
    `,this.renderPitcherTable()}bindModeToggle(){this.container.querySelectorAll(".toggle-btn").forEach(e=>{e.addEventListener("click",()=>{const a=e.dataset.mode;a&&a!==this.mode&&this.setMode(a)})})}setMode(t){this.mode=t,this.container.querySelectorAll(".toggle-btn").forEach(s=>{const r=s.dataset.mode===t;s.classList.toggle("active",r),s.setAttribute("aria-selected",r?"true":"false")}),this.container.querySelectorAll(".draft-section").forEach(s=>{const r=s.dataset.section===t;s.classList.toggle("hidden",!r)})}bindUpload(){const t=this.container.querySelector("#draft-file-input"),e=this.container.querySelector("#draft-browse-btn"),a=this.container.querySelector("#draft-drop-zone");e?.addEventListener("click",()=>t?.click()),t?.addEventListener("change",s=>{const r=s.target.files?.[0];r&&this.handleFile(r)}),a?.addEventListener("dragover",s=>{s.preventDefault(),a.classList.add("drag-over")}),a?.addEventListener("dragleave",()=>{a.classList.remove("drag-over")}),a?.addEventListener("drop",s=>{s.preventDefault(),a.classList.remove("drag-over");const r=s.dataTransfer?.files[0];r&&r.name.endsWith(".csv")&&this.handleFile(r)})}handleFile(t){const e=new FileReader;e.onload=a=>{const s=a.target?.result;this.parseCsv(s),this.renderPitcherTable()},e.readAsText(t)}parseCsv(t){const e=t.split(/\r?\n/).map(n=>n.trim()).filter(Boolean);if(e.length===0){this.pitcherRows=[];return}const a=[];(e[0].toLowerCase().startsWith("name")?e.slice(1):e).forEach((n,i)=>{const o=n.split(",").map(h=>h.trim());if(o.length===0||!o[0])return;const l={};L.forEach((h,u)=>{l[h.key]=o[u+1]??"-"});const c=o[0],p=this.calculateProjection(l);a.push({id:i,name:c,ratings:l,projection:p})}),this.pitcherRows=a,this.sortKey=void 0,this.sortDirection="asc"}renderPitcherTable(){const t=this.container.querySelector("#draft-results");if(!t)return;if(this.pitcherRows.length===0){t.innerHTML='<p class="no-results">Upload a CSV to see pitchers on your board.</p>';return}const e=this.getSortedRows().map((a,s)=>this.renderPlayerRows(a,s)).join("");t.innerHTML=`
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
    `,this.bindSortHeaders(),this.bindDragAndDrop()}renderPlayerRows(t,e){const a=e+1,s=a<=10?"rank-badge rank-top":"rank-badge",r=this.ensureProjection(t),n=L.map(o=>`
      <div class="cell">
        <button type="button" class="cell-label" data-sort-key="${o.key}">${this.escape(o.label)}</button>
        <div class="cell-value">${this.escape(t.ratings[o.key]??"-")}</div>
      </div>
    `).join(""),i=[["proj_ip",0],["proj_k",0],["proj_bb",0],["proj_hr",0],["proj_h",0],["proj_k9",1],["proj_bb9",1],["proj_hr9",2],["proj_h9",1],["proj_fip",2],["proj_whip",2],["proj_war",1]].map(([o,l])=>{const c=r[o];return`
        <div class="cell">
          <button type="button" class="cell-label" data-sort-key="${o}">${this.escape(this.getProjectionLabel(o))}</button>
          <div class="cell-value">${this.formatNumber(c,l)}</div>
        </div>
      `}).join("");return`
      <tr class="draft-row rating-row" draggable="true" data-index="${e}">
        <td class="${s}">${a}.</td>
        <td class="player-name">
          <div class="cell-label">Name</div>
          <div class="cell-value">${this.escape(t.name)}</div>
        </td>
        <td>
          <div class="grid rating-grid">
            ${n}
          </div>
        </td>
      </tr>
      <tr class="draft-row projection-row" draggable="true" data-index="${e}">
        <td></td>
        <td class="projection-label">
          <div class="cell-label">Projected</div>
          <div class="cell-value">Stats</div>
        </td>
        <td>
          <div class="grid projection-grid">
            ${i}
          </div>
        </td>
      </tr>
    `}bindSortHeaders(){this.container.querySelectorAll("th[data-sort-key]").forEach(e=>{e.addEventListener("click",()=>{const a=e.dataset.sortKey;a&&(this.sortKey===a?this.sortDirection=this.sortDirection==="asc"?"desc":"asc":(this.sortKey=a,this.sortDirection="asc"),this.renderPitcherTable())})})}bindDragAndDrop(){const t=this.container.querySelectorAll(".draft-row");let e=null;t.forEach(a=>{a.addEventListener("dragstart",s=>{e=Number(a.dataset.index),a.classList.add("dragging"),s.dataTransfer?.setData("text/plain",String(e)),s.dataTransfer?.setDragImage(a,10,10)}),a.addEventListener("dragover",s=>{s.preventDefault(),a.classList.add("drag-over")}),a.addEventListener("dragleave",()=>{a.classList.remove("drag-over")}),a.addEventListener("drop",s=>{s.preventDefault(),a.classList.remove("drag-over");const r=Number(a.dataset.index);e===null||Number.isNaN(r)||(this.reorderRows(e,r),e=null)}),a.addEventListener("dragend",()=>{a.classList.remove("dragging")})})}reorderRows(t,e){if(t===e)return;const a=this.getSortedRows(),[s]=a.splice(t,1);a.splice(e,0,s),this.pitcherRows=a.map((r,n)=>({...r,id:n})),this.sortKey=void 0,this.renderPitcherTable()}getSortedRows(){if(!this.sortKey||this.sortKey==="rank")return[...this.pitcherRows];const t=U.some(s=>s.key===this.sortKey),e=L.some(s=>s.key===this.sortKey),a=[...this.pitcherRows].sort((s,r)=>{const n=this.getSortValue(s,this.sortKey,t,e),i=this.getSortValue(r,this.sortKey,t,e);return typeof n=="number"&&typeof i=="number"?n-i:String(n).localeCompare(String(i))});return this.sortDirection==="desc"&&a.reverse(),a}getSortValue(t,e,a,s){return e==="name"?t.name:e==="rank"?t.id:a?t.projection[e]??0:s?this.parseNumericValue(t.ratings[e])??0:0}calculateProjection(t){const e=n=>{const i=this.parseNumericValue(n);return i===null?50:Math.min(Math.max(i,20),80)},a={stuff:e(t.stu),control:e(t.con),hra:e(t.hra),movement:e(t.mov),babip:e(t.babip)},s=180,r=g.calculatePitchingStats(a,s);return{proj_ip:s,proj_k:this.safeNumber(r.k),proj_bb:this.safeNumber(r.bb),proj_hr:this.safeNumber(r.hr),proj_h:this.safeNumber(r.ha),proj_k9:this.safeNumber(r.k9),proj_bb9:this.safeNumber(r.bb9),proj_hr9:this.safeNumber(r.hr9),proj_h9:this.safeNumber(r.h9),proj_fip:this.safeNumber(r.fip),proj_whip:this.safeNumber(r.whip),proj_war:this.safeNumber(r.war)}}parseNumericValue(t){if(!t||t.trim()==="-")return null;const e=t.match(/(\d+(?:\.\d+)?)/g);if(!e||e.length===0)return null;const a=e.map(Number).filter(r=>!Number.isNaN(r));return a.length===0?null:a.reduce((r,n)=>r+n,0)/a.length}escape(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}formatNumber(t,e){return Number.isFinite(t)?t.toFixed(e):"-"}safeNumber(t){return Number.isFinite(t)?t:0}ensureProjection(t){if(!t.projection)return t.projection=this.calculateProjection(t.ratings),t.projection;const e=Object.keys(t.projection);for(const a of e){const s=t.projection[a];t.projection[a]=Number.isFinite(s)?s:0}return t.projection}getProjectionLabel(t){return{proj_ip:"IP",proj_k:"K",proj_bb:"BB",proj_hr:"HR",proj_h:"H",proj_k9:"K/9",proj_bb9:"BB/9",proj_hr9:"HR/9",proj_h9:"H/9",proj_fip:"FIP",proj_whip:"WHIP",proj_war:"WAR"}[t]??t}sampleCsv(){return["Name,STU P,MOV P,CON P,PBABIP P,HRR P,FBP,CHP,CBP,SLP,SIP,SPP,CTP,FOP,CCP,SCP,KCP,KNP,VT,STM","Hakim Abraha,45,45,45,45,45,80,40,-,60,-,-,-,-,-,-,-,-,100+,50","Brian Acorn,50,50,50,45,55,65,55,-,60,-,-,-,-,-,-,-,-,93-95,65","Tomohito Akamine,55,45,35,40,50,80,55,65,80,50,-,-,-,-,-,-,-,97-99,45"].join(`
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
    `}initializeViews(){const t=document.querySelector("#search-container"),e=document.querySelector("#player-list-container"),a=document.querySelector("#stats-container"),s=document.querySelector("#potential-stats-container"),r=document.querySelector("#draft-board-container"),n=document.querySelector("#loading-container"),i=document.querySelector("#error-container");this.searchView=new D(t,{onSearch:(o,l)=>this.handleSearch(o,l),years:{start:2e3,end:2022}}),this.playerListView=new O(e,{onPlayerSelect:o=>this.handlePlayerSelect(o)}),this.statsView=new K(a),new W(s),new z(r),this.loadingView=new Y(n),this.errorView=new G(i)}setupTabs(){document.querySelectorAll("[data-tab-target]").forEach(e=>{e.addEventListener("click",()=>{const a=e.dataset.tabTarget;a&&this.setActiveTab(a)})})}setActiveTab(t){if(this.activeTabId===t)return;this.activeTabId=t;const e=document.querySelectorAll("[data-tab-target]"),a=document.querySelectorAll(".tab-panel");e.forEach(s=>{s.classList.toggle("active",s.dataset.tabTarget===t)}),a.forEach(s=>{s.classList.toggle("active",s.id===t)}),t==="tab-search"&&this.searchView.focus()}bindController(){this.controller.setCallbacks({onSearch:t=>{this.playerListView.render(t.players,t.query),this.statsView.clear()},onStats:t=>{this.statsView.render(t.player,t.pitchingStats,t.battingStats,t.year),this.playerListView.clear()},onError:t=>{this.errorView.show(t)},onLoading:t=>{t?this.loadingView.show():this.loadingView.hide(),this.searchView.setLoading(t)}})}handleSearch(t,e){this.selectedYear=e,this.controller.searchPlayers(t)}handlePlayerSelect(t){this.controller.getPlayerStats(t.id,this.selectedYear)}preloadPlayers(){this.controller.preloadPlayers()}}document.addEventListener("DOMContentLoaded",()=>{new J});
