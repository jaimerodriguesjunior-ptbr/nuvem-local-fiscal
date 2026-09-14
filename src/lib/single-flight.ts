export function createSingleFlight() {
  const inFlight = new Map<string, Promise<unknown>>();

  return async function runSingleFlight<T>(
    key: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const active = inFlight.get(key) as Promise<T> | undefined;
    if (active) return active;

    const pending = Promise.resolve().then(operation);
    inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    }
  };
}
