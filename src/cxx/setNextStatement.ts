import * as vscode from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { SetNextStatementHelpers } from './setNextStatementHelpers';

export default async function setNextStatement(): Promise<void> {
    try {
        const debugSession = vscode.debug.activeDebugSession;
        if (!debugSession) {
            throw new Error("There isn't an active C/C++ debug session.");
        }

        const currentEditor = vscode.window.activeTextEditor;
        if (!currentEditor) {
            throw new Error("There isn't an active source file.");
        }

        const position = currentEditor.selection.active;
        if (!position) {
            throw new Error("There isn't a current source position.");
        }

        const currentDocument = currentEditor.document;
        if (currentDocument.isDirty) {
            throw new Error("The current document has unsaved edits.");
        }

        const gotoTargetsArg: DebugProtocol.GotoTargetsArguments = {
            source: {
                // NOTE: in the case of embedded documents, this is the rather odd value of something like the following,
                // but vsdbg-ui is okay with it, so I guess we will leave it.
                // "Source file extracted from PDB file. Original path: C:\Debuggee-Libraries-Build-Dir\EmbeddedSourceTest\Class1\Main.cs"
                path: currentDocument.uri.fsPath
            },
            line: position.line + 1,
            column: position.character + 1
        };

        const gotoTargetsResponseBody = await debugSession.customRequest('gotoTargets', gotoTargetsArg);
        const targets: DebugProtocol.GotoTarget[] = gotoTargetsResponseBody.targets;
        if (targets.length === 0) {
            throw new Error(`No executable code is associated with line ${gotoTargetsArg.line}.`);
        }

        let selectedTarget = targets[0];

        if (targets.length > 1) {

            // If we have multiple possible targets, then let the user pick.
            const labelDict: { [key: string]: DebugProtocol.GotoTarget } = SetNextStatementHelpers.makeLabelsUnique(targets);
            const labels: string[] = targets.map((target) => target.label);

            const options: vscode.QuickPickOptions = {
                matchOnDescription: true,
                placeHolder: "Choose the specific location"
            };

            const selectedLabelName: string = await vscode.window.showQuickPick(labels, options);
            if (!selectedLabelName) {
                return; // operation was cancelled
            }
            selectedTarget = labelDict[selectedLabelName];
        }

        let threadId = 0;
        try {
            threadId = (await debugSession.customRequest('_selected_thread')).id;
        } catch (error) {
            const threads = (await debugSession.customRequest('threads')).threads;
            threadId = threads[0].id;
            if (threads.length > 1) {

                // If we have multiple possible targets, then let the user pick.
                const nameDict: { [key: string]: DebugProtocol.Thread } = threads.reduce((prev: { [key: string]: DebugProtocol.Thread }, current: DebugProtocol.Thread) => {
                    prev[current.name.includes(current.id.toString()) ? current.name : current.name + ': tid =' + current.id] = current;
                    return prev;
                }, {});
                const names: string[] = threads.map((current: DebugProtocol.Thread) => current.name.includes(current.id.toString()) ? current.name : current.name + ': tid =' + current.id);

                const options: vscode.QuickPickOptions = {
                    matchOnDescription: true,
                    placeHolder: "Choose the thread"
                };

                const selectedThreadName: string = await vscode.window.showQuickPick(names, options);
                if (!selectedThreadName) {
                    return; // operation was cancelled
                }
                threadId = nameDict[selectedThreadName].id;
            }
        }
        const gotoArgs: DebugProtocol.GotoArguments = {
            targetId: selectedTarget.id,
            threadId: threadId
        };
        await debugSession.customRequest('goto', gotoArgs);
    }
    catch (err) {
        vscode.window.showErrorMessage(`Unable to set the next statement. ${err}`);
    }
}