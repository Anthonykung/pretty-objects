/*
 * File: types.ts
 * Project: pretty-objects
 * Author: Anthony Kung <hi@anth.dev> (https://anth.dev)
 * License: Apache-2.0
 */

export type SyntaxKind = 'json' | 'jsonl' | 'javascript' | 'typescript' | 'python';

export type RepairMode = 'deterministic' | 'moderate' | 'bestEffort';
export type JsonlMode = 'linePreserving' | 'prettyView';
export type QuoteStyle = 'single' | 'double';

export interface PrettyString {
	kind: 'string';
	value: string;
}

export interface PrettyNumber {
	kind: 'number';
	raw: string;
}

export interface PrettyBoolean {
	kind: 'boolean';
	value: boolean;
}

export interface PrettyNull {
	kind: 'null';
}

export interface PrettyArray {
	kind: 'array';
	items: PrettyValue[];
}

export interface PrettyTuple {
	kind: 'tuple';
	items: PrettyValue[];
}

export interface PrettySet {
	kind: 'set';
	items: PrettyValue[];
}

export interface PrettyObjectKeyIdentifier {
	kind: 'identifier';
	name: string;
}

export interface PrettyObjectKeyValue {
	kind: 'value';
	value: PrettyValue;
}

export type PrettyObjectKey = PrettyObjectKeyIdentifier | PrettyObjectKeyValue;

export interface PrettyObjectEntry {
	key: PrettyObjectKey;
	value: PrettyValue;
}

export interface PrettyObject {
	kind: 'object';
	entries: PrettyObjectEntry[];
}

export type PrettyValue =
	| PrettyString
	| PrettyNumber
	| PrettyBoolean
	| PrettyNull
	| PrettyArray
	| PrettyTuple
	| PrettySet
	| PrettyObject;

export interface ParseFailure {
	message: string;
	offset?: number;
	safeRepairLabel?: string;
}

export interface ParseSuccess {
	ok: true;
	value: PrettyValue;
	repairedText?: string;
}

export interface ParseError {
	ok: false;
	error: ParseFailure;
}

export type ParseResult = ParseSuccess | ParseError;

export interface FormatOptions {
	indentUnit: string;
	lineEnding: string;
	repairMode: RepairMode;
	jsonlMode: JsonlMode;
	jsTsQuoteStyle: QuoteStyle;
	pythonQuoteStyle: QuoteStyle;
	maxDocumentSize: number;
}

export interface FormatTarget {
	text: string;
	syntax: SyntaxKind;
}

export interface FormatResult {
	formattedText: string;
	repairedText?: string;
}
