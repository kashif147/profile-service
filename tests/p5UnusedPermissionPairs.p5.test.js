"use strict";
/**
 * P5 blocker 1 regression guard. Under PDP audience enforcement these permission pairs become PERMIT for MO / REO
 * (they hold them in existing tenants, outside their P8 targets). Today NO route checks them, so they open nothing.
 * This test keeps it that way in profile-service: any PDP call or local claim check on one of them fails here.
 * (MO: 8, REO: 4 -> 12 role-pair entries; changeOfCategory:create and transferRequests:create are shared -> 10 pairs.)
 * If a route genuinely needs one, the P5 blocker plan must be revisited first (role clean-up or a P6 guard).
 * GUARDED_PAIRS lists the pairs a P6 guard has since made safe, and the only files allowed to check them.
 */
const fs = require("fs");
const path = require("path");

const UNUSED_PAIRS = Object.freeze([
  "application:delete",
  "changeOfCategory:create",
  "changeOfCategory:delete",
  "changeOfCategory:write",
  "subscriptions:create",
  "subscriptions:delete",
  "subscriptions:write",
  "transferRequests:create",
  "transferRequests:delete",
]);
// P6 (2026-11-09): transferRequests:write is now checked, but only behind the local reviewer guard that keeps REO
// read-only (middlewares/p5ActionGuards.js requireTransferReviewer: "*" or MO + the claim). Allowed only there.
const GUARDED_PAIRS = Object.freeze({
  "transferRequests:write": ["routes/transfer.request.routes.js", "middlewares/p5ActionGuards.js"],
});
const ROOTS = ["routes", "middlewares", "controllers", "services", "helpers", "app.js"];
const ROOT = path.join(__dirname, "..");

function jsFiles(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return rel.endsWith(".js") ? [rel] : [];
  return fs.readdirSync(abs).flatMap((n) => jsFiles(path.join(rel, n)));
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function patternsFor(pair) {
  const [res, act] = pair.split(":");
  return [
    // any ("resource", "action") argument pair: requireCrm / requirePermission / evaluate / wrappers
    new RegExp(`["'\`]${esc(res)}["'\`]\\s*,\\s*["'\`]${esc(act)}["'\`]`, "i"),
    // a literal claim string checked locally
    new RegExp(`["'\`]${esc(res)}:${esc(act)}["'\`]`, "i"),
  ];
}

function scan(pairs, files) {
  const hits = [];
  for (const rel of files) {
    const lines = fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n");
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "");
      if (/^\s*\*/.test(code)) return; // block-comment body
      for (const pair of pairs) if (patternsFor(pair).some((re) => re.test(code))) hits.push(`${pair} at ${rel}:${i + 1}`);
    });
  }
  return hits;
}

const FILES = ROOTS.flatMap(jsFiles);

test("scanner covers the service source (sanity)", () => {
  expect(FILES.length).toBeGreaterThan(20);
  // the scanner does detect a pair that IS wired (profile:delete on soft delete), so a clean result means something
  expect(scan(["profile:delete"], FILES).length).toBeGreaterThan(0);
});

test("P5 blocker 1: none of the 9 currently-unused pairs is checked by any profile-service route or guard", () => {
  const hits = scan(UNUSED_PAIRS, FILES);
  if (hits.length) {
    throw new Error(
      `P5 blocker 1 regression: these pairs become usable by MO/REO under audience enforcement and must stay ` +
        `unreachable until the role clean-up (phase X) or a P6 guard lands:\n  ${hits.join("\n  ")}`,
    );
  }
  expect(hits).toEqual([]);
});

test("P6: transferRequests:write is checked only on transfer review, behind requireTransferReviewer", () => {
  for (const [pair, allowed] of Object.entries(GUARDED_PAIRS)) {
    const outside = scan([pair], FILES).filter((h) => !allowed.some((f) => h.includes(` at ${f}:`)));
    expect(outside).toEqual([]);
  }
  const routes = fs.readFileSync(path.join(ROOT, "routes/transfer.request.routes.js"), "utf8");
  expect(routes).toMatch(/"\/:requestId",\s*authenticate,\s*requireCrm\("transferRequests", "write"\),\s*requireTransferReviewer,\s*transferRequestController\.reviewTransferRequest/);
});
