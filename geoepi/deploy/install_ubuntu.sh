#!/bin/bash
# Native install on Ubuntu 22.04 / 24.04 (run as root). Docker is the easier route; use this if you can't.
set -euo pipefail
APP=/opt/geoepi; HOME_DIR=/srv/geoepi
SRC="$(cd "$(dirname "$0")/.." && pwd)"

apt-get update
apt-get install -y --no-install-recommends r-base r-base-dev pandoc python3-venv python3-pip curl ca-certificates \
  build-essential gfortran cmake libgdal-dev libgeos-dev libproj-dev libudunits2-dev libsqlite3-dev \
  libssl-dev libcurl4-openssl-dev libxml2-dev libfontconfig1-dev libharfbuzz-dev libfribidi-dev \
  libfreetype6-dev libpng-dev libtiff-dev libjpeg-dev libcairo2-dev libabsl-dev

id geoepi &>/dev/null || useradd -r -m -d "$HOME_DIR" -s /usr/sbin/nologin geoepi
mkdir -p "$APP" "$HOME_DIR"/{data,jobs}
cp -r "$SRC"/app "$SRC"/notebooks "$SRC"/scripts "$SRC"/requirements.txt "$APP"/

python3 -m venv "$APP/venv"
"$APP/venv/bin/pip" install --no-cache-dir -r "$APP/requirements.txt"

# R packages (system-wide). The first install compiles from source and takes 15-40 minutes.
Rscript -e 'options(repos="https://cloud.r-project.org", Ncpus=parallel::detectCores());
  pk <- c("tidyverse","sf","terra","exactextractr","spatstat","spdep","SpatialEpi","gstat","scales",
          "surveillance","patchwork","jsonlite","IRkernel","janitor","readxl","stringdist","fs","lubridate",
          "corrplot","leaflet","htmlwidgets","broom","ranger","pROC");
  install.packages(setdiff(pk, rownames(installed.packages())))'
mkdir -p /usr/local/share/jupyter/kernels/ir
printf '{"argv":["R","--slave","-e","IRkernel::main()","--args","{connection_file}"],"display_name":"R","language":"R"}' > /usr/local/share/jupyter/kernels/ir/kernel.json
"$APP/venv/bin/jupyter" kernelspec list

sh "$APP/scripts/fetch_vendor.sh" "$APP/app/static/vendor"
chown -R geoepi:geoepi "$APP" "$HOME_DIR"

cat > /etc/systemd/system/geoepi.service <<UNIT
[Unit]
Description=Spatial Disease Modeling with R (GHS)
After=network.target

[Service]
User=geoepi
WorkingDirectory=$APP
Environment=PATH=$APP/venv/bin:/usr/local/bin:/usr/bin:/bin
Environment=GEOEPI_HOME=$HOME_DIR JOB_WORKERS=1 JOB_TIMEOUT=3600
ExecStart=$APP/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$HOME_DIR

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now geoepi
echo "Running on 127.0.0.1:8000. Put nginx (with TLS and auth) in front, and copy module1_data/ to $HOME_DIR/data/."
