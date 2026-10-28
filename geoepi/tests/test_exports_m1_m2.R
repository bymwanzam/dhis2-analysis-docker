# Runs the Module 1 and Module 2 export blocks against synthetic stand-ins for the notebook objects.
suppressPackageStartupMessages({ library(sf); library(dplyr); library(terra); library(spatstat); library(tidyr) })
ex <- "../tools/exports"; syn <- commandArgs(TRUE)[1]
districts <- st_read(file.path(syn, "ghana_districts.gpkg"), quiet = TRUE)
du <- st_transform(districts, 32630); set.seed(1)

run_block <- function(file, label) {
  out_dir <<- file.path(tempdir(), label); dir.create(out_dir, showWarnings = FALSE)
  for (f in c("_helpers.R", file, "_finish.R")) eval(parse(file.path(ex, f)), envir = globalenv())
  L <- jsonlite::read_json(file.path(out_dir, "layers.json"))$layers
  cat(label, ":", length(L), "layers ->", paste(sapply(L, `[[`, "id"), collapse = ", "), "\n"); out_dir
}

# ---- Module 2 objects
data_dir <- syn
panel <- readRDS(file.path(syn, "panel.rds")); dictionary <- readr::read_csv(file.path(syn, "data_dictionary.csv"), show_col_types = FALSE)
o2 <- run_block("module2.R", "m2")
stopifnot(file.exists(file.path(o2, "panel_districts.geojson")), all(file.exists(file.path(o2, "handoff", c("panel.rds", "panel.csv", "ghana_districts.gpkg", "data_dictionary.csv")))))

# ---- Module 1 objects (UTM 32630, as in the notebook)
b <- st_bbox(du[95, ]); win <- owin(c(b$xmin, b$xmax), c(b$ymin, b$ymax))
pts <- st_coordinates(st_sample(du[95, ], 80)); pp <- ppp(pts[, 1], pts[, 2], window = win)
d500 <- density(pp, sigma = 500); d1000 <- density(pp, sigma = 1000); rr <- density(pp, sigma = 2000)
cases_sf <- st_as_sf(data.frame(x = pts[, 1], y = pts[, 2], date = Sys.Date()), coords = c("x", "y"), crs = 32630)
g <- expand.grid(x = seq(b$xmin, b$xmax, length.out = 15), y = seq(b$ymin, b$ymax, length.out = 15))
idw_out <- st_as_sf(transform(g, var1.pred = runif(nrow(g))), coords = c("x", "y"), crs = 32630)
kr <- st_as_sf(transform(g, var1.pred = runif(nrow(g)), var1.var = runif(nrow(g), .01, .05)), coords = c("x", "y"), crs = 32630)
n <- nrow(du)
map_df <- du |> mutate(cases = 5, population = 1e5, rate_raw = runif(n), rate_eb_local = runif(n), death_eb_local = runif(n),
  lisa_lab = sample(c("High-High", "Low-Low", "Not significant"), n, TRUE), gi_z = rnorm(n),
  gi_lab = sample(c("Hot spot", "Cold spot", "Not significant"), n, TRUE), in_cluster = runif(n) < .1)
map_idx <- du |> mutate(index_ahp = runif(n), index_equal = runif(n), index_burden = runif(n),
  class_ahp = factor(sample(c("High", "Low"), n, TRUE)), robust = runif(n) < .2)
d_env <- districts |> mutate(rain_mm_mean = 90, temp_c_mean = 27, ndvi_mean = .5, elev_mean = 200, suit_mean = 6)
suit <- rast(nrows = 10, ncols = 10, xmin = -3, xmax = 1, ymin = 5, ymax = 11, crs = "EPSG:4326", vals = runif(100))
o1 <- run_block("module1.R", "m1")
stopifnot(file.exists(file.path(o1, c("kde_500m.heat.json", "kde_500m.tif", "relative_risk.heat.json", "prevalence_kriging_sd.heat.json",
                                       "cases_points.geojson", "districts_epi.geojson", "priority_index.geojson", "suitable_months.tif"))))
h <- jsonlite::read_json(file.path(o1, "kde_500m.heat.json"))$points
cat("heat points:", length(h), " first:", unlist(h[[1]]), "\n"); cat("EXPORT TESTS PASSED\n")
