# Biblioteca de CFOP para devolucoes

## Objetivo

Centralizar a decisao de CFOP de NF-e de devolucao (`finNFe = 4`) no Nuvem Local Fiscal, sem alterar a emissao de venda, NFC-e, NFS-e ou os programas clientes existentes.

A experiencia esperada no cliente continua simples: ele seleciona os itens da nota recebida e emite a devolucao. Quando a combinacao ainda nao estiver coberta, a nota segue pelo CFOP padrao de devolucao e a equipe fiscal recebe uma ocorrencia no painel administrativo para transformar o caso em regra reutilizavel.

## Contrato opcional para clientes

Os clientes atuais permanecem compativeis: se nao enviarem metadados, a devolucao usa o fallback e gera revisao administrativa. Clientes que ja conhecem a nota de entrada podem aumentar a precisao enviando, no payload raiz ou em `infNFe`, o bloco abaixo:

```json
{
  "metadados": {
    "devolucao": {
      "itens": [
        {
          "nItem": 1,
          "cfopOrigem": "5405",
          "st": true,
          "cest": "0100100",
          "combustivel": false,
          "finalidadeCompra": "revenda"
        }
      ]
    }
  }
}
```

Tambem sao aceitos os aliases em ingles (`metadata.return`, `sourceCfop`, `fuel`, `purchasePurpose`). A correspondencia e feita por `nItem` ou por codigo do produto.

`finalidadeCompra` tambem pode ser informada no nivel de `devolucao`, quando vale para todos os itens; o valor do item prevalece. `revenda` e `resale` sao equivalentes, assim como as formas de uso/consumo e ativo imobilizado.

## Niveis de decisao

| Nivel | Resultado | Efeito para o cliente |
| --- | --- | --- |
| Baixo | Regra da biblioteca aplicada | Emissao normal, sem alerta. |
| Medio | Fallback `5202` (interna) ou `6202` (interestadual) | Emissao continua e surge uma ocorrencia no admin. |
| Alto | Uso/consumo, ativo/imobilizado ou exterior | Emissao e interrompida antes da transmissao, com mensagem neutra e chamado registrado para analise. |

Para combustiveis/lubrificantes, a biblioteca inicial tambem contempla as devolucoes `5661/6661` quando a origem e `5655/5656`.

O fallback e uma decisao operacional para nao travar urgencias. A ocorrencia precisa ser conciliada pelo responsavel fiscal e virar uma regra antes de ser usada como padrao para novos casos. Carta de correcao nao e automatizada pelo sistema.

## Biblioteca inicial

As migrations `20260804_001_return_cfop_library.sql` e `20260804_002_return_cfop_hardening.sql` criam e protegem `fiscal_return_cfop_rules`, incluindo regras globais para:

| CFOP de origem | Perfil | Devolucao interna / interestadual |
| --- | --- | --- |
| 5102 | revenda padrao | 5202 / 6202 |
| 6102 | revenda padrao | 5202 / 6202 |
| 5655 | combustivel/lubrificante | 5661 / 6661 |
| 5656 | combustivel/lubrificante | 5661 / 6661 |

Regras podem ser globais ou por CNPJ e sao administradas em **Devolucoes** no painel Fiscal. O painel tambem permite ver alertas, cadastrar a regra conciliada e marcar a ocorrencia como resolvida.

## Evidencia inicial

Leitura somente dos bancos dos clientes, em 04/08/2026:

- Autoeletrica: 70 NF-e de entrada com XML; CFOPs mais frequentes `5102` (228 itens), `5403` (44), `5405` (16), `6102` (11), `6108` (11) e `6404` (20). Havia 67 notas com ST, duas de combustiveis e 44 CESTs distintos.
- Gestao Otica Pro: nao havia NF-e de entrada/XML no banco para derivar regras.
- Apoio Contabil: o fluxo encontrado era de NFS-e, portanto fora deste escopo.

Isso e material suficiente para iniciar a biblioteca, nao para presumir todas as tributacoes. Os casos de ST, combustiveis, uso/consumo e ativo devem continuar a alimentar regras confirmadas com o contador.

## Operacao e limites

- O resolvedor so roda em NF-e com finalidade de devolucao; vendas e outros documentos nao sao modificados.
- A migracao deve ser aplicada apenas no banco do Nuvem Local Fiscal.
- A tabela usa RLS e nao expoe regras para chaves anonimas/autenticadas; o backend usa a service role.
- Esta entrega nao altera repositorios nem bancos dos programas clientes e nao inclui deploy.
