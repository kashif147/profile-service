const {
  resolveGapLetterEligibility,
} = require("../helpers/gapLetterEligibility.helper.js");

describe("gapLetterEligibility.helper", () => {
  it("defaults true for eligible full member rejoining from cancelled status", () => {
    const result = resolveGapLetterEligibility({
      membershipCategory: "Full Membership",
      previousSubscription: {
        subscriptionStatus: "Cancelled",
        membershipCategory: "Full Membership",
      },
    });

    expect(result.sendGapLetter).toBe(true);
    expect(result.defaultSendGapLetter).toBe(true);
    expect(result.predictedMovement).toBe("Rejoin - Cancelled");
  });

  it("defaults true for eligible full member reinstated from suspended status", () => {
    const result = resolveGapLetterEligibility({
      membershipCategory: "General (all grades)",
      previousSubscription: {
        subscriptionStatus: "Suspended",
        membershipCategory: "General (all grades)",
      },
    });

    expect(result.sendGapLetter).toBe(true);
    expect(result.defaultSendGapLetter).toBe(true);
    expect(result.predictedMovement).toBe("Reinstate - Suspended");
  });

  it("defaults false for true new joiners", () => {
    const result = resolveGapLetterEligibility({
      membershipCategory: "Full Membership",
      previousSubscription: null,
    });

    expect(result.sendGapLetter).toBe(false);
    expect(result.defaultSendGapLetter).toBe(false);
  });

  it("excludes undergraduate and honorary categories", () => {
    expect(
      resolveGapLetterEligibility({
        membershipCategory: "Undergraduate Student",
        previousSubscription: {
          subscriptionStatus: "Resigned",
          membershipCategory: "Undergraduate Student",
        },
      }).sendGapLetter,
    ).toBe(false);

    expect(
      resolveGapLetterEligibility({
        membershipCategory: "Honorary",
        previousSubscription: {
          subscriptionStatus: "Archived",
          membershipCategory: "Honorary",
        },
      }).sendGapLetter,
    ).toBe(false);
  });

  it("preserves user override", () => {
    const result = resolveGapLetterEligibility({
      requestedSendGapLetter: false,
      membershipCategory: "Full Membership",
      previousSubscription: {
        subscriptionStatus: "Cancelled",
        membershipCategory: "Full Membership",
      },
    });

    expect(result.defaultSendGapLetter).toBe(true);
    expect(result.sendGapLetter).toBe(false);
    expect(result.overridden).toBe(true);
  });
});
