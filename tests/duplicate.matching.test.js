const {
  checkExactMatch,
  calculateFuzzyScore,
  classifyScore,
  scorePair,
  buildMatchableRecord,
  findAuthorizedProfileMatch,
} = require("../services/duplicate.matching.js");

describe("duplicate.matching", () => {
  const baseSource = buildMatchableRecord({
    personalInfo: {
      forename: "John",
      surname: "Smith",
      dateOfBirth: new Date("1990-05-15"),
    },
    contactInfo: {
      personalEmail: "john@example.com",
      mobileNumber: "0871234567",
      eircode: "D01AB12",
      buildingOrHouse: "12 Main Street",
    },
    professionalDetails: { nmbiNumber: "12345" },
    subscriptionDetails: { payrollNo: "PAY001" },
    applicationId: "app-source",
  });

  test("exact email match scores 100", () => {
    const target = buildMatchableRecord({
      contactInfo: { personalEmail: "john@example.com" },
      applicationId: "app-target",
    });
    const result = checkExactMatch(baseSource, target);
    expect(result.score).toBe(100);
    expect(result.classification).toBe("Exact Duplicate");
    expect(result.matchedFields).toContain("Email");
  });

  test("fuzzy DOB + surname + eircode scores 80", () => {
    const target = buildMatchableRecord({
      personalInfo: {
        forename: "Jonathan",
        surname: "Smith",
        dateOfBirth: new Date("1990-05-15"),
      },
      contactInfo: { eircode: "D01AB12" },
      applicationId: "app-target",
    });
    const result = calculateFuzzyScore(baseSource, target);
    expect(result.score).toBe(80);
    expect(result.classification).toBe("Strong Match");
  });

  test("fuzzy DOB + surname + forename scores 70", () => {
    const target = buildMatchableRecord({
      personalInfo: {
        forename: "John",
        surname: "Smith",
        dateOfBirth: new Date("1990-05-15"),
      },
      applicationId: "app-target",
    });
    const result = calculateFuzzyScore(baseSource, target);
    expect(result.score).toBe(70);
    expect(result.classification).toBe("Possible Match");
  });

  test("scores below 40 are ignored", () => {
    const target = buildMatchableRecord({
      personalInfo: { forename: "Jane", surname: "Doe" },
      contactInfo: { buildingOrHouse: "12 Main Street" },
      applicationId: "app-target",
    });
    const result = calculateFuzzyScore(baseSource, target);
    expect(result).toBeNull();
  });

  test("exact match prevents fuzzy scoring", () => {
    const target = buildMatchableRecord({
      personalInfo: {
        forename: "John",
        surname: "Smith",
        dateOfBirth: new Date("1990-05-15"),
      },
      contactInfo: {
        personalEmail: "john@example.com",
        eircode: "D01AB12",
      },
      applicationId: "app-target",
    });
    const result = scorePair(baseSource, target);
    expect(result.score).toBe(100);
    expect(result.isExact).toBe(true);
  });

  test("fuzzy scores never exceed 100", () => {
    const target = { ...baseSource, applicationId: "app-target" };
    const result = calculateFuzzyScore(baseSource, target);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  test("classifyScore thresholds", () => {
    expect(classifyScore(100)).toBe("Exact Duplicate");
    expect(classifyScore(85)).toBe("Strong Match");
    expect(classifyScore(65)).toBe("Possible Match");
    expect(classifyScore(45)).toBe("Weak Match");
    expect(classifyScore(20)).toBe("Ignore");
  });

  test("findAuthorizedProfileMatch returns active profile match only", () => {
    const matchSummary = [
      {
        sourceType: "PROFILE",
        sourceId: "6a23d1347fdb29bfbca83066",
        ignored: false,
      },
      {
        sourceType: "APPLICATION",
        sourceId: "ccd90dcc-f281-45e9-8383-f3bf94bfddcc",
        ignored: false,
      },
      {
        sourceType: "PROFILE",
        sourceId: "aaaaaaaaaaaaaaaaaaaaaaaa",
        ignored: true,
      },
    ];

    expect(
      findAuthorizedProfileMatch(matchSummary, "6a23d1347fdb29bfbca83066"),
    ).toEqual(
      expect.objectContaining({
        sourceType: "PROFILE",
        sourceId: "6a23d1347fdb29bfbca83066",
      }),
    );
    expect(
      findAuthorizedProfileMatch(
        matchSummary,
        "ccd90dcc-f281-45e9-8383-f3bf94bfddcc",
      ),
    ).toBeUndefined();
    expect(
      findAuthorizedProfileMatch(matchSummary, "aaaaaaaaaaaaaaaaaaaaaaaa"),
    ).toBeUndefined();
  });
});
