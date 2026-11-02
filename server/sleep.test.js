import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { describe, it } from 'node:test';
import { sleep } from './sleep.js';

describe('sleep', () => {
    it('removes its abort listener once it resolves', async () => {
        const ctrl = new AbortController();
        for (let i = 0; i < 20; i++) await sleep(0, ctrl.signal);
        assert.equal(getEventListeners(ctrl.signal, 'abort').length, 0);
    });

    it('rejects with the reason when the signal aborts, or has already aborted', async () => {
        const ctrl = new AbortController();
        const pending = sleep(60_000, ctrl.signal);
        ctrl.abort(new Error('stop'));
        await assert.rejects(pending, /stop/);
        await assert.rejects(sleep(0, ctrl.signal), /stop/);
    });
});
