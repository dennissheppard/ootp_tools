"""
OOTP Rating -> Stat Formula Analyzer

Analyzes collected data to derive formulas for converting ratings to stats.

Requirements:
    pip install pandas numpy scikit-learn matplotlib
"""

import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.preprocessing import PolynomialFeatures
from sklearn.metrics import r2_score, mean_absolute_error
import warnings
warnings.filterwarnings('ignore')

# Input ratings (what we control)
INPUT_COLS = ['stuff', 'control', 'hra', 'movement', 'babip']

# Output stats (what OOTP generates)
OUTPUT_COLS = ['hits allowed', 'hr', 'bb', 'k', 'ip']

# BABIP conversion: editor (1-250) to UI (20-80)
def convert_babip_to_ui(babip_editor):
    """Convert BABIP from editor scale (1-250) to UI scale (20-80)"""
    return 20 + (babip_editor - 1) * 60 / 249

def convert_babip_to_editor(babip_ui):
    """Convert BABIP from UI scale (20-80) to editor scale (1-250)"""
    return 1 + (babip_ui - 20) * 249 / 60


class FormulaAnalyzer:
    def __init__(self, csv_path):
        self.df = pd.read_csv(csv_path)
        # Clean any empty rows
        self.df = self.df.dropna(how='all')
        self.df = self.df.apply(pd.to_numeric, errors='coerce')
        self.df = self.df.dropna()

        self.formulas = {}
        self.models = {}

        print(f"Loaded {len(self.df)} rows of data\n")
        print("Input ranges:")
        for col in INPUT_COLS:
            if col in self.df.columns:
                print(f"  {col}: {self.df[col].min():.0f} - {self.df[col].max():.0f}")
        print()

    def analyze_linear(self, output_col):
        """Fit a simple linear model and return coefficients"""
        X = self.df[INPUT_COLS].values
        y = self.df[output_col].values

        model = LinearRegression()
        model.fit(X, y)

        y_pred = model.predict(X)
        r2 = r2_score(y, y_pred)
        mae = mean_absolute_error(y, y_pred)

        return model, r2, mae

    def analyze_polynomial(self, output_col, degree=2):
        """Fit a polynomial model"""
        X = self.df[INPUT_COLS].values
        y = self.df[output_col].values

        poly = PolynomialFeatures(degree=degree, include_bias=False)
        X_poly = poly.fit_transform(X)

        model = Ridge(alpha=1.0)  # Use Ridge to avoid overfitting
        model.fit(X_poly, y)

        y_pred = model.predict(X_poly)
        r2 = r2_score(y, y_pred)
        mae = mean_absolute_error(y, y_pred)

        return model, poly, r2, mae

    def format_formula(self, model, output_name):
        """Format linear model as readable formula"""
        coeffs = model.coef_
        intercept = model.intercept_

        terms = []
        for i, col in enumerate(INPUT_COLS):
            coef = coeffs[i]
            if abs(coef) > 0.001:  # Skip negligible coefficients
                sign = "+" if coef > 0 else "-"
                terms.append(f"{sign} {abs(coef):.4f}*{col}")

        formula = f"{output_name} = {intercept:.2f} {' '.join(terms)}"
        return formula

    def analyze_single_variable_effects(self, output_col):
        """Analyze effect of each input variable in isolation"""
        print(f"\n  Individual variable effects on {output_col}:")

        for input_col in INPUT_COLS:
            # Simple correlation
            corr = self.df[input_col].corr(self.df[output_col])

            # Fit single-variable model
            X = self.df[[input_col]].values
            y = self.df[output_col].values

            model = LinearRegression()
            model.fit(X, y)

            coef = model.coef_[0]
            direction = "UP" if coef > 0 else "DOWN"

            print(f"    {input_col:12s}: coef={coef:+.3f} (per +1 rating -> {direction} {abs(coef):.2f} {output_col}), corr={corr:+.3f}")

    def run_analysis(self):
        """Run full analysis on all output columns"""
        print("="*70)
        print("OOTP RATING -> STAT FORMULA ANALYSIS")
        print("="*70)

        results = []

        for output_col in OUTPUT_COLS:
            if output_col not in self.df.columns:
                print(f"\nSkipping {output_col} - not in data")
                continue

            print(f"\n{'='*70}")
            print(f"Analyzing: {output_col.upper()}")
            print("="*70)

            # Linear analysis
            lin_model, lin_r2, lin_mae = self.analyze_linear(output_col)

            # Polynomial analysis
            poly_model, poly_transform, poly_r2, poly_mae = self.analyze_polynomial(output_col, degree=2)

            # Store linear model (simpler and usually good enough)
            self.models[output_col] = lin_model
            self.formulas[output_col] = self.format_formula(lin_model, output_col)

            print(f"\n  LINEAR MODEL:")
            print(f"    R² = {lin_r2:.4f} (explains {lin_r2*100:.1f}% of variance)")
            print(f"    MAE = {lin_mae:.2f} (average error: ±{lin_mae:.1f})")
            print(f"\n    Formula:")
            print(f"    {self.formulas[output_col]}")

            print(f"\n  POLYNOMIAL MODEL (degree=2):")
            print(f"    R² = {poly_r2:.4f} (explains {poly_r2*100:.1f}% of variance)")
            print(f"    MAE = {poly_mae:.2f}")

            improvement = poly_r2 - lin_r2
            if improvement > 0.02:
                print(f"    -> Polynomial is notably better (+{improvement:.3f} R²)")
            else:
                print(f"    -> Linear is sufficient (polynomial only +{improvement:.3f} R²)")

            # Individual effects
            self.analyze_single_variable_effects(output_col)

            results.append({
                'stat': output_col,
                'r2': lin_r2,
                'mae': lin_mae,
                'formula': self.formulas[output_col]
            })

        return results

    def print_summary(self):
        """Print a clean summary of all formulas"""
        print("\n" + "="*70)
        print("SUMMARY: DERIVED FORMULAS")
        print("="*70)
        print("\nNote: BABIP in these formulas uses editor scale (1-250).")
        print("      To use with UI scale (20-80), convert first:")
        print("      babip_editor = 1 + (babip_ui - 20) * 249 / 60")
        print()

        for output_col, formula in self.formulas.items():
            model = self.models[output_col]
            y_pred = model.predict(self.df[INPUT_COLS].values)
            r2 = r2_score(self.df[output_col].values, y_pred)
            print(f"{formula}")
            print(f"  (R² = {r2:.3f})\n")

    def print_coefficient_table(self):
        """Print coefficients as a table for easy implementation"""
        print("\n" + "="*70)
        print("COEFFICIENT TABLE (for implementation)")
        print("="*70)

        # Header
        header = f"{'Stat':<15} {'Intercept':>10}"
        for col in INPUT_COLS:
            header += f" {col:>10}"
        print(header)
        print("-" * len(header))

        for output_col in OUTPUT_COLS:
            if output_col not in self.models:
                continue
            model = self.models[output_col]
            row = f"{output_col:<15} {model.intercept_:>10.2f}"
            for coef in model.coef_:
                row += f" {coef:>10.4f}"
            print(row)

    def test_prediction(self, stuff, control, hra, movement, babip):
        """Test predictions with given ratings"""
        print(f"\n{'='*70}")
        print(f"PREDICTION TEST")
        print(f"  Ratings: stuff={stuff}, control={control}, hra={hra}, movement={movement}, babip={babip}")
        print("="*70)

        X = np.array([[stuff, control, hra, movement, babip]])

        for output_col in OUTPUT_COLS:
            if output_col in self.models:
                pred = self.models[output_col].predict(X)[0]
                print(f"  {output_col:<15}: {pred:>6.1f}")


def main():
    import sys

    # Default path
    csv_path = r"C:\Users\neags\Downloads\dev projects\wbl\ootp_data_20260122.csv"

    if len(sys.argv) > 1:
        csv_path = sys.argv[1]

    analyzer = FormulaAnalyzer(csv_path)
    analyzer.run_analysis()
    analyzer.print_summary()
    analyzer.print_coefficient_table()

    # Test with a sample prediction (50s across the board)
    # Using babip=125 which is ~50 on UI scale
    analyzer.test_prediction(stuff=50, control=50, hra=50, movement=50, babip=125)

    # Test with extreme values
    analyzer.test_prediction(stuff=80, control=80, hra=80, movement=80, babip=220)
    analyzer.test_prediction(stuff=20, control=20, hra=20, movement=20, babip=30)

    print("\n" + "="*70)
    print("ANALYSIS COMPLETE")
    print("="*70)


if __name__ == "__main__":
    main()
