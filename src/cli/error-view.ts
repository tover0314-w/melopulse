import { z } from 'zod';
import { MeloPulseError } from '../errors.js';

export interface ErrorView {
  code: string;
  message: string;
  suggestion?: string;
  retryable: boolean;
  url?: string;
}

const RECOVERY = {
  PLAYLIST_NOT_FOUND: { suggestion: 'Run melopulse list or melopulse recommend to choose a valid playlist ID.', retryable: false },
  PLAYLIST_OPEN_ERROR: { suggestion: 'Open the playlist URL shown below in a browser or music app.', retryable: true },
  MELOLAB_SYNC_TIMEOUT_ERROR: { suggestion: 'Check your connection and run melopulse sync again.', retryable: true },
  MELOLAB_SYNC_NETWORK_ERROR: { suggestion: 'Check your connection and run melopulse sync again. Your previous cache is unchanged.', retryable: true },
  MELOLAB_SYNC_HTTP_ERROR: { suggestion: 'Try melopulse sync again later. Your previous cache is unchanged.', retryable: true },
  MELOLAB_SYNC_INVALID_RESPONSE: { suggestion: 'Try melopulse sync again later. Your previous cache is unchanged.', retryable: true },
} as const;

const PLAYLIST_URL_MESSAGES = new Set([
  'Playlist URL must be a valid URL',
  'Playlist URL must use HTTPS',
  'Playlist URL must not include credentials',
]);

export function toErrorView(error: unknown): ErrorView {
  if (isPlaylistUrlError(error)) {
    return {
      code: 'INVALID_PLAYLIST_URL',
      message: error.message,
      suggestion: 'Use a valid HTTPS playlist URL without credentials.',
      retryable: false,
    };
  }

  if (error instanceof z.ZodError) {
    return {
      code: 'INVALID_INPUT',
      message: 'The command input is invalid.',
      suggestion: 'Check the command options and try again.',
      retryable: false,
    };
  }

  if (error instanceof MeloPulseError && isRecoveryCode(error.code)) {
    const recovery = RECOVERY[error.code];
    const url = safeUrl(error);
    return {
      code: error.code,
      message: error.message,
      ...recovery,
      ...(url === undefined ? {} : { url }),
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected internal error occurred.',
    suggestion: 'Retry the command. If it continues, report the error code.',
    retryable: true,
  };
}

function isPlaylistUrlError(error: unknown): error is Error {
  return error instanceof Error && PLAYLIST_URL_MESSAGES.has(error.message);
}

function isRecoveryCode(code: string): code is keyof typeof RECOVERY {
  return Object.hasOwn(RECOVERY, code);
}

function safeUrl(error: MeloPulseError): string | undefined {
  if (!('url' in error) || typeof error.url !== 'string') return undefined;
  try {
    const url = new URL(error.url);
    return url.protocol === 'https:' && url.username === '' && url.password === '' ? error.url : undefined;
  } catch {
    return undefined;
  }
}
