import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFiscalHistory } from './fiscal-history-reader.js';

test('legacy documents/events read every page despite a smaller server cap and preserve date ordering', async () => {
  for (const table of ['fiscal_documents', 'fiscal_document_events'] as const) {
    const source = Array.from({ length: 1504 }, (_, i) => ({ id: 'record_' + String(i).padStart(5, '0'),
      created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }));
    let calls = 0, cutoff: string;
    const client = { from(name: string) {
      assert.equal(name, table); let cursor = '';
      const query = { select(value: string) { assert.equal(value, '*'); return query; },
        lte(column: string, value: string) { assert.equal(column, 'created_at'); cutoff ??= value; assert.equal(value, cutoff); return query; },
        order(column: string, options: unknown) { assert.equal(column, 'id'); assert.deepEqual(options, { ascending: true }); return query; },
        limit(n: number) { assert.equal(n, 500); return query; },
        gt(column: string, value: string) { assert.equal(column, 'id'); cursor = value; return query; },
        async abortSignal() { calls++; return { error: null, data: source.filter(row => row.id > cursor).slice(0, 73) }; }
      }; return query;
    } } as any;
    const result = await readFiscalHistory(client, table);
    assert.equal(result.data.length, 1504); assert.equal(new Set(result.data.map(row => row.id)).size, 1504);
    assert.equal(result.data[0].id, 'record_01503'); assert.equal(result.data.at(-1)?.id, 'record_00000');
    assert.equal(calls, Math.ceil(1504 / 73) + 1);
  }
});
test('legacy history failures/cursor regressions reject the entire load instead of returning incomplete records', async () => {
  for (const broken of ['error', 'repeat']) {
    let calls = 0;
    const client = { from() {
      const q: any = { select: () => q, lte: () => q, order: () => q, limit: () => q, gt: () => q,
        async abortSignal() {
          calls++;
          if (calls === 2 && broken === 'error') return { error: { message: 'unavailable' }, data: null };
          return { error: null, data: [{ id: 'same', created_at: '2026-01-01' }] };
        } }; return q;
    } } as any;
    await assert.rejects(readFiscalHistory(client, 'fiscal_documents'), /Falha ao carregar|Paginação inválida/);
  }
});
