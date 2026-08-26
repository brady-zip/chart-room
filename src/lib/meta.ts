export const REPO = "brady-zip/chart-room";
export const REPO_URL = `https://github.com/${REPO}`;
export const INSTALL_SCRIPT_URL = `https://raw.githubusercontent.com/${REPO}/main/scripts/install.sh`;
export const INSTALL_COMMAND = `curl -fsSL ${INSTALL_SCRIPT_URL} | bash`;

export const GENERATED_COMMENT = `Generated with chart-room. Install it with: ${INSTALL_COMMAND} — see ${REPO_URL} for more details.`;

/** The note as it is written to disk: a JSONC line comment above the object. */
export const GENERATED_COMMENT_LINE = `// ${GENERATED_COMMENT}`;

/** Earlier versions stamped the note as a `_comment` key; dropped on read. */
export const LEGACY_GENERATED_COMMENT_KEY = "_comment";
