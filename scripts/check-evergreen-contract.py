"""Refresh/verify golden payloads against the independent Evergreen implementation.

uv run --with jsonschema==4.23.0 --no-project python scripts/check-evergreen-contract.py ROOT [--update]
"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
sys.path[:0] = [str(root), str(root / "website")]
module_path = root / "bin/ci/omni_dashboards/definition.py"
spec = importlib.util.spec_from_file_location("evergreen_definition", module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
fixtures = Path(__file__).resolve().parents[1] / "tests/fixtures"
definition = json.loads((fixtures / "definition.json").read_text())
module.validate_definition(definition)
desired = copy.deepcopy(definition["document"])
desired["queryPresentations"] = {"data": {str(i): {"type": "blank", "name": f"Tile {i}"} for i in range(1, 100)}, "order": [str(i) for i in range(1, 100)]}
desired["settings"]["customText"] = {"queryNoResults": "No matching pilot rows"}
current = copy.deepcopy(definition["document"])
current["queryPresentations"] = {"data": {str(i): {"type": "blank"} for i in range(200, 299)}, "order": [str(i) for i in range(200, 299)]}
current["controls"] = {"data": {"old": {"config": {"type": "string", "kind": "EQUALS", "values": ["before"]}}}, "order": ["old"]}
patches = module.patch_batches(desired, current)
upserts, deletes, metadata = {}, [], []
for patch in patches[:-1]:
    if "queryPresentations" in patch:
        for key, value in patch["queryPresentations"]["data"].items():
            if value is None:
                deletes.append(key)
            else:
                upserts[key] = value
    else:
        metadata.append(patch)
result = {
    "upstreamDefinitionSha256": hashlib.sha256(module_path.read_bytes()).hexdigest(),
    "source": {"path": "docs/pilot file.omni.jsonc", "sha": "a" * 40, "repo": "Greenbax/evergreen"},
    "definition": definition,
    "desired": desired,
    "current": current,
    "test": module.desired_document(definition, "docs/pilot file.omni.jsonc", "a" * 40, "Greenbax/evergreen", "test"),
    "prod": module.desired_document(definition, "docs/pilot file.omni.jsonc", "a" * 40, "Greenbax/evergreen", "prod"),
    "normalized": {"upserts": upserts, "metadata": metadata, "deletes": sorted(deletes), "order": patches[-1]},
    "batchSizes": [len(p["queryPresentations"]["data"]) for p in patches if "queryPresentations" in p and "data" in p["queryPresentations"]],
}
destination = fixtures / "evergreen-contract.json"
if "--update" in sys.argv:
    destination.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
else:
    assert json.loads(destination.read_text()) == result, "Evergreen fixture drift; review contract before updating"
print("Evergreen definition accepted; provenance and normalized 99-upsert/99-delete payloads match")
