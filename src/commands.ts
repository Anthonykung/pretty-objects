/*
 * File: commands.ts
 * Project: pretty-objects
 * Author: Anthony Kung <hi@anth.dev> (https://anth.dev)
 * License: Apache-2.0
 */

export const COMMAND_PRETTIFY_SELECTION = 'pretty-objects.prettifySelection';
export const COMMAND_PRETTIFY_DOCUMENT = 'pretty-objects.prettifyDocument';
export const COMMAND_PRETTIFY_PREVIEW = 'pretty-objects.prettifyWithPreview';
export const COMMAND_RESTORE = 'pretty-objects.restoreLastPrettify';
export const COMMAND_JSONL_PRETTY_VIEW = 'pretty-objects.convertJsonlToPrettyView';
export const COMMAND_COLLAPSE = 'pretty-objects.collapseNestedObjects';
export const COMMAND_EXPAND = 'pretty-objects.expandNestedObjects';
export const COMMAND_TOGGLE_KEYBINDING = 'pretty-objects.toggleKeybinding';
export const COMMAND_SET_DEFAULT_FORMATTER = 'pretty-objects.setAsDefaultFormatterForJson';
export const COMMAND_OPEN_WELCOME = 'pretty-objects.openWelcome';
export const COMMAND_OPEN_OBJECT_VIEWER = 'pretty-objects.openObjectViewer';
export const COMMAND_SPLIT_LARGE_FILE = 'pretty-objects.splitLargeFileByMaxDocumentSize';
export const COMMAND_RESET_STATE = 'pretty-objects.dangerouslyResetAllState';
export const COMMAND_DEMO_PRETTIFY = 'pretty-objects.demoPrettifyAndRepair';
export const COMMAND_DEMO_JSONL = 'pretty-objects.demoJsonlPrettyView';
export const COMMAND_DEMO_OBJECT_VIEWER = 'pretty-objects.demoObjectViewer';
export const COMMAND_DEMO_FOLDING = 'pretty-objects.demoCollapseNestedObjects';
export const COMMAND_DEMO_TEXT_TO_JSON = 'pretty-objects.demoTextToJson';
export const COMMAND_DEMO_LITERAL_PAYLOADS = 'pretty-objects.demoLiteralPayloads';
export const COMMAND_DEMO_PYTHON_PAYLOADS = 'pretty-objects.demoPythonPayloads';

export const CONTEXT_KEYBINDING_ENABLED = 'prettyObjects.keybindingEnabled';
export const CONTEXT_OBJECT_VIEWER_KEYBINDING_ENABLED = 'prettyObjects.objectViewerKeybindingEnabled';
export const GETTING_STARTED_KEY = 'prettyObjects.hasShownGettingStarted';
export const WELCOME_PANEL_ID = 'prettyObjects.welcome';
export const VIEWER_DOCUMENT_SCHEME = 'pretty-objects-viewer';
export const DEMO_DOCUMENT_SCHEME = 'pretty-objects-demo';
