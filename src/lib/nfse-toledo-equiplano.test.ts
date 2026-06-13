import assert from "node:assert/strict";
import test from "node:test";

import { allowsLegacyEquiplanoHomologationTls } from "./nfse-toledo-equiplano.js";

test("allows incomplete TLS chain only for Equiplano homologation", () => {
  assert.equal(
    allowsLegacyEquiplanoHomologationTls(
      new URL("https://www.esnfs.com.br:9443//homologacaows/services/Enfs")
    ),
    true
  );
  assert.equal(
    allowsLegacyEquiplanoHomologationTls(
      new URL("https://www.esnfs.com.br:9443/producao/services/Enfs")
    ),
    false
  );
  assert.equal(
    allowsLegacyEquiplanoHomologationTls(
      new URL("https://example.com:9443/homologacaows/services/Enfs")
    ),
    false
  );
  assert.equal(
    allowsLegacyEquiplanoHomologationTls(
      new URL("http://www.esnfs.com.br:9443/homologacaows/services/Enfs")
    ),
    false
  );
});
