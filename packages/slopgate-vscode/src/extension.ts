import * as path from 'node:path';
// slopgate-ignore-next-line ts/phantom-import -- provided by the VS Code extension host
import * as vscode from 'vscode';
import {
  buildScanArgs,
  isFixableRule,
  runSlopgate,
  toDiagnostic,
  type ScanFinding,
} from './cli.js';

const SUPPORTED = new Set([
  'python',
  'typescript',
  'typescriptreact',
  'javascript',
  'javascriptreact',
  'go',
  'rust',
]);
const COLLECTION = 'slopgate';
let collection: vscode.DiagnosticCollection;
const diagnosticsByUri = new Map<string, vscode.Diagnostic[]>();
let scanEpoch = 0;
const output = vscode.window.createOutputChannel('slopgate');

function configured(): { executable: string; confidence: string; failOn: string } {
  const config = vscode.workspace.getConfiguration('slopgate');
  return {
    executable: config.get<string>('path', 'slopgate') || 'slopgate',
    confidence: config.get<string>('confidence', 'high'),
    failOn: config.get<string>('failOn', 'none'),
  };
}

function workspaceRoot(document?: vscode.TextDocument): string | undefined {
  if (document) {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (folder) return folder.uri.fsPath;
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function severityOf(severity: ScanFinding['severity']): vscode.DiagnosticSeverity {
  if (severity === 'error') return vscode.DiagnosticSeverity.Error;
  if (severity === 'warning') return vscode.DiagnosticSeverity.Warning;
  return vscode.DiagnosticSeverity.Information;
}

function resolveFindingUri(root: string, file: string): vscode.Uri {
  return path.isAbsolute(file) ? vscode.Uri.file(file) : vscode.Uri.file(path.join(root, file));
}

function removeUri(uri: vscode.Uri): void {
  const key = uri.toString();
  if (!diagnosticsByUri.has(key)) return;
  diagnosticsByUri.delete(key);
  collection.delete(uri);
}

function publish(
  root: string,
  findings: readonly ScanFinding[],
  replaceAll: boolean,
  targetFile?: string,
): void {
  if (replaceAll) {
    diagnosticsByUri.clear();
    collection.clear();
  } else if (targetFile) {
    const targetUri = vscode.Uri.file(targetFile).toString();
    diagnosticsByUri.delete(targetUri);
    collection.delete(vscode.Uri.parse(targetUri));
  }

  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const finding of findings) {
    const spec = toDiagnostic(finding);
    const uri = resolveFindingUri(root, finding.file);
    const range = new vscode.Range(
      Math.max(0, spec.line - 1),
      Math.max(0, spec.column - 1),
      Math.max(0, spec.endLine - 1),
      Math.max(0, spec.endColumn - 1),
    );
    const diagnostic = new vscode.Diagnostic(range, spec.message, severityOf(spec.severity));
    diagnostic.source = COLLECTION;
    diagnostic.code = spec.ruleId;
    const key = uri.toString();
    const bucket = byFile.get(key) ?? [];
    bucket.push(diagnostic);
    byFile.set(key, bucket);
  }
  for (const [uri, diagnostics] of byFile) {
    diagnosticsByUri.set(uri, diagnostics);
    collection.set(vscode.Uri.parse(uri), diagnostics);
  }
}

async function scan(
  root: string,
  target: string,
  replaceAll: boolean,
  targetFile?: string,
): Promise<void> {
  const epoch = ++scanEpoch;
  const settings = configured();
  output.appendLine(`scan ${target} (${settings.confidence})`);
  const payload = await runSlopgate(
    settings.executable,
    buildScanArgs(target, settings),
    root,
  );
  if (epoch !== scanEpoch) return;
  // The CLI reports paths relative to the git/report root, which can be above
  // the workspace folder (monorepo) or above a single-file scan.
  publish(payload.reportRoot ?? root, payload.findings, replaceAll, targetFile);
  output.appendLine(`findings: ${payload.findings.length}`);
}

async function scanActiveDocument(document?: vscode.TextDocument): Promise<void> {
  if (!document || document.isUntitled || !SUPPORTED.has(document.languageId)) return;
  const root = workspaceRoot(document) ?? path.dirname(document.uri.fsPath);
  await scan(root, document.uri.fsPath, false, document.uri.fsPath);
}

async function fixActiveDocument(document?: vscode.TextDocument): Promise<void> {
  if (!document || document.isUntitled || !SUPPORTED.has(document.languageId)) return;
  try {
    if (document.isDirty && !(await document.save())) return;
    const root = workspaceRoot(document) ?? path.dirname(document.uri.fsPath);
    const settings = configured();
    const payload = await runSlopgate(
      settings.executable,
      buildScanArgs(document.uri.fsPath, settings, 'fix'),
      root,
    );
    vscode.window.showInformationMessage(
      `slopgate fix completed; ${payload.findings.length} finding(s) remain.`,
    );
    try {
      await scanActiveDocument(document);
    } catch (error) {
      output.appendLine(`refresh after fix failed: ${(error as Error).message}`);
    }
  } catch (error) {
    vscode.window.showWarningMessage(`slopgate fix failed: ${(error as Error).message}`);
  }
}

class SlopgateCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    return context.diagnostics
      .filter(
        (diagnostic) =>
          diagnostic.source === COLLECTION &&
          typeof diagnostic.code === 'string' &&
          isFixableRule(diagnostic.code),
      )
      .map((diagnostic) => {
        const action = new vscode.CodeAction(
          'Fix safe slopgate finding',
          vscode.CodeActionKind.QuickFix,
        );
        action.diagnostics = [diagnostic];
        action.command = {
          command: 'slopgate.fixFile',
          title: 'Fix safe slopgate finding',
          arguments: [document.uri],
        };
        return action;
      });
  }
}

export function activate(context: vscode.ExtensionContext): void {
  collection = vscode.languages.createDiagnosticCollection(COLLECTION);
  context.subscriptions.push(collection, output);

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      void scanActiveDocument(document).catch((error) => output.appendLine(String(error)));
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      void scanActiveDocument(document).catch((error) => output.appendLine(String(error)));
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('slopgate')) {
        void vscode.commands.executeCommand('slopgate.scanWorkspace');
      }
    }),
    vscode.workspace.onDidDeleteFiles((event) => {
      for (const uri of event.files) removeUri(uri);
    }),
    vscode.workspace.onDidRenameFiles((event) => {
      for (const file of event.files) removeUri(file.oldUri);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('slopgate.scanWorkspace', async () => {
      const folders = vscode.workspace.workspaceFolders ?? [];
      if (folders.length === 0) {
        vscode.window.showWarningMessage('slopgate: open a workspace folder first.');
        return;
      }
      // Clear once, then let each folder contribute its own diagnostics.
      diagnosticsByUri.clear();
      collection.clear();
      for (const folder of folders) {
        try {
          await scan(folder.uri.fsPath, folder.uri.fsPath, false);
        } catch (error) {
          vscode.window.showWarningMessage(
            `slopgate scan failed for ${folder.name}: ${(error as Error).message}`,
          );
        }
      }
    }),
    vscode.commands.registerCommand('slopgate.scanFile', async () => {
      try {
        await scanActiveDocument(vscode.window.activeTextEditor?.document);
      } catch (error) {
        vscode.window.showWarningMessage(`slopgate scan failed: ${(error as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('slopgate.fixFile', async (uri?: vscode.Uri) => {
      const document = uri
        ? vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === uri.toString())
        : vscode.window.activeTextEditor?.document;
      await fixActiveDocument(document);
    }),
  );

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      [
        { language: 'python' },
        { language: 'typescript' },
        { language: 'typescriptreact' },
        { language: 'javascript' },
        { language: 'javascriptreact' },
        { language: 'go' },
        { language: 'rust' },
      ],
      new SlopgateCodeActionProvider(),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );

  void scanActiveDocument(vscode.window.activeTextEditor?.document).catch((error) =>
    output.appendLine(String(error)),
  );
}

export function deactivate(): void {
  collection?.dispose();
  output.dispose();
}
