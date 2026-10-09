/**
 * applicationHandler.getApplicationsByCreator (GET /api/applications/user) — tenant-scoped
 * meta.createdBy query, and each row's personalDetails is an explicit allow-list of the record's
 * own fields. The raw row carries other members' data (duplicateReview.matchSummary), audit
 * fields and legacy fields, none of which may leak. Other list endpoints (/profile/:profileId,
 * /me) keep only personalDetails.meta.isActive. Models are mocks; no DB.
 */
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.LOG_ROOT =
  process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ps-bycreator-h-"));
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const mockState = { queries: [], rows: [] };

const mockChain = (result) => {
  const q = {
    populate: () => q,
    sort: () => q,
    lean: async () => result,
  };
  return q;
};

// installed uuid is ESM-only; models require it at load time
jest.mock("uuid", () => ({ v4: () => "00000000-0000-4000-8000-000000000000" }));
jest.mock("../models/personal.details.model", () => ({
  find: jest.fn((query) => {
    mockState.queries.push(query);
    return mockChain(mockState.rows);
  }),
}));
jest.mock("../models/professional.details.model", () => ({
  findOne: jest.fn(() => mockChain(null)),
}));
jest.mock("../models/subscription.model", () => ({
  findOne: jest.fn(() => mockChain(null)),
}));

const handler = require("../handlers/application.handler");

const TENANT = "68cbf7806080b4621d469d34";
const USER = "c00000000000000000000001";
const PROFILE = "d00000000000000000000001";
const APPROVER = "e00000000000000000000001";
const CREATED = new Date("2026-10-01T10:00:00Z");
const UPDATED = new Date("2026-10-02T10:00:00Z");

const row = (overrides = {}) => ({
  _id: "p1",
  __v: 3,
  tenantId: TENANT,
  userId: USER,
  applicationId: "A1",
  applicationStatus: "submitted",
  profileId: PROFILE,
  personalInfo: { title: "Ms", forename: " Jane ", surname: "Doe", gender: "F" },
  contactInfo: { personalEmail: "jane@example.com", mobileNumber: "0871234567" },
  // populated by fetchApplicationsForList
  approvalDetails: {
    approvedBy: { _id: APPROVER, userFullName: "Approver One", userEmail: "approver@example.com" },
    approvedAt: UPDATED,
    comments: "ok",
  },
  executiveCouncilApprovalDetails: { status: "approved", comments: "ec ok" },
  duplicateDetection: {
    isPotentialDuplicate: true,
    matchedProfileIds: ["d00000000000000000000099"],
    matchedApplicationIds: ["A-OTHER"],
  },
  duplicateReview: {
    status: "pending",
    reviewedBy: APPROVER,
    matchSummary: [
      { name: "Other Member", email: "other@example.com", membershipNumber: "M999" },
    ],
    auditHistory: [{ action: "flagged", reviewedBy: APPROVER }],
  },
  meta: {
    createdBy: USER,
    updatedBy: APPROVER,
    userType: "CRM",
    deleted: false,
    isActive: true,
  },
  legacyImportRef: "LEGACY-123",
  createdAt: CREATED,
  updatedAt: UPDATED,
  ...overrides,
});

beforeEach(() => {
  mockState.queries = [];
  mockState.rows = [row()];
});

describe("GET /api/applications/user (getApplicationsByCreator)", () => {
  test("queries by tenant + meta.createdBy and excludes deleted", async () => {
    await handler.getApplicationsByCreator(USER, TENANT, []);

    expect(mockState.queries).toHaveLength(1);
    const q = mockState.queries[0];
    expect(q.tenantId).toBe(TENANT);
    expect(String(q["meta.createdBy"])).toBe(USER);
    expect(q["meta.deleted"]).toEqual({ $ne: true });
  });

  test("personalDetails is exactly the approved allow-list", async () => {
    const [app] = await handler.getApplicationsByCreator(USER, TENANT, []);

    expect(app.personalDetails).toEqual({
      _id: "p1",
      applicationId: "A1",
      applicationStatus: "submitted",
      profileId: PROFILE,
      personalInfo: {
        title: "Ms",
        forename: " Jane ",
        surname: "Doe",
        gender: "F",
        fullName: "Jane Doe",
      },
      contactInfo: { personalEmail: "jane@example.com", mobileNumber: "0871234567" },
      meta: { createdBy: USER, userType: "CRM", isActive: true },
      createdAt: CREATED,
      updatedAt: UPDATED,
    });
  });

  test("personalInfo.fullName is computed from forename + surname", async () => {
    mockState.rows = [
      row({ personalInfo: { forename: "Mary", surname: "  O'Brien ", fullName: "stale" } }),
    ];
    const [app] = await handler.getApplicationsByCreator(USER, TENANT, []);
    expect(app.personalDetails.personalInfo.fullName).toBe("Mary O'Brien");
  });

  test("meta contains only createdBy, userType, isActive", async () => {
    const [app] = await handler.getApplicationsByCreator(USER, TENANT, []);
    expect(Object.keys(app.personalDetails.meta).sort()).toEqual(
      ["createdBy", "isActive", "userType"],
    );
    expect(app.personalDetails.meta).not.toHaveProperty("deleted");
    expect(app.personalDetails.meta).not.toHaveProperty("updatedBy");
  });

  test.each([
    "duplicateDetection",
    "duplicateReview",
    "userId",
    "tenantId",
    "__v",
    "legacyImportRef",
    "approvalDetails",
    "executiveCouncilApprovalDetails",
  ])("personalDetails does not contain %s", async (field) => {
    const [app] = await handler.getApplicationsByCreator(USER, TENANT, []);
    expect(app.personalDetails).not.toHaveProperty(field);
  });

  test("no excluded value leaks anywhere in personalDetails", async () => {
    const [app] = await handler.getApplicationsByCreator(USER, TENANT, []);
    const serialized = JSON.stringify(app.personalDetails);
    for (const leaked of ["other@example.com", "M999", "A-OTHER", APPROVER, TENANT, "LEGACY-123"]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  test("meta.isActive defaults to true when absent", async () => {
    mockState.rows = [row({ meta: { createdBy: USER, userType: "PORTAL" } })];
    const [app] = await handler.getApplicationsByCreator(USER, TENANT, []);
    expect(app.personalDetails.meta).toEqual({
      createdBy: USER,
      userType: "PORTAL",
      isActive: true,
    });
  });

  test("approval details stay at the application top level", async () => {
    const [app] = await handler.getApplicationsByCreator(USER, TENANT, []);
    expect(app.approvedBy).toEqual({
      id: APPROVER,
      name: "Approver One",
      email: "approver@example.com",
    });
    expect(app.executiveCouncilApprovalDetails).toEqual(
      expect.objectContaining({ status: "approved", comments: "ec ok" }),
    );
  });

  test("does not mutate the fetched row", async () => {
    const original = row();
    mockState.rows = [original];
    await handler.getApplicationsByCreator(USER, TENANT, []);
    expect(original.personalInfo).not.toHaveProperty("fullName");
  });
});

describe("other list endpoints keep the slim personalDetails shape", () => {
  test("/profile/:profileId returns only personalDetails.meta.isActive", async () => {
    const [app] = await handler.getApplicationsByProfileId(PROFILE, []);
    expect(app.personalDetails).toEqual({ meta: { isActive: true } });
  });

  test("/me (portal user history) returns only personalDetails.meta.isActive", async () => {
    mockState.rows = [row({ meta: { isActive: false } })];
    const [app] = await handler.getApplicationsForPortalUser({
      userId: USER,
      tenantId: TENANT,
      profileIds: [PROFILE],
    });
    expect(app.personalDetails).toEqual({ meta: { isActive: false } });
  });
});
