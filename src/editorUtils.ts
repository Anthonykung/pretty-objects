/*
 * File: editorUtils.ts
 * Project: pretty-objects
 * Author: Anthony Kung <hi@anth.dev> (https://anth.dev)
 * License: Apache-2.0
 */

import * as vscode from 'vscode';

export interface RestoreEntry {
	text: string;
}

export function documentKey(document: vscode.TextDocument): string {
	return document.uri.toString();
}

export function findVisibleEditor(document: vscode.TextDocument | vscode.Uri): vscode.TextEditor | undefined {
	const key = document instanceof vscode.Uri ? document.toString() : document.uri.toString();
	return vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.toString() === key);
}

export function createFullRange(document: vscode.TextDocument): vscode.Range {
	return new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
}

function applySingleEdit(text: string, range: vscode.Range, replacement: string, document: vscode.TextDocument): string {
	const start = document.offsetAt(range.start);
	const end = document.offsetAt(range.end);
	return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
}

export async function replaceRange(
	editor: vscode.TextEditor,
	range: vscode.Range,
	replacement: string,
	restoreState: Map<string, RestoreEntry>,
): Promise<boolean> {
	const original = editor.document.getText();
	restoreState.set(documentKey(editor.document), { text: original });

	return editor.edit((builder) => builder.replace(range, replacement), { undoStopAfter: true, undoStopBefore: true }).then((applied) => {
		if (!applied) {
			restoreState.delete(documentKey(editor.document));
			return false;
		}
		restoreState.set(documentKey(editor.document), { text: original });
		return true;
	});
}

export async function openPreviewAndMaybeApply(
	editor: vscode.TextEditor,
	title: string,
	range: vscode.Range,
	replacement: string,
	restoreState: Map<string, RestoreEntry>,
): Promise<void> {
	const previewDocument = await vscode.workspace.openTextDocument({
		content: applySingleEdit(editor.document.getText(), range, replacement, editor.document),
		language: editor.document.languageId,
	});
	await vscode.commands.executeCommand('vscode.diff', editor.document.uri, previewDocument.uri, title);
	const choice = await vscode.window.showInformationMessage('Preview opened.', 'Apply');
	if (choice === 'Apply') {
		await replaceRange(editor, range, replacement, restoreState);
	}
}
