# R + geospatial stack + Python runner in one image
FROM rocker/geospatial:4.4.2

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3-venv python3-pip curl ca-certificates pandoc \
    && rm -rf /var/lib/apt/lists/*

# Analysis packages are installed ONCE at build time (the notebook no longer installs anything)
RUN install2.r --error --skipinstalled -n 2 \
      exactextractr spatstat spdep SpatialEpi gstat scales surveillance patchwork jsonlite IRkernel \
      janitor readxl stringdist fs lubridate corrplot leaflet htmlwidgets broom ranger pROC \
    && rm -rf /tmp/downloaded_packages

# Python side: FastAPI + papermill + nbconvert in a venv
COPY requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt
ENV PATH=/opt/venv/bin:$PATH
# register the R kernel under the name "ir" system-wide
# (written by hand: IRkernel::installspec() cannot find `jupyter` from inside Rscript during the build)
RUN mkdir -p /usr/local/share/jupyter/kernels/ir \
 && printf '{"argv":["R","--slave","-e","IRkernel::main()","--args","{connection_file}"],"display_name":"R","language":"R"}' \
    > /usr/local/share/jupyter/kernels/ir/kernel.json \
 && /opt/venv/bin/jupyter kernelspec list

WORKDIR /opt/geoepi
COPY app ./app
COPY notebooks ./notebooks
COPY scripts ./scripts
RUN sh scripts/fetch_vendor.sh app/static/vendor

RUN useradd -m -u 1001 geoepi && mkdir -p /data /srv/jobs && chown -R geoepi /data /srv/jobs
USER geoepi
ENV GEOEPI_DATA=/data GEOEPI_JOBS=/srv/jobs JOB_WORKERS=1
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
