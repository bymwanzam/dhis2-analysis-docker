"""Separate data preparation from modelling: build Module 2B and slim Modules 4 and 5.

  python tools/split_model_inputs.py notebooks/

Module 2 builds the district-month panel. Modules 4 and 5 used to start by turning that panel
into their own model inputs before fitting anything. This moves those steps, with their teaching
text and infographics, into Module 2B (module2b_model_inputs), which writes:

  district_year_2024.rds   Module 4: one row per district, observed (O) and expected (E) cases,
                           SIR, and the covariates on the scales the models use
  forecast_features.rds    Module 5: the district-month features that pass the leakage test,
                           the usable rows, and the train/test split

Modules 4 and 5 then load those files and go straight to modelling. Module 3 (exploratory
analysis) still reads the panel, which Module 2B passes on unchanged, so one Module 2B run is
the dataset for Modules 3, 4 and 5.

Cells are found by their text, not their position, so the script can run straight after
tools/prepare_notebooks.py rebuilds the notebooks from the Colab originals (it is called from
there). It is idempotent: on notebooks that are already split it changes nothing.
"""
import json, re, sys
from pathlib import Path
import nbformat
from nbformat.v4 import new_code_cell, new_markdown_cell

HERE = Path(__file__).resolve().parent
EXPORTS = HERE / "exports"
M2, M2B, M3 = "module2_data_preparation", "module2b_model_inputs", "module3_esda"
M4, M5 = "module4_spatial_regression", "module5_predictive_modelling"

M4_INPUTS = "district_year_2024.rds"
M5_INPUTS = "forecast_features.rds"

# What the web app shows for each module: which group it is listed under, and which modules a
# finished run's hand-off folder is meant for. Read by tools/prepare_notebooks.py too.
STAGES = {
    M2: dict(stage="preparation", next=[M2B, M3]),
    M2B: dict(stage="preparation", next=[M3, M4, M5]),
    "module1_spatial_epi": dict(stage="analysis", next=[]),
    M3: dict(stage="analysis", next=[]),
    M4: dict(stage="analysis", next=[]),
    M5: dict(stage="analysis", next=[]),
    "dhis2_map_explorer": dict(stage="dhis2", next=[]),
}


def text(c):
    return c.source.lstrip()


def find(cells, prefix, start=0):
    for i in range(start, len(cells)):
        if text(cells[i]).startswith(prefix):
            return i
    raise SystemExit(f"cell not found: {prefix!r}")


def renumber(cell, mapping):
    """Step numbers in a moved markdown cell, renumbered for its place in Module 2B."""
    for old, new in mapping.items():
        cell.source = re.sub(rf"^Step {old}\.", f"Step {new}.", cell.source)
    return cell


SETUP_PARAMS = '''# Parameters: the web app (papermill) overrides these for every run.
data_dir    <- "/data/module2b_data"
out_dir     <- "/srv/jobs/outputs"'''

SETUP_PREP = r'''dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
# Find panel.rds even if the dataset has an extra folder (a Module 2 hand-off, or a zip of one)
panel_path <- list.files(data_dir, pattern = "^panel\\.rds$", recursive = TRUE, full.names = TRUE)
if (length(panel_path) != 1) stop("Expected exactly one panel.rds file, but found: ", length(panel_path))
data_dir <- dirname(panel_path)
cat("Data directory:", data_dir, "\n")
list.files(data_dir, recursive = TRUE)'''

SETUP_LIBS = '''options(repr.plot.width = 10, repr.plot.height = 6, repr.plot.res = 100)
suppressPackageStartupMessages({ library(tidyverse); library(sf) })
options(width = 95)'''

LOAD_PANEL = '''panel     <- read_rds(file.path(data_dir, "panel.rds"))
districts <- st_read(file.path(data_dir, "ghana_districts.gpkg"), quiet = TRUE)
# district names, region and eco-zone come from the boundaries, joined once here for both tables
panel <- panel |> left_join(districts |> st_drop_geometry(), by = "adm2_code")
dim(panel)'''

HANDOFF = f'''# the hand-off folder: the model inputs, plus the panel and boundaries passed on unchanged,
# so this run is the dataset for Module 3 (which reads the panel), Module 4 and Module 5
h <- file.path(out_dir, "handoff"); dir.create(h, showWarnings = FALSE, recursive = TRUE)
write_rds(ann, file.path(h, "{M4_INPUTS}"))
write_rds(model_df, file.path(h, "{M5_INPUTS}"))
file.copy(panel_path, file.path(h, "panel.rds"), overwrite = TRUE)
file.copy(file.path(data_dir, "ghana_districts.gpkg"), file.path(h, "ghana_districts.gpkg"), overwrite = TRUE)
dictionary <- list.files(data_dir, pattern = "^data_dictionary\\\\.csv$", recursive = TRUE, full.names = TRUE)
if (length(dictionary)) file.copy(dictionary[1], file.path(h, "data_dictionary.csv"), overwrite = TRUE)
# the same two tables as CSV, to read or check outside R
write_csv(ann, file.path(out_dir, "district_year_2024.csv"))
write_csv(model_df |> mutate(across(where(is.factor), as.character)), file.path(out_dir, "forecast_features.csv"))
list.files(h)'''

EXPORT_BLOCK = '''
# Model inputs: the 2024 district table Module 4 models, and how many usable months Module 5 has per district
safe("model inputs", {
  usable <- model_df |> dplyr::count(adm2_code, split) |>
    tidyr::pivot_wider(names_from = split, values_from = n, names_prefix = "months_", values_fill = 0)
  d <- web_districts(districts) |>
    dplyr::left_join(ann |> dplyr::select(adm2_code, O, E, SIR, months), by = "adm2_code") |>
    dplyr::left_join(usable, by = "adm2_code")
  write_geojson(d, "model_inputs")
  add_layer(id = "inputs", title = "Model inputs, 2024", kind = "choropleth", file = "model_inputs.geojson",
    fields = list(
      list(field = "SIR",          label = "SIR (observed / expected)", type = "numeric"),
      list(field = "O",            label = "Observed cases, usable months", type = "numeric"),
      list(field = "E",            label = "Expected cases at the national rate", type = "numeric"),
      list(field = "months",       label = "Usable months in 2024 (Module 4)", type = "numeric"),
      list(field = "months_train", label = "Training rows (Module 5)", type = "numeric"),
      list(field = "months_test",  label = "Test rows (Module 5)", type = "numeric"))) })
'''


def build_m2b(m4_cells, m5_cells, kernel_meta):
    md, code = new_markdown_cell, new_code_cell
    cells = [
        md("> **Web-runner version.** `data_dir` and `out_dir` are parameters set by the server; the last cell "
           "exports map layers for the viewer. Built by `tools/split_model_inputs.py` from the data-preparation "
           "steps that used to open Modules 4 and 5."),
        md("# Module 2B – Preparing Model Inputs\n"
           "**Participant notebook (R)**\n\n"
           "Module 2 produced the district-month panel. Before a model can be fitted, the panel has to be "
           "turned into the exact table that model expects. This module does that for both modelling modules, "
           "so that Modules 4 and 5 contain modelling only:\n\n"
           f"- **Part A, for Module 4:** one row per district for 2024, with observed and expected cases, the "
           f"standardised incidence ratio and the covariates (`{M4_INPUTS}`).\n"
           f"- **Part B, for Module 5:** the district-month features that pass the leakage test, the usable "
           f"rows and the train/test split (`{M5_INPUTS}`).\n\n"
           "Keeping preparation separate means every modelling run starts from the same, checked inputs, and a "
           "change to how the inputs are built is made once, here, rather than in each model.\n\n"
           "In the web app: run this module on a Module 2 hand-off (or any dataset with `panel.rds` and "
           "`ghana_districts.gpkg`), then choose **Use outputs as a dataset**. That dataset runs Modules 3, 4 and 5."),
        md("## Setting up"),
        code(SETUP_PARAMS, metadata={"tags": ["parameters"]}),
        code(SETUP_PREP),
        code(SETUP_LIBS),
        md("### Loading the panel"),
        code(LOAD_PANEL),
        md("# Part A – The District Table for Disease Mapping (Module 4)"),
        md("Module 4 models one number per district: the cases observed in 2024 against the cases expected if "
           "the district had the national rate. These steps build that table from the usable months."),
        *m4_cells,
        md("Step 3. The covariates on the scales Module 4's models read them: rainfall per 100 mm, elevation per "
           "100 m, NDVI per 0.1, and population density on the log scale."),
        code("# covariates rescaled so each rate ratio is per a meaningful step\n"
             "ann <- ann |> mutate(rain100 = rain / 100, elev100 = elev / 100, ndvi10 = ndvi * 10, logdens = log(dens))\n"
             "ann |> select(adm2_name, O, E, SIR, rain100, tmean, ndvi10, elev100, logdens, fac) |> "
             "mutate(across(where(is.numeric), ~ round(.x, 2))) |> head(6)"),
        md("# Part B – The Forecasting Features (Module 5)"),
        md("Module 5 forecasts next month's incidence for each district. A forecast may only use what is known "
           "at the end of the month it is made in, so the features are chosen by a leakage test before any model "
           "sees them."),
        *m5_cells,
        md("## Hand-off\n\nThe two tables, saved for the modelling modules."),
        code(HANDOFF),
        md("## Export for the web map viewer\n\nWrites the map layers listed in `layers.json`."),
        code((EXPORTS / "_helpers.R").read_text() + EXPORT_BLOCK + (EXPORTS / "_finish.R").read_text()),
    ]
    nb = nbformat.v4.new_notebook(cells=cells, metadata=kernel_meta)
    _, nb = nbformat.validator.normalize(nb)
    nbformat.validate(nb)
    return nb


M4_LOAD = f'''# Module 2B prepared the district table this module models: observed and expected cases, SIR, covariates
inputs_path    <- list.files(data_dir, pattern = "^district_year_2024\\\\.rds$", recursive = TRUE, full.names = TRUE)[1]
districts_path <- list.files(data_dir, pattern = "^ghana_districts\\\\.gpkg$", recursive = TRUE, full.names = TRUE)[1]
if (is.na(inputs_path)) stop("{M4_INPUTS} not found: run Module 2B on the Module 2 panel and use its outputs as the dataset")

ann       <- read_rds(inputs_path)
districts <- st_read(districts_path, quiet = TRUE)
rate <- sum(ann$O) / sum(ann$population * ann$months / 12)   # the national reference rate behind E
nrow(ann); round(rate * 1000, 1)                              # districts; national cases per 1,000 person-years'''

M5_LOAD = f'''# Module 2B prepared the features that pass the leakage test, the usable rows and the split
features_path <- file.path(data_dir, "{M5_INPUTS}")
district_path <- file.path(data_dir, "ghana_districts.gpkg")
stopifnot(file.exists(features_path), file.exists(district_path))

model_df  <- read_rds(features_path)
districts <- st_read(district_path, quiet = TRUE)
model_df |> count(split)
train <- model_df |> filter(split == "train"); test <- model_df |> filter(split == "test")
range(train$month); range(test$month)'''


def split(nb_dir):
    nb_dir = Path(nb_dir)
    p4, p5 = nb_dir / f"{M4}.ipynb", nb_dir / f"{M5}.ipynb"
    m4, m5 = nbformat.read(p4, as_version=4), nbformat.read(p5, as_version=4)
    if any(M4_INPUTS in c.source for c in m4.cells):
        print("Modules 4 and 5 already load the Module 2B inputs; notebooks unchanged.")
        update_sidecars(nb_dir)
        return

    # ---- Module 4: Topic 1 steps 1-2 and the covariate scaling move to Module 2B
    c4 = m4.cells
    a, b = find(c4, "### VISUAL 1"), find(c4, "The national rate is")
    moved4 = [renumber(c, {}) for c in c4[a:b + 1]]
    scale_i = find(c4, "ann <- ann |> mutate(rain100")
    lines = c4[scale_i].source.split("\n")
    assert lines[0].startswith("ann <- ann |> mutate(rain100"), lines[0]
    c4[scale_i].source = "\n".join(lines[1:])
    load_md, load = find(c4, "### Loading the panel"), find(c4, "# Locate files dynamically")
    c4[load_md].source = "### Loading the model inputs"
    c4[load].source = M4_LOAD
    c4[a:b + 1] = [new_markdown_cell(
        "Steps 1 and 2 — one row per district for 2024, then the national rate, expected cases and the SIR — "
        "are in **Module 2B**, and the table loaded above is their result: `O`, `E`, `SIR`, `months` and the "
        "covariates for every district. This module starts from that table.")]

    # ---- Module 5: Topic 1 steps 2-3 (leakage test, features, split) move to Module 2B
    c5 = m5.cells
    a, b = find(c5, "### Visual explainer: Leakage check"), find(c5, "3,330 training")
    moved5 = []
    for c in c5[a:b + 1]:
        if c.cell_type == "code" and c.source.strip() == "ls()":
            continue
        if c.cell_type == "code" and text(c).startswith("# the feature set that passes"):
            c.source = "\n".join(l for l in c.source.split("\n")
                                 if not l.startswith("train <- ") and not l.startswith("range(test$month)"))
        moved5.append(renumber(c, {2: 1, 3: 2}))
    load_md, load = find(c5, "### Loading the panel"), find(c5, 'panel_path <- file.path(data_dir, "panel.rds")')
    c5[load_md].source = "### Loading the model inputs"
    c5[load].source = M5_LOAD
    after = find(c5, "Eighteen training months")
    c5[after].source = ("Eighteen training months and six test months, split by date in Module 2; the features and "
                        "the usable rows were chosen in Module 2B. Nothing from July to December 2024 is used to fit "
                        "anything in this module.")
    c5[a:b + 1] = [new_markdown_cell(
        "Steps 2 and 3 — the leakage test on the panel's columns, and the feature set that passes it with the "
        "usable rows and the split — are in **Module 2B**. The `train` and `test` tables loaded above are its "
        "result; the baselines below are the first thing fitted to them.")]
    setup = find(c5, 'project_dir <- file.path(out_dir, "project")')
    c5[setup].source = (c5[setup].source
                        .replace("# Find panel.rds even if", "# Find the Module 2B inputs even if")
                        .replace('"^panel\\\\.rds$"', f'"^{M5_INPUTS.replace(".", chr(92) * 2 + ".")}$"')
                        .replace("Expected exactly one panel.rds file", f"Expected exactly one {M5_INPUTS} file"))
    assert M5_INPUTS in c5[setup].source, "Module 5 setup cell was not updated"

    # ---- Module 2: its hand-off now feeds Module 2B (and Module 3)
    p2 = nb_dir / f"{M2}.ipynb"
    m2 = nbformat.read(p2, as_version=4)
    for c in m2.cells:
        c.source = c.source.replace("# Hand-off: the files Modules 3, 4 and 5 expect",
                                    "# Hand-off: the files Module 2B (model inputs) and Module 3 expect")

    m2b = build_m2b(moved4, moved5, {"kernelspec": m4.metadata["kernelspec"],
                                     "language_info": m4.metadata["language_info"]})
    for nb, path in [(m4, p4), (m5, p5), (m2, p2), (m2b, nb_dir / f"{M2B}.ipynb")]:
        _, nb = nbformat.validator.normalize(nb)
        nbformat.validate(nb)
        nbformat.write(nb, path)
    print(f"Wrote {M2B}.ipynb; moved {len(moved4)} cells out of Module 4 and {len(moved5)} out of Module 5.")
    update_sidecars(nb_dir)


def update_sidecars(nb_dir):
    """The web app's metadata: requirements follow the split; every module gets its stage."""
    sidecars = {p.stem: p for p in Path(nb_dir).glob("*.json")}
    meta = {k: json.loads(p.read_text(encoding="utf-8")) for k, p in sidecars.items()}
    meta[M2B] = {**meta.get(M2B, {}), "id": M2B, "title": "Module 2B – Preparing Model Inputs", "module": "2B",
                 "about": "Turn the Module 2 panel into the inputs Modules 4 and 5 model: the 2024 district table "
                          "(observed, expected, SIR, covariates) and the leakage-checked forecasting features with "
                          "the train/test split.",
                 "requires": ["panel.rds", "ghana_districts.gpkg"], "default_dataset": None, "handoff": True}
    meta[M2]["about"] = ("Import, harmonise and validate DHIMS2 and NADMO data and build the district-month panel "
                         "(hand-off for Module 2B and Module 3).")
    meta[M4]["requires"] = [M4_INPUTS, "ghana_districts.gpkg"]
    meta[M5]["requires"] = [M5_INPUTS, "ghana_districts.gpkg"]
    for k, m in meta.items():
        m.update(STAGES.get(k, {}))
        (Path(nb_dir) / f"{k}.json").write_text(json.dumps(m, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    split(sys.argv[1] if len(sys.argv) > 1 else HERE.parent / "notebooks")
