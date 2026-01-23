import { RatingEstimatorService } from './RatingEstimatorService';

describe('RatingEstimatorService', () => {
    describe('estimateControl', () => {
        it('should have high confidence for high IP', () => {
            const { confidence, rating, low, high } = RatingEstimatorService.estimateControl(2.5, 200);
            expect(confidence).toBe('high');
            expect(rating).toBe(50);
            expect(low).toBe(45);
            expect(high).toBe(55);
        });

        it('should have moderate confidence for medium IP', () => {
            const { confidence, rating, low, high } = RatingEstimatorService.estimateControl(2.5, 150);
            expect(confidence).toBe('moderate');
            expect(rating).toBe(50);
            expect(low).toBe(45);
            expect(high).toBe(60);
        });

        it('should have low confidence for low IP', () => {
            const { confidence, rating, low, high } = RatingEstimatorService.estimateControl(2.5, 50);
            expect(confidence).toBe('low');
            expect(rating).toBe(50);
            expect(low).toBe(40);
            expect(high).toBe(60);
        });

        it('should handle low BB/9', () => {
            const { rating } = RatingEstimatorService.estimateControl(1.5, 200);
            expect(rating).toBe(70);
        });

        it('should handle high BB/9', () => {
            const { rating } = RatingEstimatorService.estimateControl(3.5, 200);
            expect(rating).toBe(35);
        });

        it('should cap control rating at 80 for impossibly low BB/9', () => {
            const { rating } = RatingEstimatorService.estimateControl(0.5, 200);
            expect(rating).toBe(80);
        });

        it('should cap control rating at 20 for impossibly high BB/9', () => {
            const { rating } = RatingEstimatorService.estimateControl(5.0, 200);
            expect(rating).toBe(20);
        });
    });

    describe('estimateStuff', () => {
        it('should estimate stuff rating correctly for a typical K/9', () => {
            const { rating } = RatingEstimatorService.estimateStuff(7.0, 200);
            expect(rating).toBe(65);
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
            expect(rating).toBe(50);
        });

        it('should handle low HR/9', () => {
            const { rating } = RatingEstimatorService.estimateHRA(0.5, 200);
            expect(rating).toBe(65);
        });

        it('should handle high HR/9', () => {
            const { rating } = RatingEstimatorService.estimateHRA(1.2, 200);
            expect(rating).toBe(35);
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
