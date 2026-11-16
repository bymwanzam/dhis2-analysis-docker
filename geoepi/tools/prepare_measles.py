"""Split the Group 3 measles capstone notebook into a preparation module and a modelling module.

  python tools/prepare_measles.py /path/to/Group3_Measles_Data_Prep_and_Modelling.ipynb notebooks/

The Colab notebook holds the whole analysis: Part 1 builds the district-month panel from the raw
DHIMS2-style exports, Part 2 models it. The web app runs them as two modules on the measles track
(the Measles page of DHIS2 Analysis lists only these):

  measles_data_preparation   Part 1. Takes the measles pack (upload Measles.zip as it is) and hands
                             off measles_panel.rds and the boundaries.
  measles_modelling          Part 2. Takes that hand-off and writes the three figures, the ranked
                             decision table and the 14-day microplan.

Per notebook it keeps the teaching text, replaces the Google-Drive download with a papermill
`parameters` cell, drops package installs (packages live in the image), reads Part 2's panel from
the dataset instead of Part 1's output folder, appends a hand-off cell (Part 1) and an export cell
for the map viewer, and writes the sidecar <id>.json. Cells are found by their text.
"""
import json, re, sys
from pathlib import Path
import nbformat
from nbformat.v4 import new_code_cell, new_markdown_cell

HERE = Path(__file__).resolve().parent
EXPORTS = HERE / "exports"
PREP, MODEL = "measles_data_preparation", "measles_modelling"
TRACK = "measles"

SYNTHETIC = ("> **SYNTHETIC TEACHING DATA — NOT FOR PUBLIC HEALTH DECISIONS.** Every count, coverage estimate and "
             "outbreak in this pack is simulated (seed 20265024). Results must never be presented as Ghana Health "
             "Service findings.")
DECISION = ("**The Director's decision (fictional, January 2025):** *Which three districts in Northern Region should "
            "receive priority measles investigation and immunisation outreach planning, and what evidence supports "
            "those choices?* Capacity: **two mobile immunisation outreach teams and one surveillance verification team "
            "for 14 days.** Evidence window: January 2023 – December 2024.")

PREP_FILES = [
    "dhims2_measles_export.csv", "dhims2_reporting_rates.csv", "dhims2_climate_app_export.csv",
    "district_lookup.csv", "population_district.csv", "district_covariates.csv",
    "measles_age_cases_monthly.csv", "measles_age_structure.csv", "measles_immunisation.csv",
    "school_contact_calendar.csv", "panel_ready.csv", "ghana_districts.gpkg",
]

PARAMS = '''# Parameters: the web app (papermill) overrides these for every run.
data_dir <- "/data/{data}"
out_dir  <- "/srv/jobs/outputs"'''

FIND = r'''dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
# the dataset may hold the whole pack (Measles/training_data/...) or just the files: find them
hit <- list.files(data_dir, pattern = "^{file}$", recursive = TRUE, full.names = TRUE)
if (length(hit) != 1) stop("Expected exactly one {name} in the dataset, found ", length(hit), ". {hint}")
data_dir <- dirname(hit[1])
data_dir
list.files(data_dir)'''

HANDOFF = '''# the hand-off folder: what the modelling module needs, so this run can be its dataset
h <- file.path(out_dir, "handoff"); dir.create(h, showWarnings = FALSE, recursive = TRUE)
file.copy(file.path(out_dir, "measles_panel.rds"), file.path(h, "measles_panel.rds"), overwrite = TRUE)
file.copy(file.path(data_dir, "ghana_districts.gpkg"), file.path(h, "ghana_districts.gpkg"), overwrite = TRUE)
list.files(h)'''

PREP_EXPORT = '''
# Measles panel: data quality and immunisation by district, and monthly incidence (usable months only)
safe("measles panel", {
  dq <- panel |> dplyr::group_by(adm2_code) |>
    dplyr::summarise(months_usable = sum(usable), months_missing = sum(is.na(confirmed)),
                     reporting_mean = mean(reporting_rate, na.rm = TRUE),
                     flags_impossible = sum(flag_conf_gt_test | flag_test_gt_susp),
                     age_mismatch = sum(flag_age_mismatch),
                     confirmed_usable = sum(confirmed[usable]),
                     mcv1_2024 = dplyr::first(mcv1_coverage_pct[year == 2024]),
                     dropout_2024 = dplyr::first(mcv1_to_mcv2_dropout_pct[year == 2024]),
                     susceptible_2024 = dplyr::first(susceptible_children_n[year == 2024]), .groups = "drop")
  pn <- panel |> dplyr::mutate(inc = dplyr::if_else(usable, incidence_100k, NA_real_))
  mo <- widen_months(pn, "inc", "inc")
  d  <- web_districts(districts) |> dplyr::left_join(dq, by = "adm2_code") |> dplyr::left_join(mo$wide, by = "adm2_code")
  write_geojson(d, "measles_panel_districts")
  add_layer(id = "quality", title = "Measles panel: data quality and immunisation", kind = "choropleth",
    file = "measles_panel_districts.geojson",
    fields = list(
      list(field = "months_usable",    label = "Usable months (of 24)", type = "numeric"),
      list(field = "reporting_mean",   label = "Mean reporting rate (%)", type = "numeric"),
      list(field = "months_missing",   label = "Months missing from the export", type = "numeric"),
      list(field = "flags_impossible", label = "Months with an impossible value", type = "numeric"),
      list(field = "mcv1_2024",        label = "MCV1 coverage 2024 (%)", type = "numeric"),
      list(field = "dropout_2024",     label = "MCV1-MCV2 dropout 2024 (%)", type = "numeric"),
      list(field = "susceptible_2024", label = "Estimated susceptible children 0-14, 2024", type = "numeric"),
      list(field = "confirmed_usable", label = "Confirmed cases, usable months", type = "numeric")))
  add_layer(id = "monthly", title = "Confirmed measles per 100,000 (monthly)", kind = "choropleth",
    file = "measles_panel_districts.geojson",
    series = list(list(id = "inc", label = "Usable months only", fields = mo$fields))) })
'''

MODEL_EXPORT = '''
# The decision: Northern Region priority with its evidence, then age-standardised risk for every district
safe("measles decision", {
  dec <- nr_dec |> dplyr::transmute(adm2_code, priority, P_top3, rank_point, RR_mean, RR_lo, RR_hi, rate_u5, O,
                                    mcv1, mcv2, dropout, susceptible_n, p_alert, fc_cases, months_usable_24, months_lt80)
  d <- web_districts(districts |> dplyr::filter(region == focus_region)) |> dplyr::left_join(dec, by = "adm2_code") |>
    dplyr::mutate(recommendation = dplyr::if_else(priority <= 3, "Recommended top 3", "Other"))
  write_geojson(d, "measles_northern_decision")
  add_layer(id = "decision", title = "Northern Region: measles priority and evidence", kind = "choropleth",
    file = "measles_northern_decision.geojson", source = "decision_table_northern.csv",
    fields = list(
      list(field = "recommendation",   label = "Recommendation", type = "category",
           colors = list("Recommended top 3" = "#B2182B", "Other" = "#d9d9d9")),
      list(field = "P_top3",           label = "P(in the Northern top 3)", type = "numeric"),
      list(field = "RR_mean",          label = "Posterior relative risk (age-standardised)", type = "numeric"),
      list(field = "rate_u5",          label = "Under-5 rate per 100,000 person-years", type = "numeric"),
      list(field = "susceptible_n",    label = "Estimated susceptible children 0-14", type = "numeric"),
      list(field = "dropout",          label = "MCV1-MCV2 dropout 2024 (%)", type = "numeric"),
      list(field = "mcv1",             label = "MCV1 coverage 2024 (%)", type = "numeric"),
      list(field = "p_alert",          label = "P(alert), January 2025", type = "numeric"),
      list(field = "months_usable_24", label = "Usable reporting months (of 24)", type = "numeric"))) })

safe("measles risk", {
  a <- ann |> dplyr::select(adm2_code, O, E_age, SIR_age, RR_mean, RR_lo, RR_hi, P_RR_gt1, rate_u5)
  d <- web_districts(districts) |> dplyr::left_join(a, by = "adm2_code")
  write_geojson(d, "measles_risk_2024")
  add_layer(id = "risk", title = "Measles risk 2024, all regions (age-standardised)", kind = "choropleth",
    file = "measles_risk_2024.geojson",
    fields = list(
      list(field = "RR_mean",  label = "Posterior relative risk", type = "numeric"),
      list(field = "SIR_age",  label = "Crude SIR (age-standardised)", type = "numeric"),
      list(field = "P_RR_gt1", label = "P(relative risk > 1)", type = "numeric"),
      list(field = "rate_u5",  label = "Under-5 rate per 100,000 person-years", type = "numeric"),
      list(field = "O",        label = "Confirmed cases 2024, usable months", type = "numeric"))) })
'''


def find(cells, prefix, start=0):
    for i in range(start, len(cells)):
        if cells[i].source.lstrip().startswith(prefix):
            return i
    raise SystemExit(f"cell not found: {prefix!r}")


def libraries(cell):
    """The Colab install-and-load cell, without the installs or the Colab output folder."""
    drop = (r"^pkgs\s*<-", r"^new\s*<-", r"^if \(length\(new\)", r"^out_dir\s*<-")
    lines = [l for l in cell.source.split("\n") if not any(re.match(p, l) for p in drop)]
    return "options(repr.plot.width = 10, repr.plot.height = 6, repr.plot.res = 100)\n" + "\n".join(lines).strip()


def finish(cells, kernel, export_block):
    export = (EXPORTS / "_helpers.R").read_text() + export_block + (EXPORTS / "_finish.R").read_text()
    cells += [new_markdown_cell("## Export for the web map viewer\n\nWrites the map layers listed in `layers.json`."),
              new_code_cell(export)]
    for c in cells:
        if c.cell_type == "code":
            c.outputs, c.execution_count = [], None
            c.metadata = {k: v for k, v in c.metadata.items() if k == "tags"}
        else:
            c.metadata = {}
    nb = nbformat.v4.new_notebook(cells=cells, metadata={"kernelspec": kernel, "language_info": {"name": "R"}})
    _, nb = nbformat.validator.normalize(nb)
    nbformat.validate(nb)
    return nb


def convert(src, dst):
    src_nb = nbformat.read(src, as_version=4)
    cells, kernel = src_nb.cells, src_nb.metadata["kernelspec"]
    libs = libraries(cells[find(cells, "pkgs <- c(")])
    assert "focus_region" in libs and "set.seed" in libs, "the setup cell no longer sets focus_region and the seed"
    part1, part2 = find(cells, "---\n\n# Part 1"), find(cells, "---\n\n# Part 2")
    md, code = new_markdown_cell, new_code_cell

    # ---- Part 1: data preparation
    prep = [
        md("# Measles M1 – Data Preparation (Group 3, Northern Region)\n\n"
           "**From the raw DHIMS2-style exports to a checked district-month panel.** Module M2 models it.\n\n"
           f"{SYNTHETIC}\n\n{DECISION}\n\n"
           "| Topic | What it does |\n|---|---|\n"
           "| 1.1 | the specification, written before opening the data |\n"
           "| 1.2 | reshape the long export, resolve duplicate keys, join names to district codes, complete the grid |\n"
           "| 1.3 | reporting completeness, impossible values, outliers that are errors rather than outbreaks, age consistency |\n"
           "| 1.4 | denominators, immunisation, school contact, climate, lags and the split; acceptance checks and the "
           "`panel_ready.csv` checkpoint |\n\n"
           "Output: `measles_panel.rds`. In the web app, choose **Use outputs as a dataset** on the finished run "
           "to give Module M2 its input."),
        md("## Setting up\n\nThe server passes `data_dir` (the uploaded measles pack: `Measles.zip` as it is, or "
           "the files of its `training_data` folder) and `out_dir`."),
        code(PARAMS.format(data="measles_data"), metadata={"tags": ["parameters"]}),
        code(FIND.format(file=r"dhims2_measles_export\\.csv", name="dhims2_measles_export.csv",
                         hint="Upload the measles pack (Measles.zip) as the dataset.")),
        md("Load the packages (they are installed in the server image)."),
        code(libs),
        *cells[part1:part2],
        md("## Hand-off\n\nThe checked panel and the boundaries, for Module M2."),
        code(HANDOFF),
    ]

    # ---- Part 2: modelling
    load = find(cells, 'panel_file <- file.path(out_dir, "measles_panel.rds")', part2)
    cells[load].source = cells[load].source.replace(
        'panel_file <- file.path(out_dir, "measles_panel.rds")      # written at the end of Part 1',
        'panel_file <- file.path(data_dir, "measles_panel.rds")     # the checked panel from Module M1')
    assert "data_dir" in cells[load].source.split("\n")[0], "Part 2 still reads the panel from out_dir"
    model = [
        md("# Measles M2 – Modelling and Prediction (Group 3, Northern Region)\n\n"
           "**From expected counts to a ranked, uncertainty-aware priority list and a 14-day microplan.**\n\n"
           f"{SYNTHETIC}\n\n{DECISION}\n\n"
           "| Director's question | Where it is answered |\n|---|---|\n"
           "| Which districts show the strongest combination of case signals and immunisation gaps? | Topics 2.1, 2.3 and 2.5 |\n"
           "| Do age-specific rates, MCV1/MCV2 coverage and dropout give different priorities from raw counts? | Topics 2.1 and 2.2 (and M1 Topic 1.4) |\n"
           "| How would incomplete reporting or uncertain vaccination estimates change the recommendation? | Topic 2.5 (and M1 Topic 1.3) |\n\n"
           "Input: the hand-off of a Module M1 run (`measles_panel.rds`, `ghana_districts.gpkg`). Outputs: "
           "`fig1_burden_map.png`, `fig2_coverage_quality_map.png`, `fig3_uncertainty_alert.png` and "
           "`decision_table_northern.csv`."),
        md("## Setting up"),
        code(PARAMS.format(data="measles_model_data"), metadata={"tags": ["parameters"]}),
        code(FIND.format(file=r"measles_panel\\.rds", name="measles_panel.rds",
                         hint="Run Module M1, then use its outputs as the dataset.")),
        code(libs),
        *cells[part2:],
    ]

    dst = Path(dst)
    for mid, nb_cells, block in [(PREP, prep, PREP_EXPORT), (MODEL, model, MODEL_EXPORT)]:
        nbformat.write(finish(nb_cells, kernel, block), dst / f"{mid}.ipynb")
    sidecars = {
        PREP: dict(id=PREP, title="Measles Data Preparation (Northern Region)", module="M1", track=TRACK,
                   stage="preparation", next=[MODEL], handoff=True, default_dataset="measles_data",
                   requires=PREP_FILES,
                   about="Build the checked district-month measles panel from the raw DHIMS2-style exports: duplicates, "
                         "name-to-code joins, reporting completeness, impossible values, age consistency, denominators, "
                         "immunisation and school contact."),
        MODEL: dict(id=MODEL, title="Measles Modelling and Prediction (Northern Region)", module="M2", track=TRACK,
                    stage="analysis", next=[], handoff=False, default_dataset=None,
                    requires=["measles_panel.rds", "ghana_districts.gpkg"],
                    about="Age-standardised SIR, count regression, spatial relative risk, next-month forecast and alerts, "
                          "then the ranked Northern Region decision table and the 14-day outreach microplan."),
    }
    for mid, meta in sidecars.items():
        (dst / f"{mid}.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{PREP}: {len(prep) + 2} cells; {MODEL}: {len(model) + 2} cells")


if __name__ == "__main__":
    convert(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else HERE.parent / "notebooks")
