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

    private static roundToNearestFive(num: number): number {
        return Math.round(num / 5) * 5;
    }

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
        const rawRating = 100.4 - 19.2 * bb9;
        const rating = this.roundToNearestFive(this.capRating(Math.round(rawRating)));
        const { confidence, multiplier } = this.getConfidence(ip, 200);
        const uncertainty = 5 * multiplier;
        return {
            rating: rating,
            low: this.roundToNearestFive(this.capRating(Math.round(rawRating - uncertainty))),
            high: this.roundToNearestFive(this.capRating(Math.round(rawRating + uncertainty))),
            confidence: confidence
        };
    }

    static estimateStuff(k9: number, ip: number): RatingEstimate {
        const rawRating = -28.0 + 13.5 * k9;
        const rating = this.roundToNearestFive(this.capRating(Math.round(rawRating)));
        const { confidence, multiplier } = this.getConfidence(ip, 150);
        const uncertainty = 8 * multiplier;
        return {
            rating: rating,
            low: this.roundToNearestFive(this.capRating(Math.round(rawRating - uncertainty))),
            high: this.roundToNearestFive(this.capRating(Math.round(rawRating + uncertainty))),
            confidence: confidence
        };
    }

    static estimateHRA(hr9: number, ip: number): RatingEstimate {
        const rawRating = 86.7 - 41.7 * hr9;
        const rating = this.roundToNearestFive(this.capRating(Math.round(rawRating)));
        const { confidence, multiplier } = this.getConfidence(ip, 300);
        const uncertainty = 11 * multiplier;
        return {
            rating: rating,
            low: this.roundToNearestFive(this.capRating(Math.round(rawRating - uncertainty))),
            high: this.roundToNearestFive(this.capRating(Math.round(rawRating + uncertainty))),
            confidence: confidence
        };
    }

    static estimateFipAndWar(stats: StatInput, lgEra: number, fipConstant: number): { fip: number, war: number } {
        const fip = (13 * stats.hr9 + 3 * stats.bb9 - 2 * stats.k9) / 9 + fipConstant;
        const war = ((lgEra - fip) / 10) * (stats.ip / 9);
        return { fip, war };
    }

    static estimateAll(stats: StatInput, lgEra: number, fipConstant: number = 3.10): EstimatedRatings {
        const { fip, war } = this.estimateFipAndWar(stats, lgEra, fipConstant);
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
