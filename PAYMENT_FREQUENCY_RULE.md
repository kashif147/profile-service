# Payment Frequency Business Rule

## Overview

This document describes the business rule that enforces payment frequency based on payment type.

## Rule

**If payment type is "Credit Card" (CARD_PAYMENT), then payment frequency must be "Annually".**

**For all other payment types, payment frequency should be "Monthly".**

## Implementation

### Helper Function

Located in: `helpers/payment.frequency.helper.js`

```javascript
const { enforcePaymentFrequencyRule } = require("../helpers/payment.frequency.helper.js");

// Automatically enforces the rule
const correctedDetails = enforcePaymentFrequencyRule(subscriptionDetails);
```

### Where It's Applied

1. **Creating Subscription Details** (`services/subscription.details.service.js`)
   - Applied in `createSubscriptionDetails()` method
   - Ensures rule is enforced when subscription details are first created

2. **Updating Subscription Details** (`services/subscription.details.service.js`)
   - Applied in `updateSubscriptionDetails()` method
   - Ensures rule is enforced when payment type is changed

3. **Receiving Events from Portal-Service** (`rabbitMQ/listeners/profile.application.create.listerner.js`)
   - Applied when processing `profile.application.create` events
   - Ensures rule is enforced when subscription details are synced from portal-service

### Payment Types

- `PAYMENT_TYPE.CARD_PAYMENT` = "Card Payment" → **Frequency: "Annually"**
- `PAYMENT_TYPE.PAYROLL_DEDUCTION` = "Payroll Deduction" → **Frequency: "Monthly"**
- `PAYMENT_TYPE.DIRECT_DEBIT` = "Direct Debit" → **Frequency: "Monthly"**
- `PAYMENT_TYPE.SBO_PAYMENT` = "Standing Bank Order" → **Frequency: "Monthly"**

## Behavior

- If payment type is changed to "Credit Card" (or "Card Payment"), frequency is automatically set to "Annually"
- If payment type is changed from "Credit Card" to another type, frequency is automatically set to "Monthly"
- The rule is enforced automatically - no manual intervention required
- Logs are generated when the rule is applied for audit purposes
- Rule is enforced when receiving events from portal-service to maintain consistency

## Examples

### Example 1: Credit Card Payment
```javascript
{
  paymentType: "Card Payment",
  paymentFrequency: "Monthly"  // ❌ Invalid
}
// After enforcement:
{
  paymentType: "Card Payment",
  paymentFrequency: "Annually"  // ✅ Corrected
}
```

### Example 2: Direct Debit Payment
```javascript
{
  paymentType: "Direct Debit",
  paymentFrequency: "Annually"  // ❌ Invalid
}
// After enforcement:
{
  paymentType: "Direct Debit",
  paymentFrequency: "Monthly"  // ✅ Corrected
}
```

## Notes

- This rule is enforced at the service layer, ensuring consistency across all API endpoints
- The rule applies to both create and update operations
- Rule is also enforced when receiving events from portal-service
- Frontend should display this rule to users for better UX, but backend enforces it regardless

