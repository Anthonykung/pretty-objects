/*
 * File: objectViewerHtml.ts
 * Project: pretty-objects
 * Author: Anthony Kung <hi@anth.dev> (https://anth.dev)
 * License: Apache-2.0
 */

import * as vscode from 'vscode';

function createNonce(): string {
	return Math.random().toString(36).slice(2);
}

export async function getObjectViewerHtml(context: vscode.ExtensionContext): Promise<string> {
	const templateUri = vscode.Uri.joinPath(context.extensionUri, 'media', 'objectViewer.html');
	const bytes = await vscode.workspace.fs.readFile(templateUri);
	const template = new TextDecoder('utf-8').decode(bytes);
	return template.replaceAll('__NONCE__', createNonce());
}
