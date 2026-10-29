# Spatial Disease Modeling with R (GHS)

Runs the Spatial Epidemiology modules (R notebooks) on the same Docker deployment as
DHIS2 Analysis. The original Modules 1–5 remain available, and Module 6 explores map
data sent directly from the DHIS2 Analysis Maps page.

## Start
Run from the parent project root: `docker compose up -d --build`. Connect to DHIS2
Analysis, then open **GeoEpi** in its navigation (`http://SERVER:3000/geoepi`). The viewer
opens inside the app, in the same theme. The GeoEpi service is private to the Compose
network and is reached through the authenticated parent app, which forwards only the
routes listed in `src/lib/geoepi/paths.ts`.
The first Docker build installs the R packages (10–20 min). GeoEpi dataset and run data
persist in named volumes.

## Modules: preparation, then modelling

Data preparation and modelling are separate modules. The module picker lists them in
separate groups.

| Stage | Module | Takes | Gives |
|---|---|---|---|
| Data preparation | **2** – Data Preparation and Management | DHIMS2/NADMO exports, rasters | `panel.rds`, the district-month panel |
| Data preparation | **2B** – Preparing Model Inputs | `panel.rds`, `ghana_districts.gpkg` | `district_year_2024.rds` (Module 4), `forecast_features.rds` (Module 5), the panel passed on |
| Analysis and modelling | **3** – Exploratory Spatial Data Analysis | `panel.rds` (from 2 or 2B) | maps, ESDA brief |
| Analysis and modelling | **4** – Spatial Regression and Disease Mapping | `district_year_2024.rds` | rate ratios, relative risk, exceedance |
| Analysis and modelling | **5** – Predictive Spatial Modelling | `forecast_features.rds` | forecasts, intervals, priority list |
| Analysis and modelling | **1** – Advanced Spatial Epidemiology | its own data pack | stands alone |

The usual chain: run Module 2, then **Use outputs as a dataset**, then run Module 2B on it, then
**Use outputs as a dataset** again. That second dataset runs Modules 3, 4 and 5. Each button
selects the next module and the new dataset for you.

Module 2B holds the steps that used to open Modules 4 and 5:
- Module 4's district totals, expected cases, SIR and covariate scaling.
- Module 5's leakage test, feature set and train/test split.

Modules 4 and 5 now load those tables and start modelling. A Module 4 or 5 dataset that has
only `panel.rds` is listed as missing its input; run Module 2B on it first.

## Measles track (Group 3 capstone)

The **Measles** page of DHIS2 Analysis lists only the two measles modules. The GeoEpi page
lists everything else. Both modules are synthetic teaching material.

| Module | Takes | Gives |
|---|---|---|
| **M1** – Measles Data Preparation | the measles pack: upload `Measles.zip` as it is | `measles_panel.rds`, checked against `panel_ready.csv` |
| **M2** – Measles Modelling and Prediction | M1's hand-off | `fig1_burden_map.png`, `fig2_coverage_quality_map.png`, `fig3_uncertainty_alert.png`, `decision_table_northern.csv`, the 14-day microplan |

They are built from the Colab notebook `Group3_Measles_Data_Prep_and_Modelling.ipynb`:
`python tools/prepare_measles.py /path/to/Group3_Measles_Data_Prep_and_Modelling.ipynb notebooks/`
Part 1 becomes M1 and Part 2 becomes M2. The tool swaps the Drive download for papermill
parameters, drops the installs, and has M2 read the panel from its dataset. It also adds
the hand-off and map exports. A module joins a track with `"track": "<name>"` in its
sidecar; the viewer opened with `?track=<name>` lists only that track's modules and runs.

## Using it
Pick a module and a compatible dataset (incompatible ones are greyed out with the missing files listed), press Run.
Datasets can be uploaded either as a ZIP or as individual files: **Upload module files**
shows every required input for the selected module, including multi-file raster inputs.
Progress shows in the run list. When done: map layers (switchable fields, time slider for monthly/forecast layers),
the executed report with all infographics, output files, and "Download all".
**Export:** the layer panel has *Export this view* (PNG or JPEG, 1x/2x/3x, optional OpenStreetMap basemap) and *All maps (ZIP)*,
which renders every layer, field, month and forecast as its own image. Title, run info and legends are drawn into each image.
**Chaining:** a finished Module 2 or 2B run offers "Use outputs as a dataset". It creates the data folder the next modules expect.

## What changed in the notebooks (tools/prepare_notebooks.py)
Colab downloads/installs/paths removed; `data_dir`/`out_dir` are papermill parameters; Module 4's output-only infographics
embedded so they survive a re-run; Module 2's hand-written `R/*.R` step (manual exercise) is skipped when absent;
an export cell writes GeoJSON, heat JSON, GeoTIFF and `layers.json`. Re-run the script after editing a Colab notebook:
`python tools/prepare_notebooks.py /path/to/colab/notebooks notebooks/`
That script ends by running `tools/split_model_inputs.py`, which builds Module 2B from the opening
steps of Modules 4 and 5. It finds those steps by their text, so if a Colab edit renames one, it
stops and names the cell it could not find. On notebooks that are already split, it changes nothing.

## Adding a notebook
Parameters cell tagged `parameters` (`data_dir`, `out_dir`), outputs + `layers.json` in `out_dir`, plus `notebooks/<id>.json`
(`title`, `requires`, ...). Layer kinds: `points`, `heat`, `choropleth` (`fields` or `series` groups).
`stage` (`preparation`, `analysis` or `dhis2`) chooses the group the module is listed under;
`next` lists the module ids its hand-off dataset is meant for.

## DHIS2 map hand-off

From the Maps page in DHIS2 Analysis, choose **Send to GeoEpi** to create a dataset with
the selected values, organisation-unit IDs and hierarchy, periods, and available
geometries. **Module 6: DHIS2 Map Data Explorer** displays numeric values and exports the
dataset as CSV, GeoJSON, and GeoPackage. This single-map hand-off does not replace the
multiple input tables and rasters required by Modules 1–5.

## Security
Only admin-placed notebooks run; users upload data only. Add authentication before exposing beyond a trusted network.

## Tests
`pip install -r requirements.txt && python tests/test_api.py && node tests/test_lib.js`
Image export: `npm i canvas` then `node tests/test_export.js OUT RUN3 RUN4 RUN5` (folders holding exported run outputs)
R side: `Rscript tests/make_synthetic.R /tmp/syn` then run a notebook with papermill (see tests/).
