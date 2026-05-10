// Main extension file
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LogoRuntime, DrawCommand } from './logoDebugger';
import { LogoCompletionProvider } from './completionProvider';
import { analyzeSource } from './diagnostics';
import { formatLogoDocument } from './formatter';

let graphicsPanel: vscode.WebviewPanel | undefined;
let previewPanel: vscode.WebviewPanel | undefined;
let previewSourceUri: vscode.Uri | undefined;
let diagnosticsCollection: vscode.DiagnosticCollection | undefined;

// Shared LOGO output channel (appears next to Debug Console)
let logoOutputChannel: vscode.OutputChannel | undefined;

function getLogoOutputChannel(): vscode.OutputChannel {
  if (!logoOutputChannel) {
    logoOutputChannel = vscode.window.createOutputChannel('LOGO');
  }
  logoOutputChannel.show(true);
  return logoOutputChannel;
}

export function activate(context: vscode.ExtensionContext) {
  console.log('Logo Debugger extension is now active');

  // Register completion provider
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    'logo',
    new LogoCompletionProvider(),
    ':', // Trigger on ':' for variables
  );
  context.subscriptions.push(completionProvider);

  // Register document formatter — wires up Format Document (Shift+Alt+F),
  // the editor right-click menu, and Format on Save when enabled.
  const formattingProvider = vscode.languages.registerDocumentFormattingEditProvider(
    'logo',
    {
      provideDocumentFormattingEdits(document) {
        const formatted = formatLogoDocument(document.getText());
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length)
        );
        return [vscode.TextEdit.replace(fullRange, formatted)];
      }
    }
  );
  context.subscriptions.push(formattingProvider);

  // Create diagnostics collection for Logo and wire listeners
  diagnosticsCollection = vscode.languages.createDiagnosticCollection('logo');
  context.subscriptions.push(diagnosticsCollection);

  function updateDiagnosticsForDocument(doc: vscode.TextDocument) {
    if (doc.languageId !== 'logo') return;
    const items = analyzeSource(doc.getText(), doc.uri.fsPath);
    const diagnostics: vscode.Diagnostic[] = items.map(it => {
      const range = new vscode.Range(it.line, it.startChar, it.line, it.startChar + it.length);
      const severity = it.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
      return new vscode.Diagnostic(range, it.message, severity);
    });
    diagnosticsCollection!.set(doc.uri, diagnostics);
  }

  // Wire workspace events to update diagnostics
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(updateDiagnosticsForDocument));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => updateDiagnosticsForDocument(e.document)));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(updateDiagnosticsForDocument));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => diagnosticsCollection!.delete(doc.uri)));

  // Refresh diagnostics for already-open documents
  vscode.workspace.textDocuments.forEach(updateDiagnosticsForDocument);

  // Register command to show graphics
  const showGraphicsCommand = vscode.commands.registerCommand(
    'logo.showGraphics',
    () => {
      const activeDoc = vscode.window.activeTextEditor?.document;
      const fileName = activeDoc?.languageId === 'logo' ? activeDoc.fileName : undefined;
      showGraphicsPanel(context, fileName);
    }
  );

  context.subscriptions.push(showGraphicsCommand);

  const runFileCommand = vscode.commands.registerCommand(
    'logo.runFile',
    async (resource?: vscode.Uri) => {
      const document = await resolveLogoDocument(resource);
      if (!document) {
        vscode.window.showErrorMessage('No active Logo editor found. Open a .logo file and try again.');
        return;
      }

      const hasBreakpoints = vscode.debug.breakpoints.some(bp =>
        bp instanceof vscode.SourceBreakpoint &&
        bp.enabled &&
        bp.location.uri.toString() === document.uri.toString()
      );

      if (hasBreakpoints) {
        await vscode.debug.startDebugging(
          vscode.workspace.getWorkspaceFolder(document.uri),
          {
            type: 'logo',
            request: 'launch',
            name: 'Debug Logo Program',
            program: document.uri.fsPath,
            stopOnEntry: false
          }
        );
        return;
      }

      try {
        const runtime = new LogoRuntime();
        runtime.loadProgram(document.getText(), document.fileName);

        // Route PRINT output to the LOGO output channel
        const outputChannel = getLogoOutputChannel();
        outputChannel.clear();
        runtime.setPrintCallback((message: string) => {
          outputChannel.appendLine(message);
        });

        await runtime.execute();

        showGraphicsPanel(context, document.fileName);
        updateGraphics(runtime.getDrawCommands());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to run Logo program: ${message}`);
      }
    }
  );

  context.subscriptions.push(runFileCommand);

  // Register command to show preview (like Markdown preview)
  const showPreviewCommand = vscode.commands.registerCommand(
    'logo.showPreview',
    () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'logo') {
        vscode.window.showErrorMessage('Open a .logo file to preview.');
        return;
      }
      showPreviewPanel(context, editor.document);
    }
  );
  context.subscriptions.push(showPreviewCommand);

  // Auto-update preview on save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === 'logo' && previewPanel && previewSourceUri && doc.uri.toString() === previewSourceUri.toString()) {
        runPreview(doc);
      }
    })
  );

  // Listen for debug session custom events
  vscode.debug.onDidReceiveDebugSessionCustomEvent((event) => {
    if (event.event === 'logo.drawCommands') {
      updateGraphics(event.body.commands);
    }
    if (event.event === 'logo.printOutput') {
      const outputChannel = getLogoOutputChannel();
      outputChannel.appendLine(event.body.text);
    }
  });

  // Auto-show graphics panel when debugging starts and clear previous output
  vscode.debug.onDidStartDebugSession((session) => {
    if (session.type === 'logo') {
      showGraphicsPanel(context, session.configuration?.program);
      const outputChannel = getLogoOutputChannel();
      outputChannel.clear();
    }
  });

  // Monitor debug console output for draw commands
  vscode.debug.registerDebugAdapterTrackerFactory('logo', {
    createDebugAdapterTracker(session: vscode.DebugSession) {
      return {
        onDidSendMessage: (message: any) => {
          if (message.type === 'event' && message.event === 'output') {
            try {
              const output = message.body.output;
              if (output.includes('drawCommands')) {
                const data = JSON.parse(output);
                if (data.type === 'drawCommands') {
                  updateGraphics(data.commands);
                }
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      };
    }
  });
}

async function resolveLogoDocument(resource?: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  if (resource) {
    const existingDocument = vscode.workspace.textDocuments.find(
      doc => doc.uri.toString() === resource.toString()
    );
    const document = existingDocument ?? await vscode.workspace.openTextDocument(resource);
    return document.languageId === 'logo' ? document : undefined;
  }

  const activeDocument = vscode.window.activeTextEditor?.document;
  if (activeDocument?.languageId === 'logo') {
    return activeDocument;
  }

  return undefined;
}

function showGraphicsPanel(context: vscode.ExtensionContext, sourceFilePath?: string) {
  const baseName = sourceFilePath ? path.basename(sourceFilePath) : undefined;
  const title = baseName ?? 'Logo Graphics';

  if (graphicsPanel) {
    graphicsPanel.title = title;
    graphicsPanel.webview.postMessage({ command: 'setSourceFile', fileName: baseName });
    graphicsPanel.reveal(vscode.ViewColumn.Two, true);
  } else {
    graphicsPanel = vscode.window.createWebviewPanel(
      'logoGraphics',
      title,
      {
        viewColumn: vscode.ViewColumn.Two,
        preserveFocus: true
      },
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    graphicsPanel.webview.html = getWebviewContent(context, baseName);
    wireCanvasSizePersistence(graphicsPanel.webview, context);

    graphicsPanel.onDidDispose(() => {
      graphicsPanel = undefined;
    });
  }
}

function updateGraphics(commands: DrawCommand[]) {
  if (graphicsPanel) {
    graphicsPanel.webview.postMessage({
      command: 'draw',
      commands: commands
    });
  }
}

function getWebviewContent(context: vscode.ExtensionContext, sourceFile?: string): string {
  const htmlPath = path.join(context.extensionPath, 'webview', 'graphics.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  // Add Content Security Policy
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">`;
  html = html.replace('<meta charset="UTF-8">', `<meta charset="UTF-8">\n    ${cspMeta}`);

  const size = context.globalState.get('logo.canvasSize', { w: 500, h: 500 });
  const sourceJs = sourceFile ? `window.__LOGO_SOURCE_FILE__=${JSON.stringify(sourceFile)};` : '';
  html = html.replace('</head>', `<script>window.__LOGO_CANVAS_SIZE__=${JSON.stringify(size)};${sourceJs}</script></head>`);

  return html;
}

function wireCanvasSizePersistence(webview: vscode.Webview, context: vscode.ExtensionContext): void {
  webview.onDidReceiveMessage((m) => {
    if (m?.command === 'persistCanvasSize') {
      context.globalState.update('logo.canvasSize', { w: m.width, h: m.height });
    }
  });
}

function showPreviewPanel(context: vscode.ExtensionContext, document: vscode.TextDocument) {
  previewSourceUri = document.uri;

  if (previewPanel) {
    previewPanel.reveal(vscode.ViewColumn.Two);
  } else {
    previewPanel = vscode.window.createWebviewPanel(
      'logoPreview',
      'Preview: ' + path.basename(document.fileName),
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    previewPanel.webview.html = getWebviewContent(context, path.basename(document.fileName));
    wireCanvasSizePersistence(previewPanel.webview, context);

    previewPanel.onDidDispose(() => {
      previewPanel = undefined;
      previewSourceUri = undefined;
    });
  }

  // Update title when source changes
  previewPanel.title = 'Preview: ' + path.basename(document.fileName);

  // Run the program immediately
  runPreview(document);
}

function runPreview(document: vscode.TextDocument) {
  const source = document.getText();
  const runtime = new LogoRuntime();
  runtime.loadProgram(source, document.fileName);
  // Run without breakpoints/stepping
  runtime.setStepMode('continue');
  runtime.execute().then(() => {
    const commands = runtime.getDrawCommands();
    if (previewPanel) {
      previewPanel.webview.postMessage({
        command: 'draw',
        commands: commands
      });
    }
  }).catch((err) => {
    // Silently ignore runtime errors in preview
    const commands = runtime.getDrawCommands();
    if (previewPanel) {
      previewPanel.webview.postMessage({
        command: 'draw',
        commands: commands
      });
    }
  });
}

export function deactivate() {
  if (graphicsPanel) {
    graphicsPanel.dispose();
  }
  if (previewPanel) {
    previewPanel.dispose();
  }
  if (diagnosticsCollection) {
    diagnosticsCollection.clear();
    diagnosticsCollection.dispose();
  }
}
