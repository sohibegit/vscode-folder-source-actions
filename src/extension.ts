import * as vscode from "vscode";
import { Uri } from "vscode";

const fakeWholeDocumentRange = new vscode.Range(0, 0, 99999, 0);

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("folderSourceActions.organizeImports", createFolderSourceAction(vscode.CodeActionKind.SourceOrganizeImports, "Organizing Imports in Folder"))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("folderSourceActions.organizeImportsOnlyChanges", createFolderSourceAction(vscode.CodeActionKind.SourceOrganizeImports, "Organizing Imports in Folder", true))
  );

  context.subscriptions.push(vscode.commands.registerCommand("folderSourceActions.fixAll", createFolderSourceAction(vscode.CodeActionKind.SourceFixAll, "Fixing All in Folder")));
}

function createFolderSourceAction(kind: vscode.CodeActionKind, progressLabel: string, onlyChanged?: boolean) {
  return function (dir: vscode.Uri) {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: progressLabel,
      },
      async () => {
        const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports;
        const api = gitExtension?.getAPI(1);
        const repo = api?.repositories[0];

        // console.log(onlyChanged);
        // console.log((await repo.diffWithHEAD()).map((diff: any) => diff.uri));
        // return;
        const files: Uri[] = onlyChanged ? (await repo.diffWithHEAD()).map((diff: any) => diff.uri) : await getPotentialFilesForSourceAction(dir);
        const p = Promise.all(files.map((file) => getSourceActionForFile(kind, file)).map((action) => action.then(tryApplyCodeAction)));
        p.then(() => new Promise((resolve) => setTimeout(resolve, 250))).then(() => {
          vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "saving..." }, () => {
            const savingPromis = vscode.workspace.saveAll(false);
            savingPromis
              .then(() => new Promise((resolve) => setTimeout(resolve, 250)))
              .then(async () => {
                await vscode.commands.executeCommand("workbench.action.closeAllEditors");
              });
            return savingPromis;
          });
        });
        return p;
      }
    );
  };
}

async function getPotentialFilesForSourceAction(dir: vscode.Uri): Promise<Thenable<Uri[]>> {
  return vscode.workspace.findFiles({ base: dir.fsPath, pattern: "**/*" }, "**/node_modules/**");
}

async function getSourceActionForFile(kind: vscode.CodeActionKind, file: vscode.Uri): Promise<vscode.CodeAction | undefined> {
  try {
    const allActions = (await getAllCodeActionsForFile(file, kind)) || [];
    return allActions.find(actionFilter(kind));
  } catch (e) {
    console.error(e);
    // noop
  }
  return undefined;
}

function getAllCodeActionsForFile(file: vscode.Uri, kind: vscode.CodeActionKind): any {
  // We need make sure VS Code knows about the file before trying to request code actions
  console.log(kind);
  return vscode.workspace.openTextDocument(file).then(() => vscode.commands.executeCommand("vscode.executeCodeActionProvider", file, fakeWholeDocumentRange, kind.value));
}

function actionFilter(targetKind: vscode.CodeActionKind) {
  return function (action: vscode.CodeAction): boolean {
    return action && !!action.kind && targetKind.contains(action.kind);
  };
}

async function tryApplyCodeAction(action: vscode.CodeAction | undefined) {
  if (!action) {
    return;
  }

  if (action.edit && action.edit.size > 0) {
    await vscode.workspace.applyEdit(action.edit);
  }
  if (action.command) {
    await vscode.commands.executeCommand(action.command.command, ...(action.command.arguments || []));
  }
}
