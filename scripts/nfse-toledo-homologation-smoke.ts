const confirmation = process.argv
  .find((arg) => arg.startsWith("--confirm="))
  ?.slice("--confirm=".length);
const transmit = confirmation === "TRANSMITIR_NFSE_TOLEDO_HOMOLOGACAO";

function requiredEnv(name: string) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Configure ${name} antes de executar o smoke test.`);
  }
  return value;
}

async function main() {
  const cnpj = requiredEnv("NFSE_TOLEDO_CNPJ").replace(/\D/g, "");
  const inscricaoMunicipal = requiredEnv("NFSE_TOLEDO_INSCRICAO_MUNICIPAL");
  const idEntidade = requiredEnv("NFSE_TOLEDO_ID_ENTIDADE");
  const serviceCode = process.env.NFSE_TOLEDO_SERVICE_CODE || "17.19.01.000";
  const aliquotaIss = Number(process.env.NFSE_TOLEDO_ALIQUOTA_ISS || 3);
  const tomadorDocumento = requiredEnv("NFSE_TOLEDO_TEST_TOMADOR_DOCUMENTO")
    .replace(/\D/g, "");
  const tomadorNome =
    process.env.NFSE_TOLEDO_TEST_TOMADOR_NOME || "TOMADOR TESTE HOMOLOGACAO";

  const { buildApp } = await import("../src/app.js");
  const { config } = await import("../src/config.js");
  const app = buildApp();
  await app.ready();

  try {
    const issuer = app.store.findIssuerByCnpj(cnpj, "homologacao");
    if (!issuer) {
      throw new Error(
        `Emitente ${cnpj} nao encontrado em homologacao. Cadastre a empresa primeiro.`
      );
    }
    if (transmit && !app.store.findActiveCertificate(cnpj)?.encryptedBundle) {
      throw new Error(
        `Certificado A1 ativo nao encontrado para ${cnpj}.`
      );
    }

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.defaultClientId,
        client_secret: config.defaultClientSecret,
        scope: "empresa nfse"
      }).toString()
    });
    if (tokenResponse.statusCode !== 200) {
      throw new Error(`Falha no OAuth local: ${tokenResponse.body}`);
    }
    const bearer = {
      authorization: `Bearer ${tokenResponse.json().access_token}`,
      "content-type": "application/json"
    };

    const configResponse = await app.inject({
      method: "PUT",
      url: `/empresas/${cnpj}/nfse`,
      headers: bearer,
      payload: {
        ambiente: "homologacao",
        provedor: "toledo-equiplano",
        municipio: {
          codigo_ibge: "4127700",
          nome: "Toledo"
        },
        prefeitura: {
          login: inscricaoMunicipal
        },
        equiplano: {
          inscricao_municipal: inscricaoMunicipal,
          id_entidade: idEntidade,
          endpoint:
            process.env.NFSE_TOLEDO_HOMOLOGATION_ENDPOINT ||
            "https://www.esnfs.com.br:9443//homologacaows/services/Enfs",
          soap_action:
            process.env.NFSE_TOLEDO_SOAP_ACTION ||
            "http://services.enfsws.es/esRecepcionarLoteRps",
          request_format: "soap"
        },
        rps: {
          serie: process.env.NFSE_TOLEDO_RPS_SERIE || "1",
          emissor: process.env.NFSE_TOLEDO_RPS_EMISSOR || "1"
        },
        servico: {
          codigo: serviceCode,
          aliquota_iss: aliquotaIss
        },
        transmissao_automatica: transmit
      }
    });
    if (configResponse.statusCode !== 200) {
      throw new Error(`Falha ao configurar NFS-e Toledo: ${configResponse.body}`);
    }

    const emissionResponse = await app.inject({
      method: "POST",
      url: "/nfse/dps",
      headers: bearer,
      payload: {
        ambiente: "homologacao",
        infDPS: {
          dhEmi: new Date().toISOString(),
          dCompet: new Date().toISOString().slice(0, 10),
          prest: {
            CNPJ: cnpj
          },
          toma: {
            ...(tomadorDocumento.length === 14
              ? { CNPJ: tomadorDocumento }
              : { CPF: tomadorDocumento }),
            xNome: tomadorNome,
            end: {
              xLgr: process.env.NFSE_TOLEDO_TEST_TOMADOR_LOGRADOURO || "Rua Teste",
              nro: process.env.NFSE_TOLEDO_TEST_TOMADOR_NUMERO || "100",
              xBairro: process.env.NFSE_TOLEDO_TEST_TOMADOR_BAIRRO || "Centro",
              UF: process.env.NFSE_TOLEDO_TEST_TOMADOR_UF || "PR",
              endNac: {
                cMun:
                  process.env.NFSE_TOLEDO_TEST_TOMADOR_MUNICIPIO_IBGE || "4127700",
                CEP: process.env.NFSE_TOLEDO_TEST_TOMADOR_CEP || "85900000"
              }
            }
          },
          serv: {
            cServ: {
              cTribNac: serviceCode,
              xDescServ:
                process.env.NFSE_TOLEDO_TEST_DESCRICAO ||
                "SERVICO TESTE NFS-E TOLEDO HOMOLOGACAO"
            }
          },
          valores: {
            vServPrest: {
              vServ: Number(process.env.NFSE_TOLEDO_TEST_VALOR || 1)
            },
            trib: {
              tribMun: {
                tribISSQN: 1,
                tpRetISSQN: 1,
                pAliq: aliquotaIss
              }
            }
          }
        }
      }
    });

    console.log(
      JSON.stringify(
        {
          modo: transmit ? "transmissao_homologacao" : "dry_run",
          http_status: emissionResponse.statusCode,
          ...emissionResponse.json()
        },
        null,
        2
      )
    );
    if (emissionResponse.statusCode < 200 || emissionResponse.statusCode >= 300) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
