import { randomBytes } from 'node:crypto';

// In-memory sessions: the upstream access token lives here and never reaches the browser.
// A restart signs everyone out, which is acceptable for an internal tool.
export class SessionStore {
    #sessions = new Map();
    #ttlMs;
    #timer;

    constructor({ ttlMs }) {
        this.#ttlMs = ttlMs;
        this.#timer = setInterval(() => this.#sweep(), 60_000);
        this.#timer.unref();
    }

    create(data) {
        const id = randomBytes(32).toString('base64url');
        this.#sessions.set(id, { ...data, id, lastSeen: Date.now() });
        return this.#sessions.get(id);
    }

    get(id) {
        if (!id) return undefined;
        const session = this.#sessions.get(id);
        if (!session) return undefined;
        if (Date.now() - session.lastSeen > this.#ttlMs) {
            this.#sessions.delete(id);
            return undefined;
        }
        session.lastSeen = Date.now();
        return session;
    }

    delete(id) {
        this.#sessions.delete(id);
    }

    get size() {
        return this.#sessions.size;
    }

    close() {
        clearInterval(this.#timer);
    }

    #sweep() {
        const now = Date.now();
        for (const [id, s] of this.#sessions) {
            if (now - s.lastSeen > this.#ttlMs) this.#sessions.delete(id);
        }
    }
}
