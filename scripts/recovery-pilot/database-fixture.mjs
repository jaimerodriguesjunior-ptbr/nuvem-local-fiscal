import { readFile } from 'node:fs/promises';

/** Rebuild the relevant installed schema from repository migrations. No data,
 * certificates, environment variables or network connections are imported.
 * PGlite lacks the pgcrypto extension; the initial extension declaration alone
 * is omitted. UUID generation and SHA-256 used by recovery are PostgreSQL core.
 */
export async function createCatalogFixture(db) {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  const migrations = [
    '20260611_001_initial_fiscal_schema.sql',
    '20260611_002_fiscal_inutilizations.sql',
    '20260611_003_fiscal_cancellations.sql',
    '20260613_001_nfse_provider_artifacts.sql',
    '20260806_001_nfse_national_dps_reference.sql',
    '20260808_001_national_cancellation_recovery.sql',
    '20260808_002_fiscal_api_clients.sql'
  ];
  for (const name of migrations) {
    const sql = await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
    await db.exec(sql.replace(/^create extension if not exists pgcrypto;\s*/i, ''));
  }
  // Match the reviewed table-level RLS/ACL shape; no permissive row policy.
  await db.exec(`grant usage on schema public to anon,authenticated,service_role;
    grant all on all tables in schema public to service_role;
    grant all on public.fiscal_documents,public.fiscal_document_events,public.fiscal_company_environments,
      public.fiscal_inutilizations to anon,authenticated;
    alter table public.fiscal_documents enable row level security;
    alter table public.fiscal_document_events enable row level security;
    alter table public.fiscal_company_environments enable row level security;
    alter table public.fiscal_inutilizations enable row level security;
    insert into public.fiscal_companies(id,cnpj,razao_social,nome_fantasia)
      values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','12345678000195','Synthetic test issuer','Test');
    insert into public.fiscal_company_environments(id,company_id,environment,uf,serie_nfe,serie_nfce)
      values('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','producao','PR',2,2);`);
}

export async function insertTestDocument(db, id, number, key, status = 'processamento') {
  await db.query(`insert into public.fiscal_documents(id,provider_like_id,company_id,company_environment_id,
      status,issuer_cnpj,environment,document_type,serie,number,signed_xml,signature_valid,xsd_valid,access_key)
    values($1,$1,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      $4,'12345678000195','producao','NFCe',2,$2,'<frozen/>',true,true,$3)`, [id,number,key,status]);
}
