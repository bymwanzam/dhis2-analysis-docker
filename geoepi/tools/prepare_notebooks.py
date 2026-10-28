"""Convert the five Colab participant notebooks into server-runnable, parameterised notebooks.

  python tools/prepare_notebooks.py /path/to/uploads notebooks/

Per notebook it
  * keeps the teaching text and the embedded infographics; strips saved run outputs
  * turns the Module 4 "infographic" output-only cells into embedded images so they survive a re-run
  * replaces the Google-Drive cell with a papermill `parameters` cell (data_dir, out_dir, project_dir)
  * removes package installs / apt-get (packages live in the image) and keeps the library() calls
  * rewrites every /content/outputs and /content/project path to out_dir / project_dir
  * guards the one step that cannot run unattended (Module 2: hand-written R/*.R scripts)
  * appends an export cell (tools/exports/*.R) that writes GeoJSON / heat JSON / GeoTIFF + layers.json
  * writes a sidecar <id>.json with title, required data files and metadata for the web app
"""
import glob, json, re, sys
from pathlib import Path
import nbformat
from nbformat.v4 import new_code_cell, new_markdown_cell

HERE = Path(__file__).resolve().parent
EXPORTS = HERE / "exports"

MODULES = {
    "module1_spatial_epi": dict(
        src="Module1_Advanced_Spatial_Epidemiology_Illustrated_Beginner.ipynb", module=1, export="module1.R",
        data="module1_data", extra_requires=["rasters/chirps_2024*", "rasters/era5_temp_2024*"],
        about="Point patterns, area-data hotspots, kriging, multi-criteria risk and raster exposure for malaria in Ghana."),
    "module2_data_preparation": dict(
        src="Module2_Advanced_Data_Preparation_Illustrated_Beginner_FIXED.ipynb", module=2, export="module2.R",
        data="module2_data", handoff=True,
        about="Import, harmonise and validate DHIMS2 and NADMO data and build the district-month panel (hand-off for Modules 3-5)."),
    "module3_esda": dict(
        src="Module3_ESDA_Colorful_Illustrated_Sharp.ipynb", module=3, export="module3.R", data="module3_data",
        about="Exploratory spatio-temporal analysis of the panel: maps, seasonality, LISA persistence, interactive map."),
    "module4_spatial_regression": dict(
        src="Module4_Spatial_Regression_with_Infographs2.ipynb", module=4, export="module4.R", data="module4_data",
        requires=["panel.rds", "ghana_districts.gpkg"],
        about="SIR, count regression, Bayesian disease mapping with a spatial prior, exceedance probabilities."),
    "module5_predictive_modelling": dict(
        src="Module5_Predictive_Spatial_Modelling_Illustrated.ipynb", module=5, export="module5.R", data="module5_data",
        about="One-month-ahead district forecasts: regression, spatio-temporal GAM, random forest, spatial cross-validation."),
}

PARAMS = '''# Parameters: the web app (papermill) overrides these for every run.
data_dir    <- "/data/{data}"
out_dir     <- "/srv/jobs/outputs"'''

# Runs AFTER papermill's injected-parameters cell, so it sees the real values.
PREP = '''project_dir <- file.path(out_dir, "project")      # Module 2 builds its project folder here
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
# a data zip with one extra top-level folder: step into it
.sub <- list.dirs(data_dir, recursive = FALSE); .fil <- list.files(data_dir)
if (length(.sub) == 1 && length(.fil) == 0) data_dir <- .sub
cat("Data directory:", data_dir, "\\n")
list.files(data_dir, recursive = TRUE)'''

M5_FIND = r'''

# Find panel.rds even if the dataset has an extra folder
panel_path <- list.files(data_dir, pattern = "^panel\\.rds$", recursive = TRUE, full.names = TRUE)
if (length(panel_path) != 1) stop("Expected exactly one panel.rds file, but found: ", length(panel_path))
data_dir <- dirname(panel_path)'''

M2_LAST = r'''# The notebook cells saved as scripts in order, plus one runner.
# In the workshop participants create project/R/01_import.R ... 05_assemble_save.R by hand (Step 4).
# That is a manual exercise, so the runner only replays the pipeline if those scripts exist.
scripts <- file.path(project_dir, "R", c("01_import.R", "02_tidy_harmonise.R", "03_validate.R", "04_predictors.R", "05_assemble_save.R"))
if (all(file.exists(scripts))) {
  run_all <- c(paste0("data_dir <- \"", data_dir, "\""),
               "source(\"R/01_import.R\")", "source(\"R/02_tidy_harmonise.R\")",
               "source(\"R/03_validate.R\")", "source(\"R/04_predictors.R\")", "source(\"R/05_assemble_save.R\")",
               "cat(\"Pipeline complete:\", nrow(panel), \"rows\\n\")")
  writeLines(run_all, file.path(project_dir, "run_all.R"))
  old <- setwd(project_dir); source("run_all.R"); setwd(old)
  panel2 <- read_rds(file.path(project_dir, "data/processed/panel.rds"))
  identical(dim(panel), dim(panel2)); all.equal(panel$confirmed, panel2$confirmed)
} else {
  message("Skipped: the R/ scripts are a hands-on exercise (manual step 4); nothing to replay in an unattended run.")
}'''


def src_of(c):
    return c.source


def is_comment_only(s):
    lines = [l for l in s.split("\n") if l.strip()]
    return bool(lines) and all(l.strip().startswith("#") for l in lines)


def png_of(outputs):
    for o in outputs:
        d = o.get("data", {})
        if "image/png" in d:
            v = d["image/png"]
            return "".join(v) if isinstance(v, list) else v
    return None


def rewrite_paths(s):
    s = re.sub(r'"/content/project/([^"\\]+)"', r'file.path(project_dir, "\1")', s)
    s = s.replace('"/content/project"', "project_dir")
    s = re.sub(r'"/content/outputs/([^"\\]+)"', r'file.path(out_dir, "\1")', s)
    s = s.replace('"/content/outputs"', "out_dir")
    return s


def clean_libs(s):
    s = re.sub(r'pkgs\s*<-\s*c\([^)]*\)[ \t]*\n', "", s)
    s = re.sub(r'new\s*<-[^\n]*\n', "", s)
    s = re.sub(r'if \(length\(new\) > 0\)[^\n]*\n', "", s)
    return s.lstrip("\n")


def required_files(code, cfg):
    if "requires" in cfg:
        return cfg["requires"]
    req = set(re.findall(r'file\.path\(\s*data_dir\s*,\s*"([^"]+)"', code))
    req = {r for r in req if "." in r.split("/")[-1]}          # files, not folders such as "rasters"
    return sorted(req) + cfg.get("extra_requires", [])


def convert(mid, cfg, src_dir, out_dir):
    nb = nbformat.read(Path(src_dir) / cfg["src"], as_version=4)
    cells, notes = [], []
    # 1. infographic cells that exist only as saved output -> markdown with the picture
    for c in nb.cells:
        if c.cell_type == "code" and is_comment_only(c.source) and png_of(c.outputs):
            cells.append(new_markdown_cell(f'<img alt="infographic" style="max-width:100%" src="data:image/png;base64,{png_of(c.outputs)}">'))
            notes.append("infographic->markdown")
            continue
        cells.append(c)
    nb.cells = cells

    out, seen_params, seen_libs = [], False, False
    for c in nb.cells:
        if c.cell_type != "code":
            out.append(c); continue
        s = c.source
        live = "\n".join(l for l in s.split("\n") if not l.strip().startswith("#"))
        if not seen_params and re.search(r'(?m)^googledrive::drive_download', s):
            out.append(new_code_cell(PARAMS.format(data=cfg["data"]), metadata={"tags": ["parameters"]}))
            out.append(new_code_cell(PREP + (M5_FIND if mid.startswith("module5") else "")))
            seen_params = True; continue
        if "apt-get install" in live or re.fullmatch(r'\s*install\.packages\([^)]*\)\s*', live):
            continue                                                  # system libs / installs live in the image
        if not seen_libs and re.search(r'pkgs\s*<-\s*c\(', s):
            s = "options(repr.plot.width = 10, repr.plot.height = 6, repr.plot.res = 100)\n" + clean_libs(s)
            seen_libs = True
        if "run_all <- c(" in s:                                       # Module 2 manual-exercise step
            s = M2_LAST
        c.source = rewrite_paths(s)
        out.append(c)
    assert seen_params, f"{mid}: setup cell not found"
    nb.cells = out

    code = "\n".join(c.source for c in nb.cells if c.cell_type == "code")
    leftovers = [l for l in code.split("\n") if "/content" in l or "googledrive" in l]
    assert not leftovers, f"{mid}: Colab paths left: {leftovers[:3]}"
    requires = required_files(code, cfg)

    # export cell
    export = (EXPORTS / "_helpers.R").read_text() + (EXPORTS / cfg["export"]).read_text() + (EXPORTS / "_finish.R").read_text()
    nb.cells.append(new_markdown_cell("## Export for the web map viewer\n\nAdded by `tools/prepare_notebooks.py`: writes the map layers listed in `layers.json`."))
    nb.cells.append(new_code_cell(export))
    nb.cells.insert(0, new_markdown_cell(
        "> **Web-runner version** of the Colab participant notebook. `data_dir` and `out_dir` are parameters set by the server; "
        "the last cell exports map layers for the viewer. Everything else is the original teaching material."))

    for c in nb.cells:
        if c.cell_type == "code":
            c.outputs, c.execution_count = [], None
            c.metadata = {k: v for k, v in c.metadata.items() if k == "tags"}
        else:
            c.metadata = {}
    nb.metadata = {"kernelspec": nb.metadata["kernelspec"], "language_info": nb.metadata["language_info"]}
    _, nb = nbformat.validator.normalize(nb)      # give every cell an id
    nbformat.validate(nb)

    title = next((re.match(r"#\s+(.+)", c.source).group(1) for c in nb.cells
                  if c.cell_type == "markdown" and re.match(r"#\s+\S", c.source)), mid)
    out_dir = Path(out_dir); out_dir.mkdir(parents=True, exist_ok=True)
    nbformat.write(nb, out_dir / f"{mid}.ipynb")
    (out_dir / f"{mid}.json").write_text(json.dumps(dict(
        id=mid, title=title, module=cfg["module"], about=cfg["about"], requires=requires,
        default_dataset=cfg["data"], handoff=bool(cfg.get("handoff"))), indent=1))
    size = (out_dir / f"{mid}.ipynb").stat().st_size / 1e6
    print(f"{mid}: {len(nb.cells)} cells, {size:.1f} MB, requires {requires}, {len(notes)} infographic cell(s) converted")


if __name__ == "__main__":
    src_dir, dst = sys.argv[1], sys.argv[2]
    for mid, cfg in MODULES.items():
        convert(mid, cfg, src_dir, dst)
