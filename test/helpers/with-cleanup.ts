export async function withCleanup<T>(operation: () => Promise<T>, cleanup: () => Promise<void>): Promise<T> {
  let operationCompleted = false;
  let result: T | undefined;
  let primaryError: unknown;

  try {
    result = await operation();
    operationCompleted = true;
  } catch (error) {
    primaryError = error;
  }

  try {
    await cleanup();
  } catch (cleanupError) {
    if (!operationCompleted) {
      throw new AggregateError([primaryError, cleanupError], 'The operation and cleanup both failed.');
    }
    throw cleanupError;
  }

  if (!operationCompleted) throw primaryError;
  return result as T;
}

export async function withAcquisitionCleanup<T>(
  acquisition: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  try {
    return await acquisition();
  } catch (acquisitionError) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [acquisitionError, cleanupError],
        'The acquisition and cleanup both failed.',
      );
    }
    throw acquisitionError;
  }
}
