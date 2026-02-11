/**
 * DraftValueService — hardcoded draft research data from roadmap/team-planning.md.
 * Pure data service, no API calls. Provides pick value curves, round-level stats,
 * development timelines, position-specific outcomes, and gap-to-recommendation logic.
 */

export interface PickGroupValue {
  label: string;
  avgWar: number;
  mlbPct: number;
  warGte5Pct: number;
  warGte15Pct: number;
}

export interface RoundValue {
  round: number;
  label: string;
  avgWar: number;
  mlbPct: number;
  warGte5Pct: number;
  warGte15Pct: number;
}

export interface DevelopmentTimeline {
  round: number;
  avgYears: number;
  medianYears: number;
  arriveIn2yr: number;
  arriveIn3yr: number;
  arriveIn4yr: number;
  arriveIn5yr: number;
}

export interface PositionOutcome {
  position: string;
  n: number;
  mlbPct: number;
  avgWar: number;
  warGte5Pct: number;
  avgYrsToMlb: number;
}

export interface SlotTier {
  tier: number;
  label: string;
  pickRange: string;
  pickMin: number;
  pickMax: number;
  avgWar: number;
  mlbPct: number;
}

export interface RosterGap {
  position: string;
  section: 'lineup' | 'rotation' | 'bullpen';
  gapStartYear: number;
  emptyYears: number;
  hasProspectCoverage: boolean;
}

export interface DraftRecommendation {
  position: string;
  gapStartYear: number;
  emptyYears: number;
  draftPosition: string; // mapped grid position → draft position (SP1 → SP, CL → RP)
  positionData: PositionOutcome | null;
  timeline: DevelopmentTimeline | null;
  roundSuggestion: string;
  insight: string;
  arrivalEstimate: string;
}

// --- Hardcoded research data (from roadmap/team-planning.md) ---

const PICK_GROUP_VALUES: PickGroupValue[] = [
  { label: '#1-5',   avgWar: 11.6, mlbPct: 76, warGte5Pct: 53, warGte15Pct: 27 },
  { label: '#6-10',  avgWar: 7.4,  mlbPct: 66, warGte5Pct: 39, warGte15Pct: 20 },
  { label: '#11-15', avgWar: 7.9,  mlbPct: 57, warGte5Pct: 27, warGte15Pct: 16 },
  { label: '#16-20', avgWar: 4.3,  mlbPct: 55, warGte5Pct: 20, warGte15Pct: 11 },
  { label: '#21-30', avgWar: 1.9,  mlbPct: 29, warGte5Pct: 12, warGte15Pct: 6 },
  { label: '#31-55', avgWar: 2.9,  mlbPct: 47, warGte5Pct: 19, warGte15Pct: 7 },
  { label: '#56-100', avgWar: 1.1, mlbPct: 25, warGte5Pct: 8,  warGte15Pct: 2 },
  { label: '#101+',  avgWar: 0.2,  mlbPct: 11, warGte5Pct: 2,  warGte15Pct: 0 },
];

const ROUND_VALUES: RoundValue[] = [
  { round: 1, label: 'Round 1', avgWar: 7.0, mlbPct: 84, warGte5Pct: 31, warGte15Pct: 16 },
  { round: 2, label: 'Round 2', avgWar: 3.1, mlbPct: 67, warGte5Pct: 19, warGte15Pct: 8 },
  { round: 3, label: 'Round 3', avgWar: 2.0, mlbPct: 60, warGte5Pct: 12, warGte15Pct: 3 },
  { round: 4, label: 'Round 4', avgWar: 1.6, mlbPct: 42, warGte5Pct: 10, warGte15Pct: 4 },
  { round: 5, label: 'Round 5', avgWar: 0.8, mlbPct: 41, warGte5Pct: 5,  warGte15Pct: 2 },
  { round: 6, label: 'Round 6', avgWar: 0.7, mlbPct: 41, warGte5Pct: 6,  warGte15Pct: 2 },
  { round: 7, label: 'Round 7+', avgWar: 0.1, mlbPct: 20, warGte5Pct: 1,  warGte15Pct: 0 },
];

const TIMELINES: DevelopmentTimeline[] = [
  { round: 1, avgYears: 3.0, medianYears: 3, arriveIn2yr: 35, arriveIn3yr: 60, arriveIn4yr: 83, arriveIn5yr: 98 },
  { round: 2, avgYears: 3.4, medianYears: 3, arriveIn2yr: 24, arriveIn3yr: 56, arriveIn4yr: 74, arriveIn5yr: 91 },
  { round: 3, avgYears: 3.4, medianYears: 3, arriveIn2yr: 31, arriveIn3yr: 58, arriveIn4yr: 74, arriveIn5yr: 92 },
  { round: 4, avgYears: 3.6, medianYears: 4, arriveIn2yr: 35, arriveIn3yr: 44, arriveIn4yr: 59, arriveIn5yr: 87 },
  { round: 5, avgYears: 4.1, medianYears: 4, arriveIn2yr: 13, arriveIn3yr: 35, arriveIn4yr: 56, arriveIn5yr: 87 },
  { round: 6, avgYears: 4.3, medianYears: 5, arriveIn2yr: 22, arriveIn3yr: 24, arriveIn4yr: 50, arriveIn5yr: 82 },
];

const POSITION_OUTCOMES: PositionOutcome[] = [
  { position: 'SP', n: 397, mlbPct: 46, avgWar: 1.9, warGte5Pct: 10, avgYrsToMlb: 3.9 },
  { position: 'RP', n: 315, mlbPct: 37, avgWar: 0.7, warGte5Pct: 5,  avgYrsToMlb: 3.4 },
  { position: 'CF', n: 115, mlbPct: 50, avgWar: 2.3, warGte5Pct: 9,  avgYrsToMlb: 4.1 },
  { position: '2B', n: 107, mlbPct: 34, avgWar: 2.8, warGte5Pct: 13, avgYrsToMlb: 3.3 },
  { position: 'SS', n: 101, mlbPct: 39, avgWar: 1.1, warGte5Pct: 10, avgYrsToMlb: 3.6 },
  { position: 'LF', n: 92,  mlbPct: 32, avgWar: 1.4, warGte5Pct: 8,  avgYrsToMlb: 4.3 },
  { position: '1B', n: 85,  mlbPct: 38, avgWar: 2.2, warGte5Pct: 7,  avgYrsToMlb: 3.5 },
  { position: 'RF', n: 84,  mlbPct: 44, avgWar: 1.2, warGte5Pct: 7,  avgYrsToMlb: 3.9 },
  { position: '3B', n: 80,  mlbPct: 34, avgWar: 1.3, warGte5Pct: 8,  avgYrsToMlb: 3.7 },
  { position: 'C',  n: 127, mlbPct: 25, avgWar: 0.7, warGte5Pct: 5,  avgYrsToMlb: 3.9 },
];

const SLOT_TIERS: SlotTier[] = [
  { tier: 1, label: 'Franchise-Altering', pickRange: '1-8',    pickMin: 1,   pickMax: 8,   avgWar: 11, mlbPct: 75 },
  { tier: 2, label: 'Solid Starter',      pickRange: '9-20',   pickMin: 9,   pickMax: 20,  avgWar: 5,  mlbPct: 50 },
  { tier: 3, label: 'Lottery Ticket',      pickRange: '21-55',  pickMin: 21,  pickMax: 55,  avgWar: 2.5, mlbPct: 35 },
  { tier: 4, label: 'Long Shot',           pickRange: '56-100', pickMin: 56,  pickMax: 100, avgWar: 1,  mlbPct: 25 },
  { tier: 5, label: 'Near-Zero EV',        pickRange: '101+',   pickMin: 101, pickMax: 9999, avgWar: 0.2, mlbPct: 11 },
];

const POSITION_ROUND_NOTES: Record<string, string> = {
  'SP': 'SP Rd 1: 7.4 avg WAR, 36% WAR>=5 — the safest high-end pick.',
  'RP': 'RP arrive ~0.5yr faster than batters. Low ceiling but fast development.',
  'C':  'C Rd 1 is risky (40% MLB, 3.0 WAR). C Rd 2 is the sweet spot: 67% MLB, 6.2 WAR, 44% WAR>=5.',
  'CF': 'CF Rd 1: 93% MLB rate but only 3.7 avg WAR — high floor, low ceiling.',
  '2B': '2B Rd 1: best position value (15.6 avg WAR, 50% WAR>=5).',
  '1B': '1B Rd 1: 14.0 avg WAR. Strong value but less positional scarcity.',
  'SS': 'SS Rd 1: 100% MLB rate but only 3.2 WAR. SS Rd 2-3 offers better value (3.6-4.8 WAR).',
  '3B': '3B is mid-range — consider versatile infielders who can play 3B.',
  'LF': 'Corner OF generally has lower draft value. Prioritize power upside.',
  'RF': 'RF Rd 1: 44% MLB rate. Similar to LF — look for power tools.',
};

// Map grid position labels to draft positions
function mapToDraftPosition(gridPosition: string): string | null {
  if (gridPosition.startsWith('SP')) return 'SP';
  if (['CL', 'SU1', 'SU2', 'MR1', 'MR2', 'MR3', 'MR4', 'MR5'].includes(gridPosition)) return 'RP';
  if (gridPosition === 'DH') return null; // not a draft position
  return gridPosition; // C, 1B, 2B, SS, 3B, LF, CF, RF
}

export class DraftValueService {
  getRoundValue(round: number): RoundValue | undefined {
    if (round >= 7) return ROUND_VALUES[6]; // 7+ bucket
    return ROUND_VALUES.find(r => r.round === round);
  }

  getPositionOutcome(position: string): PositionOutcome | undefined {
    return POSITION_OUTCOMES.find(p => p.position === position);
  }

  getDevelopmentTimeline(round: number): DevelopmentTimeline | undefined {
    if (round > 6) return undefined; // no data for 7+
    return TIMELINES.find(t => t.round === round);
  }

  getSlotTier(overallPick: number): SlotTier | undefined {
    return SLOT_TIERS.find(t => overallPick >= t.pickMin && overallPick <= t.pickMax);
  }

  getAllRoundValues(): RoundValue[] { return ROUND_VALUES; }
  getAllPositionOutcomes(): PositionOutcome[] { return POSITION_OUTCOMES; }
  getAllSlotTiers(): SlotTier[] { return SLOT_TIERS; }
  getAllPickGroupValues(): PickGroupValue[] { return PICK_GROUP_VALUES; }

  getPositionNote(position: string): string {
    return POSITION_ROUND_NOTES[position] ?? '';
  }

  /**
   * Analyze roster gaps and produce draft recommendations.
   * Gaps sorted by urgency: soonest gap year first, then most empty years.
   */
  analyzeDraftNeeds(gaps: RosterGap[], currentYear: number): DraftRecommendation[] {
    // Sort by urgency
    const sorted = [...gaps].sort((a, b) => {
      const yearDiff = a.gapStartYear - b.gapStartYear;
      if (yearDiff !== 0) return yearDiff;
      return b.emptyYears - a.emptyYears;
    });

    const recommendations: DraftRecommendation[] = [];

    for (const gap of sorted) {
      const draftPos = mapToDraftPosition(gap.position);
      if (!draftPos) continue; // skip DH

      const posData = this.getPositionOutcome(draftPos);
      const yearsUntilGap = gap.gapStartYear - currentYear;

      // Determine best round suggestion based on urgency
      let roundSuggestion: string;
      let timeline: DevelopmentTimeline | null = null;
      let arrivalEstimate: string;

      if (yearsUntilGap <= 2) {
        roundSuggestion = 'FA or trade — gap too soon for draft development';
        arrivalEstimate = 'Immediate need';
      } else if (yearsUntilGap <= 4) {
        // Rd 1-2 picks can arrive in 3-4 years
        timeline = this.getDevelopmentTimeline(1) ?? null;
        roundSuggestion = `Rd 1-2 pick (median ${timeline?.medianYears ?? 3}yr to MLB)`;
        const arrivalYear = currentYear + (timeline?.medianYears ?? 3);
        arrivalEstimate = `Draft now → arrives ~${arrivalYear}`;
      } else {
        // More time — Rd 2-4 is fine
        timeline = this.getDevelopmentTimeline(3) ?? null;
        roundSuggestion = `Rd 2-4 pick (median ${timeline?.medianYears ?? 3}yr to MLB)`;
        const arrivalYear = currentYear + (timeline?.medianYears ?? 3);
        arrivalEstimate = `Draft now → arrives ~${arrivalYear}`;
      }

      const insight = this.getPositionNote(draftPos)
        || `${draftPos}: ${posData?.mlbPct ?? '?'}% MLB rate, ${posData?.avgWar ?? '?'} avg WAR.`;

      recommendations.push({
        position: gap.position,
        gapStartYear: gap.gapStartYear,
        emptyYears: gap.emptyYears,
        draftPosition: draftPos,
        positionData: posData ?? null,
        timeline,
        roundSuggestion,
        insight,
        arrivalEstimate,
      });
    }

    return recommendations;
  }
}

export const draftValueService = new DraftValueService();
