/**
 * BatterProjectionAnalysisService
 *
 * Validates batter projections against actual results by comparing
 * projected vs actual stats across multiple years.
 *
 * Metrics tracked:
 * - wOBA (primary offensive value)
 * - BB%, K%, AVG (rate stats)
 * - WAR (overall value)
 *
 * Analysis breakdowns:
 * - By team
 * - By age bucket
 * - By position group (C, IF, OF, DH)
 * - By performance quartile (based on actual wOBA)
 */

import { batterProjectionService } from './BatterProjectionService';
import { trueRatingsService } from './TrueRatingsService';
import { leagueBattingAveragesService } from './LeagueBattingAveragesService';
import { teamService } from './TeamService';

export interface BatterAccuracyMetrics {
  mae: number;
  rmse: number;
  count: number;
  bias: number;
}

export interface BatterStatMetrics {
  woba: BatterAccuracyMetrics;
  bbPct: BatterAccuracyMetrics;
  kPct: BatterAccuracyMetrics;
  hrPct: BatterAccuracyMetrics;
  avg: BatterAccuracyMetrics;
  war: BatterAccuracyMetrics;
}

export interface BatterStatDiffs {
  woba: number;
  bbPct: number;
  kPct: number;
  hrPct: number;
  avg: number;
  war: number;
}

export interface BatterTop10Comparison {
  projectedWar: number;
  actualWar: number;
  projectedWoba: number;
  actualWoba: number;
  projectedPa: number;
  actualPa: number;
  playerName: string;
  error: number; // actual - projected
}

export interface BatterYearAnalysisResult {
  year: number;
  metrics: BatterStatMetrics;
  metricsByTeam: Map<string, BatterStatMetrics>;
  metricsByAge: Map<string, BatterStatMetrics>;
  metricsByPosition: Map<string, BatterStatMetrics>; // C, IF, OF, DH
  metricsByQuartile: Map<string, BatterStatMetrics>; // Quartile by actual wOBA
  top10Comparison: BatterTop10Comparison[];
  details: {
    playerId: number;
    name: string;
    teamName: string;
    age: number;
    position: string;
    trueRating: number;
    percentile: number;
    projected: { woba: number; bbPct: number; kPct: number; hrPct: number; avg: number; war: number; pa: number };
    actual: { woba: number; bbPct: number; kPct: number; hrPct: number; avg: number; war: number };
    diff: BatterStatDiffs;
    pa: number;
  }[];
}

export interface BatterAggregateAnalysisReport {
  years: BatterYearAnalysisResult[];
  overallMetrics: BatterStatMetrics;
  metricsByTeam: Map<string, BatterStatMetrics>;
  metricsByAge: Map<string, BatterStatMetrics>;
  metricsByPosition: Map<string, BatterStatMetrics>;
  metricsByQuartile: Map<string, BatterStatMetrics>;
  top10Comparison: BatterTop10Comparison[];
}

const POSITION_GROUPS: Record<number, string> = {
  2: 'C',    // Catcher
  3: '1B',   // First Base (infield)
  4: 'IF',   // Second Base
  5: 'IF',   // Third Base
  6: 'IF',   // Shortstop
  7: 'OF',   // Left Field
  8: 'OF',   // Center Field
  9: 'OF',   // Right Field
  10: 'DH',  // Designated Hitter
};

class BatterProjectionAnalysisService {

  async runAnalysis(
    startYear: number,
    endYear: number,
    progressCallback?: (year: number) => void,
    minPa: number = 100,
    maxPa: number = 999
  ): Promise<BatterAggregateAnalysisReport> {
    const results: BatterYearAnalysisResult[] = [];
    const allTeams = await teamService.getAllTeams();
    const teamLookup = new Map(allTeams.map(t => [t.id, t]));

    for (let year = startYear; year <= endYear; year++) {
      if (progressCallback) progressCallback(year);
      try {
        const result = await this.analyzeYear(year, teamLookup, minPa, maxPa);
        if (result) {
          results.push(result);
        }
      } catch (e) {
        console.warn(`Batter analysis failed for ${year}`, e);
      }
    }

    return this.aggregateResults(results);
  }

  private async analyzeYear(
    year: number,
    teamLookup: Map<number, any>,
    minPa: number = 100,
    maxPa: number = 999
  ): Promise<BatterYearAnalysisResult | null> {
    // 1. Get Projections from prior year
    const statsBaseYear = year - 1;
    const context = await batterProjectionService.getProjectionsWithContext(statsBaseYear);

    // 2. Get Actuals from target year
    const actuals = await trueRatingsService.getTrueBattingStats(year);
    if (!actuals || actuals.length === 0) return null;

    const leagueAvg = await leagueBattingAveragesService.getLeagueAverages(year);
    const actualsMap = new Map(actuals.map(a => [a.player_id, a]));

    // 3. Match and Calculate Details
    const details: BatterYearAnalysisResult['details'] = [];

    for (const proj of context.projections) {
      const act = actualsMap.get(proj.playerId);
      if (!act) continue;

      const actualPa = act.pa;
      if (actualPa < minPa || actualPa > maxPa) continue;

      // Calculate actual rate stats
      const actualBbPct = (act.bb / actualPa) * 100;
      const actualKPct = (act.k / actualPa) * 100;
      const actualHrPct = (act.hr / actualPa) * 100;
      const actualAvg = act.avg;

      // Calculate actual wOBA
      let actualWoba = 0.320; // Default
      if (leagueAvg) {
        // Simplified wOBA calculation from counting stats
        const bbWeight = 0.69;
        const singleWeight = 0.89;
        const doubleWeight = 1.27;
        const tripleWeight = 1.62;
        const hrWeight = 2.10;

        const singles = act.h - act.d - act.t - act.hr;
        actualWoba = (
          bbWeight * act.bb +
          singleWeight * singles +
          doubleWeight * act.d +
          tripleWeight * act.t +
          hrWeight * act.hr
        ) / actualPa;
      }

      // Get projected stats
      const projWoba = proj.projectedStats.woba;
      const projBbPct = proj.projectedStats.bbPct ?? 8.5;
      const projKPct = proj.projectedStats.kPct ?? 22;
      const projHrPct = (proj.projectedStats.hr / proj.projectedStats.pa) * 100;
      const projAvg = proj.projectedStats.avg;
      const projWar = proj.projectedStats.war;
      const actualWar = act.war;

      // Resolve team name (use actual team)
      let teamName = 'Unknown';
      const actualTeamId = act.team_id ?? proj.teamId;
      const team = teamLookup.get(actualTeamId);
      if (team && team.parentTeamId !== 0) {
        const parent = teamLookup.get(team.parentTeamId);
        if (parent) teamName = parent.nickname;
      } else if (team) {
        teamName = team.nickname;
      }

      // Determine position group
      const posGroup = POSITION_GROUPS[proj.position] || 'UT';

      details.push({
        playerId: proj.playerId,
        name: proj.name,
        teamName,
        age: proj.age,
        position: posGroup,
        trueRating: proj.currentTrueRating,
        percentile: proj.percentile || 0,
        projected: {
          woba: projWoba,
          bbPct: projBbPct,
          kPct: projKPct,
          hrPct: projHrPct,
          avg: projAvg,
          war: projWar,
          pa: proj.projectedStats.pa,
        },
        actual: {
          woba: actualWoba,
          bbPct: actualBbPct,
          kPct: actualKPct,
          hrPct: actualHrPct,
          avg: actualAvg,
          war: actualWar,
        },
        diff: {
          woba: actualWoba - projWoba,
          bbPct: actualBbPct - projBbPct,
          kPct: actualKPct - projKPct,
          hrPct: actualHrPct - projHrPct,
          avg: actualAvg - projAvg,
          war: actualWar - projWar,
        },
        pa: actualPa,
      });
    }

    if (details.length === 0) return null;

    // 4. Group and Calculate Metrics
    const metrics = this.calculateStatMetrics(details.map(d => d.diff));

    // Group by Team
    const teamGroups = new Map<string, BatterStatDiffs[]>();
    details.forEach(d => {
      const list = teamGroups.get(d.teamName) ?? [];
      list.push(d.diff);
      teamGroups.set(d.teamName, list);
    });
    const metricsByTeam = new Map<string, BatterStatMetrics>();
    teamGroups.forEach((diffs, key) => metricsByTeam.set(key, this.calculateStatMetrics(diffs)));

    // Group by Age
    const ageGroups = new Map<string, BatterStatDiffs[]>();
    details.forEach(d => {
      const bucket = this.getAgeBucket(d.age);
      const list = ageGroups.get(bucket) ?? [];
      list.push(d.diff);
      ageGroups.set(bucket, list);
    });
    const metricsByAge = new Map<string, BatterStatMetrics>();
    ageGroups.forEach((diffs, key) => metricsByAge.set(key, this.calculateStatMetrics(diffs)));

    // Group by Position
    const posGroups = new Map<string, BatterStatDiffs[]>();
    details.forEach(d => {
      const list = posGroups.get(d.position) ?? [];
      list.push(d.diff);
      posGroups.set(d.position, list);
    });
    const metricsByPosition = new Map<string, BatterStatMetrics>();
    posGroups.forEach((diffs, key) => metricsByPosition.set(key, this.calculateStatMetrics(diffs)));

    // Group by Performance Quartile (based on actual wOBA)
    const sortedByActualWoba = [...details].sort((a, b) => b.actual.woba - a.actual.woba);
    const quartileSize = Math.floor(sortedByActualWoba.length / 4);
    const quartileRanges = [
      { label: 'Q1 (Elite)', start: 0, end: quartileSize },
      { label: 'Q2 (Good)', start: quartileSize, end: quartileSize * 2 },
      { label: 'Q3 (Average)', start: quartileSize * 2, end: quartileSize * 3 },
      { label: 'Q4 (Below Avg)', start: quartileSize * 3, end: sortedByActualWoba.length },
    ];

    const quartileGroups = new Map<string, BatterStatDiffs[]>();
    quartileRanges.forEach(q => {
      const detailsInRange = sortedByActualWoba.slice(q.start, q.end);
      const maxWoba = detailsInRange[0]?.actual.woba ?? 0;
      const minWoba = detailsInRange[detailsInRange.length - 1]?.actual.woba ?? 0;
      const label = `${q.label} (wOBA: ${minWoba.toFixed(3)}-${maxWoba.toFixed(3)})`;
      quartileGroups.set(label, detailsInRange.map(d => d.diff));
    });
    const metricsByQuartile = new Map<string, BatterStatMetrics>();
    quartileGroups.forEach((diffs, key) => metricsByQuartile.set(key, this.calculateStatMetrics(diffs)));

    // Top 10 Comparison: Find actual top 10 WAR leaders
    const top10Actual = [...details]
      .sort((a, b) => b.actual.war - a.actual.war)
      .slice(0, 10);

    const top10Comparison: BatterTop10Comparison[] = top10Actual.map(d => ({
      playerName: d.name,
      projectedWar: d.projected.war,
      actualWar: d.actual.war,
      projectedWoba: d.projected.woba,
      actualWoba: d.actual.woba,
      projectedPa: d.projected.pa,
      actualPa: d.pa,
      error: d.actual.war - d.projected.war,
    }));

    return {
      year,
      metrics,
      metricsByTeam,
      metricsByAge,
      metricsByPosition,
      metricsByQuartile,
      top10Comparison,
      details,
    };
  }

  private aggregateResults(years: BatterYearAnalysisResult[]): BatterAggregateAnalysisReport {
    const allDetails = years.flatMap(y => y.details);
    const overallMetrics = this.calculateStatMetrics(allDetails.map(d => d.diff));

    // Aggregate by Team
    const teamGroups = new Map<string, BatterStatDiffs[]>();
    allDetails.forEach(d => {
      const list = teamGroups.get(d.teamName) ?? [];
      list.push(d.diff);
      teamGroups.set(d.teamName, list);
    });
    const metricsByTeam = new Map<string, BatterStatMetrics>();
    teamGroups.forEach((diffs, key) => metricsByTeam.set(key, this.calculateStatMetrics(diffs)));

    // Aggregate by Age
    const ageGroups = new Map<string, BatterStatDiffs[]>();
    allDetails.forEach(d => {
      const bucket = this.getAgeBucket(d.age);
      const list = ageGroups.get(bucket) ?? [];
      list.push(d.diff);
      ageGroups.set(bucket, list);
    });
    const metricsByAge = new Map<string, BatterStatMetrics>();
    ageGroups.forEach((diffs, key) => metricsByAge.set(key, this.calculateStatMetrics(diffs)));

    // Aggregate by Position
    const posGroups = new Map<string, BatterStatDiffs[]>();
    allDetails.forEach(d => {
      const list = posGroups.get(d.position) ?? [];
      list.push(d.diff);
      posGroups.set(d.position, list);
    });
    const metricsByPosition = new Map<string, BatterStatMetrics>();
    posGroups.forEach((diffs, key) => metricsByPosition.set(key, this.calculateStatMetrics(diffs)));

    // Aggregate by Performance Quartile (based on actual wOBA)
    const sortedByActualWoba = [...allDetails].sort((a, b) => b.actual.woba - a.actual.woba);
    const quartileSize = Math.floor(sortedByActualWoba.length / 4);
    const quartileRanges = [
      { label: 'Q1 (Elite)', start: 0, end: quartileSize },
      { label: 'Q2 (Good)', start: quartileSize, end: quartileSize * 2 },
      { label: 'Q3 (Average)', start: quartileSize * 2, end: quartileSize * 3 },
      { label: 'Q4 (Below Avg)', start: quartileSize * 3, end: sortedByActualWoba.length },
    ];

    const aggregateQuartileGroups = new Map<string, BatterStatDiffs[]>();
    quartileRanges.forEach(q => {
      const detailsInRange = sortedByActualWoba.slice(q.start, q.end);
      const maxWoba = detailsInRange[0]?.actual.woba ?? 0;
      const minWoba = detailsInRange[detailsInRange.length - 1]?.actual.woba ?? 0;
      const label = `${q.label} (wOBA: ${minWoba.toFixed(3)}-${maxWoba.toFixed(3)})`;
      aggregateQuartileGroups.set(label, detailsInRange.map(d => d.diff));
    });
    const metricsByQuartile = new Map<string, BatterStatMetrics>();
    aggregateQuartileGroups.forEach((diffs, key) => metricsByQuartile.set(key, this.calculateStatMetrics(diffs)));

    // Aggregate top 10 comparison
    const top10Comparison: BatterTop10Comparison[] = years.flatMap(y => y.top10Comparison);

    return {
      years,
      overallMetrics,
      metricsByTeam,
      metricsByAge,
      metricsByPosition,
      metricsByQuartile,
      top10Comparison,
    };
  }

  private calculateStatMetrics(diffs: BatterStatDiffs[]): BatterStatMetrics {
    return {
      woba: this.calculateMetrics(diffs.map(d => d.woba)),
      bbPct: this.calculateMetrics(diffs.map(d => d.bbPct)),
      kPct: this.calculateMetrics(diffs.map(d => d.kPct)),
      hrPct: this.calculateMetrics(diffs.map(d => d.hrPct)),
      avg: this.calculateMetrics(diffs.map(d => d.avg)),
      war: this.calculateMetrics(diffs.map(d => d.war)),
    };
  }

  private calculateMetrics(values: number[]): BatterAccuracyMetrics {
    const count = values.length;
    if (count === 0) return { mae: 0, rmse: 0, count: 0, bias: 0 };

    const sumAbs = values.reduce((sum, v) => sum + Math.abs(v), 0);
    const sumSq = values.reduce((sum, v) => sum + (v * v), 0);
    const sumVal = values.reduce((sum, v) => sum + v, 0);

    return {
      mae: sumAbs / count,
      rmse: Math.sqrt(sumSq / count),
      count,
      bias: sumVal / count,
    };
  }

  private getAgeBucket(age: number): string {
    if (age <= 23) return '< 24';
    if (age <= 26) return '24-26'; // Pre-peak
    if (age <= 29) return '27-29'; // Peak
    if (age <= 33) return '30-33'; // Early decline
    return '34+';
  }

  /**
   * Format a summary report as text (for logging/debugging)
   */
  formatReport(report: BatterAggregateAnalysisReport): string {
    const lines: string[] = [];

    lines.push('='.repeat(80));
    lines.push('BATTER PROJECTION ANALYSIS REPORT');
    lines.push('='.repeat(80));

    // Overall metrics
    lines.push('\n--- OVERALL METRICS ---\n');
    lines.push('Metric\t\tMAE\tRMSE\tBias\tCount');
    lines.push('-'.repeat(60));

    const m = report.overallMetrics;
    lines.push(`wOBA\t\t${m.woba.mae.toFixed(3)}\t${m.woba.rmse.toFixed(3)}\t${this.formatBias(m.woba.bias)}\t${m.woba.count}`);
    lines.push(`BB%\t\t${m.bbPct.mae.toFixed(2)}\t${m.bbPct.rmse.toFixed(2)}\t${this.formatBias(m.bbPct.bias)}\t${m.bbPct.count}`);
    lines.push(`K%\t\t${m.kPct.mae.toFixed(2)}\t${m.kPct.rmse.toFixed(2)}\t${this.formatBias(m.kPct.bias)}\t${m.kPct.count}`);
    lines.push(`HR%\t\t${m.hrPct.mae.toFixed(2)}\t${m.hrPct.rmse.toFixed(2)}\t${this.formatBias(m.hrPct.bias)}\t${m.hrPct.count}`);
    lines.push(`AVG\t\t${m.avg.mae.toFixed(3)}\t${m.avg.rmse.toFixed(3)}\t${this.formatBias(m.avg.bias, 3)}\t${m.avg.count}`);
    lines.push(`WAR\t\t${m.war.mae.toFixed(2)}\t${m.war.rmse.toFixed(2)}\t${this.formatBias(m.war.bias)}\t${m.war.count}`);

    // By Position
    lines.push('\n--- BY POSITION (wOBA) ---\n');
    lines.push('Position\tMAE\tRMSE\tBias\tCount');
    lines.push('-'.repeat(60));
    report.metricsByPosition.forEach((metrics, pos) => {
      lines.push(`${pos}\t\t${metrics.woba.mae.toFixed(3)}\t${metrics.woba.rmse.toFixed(3)}\t${this.formatBias(metrics.woba.bias)}\t${metrics.woba.count}`);
    });

    // By Age
    lines.push('\n--- BY AGE (wOBA) ---\n');
    lines.push('Age\t\tMAE\tRMSE\tBias\tCount');
    lines.push('-'.repeat(60));
    const ageOrder = ['< 24', '24-26', '27-29', '30-33', '34+'];
    ageOrder.forEach(bucket => {
      const metrics = report.metricsByAge.get(bucket);
      if (metrics) {
        lines.push(`${bucket}\t\t${metrics.woba.mae.toFixed(3)}\t${metrics.woba.rmse.toFixed(3)}\t${this.formatBias(metrics.woba.bias)}\t${metrics.woba.count}`);
      }
    });

    // By Quartile
    lines.push('\n--- BY PERFORMANCE QUARTILE (wOBA) ---\n');
    lines.push('Quartile\t\t\tMAE\tRMSE\tBias\tCount');
    lines.push('-'.repeat(80));
    report.metricsByQuartile.forEach((metrics, label) => {
      lines.push(`${label}\t${metrics.woba.mae.toFixed(3)}\t${metrics.woba.rmse.toFixed(3)}\t${this.formatBias(metrics.woba.bias)}\t${metrics.woba.count}`);
    });

    // Top 10 summary
    if (report.top10Comparison.length > 0) {
      lines.push('\n--- TOP 10 WAR LEADERS (Aggregated) ---\n');
      const top10Errors = report.top10Comparison.map(t => t.error);
      const avgError = top10Errors.reduce((a, b) => a + b, 0) / top10Errors.length;
      const mae = top10Errors.reduce((a, b) => a + Math.abs(b), 0) / top10Errors.length;
      lines.push(`Avg Projected WAR: ${(report.top10Comparison.reduce((a, b) => a + b.projectedWar, 0) / report.top10Comparison.length).toFixed(2)}`);
      lines.push(`Avg Actual WAR:    ${(report.top10Comparison.reduce((a, b) => a + b.actualWar, 0) / report.top10Comparison.length).toFixed(2)}`);
      lines.push(`Mean Error:        ${this.formatBias(avgError)}`);
      lines.push(`MAE:               ${mae.toFixed(2)}`);
    }

    lines.push('\n' + '='.repeat(80));
    return lines.join('\n');
  }

  private formatBias(bias: number, decimals: number = 2): string {
    const formatted = bias.toFixed(decimals);
    return bias > 0 ? `+${formatted}` : formatted;
  }
}

export const batterProjectionAnalysisService = new BatterProjectionAnalysisService();
