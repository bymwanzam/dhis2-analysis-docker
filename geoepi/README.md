# Spatial Disease Modeling with R (GHS)

Runs the Spatial Epidemiology modules (R notebooks) on the same Docker deployment as
DHIS2 Analysis. The original Modules 1–5 remain available, and Module 6 explores map
data sent directly from the DHIS2 Analysis Maps page.

## Start
Run from the parent project root: `docker compose up -d --build`. Open
`http://SERVER:3000/geoepi/` after connecting to DHIS2 Analysis. The GeoEpi service is
private to the Compose network and is reached through the authenticated parent app.
The first Docker build installs the R packages (10–20 min). GeoEpi dataset and run data
persist in named volumes.

## Using it
Pick a module and a compatible dataset (incompatible ones are greyed out with the missing files listed), press Run.
Progress shows in the run list. When done: map layers (switchable fields, time slider for monthly/forecast layers),
the executed report with all infographics, output files, and "Download all".
**Export:** the layer panel has *Export this view* (PNG or JPEG, 1x/2x/3x, optional OpenStreetMap basemap) and *All maps (ZIP)*,
which renders every layer, field, month and forecast as its own image. Title, run info and legends are drawn into each image.
**Chaining:** a finished Module 2 run offers "Use outputs as a dataset" -> creates the data folder Modules 3, 4, 5 expect.

## What changed in the notebooks (tools/prepare_notebooks.py)
Colab downloads/installs/paths removed; `data_dir`/`out_dir` are papermill parameters; Module 4's output-only infographics
embedded so they survive a re-run; Module 2's hand-written `R/*.R` step (manual exercise) is skipped when absent;
an export cell writes GeoJSON, heat JSON, GeoTIFF and `layers.json`. Re-run the script after editing a Colab notebook:
`python tools/prepare_notebooks.py /path/to/colab/notebooks notebooks/`

## Adding a notebook
Parameters cell tagged `parameters` (`data_dir`, `out_dir`), outputs + `layers.json` in `out_dir`, plus `notebooks/<id>.json`
(`title`, `requires`, ...). Layer kinds: `points`, `heat`, `choropleth` (`fields` or `series` groups).

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
