/**
 * GET /api/applications/user — applications whose personalDetails.meta.createdBy is the
 * authenticated user. The user ID comes from the token context only (req.params/query ignored);
 * the query is tenant scoped. Service is mocked; no DB.
 */
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.LOG_ROOT =
  process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ps-bycreator-"));
process.env.NODE_ENV = process.env.NODE_ENV || "test";

// installed uuid is ESM-only; models require it at load time
jest.mock("uuid", () => ({ v4: () => "00000000-0000-4000-8000-000000000000" }));
jest.mock("../services/application.service", () => ({
  getApplicationsByCreator: jest.fn(async () => [{ applicationId: "A1" }]),
}));

const applicationService = require("../services/application.service");
const { getApplicationsByUserId } = require("../controllers/application.controller");

const TENANT = "68cbf7806080b4621d469d34";
const USER = "c00000000000000000000001";
const OTHER = "c00000000000000000000002";

const run = async (user, extra = {}) => {
  const req = { user, params: {}, query: {}, headers: {}, ...extra };
  const res = { success: jest.fn((data) => data) };
  const next = jest.fn();
  await getApplicationsByUserId(req, res, next);
  return { res, next };
};

beforeEach(() => applicationService.getApplicationsByCreator.mockClear());

test.each(["CRM", "PORTAL"])("%s user gets applications they created", async (userType) => {
  const { res, next } = await run({ id: USER, tenantId: TENANT, userType });

  expect(next).not.toHaveBeenCalled();
  expect(applicationService.getApplicationsByCreator).toHaveBeenCalledWith(USER, TENANT, []);
  expect(res.success).toHaveBeenCalledWith({
    userId: USER,
    count: 1,
    applications: [{ applicationId: "A1" }],
  });
});

test("ignores a userId supplied in params/query", async () => {
  await run(
    { id: USER, tenantId: TENANT, userType: "CRM" },
    { params: { userId: OTHER }, query: { userId: OTHER } },
  );
  expect(applicationService.getApplicationsByCreator).toHaveBeenCalledWith(USER, TENANT, []);
});

test.each([
  ["missing tenant", { id: USER, userType: "CRM" }],
  ["missing user id", { tenantId: TENANT, userType: "CRM" }],
  ["unknown user type", { id: USER, tenantId: TENANT, userType: "OTHER" }],
])("rejects %s", async (_label, user) => {
  const { res, next } = await run(user);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
  expect(res.success).not.toHaveBeenCalled();
  expect(applicationService.getApplicationsByCreator).not.toHaveBeenCalled();
});

test("rejects a non-ObjectId user id in the token", async () => {
  const { next } = await run({ id: "not-an-id", tenantId: TENANT, userType: "CRM" });
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
  expect(applicationService.getApplicationsByCreator).not.toHaveBeenCalled();
});
