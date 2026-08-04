-- A migration 001 pode ja ter sido executada antes de RLS ser habilitado pelo painel.
-- Mantem a tabela privada para clientes anon/authenticated; o backend usa service role.
alter table public.fiscal_return_cfop_rules enable row level security;

-- Uma regra ativa precisa ter uma combinacao de empresa, CFOP de origem e condicoes unica.
-- Regras inativas podem ser mantidas como historico e nao participam da resolucao.
create unique index if not exists fiscal_return_cfop_rules_active_match_uniq
  on public.fiscal_return_cfop_rules (
    coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(source_cfop, ''),
    conditions
  )
  where active;
