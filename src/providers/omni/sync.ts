import { ChartRoomError, asError, object } from "../../lib/errors.js";
import {
  identifier,
  matchesDocument,
  patchBatches,
  drift,
  type OmniDocument,
} from "./definition.js";
import type { OmniClient } from "./client.js";

export function reconcile(
  client: OmniClient,
  target: string,
  desired: OmniDocument,
  apply: boolean,
) {
  const current = client.read(target);
  if (client.mainDrafts(target).length)
    throw new ChartRoomError(
      "DRAFT_CONFLICT",
      "An existing main draft needs human reconciliation; no draft was modified",
      { target },
    );
  const batches = patchBatches(desired, current);
  const differences = drift(current, desired);
  if (matchesDocument(current, desired))
    return {
      outcome: "UNCHANGED",
      verified: true,
      differences: [],
      batches: [],
    };
  if (client.publicationPolicy(target).requiresPullRequest)
    throw new ChartRoomError(
      "PR_REQUIRED",
      "This target requires an Omni pull request; use its native branch workflow without changing the policy",
      { target },
    );
  if (!apply)
    return { outcome: "WOULD_UPDATE", verified: false, differences, batches };
  let draft: string | undefined;
  try {
    const created = object(
      client.documents("v2-patch-draft", [target], {}, true),
      "create draft",
    );
    draft = identifier(created.draftIdentifier);
    for (const body of batches)
      client.documents(
        "v2-patch-draft-by-identifier",
        [target, draft],
        body,
        true,
      );
    if (!matchesDocument(client.read(target, draft), desired))
      throw new ChartRoomError(
        "VERIFICATION_FAILED",
        "Draft readback differs from requested content",
      );
    const drafts = client.mainDrafts(target);
    if (
      drafts.length !== 1 ||
      drafts[0]!.identifier !== draft ||
      drafts[0]!.draftOutOfDate !== false
    )
      throw new ChartRoomError(
        "DRAFT_CONFLICT",
        "Draft changed or became stale before publication",
      );
    client.documents("v2-publish-draft", [target], undefined, true);
    if (!matchesDocument(client.read(target), desired))
      throw new ChartRoomError(
        "VERIFICATION_FAILED",
        "Published readback differs from requested content",
      );
  } catch (error) {
    const failure = asError(error);
    throw new ChartRoomError(
      failure.code,
      `${failure.message}. Deployment did not verify; inspect document ${target}${draft ? `, draft ${draft}` : " and its main drafts"}. No automatic discard or retry.`,
      { ...failure.details, target, ...(draft ? { draft } : {}) },
    );
  }
  return { outcome: "UPDATED", verified: true, differences, batches };
}
