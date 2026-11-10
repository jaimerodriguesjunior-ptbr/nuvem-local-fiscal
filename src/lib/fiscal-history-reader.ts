import type { SupabaseClient } from '@supabase/supabase-js';

/** Boot-time legacy history read. Does not write or enroll documents in recovery. */
export async function readFiscalHistory<T extends { id: string; created_at: string }>(
  client: Pick<SupabaseClient, 'from'>, table: 'fiscal_documents' | 'fiscal_document_events'
): Promise<{ data: T[]; error: null }> {
  const rows: T[] = [];
  let after: string | null = null;
  const asOf = new Date().toISOString();
  for (;;) {
    let query = client.from(table).select('*').lte('created_at', asOf).order('id', { ascending: true }).limit(500);
    if (after !== null) query = query.gt('id', after);
    const { data, error } = await query.abortSignal(AbortSignal.timeout(15_000));
    if (error) throw new Error('Falha ao carregar histórico fiscal: ' + error.message);
    if (!Array.isArray(data)) throw new Error('Resposta inválida ao carregar histórico fiscal.');
    if (!data.length) break;
    for (const row of data as T[]) {
      if (typeof row.id !== 'string' || (after !== null && row.id <= after)) {
        throw new Error('Paginação inválida ao carregar histórico fiscal.');
      }
      rows.push(row); after = row.id;
    }
    // Continue even after a short page: the server may impose a smaller max_rows.
  }
  rows.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id));
  return { data: rows, error: null };
}
