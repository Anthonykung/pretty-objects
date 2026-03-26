/*
 * File: formatting.ts
 * Project: pretty-objects
 * Author: Anthony Kung <hi@anth.dev> (https://anth.dev)
 * License: Apache-2.0
 */

import * as path from 'path';
import * as vscode from 'vscode';

import { analyzeSyntaxText, formatTarget } from './engine';
import { formatProgramDocument } from './programFormatting';
import { FormatOptions, ParseResult, SyntaxKind } from './types';

export interface AnalysisResult {
	supported: boolean;
	syntax?: SyntaxKind;
	parseResult?: ParseResult;
	message?: string;
}

export function getFormatOptions(editor: vscode.TextEditor | undefined): FormatOptions {
	const configuration = vscode.workspace.getConfiguration('prettyObjects');
	const spaceCount = Math.max(1, editor?.options.tabSize ? Number(editor.options.tabSize) : 2);
	const indentUnit = editor?.options.insertSpaces === false ? '\t' : ' '.repeat(spaceCount);

	return {
		indentUnit,
		lineEnding: editor?.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
		repairMode: configuration.get<'deterministic' | 'moderate' | 'bestEffort'>('repairMode', 'deterministic'),
		jsonlMode: configuration.get<'linePreserving' | 'prettyView'>('jsonlMode', 'linePreserving'),
		jsTsQuoteStyle: configuration.get<'single' | 'double'>('quoteStyle.jsTs', 'single'),
		pythonQuoteStyle: configuration.get<'single' | 'double'>('quoteStyle.python', 'single'),
		maxDocumentSize: configuration.get<number>('maxDocumentSize', 1_000_000),
	};
}

export function inferSyntax(document: vscode.TextDocument, text: string): SyntaxKind | undefined {
	const extension = path.extname(document.uri.fsPath).toLowerCase();
	if (document.languageId === 'json' || document.languageId === 'jsonc') {
		return extension === '.jsonl' || extension === '.ndjson' ? 'jsonl' : 'json';
	}
	if (document.languageId === 'jsonl' || extension === '.jsonl' || extension === '.ndjson') {
		return 'jsonl';
	}
	if (document.languageId === 'javascript' || document.languageId === 'javascriptreact') {
		return 'javascript';
	}
	if (document.languageId === 'typescript' || document.languageId === 'typescriptreact') {
		return 'typescript';
	}
	if (document.languageId === 'python') {
		return 'python';
	}
	const trimmed = text.trim();
	if (trimmed === '') {
		return undefined;
	}
	if (extension === '.jsonl' || extension === '.ndjson') {
		return 'jsonl';
	}
	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		return 'json';
	}
	return undefined;
}

export function analyzeText(document: vscode.TextDocument, text: string, options: FormatOptions): AnalysisResult {
	if (text.length > options.maxDocumentSize) {
		return {
			supported: false,
			message: `Selection exceeds the configured maxDocumentSize (${options.maxDocumentSize} bytes).`,
		};
	}

	const syntax = inferSyntax(document, text);
	if (!syntax) {
		return { supported: false, message: 'No supported object syntax detected.' };
	}

	if (syntax === 'jsonl') {
		return { supported: true, syntax, parseResult: analyzeSyntaxText(text, syntax, options) };
	}

	if (
		text === document.getText()
		&& (syntax === 'javascript' || syntax === 'typescript' || syntax === 'python')
	) {
		try {
			formatProgramDocument(text, syntax, options);
			return {
				supported: true,
				syntax,
				parseResult: { ok: true, value: { kind: 'array', items: [] } },
			};
		} catch (error) {
			return {
				supported: false,
				message: error instanceof Error ? error.message : 'No supported object syntax detected.',
			};
		}
	}

	return {
		supported: true,
		syntax,
		parseResult: analyzeSyntaxText(text, syntax, options),
	};
}

export function getSelectionOrDocument(editor: vscode.TextEditor): { range: vscode.Range; text: string } {
	const selection = editor.selection;
	if (!selection.isEmpty) {
		return {
			range: new vscode.Range(selection.start, selection.end),
			text: editor.document.getText(selection),
		};
	}
	const fullRange = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length));
	return {
		range: fullRange,
		text: editor.document.getText(),
	};
}
