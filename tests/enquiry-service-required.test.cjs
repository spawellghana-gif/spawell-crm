const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const actions = readFileSync(
  path.join(__dirname, "../src/app/(app)/enquiries/actions.ts"),
  "utf8",
);
const detailPage = readFileSync(
  path.join(__dirname, "../src/app/(app)/enquiries/[id]/page.tsx"),
  "utf8",
);

test("booking conversion rejects a missing service before creating a client", () => {
  const validation = actions.indexOf('if (!serviceId)');
  const clientCreation = actions.indexOf('// 1. client', validation);
  assert.ok(validation >= 0, "missing-service validation must exist");
  assert.ok(clientCreation > validation, "service validation must run before client creation");
  assert.match(actions, /Choose a service before converting this enquiry to a booking/);
});

test("booking conversion uses the validated service throughout", () => {
  assert.match(actions, /service_id: serviceId/);
  assert.match(actions, /pref_service_id: serviceId/);
  assert.match(actions, /serviceName: selectedService\.name/);
});

test("conversion form presents an active-service selector and requires a choice", () => {
  assert.match(detailPage, /from\("service"\).*eq\("active", true\)/);
  assert.match(detailPage, /name="service_id"/);
  assert.match(detailPage, /defaultValue=\{e\.service_id \?\? ""\} required/);
});
