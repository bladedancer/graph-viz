// An error that maps straight onto an HTTP response: { error: { code, message } } with `status`.
export class HttpError extends Error {
    constructor(status, code, message, options) {
        super(message, options);
        this.name = 'HttpError';
        this.status = status;
        this.code = code;
    }
}

// A failed call to the Fusion tenant. `status` is the upstream HTTP status, or 0 when it was never reached.
export class UpstreamError extends Error {
    constructor(message, { status = 0, cause } = {}) {
        super(message, { cause });
        this.name = 'UpstreamError';
        this.status = status;
    }
}

export const isAbort = (err) => err?.name === 'AbortError' || err?.name === 'TimeoutError';
