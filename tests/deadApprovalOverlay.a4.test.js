// Phase A / A4 — the unwired approval/overlay modules (no route, no live importer) were deleted rather
// than given tenancy logic. Guard: they stay gone and nothing re-imports them; the live approval and
// overlay paths (profileApproval / bulkApproval / overlay controllers) remain the only ones mounted.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DEAD = [
  "services/approval.service.js",
  "services/overlay.service.js",
  "helpers/approval.helpers.js",
  "helpers/overlay.helpers.js",
  "controllers/applications.controller.js",
];

function jsFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "tests", "coverage"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...jsFiles(p));
    else if (/\.(c|m)?js$/.test(e.name)) out.push(p);
  }
  return out;
}

test("the dead approval/overlay modules are deleted", () => {
  for (const f of DEAD) expect(fs.existsSync(path.join(ROOT, f))).toBe(false);
});

test("no source file imports a deleted module", () => {
  const re = /require\([^)]*(approval\.service|overlay\.service|approval\.helpers|overlay\.helpers|applications\.controller)(\.js)?['"]\)/;
  const offenders = jsFiles(ROOT).filter((f) => re.test(fs.readFileSync(f, "utf8")));
  expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
});

test("applications routes mount only the live, tenant-scoped controllers", () => {
  const src = fs.readFileSync(path.join(ROOT, "routes", "applications.routes.js"), "utf8");
  expect(src).toMatch(/overlay\.controller/);
  expect(src).toMatch(/profileApproval\.controller/);
  expect(src).toMatch(/bulkApproval\.controller/);
});
