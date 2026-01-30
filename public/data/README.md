# Default Scouting Data

This directory contains default data files that are bundled with the application.

## default_osa_scouting.csv

Place your OSA scouting data CSV file here with the filename `default_osa_scouting.csv`.

**Expected Format:**
- Header row with columns: `player_id`, `name`, `stuff`, `control`, `hra`, and optionally `age`, `ovr`, `pot`, pitch ratings, etc.
- One row per pitcher
- CSV format with comma-separated values

**Example:**
```csv
player_id,name,stuff,control,hra,age,ovr,pot
12345,John Smith,60,55,65,24,3.5,4.0
67890,Jane Doe,70,50,60,22,4.0,4.5
```

**How it's used:**
- On first app load (onboarding), this file is automatically imported as OSA scouting data
- Users can update it later via the Data Management page
- If this file is missing, onboarding will skip loading default OSA data (app will still work)

**To export from OOTP:**
1. Open OOTP and go to Commissioner Tools
2. Export OSA scouting ratings for pitchers
3. Save as CSV
4. Rename to `default_osa_scouting.csv` and place in this directory
5. Rebuild and deploy
