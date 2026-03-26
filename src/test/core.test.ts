/*
 * File: core.test.ts
 * Project: pretty-objects
 * Author: Anthony Kung <hi@anth.dev> (https://anth.dev)
 * License: Apache-2.0
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDefaultCollectionItem,
	getGroupLabel,
	getSearchText,
	getValueAtPath,
	getValueSummary,
	parseEditableCollection,
	parseEditableCollectionItem,
	printEditableCollectionItem,
	serializeEditableCollection,
} from '../core/collectionEditor';
import { formatTarget } from '../core/engine';
import { computeFoldTargets, getDefaultCollapsedDepth } from '../core/folding';
import { parseJson } from '../core/json';
import { parseJsTsLiteral } from '../core/jsTs';
import { formatProgramDocument } from '../core/programFormatting';
import { parsePythonLiteral } from '../core/python';
import { getByteLength, splitDocumentByMaxBytes, splitJsonArrayByMaxBytes, splitJsonlByMaxBytes } from '../core/split';
import { bestEffortTextToValue } from '../core/textToValue';
import { FormatOptions } from '../core/types';

const options: FormatOptions = {
	indentUnit: '  ',
	lineEnding: '\n',
	repairMode: 'deterministic',
	jsonlMode: 'linePreserving',
	jsTsQuoteStyle: 'single',
	pythonQuoteStyle: 'single',
	maxDocumentSize: 1_000_000,
};

test('parses JS object literals', () => {
	const result = parseJsTsLiteral('{ foo: "bar", count: 2 }', 'typescript');
	assert.equal(result.ok, true);
});

test('parses Python dict literals', () => {
	const result = parsePythonLiteral("{'a': 1, 'b': [True, None]}");
	assert.equal(result.ok, true);
});

test('applies deterministic JSON repair for trailing commas', () => {
	const result = parseJson('{"a": 1,}', 'deterministic');
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.repairedText, '{"a": 1}');
	}
});

test('applies moderate JSON repair for obvious missing object commas', () => {
	const result = parseJson('{"a": 1 "b": 2}', 'moderate');
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.repairedText, '{"a": 1, "b": 2}');
	}
});

test('applies moderate JSON repair for obvious missing array commas', () => {
	const result = parseJson('[1 2 {"a": 3}]', 'moderate');
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.repairedText, '[1, 2, {"a": 3}]');
	}
});

test('formats JSONL in line-preserving mode', () => {
	const formatted = formatTarget('{"b":2}\n{"a":1}', 'jsonl', options);
	assert.equal(formatted.formattedText, '{"b": 2}\n{"a": 1}');
});

test('converts JSONL to pretty-view array output', () => {
	const formatted = formatTarget('{"b":2}\n{"a":1}', 'jsonl', options, 'prettyView');
	assert.match(formatted.formattedText, /\[\n/);
	assert.match(formatted.formattedText, /"b": 2/);
});

test('parses editable collections from JSON arrays', () => {
	const collection = parseEditableCollection('[{"id":1},{"id":2}]', 'json', options);
	assert.equal(collection.items.length, 2);
	assert.equal(collection.items[0]?.kind, 'object');
});

test('parses editable collections from JSONL', () => {
	const collection = parseEditableCollection('{"id":1}\n{"id":2}', 'jsonl', options);
	assert.equal(collection.items.length, 2);
});

test('rejects non-array editable collection roots outside JSONL', () => {
	assert.throws(() => parseEditableCollection('{"id":1}', 'json', options), /top-level arrays and JSONL/u);
});

test('round-trips editable item text for TypeScript arrays', () => {
	const item = parseEditableCollectionItem("{ id: 1, label: 'x' }", 'typescript', options);
	assert.equal(item.kind, 'object');
	assert.match(printEditableCollectionItem(item, 'typescript', options), /label: 'x'/u);
});

test('serializes edited collections back to JSONL', () => {
	const item = parseEditableCollectionItem('{"id": 3}', 'jsonl', options);
	assert.equal(serializeEditableCollection([item], 'jsonl', options), '{"id": 3}');
});

test('creates object defaults when the current item is an object', () => {
	const reference = parseEditableCollectionItem('{"id":1}', 'json', options);
	assert.deepEqual(createDefaultCollectionItem(reference), { kind: 'object', entries: [] });
});

test('reads nested values by dotted path', () => {
	const value = parseEditableCollectionItem('{"meta":{"kind":"train"},"items":[{"id":1}]}', 'json', options);
	assert.equal(getValueAtPath(value, 'meta.kind')?.kind, 'string');
	assert.equal(getValueAtPath(value, 'items.0.id')?.kind, 'number');
});

test('builds search text and summaries for browsing', () => {
	const value = parseEditableCollectionItem('{"name":"alpha","count":2}', 'json', options);
	assert.match(getSearchText(value), /alpha/u);
	assert.match(getValueSummary(value, 12), /…$/u);
	assert.equal(getGroupLabel(getValueAtPath(value, 'name')), 'alpha');
});

test('best-effort converts colon-based text blocks into objects', () => {
	const value = bestEffortTextToValue(`Registration

Name: Alex
Email: alex@example.com

Event Details:

Date: Sunday, March 3, 2024
Price: 30

Notes:

Bring ID`);
	assert.equal(value?.kind, 'object');
	if (value?.kind === 'object') {
		assert.equal(getValueAtPath(value, 'Name')?.kind, 'string');
		assert.equal(getValueAtPath(value, 'Event Details.Price')?.kind, 'number');
	}
});

test('best-effort converts equals-based fields into objects', () => {
	const value = bestEffortTextToValue(`Name = Alex
Email = alex@example.com
Price = $30`);
	assert.equal(value?.kind, 'object');
	if (value?.kind === 'object') {
		assert.equal(getValueAtPath(value, 'Name')?.kind, 'string');
		assert.equal(getValueAtPath(value, 'Price')?.kind, 'number');
	}
});

test('best-effort groups repeated keys into arrays', () => {
	const value = bestEffortTextToValue(`Tag: alpha
Tag: beta
Tag: gamma`);
	assert.equal(value?.kind, 'object');
	if (value?.kind === 'object') {
		const tags = getValueAtPath(value, 'Tag');
		assert.equal(tags?.kind, 'array');
		assert.equal(tags?.kind === 'array' ? tags.items.length : 0, 3);
	}
});

test('best-effort converts bullet blocks into arrays', () => {
	const value = bestEffortTextToValue(`Shopping List:
  - apples
  - oranges
  - pears`);
	assert.equal(value?.kind, 'object');
	if (value?.kind === 'object') {
		const list = getValueAtPath(value, 'Shopping List');
		assert.equal(list?.kind, 'array');
		assert.equal(list?.kind === 'array' ? list.items.length : 0, 3);
	}
});

test('best-effort uses indentation for nested objects', () => {
	const value = bestEffortTextToValue(`Registration:
  Name = Alex
  Contact:
    Email: alex@example.com
    Phone: 123
  Notes:
    Bring ID`);
	assert.equal(value?.kind, 'object');
	if (value?.kind === 'object') {
		assert.equal(getValueAtPath(value, 'Registration.Name')?.kind, 'string');
		assert.equal(getValueAtPath(value, 'Registration.Contact.Phone')?.kind, 'number');
		assert.equal(getValueAtPath(value, 'Registration.Notes')?.kind, 'string');
	}
});

test('formats Python tuple and booleans with Python syntax', () => {
	const formatted = formatTarget('(1, True, None)', 'python', options);
	assert.match(formatted.formattedText, /^\(\n/u);
	assert.match(formatted.formattedText, /True/u);
	assert.match(formatted.formattedText, /None/u);
});

test('formats embedded TypeScript literals inside a full program file', () => {
	const source = `type Payload = { meta: { id: string }; items: number[] };

const payload: Payload = {meta:{id:"alpha"},items:[1,2,3]};

export default payload;
`;
	const formatted = formatProgramDocument(source, 'typescript', options);
	assert.match(formatted.formattedText, /const payload: Payload = \{\n/u);
	assert.match(formatted.formattedText, /meta: \{\n/u);
	assert.match(formatted.formattedText, /items: \[\n/u);
	assert.match(formatted.formattedText, /export default payload;/u);
});

test('formats embedded Python literals inside a full program file', () => {
	const source = `training_manifest = {"dataset":"foundation","splits":{"train":[1,2,3],"test":[4,5]}}

value = training_manifest["dataset"]
`;
	const formatted = formatProgramDocument(source, 'python', options);
	assert.match(formatted.formattedText, /training_manifest = \{\n/u);
	assert.match(formatted.formattedText, /'splits': \{\n/u);
	assert.match(formatted.formattedText, /'train': \[\n/u);
	assert.match(formatted.formattedText, /training_manifest\["dataset"\]/u);
});

test('splits JSONL by maxDocumentSize on line boundaries', () => {
	const source = '{"id":1}\n{"id":2}\n{"id":3}';
	const chunks = splitJsonlByMaxBytes(source, getByteLength('{"id":1}\n{"id":2}'));
	assert.equal(chunks.length, 2);
	assert.equal(chunks[0], '{"id":1}\n{"id":2}');
	assert.equal(chunks[1], '{"id":3}');
});

test('splits top-level JSON arrays into valid array chunks', () => {
	const source = '[{"id":1},{"id":2},{"id":3}]';
	const chunks = splitJsonArrayByMaxBytes(source, getByteLength('[\n  {\n    "id": 1\n  },\n  {\n    "id": 2\n  }\n]'), options);
	assert.equal(chunks.length, 2);
	assert.match(chunks[0], /^\[\n/u);
	assert.match(chunks[1], /"id": 3/u);
});

test('falls back to generic text splitting for non-JSON syntaxes', () => {
	const source = 'alpha\nbeta\ngamma';
	const chunks = splitDocumentByMaxBytes(source, 'typescript', getByteLength('alpha\nbeta'), options);
	assert.equal(chunks.length, 2);
	assert.equal(chunks[0], 'alpha\n');
	assert.equal(chunks[1], 'beta\ngamma');
});

test('computes nested fold targets for pretty json objects', () => {
	const targets = computeFoldTargets('{\n  "title": "string",\n  "fields": {\n    "name": "value"\n  }\n}');
	assert.equal(targets.length, 2);
	assert.deepEqual(targets.map((target) => ({ startLine: target.startLine, depth: target.depth })), [
		{ startLine: 2, depth: 1 },
		{ startLine: 0, depth: 0 },
	]);
});

test('default collapse depth keeps top-level object fields visible for object roots', () => {
	const targets = computeFoldTargets('{\n  "title": "string",\n  "fields": {\n    "name": {\n      "nested": true\n    }\n  }\n}');
	assert.equal(getDefaultCollapsedDepth(targets), 1);
});

test('default collapse depth keeps top-level array items visible for array roots', () => {
	const targets = computeFoldTargets('[\n  {\n    "title": "string",\n    "fields": {\n      "name": "value"\n    }\n  }\n]');
	assert.equal(getDefaultCollapsedDepth(targets), 2);
});
