/**
 * Agpiko Workspace — zone map + integrity audit.
 * Explorer: ThemeIcon badge on the right of zone folders (keeps your file icon theme).
 */
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const LAYOUT_FILE = "agpiko.workspace.json";
const ORIGIN_FOLDER_NAMES = new Set(["core.agpiko.com"]);

/** @type {Map<string, { layout: any, root: string, file: string, isOrigin: boolean }>} */
let layoutsByRoot = new Map();

/** @type {vscode.DiagnosticCollection} */
let diagnostics;

/** @type {vscode.DiagnosticCollection} */
let integrityDiagnostics;

/** @type {vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>} */
let decorationEmitter;

function isOriginFolder(folderPath) {
  return ORIGIN_FOLDER_NAMES.has(path.basename(folderPath).toLowerCase());
}

function loadAllLayouts() {
  const map = new Map();
  for (const folder of vscode.workspace.workspaceFolders || []) {
    const file = path.join(folder.uri.fsPath, LAYOUT_FILE);
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!parsed || !Array.isArray(parsed.zones)) continue;
      const root = folder.uri.fsPath;
      map.set(root, {
        layout: parsed,
        root,
        file,
        isOrigin: isOriginFolder(root),
      });
    } catch (err) {
      console.error("[agpiko-workspace] Failed to parse", file, err);
    }
  }
  return map;
}

function contextForUri(uri) {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) return null;
  return layoutsByRoot.get(folder.uri.fsPath) || null;
}

function matchZone(relPath, zones) {
  const norm = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  let best = null;
  for (const zone of zones) {
    const z = String(zone.path || "")
      .replace(/\\/g, "/")
      .replace(/\/$/, "");
    if (!z) continue;
    if (norm === z || norm.startsWith(`${z}/`)) {
      if (!best || z.length > String(best.path).length) best = zone;
    }
  }
  return best;
}

function exactZone(relPath, zones) {
  const norm = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  for (const zone of zones) {
    const z = String(zone.path || "")
      .replace(/\\/g, "/")
      .replace(/\/$/, "");
    if (z && norm === z) return zone;
  }
  return null;
}

function relativeToRoot(uri, root) {
  const rel = path.relative(root, uri.fsPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.replace(/\\/g, "/");
}

function shouldEnforceClientRules(ctx) {
  return Boolean(ctx && !ctx.isOrigin);
}

function zoneMessage(zone, rel, lang) {
  const label =
    (zone.label && (zone.label[lang] || zone.label.es || zone.label.en)) ||
    zone.path;
  if (lang === "en") {
    return `Agpiko: «${rel}» is product (${label}). On client installs prefer site/. Updates replace this path.`;
  }
  return `Agpiko: «${rel}» es producto (${label}). En clientes preferí site/. Las actualizaciones reemplazan esta ruta.`;
}

function refreshDocumentDiagnostics(doc) {
  if (!diagnostics || !doc || doc.uri.scheme !== "file") return;
  const ctx = contextForUri(doc.uri);
  if (!ctx || !shouldEnforceClientRules(ctx)) {
    diagnostics.delete(doc.uri);
    return;
  }
  const rel = relativeToRoot(doc.uri, ctx.root);
  if (!rel) {
    diagnostics.delete(doc.uri);
    return;
  }
  const zone = matchZone(rel, ctx.layout.zones);
  if (!zone || zone.clientEdit !== false) {
    diagnostics.delete(doc.uri);
    return;
  }

  const lang =
    vscode.env.language && vscode.env.language.startsWith("es") ? "es" : "en";
  const range =
    doc.lineCount > 0 ? doc.lineAt(0).range : new vscode.Range(0, 0, 0, 0);
  const d = new vscode.Diagnostic(
    range,
    zoneMessage(zone, rel, lang),
    vscode.DiagnosticSeverity.Information,
  );
  d.source = "agpiko";
  d.code = "zone-hint";
  diagnostics.set(doc.uri, [d]);
}

function refreshOpenEditors() {
  for (const doc of vscode.workspace.textDocuments) {
    refreshDocumentDiagnostics(doc);
  }
}

function labelForRoot(root) {
  return path.basename(root);
}

function integrityRoots() {
  const roots = [];
  for (const folder of vscode.workspace.workspaceFolders || []) {
    const root = folder.uri.fsPath;
    if (!layoutsByRoot.has(root)) continue;
    const script = path.join(root, "scripts", "core", "integrity-audit.ts");
    if (!fs.existsSync(script)) continue;
    roots.push(root);
  }
  return roots;
}

async function pickIntegrityRoot() {
  const roots = integrityRoots();
  if (!roots.length) {
    vscode.window.showErrorMessage(
      "No hay un install Agpiko en este workspace (falta scripts/core/integrity-audit.ts).",
    );
    return null;
  }

  const editor = vscode.window.activeTextEditor;
  let preferred = null;
  if (editor) {
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (folder && roots.includes(folder.uri.fsPath)) {
      preferred = folder.uri.fsPath;
    }
  }

  if (roots.length === 1) return roots[0];

  const picks = roots.map((root) => ({
    label: labelForRoot(root),
    description: preferred === root ? "archivo activo" : "",
    detail: root,
    root,
  }));
  if (preferred) {
    picks.sort((a, b) =>
      a.root === preferred ? -1 : b.root === preferred ? 1 : 0,
    );
  }
  const chosen = await vscode.window.showQuickPick(picks, {
    title: "Agpiko: ¿qué install auditar?",
    placeHolder: "Elige la carpeta del workspace",
  });
  return chosen ? chosen.root : null;
}

function parseIntegrityJson(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{") && l.endsWith("}"));
  const last = lines[lines.length - 1];
  if (!last) return null;
  try {
    return JSON.parse(last);
  } catch {
    return null;
  }
}

function applyIntegrityProblems(root, result) {
  if (!integrityDiagnostics) return;
  integrityDiagnostics.clear();
  const diffs = Array.isArray(result && result.diffs) ? result.diffs : [];
  const lang =
    vscode.env.language && vscode.env.language.startsWith("es") ? "es" : "en";
  const byFile = new Map();
  for (const diff of diffs) {
    const rel = String(diff.path || "").replace(/\\/g, "/");
    if (!rel) continue;
    const uri = vscode.Uri.file(path.join(root, rel));
    const key = uri.toString();
    const kind = diff.kind || "modified";
    const msg =
      lang === "en"
        ? `Agpiko integrity: ${kind} vs signed package (${rel})`
        : `Agpiko integridad: ${kind} vs paquete firmado (${rel})`;
    const d = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 0),
      msg,
      vscode.DiagnosticSeverity.Warning,
    );
    d.source = "agpiko";
    d.code = `integrity-${kind}`;
    const entry = byFile.get(key) || { uri, items: [] };
    entry.items.push(d);
    byFile.set(key, entry);
  }
  for (const entry of byFile.values()) {
    integrityDiagnostics.set(entry.uri, entry.items);
  }
}

async function runIntegrityAudit() {
  const root = await pickIntegrityRoot();
  if (!root) return;

  const siteLabel = labelForRoot(root);
  const script = path.join(root, "scripts", "core", "integrity-audit.ts");
  const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  if (!fs.existsSync(tsxCli)) {
    vscode.window.showErrorMessage(
      `${siteLabel}: falta tsx (npm install) en esta carpeta.`,
    );
    return;
  }

  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Agpiko: integridad → ${siteLabel}`,
    },
    () =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [tsxCli, script, "--json"], {
          cwd: root,
          windowsHide: true,
        });
        let out = "";
        let err = "";
        child.stdout.on("data", (chunk) => {
          out += chunk;
        });
        child.stderr.on("data", (chunk) => {
          err += chunk;
        });
        child.on("error", (error) => {
          vscode.window.showErrorMessage(
            `${siteLabel}: integridad falló (${error.message})`,
          );
          resolve();
        });
        child.on("close", () => {
          const result = parseIntegrityJson(out);
          if (!result) {
            vscode.window.showErrorMessage(
              `${siteLabel}: ${err.trim() || "sin resultado de integridad."}`,
            );
            resolve();
            return;
          }
          applyIntegrityProblems(root, result);
          const detail = result.message
            ? result.message.es || result.message.en
            : "";
          const summary = `${siteLabel} · ${detail || "listo"}`;
          if (!result.ok) {
            vscode.window.showErrorMessage(summary);
          } else if (result.clean) {
            vscode.window.showInformationMessage(summary);
          } else {
            vscode.window.showWarningMessage(summary);
          }
          resolve();
        });
      }),
  );
}

/**
 * Right-side explorer badge for zone roots only. Does not replace file icons.
 * @param {vscode.Uri} uri
 * @returns {vscode.FileDecoration | undefined}
 */
function decorationForUri(uri) {
  if (!uri || uri.scheme !== "file") return undefined;
  const ctx = contextForUri(uri);
  if (!ctx) return undefined;
  const rel = relativeToRoot(uri, ctx.root);
  if (!rel) return undefined;
  const zone = exactZone(rel, ctx.layout.zones);
  if (!zone || zone.clientEdit === true) return undefined;

  const lang =
    vscode.env.language && vscode.env.language.startsWith("es") ? "es" : "en";
  const label =
    (zone.label && (zone.label[lang] || zone.label.es || zone.label.en)) ||
    zone.path;
  const hint =
    (zone.hint && (zone.hint[lang] || zone.hint.es || zone.hint.en)) || "";

  /** @type {vscode.ThemeIcon} */
  let icon;
  if (zone.clientEdit === "merge") {
    icon = new vscode.ThemeIcon("git-merge");
  } else if (zone.role === "runtime" || zone.role === "origin-docs") {
    icon = new vscode.ThemeIcon("gear");
  } else {
    icon = new vscode.ThemeIcon("lock");
  }

  return new vscode.FileDecoration(icon, hint || label);
}

function createZoneDecorationProvider() {
  decorationEmitter = new vscode.EventEmitter();
  return {
    onDidChangeFileDecorations: decorationEmitter.event,
    provideFileDecoration(uri) {
      return decorationForUri(uri);
    },
  };
}

function activate(context) {
  layoutsByRoot = loadAllLayouts();
  diagnostics = vscode.languages.createDiagnosticCollection("agpiko");
  integrityDiagnostics = vscode.languages.createDiagnosticCollection(
    "agpiko-integrity",
  );
  context.subscriptions.push(diagnostics, integrityDiagnostics);

  const decorationProvider = createZoneDecorationProvider();
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(decorationProvider),
    decorationEmitter,
  );

  const reload = () => {
    layoutsByRoot = loadAllLayouts();
    refreshOpenEditors();
    if (decorationEmitter) decorationEmitter.fire(undefined);
    vscode.window.setStatusBarMessage(
      layoutsByRoot.size
        ? `Agpiko zones loaded (${layoutsByRoot.size})`
        : "Agpiko: no workspace json",
      3000,
    );
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("agpiko.workspace.reload", reload),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("agpiko.workspace.showZone", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("Open a file first.");
        return;
      }
      const ctx = contextForUri(editor.document.uri);
      if (!ctx) {
        vscode.window.showInformationMessage(
          "No agpiko.workspace.json for this folder.",
        );
        return;
      }
      const rel = relativeToRoot(editor.document.uri, ctx.root);
      if (!rel) return;
      const zone = matchZone(rel, ctx.layout.zones);
      if (!zone) {
        vscode.window.showInformationMessage(`No zone for: ${rel}`);
        return;
      }
      const label =
        (zone.label && (zone.label.es || zone.label.en)) || zone.path;
      vscode.window.showInformationMessage(
        `${label} · clientEdit=${JSON.stringify(zone.clientEdit)} · apply=${zone.apply} · ${ctx.isOrigin ? "origin" : "client"}`,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("agpiko.integrity.verify", runIntegrityAudit),
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refreshDocumentDiagnostics),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) =>
      refreshDocumentDiagnostics(e.document),
    ),
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      if (ed) refreshDocumentDiagnostics(ed.document);
    }),
  );

  const watcher = vscode.workspace.createFileSystemWatcher(
    `**/${LAYOUT_FILE}`,
  );
  watcher.onDidChange(reload);
  watcher.onDidCreate(reload);
  watcher.onDidDelete(reload);
  context.subscriptions.push(watcher);

  refreshOpenEditors();
  if (decorationEmitter) decorationEmitter.fire(undefined);
}

function deactivate() {
  if (diagnostics) diagnostics.clear();
  if (integrityDiagnostics) integrityDiagnostics.clear();
}

module.exports = { activate, deactivate };
