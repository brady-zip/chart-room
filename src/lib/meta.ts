export const REPO = "brady-zip/chart-room";
export const REPO_URL = `https://github.com/${REPO}`;
export const INSTALL_SCRIPT_URL = `https://raw.githubusercontent.com/${REPO}/main/scripts/install.sh`;
export const INSTALL_COMMAND = `curl -fsSL ${INSTALL_SCRIPT_URL} | bash`;

export const GENERATED_COMMENT = `Generated with chart-room. Install it with: ${INSTALL_COMMAND} — see ${REPO_URL} for more details.`;

/** The note as it is written to disk: a JSONC line comment above the object. */
export const GENERATED_COMMENT_LINE = `// ${GENERATED_COMMENT}`;

/** Earlier versions stamped the note as a `_comment` key; dropped on read. */
export const LEGACY_GENERATED_COMMENT_KEY = "_comment";

/** File name the bundled schema is written under, in the config dir. */
export const SCHEMA_FILENAME = "datadog-dashboard.schema.json";

/**
 * Canonical `$schema` value stamped into every config chart-room writes. The
 * repo is public, so editors resolve this without any local setup; the copy in
 * the config dir is for offline use and for `ajv` in pre-commit hooks.
 */
export const SCHEMA_URL = `https://raw.githubusercontent.com/${REPO}/main/schema/${SCHEMA_FILENAME}`;

/**
 * Note written above the `$schema` line. Committed alongside the config, so it
 * spells the local copy as `~/...` rather than a machine-specific path.
 */
export const SCHEMA_COMMENT_LINES = [
  `// $schema resolves over the network — no local setup needed. Offline, or for`,
  `// validators like \`ajv\`, any chart-room run drops a copy at`,
  `// ~/.config/chart-room/${SCHEMA_FILENAME}`,
];
