import { isSourceWidget, isSourceWidgetDeep } from "./dashboard.js";
export function diffDashboards(local, remote) {
    const diffs = [];
    if (local.title !== remote.title) {
        diffs.push(`title: "${local.title}" (local) vs "${remote.title}" (remote)`);
    }
    if (local.description !== remote.description) {
        diffs.push(`description: "${local.description}" (local) vs "${remote.description}" (remote)`);
    }
    if (local.layout_type !== remote.layout_type) {
        diffs.push(`layout_type: "${local.layout_type}" (local) vs "${remote.layout_type}" (remote)`);
    }
    const remoteWidgets = (remote.widgets ?? []).filter((w) => !isSourceWidget(w) && !isSourceWidgetDeep(w));
    const localWidgets = local.widgets ?? [];
    if (localWidgets.length !== remoteWidgets.length) {
        diffs.push(`widget count: ${localWidgets.length} (local) vs ${remoteWidgets.length} (remote)`);
    }
    const maxLen = Math.max(localWidgets.length, remoteWidgets.length);
    for (let i = 0; i < maxLen; i++) {
        const localW = localWidgets[i];
        const remoteW = remoteWidgets[i];
        const localTitle = localW?.definition?.title;
        const remoteTitle = remoteW?.definition?.title;
        if (!localW && remoteW) {
            diffs.push(`widget[${i}]: "${remoteTitle ?? "(untitled)"}" exists in remote only`);
        }
        else if (localW && !remoteW) {
            diffs.push(`widget[${i}]: "${localTitle ?? "(untitled)"}" exists in local only`);
        }
        else if (localTitle !== remoteTitle) {
            diffs.push(`widget[${i}] title: "${localTitle}" (local) vs "${remoteTitle}" (remote)`);
        }
    }
    return diffs;
}
