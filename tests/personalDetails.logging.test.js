/**
 * Personal-details controller logging: ids, outcomes and error names/codes/field names only.
 * Request headers (Authorization, cookies), bodies, params, req.user / req.ctx, personal-details
 * records and whole error objects never reach the logs. Responses are unchanged: every response
 * assertion here also holds for the previous controller.
 *
 * The real controller, response middleware and Joi schemas are used; only the service, handler,
 * Profile lookup and (for success paths) schema validation are stubbed.
 */
// uuid ships ESM only; the models import it for default ids, which these tests never generate.
jest.mock("uuid", () => ({ v4: () => "00000000-0000-4000-8000-000000000000" }));

const mongoose = require("mongoose");
const controller = require("../controllers/personal.details.controller");
const personalDetailsService = require("../services/personal.details.service");
const personalDetailsHandler = require("../handlers/personal.details.handler");
const joischemas = require("../validation/index.js");
const Profile = require("../models/profile.model.js");
const responseMw = require("../middlewares/response.mw");

const TENANT_ID = "68cbf7806080b4621d469d34";
const USER_ID = "6ab3fbeb327c7b49baf116fa";
const APPLICATION_ID = "app-0001";
const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzZWNyZXQtc3ViamVjdCJ9.SECRET-JWT-SIGNATURE-0123";
const SENSITIVE = {
  email: "secret.person@example.org",
  forename: "Secretforename",
  surname: "Secretsurname",
  dateOfBirth: "1987-03-21",
  addressLine1: "12 Secret Street",
  eircode: "D02 SE99",
  mobile: "+353 87 765 4321",
  cookie: "connect.sid=SECRET-COOKIE-0123",
};
const SECRET_VALUES = [JWT, "SECRET-JWT-SIGNATURE", ...Object.values(SENSITIVE), "SECRET-"];
// Plain objects as JSON (for the field assertions); Error objects as the console prints them
// (message and stack included), so a logged error object is caught.
const render = (a) =>
  typeof a === "string" ? a : a instanceof Error ? require("util").inspect(a) : JSON.stringify(a);

const body = () => ({
  personalInfo: { forename: SENSITIVE.forename, surname: SENSITIVE.surname, dateOfBirth: SENSITIVE.dateOfBirth },
  contactInfo: {
    personalEmail: SENSITIVE.email,
    mobileNumber: SENSITIVE.mobile,
    buildingOrHouse: SENSITIVE.addressLine1,
    eircode: SENSITIVE.eircode,
  },
});
const record = () => ({ _id: "pd-1", applicationId: APPLICATION_ID, tenantId: TENANT_ID, userId: USER_ID, ...body() });

// req.user carries the email as the real auth middleware does: the controller must not dump it.
const request = (extra = {}) => ({
  method: "POST",
  url: "/api/personal-details",
  headers: { authorization: `Bearer ${JWT}`, cookie: SENSITIVE.cookie, "content-type": "application/json" },
  user: { id: USER_ID, userType: "PORTAL", tenantId: TENANT_ID, email: SENSITIVE.email },
  ctx: { tenantId: TENANT_ID, userId: USER_ID, email: SENSITIVE.email },
  tenantId: TENANT_ID,
  params: { applicationId: APPLICATION_ID },
  body: body(),
  ...extra,
});

async function run(action, req) {
  const res = {};
  res.statusCode = 200;
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  responseMw(req, res, () => {});
  let nextArg;
  await controller[action](req, res, (e) => {
    nextArg = e;
  });
  return {
    status: res.body === undefined ? null : res.statusCode,
    body: res.body === undefined ? null : JSON.parse(JSON.stringify(res.body)),
    next: nextArg ? { status: nextArg.status ?? null, message: nextArg.message } : null,
  };
}

const logs = () =>
  [console.log, console.error, console.warn, console.info]
    .flatMap((fn) => fn.mock.calls)
    .map((args) => args.map(render).join(" "))
    .join("\n");
const expectNoSensitiveLogs = () => {
  const text = logs();
  for (const value of SECRET_VALUES) expect(text).not.toContain(value);
  expect(text).not.toMatch(/authorization|Bearer|cookie|keyValue|Request (headers|user|ctx|params)/i);
};

beforeEach(() => {
  for (const level of ["log", "error", "warn", "info"]) jest.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const stubCreatePath = () => {
  jest.spyOn(personalDetailsHandler, "getByUserId").mockResolvedValue(null);
  jest.spyOn(joischemas.personal_details_create, "validateAsync").mockImplementation(async (b) => b);
};
const mongooseValidationError = () => {
  const err = new mongoose.Error.ValidationError();
  err.addError(
    "personalInfo.dateOfBirth",
    new mongoose.Error.CastError("Date", SENSITIVE.dateOfBirth + "x", "personalInfo.dateOfBirth"),
  );
  err.addError(
    "contactInfo.personalEmail",
    new mongoose.Error.ValidatorError({ message: `bad email ${SENSITIVE.email}`, path: "contactInfo.personalEmail", value: SENSITIVE.email }),
  );
  return err;
};
const duplicateKeyError = () =>
  Object.assign(new Error(`E11000 duplicate key error dup key: { contactInfo.personalEmail: "${SENSITIVE.email}" }`), {
    name: "MongoServerError",
    code: 11000,
    keyPattern: { tenantId: 1, "contactInfo.personalEmail": 1 },
    keyValue: { tenantId: TENANT_ID, "contactInfo.personalEmail": SENSITIVE.email },
  });
const serviceError = () => Object.assign(new Error(`lookup failed for ${SENSITIVE.email}`), { code: "SVC_DOWN" });

describe("createPersonalDetails", () => {
  test("success: response unchanged", async () => {
    stubCreatePath();
    jest.spyOn(personalDetailsService, "createPersonalDetails").mockResolvedValue(record());
    const r = await run("createPersonalDetails", request());
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("success");
    expect(r.body.data.contactInfo.personalEmail).toBe(SENSITIVE.email);
    expect(r.body.data.personalInfo.fullName).toBe(`${SENSITIVE.forename} ${SENSITIVE.surname}`);
  });

  test("success: ids and outcome logged, nothing sensitive", async () => {
    stubCreatePath();
    jest.spyOn(personalDetailsService, "createPersonalDetails").mockResolvedValue(record());
    await run("createPersonalDetails", request());
    expectNoSensitiveLogs();
    expect(logs()).toMatch(new RegExp(`User context:.*"tenantId":"${TENANT_ID}".*"userId":"${USER_ID}".*"userType":"PORTAL"`));
    expect(logs()).toMatch(new RegExp(`createPersonalDetails SUCCESS.*"applicationId":"${APPLICATION_ID}"`));
  });

  test("Joi validation error: response unchanged", async () => {
    const r = await run("createPersonalDetails", request({ body: { ...body(), unexpectedSecretField: SENSITIVE.email } }));
    expect(r.next.status).toBe(400);
    expect(r.next.message).toMatch(/^Validation error: /);
  });

  test("Joi validation error: field paths only", async () => {
    await run("createPersonalDetails", request({ body: { ...body(), unexpectedSecretField: SENSITIVE.email } }));
    expectNoSensitiveLogs();
    expect(logs()).toMatch(/\[createPersonalDetails\] Error:.*"name":"ValidationError".*"fields":\["/);
  });

  test("Mongoose validation error: passed on unchanged; Object.keys(errors) only", async () => {
    stubCreatePath();
    const err = mongooseValidationError();
    jest.spyOn(personalDetailsService, "createPersonalDetails").mockRejectedValue(err);
    const r = await run("createPersonalDetails", request());
    expect(r.next).toEqual({ status: null, message: err.message });
    expectNoSensitiveLogs();
    expect(logs()).toMatch(/"fields":\["personalInfo\.dateOfBirth","contactInfo\.personalEmail"\]/);
  });

  test("duplicate key: passed on unchanged; Object.keys(keyPattern) only, never keyValue", async () => {
    stubCreatePath();
    const err = duplicateKeyError();
    jest.spyOn(personalDetailsService, "createPersonalDetails").mockRejectedValue(err);
    const r = await run("createPersonalDetails", request());
    expect(r.next).toEqual({ status: null, message: err.message });
    expectNoSensitiveLogs();
    expect(logs()).toMatch(/"code":11000,"fields":\["tenantId","contactInfo\.personalEmail"\]/);
  });

  test("service error: passed on unchanged; name and code only", async () => {
    stubCreatePath();
    const err = serviceError();
    jest.spyOn(personalDetailsService, "createPersonalDetails").mockRejectedValue(err);
    const r = await run("createPersonalDetails", request());
    expect(r.next).toEqual({ status: null, message: err.message });
    expectNoSensitiveLogs();
    expect(logs()).toMatch(/\[createPersonalDetails\] Error:.*"name":"Error","code":"SVC_DOWN"/);
  });
});

describe("getMyPersonalDetails", () => {
  test("found: response unchanged; no headers, user, ctx or record in logs", async () => {
    jest.spyOn(personalDetailsService, "getMyPersonalDetails").mockResolvedValue(record());
    const r = await run("getMyPersonalDetails", request({ method: "GET", body: {} }));
    expect(r.status).toBe(200);
    expect(r.body.data.contactInfo.personalEmail).toBe(SENSITIVE.email);
    expectNoSensitiveLogs();
    expect(logs()).toMatch(/Service response: \{"found":true\}/);
    expect(logs()).toMatch(new RegExp(`Extracted context:.*"tenantId":"${TENANT_ID}".*"userId":"${USER_ID}"`));
  });

  test("not found: response unchanged", async () => {
    jest.spyOn(personalDetailsService, "getMyPersonalDetails").mockResolvedValue(null);
    const r = await run("getMyPersonalDetails", request({ method: "GET", body: {} }));
    expect(r.body).toEqual({ success: true, data: null, message: "Personal details not found" });
    expectNoSensitiveLogs();
    expect(logs()).toMatch(/Service response: \{"found":false\}/);
  });

  test("service error: passed on unchanged; no error object in logs", async () => {
    const err = serviceError();
    jest.spyOn(personalDetailsService, "getMyPersonalDetails").mockRejectedValue(err);
    const r = await run("getMyPersonalDetails", request({ method: "GET", body: {} }));
    expect(r.next).toEqual({ status: null, message: err.message });
    expectNoSensitiveLogs();
    expect(logs()).toMatch(/\[getMyPersonalDetails\] Error:.*"code":"SVC_DOWN"/);
  });
});

describe("getPersonalDetails / updatePersonalDetails / deletePersonalDetails / getApplicationStatus", () => {
  test("getPersonalDetails found: response unchanged; no params, user or ctx dump", async () => {
    jest.spyOn(personalDetailsService, "getPersonalDetails").mockResolvedValue(record());
    const r = await run("getPersonalDetails", request({ method: "GET", body: {} }));
    expect(r.status).toBe(200);
    expect(r.body.data.applicationId).toBe(APPLICATION_ID);
    expectNoSensitiveLogs();
    expect(logs()).toMatch(new RegExp(`Extracted context:.*"applicationId":"${APPLICATION_ID}"`));
  });

  test("updatePersonalDetails success: response unchanged; req.user (with email) not logged", async () => {
    jest.spyOn(joischemas.personal_details_update, "validateAsync").mockImplementation(async (b) => b);
    jest.spyOn(personalDetailsService, "updatePersonalDetails").mockResolvedValue(record());
    const r = await run("updatePersonalDetails", request({ method: "PUT" }));
    expect(r.status).toBe(200);
    expect(r.body.data.contactInfo.personalEmail).toBe(SENSITIVE.email);
    expectNoSensitiveLogs();
    expect(logs()).toMatch(new RegExp(`\\[updatePersonalDetails\\] Context:.*"applicationId":"${APPLICATION_ID}"`));
  });

  test("updatePersonalDetails Joi error: response unchanged", async () => {
    const r = await run("updatePersonalDetails", request({ method: "PUT", body: { ...body(), unexpectedSecretField: SENSITIVE.email } }));
    expect(r.next.status).toBe(400);
    expect(r.next.message).toMatch(/^Validation error: /);
    expectNoSensitiveLogs();
  });

  test("updatePersonalDetails Mongoose error: response unchanged", async () => {
    jest.spyOn(joischemas.personal_details_update, "validateAsync").mockImplementation(async (b) => b);
    const err = mongooseValidationError();
    jest.spyOn(personalDetailsService, "updatePersonalDetails").mockRejectedValue(err);
    const r = await run("updatePersonalDetails", request({ method: "PUT" }));
    expect(r.next).toEqual({ status: 400, message: "Mongoose model validation error: " + err.message });
    expectNoSensitiveLogs();
  });

  for (const [action, method] of [
    ["getPersonalDetails", "getPersonalDetails"],
    ["deletePersonalDetails", "deletePersonalDetails"],
    ["getApplicationStatus", "getApplicationStatus"],
  ]) {
    test(`${action} service error: passed on unchanged; name and code only`, async () => {
      const err = serviceError();
      jest.spyOn(personalDetailsService, method).mockRejectedValue(err);
      const r = await run(action, request({ method: "GET", body: {} }));
      expect(r.next).toEqual({ status: null, message: err.message });
      expectNoSensitiveLogs();
      expect(logs()).toMatch(new RegExp(`\\[${action}\\] Error:.*"name":"Error","code":"SVC_DOWN"`));
    });
  }
});

describe("checkEmailExists", () => {
  test("service error: passed on unchanged; the email is not logged", async () => {
    jest.spyOn(Profile, "findOne").mockReturnValue({ select: () => ({ lean: async () => null }) });
    const err = serviceError();
    jest.spyOn(personalDetailsHandler, "getByEmail").mockRejectedValue(err);
    const r = await run("checkEmailExists", request({ body: { email: SENSITIVE.email } }));
    expect(r.next).toEqual({ status: null, message: err.message });
    expectNoSensitiveLogs();
    expect(logs()).toMatch(/\[checkEmailExists\] Error:.*"code":"SVC_DOWN"/);
  });

  test("not found: response unchanged", async () => {
    jest.spyOn(Profile, "findOne").mockReturnValue({ select: () => ({ lean: async () => null }) });
    jest.spyOn(personalDetailsHandler, "getByEmail").mockResolvedValue(null);
    const r = await run("checkEmailExists", request({ body: { email: SENSITIVE.email } }));
    expect(r.body).toEqual({
      status: "success",
      data: { exists: false, status: true, message: "No profiles with this email already exist" },
    });
    expectNoSensitiveLogs();
  });
});
