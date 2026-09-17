"""Generate contract v1 from the exact OpenAPI input used by Evergreen."""
import copy
import hashlib
import json
import subprocess
from pathlib import Path
from urllib.request import urlopen

VERSION = "v1.3.1"
SHA256 = "12a9bc485e8bcd3d09c2a7cff646e0cd2c2090eb83899c860d31829d426e5a94"
ROOT = Path(__file__).resolve().parents[1]
URL = f"https://raw.githubusercontent.com/exploreomni/cli/{VERSION}/api/openapi.json"
with urlopen(URL, timeout=60) as response:
    raw = response.read()
if hashlib.sha256(raw).hexdigest() != SHA256:
    raise ValueError("Pinned OpenAPI checksum changed; review with Evergreen before upgrading")
schemas = json.loads(raw)["components"]["schemas"]
used = {}

def visit(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "$ref":
                if not item.startswith("#/components/schemas/"):
                    raise ValueError(f"Unsupported reference: {item}")
                name = item.rsplit("/", 1)[-1]
                if name not in used:
                    used[name] = copy.deepcopy(schemas[name])
                    visit(used[name])
            else:
                visit(item)
    elif isinstance(value, list):
        for item in value:
            visit(item)

visit({"$ref": "#/components/schemas/DocumentsV2PatchDraftBody"})
fields = ["name", "description", "modelId", "queryPresentations", "controls", "settings", "containers"]
document = copy.deepcopy(used["DocumentsV2PatchDraftBody"])
document["properties"] = {key: document["properties"][key] for key in fields}
document["required"] = fields
document["properties"]["containers"]["minItems"] = 1
for name in ["QueryPresentationsPatchExternal", "ControlsPatchExternal"]:
    used[name]["required"] = ["data", "order"]
    used[name]["additionalProperties"] = False
used["QueryPresentationsPatchExternal"]["properties"]["data"]["propertyNames"] = {"pattern": "^[1-9][0-9]*$"}
used["QueryPresentationsPatchExternal"]["properties"]["data"]["minProperties"] = 1
tile = used["QueryPresentationPatchExternal"]
tile["type"] = "object"
tile["properties"]["type"]["enum"] = ["blank", "query", "sql", "linked"]
for key in ["editingModelObjectName", "editingModelObjectNameChange", "fileUploadId", "foreignModelId"]:
    tile["properties"][key] = False
for key in ["branch_id", "model_extension_id"]:
    tile["properties"]["query"]["properties"][key] = False
used["ControlPatchExternal"]["type"] = "object"
used["SettingsPatchExternal"]["required"] = list(used["SettingsPatchExternal"]["properties"])
used["SettingsPatchExternal"]["additionalProperties"] = False
identifier = {"type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]*$"}
schema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://raw.githubusercontent.com/brady-zip/chart-room/v1.10.0/schema/omni-dashboard.schema.json",
    "$comment": f"Generated from exploreomni/cli {VERSION} api/openapi.json; SHA256 {SHA256}; MIT license in LICENSE.omni. Contract v1 matches Evergreen; ordering/key equality is additionally validated by the CLI.",
    "type": "object",
    "additionalProperties": False,
    "required": ["version", "provider", "instance", "targets", "_meta", "document"],
    "properties": {
        "$schema": {"type": "string"},
        "version": {"const": 1, "type": "integer"},
        "provider": {"const": "omni"},
        "instance": {"const": "https://zip.omniapp.co"},
        "targets": {"type": "object", "additionalProperties": False, "required": ["prod", "test"], "properties": {"prod": identifier, "test": identifier}},
        "_meta": {"type": "object", "required": ["intent", "audience", "scope"], "properties": {name: {"type": "string", "pattern": "\\S"} for name in ["intent", "audience", "scope"]}},
        "document": document,
    },
    "components": {"schemas": used},
}
(ROOT / "schema/omni-dashboard.schema.json").write_text(json.dumps(schema, indent=2) + "\n")
# Responses keep the upstream schemas intact, separate from the narrower content contract.
used = {}
for name in ["DocumentsV2ReadResponse", "DocumentsV2CreateResponse", "DocumentsV2PatchDraftResponse", "DocumentsV2PublishDraftResponse", "DocumentsListDraftsResponse", "DocumentsGetPermissionsResponse", "ModelsListResponse", "ModelsListTopicsResponse", "ModelsGetTopicResponse", "FoldersListResponse", "FoldersGetPermissionsResponse", "DocumentsListResponse", "WhoamiResponse", "QueryStreamJobLine", "QueryStreamFooterLine", "QueryStreamJobsSubmittedLine"]:
    visit({"$ref": f"#/components/schemas/{name}"})
(ROOT / "schema/omni-api.schema.json").write_text(json.dumps({"$schema": schema["$schema"], "$id": "urn:chart-room:omni-api:1.3.1", "$comment": schema["$comment"], "components": {"schemas": used}}, indent=2) + "\n")
with urlopen(f"https://raw.githubusercontent.com/exploreomni/cli/{VERSION}/LICENSE", timeout=60) as response:
    (ROOT / "schema/LICENSE.omni").write_bytes(response.read())
subprocess.run([
    str(ROOT / "node_modules/.bin/prettier"), "--write",
    str(ROOT / "schema/omni-dashboard.schema.json"),
    str(ROOT / "schema/omni-api.schema.json"),
], check=True)
print(f"Generated Omni contract v1 and API schemas from {VERSION}, SHA256 {SHA256}")
