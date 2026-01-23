import { RatingEstimatorService } from './RatingEstimatorService';

describe('RatingEstimatorService', () => {
    describe('estimateControl', () => {
        it('should have high confidence for high IP', () => {
            const { confidence, low, high } = RatingEstimatorService.estimateControl(2.5, 200);
            expect(confidence).toBe('high');
            expect(low).toBe(47); // 52.4 - 5 = 47.4 -> 47
            expect(high).toBe(57); // 52.4 + 5 = 57.4 -> 57
        });

        it('should have moderate confidence for medium IP', () => {
            const { confidence, low, high } = RatingEstimatorService.estimateControl(2.5, 150);
            expect(confidence).toBe('moderate');
            expect(low).toBe(45); // 52.4 - 7.5 = 44.9 -> 45
            expect(high).toBe(60); // 52.4 + 7.5 = 59.9 -> 60
        });

        it('should have low confidence for low IP', () => {
            const { confidence, low, high } = RatingEstimatorService.estimateControl(2.5, 50);
            expect(confidence).toBe('low');
            expect(low).toBe(42); // 52.4 - 10 = 42.4 -> 42
            expect(high).toBe(62); // 52.4 + 10 = 62.4 -> 62
        });
    });

    describe('estimateStuff', () => {
        it('should estimate stuff rating correctly for a typical K/9', () => {
            const { rating } = RatingEstimatorService.estimateStuff(7.0, 200);
            expect(rating).toBe(67);
        });

        it('should handle low K/9', () => {
            const { rating } = RatingEstimatorService.estimateStuff(5.0, 200);
            expect(rating).toBe(40);
        });

        it('should handle high K/9', () => {
            const { rating } = RatingEstimatorService.estimateStuff(8.0, 200);
            expect(rating).toBe(80);
        });
    });

    describe('estimateHRA', () => {
        it('should estimate HRA rating correctly for a typical HR/9', () => {
            const { rating } = RatingEstimatorService.estimateHRA(0.85, 200);
            expect(rating).toBe(51);
        });

        it('should handle low HR/9', () => {
            const { rating } = RatingEstimatorService.estimateHRA(0.5, 200);
            expect(rating).toBe(66);
        });

        it('should handle high HR/9', () => {
            const { rating } = RatingEstimatorService.estimateHRA(1.2, 200);
            expect(rating).toBe(37);
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
