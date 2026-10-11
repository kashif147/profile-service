"use strict";
/**
 * Phase 2B (H-09 / H-31 / id-only consumer writes) — Tenant A/B isolation for
 * RabbitMQ consumers: email-based user.crm / user.portal linking (tenant-scoped,
 * regex-escaped), envelope-vs-data tenant mismatch refusal, application
 * approval + application create listeners never re-tenanting stored rows, and
 * the members.subscription.current.updated.v1 id-only consumer.
 */
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.LOG_ROOT =
  process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ps-listeners-"));
process.env.NODE_ENV = process.env.NODE_ENV || "test";

jest.mock("uuid", () => ({ v4: () => "00000000-0000-4000-8000-000000000000" }));
const mm = () => require("./helpers/memoryModel");
jest.mock("../models/personal.details.model.js", () => mm().createMemoryModel("PersonalDetails"));
jest.mock("../models/professional.details.model.js", () => mm().createMemoryModel("ProfessionalDetails"));
jest.mock("../models/subscription.model.js", () => mm().createMemoryModel("SubscriptionDetails"));
jest.mock("../models/profile.model.js", () => mm().createMemoryModel("Profile"));
jest.mock("../models/user.model.js", () => mm().createMemoryModel("User"));
jest.mock("../rabbitMQ/publishers/application.approval.publisher.js", () => ({
  publishSubscriptionUpsertRequested: jest.fn(async () => {}),
}));
jest.mock("../services/profile.audit.publisher.js", () => ({
  publishProfileAfterUpdateOne: jest.fn(async () => {}),
  publishProfileAudit: jest.fn(async () => {}),
  cloneForAudit: (x) => x,
}));
jest.mock("../services/duplicate.detection.service.js", () => ({
  queueDuplicateDetection: jest.fn(),
}));
const mockHandlers = {};
jest.mock("@projectShell/rabbitmq-middleware", () => ({
  init: jest.fn(async () => {}),
  publisher: { publish: jest.fn(async () => {}) },
  consumer: {
    createQueue: jest.fn(async () => {}),
    bindQueue: jest.fn(async () => {}),
    registerHandler: jest.fn((key, fn) => {
      mockHandlers[key] = fn;
    }),
    consume: jest.fn(async () => {}),
  },
  EVENT_TYPES: {},
  shutdown: jest.fn(async () => {}),
}));

const PersonalDetails = require("../models/personal.details.model.js");
const ProfessionalDetails = require("../models/professional.details.model.js");
const SubscriptionDetails = require("../models/subscription.model.js");
const Profile = require("../models/profile.model.js");
const User = require("../models/user.model.js");
const crm = require("../rabbitMQ/listeners/user.crm.listener.js");
const portal = require("../rabbitMQ/listeners/user.portal.listener.js");
const approvalListener = require("../rabbitMQ/listeners/application.approval.listener.js");
const createListener = require("../rabbitMQ/listeners/profile.application.create.listerner.js");
const { resolveEventTenantId, exactEmailRegex } = require("../rabbitMQ/eventTenant.js");

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const PA = "a00000000000000000000001";
const PB = "b00000000000000000000001";

beforeEach(() => {
  for (const M of [PersonalDetails, ProfessionalDetails, SubscriptionDetails, Profile, User]) M.reset();
  PersonalDetails.seed([
    { applicationId: "app-a", tenantId: A, contactInfo: { personalEmail: "nurse@example.com" }, applicationStatus: "submitted", meta: {} },
    { applicationId: "app-b", tenantId: B, contactInfo: { personalEmail: "nurse@example.com" }, applicationStatus: "submitted", meta: {} },
    // would match the UNESCAPED regex ^a+b@x.com$ for event email "a+b@x.com"
    { applicationId: "app-regex", tenantId: A, contactInfo: { personalEmail: "aaab@x.com" }, applicationStatus: "submitted", meta: {} },
  ]);
  ProfessionalDetails.seed([
    { applicationId: "app-a", tenantId: A },
    { applicationId: "app-b", tenantId: B },
  ]);
  SubscriptionDetails.seed([
    { applicationId: "app-a", tenantId: A },
    { applicationId: "app-b", tenantId: B },
  ]);
  Profile.seed([
    { _id: PA, tenantId: A, normalizedEmail: "nurse@example.com", userId: null },
    { _id: PB, tenantId: B, normalizedEmail: "nurse@example.com", userId: null },
  ]);
});

const byApp = (M, id) => M.all().find((d) => d.applicationId === id);

describe("eventTenant helper", () => {
  test("envelope wins; mismatch refused; missing refused", () => {
    expect(resolveEventTenantId({ tenantId: A, data: {} })).toEqual({ ok: true, tenantId: A });
    expect(resolveEventTenantId({ data: { tenantId: B } })).toEqual({ ok: true, tenantId: B });
    expect(resolveEventTenantId({ tenantId: A, data: { tenantId: B } }).ok).toBe(false);
    expect(resolveEventTenantId({ data: {} }).ok).toBe(false);
  });
  test("email regex is escaped", () => {
    expect(exactEmailRegex("a+b@x.com").test("aaab@x.com")).toBe(false);
    expect(exactEmailRegex("a+b@x.com").test("A+B@X.COM")).toBe(true);
  });
});

describe("user.crm listener (H-09)", () => {
  test("tenant A event links only tenant A staging rows", async () => {
    await crm.handleCrmUserCreated({
      tenantId: A,
      data: { userId: "crm-user-a", userEmail: "nurse@example.com", tenantId: A },
    });
    expect(byApp(PersonalDetails, "app-a").userId).toBe("crm-user-a");
    expect(byApp(PersonalDetails, "app-b").userId).toBeUndefined();
    expect(byApp(ProfessionalDetails, "app-b").userId).toBeUndefined();
    expect(byApp(SubscriptionDetails, "app-b").userId).toBeUndefined();
  });

  test("envelope/data tenant mismatch: event refused, nothing written", async () => {
    await crm.handleCrmUserUpdated({
      tenantId: A,
      data: { userId: "crm-user-x", userEmail: "nurse@example.com", tenantId: B },
    });
    expect(User.all()).toEqual([]);
    expect(PersonalDetails.all().every((p) => p.userId === undefined)).toBe(true);
  });

  test("regex metacharacters in the email do not widen the match", async () => {
    await crm.handleCrmUserCreated({
      tenantId: A,
      data: { userId: "crm-regex", userEmail: "a+b@x.com", tenantId: A },
    });
    expect(byApp(PersonalDetails, "app-regex").userId).toBeUndefined();
  });
});

describe("user.portal listener (H-09)", () => {
  test("tenant B event links only tenant B rows and B's profile", async () => {
    await portal.handlePortalUserCreated({
      tenantId: B,
      data: { userId: "portal-b", userEmail: "nurse@example.com", tenantId: B },
    });
    const userB = User.all()[0];
    expect(String(byApp(PersonalDetails, "app-b").userId)).toBe(String(userB._id));
    expect(byApp(PersonalDetails, "app-a").userId).toBeUndefined();
    expect(Profile.all().find((p) => p._id === PA).userId).toBeNull();
    expect(String(Profile.all().find((p) => p._id === PB).userId)).toBe(String(userB._id));
  });

  test("updated event with a mismatching data tenant is refused", async () => {
    await portal.handlePortalUserUpdated({
      tenantId: B,
      data: { userId: "portal-b", userEmail: "nurse@example.com", tenantId: A },
    });
    expect(User.all()).toEqual([]);
    expect(byApp(PersonalDetails, "app-a").userId).toBeUndefined();
  });
});

describe("application.approval listener (id-only writes)", () => {
  test("event for tenant A cannot rewrite tenant B's application", async () => {
    await approvalListener.handleApplicationApproved(
      {
        applicationId: "app-b",
        tenantId: A,
        applicationStatus: "processed",
        effective: { personalInfo: { forename: "Evil" }, contactInfo: {} },
      },
      { envelopeTenantId: A },
    );
    const b = byApp(PersonalDetails, "app-b");
    expect(b.tenantId).toBe(B);
    expect(b.applicationStatus).toBe("submitted");
    expect(PersonalDetails.all().filter((p) => p.applicationId === "app-b")).toHaveLength(1);
  });

  test("own-tenant event processes the application", async () => {
    await approvalListener.handleApplicationApproved(
      {
        applicationId: "app-a",
        tenantId: A,
        applicationStatus: "processed",
        effective: { personalInfo: { forename: "Ok" }, contactInfo: {} },
      },
      { envelopeTenantId: A },
    );
    expect(byApp(PersonalDetails, "app-a").applicationStatus).toBe("processed");
  });
});

describe("profile.application.create listener (H-31)", () => {
  test("body tenant cannot overwrite the stored tenant", async () => {
    await createListener.handleProfileApplicationCreate({
      applicationId: "app-a",
      tenantId: B,
      status: "submitted",
      personalDetails: { personalInfo: { forename: "X" }, contactInfo: {}, meta: {} },
      professionalDetails: { professionalDetails: {} },
      subscriptionDetails: { subscriptionDetails: {} },
    });
    const rows = PersonalDetails.all().filter((p) => p.applicationId === "app-a");
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantId).toBe(A);
    expect(rows[0].personalInfo).toBeUndefined();
  });
});

describe("members.subscription.current.updated.v1 consumer (id-only)", () => {
  beforeAll(async () => {
    // tests/setup.js mocks ../rabbitMQ globally; load the real module here.
    const rabbit = jest.requireActual("../rabbitMQ/index.js");
    await rabbit.setupConsumers();
  });

  test("envelope tenant B cannot update tenant A's profile", async () => {
    const handler = mockHandlers["members.subscription.current.updated.v1"];
    expect(typeof handler).toBe("function");
    await handler({
      tenantId: B,
      data: { profileId: PA, subscriptionId: "c00000000000000000000001" },
    });
    expect(Profile.all().find((p) => p._id === PA).currentSubscriptionId).toBeUndefined();
  });

  test("own-tenant event updates the profile", async () => {
    const handler = mockHandlers["members.subscription.current.updated.v1"];
    await handler({
      tenantId: A,
      data: { profileId: PA, subscriptionId: "c00000000000000000000001" },
    });
    expect(Profile.all().find((p) => p._id === PA).currentSubscriptionId).toBe("c00000000000000000000001");
  });

  test("data tenant disagreeing with envelope is refused", async () => {
    const handler = mockHandlers["members.subscription.current.updated.v1"];
    await handler({
      tenantId: A,
      data: { profileId: PA, subscriptionId: "c00000000000000000000002", tenantId: B },
    });
    expect(Profile.all().find((p) => p._id === PA).currentSubscriptionId).toBeUndefined();
  });
});
