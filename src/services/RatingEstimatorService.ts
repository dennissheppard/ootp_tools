import { fipWarService, LeagueConstants } from './FipWarService';

interface StatInput {
    ip: number;
    k9: number;
    bb9: number;
    hr9: number;
}

interface RatingEstimate {
    rating: number;
    low: number;      // lower bound of confidence interval
    high: number;     // upper bound
    confidence: 'high' | 'moderate' | 'low';
}

interface EstimatedRatings {
    stuff: RatingEstimate;
    control: RatingEstimate;
    hra: RatingEstimate;
    movement?: RatingEstimate;  // null if not estimable
    babip?: RatingEstimate;
    fip?: number;
    war?: number;
}

class RatingEstimatorService {

    private static capRating(rating: number): number {
        return Math.max(20, Math.min(80, rating));
    }

    private static getConfidence(ip: number, stabilizationIp: number): { confidence: 'high' | 'moderate' | 'low', multiplier: number } {
        if (ip >= stabilizationIp) {
            return { confidence: 'high', multiplier: 1 };
        } else if (ip >= stabilizationIp / 2) {
            return { confidence: 'moderate', multiplier: 1.5 };
        } else {
            return { confidence: 'low', multiplier: 2 };
        }
    }

    static estimateControl(bb9: number, ip: number): RatingEstimate {
        // Exact inverse of forward: BB/9 = 5.30 - 0.052 × Control
        const rawRating = (5.30 - bb9) / 0.052;
        const rating = this.capRating(Math.round(rawRating));
        const { confidence, multiplier } = this.getConfidence(ip, 200);
        const uncertainty = 5 * multiplier;
        return {
            rating: rating,
            low: this.capRating(Math.round(rawRating - uncertainty)),
            high: this.capRating(Math.round(rawRating + uncertainty)),
            confidence: confidence
        };
    }

    static estimateStuff(k9: number, ip: number): RatingEstimate {
        // Exact inverse of forward: K/9 = 2.10 + 0.074 × Stuff
        const rawRating = (k9 - 2.10) / 0.074;
        const rating = this.capRating(Math.round(rawRating));
        const { confidence, multiplier } = this.getConfidence(ip, 150);
        const uncertainty = 8 * multiplier;
        return {
            rating: rating,
            low: this.capRating(Math.round(rawRating - uncertainty)),
            high: this.capRating(Math.round(rawRating + uncertainty)),
            confidence: confidence
        };
    }

    static estimateHRA(hr9: number, ip: number): RatingEstimate {
        // Exact inverse of forward: HR/9 = 2.18 - 0.024 × HRA
        const rawRating = (2.18 - hr9) / 0.024;
        const rating = this.capRating(Math.round(rawRating));
        const { confidence, multiplier } = this.getConfidence(ip, 300);
        const uncertainty = 11 * multiplier;
        return {
            rating: rating,
            low: this.capRating(Math.round(rawRating - uncertainty)),
            high: this.capRating(Math.round(rawRating + uncertainty)),
            confidence: confidence
        };
    }

    static estimateAll(stats: StatInput, leagueConstants: Partial<LeagueConstants> = {}): EstimatedRatings {
        // Use shared FIP/WAR service for consistent calculations
        const { fip, war } = fipWarService.calculate(stats, leagueConstants);
        return {
            control: this.estimateControl(stats.bb9, stats.ip),
            stuff: this.estimateStuff(stats.k9, stats.ip),
            hra: this.estimateHRA(stats.hr9, stats.ip),
            fip,
            war,
        }
    }

    static compareToScout(estimated: RatingEstimate, scoutRating: number): string {
        if (scoutRating >= estimated.low && scoutRating <= estimated.high) {
            return "✓ Accurate";
        } else if (scoutRating < estimated.low) {
            return "Scout LOW ⚠️";
        } else {
            return "Scout HIGH ⚠️";
        }
    }
}

export { RatingEstimatorService };
export type { StatInput, EstimatedRatings, RatingEstimate };
