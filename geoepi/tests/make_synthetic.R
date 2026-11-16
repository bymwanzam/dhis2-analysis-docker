# Synthetic stand-in for the Module 3/4/5 data pack (100 grid "districts", 24 months). For tests only.
suppressPackageStartupMessages({ library(sf); library(dplyr); library(tidyr); library(readr); library(lubridate) })
args <- commandArgs(TRUE); out <- args[1]; dir.create(out, recursive = TRUE, showWarnings = FALSE)
set.seed(42)
nx <- 10; ny <- 10; x0 <- -3.2; y0 <- 4.8; dx <- 0.44; dy <- 0.63
cells <- expand.grid(i = 1:nx, j = 1:ny)
polys <- lapply(seq_len(nrow(cells)), function(k) { x <- x0 + (cells$i[k] - 1) * dx; y <- y0 + (cells$j[k] - 1) * dy
  st_polygon(list(rbind(c(x, y), c(x + dx, y), c(x + dx, y + dy), c(x, y + dy), c(x, y)))) })
d <- st_sf(adm2_code = sprintf("GH%03d", seq_len(nrow(cells))), geometry = st_sfc(polys, crs = 4326))
d$eco_zone <- cut(cells$j, c(0, 2, 5, 8, 10), labels = c("Coastal savannah", "Forest", "Transition", "Guinea savannah")) |> as.character()
d$region <- ifelse(cells$j >= 9 & cells$i >= 6, "Upper East", ifelse(cells$j >= 9, "Upper West", ifelse(cells$j >= 6, "Northern", ifelse(cells$j >= 3, "Ashanti", "Western"))))
nm <- paste("District", seq_len(nrow(d)))
nm[c(95, 25, 96, 3)] <- c("Bolgatanga Municipal", "Kumasi Metropolitan", "Nabdam", "Sekondi Takoradi Metropolitan")
d$adm2_name <- nm
d <- d[, c("adm2_code", "adm2_name", "region", "eco_zone", "geometry")]
st_write(d, file.path(out, "ghana_districts.gpkg"), delete_dsn = TRUE, quiet = TRUE)

months <- seq(ymd("2023-01-01"), ymd("2024-12-01"), by = "month")
st <- st_drop_geometry(d) |> mutate(pop0 = round(runif(n(), 30000, 400000)), elev_m = round(runif(n(), 20, 700)),
        ndvi = round(runif(n(), 0.3, 0.8), 3), area_km2 = round(runif(n(), 300, 4000)), n_fac = rpois(n(), 25) + 1,
        base = c("Coastal savannah" = 14, "Forest" = 22, "Transition" = 30, "Guinea savannah" = 45)[eco_zone] * runif(n(), 0.7, 1.4))
p <- expand_grid(adm2_code = d$adm2_code, month = months) |> left_join(st, by = "adm2_code") |>
  mutate(year = year(month), month_of_year = month(month), season = if_else(month_of_year %in% 4:10, "wet", "dry"),
         population = round(pop0 * if_else(year == 2024, 1.03, 1)),
         rain_mm = pmax(0, 90 + 90 * sin((month_of_year - 3) / 12 * 2 * pi) + rnorm(n(), 0, 25)),
         tmean_c = 27 + 3 * cos((month_of_year - 3) / 12 * 2 * pi) + rnorm(n(), 0, 0.5),
         inc = base * (1 + 0.5 * sin((month_of_year - 5) / 12 * 2 * pi)) * rlnorm(n(), 0, 0.2),
         confirmed = rpois(n(), population * inc / 1000 / 12 * 3), suspected = round(confirmed * 1.8), tested = round(confirmed * 1.4),
         reporting_rate = round(pmin(100, rnorm(n(), 92, 8)), 1), reported = reporting_rate >= 50 & runif(n()) > 0.03,
         flag_outlier = runif(n()) < 0.01, incidence_1000 = confirmed / population * 1000,
         pop_density = population / area_km2, fac_per_10k = n_fac / population * 1e4) |>
  arrange(adm2_code, month) |> group_by(adm2_code) |>
  mutate(rain_lag1 = lag(rain_mm, 1), rain_lag2 = lag(rain_mm, 2), tmean_lag1 = lag(tmean_c, 1), cases_lag1 = lag(confirmed, 1)) |> ungroup() |>
  mutate(split = if_else(month <= ymd("2024-06-01"), "train", "test")) |>
  select(adm2_code, month, suspected, tested, confirmed, reported, reporting_rate, flag_outlier, year, population, rain_mm, tmean_c,
         elev_m, ndvi, area_km2, n_facilities = n_fac, incidence_1000, pop_density, fac_per_10k, rain_lag1, rain_lag2, tmean_lag1,
         cases_lag1, month_of_year, season, split)
saveRDS(p, file.path(out, "panel.rds"))
write_csv(tibble(variable = names(p), meaning = names(p), unit = "", source = "synthetic"), file.path(out, "data_dictionary.csv"))
cat("synthetic data:", nrow(d), "districts,", nrow(p), "panel rows\n")
