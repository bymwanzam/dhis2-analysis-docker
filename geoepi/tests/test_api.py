import io, os, sys, tempfile, time, zipfile
import csv, json
from pathlib import Path
T = Path(tempfile.mkdtemp())
os.environ.update(GEOEPI_HOME=str(T), GEOEPI_NOTEBOOKS=str(Path(__file__).parent / "notebooks"), JOB_TIMEOUT="120")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from fastapi.testclient import TestClient
from app.main import app

def zbytes(files):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        for k, v in files.items(): z.writestr(k, v)
    return b.getvalue()

def wait(c, jid):
    for _ in range(90):
        j = c.get(f"/api/jobs/{jid}").json()
        if j["status"] in ("done", "failed"): return j
        time.sleep(1)
    raise AssertionError("timeout")

with TestClient(app) as c:
    assert {n["id"] for n in c.get("/api/notebooks").json()} == {"demo", "broken"}
    # upload (single top-level folder is flattened)
    r = c.post("/api/datasets", data={"name": "ds1"}, files={"file": ("a.zip", zbytes({"top/pts.csv": "x,y,v\n-1,10,3\n-1.2,10.5,5\n"}), "application/zip")})
    assert r.status_code == 200, r.text
    assert (T / "data/ds1/pts.csv").exists()
    # zip-slip, bad name, duplicate, non-zip
    assert c.post("/api/datasets", data={"name": "evil"}, files={"file": ("a.zip", zbytes({"../../escape.txt": "x"}), "application/zip")}).status_code == 400
    assert not (T / "escape.txt").exists() and not (T.parent / "escape.txt").exists()
    assert c.post("/api/datasets", data={"name": "../x"}, files={"file": ("a.zip", zbytes({"a": "b"}), "application/zip")}).status_code == 400
    assert c.post("/api/datasets", data={"name": "ds1"}, files={"file": ("a.zip", zbytes({"a": "b"}), "application/zip")}).status_code == 409
    assert c.post("/api/datasets", data={"name": "n"}, files={"file": ("a.txt", b"x", "text/plain")}).status_code == 400
    assert [d["id"] for d in c.get("/api/datasets").json()] == ["ds1"]   # no leftover staging dirs
    # Upload individual module inputs and preserve their requested dataset paths.
    uploaded = c.post(
        "/api/datasets/files",
        data={"name": "files_ds", "notebook": "demo", "paths": "pts.csv"},
        files={"files": ("points.csv", "x,y,v\n-1,10,3\n", "text/csv")},
    )
    assert uploaded.status_code == 200, uploaded.text
    assert (T / "data/files_ds/pts.csv").exists()
    assert c.post(
        "/api/datasets/files",
        data={"name": "missing_ds", "notebook": "demo", "paths": "other.csv"},
        files={"files": ("other.csv", "x\n1\n", "text/csv")},
    ).status_code == 422
    assert c.post(
        "/api/datasets/files",
        data={"name": "unsafe_ds", "notebook": "demo", "paths": "../escape.csv"},
        files={"files": ("escape.csv", "x\n1\n", "text/csv")},
    ).status_code == 400
    assert not (T / "escape.csv").exists()
    # DHIS2 map hand-off preserves the shapes, metadata and tabular values
    dhis2_map = {
        "type": "FeatureCollection",
        "name": "Malaria cases",
        "metadata": {
            "name": "Malaria cases",
            "dataItemId": "DX1",
            "dataItem": "=unsafe name",
            "periods": ["202601"],
            "periodLabel": "January 2026",
        },
        "features": [{
            "type": "Feature",
            "id": "OU1",
            "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]},
            "properties": {
                "id": "OU1",
                "name": "Area 1",
                "level": 2,
                "parentName": "Ghana",
                "hierarchy": "Ghana > Area 1",
                "value": 12,
            },
        }],
    }
    handoff = c.post("/api/datasets/dhis2-map", json=dhis2_map)
    assert handoff.status_code == 200, handoff.text
    handoff_id = handoff.json()["id"]
    handoff_dir = T / "data" / handoff_id
    assert json.loads((handoff_dir / "dhis2-map.geojson").read_text())["features"][0]["geometry"]["type"] == "Polygon"
    with (handoff_dir / "dhis2-map.csv").open(encoding="utf-8-sig", newline="") as file:
        exported = next(csv.DictReader(file))
    assert exported["org_unit_id"] == "OU1" and exported["value"] == "12"
    assert exported["data_item"] == "'=unsafe name"
    assert json.loads((handoff_dir / "metadata.json").read_text())["dataItemId"] == "DX1"
    assert c.post("/api/datasets/dhis2-map", json={**dhis2_map, "features": []}).status_code == 422
    # successful run
    j = c.post("/api/jobs", json={"notebook": "demo", "dataset": "ds1"}).json()
    j = wait(c, j["id"]); assert j["status"] == "done", j
    names = {f["name"] for f in j["files"]}; assert {"layers.json", "p.geojson", "h.heat.json", "report.html"} <= names, names
    assert c.get(f"/results/{j['id']}/layers.json").json()["layers"][0]["id"] == "p"
    assert c.get(f"/api/jobs/{j['id']}/download.zip").status_code == 200
    assert "ok 2" in c.get(f"/api/jobs/{j['id']}/log").text
    # dataset compatibility + chaining
    c.post("/api/datasets", data={"name": "empty"}, files={"file": ("a.zip", zbytes({"other.txt": "x"}), "application/zip")})
    ds = {d["id"]: d for d in c.get("/api/datasets?notebook=demo").json()}
    assert ds["ds1"]["missing"] == [] and ds["empty"]["missing"] == ["pts.csv"], ds
    assert c.post("/api/jobs", json={"notebook": "demo", "dataset": "empty"}).status_code == 422
    assert c.post("/api/datasets/from-job", json={"job_id": j["id"], "name": "next"}).status_code == 200
    assert (T / "data/next/panel.rds").exists()
    assert c.post("/api/datasets/from-job", json={"job_id": j["id"], "name": "next"}).status_code == 409
    nbs = {n["id"]: n for n in c.get("/api/notebooks").json()}; assert nbs["demo"]["handoff"] and nbs["demo"]["requires"] == ["pts.csv"]
    # preparation and modelling are listed apart; a module without a stage counts as analysis
    assert nbs["demo"]["stage"] == "preparation" and nbs["demo"]["next"] == ["broken"], nbs["demo"]
    assert nbs["broken"]["stage"] == "analysis" and nbs["broken"]["next"] == [], nbs["broken"]
    assert nbs["demo"]["track"] is None                              # no track: listed on the GeoEpi page
    # traversal / unknown
    assert c.get(f"/results/{j['id']}/../job.json").status_code in (400, 404)
    assert c.get(f"/results/{j['id']}/%2e%2e/job.json").status_code == 404
    assert c.post("/api/jobs", json={"notebook": "nope", "dataset": "ds1"}).status_code == 404
    # failing notebook still yields a report and a clear status
    jb = wait(c, c.post("/api/jobs", json={"notebook": "broken", "dataset": "ds1"}).json()["id"])
    assert jb["status"] == "failed" and any(f["name"] == "report.html" for f in jb["files"]), jb
    # deleting a run removes it and its outputs; a dataset made from it stays
    assert c.delete(f"/api/jobs/{j['id']}").status_code == 200
    assert c.get(f"/api/jobs/{j['id']}").status_code == 404 and not (T / "jobs" / j["id"]).exists()
    assert j["id"] not in {x["id"] for x in c.get("/api/jobs").json()}
    assert (T / "data/next/panel.rds").exists()
    assert c.delete(f"/api/jobs/{j['id']}").status_code == 404
    assert c.delete("/api/jobs/..").status_code in (400, 404, 405)
    # a run that has not finished cannot be deleted
    q = T / "jobs" / "queued1"; q.mkdir()
    (q / "job.json").write_text(json.dumps({"id": "queued1", "notebook": "demo", "dataset": "ds1", "status": "running", "created": 0, "error": None}))
    assert c.delete("/api/jobs/queued1").status_code == 409 and q.exists()
    assert c.get("/").status_code == 200
print("ALL TESTS PASSED")
