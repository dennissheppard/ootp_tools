import { RatingEstimatorService } from './RatingEstimatorService';

describe('RatingEstimatorService', () => {
    describe('estimateControl', () => {
        it('should have high confidence for high IP', () => {
            // Inverse of BB/9 = 5.30 - 0.052 × Control
            // rating = (5.30 - 2.5) / 0.052 = 53.85
            const { confidence, rating, low, high } = RatingEstimatorService.estimateControl(2.5, 200);
            expect(confidence).toBe('high');
            expect(rating).toBe(54);
            expect(low).toBe(49);
            expect(high).toBe(59);
        });

        it('should have moderate confidence for medium IP', () => {
            const { confidence, rating, low, high } = RatingEstimatorService.estimateControl(2.5, 150);
            expect(confidence).toBe('moderate');
            expect(rating).toBe(54);
            expect(low).toBe(46);
            expect(high).toBe(61);
        });

        it('should have low confidence for low IP', () => {
            const { confidence, rating, low, high } = RatingEstimatorService.estimateControl(2.5, 50);
            expect(confidence).toBe('low');
            expect(rating).toBe(54);
            expect(low).toBe(44);
            expect(high).toBe(64);
        });

        it('should handle low BB/9', () => {
            // (5.30 - 1.5) / 0.052 = 73.08
            const { rating } = RatingEstimatorService.estimateControl(1.5, 200);
            expect(rating).toBe(73);
        });

        it('should handle high BB/9', () => {
            // (5.30 - 3.5) / 0.052 = 34.62
            const { rating } = RatingEstimatorService.estimateControl(3.5, 200);
            expect(rating).toBe(35);
        });

        it('should cap control rating at 80 for impossibly low BB/9', () => {
            // (5.30 - 0.5) / 0.052 = 92.31 → capped to 80
            const { rating } = RatingEstimatorService.estimateControl(0.5, 200);
            expect(rating).toBe(80);
        });

        it('should cap control rating at 20 for impossibly high BB/9', () => {
            // (5.30 - 5.0) / 0.052 = 5.77 → capped to 20
            const { rating } = RatingEstimatorService.estimateControl(5.0, 200);
            expect(rating).toBe(20);
        });
    });

    describe('estimateStuff', () => {
        it('should estimate stuff rating correctly for a typical K/9', () => {
            // (7.0 - 2.10) / 0.074 = 66.22
            const { rating } = RatingEstimatorService.estimateStuff(7.0, 200);
            expect(rating).toBe(66);
        });

        it('should handle low K/9', () => {
            // (5.0 - 2.10) / 0.074 = 39.19
            const { rating } = RatingEstimatorService.estimateStuff(5.0, 200);
            expect(rating).toBe(39);
        });

        it('should handle high K/9', () => {
            // (8.0 - 2.10) / 0.074 = 79.73
            const { rating } = RatingEstimatorService.estimateStuff(8.0, 200);
            expect(rating).toBe(80);
        });
    });

    describe('estimateHRA', () => {
        it('should estimate HRA rating correctly for a typical HR/9', () => {
            // (2.18 - 0.85) / 0.024 = 55.42
            const { rating } = RatingEstimatorService.estimateHRA(0.85, 200);
            expect(rating).toBe(55);
        });

        it('should handle low HR/9', () => {
            // (2.18 - 0.5) / 0.024 = 70.0
            const { rating } = RatingEstimatorService.estimateHRA(0.5, 200);
            expect(rating).toBe(70);
        });

        it('should handle high HR/9', () => {
            // (2.18 - 1.2) / 0.024 = 40.83
            const { rating } = RatingEstimatorService.estimateHRA(1.2, 200);
            expect(rating).toBe(41);
        });
    });

    describe('round-trip consistency', () => {
        it('should round-trip Stuff correctly (rating → stat → rating)', () => {
            // Forward: K/9 = 2.10 + 0.074 × 50 = 5.80
            // Inverse: (5.80 - 2.10) / 0.074 = 50.0
            const { rating } = RatingEstimatorService.estimateStuff(5.80, 200);
            expect(rating).toBe(50);
        });

        it('should round-trip Control correctly (rating → stat → rating)', () => {
            // Forward: BB/9 = 5.30 - 0.052 × 50 = 2.70
            // Inverse: (5.30 - 2.70) / 0.052 = 50.0
            const { rating } = RatingEstimatorService.estimateControl(2.70, 200);
            expect(rating).toBe(50);
        });

        it('should round-trip HRA correctly (rating → stat → rating)', () => {
            // Forward: HR/9 = 2.18 - 0.024 × 50 = 0.98
            // Inverse: (2.18 - 0.98) / 0.024 = 50.0
            const { rating } = RatingEstimatorService.estimateHRA(0.98, 200);
            expect(rating).toBe(50);
        });
    });

    describe('compareToScout', () => {
        const estimated = { rating: 60, low: 55, high: 65, confidence: 'high' as const };

        it('should return "✓ Accurate" if scout rating is within confidence band', () => {
            expect(RatingEstimatorService.compareToScout(estimated, 58)).toBe('✓ Accurate');
            expect(RatingEstimatorService.compareToScout(estimated, 55)).toBe('✓ Accurate');
            expect(RatingEstimatorService.compareToScout(estimated, 65)).toBe('✓ Accurate');
        });

        it('should return "Scout LOW ⚠️" if scout rating is below confidence band', () => {
            expect(RatingEstimatorService.compareToScout(estimated, 54)).toBe('Scout LOW ⚠️');
            expect(RatingEstimatorService.compareToScout(estimated, 40)).toBe('Scout LOW ⚠️');
        });

        it('should return "Scout HIGH ⚠️" if scout rating is above confidence band', () => {
            expect(RatingEstimatorService.compareToScout(estimated, 66)).toBe('Scout HIGH ⚠️');
            expect(RatingEstimatorService.compareToScout(estimated, 80)).toBe('Scout HIGH ⚠️');
        });
    });
});
