# Application Filter Templates - API Flow & cURL Commands

## Overview
This API allows **CRM users** to save and manage filter templates for applications. Users can create templates with specific filters (like application status) and reuse them to get filtered application lists.

**Base URL:** `http://localhost:3000/api/application-filter-templates`  
**Authentication:** Bearer token required (CRM users only)

---

## Complete Flow Explanation

### Step-by-Step Flow:

1. **Create Template** → User creates a filter template with desired filters
2. **Save to Database** → Template is saved with userId, filters, and isDefault flag
3. **Retrieve Templates** → User can get all their saved templates
4. **Use Template** → Template filters can be applied to get filtered applications
5. **Update Template** → User can modify existing templates (PUT API)
6. **Set Default** → User can mark one template as default
7. **Delete Template** → User can delete templates when no longer needed

---

## Valid Filter Values

Application status values that can be used in filters:
- `in-progress`
- `submitted`
- `approved`
- `rejected`

---

## API Endpoints with cURL Commands

### 1. Create Filter Template (POST)

**Purpose:** Create a new filter template and save it to the database.

**Flow:**
- User provides filters (application status)
- Optionally sets template as default
- Template is saved with userId (from JWT token)
- If set as default, other templates for this user become non-default

**cURL Command:**
```bash
curl -X POST "http://localhost:3000/api/application-filter-templates" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "type": "approved"
    },
    "isDefault": false
  }'
```

**cURL with Multiple Filters:**
```bash
curl -X POST "http://localhost:3000/api/application-filter-templates" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "type": ["approved", "submitted"]
    },
    "isDefault": true
  }'
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "userId": "507f191e810c19729de860ea",
    "filters": {
      "type": "approved"
    },
    "isDefault": false,
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  "message": "Filter template created successfully"
}
```

---

### 2. Get All Templates (GET)

**Purpose:** Retrieve all filter templates saved by the current CRM user.

**Flow:**
- System extracts userId from JWT token
- Queries database for all templates belonging to that user
- Returns list of all templates (excluding soft-deleted ones)

**cURL Command:**
```bash
curl -X GET "http://localhost:3000/api/application-filter-templates" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "total": 2,
    "templates": [
      {
        "_id": "507f1f77bcf86cd799439011",
        "userId": "507f191e810c19729de860ea",
        "filters": {
          "type": "approved"
        },
        "isDefault": true,
        "createdAt": "2024-01-15T10:30:00.000Z"
      },
      {
        "_id": "507f1f77bcf86cd799439012",
        "userId": "507f191e810c19729de860ea",
        "filters": {
          "type": ["submitted", "in-progress"]
        },
        "isDefault": false,
        "createdAt": "2024-01-15T11:00:00.000Z"
      }
    ]
  }
}
```

---

### 3. Get Default Template (GET)

**Purpose:** Get the default filter template for the current user.

**Flow:**
- System finds template where `isDefault: true` for current user
- Returns the default template or null if none exists

**cURL Command:**
```bash
curl -X GET "http://localhost:3000/api/application-filter-templates/default" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "userId": "507f191e810c19729de860ea",
    "filters": {
      "type": "approved"
    },
    "isDefault": true,
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

---

### 4. Get Template by ID (GET)

**Purpose:** Retrieve a specific template by its ID.

**Flow:**
- User provides templateId in URL
- System verifies template belongs to current user
- Returns template details

**cURL Command:**
```bash
curl -X GET "http://localhost:3000/api/application-filter-templates/507f1f77bcf86cd799439011" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "userId": "507f191e810c19729de860ea",
    "filters": {
      "type": "approved"
    },
    "isDefault": true,
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

---

### 5. Update Template (PUT) ⭐ Main API

**Purpose:** Update an existing filter template. This is the PUT API where users can modify their saved filters.

**Flow:**
1. User provides templateId and new filter data
2. System validates the template belongs to current user
3. If `isDefault: true` is set, all other templates for this user become non-default
4. Template is updated in database
5. Updated template is returned

**cURL Command (Update Filters):**
```bash
curl -X PUT "http://localhost:3000/api/application-filter-templates/507f1f77bcf86cd799439011" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "type": ["approved", "submitted"]
    }
  }'
```

**cURL Command (Set as Default):**
```bash
curl -X PUT "http://localhost:3000/api/application-filter-templates/507f1f77bcf86cd799439011" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "isDefault": true
  }'
```

**cURL Command (Update Both Filters and Default):**
```bash
curl -X PUT "http://localhost:3000/api/application-filter-templates/507f1f77bcf86cd799439011" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "type": "rejected"
    },
    "isDefault": true
  }'
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "userId": "507f191e810c19729de860ea",
    "filters": {
      "type": ["approved", "submitted"]
    },
    "isDefault": true,
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T12:00:00.000Z"
  },
  "message": "Filter template updated successfully"
}
```

---

### 6. Delete Template (DELETE)

**Purpose:** Delete a filter template (soft delete - marked as deleted, not removed from database).

**Flow:**
- System marks template as deleted in `meta.deleted` field
- Template is not permanently removed
- User can no longer access it through normal queries

**cURL Command:**
```bash
curl -X DELETE "http://localhost:3000/api/application-filter-templates/507f1f77bcf86cd799439011" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "status": "success",
  "data": null,
  "message": "Filter template deleted successfully"
}
```

---

## Complete Workflow Example

### Scenario: CRM User wants to save and use filter templates

**Step 1: Create a template for approved applications**
```bash
curl -X POST "http://localhost:3000/api/application-filter-templates" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "type": "approved"
    },
    "isDefault": true
  }'
```
**Result:** Template saved with ID `507f1f77bcf86cd799439011`

---

**Step 2: Create another template for pending applications**
```bash
curl -X POST "http://localhost:3000/api/application-filter-templates" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "type": ["submitted", "in-progress"]
    },
    "isDefault": false
  }'
```
**Result:** Second template saved with ID `507f1f77bcf86cd799439012`

---

**Step 3: Get all templates**
```bash
curl -X GET "http://localhost:3000/api/application-filter-templates" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```
**Result:** Returns both templates

---

**Step 4: Update the first template (PUT API)**
```bash
curl -X PUT "http://localhost:3000/api/application-filter-templates/507f1f77bcf86cd799439011" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "type": ["approved", "submitted"]
    },
    "isDefault": true
  }'
```
**Result:** Template updated with new filters

---

**Step 5: Get default template**
```bash
curl -X GET "http://localhost:3000/api/application-filter-templates/default" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```
**Result:** Returns the default template (first one)

---

**Step 6: Delete a template when no longer needed**
```bash
curl -X DELETE "http://localhost:3000/api/application-filter-templates/507f1f77bcf86cd799439012" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```
**Result:** Template marked as deleted

---

## Database Flow

### When Template is Created/Updated:

```
User Request (with JWT Token)
    ↓
Extract userId from JWT
    ↓
Validate user is CRM type
    ↓
Validate filter data
    ↓
If isDefault = true:
  → Set all other user templates to isDefault = false
    ↓
Save/Update in MongoDB:
  {
    userId: ObjectId (from JWT),
    filters: { type: "approved" },
    isDefault: true/false,
    meta: { deleted: false }
  }
    ↓
Return saved template
```

### When Template is Retrieved:

```
User Request (with JWT Token)
    ↓
Extract userId from JWT
    ↓
Query MongoDB:
  - Find templates where userId = current user
  - Exclude templates where meta.deleted = true
    ↓
Return templates
```

---

## Important Notes

1. **Authentication Required:** All endpoints require a valid JWT token in the Authorization header
2. **CRM Users Only:** Only users with `userType: "CRM"` can access these endpoints
3. **User Isolation:** Each user can only see and modify their own templates
4. **Default Template:** Only one template per user can be default at a time
5. **Filter Format:** 
   - Single: `"type": "approved"`
   - Multiple: `"type": ["approved", "submitted"]`
6. **Soft Delete:** Templates are marked as deleted, not permanently removed

---

## Error Handling

### Missing Token:
```bash
# Response: 401 Unauthorized
{
  "error": {
    "message": "Authorization header required",
    "tokenError": true
  }
}
```

### Not CRM User:
```bash
# Response: 403 Forbidden
{
  "error": {
    "message": "Access denied. Only CRM users can create filter templates."
  }
}
```

### Invalid Filter Value:
```bash
# Response: 400 Bad Request
{
  "error": {
    "message": "Validation error: filters.type must be one of [in-progress, submitted, approved, rejected]"
  }
}
```

### Template Not Found:
```bash
# Response: 404 Not Found
{
  "error": {
    "message": "Filter template not found"
  }
}
```

---

## Quick Reference - All cURL Commands

```bash
# 1. Create Template
curl -X POST "http://localhost:3000/api/application-filter-templates" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filters": {"type": "approved"}, "isDefault": false}'

# 2. Get All Templates
curl -X GET "http://localhost:3000/api/application-filter-templates" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# 3. Get Default Template
curl -X GET "http://localhost:3000/api/application-filter-templates/default" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# 4. Get Template by ID
curl -X GET "http://localhost:3000/api/application-filter-templates/TEMPLATE_ID" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# 5. Update Template (PUT)
curl -X PUT "http://localhost:3000/api/application-filter-templates/TEMPLATE_ID" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filters": {"type": "approved"}, "isDefault": true}'

# 6. Delete Template
curl -X DELETE "http://localhost:3000/api/application-filter-templates/TEMPLATE_ID" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## Replace These Values

- `YOUR_JWT_TOKEN` → Your actual JWT token
- `http://localhost:3000` → Your server URL
- `TEMPLATE_ID` → Actual template ID from create response

