# NFS-e Guaira/PR - mapeamento Nuvem Fiscal para IPM

Estado em 13/06/2026: inventario concluido e base de dry-run implementada.
Nenhuma transmissao municipal foi realizada pela Nuvem Local Fiscal.

## Fontes

- IPM NTE 35/2021, versao 2.8, de 14/10/2024:
  `g:\projetos\autoeletrica\.ipm\Report (1).pdf`
- payload real montado pela Autoeletrica:
  `g:\projetos\autoeletrica\src\actions\fiscal_emission.ts`
- testes diretos antigos, apenas como evidencia operacional:
  `g:\projetos\autoeletrica\scripts\test_direct_ipm.ts`
  `g:\projetos\autoeletrica\scripts\test_direct_ipm_tom.ts`
- exportacoes municipais:
  `g:\projetos\autoeletrica\exp_7571_6062026_114416_wne_nota_fiscal.txt`
  `g:\projetos\autoeletrica\exp_7571_4062026_104215_11636_wne_nota_fiscal.txt`

## Mapeamento

| Campo externo Nuvem Fiscal | Campo interno IPM | Tag IPM | Obrigatorio | Fonte | Pendencia |
| --- | --- | --- | --- | --- | --- |
| `infDPS.prest.CNPJ` | `prestadorDocumento` | `prestador/cpfcnpj` | Sim | Manual, p. 9 | Confirmar login usado no Basic Auth |
| configuracao municipal | `tomPrestador` | `prestador/cidade` | Sim | Manual, p. 9; exportacoes locais | TOM `7571` possui evidencia local; confirmar no portal |
| `infDPS.dhEmi` | `dataFatoGerador` | `nf/data_fato_gerador` | Sim | Manual, p. 8 | Nenhuma |
| `infDPS.valores.vServPrest.vServ` | `valorTotal` | `nf/valor_total` | Sim | Manual, p. 8 | Nenhuma |
| `infDPS.serv.cServ.xDescServ` | `observacao` | `nf/observacao` | Condicional | Manual, p. 9 e erro 248 | Usar no minimo 5 caracteres |
| `infDPS.toma.CPF/CNPJ` | `tomadorDocumento` | `tomador/cpfcnpj` | Sim para F/J | Manual, p. 10 | Nenhuma |
| tipo inferido do documento | `tomadorTipo` | `tomador/tipo` | Sim | Manual, p. 10 | Estrangeiro ainda nao implementado |
| `infDPS.toma.xNome` | `tomadorNome` | `tomador/nome_razao_social` | Sim para novo tomador | Manual, p. 10 e p. 38 | Nome deve ser composto |
| `infDPS.toma.end.*` | `tomadorEndereco` | `tomador/logradouro`, `numero_residencia`, `bairro`, `cidade`, `cep` | Sim para novo tomador | Manual, p. 10-11 e p. 38 | Erro 229 pode exigir omitir endereco cadastrado |
| `infDPS.serv.locPrest.cLocPrestacao` | `localPrestacao` | `itens/lista/codigo_local_prestacao_servico` | Sim | Manual, p. 12 e erros 47-49 | Converter IBGE `4108809` para TOM `7571` |
| `infDPS.serv.cServ.cTribMun` com fallback em `cTribNac` | `codigoServico` | `itens/lista/codigo_item_lista_servico` | Sim | Manual, p. 13; exportacoes locais | Evidencia local aponta `0140101`/`140101`; validar cadastro ativo |
| `infDPS.serv.cServ.CNAE` | `codigoAtividade` | `itens/lista/codigo_atividade` | Municipal | Manual, p. 13; exportacoes locais | Evidencia local aponta `4520007`; confirmar relacionamento |
| `infDPS.serv.cServ.xDescServ` | `descricaoServico` | `itens/lista/descritivo` | Sim | Manual, p. 13 | Nenhuma |
| `infDPS.valores.trib.tribMun.pAliq` | `aliquotaIss` | `itens/lista/aliquota_item_lista_servico` | Sim | Manual, p. 13; exportacoes locais | Evidencia local aponta `2,01`; confirmar cadastro |
| `infDPS.serv.cServ.cSitTrib` | `situacaoTributaria` | `itens/lista/situacao_tributaria` | Sim | Manual, p. 13 e p. 28-29 | `0` = tributada integralmente; confirmar para o prestador |
| `infDPS.valores.vServPrest.vServ` | `valorTributavel` | `itens/lista/valor_tributavel` | Sim | Manual, p. 13 | Deduzir somente quando a situacao permitir |
| retencao municipal | `valorIssRetido` | `itens/lista/valor_issrf` | Sim, aceita zero | Manual, p. 13 | Mapear `tpRetISSQN` com teste controlado |
| identificador local do documento | `identificador` | `identificador` | Recomendado | Manual, p. 7 e p. 15 | Deve ser unico e idempotente |
| configuracao de teste | `testMode` | `nfse_teste` | Para validacao sem emissao | Manual, p. 28 | Manter `1` ate autorizacao explicita |

## Contrato HTTP identificado

- Metodo `POST`, resposta sincrona.
- Corpo `multipart/form-data` com o XML como arquivo.
- Cabecalho `Authorization: Basic base64(username:password)`.
- `username`: CPF/CNPJ do emissor; `password`: senha municipal.
- Reutilizacao opcional de `Cookie: PHPSESSID=...`.
- URL generica oficial: `https://ws-cidade.atende.net:7443/?pg=rest&service=WNERestServiceNFSe`.
- Scripts locais antigos usaram
  `https://guaira.atende.net/atende.php?pg=rest&service=WNERestServiceNFSe&cidade=padrao`.
  Esse endpoint ainda precisa de confirmacao oficial/controlada.

## Pode ser implementado sem credenciais

- deteccao do provedor Guaira/IPM;
- normalizacao do payload DPS;
- validacao de campos obrigatorios;
- geracao do XML de emissao;
- modo de teste com `nfse_teste=1`;
- parser dos retornos reduzidos/completos;
- persistencia de XML e eventos em dry-run;
- traducao futura dos retornos para o contrato externo existente.

## Bloqueios antes da primeira transmissao

- confirmar endpoint e se existe ambiente separado;
- confirmar liberacao do servico no Portal do Cidadao;
- confirmar login, senha e cadastro economico;
- confirmar TOM `7571`, servico `140101`, atividade `4520007` e aliquota `2,01`;
- confirmar exigencia de assinatura digital;
- confirmar que o teste sera feito com `nfse_teste=1`;
- obter confirmacao explicita da nota, prestador e motivo do teste.
