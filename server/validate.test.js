import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isValidPath, parseExpand } from './validate.js';

const task = (over = {}) => ({ path: '/project/p1', rel: 'apiproxies', total: 2, targets: [{ type: 'apiproxy', id: 'a1' }], ...over });
const body = (over = {}) => ({ follow: 'one', maxResources: 100, known: ['project:p1'], tasks: [task()], ...over });
const parse = (b) => parseExpand(b, { maxResourcesCap: 1000 });

describe('isValidPath', () => {
    it('accepts the paths the crawler builds', () => {
        for (const p of ['/project/p1', '/project/941cd08e-d260:V1/apiproxies/b1dc', '/apiproxy/a%20b', "/x/y(1)'z"]) {
            assert.equal(isValidPath(p), true, p);
        }
    });

    it('rejects anything that could reach somewhere else', () => {
        for (const p of [
            'project/p1',
            '/project',
            '/',
            '//evil.example/x',
            '/project/../admin',
            '/project/./p1',
            '/project/%2e%2e/admin',
            '/project/p1%2fadmin',
            '/project/p1?x=1',
            '/project/p1#frag',
            '/project/p1\\admin',
            '/project/p 1',
            '/project/p1%zz',
            '/project/p1%00',
            `/${'a'.repeat(2000)}/b`,
            42,
            null,
        ]) {
            assert.equal(isValidPath(p), false, String(p));
        }
    });
});

describe('parseExpand', () => {
    it('accepts a well-formed request and returns it normalised', () => {
        const parsed = parse(body({ extra: 'ignored' }));
        assert.deepEqual(Object.keys(parsed).sort(), ['follow', 'known', 'maxResources', 'tasks']);
        assert.deepEqual(parsed.tasks, [task()]);
    });

    it('rejects an unknown follow mode, bad limits and a missing body', () => {
        for (const b of [
            null,
            'x',
            body({ follow: 'none' }),
            body({ follow: undefined }),
            body({ maxResources: 0 }),
            body({ maxResources: 1001 }),
            body({ maxResources: 1.5 }),
        ]) {
            assert.throws(() => parse(b), { status: 400, code: 'invalid_request' });
        }
    });

    it('rejects bad known ids and bad tasks', () => {
        for (const b of [
            body({ known: 'x' }),
            body({ known: [1] }),
            body({ known: ['bad\nid'] }),
            body({ tasks: [] }),
            body({ tasks: [task({ path: '/project/../x' })] }),
            body({ tasks: [task({ rel: 'a/b' })] }),
            body({ tasks: [task({ total: 0 })] }),
            body({ tasks: [task({ targets: [] })] }),
            body({
                tasks: [
                    task({
                        total: 1,
                        targets: [
                            { type: 'a', id: '1' },
                            { type: 'a', id: '2' },
                        ],
                    }),
                ],
            }),
            body({ tasks: [task({ targets: [{ type: 'no spaces', id: '1' }] })] }),
            body({ tasks: [task({ targets: [{ type: 'apiproxy', id: '' }] })] }),
        ]) {
            assert.throws(() => parse(b), { status: 400 }, JSON.stringify(b).slice(0, 80));
        }
    });

    it('refuses more known ids than the largest graph it will build', () => {
        assert.throws(() => parse(body({ known: Array.from({ length: 1001 }, (_, i) => `t:${i}`) })), { status: 400 });
    });
});
