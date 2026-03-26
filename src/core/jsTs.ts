/*
 * File: jsTs.ts
 * Project: pretty-objects
 * Author: Anthony Kung <hi@anth.dev> (https://anth.dev)
 * License: Apache-2.0
 */

import ts from 'typescript';

import { ParseResult, PrettyObjectEntry, PrettyValue, SyntaxKind } from './types';

function scriptKindForSyntax(syntax: SyntaxKind): ts.ScriptKind {
	switch (syntax) {
		case 'javascript':
			return ts.ScriptKind.JS;
		case 'typescript':
			return ts.ScriptKind.TS;
		default:
			return ts.ScriptKind.TS;
	}
}

function convertExpression(node: ts.Expression): PrettyValue {
	if (ts.isParenthesizedExpression(node)) {
		return convertExpression(node.expression);
	}
	if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
		return convertExpression(node.expression);
	}
	if (ts.isObjectLiteralExpression(node)) {
		const entries: PrettyObjectEntry[] = [];
		for (const property of node.properties) {
			if (ts.isSpreadAssignment(property) || ts.isMethodDeclaration(property) || ts.isAccessor(property)) {
				throw new Error('Unsupported object property kind');
			}
			if (ts.isShorthandPropertyAssignment(property)) {
				entries.push({
					key: { kind: 'identifier', name: property.name.getText() },
					value: { kind: 'string', value: property.name.getText() },
				});
				continue;
			}
			if (!ts.isPropertyAssignment(property)) {
				throw new Error('Unsupported object property');
			}
			const key = convertPropertyName(property.name);
			entries.push({ key, value: convertExpression(property.initializer) });
		}
		return { kind: 'object', entries };
	}
	if (ts.isArrayLiteralExpression(node)) {
		return { kind: 'array', items: node.elements.map((element) => convertExpression(element as ts.Expression)) };
	}
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
		return { kind: 'string', value: node.text };
	}
	if (ts.isNumericLiteral(node)) {
		return { kind: 'number', raw: node.getText() };
	}
	if (ts.isPrefixUnaryExpression(node) && (node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken) && ts.isNumericLiteral(node.operand)) {
		return { kind: 'number', raw: node.getText() };
	}
	if (node.kind === ts.SyntaxKind.TrueKeyword) {
		return { kind: 'boolean', value: true };
	}
	if (node.kind === ts.SyntaxKind.FalseKeyword) {
		return { kind: 'boolean', value: false };
	}
	if (node.kind === ts.SyntaxKind.NullKeyword) {
		return { kind: 'null' };
	}
	throw new Error(`Unsupported expression "${node.getText()}"`);
}

function convertPropertyName(name: ts.PropertyName) {
	if (ts.isIdentifier(name)) {
		return { kind: 'identifier' as const, name: name.text };
	}
	if (ts.isStringLiteral(name)) {
		return { kind: 'value' as const, value: { kind: 'string' as const, value: name.text } };
	}
	if (ts.isNumericLiteral(name)) {
		return { kind: 'value' as const, value: { kind: 'number' as const, raw: name.getText() } };
	}
	if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression)) {
		return { kind: 'value' as const, value: { kind: 'string' as const, value: name.expression.text } };
	}
	throw new Error('Unsupported property name');
}

export function parseJsTsLiteral(text: string, syntax: Extract<SyntaxKind, 'javascript' | 'typescript'>): ParseResult {
	const wrapped = `const __pretty_objects__ = (${text});`;
	const sourceFile = ts.createSourceFile(
		syntax === 'javascript' ? 'inline.js' : 'inline.ts',
		wrapped,
		ts.ScriptTarget.Latest,
		true,
		scriptKindForSyntax(syntax),
	);
	const diagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];

	if (diagnostics.length > 0) {
		const diagnostic = diagnostics[0];
		return {
			ok: false,
			error: {
				message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
				offset: diagnostic.start !== undefined ? Math.max(0, diagnostic.start - 'const __pretty_objects__ = ('.length) : undefined,
			},
		};
	}

	const statement = sourceFile.statements[0];
	if (!statement || !ts.isVariableStatement(statement)) {
		return { ok: false, error: { message: 'Could not locate wrapped expression' } };
	}
	const declaration = statement.declarationList.declarations[0];
	const initializer = declaration?.initializer;
	if (!initializer) {
		return { ok: false, error: { message: 'Could not parse expression' } };
	}

	try {
		return { ok: true, value: convertExpression(initializer) };
	} catch (error) {
		return {
			ok: false,
			error: {
				message: error instanceof Error ? error.message : 'Unsupported JS/TS literal',
			},
		};
	}
}
