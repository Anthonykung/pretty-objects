/*
 * File: providers.ts
 * Project: pretty-objects
 * Author: Anthony Kung <hi@anth.dev> (https://anth.dev)
 * License: Apache-2.0
 */

import * as vscode from 'vscode';

import { formatTarget } from './core/engine';
import { computeFoldTargets } from './core/folding';
import { analyzeText, getFormatOptions, getSelectionOrDocument, inferSyntax } from './core/formatting';
import { formatProgramDocument } from './core/programFormatting';
import { COMMAND_PRETTIFY_PREVIEW, COMMAND_PRETTIFY_SELECTION } from './commands';
import { createFullRange, documentKey, RestoreEntry } from './editorUtils';

export class PrettyObjectsFormattingProvider implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {
	constructor(private readonly restoreState: Map<string, RestoreEntry>) {}

	provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
		return this.provideEdits(document, createFullRange(document));
	}

	provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range): vscode.TextEdit[] {
		return this.provideEdits(document, range);
	}

	private provideEdits(document: vscode.TextDocument, range: vscode.Range): vscode.TextEdit[] {
		const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.toString() === document.uri.toString());
		const options = getFormatOptions(editor);
		const text = document.getText(range);
		const syntax = inferSyntax(document, text);
		if (!syntax || text.length > options.maxDocumentSize) {
			return [];
		}

		try {
			const isFullDocument = range.isEqual(createFullRange(document));
			const formatted = isFullDocument && (syntax === 'javascript' || syntax === 'typescript' || syntax === 'python')
				? formatProgramDocument(text, syntax, options)
				: formatTarget(text, syntax, options);
			if (formatted.formattedText === text) {
				return [];
			}
			this.restoreState.set(documentKey(document), { text: document.getText() });
			return [vscode.TextEdit.replace(range, formatted.formattedText)];
		} catch {
			return [];
		}
	}
}

export class PrettyObjectsCodeActionProvider implements vscode.CodeActionProvider {
	provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
		const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.toString() === document.uri.toString());
		const options = getFormatOptions(editor);
		const selectedText = document.getText(range);
		const text = selectedText.trim() === '' ? document.getText() : selectedText;
		const analysis = analyzeText(document, text, options);

		if (!analysis.supported || !analysis.syntax) {
			return [];
		}

		const actions: vscode.CodeAction[] = [];

		if (analysis.parseResult?.ok) {
			const previewAction = new vscode.CodeAction('Prettify with Preview', vscode.CodeActionKind.QuickFix);
			previewAction.command = { command: COMMAND_PRETTIFY_PREVIEW, title: 'Prettify with Preview' };
			actions.push(previewAction);
			return actions;
		}

		if (analysis.parseResult && !analysis.parseResult.ok && analysis.parseResult.error.safeRepairLabel) {
			const repairAction = new vscode.CodeAction(analysis.parseResult.error.safeRepairLabel, vscode.CodeActionKind.QuickFix);
			repairAction.command = { command: COMMAND_PRETTIFY_SELECTION, title: analysis.parseResult.error.safeRepairLabel };
			actions.push(repairAction);
		}

		return actions;
	}
}

export class PrettyObjectsFoldingProvider implements vscode.FoldingRangeProvider {
	provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
		return computeFoldTargets(document.getText()).map((target) => new vscode.FoldingRange(
			target.startLine,
			target.endLine,
			vscode.FoldingRangeKind.Region,
		));
	}
}

function createDiagnostic(document: vscode.TextDocument, message: string, offset?: number): vscode.Diagnostic {
	const safeOffset = Math.max(0, Math.min(offset ?? 0, document.getText().length));
	const position = document.positionAt(safeOffset);
	return new vscode.Diagnostic(new vscode.Range(position, position), message, vscode.DiagnosticSeverity.Warning);
}

export function refreshDiagnostics(collection: vscode.DiagnosticCollection): void {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return;
	}
	const options = getFormatOptions(editor);
	const target = getSelectionOrDocument(editor);
	const analysis = analyzeText(editor.document, target.text, options);

	if (!analysis.supported || !analysis.parseResult || analysis.parseResult.ok) {
		collection.delete(editor.document.uri);
		return;
	}

	collection.set(editor.document.uri, [createDiagnostic(editor.document, analysis.parseResult.error.message, analysis.parseResult.error.offset)]);
}
