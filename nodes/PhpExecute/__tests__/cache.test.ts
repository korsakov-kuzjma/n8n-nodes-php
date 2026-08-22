import { sha256, TtlCache } from '../helpers/cache';

describe('TtlCache', () => {
	it('stores and retrieves values within their TTL', () => {
		const cache = new TtlCache();
		cache.set('a', { v: 1 }, 1000, 5000);

		expect(cache.get('a', 5500)).toEqual({ v: 1 });
		expect(cache.size).toBe(1);
	});

	it('expires entries once the TTL elapses and drops them from storage', () => {
		const cache = new TtlCache();
		cache.set('a', 'x', 1000, 0);

		expect(cache.get('a', 1001)).toBeUndefined();
		expect(cache.size).toBe(0);
	});

	it('ignores non-positive and non-finite TTLs', () => {
		const cache = new TtlCache();

		cache.set('a', 'x', 0);
		cache.set('b', 'y', -5);
		cache.set('c', 'z', Number.POSITIVE_INFINITY);

		expect(cache.size).toBe(0);
	});

	it('evicts the least recently used entry when the capacity is reached', () => {
		const cache = new TtlCache(2);

		cache.set('a', 1, 10000, 1000000);
		cache.set('b', 2, 10000, 1000000);
		cache.get('a', 1000001);
		cache.set('c', 3, 10000, 1000002);

		expect(cache.get('a', 1000002)).toBe(1);
		expect(cache.get('b', 1000002)).toBeUndefined();
		expect(cache.get('c', 1000002)).toBe(3);
	});

	it('refreshes recency on read so hot entries survive eviction', () => {
		const cache = new TtlCache(2);
		cache.set('a', 1, 10000, 1000000);
		cache.set('b', 2, 10000, 1000000);
		cache.get('a', 1000001);
		cache.set('c', 3, 10000, 1000002);

		expect(cache.get('b', 1000002)).toBeUndefined();
	});

	it('clear() removes everything including unexpired entries', () => {
		const cache = new TtlCache();
		cache.set('a', 1, 100000, 0);
		cache.clear();

		expect(cache.get('a')).toBeUndefined();
		expect(cache.size).toBe(0);
	});
});

describe('sha256', () => {
	it('produces a stable 64-character hex digest', () => {
		const digest = sha256('<?php echo 1;', '{"items":[]}', 'restricted');

		expect(digest).toMatch(/^[a-f0-9]{64}$/);
		expect(sha256('<?php echo 1;', '{"items":[]}', 'restricted')).toBe(digest);
	});

	it('is sensitive to every component of the key', () => {
		const base = sha256('code', 'payload', 'php');

		expect(base).not.toBe(sha256('code!', 'payload', 'php'));
		expect(base).not.toBe(sha256('code', 'payload!', 'php'));
		expect(base).not.toBe(sha256('code', 'payload', 'php8.3'));
	});
});
