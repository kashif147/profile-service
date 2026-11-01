// The profile ownership migration changes OWNERSHIP ONLY: each tenant-owned 'profile' default must reproduce
// the currently effective live shared row exactly - columns (keys and order), labels, filters, visible
// filters, name and flags. Only tenant ownership / system metadata may differ. The creditnotes and
// membershiplisting strays and the MULTIAUTH application row are not part of the manifest.
// Fixture: stored configuration of the live DEV shared 'profile' row (field presence preserved).
const g = require("../services/tenantGridDefaults");
const Template = require("../models/template.model");
const live = require("./fixtures/liveSharedGridDefaults.dev-20261101.json");

const OWNERSHIP_AND_SYSTEM_KEYS = ["_id", "tenantId", "userId", "createdAt", "updatedAt", "__v", "meta", "systemDefault"];
const TENANT = "68cbf7806080b4621d469d34";
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !OWNERSHIP_AND_SYSTEM_KEYS.includes(k)));
const built = () => g.buildTenantDefault(g.loadCanonical(), TENANT, "profile", new Date(0), undefined);

test("manifest covers only 'profile' (no strays, no application)", () => {
  expect(Object.keys(g.loadCanonical().templates)).toEqual(["profile"]);
});

test("profile: tenant-owned copy is semantically identical to the live shared row", () => {
  const stored = live.rows.profile.stored;
  const doc = built();
  expect(doc.columns).toEqual(stored.columns); // keys and order
  expect(doc.columnLabels).toEqual(stored.columnLabels || {});
  expect(doc.filters).toEqual(stored.filters || {});
  expect(doc.visibleFilters).toEqual(stored.visibleFilters || []);
  expect(doc.name).toBe(stored.name);
  expect(doc.isDefault).toBe(stored.isDefault === true);
  expect(doc.pinned).toBe(stored.pinned === true);
});

test("profile: through the real Template model the copy hydrates exactly like the live row (only ownership/system metadata differs)", () => {
  const asServed = (raw) => strip(Template.hydrate({ _id: "600000000000000000000001", ...raw }).toObject());
  expect(asServed(strip(built()))).toEqual(asServed(live.rows.profile.stored));
});
