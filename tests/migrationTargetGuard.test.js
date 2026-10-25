// scripts/lib/migrationTargetGuard.js: migrations run only against approved DEV databases.
const { assertMigrationTarget } = require("../scripts/lib/migrationTargetGuard");

beforeEach(() => jest.spyOn(console, "log").mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

test("DEV db passes", () => {
  expect(assertMigrationTarget("profile-service-dev", [])).toBe("profile-service-dev");
  expect(assertMigrationTarget("profile-service-dev", ["--apply", "--expect-db=profile-service-dev"])).toBe("profile-service-dev");
});
test("UAT db names are refused, even dry run", () => {
  expect(() => assertMigrationTarget("Profile-Service", [])).toThrow(/not a DEV database/);
});
test("--apply requires a matching --expect-db; only target-env dev", () => {
  expect(() => assertMigrationTarget("profile-service-dev", ["--apply"])).toThrow(/requires --expect-db/);
  expect(() => assertMigrationTarget("profile-service-dev", ["--apply", "--expect-db=Profile-Service"])).toThrow(/--expect-db/);
  expect(() => assertMigrationTarget("profile-service-dev", ["--target-env=uat"])).toThrow(/requires DEPLOYMENT_ENV=uat/);
});
