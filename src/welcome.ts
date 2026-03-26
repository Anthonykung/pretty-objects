/*
 * File: welcome.ts
 * Project: pretty-objects
 * Author: Anthony Kung <hi@anth.dev> (https://anth.dev)
 * License: Apache-2.0
 */

import * as vscode from 'vscode';

import {
	COMMAND_DEMO_FOLDING,
	COMMAND_DEMO_JSONL,
	COMMAND_DEMO_LITERAL_PAYLOADS,
	COMMAND_DEMO_OBJECT_VIEWER,
	COMMAND_DEMO_PYTHON_PAYLOADS,
	COMMAND_DEMO_PRETTIFY,
	COMMAND_DEMO_TEXT_TO_JSON,
	COMMAND_RESET_STATE,
	COMMAND_SET_DEFAULT_FORMATTER,
	GETTING_STARTED_KEY,
	WELCOME_PANEL_ID,
} from './commands';

function commandLink(command: string): string {
	return `command:${command}`;
}

async function getWelcomeHtml(context: vscode.ExtensionContext, webview: vscode.Webview): Promise<string> {
	const setDefaultFormatterLink = commandLink(COMMAND_SET_DEFAULT_FORMATTER);
	const resetStateLink = commandLink(COMMAND_RESET_STATE);
	const openKeyboardShortcutsLink = commandLink('workbench.action.openGlobalKeybindings');
	const openSettingsLink = commandLink('workbench.action.openSettings?%22prettyObjects%22');
	const demoPrettifyLink = commandLink(COMMAND_DEMO_PRETTIFY);
	const demoJsonlLink = commandLink(COMMAND_DEMO_JSONL);
	const demoObjectViewerLink = commandLink(COMMAND_DEMO_OBJECT_VIEWER);
	const demoCollapseLink = commandLink(COMMAND_DEMO_FOLDING);
	const demoTextToJsonLink = commandLink(COMMAND_DEMO_TEXT_TO_JSON);
	const demoLiteralPayloadsLink = commandLink(COMMAND_DEMO_LITERAL_PAYLOADS);
	const demoPythonPayloadsLink = commandLink(COMMAND_DEMO_PYTHON_PAYLOADS);
	const templateUri = vscode.Uri.joinPath(context.extensionUri, 'media', 'welcome.html');
	const bytes = await vscode.workspace.fs.readFile(templateUri);
	const template = new TextDecoder('utf-8').decode(bytes);

	return template
		.replaceAll('__CSP_CONTENT__', `default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource};`)
		.replaceAll('__SET_DEFAULT_FORMATTER__', setDefaultFormatterLink)
		.replaceAll('__RESET_STATE__', resetStateLink)
		.replaceAll('__OPEN_KEYBOARD_SHORTCUTS__', openKeyboardShortcutsLink)
		.replaceAll('__OPEN_SETTINGS__', openSettingsLink)
		.replaceAll('__DEMO_PRETTIFY__', demoPrettifyLink)
		.replaceAll('__DEMO_JSONL__', demoJsonlLink)
		.replaceAll('__DEMO_OBJECT_VIEWER__', demoObjectViewerLink)
		.replaceAll('__DEMO_COLLAPSE__', demoCollapseLink)
		.replaceAll('__DEMO_TEXT_TO_JSON__', demoTextToJsonLink)
		.replaceAll('__DEMO_LITERAL_PAYLOADS__', demoLiteralPayloadsLink)
		.replaceAll('__DEMO_PYTHON_PAYLOADS__', demoPythonPayloadsLink);
}

export async function openWelcome(
	context: vscode.ExtensionContext,
	force = false,
	onDispose?: () => void,
): Promise<void> {
	if (!force && context.globalState.get<boolean>(GETTING_STARTED_KEY)) {
		return;
	}

	const panel = vscode.window.createWebviewPanel(
		WELCOME_PANEL_ID,
		'Pretty Objects Welcome',
		vscode.ViewColumn.Active,
		{
			enableCommandUris: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
		},
	);
	panel.webview.html = await getWelcomeHtml(context, panel.webview);
	if (onDispose) {
		panel.onDidDispose(onDispose);
	}
	await context.globalState.update(GETTING_STARTED_KEY, true);
}
