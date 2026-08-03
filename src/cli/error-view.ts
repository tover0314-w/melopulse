import { z } from 'zod';
import { MeloPulseError } from '../errors.js';

export interface ErrorView {
  code: string;
  message: string;
  suggestion?: string;
  retryable: boolean;
  url?: string;
}

export interface ErrorViewContext {
  surface?: 'cli' | 'mcp';
  toolName?: string;
}

const CLI_RECOVERY = {
  PLAYLIST_NOT_FOUND: { suggestion: 'Run melopulse list or melopulse recommend to choose a valid playlist ID.', retryable: false },
  PLAYLIST_OPEN_ERROR: { suggestion: 'Open the playlist URL shown below in a browser or music app.', retryable: true },
  MELOLAB_SYNC_TIMEOUT_ERROR: { suggestion: 'Check your connection and run melopulse sync again.', retryable: true },
  MELOLAB_SYNC_NETWORK_ERROR: { suggestion: 'Check your connection and run melopulse sync again. Your previous cache is unchanged.', retryable: true },
  MELOLAB_SYNC_HTTP_ERROR: { suggestion: 'Try melopulse sync again later. Your previous cache is unchanged.', retryable: true },
  MELOLAB_SYNC_INVALID_RESPONSE: { suggestion: 'Try melopulse sync again later. Your previous cache is unchanged.', retryable: true },
} as const;

const MCP_RECOVERY = {
  PLAYLIST_NOT_FOUND: { suggestion: 'Call melopulse_list_playlists or melopulse_recommend to choose a valid playlist ID.', retryable: false },
  PLAYLIST_OPEN_ERROR: { suggestion: 'Use the credential-free HTTPS fallback URL in the error result.', retryable: true },
  MELOLAB_SYNC_TIMEOUT_ERROR: { suggestion: 'Check the connection and call melopulse_sync_catalog again.', retryable: true },
  MELOLAB_SYNC_NETWORK_ERROR: { suggestion: 'Check the connection and call melopulse_sync_catalog again. The previous cache is unchanged.', retryable: true },
  MELOLAB_SYNC_HTTP_ERROR: { suggestion: 'Call melopulse_sync_catalog again later. The previous cache is unchanged.', retryable: true },
  MELOLAB_SYNC_INVALID_RESPONSE: { suggestion: 'Call melopulse_sync_catalog again later. The previous cache is unchanged.', retryable: true },
} as const;

const PARSER_CODES: Record<string, string> = {
  'commander.unknownOption': 'UNKNOWN_OPTION',
  'commander.missingArgument': 'MISSING_ARGUMENT',
  'commander.optionMissingArgument': 'MISSING_OPTION_VALUE',
  'commander.missingMandatoryOptionValue': 'MISSING_OPTION_VALUE',
  'commander.conflictingOption': 'CONFLICTING_OPTIONS',
  'commander.unknownCommand': 'UNKNOWN_COMMAND',
  'commander.excessArguments': 'TOO_MANY_ARGUMENTS',
};

const PLAYLIST_URL_MESSAGES = new Set([
  'Playlist URL must be a valid URL',
  'Playlist URL must use HTTPS',
  'Playlist URL must not include credentials',
]);

const ENUM_FIELDS = new Set(['activity', 'energy', 'focus', 'vocals', 'source']);
const ANSI_SEQUENCE = new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, 'gu');
const CONTROL_WHITESPACE = new RegExp(String.raw`[\u0009-\u000D]`, 'gu');
const CONTROL_CHARACTER = new RegExp(String.raw`[\u0000-\u0008\u000E-\u001F\u007F-\u009F]`, 'gu');

export function toErrorView(error: unknown, context: ErrorViewContext = {}): ErrorView {
  if (isPlaylistUrlError(error)) {
    return {
      code: 'INVALID_PLAYLIST_URL',
      message: sanitizeHumanText(error.message, 'Invalid playlist URL.'),
      suggestion: context.surface === 'mcp' && context.toolName
        ? `Call ${safeToolName(context.toolName)} with a valid HTTPS playlist URL without credentials.`
        : 'Use a valid HTTPS playlist URL without credentials.',
      retryable: false,
    };
  }

  if (error instanceof z.ZodError) return zodErrorView(error, context);

  if (error instanceof MeloPulseError && isRecoveryCode(error.code)) {
    const recovery = context.surface === 'mcp' ? MCP_RECOVERY[error.code] : CLI_RECOVERY[error.code];
    const url = safeUrl(error);
    return {
      code: error.code,
      message: sanitizeHumanText(error.message, 'The operation failed.'),
      suggestion: sanitizeHumanText(recovery.suggestion),
      retryable: recovery.retryable,
      ...(url === undefined ? {} : { url }),
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected internal error occurred.',
    suggestion: context.surface === 'mcp' && context.toolName
      ? `Call ${safeToolName(context.toolName)} again. If it continues, report the error code.`
      : 'Retry the command. If it continues, report the error code.',
    retryable: true,
  };
}

export function toParserErrorView(error: { code: string; message: string }): ErrorView {
  const rawMessage = error.message.replace(/^error:\s*/iu, '');
  const message = sanitizeHumanText(rawMessage, 'The command usage is invalid.');
  return {
    code: PARSER_CODES[error.code] ?? 'CLI_PARSE_ERROR',
    message: `${message.charAt(0).toUpperCase()}${message.slice(1)}`,
    suggestion: 'Run the command with --help to see valid usage, then try again.',
    retryable: false,
  };
}

export function sanitizeHumanText(value: string, fallback = ''): string {
  const sanitized = value
    .replace(ANSI_SEQUENCE, '')
    .replace(CONTROL_WHITESPACE, ' ')
    .replace(CONTROL_CHARACTER, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return sanitized || fallback;
}

function zodErrorView(error: z.ZodError, context: ErrorViewContext): ErrorView {
  const issue = error.issues[0];
  const pathFields = issue?.path.filter((segment): segment is string => typeof segment === 'string') ?? [];
  const schemaField = pathFields.at(-1);
  const field = schemaField === 'activityTags'
    ? (context.surface === 'mcp' ? 'activityTags' : 'activity')
    : schemaField;

  if (field && (ENUM_FIELDS.has(field) || schemaField === 'activityTags') && issue && 'values' in issue && Array.isArray(issue.values)) {
    const values = issue.values
      .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
      .map((value) => sanitizeHumanText(String(value)))
      .filter(Boolean);
    if (values.length > 0) {
      return invalidFieldView(
        field,
        `one of: ${formatChoices(values)}`,
        context,
        schemaField === 'activityTags' ? 'activity' : field,
      );
    }
  }

  if (field === 'limit') return invalidFieldView(field, 'an integer from 1 to 5', context);

  if (field === 'playlistId') {
    return {
      code: 'INVALID_PLAYLIST_ID',
      message: 'Invalid playlist ID.',
      suggestion: context.surface === 'mcp' && context.toolName
        ? `Call ${safeToolName(context.toolName)} with a shell-safe playlist ID.`
        : 'Use a shell-safe playlist ID shown by melopulse list or melopulse recommend.',
      retryable: false,
    };
  }

  if (field === 'url') {
    return {
      code: 'INVALID_PLAYLIST_URL',
      message: 'Invalid playlist URL.',
      suggestion: context.surface === 'mcp' && context.toolName
        ? `Call ${safeToolName(context.toolName)} with a valid HTTPS playlist URL without credentials.`
        : 'Use a valid HTTPS playlist URL without credentials.',
      retryable: false,
    };
  }

  return {
    code: 'INVALID_INPUT',
    message: context.surface === 'mcp' ? 'The tool input is invalid.' : 'The command input is invalid.',
    suggestion: context.surface === 'mcp' && context.toolName
      ? `Call ${safeToolName(context.toolName)} again with valid arguments.`
      : 'Check the command options and try again.',
    retryable: false,
  };
}

function invalidFieldView(
  field: string,
  guidance: string,
  context: ErrorViewContext,
  codeField = field,
): ErrorView {
  const safeField = sanitizeHumanText(field, 'input');
  const safeCodeField = sanitizeHumanText(codeField, 'input');
  const suggestion = context.surface === 'mcp' && context.toolName
    ? `Call ${safeToolName(context.toolName)} with ${safeField} set to ${guidance}.`
    : `Set --${safeField} to ${guidance}.`;
  return {
    code: `INVALID_${safeCodeField.toUpperCase()}`,
    message: `Invalid ${safeField} value.`,
    suggestion,
    retryable: false,
  };
}

function formatChoices(values: readonly string[]): string {
  if (values.length === 1) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} or ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, or ${values.at(-1)}`;
}

function safeToolName(toolName: string): string {
  const sanitized = sanitizeHumanText(toolName, 'the tool');
  return /^[a-z][a-z0-9_]*$/u.test(sanitized) ? sanitized : 'the tool';
}

function isPlaylistUrlError(error: unknown): error is Error {
  return error instanceof Error && PLAYLIST_URL_MESSAGES.has(error.message);
}

function isRecoveryCode(code: string): code is keyof typeof CLI_RECOVERY {
  return Object.hasOwn(CLI_RECOVERY, code);
}

function safeUrl(error: MeloPulseError): string | undefined {
  if (!('url' in error) || typeof error.url !== 'string') return undefined;
  if (sanitizeHumanText(error.url) !== error.url) return undefined;
  try {
    const url = new URL(error.url);
    return url.protocol === 'https:' && url.username === '' && url.password === '' ? error.url : undefined;
  } catch {
    return undefined;
  }
}
