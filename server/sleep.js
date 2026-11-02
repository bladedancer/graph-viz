/** Resolves after `ms`, or rejects with the signal's reason as soon as it aborts. */
export const sleep = (ms, signal) =>
    new Promise((resolve, reject) => {
        signal?.throwIfAborted();
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
