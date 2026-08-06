-- O idDPS da NFS-e Nacional possui 45 caracteres. Algumas bases anteriores
-- criaram provider_reference como varchar(44), o que impede persistir a DPS
-- assinada antes mesmo de qualquer transmissao para a SEFIN.
alter table if exists public.fiscal_documents
  alter column provider_reference type text;
