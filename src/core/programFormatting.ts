/*
 * File: programFormatting.ts
 * Project: pretty-objects
 * Author: Anthony Kung <hi@anth.dev> (https://anth.dev)
 * License: Apache-2.0
 */

import ts from 'typescript';

import { parseJsTsLiteral } from './jsTs';
import { printValue } from './printer';
import { parsePythonLiteral } from './python';
import { FormatOptions, FormatResult, SyntaxKind } from './types';

interface Replacement {
	start: number;
	end: number;
	text: string;
}

function getLineIndent(text: string, start: number): string {
	const lineStart = text.lastIndexOf('\n', start - 1) + 1;
	let index = lineStart;
	while (index < start && (text[index] === ' ' || text[index] === '\t')) {
		index += 1;
	}
	return text.slice(lineStart, index);
}

function applyLineIndent(replacement: string, indent: string, lineEnding: string): string {
	const lines = replacement.split(/\r?\n/u);
	if (lines.length <= 1) {
		return replacement;
	}
	return [lines[0], ...lines.slice(1).map((line) => `${indent}${line}`)].join(lineEnding);
}

function applyReplacements(text: string, replacements: Replacement[]): string {
	if (replacements.length === 0) {
		return text;
	}
	let output = text;
	for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
		output = `${output.slice(0, replacement.start)}${replacement.text}${output.slice(replacement.end)}`;
	}
	return output;
}

function hasJsTsCommentTrivia(text: string, syntax: Extract<SyntaxKind, 'javascript' | 'typescript'>): boolean {
	const scanner = ts.createScanner(
		ts.ScriptTarget.Latest,
		false,
		syntax === 'javascript' ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
		text,
	);
	for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
		if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) {
			return true;
		}
	}
	return false;
}

function formatJsTsProgram(text: string, syntax: Extract<SyntaxKind, 'javascript' | 'typescript'>, options: FormatOptions): FormatResult {
	const sourceFile = ts.createSourceFile(
		syntax === 'javascript' ? 'program.js' : 'program.ts',
		text,
		ts.ScriptTarget.Latest,
		true,
		syntax === 'javascript' ? ts.ScriptKind.JS : ts.ScriptKind.TS,
	);
	const diagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
	if (diagnostics.length > 0) {
		const diagnostic = diagnostics[0];
		throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
	}

	const replacements: Replacement[] = [];

	const visit = (node: ts.Node, insideAcceptedLiteral: boolean): void => {
		if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) {
			const literalText = node.getText(sourceFile);
			if (!insideAcceptedLiteral && !hasJsTsCommentTrivia(literalText, syntax)) {
				const parsed = parseJsTsLiteral(literalText, syntax);
				if (parsed.ok) {
					const indent = getLineIndent(text, node.getStart(sourceFile));
					replacements.push({
						start: node.getStart(sourceFile),
						end: node.getEnd(),
						text: applyLineIndent(printValue(parsed.value, syntax, options), indent, options.lineEnding),
					});
					return;
				}
			}
		}
		ts.forEachChild(node, (child) => visit(child, insideAcceptedLiteral));
	};

	visit(sourceFile, false);

	if (replacements.length === 0) {
		throw new Error('No supported JS/TS object or array literals found in the document.');
	}

	return { formattedText: applyReplacements(text, replacements) };
}

type PythonStringState =
	| { kind: 'single'; quote: '\'' | '"'; escaped: boolean }
	| { kind: 'triple'; quote: '\'' | '"' };

interface PythonPair {
	open: '{' | '[' | '(';
	start: number;
	end: number;
}

function scanPythonPairs(text: string): PythonPair[] {
	const pairs: PythonPair[] = [];
	const stack: Array<{ open: '{' | '[' | '('; start: number }> = [];
	let state: PythonStringState | undefined;
	let inComment = false;

	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (inComment) {
			if (char === '\n') {
				inComment = false;
			}
			continue;
		}
		if (state) {
			if (state.kind === 'single') {
				if (state.escaped) {
					state.escaped = false;
					continue;
				}
				if (char === '\\') {
					state.escaped = true;
					continue;
				}
				if (char === state.quote) {
					state = undefined;
				}
				continue;
			}
			if (char === state.quote && text[index + 1] === state.quote && text[index + 2] === state.quote) {
				index += 2;
				state = undefined;
			}
			continue;
		}
		if (char === '#') {
			inComment = true;
			continue;
		}
		if (char === '\'' || char === '"') {
			if (text[index + 1] === char && text[index + 2] === char) {
				state = { kind: 'triple', quote: char };
				index += 2;
				continue;
			}
			state = { kind: 'single', quote: char, escaped: false };
			continue;
		}
		if (char === '{' || char === '[' || char === '(') {
			stack.push({ open: char, start: index });
			continue;
		}
		if (char === '}' || char === ']' || char === ')') {
			const expectedOpen = char === '}' ? '{' : char === ']' ? '[' : '(';
			const current = stack.pop();
			if (!current || current.open !== expectedOpen) {
				continue;
			}
			pairs.push({ open: current.open, start: current.start, end: index + 1 });
		}
	}

	return pairs;
}

function previousSignificantChar(text: string, index: number): string | undefined {
	for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
		const char = text[cursor];
		if (!/\s/u.test(char)) {
			return char;
		}
	}
	return undefined;
}

function previousWord(text: string, index: number): string | undefined {
	let cursor = index - 1;
	while (cursor >= 0 && /\s/u.test(text[cursor])) {
		cursor -= 1;
	}
	let end = cursor + 1;
	while (cursor >= 0 && /[A-Za-z_]/u.test(text[cursor])) {
		cursor -= 1;
	}
	if (end <= cursor + 1) {
		return undefined;
	}
	return text.slice(cursor + 1, end);
}

function canStartPythonListLiteral(text: string, start: number): boolean {
	const previousChar = previousSignificantChar(text, start);
	if (!previousChar) {
		return true;
	}
	if ('=([{,:'.includes(previousChar)) {
		return true;
	}
	if (previousChar === '\n' || previousChar === ';') {
		return true;
	}
	const word = previousWord(text, start);
	return word === 'return' || word === 'yield' || word === 'in';
}

function formatPythonProgram(text: string, options: FormatOptions): FormatResult {
	const pairs = scanPythonPairs(text).sort((left, right) => left.start - right.start);
	const replacements: Replacement[] = [];

	for (const pair of pairs) {
		if (replacements.some((replacement) => pair.start >= replacement.start && pair.end <= replacement.end)) {
			continue;
		}
		if (pair.open === '(') {
			continue;
		}
		if (pair.open === '[' && !canStartPythonListLiteral(text, pair.start)) {
			continue;
		}
		const literalText = text.slice(pair.start, pair.end);
		const parsed = parsePythonLiteral(literalText);
		if (!parsed.ok) {
			continue;
		}
		const indent = getLineIndent(text, pair.start);
		replacements.push({
			start: pair.start,
			end: pair.end,
			text: applyLineIndent(printValue(parsed.value, 'python', options), indent, options.lineEnding),
		});
	}

	if (replacements.length === 0) {
		throw new Error('No supported Python literal containers found in the document.');
	}

	return { formattedText: applyReplacements(text, replacements) };
}

export function formatProgramDocument(text: string, syntax: Extract<SyntaxKind, 'javascript' | 'typescript' | 'python'>, options: FormatOptions): FormatResult {
	switch (syntax) {
		case 'javascript':
		case 'typescript':
			return formatJsTsProgram(text, syntax, options);
		case 'python':
			return formatPythonProgram(text, options);
	}
}
