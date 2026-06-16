# Application Filter Templates API Documentation

## Overview
This API allows CRM users to create, manage, and retrieve filter templates for applications. Filter templates save filter configurations (like application status filters) that can be reused to get filtered application lists.

Each template has a **template type** (`templateType`): e.g. `"application"` for application-list templates. The type can be any string so you can support other entity types later. The "Get applications by template" API (`PUT /api/applications/filter`) only accepts templates with `templateType: "application"`.

---

## How the template logic works (Get applications by template)

1. **Templates** store saved filter + column configs. Each has:
   - **templateType**: e.g. `"application"` (or any type you define).
   - **filters.type**: which application statuses to show (e.g. `"submitted"`, `["processed","rejected"]`).
   - **columns**: which fields to return per application (empty = all).

2. **CRM user flow:**
   - **List templates:** `GET /api/application-filter-templates` → returns system default + user’s templates (all types).
   - **Get applications by template:** `PUT /api/applications/filter` with optional `templateId`, `page`, `limit`.
     - If **no templateId** → backend uses the **system default** template (`systemDefault: true`).
     - If **templateId** is sent → backend loads that template (must be owned by user or system default), checks **templateType === "application"**, then uses its `filters.type` and `columns`.
   - Backend queries applications by `applicationStatus` from `filters.type`, paginates, then shapes each application by `columns` and returns the list + pagination.

3. **Summary:** Users can create/update templates (with `templateType`, filters, columns), then call `PUT /api/applications/filter` with a chosen template (or none for system default) to get a filtered, column-shaped list of applications.

---

**Base URL:** `/api/application-filter-templates`

**Authentication:** All endpoints require Bearer token authentication and CRM user type.

**Valid Application Status Values:**
- `in-progress`
- `submitted`
- `processed`
- `rejected`

---

## API Endpoints

### 1. Create Filter Template
Create a new filter template with specified filters.

**Endpoint:** `POST /api/application-filter-templates`

**Permission Required:** `portal:write`

**Request Body:**
```json
{
  "templateType": "application",
  "filters": {
    "type": "processed"  // or ["processed", "submitted"] for multiple
  },
  "isDefault": false
}
```

- **templateType** (optional): Type of the template, e.g. `"application"`. Defaults to `"application"`. Can be any string for future types.

**cURL Example:**
```bash
curl -X POST "http://localhost:3000/api/application-filter-templates" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "type": "processed"
    },
    "isDefault": false
  }'
```

**cURL Example (Multiple Status Filters):**
```bash
curl -X POST "http://localhost:3000/api/application-filter-templates" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "type": ["processed", "submitted"]
    },
    "isDefault": true
  }'
```

**Response (201 Created):**
```json
{
  "status": "success",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "templateType": "application",
    "userId": "507f191e810c19729de860ea",
    "filters": {
      "type": "processed"
    },
    "isDefault": false,
    "meta": {
      "deleted": false,
      "deletedAt": null
    },
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  "message": "Filter template created successfully"
}
```

---

### 2. Get All Filter Templates
Get all filter templates for the current CRM user.

**Endpoint:** `GET /api/application-filter-templates`

**Permission Required:** `portal:read`

**cURL Example:**
```bash
curl -X GET "http://localhost:3000/api/application-filter-templates" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Response (200 OK):**
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
          "type": "processed"
        },
        "isDefault": true,
        "meta": {
          "deleted": false,
          "deletedAt": null
        },
        "createdAt": "2024-01-15T10:30:00.000Z",
        "updatedAt": "2024-01-15T10:30:00.000Z"
      },
      {
        "_id": "507f1f77bcf86cd799439012",
        "userId": "507f191e810c19729de860ea",
        "filters": {
          "type": ["submitted", "in-progress"]
        },
        "isDefault": false,
        "meta": {
          "deleted": false,
          "deletedAt": null
        },
        "createdAt": "2024-01-15T11:00:00.000Z",
        "updatedAt": "2024-01-15T11:00:00.000Z"
      }
    ]
  }
}
```

---

### 3. Get Default Filter Template
Get the default filter template for the current CRM user.

**Endpoint:** `GET /api/application-filter-templates/default`

**Permission Required:** `portal:read`

**cURL Example:**
```bash
curl -X GET "http://localhost:3000/api/application-filter-templates/default" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "userId": "507f191e810c19729de860ea",
    "filters": {
      "type": "processed"
    },
    "isDefault": true,
    "meta": {
      "deleted": false,
      "deletedAt": null
    },
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**Response (200 OK - No Default Template):**
```json
{
  "status": "success",
  "data": null,
  "message": "No default template found"
}
```

---

### 4. Get Filter Template by ID
Get a specific filter template by its ID.

**Endpoint:** `GET /api/application-filter-templates/:templateId`

**Permission Required:** `portal:read`

**Path Parameters:**
- `templateId` (required): The ID of the template to retrieve

**cURL Example:**
```bash
curl -X GET "http://localhost:3000/api/application-filter-templates/507f1f77bcf86cd799439011" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "userId": "507f191e810c19729de860ea",
    "filters": {
      "type": "processed"
    },
    "isDefault": true,
    "meta": {
      "deleted": false,
      "deletedAt": null
    },
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**Response (404 Not Found):**
```json
{
  "status": "error",
  "message": "Filter template not found"
}
```

---

### 5. Update Filter Template
Update an existing filter template. This is the PUT API mentioned for saving filters.

**Endpoint:** `PUT /api/application-filter-templates/:templateId`

**Permission Required:** `portal:write`

**Path Parameters:**
- `templateId` (required): The ID of the template to update

**Request Body:**
```json
{
  "templateType": "application",
  "filters": {
    "type": "rejected"  // or ["processed", "rejected"] for multiple
  },
  "isDefault": true
}
```

- **templateType** (optional): Update the template type (e.g. `"application"`).

**cURL Example:**
```bash
curl -X PUT "http://localhost:3000/api/application-filter-templates/507f1f77bcf86cd799439011" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "type": ["processed", "submitted"]
    },
    "isDefault": true
  }'
```

**cURL Example (Update Only Filters):**
```bash
curl -X PUT "http://localhost:3000/api/application-filter-templates/507f1f77bcf86cd799439011" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "type": "in-progress"
    }
  }'
```

**cURL Example (Set as Default):**
```bash
curl -X PUT "http://localhost:3000/api/application-filter-templates/507f1f77bcf86cd799439011" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "isDefault": true
  }'
```

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "userId": "507f191e810c19729de860ea",
    "filters": {
      "type": ["processed", "submitted"]
    },
    "isDefault": true,
    "meta": {
      "deleted": false,
      "deletedAt": null
    },
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T12:00:00.000Z"
  },
  "message": "Filter template updated successfully"
}
```

**Response (404 Not Found):**
```json
{
  "status": "error",
  "message": "Filter template not found"
}
```

---

### 6. Delete Filter Template
Delete a filter template (soft delete).

**Endpoint:** `DELETE /api/application-filter-templates/:templateId`

**Permission Required:** `portal:write`

**Path Parameters:**
- `templateId` (required): The ID of the template to delete

**cURL Example:**
```bash
curl -X DELETE "http://localhost:3000/api/application-filter-templates/507f1f77bcf86cd799439011" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Response (200 OK):**
```json
{
  "status": "success",
  "data": null,
  "message": "Filter template deleted successfully"
}
```

**Response (404 Not Found):**
```json
{
  "status": "error",
  "message": "Filter template not found"
}
```

---

## Error Responses

### 400 Bad Request (Validation Error)
```json
{
  "status": "error",
  "message": "Validation error: filters.type must be one of [in-progress, submitted, processed, rejected]"
}
```

### 401 Unauthorized (Missing Token)
```json
{
  "status": "error",
  "message": "Authorization header required",
  "error": {
    "tokenError": true,
    "missingHeader": true
  }
}
```

### 403 Forbidden (Not CRM User)
```json
{
  "status": "error",
  "message": "Access denied. Only CRM users can create filter templates."
}
```

### 404 Not Found
```json
{
  "status": "error",
  "message": "Filter template not found"
}
```

---

## Complete Workflow Examples

### Example 1: Create and Use a Filter Template

**Step 1: Create a template**
```bash
curl -X POST "http://localhost:3000/api/application-filter-templates" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "type": ["processed", "submitted"]
    },
    "isDefault": true
  }'
```

**Step 2: Get all templates**
```bash
curl -X GET "http://localhost:3000/api/application-filter-templates" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Step 3: Update the template**
```bash
curl -X PUT "http://localhost:3000/api/application-filter-templates/TEMPLATE_ID_FROM_STEP_1" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "type": "processed"
    }
  }'
```

### Example 2: Multiple Templates for Different Use Cases

**Create template for processed applications:**
```bash
curl -X POST "http://localhost:3000/api/application-filter-templates" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "type": "processed"
    },
    "isDefault": false
  }'
```

**Create template for pending review:**
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

**Create template for rejected applications:**
```bash
curl -X POST "http://localhost:3000/api/application-filter-templates" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "type": "rejected"
    },
    "isDefault": false
  }'
```

---

## Notes

1. **User Type Restriction:** All endpoints are restricted to CRM users only. Non-CRM users will receive a 403 Forbidden error.

2. **Default Template:** When setting a template as default (`isDefault: true`), all other templates for that user will automatically have their `isDefault` flag set to `false`.

3. **Filter Type:** The `filters.type` field can accept either:
   - A single string: `"processed"`
   - An array of strings: `["processed", "submitted"]`

4. **Template type:** Each template has `templateType` (e.g. `"application"`). The applications API (`PUT /api/applications/filter`) only uses templates with `templateType: "application"`. You can use other values for future features.

5. **Soft Delete:** Templates are soft-deleted (marked as deleted in the `meta.deleted` field) rather than being permanently removed from the database.

6. **Authentication:** Replace `YOUR_JWT_TOKEN` in all curl examples with a valid JWT token that includes:
   - Valid user ID
   - User type set to "CRM"
   - Required permissions for portal:read and portal:write

7. **Base URL:** Replace `http://localhost:3000` with your actual server URL (e.g., `https://your-domain.com` or `https://profileserviceshell-bqfmh8apf9erf0b0.northeurope-01.azurewebsites.net` for staging).

---

## Database Schema

The filter template is stored in MongoDB with the following structure:

```javascript
{
  _id: ObjectId,
  templateType: String,  // e.g. "application"; can be any type
  userId: ObjectId,     // Reference to CRM user
  filters: {
    type: String | [String]  // Application status filter
  },
  columns: [String],
  isDefault: Boolean,
  systemDefault: Boolean,
  meta: {
    deleted: Boolean,
    deletedAt: Date | null
  },
  createdAt: Date,
  updatedAt: Date
}
```

