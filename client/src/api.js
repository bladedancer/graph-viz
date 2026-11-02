// Thin client for the Graph Visualizer server. The access token stays on the server; the browser only has a cookie.

export class ApiError extends Error {
    constructor(code, message, status) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
        this.status = status;
    }
}

// Sends a request, turning network failures and error responses into ApiErrors. Resolves the response.
async function send(path, { method = 'GET', body, signal } = {}) {
    let response;
    try {
        response = await fetch(path, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
            signal,
        });
    } catch (err) {
        if (err.name === 'AbortError') throw err;
        throw new ApiError('network', "Can't reach the Graph Visualizer server.", 0);
    }
    if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new ApiError(data?.error?.code ?? 'error', data?.error?.message ?? `Request failed (${response.status}).`, response.status);
    }
    return response;
}

const request = async (path, options) => (await send(path, options)).json();

/**
 * POSTs to an endpoint that streams newline-delimited JSON: `onProgress` gets counters, `onGraph` gets `{ nodes }`
 * batches as they resolve. Resolves the final summary { truncated, warnings, stats }.
 */
async function stream(path, params, { signal, onProgress = () => {}, onGraph = () => {} } = {}) {
    const response = await send(path, { method: 'POST', body: params, signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let summary;
    const handle = (line) => {
        if (!line.trim()) return;
        const message = JSON.parse(line);
        if (message.type === 'progress') onProgress(message);
        else if (message.type === 'graph') onGraph(message);
        else if (message.type === 'result') summary = message;
        else if (message.type === 'error') throw new ApiError(message.code, message.message, 200);
    };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        lines.forEach(handle);
    }
    handle(buffer);
    if (!summary) throw new ApiError('interrupted', 'The connection ended before the graph finished loading.', 0);
    return summary;
}

export const api = {
    session: (signal) => request('/api/session', { signal }),
    login: (credentials) => request('/api/login', { method: 'POST', body: credentials }),
    logout: () => request('/api/logout', { method: 'POST', body: {} }),
    /** Switches the environment (DESIGN, CHECK or LIVE) every later request reads. Resolves the updated session. */
    setMode: (mode) => request('/api/mode', { method: 'PUT', body: { mode } }),
    roots: (signal) => request('/api/roots', { signal }).then((d) => d.roots),
    rootCounts: (signal) => request('/api/roots/counts', { signal }).then((d) => d.counts),

    /** Reads the selected root resource types (no relationships). `params`: { roots, perRoot, maxResources }. */
    loadGraph: (params, handlers) => stream('/api/graph', params, handlers),

    /**
     * Loads relationships. `params`: { tasks, known, follow: 'one' | 'all' } where `tasks` come from
     * GraphStore.expansionTasks() and `known` is every id already in the graph.
     */
    expand: (params, handlers) => stream('/api/expand', params, handlers),
};
