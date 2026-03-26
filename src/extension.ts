/*
 * File: extension.ts
 * Project: pretty-objects
 * Author: Anthony Kung <hi@anth.dev> (https://anth.dev)
 * License: Apache-2.0
 */

import * as path from 'path';
import * as vscode from 'vscode';

import {
	COMMAND_COLLAPSE,
	COMMAND_DEMO_FOLDING,
	COMMAND_DEMO_JSONL,
	COMMAND_DEMO_LITERAL_PAYLOADS,
	COMMAND_DEMO_OBJECT_VIEWER,
	COMMAND_DEMO_PYTHON_PAYLOADS,
	COMMAND_DEMO_PRETTIFY,
	COMMAND_DEMO_TEXT_TO_JSON,
	COMMAND_EXPAND,
	COMMAND_JSONL_PRETTY_VIEW,
	COMMAND_OPEN_OBJECT_VIEWER,
	COMMAND_OPEN_WELCOME,
	COMMAND_PRETTIFY_DOCUMENT,
	COMMAND_PRETTIFY_PREVIEW,
	COMMAND_PRETTIFY_SELECTION,
	COMMAND_RESET_STATE,
	COMMAND_RESTORE,
	COMMAND_SET_DEFAULT_FORMATTER,
	COMMAND_SPLIT_LARGE_FILE,
	COMMAND_TOGGLE_KEYBINDING,
	CONTEXT_KEYBINDING_ENABLED,
	CONTEXT_OBJECT_VIEWER_KEYBINDING_ENABLED,
	DEMO_DOCUMENT_SCHEME,
	GETTING_STARTED_KEY,
	VIEWER_DOCUMENT_SCHEME,
} from './commands';
import {
	createDefaultCollectionItem,
	EditableCollectionSyntax,
	getExactValueSignature,
	getGroupLabel,
	getSearchText,
	getValueAtPath,
	getValueSummary,
	parseEditableCollection,
	parseEditableCollectionItem,
	printEditableCollectionItem,
	serializeEditableCollection,
} from './core/collectionEditor';
import { formatTarget } from './core/engine';
import { computeFoldTargets, getDefaultCollapsedDepth } from './core/folding';
import { analyzeText, getFormatOptions, getSelectionOrDocument, inferSyntax } from './core/formatting';
import { getByteLength, splitDocumentByMaxBytes } from './core/split';
import { formatProgramDocument } from './core/programFormatting';
import { bestEffortTextToValue } from './core/textToValue';
import { PrettyValue } from './core/types';
import { createFullRange, documentKey, findVisibleEditor, openPreviewAndMaybeApply, replaceRange, RestoreEntry } from './editorUtils';
import { getObjectViewerHtml } from './objectViewerHtml';
import { PrettyObjectsCodeActionProvider, PrettyObjectsFoldingProvider, PrettyObjectsFormattingProvider, refreshDiagnostics } from './providers';
import { openWelcome } from './welcome';

interface ObjectViewerSession {
	documentUri: vscode.Uri;
	documentVersion: number;
	languageId: string;
	syntax: EditableCollectionSyntax;
	items: PrettyValue[];
	currentIndex: number;
	sourceViewColumn: vscode.ViewColumn | undefined;
	itemDocumentUri?: vscode.Uri;
	filteredIndices: number[];
	searchQuery: string;
	groupByPath: string;
	activeGroup: string | undefined;
	showOnlyEmptyObjects: boolean;
	showOnlyDuplicateObjects: boolean;
	searchTextCache: Map<number, string>;
	summaryCache: Map<number, string>;
	signatureCache: Map<number, string>;
	signatureCounts: Map<string, number>;
	viewerDocumentId: string;
	resultPage: number;
	resultsPerPage: number;
	diffDocumentUris: vscode.Uri[];
	panel?: vscode.WebviewPanel;
}

type ObjectViewerMessage =
	| { type: 'ready' }
	| { type: 'saveItem' }
	| { type: 'navigate'; delta?: number }
	| { type: 'insertItem'; position?: 'before' | 'after' | 'end' }
	| { type: 'removeItem' }
	| { type: 'openDiff'; compareIndex?: number }
	| { type: 'applyDocument' }
	| { type: 'reopenEditor' }
	| { type: 'setSearch'; query?: string }
	| { type: 'clearSearch' }
	| { type: 'setGroupPath'; path?: string }
	| { type: 'clearGroup' }
	| { type: 'selectGroup'; value?: string }
	| { type: 'jumpAbsolute'; index?: number }
	| { type: 'jumpResult'; position?: number }
	| { type: 'openResult'; index?: number }
	| { type: 'saveAsFile' }
	| { type: 'changeResultPage'; delta?: number }
	| { type: 'setResultPage'; page?: number }
	| { type: 'setResultsPerPage'; value?: number }
	| { type: 'runBulkAction'; action?: string; scope?: string; rangeStart?: number; rangeEnd?: number }
	| { type: 'toggleEmptyObjects' }
	| { type: 'toggleDuplicateObjects' };

interface VirtualFileEntry {
	content: Uint8Array;
	ctime: number;
	mtime: number;
}

const restoreState = new Map<string, RestoreEntry>();
const viewerSessionsByItemUri = new Map<string, ObjectViewerSession>();
const openDemoDocumentUris = new Set<string>();
let isResettingState = false;

class PrettyObjectsViewerFileSystemProvider implements vscode.FileSystemProvider {
	private readonly entries = new Map<string, VirtualFileEntry>();
	private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

	readonly onDidChangeFile = this.emitter.event;

	private key(uri: vscode.Uri): string {
		return uri.toString();
	}

	writeMemoryFile(uri: vscode.Uri, content: string): void {
		const now = Date.now();
		const encoded = new TextEncoder().encode(content);
		const key = this.key(uri);
		const existing = this.entries.get(key);
		this.entries.set(key, {
			content: encoded,
			ctime: existing?.ctime ?? now,
			mtime: now,
		});
		this.emitter.fire([{ type: existing ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created, uri }]);
	}

	deleteMemoryFile(uri: vscode.Uri): void {
		if (this.entries.delete(this.key(uri))) {
			this.emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
		}
	}

	stat(uri: vscode.Uri): vscode.FileStat {
		const entry = this.entries.get(this.key(uri));
		if (!entry) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		return {
			type: vscode.FileType.File,
			ctime: entry.ctime,
			mtime: entry.mtime,
			size: entry.content.byteLength,
		};
	}

	readDirectory(): [string, vscode.FileType][] {
		return [];
	}

	createDirectory(): void {
		throw vscode.FileSystemError.NoPermissions('Directories are not supported.');
	}

	readFile(uri: vscode.Uri): Uint8Array {
		const entry = this.entries.get(this.key(uri));
		if (!entry) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		return entry.content;
	}

	writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): void {
		const key = this.key(uri);
		const existing = this.entries.get(key);
		if (!existing && !options.create) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		if (existing && !options.overwrite) {
			throw vscode.FileSystemError.FileExists(uri);
		}
		const now = Date.now();
		this.entries.set(key, {
			content,
			ctime: existing?.ctime ?? now,
			mtime: now,
		});
		this.emitter.fire([{ type: existing ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created, uri }]);
	}

	delete(uri: vscode.Uri): void {
		this.deleteMemoryFile(uri);
	}

	rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void {
		const oldKey = this.key(oldUri);
		const entry = this.entries.get(oldKey);
		if (!entry) {
			throw vscode.FileSystemError.FileNotFound(oldUri);
		}
		const newKey = this.key(newUri);
		if (this.entries.has(newKey) && !options.overwrite) {
			throw vscode.FileSystemError.FileExists(newUri);
		}
		this.entries.delete(oldKey);
		this.entries.set(newKey, { ...entry, mtime: Date.now() });
		this.emitter.fire([
			{ type: vscode.FileChangeType.Deleted, uri: oldUri },
			{ type: vscode.FileChangeType.Created, uri: newUri },
		]);
	}

	watch(): vscode.Disposable {
		return new vscode.Disposable(() => undefined);
	}
}

const viewerFileSystemProvider = new PrettyObjectsViewerFileSystemProvider();

function getFoldableSelectionLines(editor: vscode.TextEditor, minimumDepth: number): number[] {
	const targets = computeFoldTargets(editor.document.getText())
		.filter((target) => target.depth >= minimumDepth)
		.sort((left, right) => left.depth - right.depth || left.startLine - right.startLine);
	return [...new Set(targets.map((target) => target.startLine))];
}

async function collapsePrettyView(editor: vscode.TextEditor): Promise<void> {
	const targets = computeFoldTargets(editor.document.getText());
	const selectionLines = [...new Set(targets
		.filter((target) => target.depth >= getDefaultCollapsedDepth(targets))
		.sort((left, right) => left.depth - right.depth || left.startLine - right.startLine)
		.map((target) => target.startLine))];
	if (selectionLines.length === 0) {
		return;
	}
	await vscode.commands.executeCommand('editor.unfoldAll');
	await vscode.commands.executeCommand('editor.fold', {
		levels: 1,
		selectionLines,
	});
}

async function expandPrettyView(editor: vscode.TextEditor): Promise<void> {
	const selectionLines = getFoldableSelectionLines(editor, 0);
	if (selectionLines.length === 0) {
		return;
	}
	await vscode.commands.executeCommand('editor.unfoldAll');
	await vscode.commands.executeCommand('editor.unfold', {
		levels: Number.MAX_SAFE_INTEGER,
		selectionLines,
	});
}

async function syncKeybindingContext(): Promise<void> {
	const enabled = vscode.workspace.getConfiguration('prettyObjects').get<boolean>('enableKeybinding', true);
	const objectViewerEnabled = vscode.workspace.getConfiguration('prettyObjects').get<boolean>('enableObjectViewerKeybinding', true);
	await vscode.commands.executeCommand('setContext', CONTEXT_KEYBINDING_ENABLED, enabled);
	await vscode.commands.executeCommand('setContext', CONTEXT_OBJECT_VIEWER_KEYBINDING_ENABLED, objectViewerEnabled);
}

function runStartupTask(label: string, task: () => Promise<void> | void): void {
	void Promise.resolve()
		.then(task)
		.catch((error) => {
			console.error(`[pretty-objects] Startup task failed: ${label}`, error);
		});
}

async function setAsDefaultFormatter(extensionId: string): Promise<void> {
	const target = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
		? vscode.ConfigurationTarget.Workspace
		: vscode.ConfigurationTarget.Global;
	const configuration = vscode.workspace.getConfiguration();
	const jsonSettings = configuration.get<Record<string, unknown>>('[json]', {});
	const jsonlSettings = configuration.get<Record<string, unknown>>('[jsonl]', {});

	await configuration.update('[json]', { ...jsonSettings, 'editor.defaultFormatter': extensionId }, target);
	await configuration.update('[jsonl]', { ...jsonlSettings, 'editor.defaultFormatter': extensionId }, target);

	void vscode.window.showInformationMessage(
		`Pretty Objects is now the default formatter for JSON and JSONL in ${target === vscode.ConfigurationTarget.Workspace ? 'this workspace' : 'user settings'}.`,
	);
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

async function createUniqueSplitDirectory(documentUri: vscode.Uri): Promise<vscode.Uri> {
	const extension = path.extname(documentUri.fsPath);
	const baseName = path.basename(documentUri.fsPath, extension);
	const parent = vscode.Uri.file(path.dirname(documentUri.fsPath));
	for (let suffix = 0; suffix < 10_000; suffix += 1) {
		const folderName = suffix === 0
			? `${baseName}.pretty-objects-split`
			: `${baseName}.pretty-objects-split-${suffix + 1}`;
		const candidate = vscode.Uri.joinPath(parent, folderName);
		if (!(await pathExists(candidate))) {
			return candidate;
		}
	}
	throw new Error('Could not allocate a split output directory.');
}

function createSplitPartFileName(documentUri: vscode.Uri, index: number, total: number): string {
	const extension = path.extname(documentUri.fsPath);
	const baseName = path.basename(documentUri.fsPath, extension);
	const width = Math.max(3, String(total).length);
	return `${baseName}.part-${String(index + 1).padStart(width, '0')}${extension}`;
}

async function runSplitLargeFileCommand(): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		void vscode.window.showErrorMessage('No active editor found.');
		return;
	}
	if (editor.document.uri.scheme !== 'file') {
		void vscode.window.showErrorMessage('Split Large File only works for saved local files.');
		return;
	}

	const text = editor.document.getText();
	const options = getFormatOptions(editor);
	if (options.maxDocumentSize <= 0) {
		void vscode.window.showErrorMessage('prettyObjects.maxDocumentSize must be greater than 0.');
		return;
	}
	if (getByteLength(text) <= options.maxDocumentSize) {
		void vscode.window.showInformationMessage('The active file is already within prettyObjects.maxDocumentSize.');
		return;
	}

	const syntax = inferSyntax(editor.document, text);
	const parts = splitDocumentByMaxBytes(text, syntax, options.maxDocumentSize, options);
	if (parts.length <= 1) {
		void vscode.window.showInformationMessage('Pretty Objects could not split the active file into multiple parts.');
		return;
	}

	const targetDirectory = await createUniqueSplitDirectory(editor.document.uri);
	await vscode.workspace.fs.createDirectory(targetDirectory);
	for (let index = 0; index < parts.length; index += 1) {
		const partUri = vscode.Uri.joinPath(
			targetDirectory,
			createSplitPartFileName(editor.document.uri, index, parts.length),
		);
		await vscode.workspace.fs.writeFile(partUri, new TextEncoder().encode(parts[index]));
	}

	const firstPartUri = vscode.Uri.joinPath(targetDirectory, createSplitPartFileName(editor.document.uri, 0, parts.length));
	const action = await vscode.window.showInformationMessage(
		`Split the file into ${parts.length} part files in ${path.basename(targetDirectory.fsPath)}.`,
		'Open First Part',
	);
	if (action === 'Open First Part') {
		const document = await vscode.workspace.openTextDocument(firstPartUri);
		await vscode.window.showTextDocument(document, { preview: false });
	}
}

function stripExtensionDefaultFormatter(value: unknown, extensionId: string): Record<string, unknown> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const next = { ...(value as Record<string, unknown>) };
	if (next['editor.defaultFormatter'] === extensionId) {
		delete next['editor.defaultFormatter'];
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

async function resetExtensionState(context: vscode.ExtensionContext): Promise<void> {
	if (isResettingState) {
		return;
	}
	isResettingState = true;
	try {
		restoreState.clear();
		await context.globalState.update(GETTING_STARTED_KEY, false);

		const prettyConfig = vscode.workspace.getConfiguration('prettyObjects');
		const resetKeys = [
			'repairMode',
			'previewBeforeApply',
			'jsonlMode',
			'quoteStyle.jsTs',
			'quoteStyle.python',
			'maxDocumentSize',
			'collapseNestedFieldsByDefault',
			'enableKeybinding',
			'enableObjectViewerKeybinding',
		];

		for (const key of resetKeys) {
			await prettyConfig.update(key, undefined, vscode.ConfigurationTarget.Global);
			await prettyConfig.update(key, undefined, vscode.ConfigurationTarget.Workspace);
		}

		const rootConfig = vscode.workspace.getConfiguration();
		for (const key of ['[json]', '[jsonl]']) {
			const inspected = rootConfig.inspect<Record<string, unknown>>(key);
			const globalValue = stripExtensionDefaultFormatter(inspected?.globalValue, context.extension.id);
			const workspaceValue = stripExtensionDefaultFormatter(inspected?.workspaceValue, context.extension.id);
			await rootConfig.update(key, globalValue, vscode.ConfigurationTarget.Global);
			await rootConfig.update(key, workspaceValue, vscode.ConfigurationTarget.Workspace);
		}

		await syncKeybindingContext();
		void vscode.window.showWarningMessage('Pretty Objects state was reset to defaults. Welcome will open again.');
		await openWelcome(context, true, () => {
			void closeAllDemoTabs();
		});
	} finally {
		isResettingState = false;
	}
}

function getDemoUri(label: string, extension: string): vscode.Uri {
	const safeLabel = label.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'demo';
	return vscode.Uri.parse(`${DEMO_DOCUMENT_SCHEME}:/${Date.now()}-${safeLabel}.${extension}`);
}

async function openDemoDocument(
	content: string,
	language: string,
	label: string,
	extension: string,
	closeExisting = true,
): Promise<vscode.TextEditor> {
	if (closeExisting) {
		await closeAllDemoTabs();
	}
	const uri = getDemoUri(label, extension);
	viewerFileSystemProvider.writeMemoryFile(uri, content);
	openDemoDocumentUris.add(uri.toString());
	const document = await vscode.workspace.openTextDocument(uri);
	return vscode.window.showTextDocument(document, { preview: true });
}

async function createDemoTextDocument(content: string, label: string, extension: string): Promise<vscode.TextDocument> {
	const uri = getDemoUri(label, extension);
	viewerFileSystemProvider.writeMemoryFile(uri, content);
	openDemoDocumentUris.add(uri.toString());
	return vscode.workspace.openTextDocument(uri);
}

async function openDemoDiff(
	before: { content: string; label: string; extension: string },
	after: { content: string; label: string; extension: string },
	title: string,
	closeExisting = true,
): Promise<void> {
	if (closeExisting) {
		await closeAllDemoTabs();
	}
	const beforeDocument = await createDemoTextDocument(before.content, before.label, before.extension);
	const afterDocument = await createDemoTextDocument(after.content, after.label, after.extension);
	await vscode.commands.executeCommand(
		'vscode.diff',
		beforeDocument.uri,
		afterDocument.uri,
		title,
		{ preview: false, preserveFocus: false },
	);
}

async function readDemoFile(context: vscode.ExtensionContext, fileName: string): Promise<string> {
	const uri = vscode.Uri.joinPath(context.extensionUri, 'demo', fileName);
	const bytes = await vscode.workspace.fs.readFile(uri);
	return new TextDecoder('utf-8').decode(bytes);
}

async function runPrettifyRepairDemo(context: vscode.ExtensionContext): Promise<void> {
	const content = await readDemoFile(context, 'prettify-repair.json');
	const editor = await openDemoDocument(content, 'json', 'Pretty Objects Demo Repair', 'json');
	await vscode.commands.executeCommand(COMMAND_PRETTIFY_PREVIEW);
	void vscode.window.showInformationMessage('Demo opened: review the preview diff, then apply it to see repair + formatting.');
	await vscode.window.showTextDocument(editor.document, { preview: false, preserveFocus: true });
}

async function runJsonlPrettyViewDemo(context: vscode.ExtensionContext): Promise<void> {
	const content = await readDemoFile(context, 'jsonl-dataset.jsonl');
	const formatted = formatTarget(content, 'jsonl', getFormatOptions(undefined), 'prettyView');
	await openDemoDiff(
		{ content, label: 'Pretty Objects Demo JSONL Before', extension: 'jsonl' },
		{ content: formatted.formattedText, label: 'Pretty Objects Demo JSONL After', extension: 'json' },
		'Pretty Objects Demo: JSONL Pretty View',
	);
	void vscode.window.showInformationMessage('Demo opened as a diff view showing JSONL Pretty View output.');
}

async function runObjectViewerDemo(context: vscode.ExtensionContext): Promise<void> {
	const content = await readDemoFile(context, 'object-viewer.json');
	const parsed = JSON.parse(content) as Array<Record<string, unknown>>;
	const after = parsed
		.filter((item, index, items) => !(Object.keys(item).length === 0))
		.filter((item, index, items) => index === items.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(item)))
		.map((item, index) => (index === 0 ? { ...item, reviewed: true } : item));
	await openDemoDocument(content, 'json', 'Pretty Objects Demo Object Viewer', 'json');
	await vscode.commands.executeCommand(COMMAND_OPEN_OBJECT_VIEWER);
	await openDemoDiff(
		{ content, label: 'Pretty Objects Demo Object Viewer Before', extension: 'json' },
		{ content: JSON.stringify(after, null, 2), label: 'Pretty Objects Demo Object Viewer After', extension: 'json' },
		'Pretty Objects Demo: Object Viewer Workflow',
		false,
	);
	void vscode.window.showInformationMessage('Demo opened with a companion diff plus Object Viewer. Try paging, grouping, filters, bulk actions, diff, and Ctrl+S in the temporary editor.');
}

async function runCollapseDemo(context: vscode.ExtensionContext): Promise<void> {
	const content = await readDemoFile(context, 'folding.json');
	const formatted = formatTarget(content, 'json', getFormatOptions(undefined));
	await openDemoDiff(
		{ content, label: 'Pretty Objects Demo Folding Before', extension: 'json' },
		{ content: formatted.formattedText, label: 'Pretty Objects Demo Folding After', extension: 'json' },
		'Pretty Objects Demo: Collapse Nested Objects',
	);
	const editor = await openDemoDocument(
		formatted.formattedText,
		'json',
		'Pretty Objects Demo Folding Collapsed',
		'json',
		false,
	);
	await collapsePrettyView(editor);
	void vscode.window.showInformationMessage(
		'Demo opened with a diff plus a companion formatted document where nested sections are already collapsed.',
	);
}

async function runTextToJsonDemo(context: vscode.ExtensionContext): Promise<void> {
	const source = await readDemoFile(context, 'text-to-json.txt');
	const converted = bestEffortTextToValue(source);
	const output = converted
		? printEditableCollectionItem(converted, 'json', getFormatOptions(undefined))
		: '{"error":"bestEffort conversion failed"}';
	await openDemoDiff(
		{ content: source, label: 'Pretty Objects Demo Text To JSON Before', extension: 'txt' },
		{ content: output, label: 'Pretty Objects Demo Text To JSON After', extension: 'json' },
		'Pretty Objects Demo: Text To JSON',
	);
	void vscode.window.showInformationMessage(
		'Demo opened as a diff view showing the same best-effort text-to-JSON conversion used by Object Viewer saves when repair mode is bestEffort.',
	);
}

function selectBalancedDemoLiteral(
	editor: vscode.TextEditor,
	anchor: string,
	openChar: '{' | '[',
	closeChar: '}' | ']',
): boolean {
	const text = editor.document.getText();
	const anchorIndex = text.indexOf(anchor);
	if (anchorIndex < 0) {
		return false;
	}
	const startIndex = text.indexOf(openChar, anchorIndex + anchor.length);
	if (startIndex < 0) {
		return false;
	}
	let depth = 0;
	let inString: '"' | '\'' | '`' | null = null;
	let escaped = false;
	for (let index = startIndex; index < text.length; index += 1) {
		const char = text[index];
		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (char === '\\') {
				escaped = true;
				continue;
			}
			if (char === inString) {
				inString = null;
			}
			continue;
		}
		if (char === '"' || char === '\'' || char === '`') {
			inString = char;
			continue;
		}
		if (char === openChar) {
			depth += 1;
			continue;
		}
		if (char === closeChar) {
			depth -= 1;
			if (depth === 0) {
				const start = editor.document.positionAt(startIndex);
				const end = editor.document.positionAt(index + 1);
				editor.selection = new vscode.Selection(start, end);
				editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
				return true;
			}
		}
	}
	return false;
}

async function runLiteralPayloadsDemo(context: vscode.ExtensionContext): Promise<void> {
	const content = await readDemoFile(context, 'literal-payload.ts');
	const editor = await openDemoDocument(content, 'typescript', 'Pretty Objects Demo TypeScript', 'ts');
	if (!selectBalancedDemoLiteral(editor, 'const trainingBatch', '{', '}')) {
		throw new Error('Failed to locate the TypeScript demo payload.');
	}
	await vscode.commands.executeCommand(COMMAND_PRETTIFY_PREVIEW);
	void vscode.window.showInformationMessage(
		'Demo opened as a diff view from a real TypeScript source file. The object literal selection is what Pretty Objects formats.',
	);
	await vscode.window.showTextDocument(editor.document, { preview: false, preserveFocus: true });
}

async function runPythonPayloadsDemo(context: vscode.ExtensionContext): Promise<void> {
	const content = await readDemoFile(context, 'python-payload.py');
	const editor = await openDemoDocument(content, 'python', 'Pretty Objects Demo Python', 'py');
	if (!selectBalancedDemoLiteral(editor, 'training_manifest =', '{', '}')) {
		throw new Error('Failed to locate the Python demo payload.');
	}
	await vscode.commands.executeCommand(COMMAND_PRETTIFY_PREVIEW);
	void vscode.window.showInformationMessage(
		'Demo opened as a diff view from a real Python source file. The dict literal selection is what Pretty Objects formats.',
	);
	await vscode.window.showTextDocument(editor.document, { preview: false, preserveFocus: true });
}

function viewerLanguageId(session: ObjectViewerSession): string {
	return session.syntax === 'jsonl' ? 'json' : session.languageId;
}

function asObjectViewerMessage(message: unknown): ObjectViewerMessage | undefined {
	if (!message || typeof message !== 'object' || !('type' in message) || typeof message.type !== 'string') {
		return undefined;
	}
	const candidate = message as Record<string, unknown>;
	switch (candidate.type) {
		case 'ready':
			return { type: 'ready' };
		case 'saveItem':
			return { type: 'saveItem' };
		case 'navigate':
			return {
				type: 'navigate',
				delta: typeof candidate.delta === 'number' ? candidate.delta : undefined,
			};
		case 'insertItem':
			return {
				type: 'insertItem',
				position: candidate.position === 'before' || candidate.position === 'after' || candidate.position === 'end' ? candidate.position : undefined,
			};
		case 'removeItem':
			return { type: 'removeItem' };
		case 'openDiff':
			return {
				type: 'openDiff',
				compareIndex: typeof candidate.compareIndex === 'number' ? candidate.compareIndex : undefined,
			};
		case 'applyDocument':
			return { type: 'applyDocument' };
		case 'reopenEditor':
			return { type: 'reopenEditor' };
		case 'setSearch':
			return { type: 'setSearch', query: typeof candidate.query === 'string' ? candidate.query : undefined };
		case 'clearSearch':
			return { type: 'clearSearch' };
		case 'setGroupPath':
			return { type: 'setGroupPath', path: typeof candidate.path === 'string' ? candidate.path : undefined };
		case 'clearGroup':
			return { type: 'clearGroup' };
		case 'selectGroup':
			return { type: 'selectGroup', value: typeof candidate.value === 'string' ? candidate.value : undefined };
		case 'jumpAbsolute':
			return { type: 'jumpAbsolute', index: typeof candidate.index === 'number' ? candidate.index : undefined };
		case 'jumpResult':
			return { type: 'jumpResult', position: typeof candidate.position === 'number' ? candidate.position : undefined };
		case 'openResult':
			return { type: 'openResult', index: typeof candidate.index === 'number' ? candidate.index : undefined };
		case 'saveAsFile':
			return { type: 'saveAsFile' };
		case 'changeResultPage':
			return { type: 'changeResultPage', delta: typeof candidate.delta === 'number' ? candidate.delta : undefined };
		case 'setResultPage':
			return { type: 'setResultPage', page: typeof candidate.page === 'number' ? candidate.page : undefined };
		case 'setResultsPerPage':
			return { type: 'setResultsPerPage', value: typeof candidate.value === 'number' ? candidate.value : undefined };
		case 'runBulkAction':
			return {
				type: 'runBulkAction',
				action: typeof candidate.action === 'string' ? candidate.action : undefined,
				scope: typeof candidate.scope === 'string' ? candidate.scope : undefined,
				rangeStart: typeof candidate.rangeStart === 'number' ? candidate.rangeStart : undefined,
				rangeEnd: typeof candidate.rangeEnd === 'number' ? candidate.rangeEnd : undefined,
			};
		case 'toggleEmptyObjects':
			return { type: 'toggleEmptyObjects' };
		case 'toggleDuplicateObjects':
			return { type: 'toggleDuplicateObjects' };
		default:
			return undefined;
	}
}

function getViewerInsertReference(session: ObjectViewerSession): PrettyValue | undefined {
	return session.items[session.currentIndex] ?? session.items.find((item) => item.kind === 'object');
}

const GROUP_WINDOW_SIZE = 80;
const DEFAULT_RESULTS_PER_PAGE = 100;
const MIN_RESULTS_PER_PAGE = 1;
const MAX_RESULTS_PER_PAGE = 1000;

function normalizeResultsPerPage(value: number | undefined): number {
	if (typeof value !== 'number' || !Number.isInteger(value)) {
		return DEFAULT_RESULTS_PER_PAGE;
	}
	return Math.max(MIN_RESULTS_PER_PAGE, Math.min(MAX_RESULTS_PER_PAGE, value));
}

function getResultPageCount(session: ObjectViewerSession): number {
	return Math.max(1, Math.ceil(session.filteredIndices.length / session.resultsPerPage));
}

function clampResultPage(session: ObjectViewerSession): void {
	session.resultPage = Math.max(0, Math.min(session.resultPage, getResultPageCount(session) - 1));
}

function invalidateBrowseCaches(session: ObjectViewerSession): void {
	session.searchTextCache.clear();
	session.summaryCache.clear();
	session.signatureCache.clear();
	session.signatureCounts.clear();
}

function getCachedSearchText(session: ObjectViewerSession, index: number): string {
	const existing = session.searchTextCache.get(index);
	if (existing !== undefined) {
		return existing;
	}
	const computed = getSearchText(session.items[index]);
	session.searchTextCache.set(index, computed);
	return computed;
}

function getCachedSummary(session: ObjectViewerSession, index: number): string {
	const existing = session.summaryCache.get(index);
	if (existing !== undefined) {
		return existing;
	}
	const computed = getValueSummary(session.items[index]);
	session.summaryCache.set(index, computed);
	return computed;
}

function getCachedSignature(session: ObjectViewerSession, index: number): string {
	const existing = session.signatureCache.get(index);
	if (existing !== undefined) {
		return existing;
	}
	const computed = getExactValueSignature(session.items[index]);
	session.signatureCache.set(index, computed);
	return computed;
}

function ensureSignatureCounts(session: ObjectViewerSession): void {
	if (session.signatureCounts.size > 0 || session.items.length === 0) {
		return;
	}
	for (let index = 0; index < session.items.length; index += 1) {
		const signature = getCachedSignature(session, index);
		session.signatureCounts.set(signature, (session.signatureCounts.get(signature) ?? 0) + 1);
	}
}

function isEmptyObjectItem(session: ObjectViewerSession, index: number): boolean {
	const value = session.items[index];
	return value?.kind === 'object' && value.entries.length === 0;
}

function isDuplicateItem(session: ObjectViewerSession, index: number): boolean {
	ensureSignatureCounts(session);
	return (session.signatureCounts.get(getCachedSignature(session, index)) ?? 0) > 1;
}

function normalizeSearchQuery(query: string): string {
	return query.trim().toLowerCase();
}

function getSearchMatchedIndices(session: ObjectViewerSession): number[] {
	const query = normalizeSearchQuery(session.searchQuery);
	if (!query) {
		return session.items.map((_, index) => index);
	}
	const matches: number[] = [];
	for (let index = 0; index < session.items.length; index += 1) {
		if (getCachedSearchText(session, index).includes(query)) {
			matches.push(index);
		}
	}
	return matches;
}

function buildGroupEntries(session: ObjectViewerSession): Array<{ value: string; count: number }> {
	const path = session.groupByPath.trim();
	if (!path) {
		return [];
	}
	const counts = new Map<string, number>();
	for (const index of getSearchMatchedIndices(session)) {
		const label = getGroupLabel(getValueAtPath(session.items[index], path));
		counts.set(label, (counts.get(label) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([value, count]) => ({ value, count }))
		.sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
		.slice(0, GROUP_WINDOW_SIZE);
}

function recomputeFilteredIndices(session: ObjectViewerSession): void {
	const path = session.groupByPath.trim();
	const activeGroup = session.activeGroup;
	let filtered = getSearchMatchedIndices(session);
	if (session.showOnlyEmptyObjects) {
		filtered = filtered.filter((index) => isEmptyObjectItem(session, index));
	}
	if (session.showOnlyDuplicateObjects) {
		filtered = filtered.filter((index) => isDuplicateItem(session, index));
	}
	if (path && activeGroup !== undefined) {
		filtered = filtered.filter((index) => getGroupLabel(getValueAtPath(session.items[index], path)) === activeGroup);
	}
	session.filteredIndices = filtered;
}

function ensureCurrentIndexInFilteredSet(session: ObjectViewerSession): void {
	if (session.filteredIndices.length === 0) {
		session.currentIndex = Math.max(0, Math.min(session.currentIndex, Math.max(0, session.items.length - 1)));
		return;
	}
	if (session.filteredIndices.includes(session.currentIndex)) {
		return;
	}
	session.currentIndex = session.filteredIndices[0];
}

function getCurrentFilteredPosition(session: ObjectViewerSession): number {
	return session.filteredIndices.indexOf(session.currentIndex);
}

function getVisibleResultEntries(session: ObjectViewerSession): Array<{ index: number; resultPosition: number; summary: string; current: boolean }> {
	clampResultPage(session);
	const start = session.resultPage * session.resultsPerPage;
	const end = Math.min(session.filteredIndices.length, start + session.resultsPerPage);
	return session.filteredIndices.slice(start, end).map((index, offset) => ({
		index,
		resultPosition: start + offset,
		summary: getCachedSummary(session, index),
		current: index === session.currentIndex,
	}));
}

function getCurrentPageIndices(session: ObjectViewerSession): number[] {
	clampResultPage(session);
	const start = session.resultPage * session.resultsPerPage;
	const end = Math.min(session.filteredIndices.length, start + session.resultsPerPage);
	return session.filteredIndices.slice(start, end);
}

function getAbsoluteRangeIndices(session: ObjectViewerSession, start: number | undefined, end: number | undefined): number[] {
	if (typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end)) {
		throw new Error('Enter a valid range like 1 to 20.');
	}
	if (session.items.length === 0) {
		return [];
	}
	const normalizedStart = Math.max(0, Math.min(start, end));
	const normalizedEnd = Math.min(session.items.length - 1, Math.max(start, end));
	const indices: number[] = [];
	for (let index = normalizedStart; index <= normalizedEnd; index += 1) {
		indices.push(index);
	}
	return indices;
}

function removeIndicesFromCollection(session: ObjectViewerSession, indicesToRemove: number[]): number {
	if (indicesToRemove.length === 0) {
		return 0;
	}
	const removalSet = new Set(indicesToRemove);
	session.items = session.items.filter((_, index) => !removalSet.has(index));
	session.currentIndex = Math.max(0, Math.min(session.currentIndex, Math.max(0, session.items.length - 1)));
	invalidateBrowseCaches(session);
	refreshBrowseState(session);
	return removalSet.size;
}

function getDuplicateIndicesInScope(session: ObjectViewerSession, indices: number[]): number[] {
	const seen = new Set<string>();
	const duplicates: number[] = [];
	for (const index of indices) {
		const signature = getCachedSignature(session, index);
		if (seen.has(signature)) {
			duplicates.push(index);
			continue;
		}
		seen.add(signature);
	}
	return duplicates;
}

function refreshBrowseState(session: ObjectViewerSession): void {
	if (session.groupByPath.trim()) {
		const availableGroups = new Set(buildGroupEntries(session).map((entry) => entry.value));
		if (session.activeGroup !== undefined && !availableGroups.has(session.activeGroup)) {
			session.activeGroup = undefined;
		}
	} else {
		session.activeGroup = undefined;
	}
	recomputeFilteredIndices(session);
	ensureCurrentIndexInFilteredSet(session);
	const filteredPosition = getCurrentFilteredPosition(session);
	if (filteredPosition >= 0) {
		session.resultPage = Math.floor(filteredPosition / session.resultsPerPage);
	}
	clampResultPage(session);
}

function setCurrentIndex(session: ObjectViewerSession, index: number): void {
	session.currentIndex = Math.max(0, Math.min(index, Math.max(0, session.items.length - 1)));
	ensureCurrentIndexInFilteredSet(session);
}

function getViewerItemFileExtension(session: ObjectViewerSession): string {
	switch (session.syntax) {
		case 'json':
			return 'json';
		case 'jsonl':
			return 'json';
		case 'javascript':
			return 'js';
		case 'typescript':
			return 'ts';
		case 'python':
			return 'py';
	}
}

function getViewerItemUri(session: ObjectViewerSession): vscode.Uri {
	const extension = getViewerItemFileExtension(session);
	return vscode.Uri.parse(`${VIEWER_DOCUMENT_SCHEME}:/${session.viewerDocumentId}/Pretty Objects Viewer ${session.currentIndex + 1}.${extension}`);
}

function getViewerDiffUri(session: ObjectViewerSession, side: 'left' | 'right', compareIndex: number): vscode.Uri {
	const extension = getViewerItemFileExtension(session);
	const label = side === 'left' ? `Current ${session.currentIndex + 1}` : `Compare ${compareIndex + 1}`;
	return vscode.Uri.parse(`${VIEWER_DOCUMENT_SCHEME}:/${session.viewerDocumentId}/Pretty Objects Diff ${label}.${extension}`);
}

function findTabsForUri(uri: vscode.Uri): vscode.Tab[] {
	const tabs: vscode.Tab[] = [];
	for (const group of vscode.window.tabGroups.all) {
		for (const tab of group.tabs) {
			const input = tab.input;
			if (input instanceof vscode.TabInputText && input.uri.toString() === uri.toString()) {
				tabs.push(tab);
			}
		}
	}
	return tabs;
}

function findDiffTabs(left: vscode.Uri, right: vscode.Uri): vscode.Tab[] {
	const tabs: vscode.Tab[] = [];
	for (const group of vscode.window.tabGroups.all) {
		for (const tab of group.tabs) {
			const input = tab.input;
			if (input instanceof vscode.TabInputTextDiff && input.original.toString() === left.toString() && input.modified.toString() === right.toString()) {
				tabs.push(tab);
			}
		}
	}
	return tabs;
}

function isViewerTab(tab: vscode.Tab): boolean {
	const input = tab.input;
	if (input instanceof vscode.TabInputText) {
		return input.uri.scheme === VIEWER_DOCUMENT_SCHEME;
	}
	if (input instanceof vscode.TabInputTextDiff) {
		return input.original.scheme === VIEWER_DOCUMENT_SCHEME || input.modified.scheme === VIEWER_DOCUMENT_SCHEME;
	}
	return false;
}

function isDemoTab(tab: vscode.Tab): boolean {
	const input = tab.input;
	if (input instanceof vscode.TabInputText) {
		return input.uri.scheme === DEMO_DOCUMENT_SCHEME;
	}
	if (input instanceof vscode.TabInputTextDiff) {
		return input.original.scheme === DEMO_DOCUMENT_SCHEME || input.modified.scheme === DEMO_DOCUMENT_SCHEME;
	}
	return false;
}

function findAllViewerTabs(): vscode.Tab[] {
	const tabs: vscode.Tab[] = [];
	for (const group of vscode.window.tabGroups.all) {
		for (const tab of group.tabs) {
			if (isViewerTab(tab)) {
				tabs.push(tab);
			}
		}
	}
	return tabs;
}

function findAllDemoTabs(): vscode.Tab[] {
	const tabs: vscode.Tab[] = [];
	for (const group of vscode.window.tabGroups.all) {
		for (const tab of group.tabs) {
			if (isDemoTab(tab)) {
				tabs.push(tab);
			}
		}
	}
	return tabs;
}

async function closeTabs(tabs: readonly vscode.Tab[]): Promise<void> {
	if (tabs.length === 0) {
		return;
	}
	await vscode.window.tabGroups.close(tabs);
}

async function closeStaleViewerTabs(): Promise<void> {
	await closeTabs(findAllViewerTabs());
}

async function closeStaleDemoTabs(): Promise<void> {
	await closeTabs(findAllDemoTabs());
}

async function closeAllDemoTabs(): Promise<void> {
	const uris = [...openDemoDocumentUris].map((value) => vscode.Uri.parse(value));
	await closeTabs(findAllDemoTabs());
	for (const uri of uris) {
		viewerFileSystemProvider.deleteMemoryFile(uri);
	}
	openDemoDocumentUris.clear();
}

async function closeViewerItemEditor(session: ObjectViewerSession): Promise<void> {
	if (!session.itemDocumentUri) {
		return;
	}
	await closeTabs(findTabsForUri(session.itemDocumentUri));
}

async function closeViewerDiffEditors(session: ObjectViewerSession): Promise<void> {
	const uris = [...session.diffDocumentUris];
	session.diffDocumentUris = [];
	for (let index = 0; index < uris.length; index += 2) {
		const left = uris[index];
		const right = uris[index + 1];
		if (left && right) {
			await closeTabs(findDiffTabs(left, right));
		}
		if (left) {
			viewerFileSystemProvider.deleteMemoryFile(left);
		}
		if (right) {
			viewerFileSystemProvider.deleteMemoryFile(right);
		}
	}
}

async function postObjectViewerState(
	panel: vscode.WebviewPanel,
	session: ObjectViewerSession,
	options: ReturnType<typeof getFormatOptions>,
	statusMessage?: string,
	statusKind?: 'success' | 'error',
): Promise<void> {
	const hasCurrentItem = session.items.length > 0;
	const editorOpen = !!session.itemDocumentUri && vscode.workspace.textDocuments.some((document) => document.uri.toString() === session.itemDocumentUri?.toString());
	ensureSignatureCounts(session);
	const currentItem = hasCurrentItem ? session.items[session.currentIndex] : undefined;
	const duplicateCount = hasCurrentItem ? (session.signatureCounts.get(getCachedSignature(session, session.currentIndex)) ?? 0) - 1 : 0;
	const emptyObjectWarning = currentItem?.kind === 'object' && currentItem.entries.length === 0
		? 'Empty object warning: this item is an empty object.'
		: '';
	const groupEntries = buildGroupEntries(session).map((entry) => ({
		value: entry.value,
		label: entry.value,
		countLabel: `${entry.count} items`,
		active: session.activeGroup === entry.value,
	}));
	const resultEntries = getVisibleResultEntries(session).map((entry) => ({
		index: entry.index,
		title: `#${entry.index + 1} · result ${entry.resultPosition + 1}`,
		summary: entry.summary,
		current: entry.current,
	}));
	const currentPageIndices = getCurrentPageIndices(session);
	const filteredPosition = getCurrentFilteredPosition(session);
	const resultPageCount = getResultPageCount(session);
	const currentPage = Math.min(session.resultPage + 1, resultPageCount);
	await panel.webview.postMessage({
		syntaxLabel: session.syntax.toUpperCase(),
		positionLabel: hasCurrentItem ? `Item ${session.currentIndex + 1}` : 'No items',
		countLabel: `${session.items.length} total`,
		emptyMessage: hasCurrentItem ? '' : 'This collection is empty. Insert an item to start editing again.',
			editorStateLabel: hasCurrentItem
				? editorOpen
					? 'Current item is open in a VS Code editor. Saving that tab stays in Pretty Objects memory until you choose Save Item As File.'
					: 'Current item editor is closed. Reopen it to continue editing.'
				: '',
			duplicateWarning: duplicateCount > 0
				? `Duplicate warning: this item exactly matches ${duplicateCount} other ${duplicateCount === 1 ? 'item' : 'items'} in the collection.`
				: '',
			emptyObjectWarning,
			searchQuery: session.searchQuery,
			emptyToggleLabel: session.showOnlyEmptyObjects ? 'Show All Objects' : 'Show Empty Objects Only',
			duplicateToggleLabel: session.showOnlyDuplicateObjects ? 'Show All Objects' : 'Show Duplicates Only',
			groupPath: session.groupByPath,
			searchMeta: session.searchQuery
				? `${session.filteredIndices.length} results match "${session.searchQuery}".`
				: `Search scans compact object text. Empty-only filter is ${session.showOnlyEmptyObjects ? 'on' : 'off'}, duplicate-only filter is ${session.showOnlyDuplicateObjects ? 'on' : 'off'}.`,
		groupMeta: session.groupByPath
			? session.activeGroup !== undefined
				? `Grouped by "${session.groupByPath}". Active group: ${session.activeGroup}.`
				: `Grouped by "${session.groupByPath}". Showing top ${groupEntries.length} groups from current search scope.`
			: 'Group by a dotted path like meta.type or items.0.id.',
		resultMeta: session.filteredIndices.length > 0
			? `Page ${currentPage} of ${resultPageCount}. Showing ${resultEntries.length} results with ${session.resultsPerPage} per page. Current result ${filteredPosition + 1} of ${session.filteredIndices.length}.`
			: 'No visible results for the current search/group filters.',
		bulkMeta: session.items.length > 0
			? `Bulk actions can target ${session.filteredIndices.length} filtered results, ${currentPageIndices.length} results on the current page, or an absolute object range like 1 to 20.`
			: 'Bulk actions become available when the collection has visible objects.',
		groupEntries,
		resultEntries,
		suggestedCompareIndex: hasCurrentItem && session.items.length > 1
			? String(Math.min(session.items.length, session.currentIndex === 0 ? 2 : 1))
			: '',
		absoluteIndexValue: hasCurrentItem ? String(session.currentIndex + 1) : '',
		resultIndexValue: filteredPosition >= 0 ? String(filteredPosition + 1) : '',
		resultPageValue: session.filteredIndices.length > 0 ? String(currentPage) : '',
		resultsPerPageValue: String(session.resultsPerPage),
		statusMessage,
		statusKind,
			enabled: {
			prev: hasCurrentItem && session.currentIndex > 0,
			next: hasCurrentItem && session.currentIndex < session.items.length - 1,
			save: hasCurrentItem,
			apply: true,
			reopenEditor: hasCurrentItem,
			saveAsFile: hasCurrentItem,
			insertBefore: true,
			insertAfter: true,
			appendToEnd: true,
			remove: hasCurrentItem,
			diff: hasCurrentItem && session.items.length > 1,
				applySearch: true,
				clearSearch: session.searchQuery.length > 0,
				toggleEmptyObjects: true,
				toggleDuplicateObjects: true,
				applyGroup: true,
			clearGroup: session.groupByPath.length > 0 || session.activeGroup !== undefined,
			jumpAbsolute: hasCurrentItem,
			jumpResult: session.filteredIndices.length > 0,
			prevResultPage: session.filteredIndices.length > 0 && session.resultPage > 0,
			nextResultPage: session.filteredIndices.length > 0 && session.resultPage < resultPageCount - 1,
			setResultPage: session.filteredIndices.length > 0,
			setResultsPerPage: true,
			runBulkAction: session.items.length > 0,
		},
	});
}

function updateViewerItemFromDraft(
	session: ObjectViewerSession,
	text: string,
	options: ReturnType<typeof getFormatOptions>,
): void {
	if (session.items.length === 0) {
		return;
	}
	session.items[session.currentIndex] = parseEditableCollectionItem(text, session.syntax, options);
	session.searchTextCache.delete(session.currentIndex);
	session.summaryCache.delete(session.currentIndex);
	session.signatureCache.delete(session.currentIndex);
	session.signatureCounts.clear();
}

function getItemDocumentText(session: ObjectViewerSession): string {
	if (!session.itemDocumentUri) {
		throw new Error('Current item editor is not open.');
	}
	const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === session.itemDocumentUri?.toString());
	if (!document) {
		throw new Error('Current item editor was closed. Use Reopen Item Editor and try again.');
	}
	return document.getText();
}

async function syncViewerItemFromEditor(
	session: ObjectViewerSession,
	options: ReturnType<typeof getFormatOptions>,
): Promise<void> {
	if (session.items.length === 0) {
		return;
	}
	updateViewerItemFromDraft(session, getItemDocumentText(session), options);
}

async function saveViewerItemEditor(session: ObjectViewerSession): Promise<void> {
	if (!session.itemDocumentUri) {
		throw new Error('Current item editor is not open.');
	}
	const document = await vscode.workspace.openTextDocument(session.itemDocumentUri);
	const saved = await document.save();
	if (!saved) {
		throw new Error('Failed to save the current item editor.');
	}
}

async function refreshViewerAfterSave(session: ObjectViewerSession): Promise<void> {
	if (!session.panel) {
		return;
	}
	const sourceEditor = findVisibleEditor(session.documentUri);
	const options = getFormatOptions(sourceEditor);
	refreshBrowseState(session);
	await postObjectViewerState(session.panel, session, options);
}

async function saveCurrentItemAsFile(
	session: ObjectViewerSession,
	options: ReturnType<typeof getFormatOptions>,
): Promise<string | undefined> {
	if (session.items.length === 0) {
		throw new Error('There is no current item to save.');
	}
	await syncViewerItemFromEditor(session, options);
	const extension = getViewerItemFileExtension(session);
	const target = await vscode.window.showSaveDialog({
		saveLabel: 'Save Current Item',
		filters: { 'Pretty Objects Item': [extension] },
		defaultUri: vscode.Uri.joinPath(vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file('/tmp'), `pretty-objects-item-${session.currentIndex + 1}.${extension}`),
	});
	if (!target) {
		return undefined;
	}
	const text = printEditableCollectionItem(session.items[session.currentIndex], session.syntax, options);
	await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
	return target.fsPath;
}

async function openOrRefreshItemEditor(
	session: ObjectViewerSession,
	options: ReturnType<typeof getFormatOptions>,
	fileSystemProvider: PrettyObjectsViewerFileSystemProvider,
): Promise<void> {
	const content = session.items[session.currentIndex]
		? printEditableCollectionItem(session.items[session.currentIndex], session.syntax, options)
		: printEditableCollectionItem(createDefaultCollectionItem(undefined), session.syntax, options);
	const language = viewerLanguageId(session);
	const itemUri = getViewerItemUri(session);
	if (session.itemDocumentUri && session.itemDocumentUri.toString() !== itemUri.toString()) {
		viewerSessionsByItemUri.delete(session.itemDocumentUri.toString());
		await closeViewerDiffEditors(session);
		await closeViewerItemEditor(session);
		fileSystemProvider.deleteMemoryFile(session.itemDocumentUri);
	}
	fileSystemProvider.writeMemoryFile(itemUri, content);
	session.itemDocumentUri = itemUri;
	viewerSessionsByItemUri.set(itemUri.toString(), session);
	const itemDocument = await vscode.workspace.openTextDocument(itemUri);
	if (itemDocument.languageId !== language) {
		await vscode.languages.setTextDocumentLanguage(itemDocument, language);
	}
	await vscode.window.showTextDocument(itemDocument, {
		viewColumn: session.sourceViewColumn,
		preserveFocus: true,
		preview: false,
	});
}

async function openObjectDiff(
	session: ObjectViewerSession,
	compareIndex: number,
	options: ReturnType<typeof getFormatOptions>,
): Promise<void> {
	if (!Number.isInteger(compareIndex) || compareIndex < 0 || compareIndex >= session.items.length || compareIndex === session.currentIndex) {
		throw new Error('Pick a different object to diff against.');
	}
	const leftText = printEditableCollectionItem(session.items[session.currentIndex], session.syntax, options);
	const rightText = printEditableCollectionItem(session.items[compareIndex], session.syntax, options);
	const language = viewerLanguageId(session);
	await closeViewerDiffEditors(session);
	const leftUri = getViewerDiffUri(session, 'left', compareIndex);
	const rightUri = getViewerDiffUri(session, 'right', compareIndex);
	viewerFileSystemProvider.writeMemoryFile(leftUri, leftText);
	viewerFileSystemProvider.writeMemoryFile(rightUri, rightText);
	session.diffDocumentUris = [leftUri, rightUri];
	const leftDocument = await vscode.workspace.openTextDocument(leftUri);
	const rightDocument = await vscode.workspace.openTextDocument(rightUri);
	if (leftDocument.languageId !== language) {
		await vscode.languages.setTextDocumentLanguage(leftDocument, language);
	}
	if (rightDocument.languageId !== language) {
		await vscode.languages.setTextDocumentLanguage(rightDocument, language);
	}
	await vscode.commands.executeCommand(
		'vscode.diff',
		leftUri,
		rightUri,
		`Pretty Objects Diff (#${session.currentIndex + 1} ↔ #${compareIndex + 1})`,
	);
}

async function applyObjectViewerSession(
	session: ObjectViewerSession,
	options: ReturnType<typeof getFormatOptions>,
): Promise<void> {
	const document = await vscode.workspace.openTextDocument(session.documentUri);
	if (document.version !== session.documentVersion) {
		throw new Error('The source document changed after the viewer opened. Reopen Object Viewer to avoid overwriting newer edits.');
	}
	const replacement = serializeEditableCollection(session.items, session.syntax, options);
	const original = document.getText();
	restoreState.set(documentKey(document), { text: original });
	const edit = new vscode.WorkspaceEdit();
	edit.replace(document.uri, createFullRange(document), replacement);
	const applied = await vscode.workspace.applyEdit(edit);
	if (!applied) {
		restoreState.delete(documentKey(document));
		throw new Error('Failed to apply Object Viewer changes.');
	}
	const updated = await vscode.workspace.openTextDocument(session.documentUri);
	session.documentVersion = updated.version;
}

async function openObjectViewer(context: vscode.ExtensionContext): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		void vscode.window.showErrorMessage('No active editor found.');
		return;
	}

	const options = getFormatOptions(editor);
	const text = editor.document.getText();
	const syntax = inferSyntax(editor.document, text);

	if (!syntax) {
		void vscode.window.showErrorMessage('No supported object syntax detected in the active content.');
		return;
	}

	try {
		const collection = parseEditableCollection(text, syntax, options);
		const panel = vscode.window.createWebviewPanel(
			'prettyObjects.objectViewer',
			'Pretty Objects Viewer',
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
			},
		);
			const session: ObjectViewerSession = {
				documentUri: editor.document.uri,
				documentVersion: editor.document.version,
			languageId: editor.document.languageId,
			syntax: collection.syntax,
			items: [...collection.items],
			currentIndex: 0,
			sourceViewColumn: editor.viewColumn,
				filteredIndices: [],
				searchQuery: '',
				groupByPath: '',
				activeGroup: undefined,
				showOnlyEmptyObjects: false,
				showOnlyDuplicateObjects: false,
				searchTextCache: new Map<number, string>(),
				summaryCache: new Map<number, string>(),
				signatureCache: new Map<number, string>(),
				signatureCounts: new Map<string, number>(),
				viewerDocumentId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
				resultPage: 0,
				resultsPerPage: DEFAULT_RESULTS_PER_PAGE,
				diffDocumentUris: [],
				panel,
			};
		refreshBrowseState(session);
		panel.webview.html = await getObjectViewerHtml(context);
		await openOrRefreshItemEditor(session, options, viewerFileSystemProvider);
		panel.onDidDispose(() => {
			void closeViewerDiffEditors(session);
			void closeViewerItemEditor(session);
			if (session.itemDocumentUri) {
				viewerSessionsByItemUri.delete(session.itemDocumentUri.toString());
				viewerFileSystemProvider.deleteMemoryFile(session.itemDocumentUri);
			}
		});

		panel.webview.onDidReceiveMessage(async (message: unknown) => {
			const request = asObjectViewerMessage(message);
			if (!request) {
				return;
			}

				try {
					switch (request.type) {
						case 'ready':
							await postObjectViewerState(panel, session, options);
							return;
						case 'changeResultPage':
							if (typeof request.delta !== 'number') {
								throw new Error('Invalid page change request.');
							}
							session.resultPage += request.delta;
							clampResultPage(session);
							await postObjectViewerState(panel, session, options);
							return;
						case 'setResultPage':
							if (typeof request.page !== 'number' || !Number.isInteger(request.page)) {
								throw new Error('Enter a valid page number.');
							}
							session.resultPage = request.page;
							clampResultPage(session);
							await postObjectViewerState(panel, session, options);
							return;
						case 'setResultsPerPage':
							session.resultsPerPage = normalizeResultsPerPage(request.value);
							clampResultPage(session);
							await postObjectViewerState(panel, session, options, `Showing ${session.resultsPerPage} objects per page.`, 'success');
							return;
						case 'runBulkAction': {
							await syncViewerItemFromEditor(session, options);
							const scope = request.scope === 'page' || request.scope === 'range' ? request.scope : 'filtered';
							const targetIndices = scope === 'page'
								? getCurrentPageIndices(session)
								: scope === 'range'
									? getAbsoluteRangeIndices(session, request.rangeStart, request.rangeEnd)
									: [...session.filteredIndices];
							if (targetIndices.length === 0) {
								throw new Error('No visible results are available for bulk actions.');
							}
							let removedCount = 0;
							let message = '';
							const scopeLabel = scope === 'page'
								? 'current page'
								: scope === 'range'
									? `range ${Math.min(request.rangeStart ?? 0, request.rangeEnd ?? 0) + 1} to ${Math.max(request.rangeStart ?? 0, request.rangeEnd ?? 0) + 1}`
									: 'filtered results';
							switch (request.action) {
								case 'delete':
									removedCount = removeIndicesFromCollection(session, targetIndices);
									message = `Deleted ${removedCount} ${removedCount === 1 ? 'object' : 'objects'} from the ${scopeLabel}.`;
									break;
								case 'deleteEmptyObjects': {
									const emptyIndices = targetIndices.filter((index) => isEmptyObjectItem(session, index));
									removedCount = removeIndicesFromCollection(session, emptyIndices);
									message = removedCount > 0
										? `Deleted ${removedCount} empty ${removedCount === 1 ? 'object' : 'objects'} from the ${scopeLabel}.`
										: `No empty objects were found in the ${scopeLabel}.`;
									break;
								}
								case 'deleteDuplicateObjects': {
									const duplicateIndices = getDuplicateIndicesInScope(session, targetIndices);
									removedCount = removeIndicesFromCollection(session, duplicateIndices);
									message = removedCount > 0
										? `Deleted ${removedCount} duplicate ${removedCount === 1 ? 'object' : 'objects'} from the ${scopeLabel}, keeping the first match in each group.`
										: `No duplicate objects were found in the ${scopeLabel}.`;
									break;
								}
								default:
									throw new Error('Choose a valid bulk action.');
							}
							if (session.items.length > 0) {
								await openOrRefreshItemEditor(session, options, viewerFileSystemProvider);
							} else {
								await closeViewerItemEditor(session);
							}
							await postObjectViewerState(panel, session, options, message, 'success');
							return;
						}
						case 'saveItem':
							await saveViewerItemEditor(session);
							await syncViewerItemFromEditor(session, options);
							refreshBrowseState(session);
							await postObjectViewerState(panel, session, options, 'Object saved and applied to the source document.', 'success');
							return;
					case 'navigate': {
						await syncViewerItemFromEditor(session, options);
						if (typeof request.delta !== 'number') {
							throw new Error('Invalid navigation request.');
						}
						const filteredPosition = getCurrentFilteredPosition(session);
						if (filteredPosition >= 0) {
							const nextPosition = Math.max(0, Math.min(session.filteredIndices.length - 1, filteredPosition + request.delta));
							session.currentIndex = session.filteredIndices[nextPosition];
						} else {
							session.currentIndex = Math.max(0, Math.min(session.items.length - 1, session.currentIndex + request.delta));
						}
						await openOrRefreshItemEditor(session, options, viewerFileSystemProvider);
						await postObjectViewerState(panel, session, options);
						return;
					}
					case 'insertItem': {
						if (session.items.length > 0) {
							await syncViewerItemFromEditor(session, options);
						}
						const reference = getViewerInsertReference(session);
						const nextItem = createDefaultCollectionItem(reference);
						const insertAt = session.items.length === 0
							? 0
								: request.position === 'end'
									? session.items.length
								: request.position === 'before'
									? session.currentIndex
									: session.currentIndex + 1;
						session.items.splice(insertAt, 0, nextItem);
						session.currentIndex = insertAt;
						invalidateBrowseCaches(session);
						refreshBrowseState(session);
						await openOrRefreshItemEditor(session, options, viewerFileSystemProvider);
						await postObjectViewerState(panel, session, options, 'Inserted a new item.', 'success');
						return;
					}
					case 'removeItem':
						if (session.items.length === 0) {
							await postObjectViewerState(panel, session, options);
							return;
						}
						session.items.splice(session.currentIndex, 1);
						session.currentIndex = Math.max(0, Math.min(session.currentIndex, session.items.length - 1));
						invalidateBrowseCaches(session);
						refreshBrowseState(session);
						if (session.items.length > 0) {
							await openOrRefreshItemEditor(session, options, viewerFileSystemProvider);
						}
						await postObjectViewerState(panel, session, options, 'Removed the current item.', 'success');
						return;
					case 'openDiff':
						await syncViewerItemFromEditor(session, options);
						await openObjectDiff(session, typeof request.compareIndex === 'number' ? request.compareIndex : -1, options);
						await postObjectViewerState(panel, session, options);
						return;
						case 'applyDocument':
							await saveViewerItemEditor(session);
							await syncViewerItemFromEditor(session, options);
							await applyObjectViewerSession(session, options);
							refreshBrowseState(session);
							await postObjectViewerState(panel, session, options, 'Applied changes to the document.', 'success');
						return;
					case 'reopenEditor':
						await openOrRefreshItemEditor(session, options, viewerFileSystemProvider);
						await postObjectViewerState(panel, session, options, 'Item editor reopened.', 'success');
						return;
						case 'saveAsFile': {
							const savedPath = await saveCurrentItemAsFile(session, options);
						await postObjectViewerState(
							panel,
							session,
							options,
							savedPath ? `Saved current item to ${savedPath}.` : 'Save As File cancelled.',
							savedPath ? 'success' : undefined,
							);
							return;
						}
						case 'toggleEmptyObjects':
							await syncViewerItemFromEditor(session, options);
							session.showOnlyEmptyObjects = !session.showOnlyEmptyObjects;
							refreshBrowseState(session);
							if (session.items.length > 0 && session.filteredIndices.length > 0) {
								await openOrRefreshItemEditor(session, options, viewerFileSystemProvider);
							}
							await postObjectViewerState(panel, session, options, `Empty object filter ${session.showOnlyEmptyObjects ? 'enabled' : 'disabled'}.`, 'success');
							return;
						case 'toggleDuplicateObjects':
							await syncViewerItemFromEditor(session, options);
							session.showOnlyDuplicateObjects = !session.showOnlyDuplicateObjects;
							refreshBrowseState(session);
							if (session.items.length > 0 && session.filteredIndices.length > 0) {
								await openOrRefreshItemEditor(session, options, viewerFileSystemProvider);
							}
							await postObjectViewerState(panel, session, options, `Duplicate filter ${session.showOnlyDuplicateObjects ? 'enabled' : 'disabled'}.`, 'success');
							return;
						case 'setSearch':
						await syncViewerItemFromEditor(session, options);
						session.searchQuery = request.query?.trim() ?? '';
						refreshBrowseState(session);
						if (session.items.length > 0 && session.filteredIndices.length > 0) {
							session.currentIndex = session.filteredIndices[Math.max(0, getCurrentFilteredPosition(session))];
							await openOrRefreshItemEditor(session, options, viewerFileSystemProvider);
						}
						await postObjectViewerState(panel, session, options, `Search updated. ${session.filteredIndices.length} results in scope.`, 'success');
						return;
					case 'clearSearch':
						await syncViewerItemFromEditor(session, options);
						session.searchQuery = '';
						refreshBrowseState(session);
						if (session.items.length > 0) {
							await openOrRefreshItemEditor(session, options, viewerFileSystemProvider);
						}
						await postObjectViewerState(panel, session, options, 'Search cleared.', 'success');
						return;
					case 'setGroupPath':
						await syncViewerItemFromEditor(session, options);
						session.groupByPath = request.path?.trim() ?? '';
						session.activeGroup = undefined;
						refreshBrowseState(session);
						await postObjectViewerState(panel, session, options, session.groupByPath ? 'Grouping path updated.' : 'Grouping path cleared.', 'success');
						return;
					case 'clearGroup':
						await syncViewerItemFromEditor(session, options);
						session.groupByPath = '';
						session.activeGroup = undefined;
						refreshBrowseState(session);
						if (session.items.length > 0) {
							await openOrRefreshItemEditor(session, options, viewerFileSystemProvider);
						}
						await postObjectViewerState(panel, session, options, 'Grouping cleared.', 'success');
						return;
					case 'selectGroup':
						await syncViewerItemFromEditor(session, options);
						session.activeGroup = request.value;
						refreshBrowseState(session);
						if (session.items.length > 0 && session.filteredIndices.length > 0) {
							session.currentIndex = session.filteredIndices[0];
							await openOrRefreshItemEditor(session, options, viewerFileSystemProvider);
						}
						await postObjectViewerState(panel, session, options, `Group selected: ${request.value ?? '(all)'}.`, 'success');
						return;
					case 'jumpAbsolute':
						if (typeof request.index !== 'number' || !Number.isInteger(request.index)) {
							throw new Error('Enter a valid absolute index.');
						}
						await syncViewerItemFromEditor(session, options);
						setCurrentIndex(session, request.index);
						await openOrRefreshItemEditor(session, options, viewerFileSystemProvider);
						await postObjectViewerState(panel, session, options);
						return;
					case 'jumpResult':
						if (typeof request.position !== 'number' || !Number.isInteger(request.position)) {
							throw new Error('Enter a valid result number.');
						}
						if (request.position < 0 || request.position >= session.filteredIndices.length) {
							throw new Error('Result number is outside the current filtered result set.');
						}
						await syncViewerItemFromEditor(session, options);
						session.currentIndex = session.filteredIndices[request.position];
						await openOrRefreshItemEditor(session, options, viewerFileSystemProvider);
						await postObjectViewerState(panel, session, options);
						return;
					case 'openResult':
						if (typeof request.index !== 'number' || !Number.isInteger(request.index)) {
							throw new Error('Invalid result selection.');
						}
						await syncViewerItemFromEditor(session, options);
						setCurrentIndex(session, request.index);
						await openOrRefreshItemEditor(session, options, viewerFileSystemProvider);
						await postObjectViewerState(panel, session, options);
						return;
					default:
						return;
				}
			} catch (error) {
				await postObjectViewerState(
					panel,
					session,
					options,
					error instanceof Error ? error.message : 'Object Viewer action failed.',
					'error',
				);
			}
		});
	} catch (error) {
		void vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Failed to open Object Viewer.');
	}
}

async function runFormatCommand(mode: 'selection' | 'document' | 'preview' | 'jsonlPrettyView'): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		void vscode.window.showErrorMessage('No active editor found.');
		return;
	}

	const options = getFormatOptions(editor);
	const target = mode === 'document'
		? { range: createFullRange(editor.document), text: editor.document.getText() }
		: getSelectionOrDocument(editor);
	const syntax = inferSyntax(editor.document, target.text);

	if (!syntax) {
		void vscode.window.showErrorMessage('No supported object syntax detected in the active content.');
		return;
	}

	try {
		const isFullDocument = target.range.isEqual(createFullRange(editor.document));
		const formatted = isFullDocument && (syntax === 'javascript' || syntax === 'typescript' || syntax === 'python')
			? formatProgramDocument(target.text, syntax, options)
			: formatTarget(target.text, syntax, options, mode === 'jsonlPrettyView' ? 'prettyView' : undefined);
		if (formatted.formattedText === target.text) {
			return;
		}
		const shouldPreview = mode === 'preview' || (mode !== 'jsonlPrettyView' && vscode.workspace.getConfiguration('prettyObjects').get<boolean>('previewBeforeApply', false));
		if (shouldPreview) {
			await openPreviewAndMaybeApply(editor, 'Pretty Objects Preview', target.range, formatted.formattedText, restoreState);
			return;
		}
		const applied = await replaceRange(editor, target.range, formatted.formattedText, restoreState);
		const collapseByDefault = vscode.workspace.getConfiguration('prettyObjects').get<boolean>('collapseNestedFieldsByDefault', true);
		if (applied && collapseByDefault && (mode === 'document' || mode === 'jsonlPrettyView')) {
			await collapsePrettyView(editor);
		}
	} catch (error) {
		void vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Failed to prettify content.');
	}
}

export function activate(context: vscode.ExtensionContext): void {
	const selectors: vscode.DocumentSelector = [
		{ language: 'json' },
		{ language: 'jsonc' },
		{ language: 'javascript' },
		{ language: 'javascriptreact' },
		{ language: 'typescript' },
		{ language: 'typescriptreact' },
		{ language: 'python' },
		{ pattern: '**/*.jsonl' },
		{ pattern: '**/*.ndjson' },
	];

	const diagnostics = vscode.languages.createDiagnosticCollection('pretty-objects');

	context.subscriptions.push(
		diagnostics,
		vscode.workspace.registerFileSystemProvider(VIEWER_DOCUMENT_SCHEME, viewerFileSystemProvider, {
			isCaseSensitive: true,
			isReadonly: false,
		}),
		vscode.workspace.registerFileSystemProvider(DEMO_DOCUMENT_SCHEME, viewerFileSystemProvider, {
			isCaseSensitive: true,
			isReadonly: false,
		}),
		vscode.workspace.onWillSaveTextDocument((event) => {
			if (event.document.uri.scheme !== VIEWER_DOCUMENT_SCHEME) {
				return;
			}
			const session = viewerSessionsByItemUri.get(event.document.uri.toString());
			const options = getFormatOptions(undefined);
			const text = event.document.getText();
			const syntax = inferSyntax(event.document, text);
			if (!syntax) {
				if (!session || options.repairMode !== 'bestEffort') {
					return;
				}
				const converted = bestEffortTextToValue(text);
				if (!converted) {
					return;
				}
				event.waitUntil(Promise.resolve([
					vscode.TextEdit.replace(createFullRange(event.document), printEditableCollectionItem(converted, session.syntax, options)),
				]));
				return;
			}
			try {
				const formatted = formatTarget(text, syntax, options);
				if (formatted.formattedText === text) {
					return;
				}
				event.waitUntil(Promise.resolve([
					vscode.TextEdit.replace(createFullRange(event.document), formatted.formattedText),
				]));
			} catch {
				if (!session || options.repairMode !== 'bestEffort') {
					return;
				}
				const converted = bestEffortTextToValue(text);
				if (!converted) {
					return;
				}
				event.waitUntil(Promise.resolve([
					vscode.TextEdit.replace(createFullRange(event.document), printEditableCollectionItem(converted, session.syntax, options)),
				]));
			}
		}),
		vscode.workspace.onDidSaveTextDocument(async (document) => {
			if (document.uri.scheme !== VIEWER_DOCUMENT_SCHEME) {
				return;
			}
			const session = viewerSessionsByItemUri.get(document.uri.toString());
			if (!session) {
				return;
			}
			try {
				const sourceEditor = findVisibleEditor(session.documentUri);
				const options = getFormatOptions(sourceEditor);
				updateViewerItemFromDraft(session, document.getText(), options);
				refreshBrowseState(session);
				await applyObjectViewerSession(session, options);
				await refreshViewerAfterSave(session);
			} catch {
				return;
			}
		}),
		vscode.workspace.onDidCloseTextDocument((document) => {
			if (document.uri.scheme !== DEMO_DOCUMENT_SCHEME) {
				return;
			}
			openDemoDocumentUris.delete(document.uri.toString());
			viewerFileSystemProvider.deleteMemoryFile(document.uri);
		}),
		vscode.commands.registerCommand(COMMAND_PRETTIFY_SELECTION, async () => runFormatCommand('selection')),
		vscode.commands.registerCommand(COMMAND_PRETTIFY_DOCUMENT, async () => runFormatCommand('document')),
		vscode.commands.registerCommand(COMMAND_PRETTIFY_PREVIEW, async () => runFormatCommand('preview')),
		vscode.commands.registerCommand(COMMAND_JSONL_PRETTY_VIEW, async () => runFormatCommand('jsonlPrettyView')),
		vscode.commands.registerCommand(COMMAND_COLLAPSE, async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}
			await collapsePrettyView(editor);
		}),
		vscode.commands.registerCommand(COMMAND_EXPAND, async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}
			await expandPrettyView(editor);
		}),
		vscode.commands.registerCommand(COMMAND_TOGGLE_KEYBINDING, async () => {
			const configuration = vscode.workspace.getConfiguration('prettyObjects');
			const current = configuration.get<boolean>('enableKeybinding', true);
			const next = !current;
			await configuration.update('enableKeybinding', next, vscode.ConfigurationTarget.Global);
			await syncKeybindingContext();
			void vscode.window.showInformationMessage(`Pretty Objects keybinding is now ${next ? 'enabled' : 'disabled'}.`);
		}),
		vscode.commands.registerCommand(COMMAND_SET_DEFAULT_FORMATTER, async () => {
			await setAsDefaultFormatter(context.extension.id);
		}),
		vscode.commands.registerCommand(COMMAND_SPLIT_LARGE_FILE, async () => {
			await runSplitLargeFileCommand();
		}),
		vscode.commands.registerCommand(COMMAND_OPEN_WELCOME, async () => {
			await openWelcome(context, true, () => {
				void closeAllDemoTabs();
			});
		}),
		vscode.commands.registerCommand(COMMAND_RESET_STATE, async () => {
			await resetExtensionState(context);
		}),
		vscode.commands.registerCommand(COMMAND_DEMO_PRETTIFY, async () => {
			await runPrettifyRepairDemo(context);
		}),
		vscode.commands.registerCommand(COMMAND_DEMO_JSONL, async () => {
			await runJsonlPrettyViewDemo(context);
		}),
		vscode.commands.registerCommand(COMMAND_DEMO_OBJECT_VIEWER, async () => {
			await runObjectViewerDemo(context);
		}),
		vscode.commands.registerCommand(COMMAND_DEMO_FOLDING, async () => {
			await runCollapseDemo(context);
		}),
		vscode.commands.registerCommand(COMMAND_DEMO_TEXT_TO_JSON, async () => {
			await runTextToJsonDemo(context);
		}),
		vscode.commands.registerCommand(COMMAND_DEMO_LITERAL_PAYLOADS, async () => {
			await runLiteralPayloadsDemo(context);
		}),
		vscode.commands.registerCommand(COMMAND_DEMO_PYTHON_PAYLOADS, async () => {
			await runPythonPayloadsDemo(context);
		}),
		vscode.commands.registerCommand(COMMAND_OPEN_OBJECT_VIEWER, async () => {
			await openObjectViewer(context);
		}),
		vscode.commands.registerCommand(COMMAND_RESTORE, async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}
			const entry = restoreState.get(documentKey(editor.document));
			if (!entry) {
				void vscode.window.showInformationMessage('No previous prettify result to restore.');
				return;
			}
			await replaceRange(editor, createFullRange(editor.document), entry.text, restoreState);
		}),
		vscode.languages.registerDocumentFormattingEditProvider(selectors, new PrettyObjectsFormattingProvider(restoreState)),
		vscode.languages.registerDocumentRangeFormattingEditProvider(selectors, new PrettyObjectsFormattingProvider(restoreState)),
		vscode.languages.registerFoldingRangeProvider(selectors, new PrettyObjectsFoldingProvider()),
		vscode.languages.registerCodeActionsProvider(selectors, new PrettyObjectsCodeActionProvider(), {
			providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
		}),
		vscode.window.onDidChangeActiveTextEditor(() => refreshDiagnostics(diagnostics)),
		vscode.workspace.onDidChangeConfiguration(async (event) => {
			if (event.affectsConfiguration('prettyObjects.enableKeybinding') || event.affectsConfiguration('prettyObjects.enableObjectViewerKeybinding')) {
				await syncKeybindingContext();
			}
		}),
		vscode.workspace.onDidChangeTextDocument((event) => {
			const active = vscode.window.activeTextEditor;
			if (active && event.document.uri.toString() === active.document.uri.toString()) {
				refreshDiagnostics(diagnostics);
			}
		}),
		vscode.workspace.onDidOpenTextDocument((document) => {
			const active = vscode.window.activeTextEditor;
			if (active && document.uri.toString() === active.document.uri.toString()) {
				refreshDiagnostics(diagnostics);
			}
		}),
	);

	runStartupTask('sync keybinding context', () => syncKeybindingContext());
	runStartupTask('open welcome', () => openWelcome(context, false, () => {
		runStartupTask('close demo tabs on welcome dispose', () => closeAllDemoTabs());
	}));
	runStartupTask('close stale viewer tabs', () => closeStaleViewerTabs());
	runStartupTask('close stale demo tabs', () => closeStaleDemoTabs());
	setTimeout(() => {
		runStartupTask('close stale viewer tabs (delayed)', () => closeStaleViewerTabs());
		runStartupTask('close stale demo tabs (delayed)', () => closeStaleDemoTabs());
	}, 750);
	try {
		refreshDiagnostics(diagnostics);
	} catch (error) {
		console.error('[pretty-objects] Initial diagnostics refresh failed.', error);
	}
}

export function deactivate(): void {}
