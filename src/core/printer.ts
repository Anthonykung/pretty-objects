/*
 * File: printer.ts
 * Project: pretty-objects
 * Author: Anthony Kung <hi@anth.dev> (https://anth.dev)
 * License: Apache-2.0
 */

import {
	FormatOptions,
	PrettyObject,
	PrettyObjectEntry,
	PrettyObjectKey,
	PrettyValue,
	QuoteStyle,
	SyntaxKind,
} from './types';

function quoteString(value: string, quote: QuoteStyle | 'double'): string {
	const quoteChar = quote === 'single' ? '\'' : '"';
	const escaped = value
		.replace(/\\/g, '\\\\')
		.replace(/\r/g, '\\r')
		.replace(/\n/g, '\\n')
		.replace(/\t/g, '\\t')
		.replace(new RegExp(quoteChar, 'g'), `\\${quoteChar}`);
	return `${quoteChar}${escaped}${quoteChar}`;
}

function isValidIdentifier(name: string): boolean {
	return /^[$A-Z_a-z][$\w]*$/u.test(name);
}

function printKey(key: PrettyObjectKey, syntax: SyntaxKind, options: FormatOptions, level: number): string {
	if (key.kind === 'identifier') {
		if (syntax === 'javascript' || syntax === 'typescript') {
			return key.name;
		}
		return quoteString(key.name, syntax === 'json' || syntax === 'jsonl' ? 'double' : options.pythonQuoteStyle);
	}

	if (syntax === 'javascript' || syntax === 'typescript') {
		if (key.value.kind === 'string' && isValidIdentifier(key.value.value)) {
			return key.value.value;
		}
		if (key.value.kind === 'number') {
			return key.value.raw;
		}
	}

	return printValue(key.value, syntax, options, level);
}

function printObject(entries: PrettyObjectEntry[], syntax: SyntaxKind, options: FormatOptions, level: number): string {
	if (entries.length === 0) {
		return '{}';
	}

	const nextIndent = options.indentUnit.repeat(level + 1);
	const currentIndent = options.indentUnit.repeat(level);
	const inner = entries
		.map((entry) => `${nextIndent}${printKey(entry.key, syntax, options, level + 1)}: ${printValue(entry.value, syntax, options, level + 1)}`)
		.join(`,${options.lineEnding}`);
	return `{${options.lineEnding}${inner}${options.lineEnding}${currentIndent}}`;
}

function printList(open: string, close: string, items: PrettyValue[], syntax: SyntaxKind, options: FormatOptions, level: number): string {
	if (items.length === 0) {
		return `${open}${close}`;
	}

	const nextIndent = options.indentUnit.repeat(level + 1);
	const currentIndent = options.indentUnit.repeat(level);
	const inner = items
		.map((item) => `${nextIndent}${printValue(item, syntax, options, level + 1)}`)
		.join(`,${options.lineEnding}`);
	return `${open}${options.lineEnding}${inner}${options.lineEnding}${currentIndent}${close}`;
}

export function printValue(value: PrettyValue, syntax: SyntaxKind, options: FormatOptions, level = 0): string {
	switch (value.kind) {
		case 'string':
			if (syntax === 'json' || syntax === 'jsonl') {
				return quoteString(value.value, 'double');
			}
			return quoteString(value.value, syntax === 'python' ? options.pythonQuoteStyle : options.jsTsQuoteStyle);
		case 'number':
			return value.raw;
		case 'boolean':
			if (syntax === 'python') {
				return value.value ? 'True' : 'False';
			}
			return value.value ? 'true' : 'false';
		case 'null':
			return syntax === 'python' ? 'None' : 'null';
		case 'array':
			return printList('[', ']', value.items, syntax, options, level);
		case 'tuple':
			if (value.items.length === 0) {
				return '()';
			}
			if (value.items.length === 1) {
				return `(${printValue(value.items[0], syntax, options, level + 1)},)`;
			}
			return printList('(', ')', value.items, syntax, options, level);
		case 'set':
			if (value.items.length === 0) {
				return 'set()';
			}
			return printList('{', '}', value.items, syntax, options, level);
		case 'object':
			return printObject(value.entries, syntax, options, level);
	}
}

function printCompactKey(key: PrettyObjectKey): string {
	if (key.kind === 'identifier') {
		return JSON.stringify(key.name);
	}
	if (key.value.kind === 'string') {
		return JSON.stringify(key.value.value);
	}
	if (key.value.kind === 'number') {
		return key.value.raw;
	}
	if (key.value.kind === 'boolean') {
		return key.value.value ? 'true' : 'false';
	}
	return 'null';
}

function printCompactObject(value: PrettyObject): string {
	return `{${value.entries.map((entry) => `${printCompactKey(entry.key)}: ${printCompactJson(entry.value)}`).join(', ')}}`;
}

export function printCompactJson(value: PrettyValue): string {
	switch (value.kind) {
		case 'string':
			return JSON.stringify(value.value);
		case 'number':
			return value.raw;
		case 'boolean':
			return value.value ? 'true' : 'false';
		case 'null':
			return 'null';
		case 'array':
			return `[${value.items.map((item) => printCompactJson(item)).join(', ')}]`;
		case 'object':
			return printCompactObject(value);
		case 'tuple':
			return `[${value.items.map((item) => printCompactJson(item)).join(', ')}]`;
		case 'set':
			return `[${value.items.map((item) => printCompactJson(item)).join(', ')}]`;
	}
}
