# NFS-e Nacional - implementacao inicial

## Estado em 06/08/2026

O provedor `nfse-nacional` esta integrado ao roteador interno da Nuvem Local
Fiscal. Nesta primeira fatia ele:

- preserva o contrato existente de `POST /nfse/dps`;
- aceita configuracao por empresa, municipio e ambiente;
- normaliza o payload atual dos clientes;
- gera uma DPS no leiaute nacional `1.01`;
- persiste XML, identificador da DPS, provedor e evento de auditoria;
- nao assina e nao transmite para a SEFIN Nacional;
- mantem `autoTransmit=false` nos dois ambientes.

O XML gerado foi validado durante o desenvolvimento contra o pacote oficial de
Producao Restrita `NFSe-ESQUEMAS_XSD-PRODREST-v1.01-20260727`.

Fonte oficial:

https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita/documentacao-tecnica-rtc-producao-restrita

Os XSDs ainda nao foram adicionados ao repositorio. Antes de habilitar
assinatura ou transmissao, o pacote oficial deve ser incorporado em
`schemas/nfse/`, com manifesto contendo URL, data, versao e SHA-256.

## Configuracao

Exemplo de configuracao de homologacao:

```json
{
  "ambiente": "homologacao",
  "provedor": "nfse-nacional",
  "municipio": {
    "codigo_ibge": "4108809",
    "nome": "Guaira"
  },
  "rps": {
    "serie": "1"
  },
  "nacional": {
    "inscricao_municipal": "324743",
    "versao_leiaute": "1.01",
    "codigo_tributacao_nacional": "140101",
    "opcao_simples_nacional": "3",
    "regime_apuracao_simples": "1",
    "regime_especial_tributacao": "0",
    "tributacao_issqn": "1",
    "retencao_issqn": "1"
  }
}
```

`codigo_tributacao_municipal` e `codigo_nbs` sao opcionais no XSD. Quando
informados, devem possuir respectivamente 3 e 9 digitos. O
`codigo_tributacao_nacional` e obrigatorio e deve possuir 6 digitos.
Os codigos do exemplo sao apenas estruturais e precisam ser conferidos nos
anexos oficiais e na parametrizacao do municipio antes da homologacao.

O endpoint e escolhido por ambiente:

- homologacao: `https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional`;
- producao: `https://sefin.nfse.gov.br/SefinNacional`.

## Compatibilidade do payload cliente

Os clientes podem continuar enviando o formato atual. O NBS pode ser informado
opcionalmente em `infDPS.serv.cServ.cNBS`, `codigo_nbs` ou `nbs`. Se estiver
ausente, a Nuvem Local usa o valor configurado para a empresa e servico. Se
tambem nao houver valor configurado, a tag nao e gerada.

Ordem de resolucao dos principais campos:

| DPS nacional | Payload cliente | Configuracao |
| --- | --- | --- |
| `cTribNac` | `infDPS.serv.cServ.cTribNac` | `nacional.codigo_tributacao_nacional` |
| `cTribMun` | `infDPS.serv.cServ.cTribMun` | `nacional.codigo_tributacao_municipal` |
| `cNBS` | `infDPS.serv.cServ.cNBS` ou `codigo_nbs` | `nacional.codigo_nbs` |
| `cLocPrestacao` | `infDPS.serv.locPrest.cLocPrestacao` | municipio emissor |
| `vServ` | `infDPS.valores.vServPrest.vServ` | sem valor padrao |

## Proximos incrementos

1. Incorporar e validar os XSDs oficiais em runtime.
2. Assinar `infDPS` com o certificado A1 do emitente.
3. Implementar o envelope compactado/base64 exigido pela API.
4. Transmitir somente em Producao Restrita.
5. Interpretar autorizacao, rejeicao e retorno inconclusivo.
6. Consultar NFS-e e obter XML/DANFSe oficial.
7. Implementar eventos de cancelamento e substituicao.
