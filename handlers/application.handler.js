const PersonalDetails = require("../models/personal.details.model");
const ProfessionalDetails = require("../models/professional.details.model");
const SubscriptionDetails = require("../models/subscription.model");
const mongoose = require("mongoose");
// Ensure User model is registered for populate("approvalDetails.approvedBy")
require("../models/user.model");
const {
  APPLICATION_STATUS,
  FILTER_OPERATOR,
  TEMPLATE_FILTER_KEYS,
  FILTER_FIELD_MAP,
} = require("../constants/enums");
const {
  stampPersonalInfoFullName,
  enrichApplicationRowPersonalFullName,
} = require("../helpers/personal.info.fullName.js");
const {
  findSubscriptionRecord,
} = require("./subscription.details.handler.js");
const {
  mergeLegacyProfessionalFieldsFromSubscription,
  readLegacyProfessionalFieldsFromSubscriptionRecord,
  subscriptionDetailsToPlain,
} = require("../helpers/membershipCategory.helper.js");

function formatDateOnly(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildSubscriptionPayload(subscriptionDetails, membershipCategory) {
  if (!subscriptionDetails) {
    return membershipCategory !== null ? { membershipCategory } : null;
  }
  return subscriptionDetailsToPlain(subscriptionDetails.subscriptionDetails);
}

async function buildProfessionalPayload(
  professionalDetails,
  membershipCategory,
  subscriptionDetails,
) {
  if (!professionalDetails) {
    return membershipCategory !== null ? { membershipCategory } : null;
  }
  const profPlain = subscriptionDetailsToPlain(
    professionalDetails.professionalDetails,
  );
  delete profPlain.membershipCategory;
  const legacyFields = await readLegacyProfessionalFieldsFromSubscriptionRecord(
    subscriptionDetails,
  );
  const mergedProfessional = mergeLegacyProfessionalFieldsFromSubscription(
    profPlain,
    legacyFields,
  );
  return {
    ...mergedProfessional,
    ...(membershipCategory != null ? { membershipCategory } : {}),
  };
}

/** System default filters applied for template-based application listing (admin/system default). */
const SYSTEM_DEFAULT_APPLICATION_FILTERS = {
  /** Only non-deleted applications (max relevant results). */
  "meta.deleted": false,
};
// membership number generation moved to Profile creation flow

exports.getAllApplications = (statusFilters = []) =>
  new Promise(async (resolve, reject) => {
    try {
      let query = {};

      // If status filters are provided, filter by them
      // Normalize to lowercase to handle both cases
      if (statusFilters && statusFilters.length > 0) {
        const normalizedFilters = statusFilters.map((filter) =>
          typeof filter === "string" ? filter.toLowerCase() : filter,
        );
        query.applicationStatus = { $in: normalizedFilters };
      }

      const applications = await PersonalDetails.find(query).sort({
        createdAt: -1,
      });

      resolve(applications);
    } catch (error) {
      console.error("ApplicationHandler [getAllApplications] Error:", error);
      reject(error);
    }
  });

exports.getApplicationById = (applicationId) =>
  new Promise(async (resolve, reject) => {
    try {
      const application = await PersonalDetails.findOne({
        applicationId: applicationId,
      })
        .populate("userId", "name email")
        .populate("approvalDetails.approvedBy", "name email");

      if (!application) {
        reject(new Error("Application not found"));
        return;
      }

      if (application.personalInfo) {
        stampPersonalInfoFullName(application.personalInfo);
      }

      resolve(application);
    } catch (error) {
      console.error("ApplicationHandler [getApplicationById] Error:", error);
      reject(error);
    }
  });

exports.getApplicationsByProfileId = (profileId, statusFilters = []) =>
  new Promise(async (resolve, reject) => {
    try {
      const objectId = new mongoose.Types.ObjectId(profileId);

      const query = {
        profileId: objectId,
        "meta.deleted": false,
      };

      if (statusFilters && statusFilters.length > 0) {
        const normalized = statusFilters.map((s) =>
          typeof s === "string" ? s.toLowerCase() : s,
        );
        query.applicationStatus = { $in: normalized };
      }

      let applications;
      try {
        applications = await PersonalDetails.find(query)
          .populate({
            path: "approvalDetails.approvedBy",
            model: "User",
            select: "userFullName userEmail",
          })
          .sort({ createdAt: -1 })
          .lean();
      } catch (populateErr) {
        console.warn(
          "ApplicationHandler [getApplicationsByProfileId] populate failed, returning without approvedBy details:",
          populateErr?.message,
        );
        applications = await PersonalDetails.find(query)
          .sort({ createdAt: -1 })
          .lean();
      }

      const enrichedApplications = await Promise.all(
        applications.map(async (app) => {
          const subscription = await SubscriptionDetails.findOne({
            applicationId: app.applicationId,
          }).lean();

          const dateJoined = subscription?.subscriptionDetails?.dateJoined;
          const approvedBy = app.approvalDetails?.approvedBy;
          const approvedByPayload = !approvedBy
            ? null
            : approvedBy instanceof mongoose.Types.ObjectId
              ? { id: approvedBy.toString() }
              : approvedBy &&
                  typeof approvedBy === "object" &&
                  (approvedBy.userFullName !== undefined ||
                    approvedBy.userEmail !== undefined)
                ? {
                    id: approvedBy._id != null ? String(approvedBy._id) : null,
                    name: approvedBy.userFullName,
                    email: approvedBy.userEmail,
                  }
                : approvedBy && typeof approvedBy === "object"
                  ? {
                      id:
                        approvedBy._id != null ? String(approvedBy._id) : null,
                    }
                  : null;

          return {
            applicationId: app.applicationId,
            membershipCategory:
              subscription?.subscriptionDetails?.membershipCategory ?? null,
            submissionDate:
              app.createdAt != null
                ? (app.createdAt.toISOString?.() ?? app.createdAt)
                : null,
            approvalDate:
              app.approvalDetails?.approvedAt != null
                ? (app.approvalDetails.approvedAt.toISOString?.() ??
                  app.approvalDetails.approvedAt)
                : null,
            joinDate:
              dateJoined != null
                ? formatDateOnly(dateJoined)
                : null,
            approvedBy: approvedByPayload,
            applicationStatus: app.applicationStatus,
            personalDetails: {
              meta: {
                isActive: app.meta?.isActive ?? true,
              },
            },
          };
        }),
      );

      resolve(enrichedApplications);
    } catch (error) {
      console.error(
        "ApplicationHandler [getApplicationsByProfileId] Error:",
        error,
      );
      reject(error);
    }
  });

exports.updateApplicationStatus = (
  applicationId,
  newStatus,
  approvedBy,
  comments,
) =>
  new Promise(async (resolve, reject) => {
    try {
      // Normalize status to lowercase to ensure consistency
      const normalizedStatus = newStatus?.toLowerCase();
      const updateData = {
        applicationStatus: normalizedStatus,
        approvalDetails: {
          approvedBy: approvedBy,
          approvedAt: new Date(),
          comments: comments || "",
        },
      };
      if (normalizedStatus === APPLICATION_STATUS.REJECTED) {
        updateData["meta.isActive"] = false;
      } else if (normalizedStatus === APPLICATION_STATUS.APPROVED) {
        updateData["meta.isActive"] = true;
      }

      const result = await PersonalDetails.findOneAndUpdate(
        { applicationId: applicationId },
        { $set: updateData },
        { new: true, runValidators: true },
      );

      if (!result) {
        reject(new Error("Application not found"));
        return;
      }

      const active = normalizedStatus === APPLICATION_STATUS.APPROVED;
      if (
        normalizedStatus === APPLICATION_STATUS.APPROVED ||
        normalizedStatus === APPLICATION_STATUS.REJECTED
      ) {
        await ProfessionalDetails.updateMany(
          { applicationId },
          { $set: { "meta.isActive": active } },
        );
        await SubscriptionDetails.updateMany(
          { applicationId },
          { $set: { "meta.isActive": active } },
        );
      }

      // Membership number is generated only when a new Profile is created

      resolve(result);
    } catch (error) {
      console.error(
        "ApplicationHandler [updateApplicationStatus] Error:",
        error,
      );
      reject(error);
    }
  });

exports.getApplicationWithDetails = (applicationId) =>
  new Promise(async (resolve, reject) => {
    try {
      const personalDetails = await PersonalDetails.findOne({
        applicationId: applicationId,
      });

      if (!personalDetails) {
        reject(new Error("Application not found"));
        return;
      }

      const tenantId = personalDetails.tenantId || null;

      const [professionalDetails, subscriptionDetails] = await Promise.all([
        ProfessionalDetails.findOne({ applicationId: applicationId }),
        findSubscriptionRecord(applicationId, tenantId),
      ]);

      const membershipCategory =
        subscriptionDetails?.subscriptionDetails?.membershipCategory ?? null;

      const professionalPayload = await buildProfessionalPayload(
        professionalDetails,
        membershipCategory,
        subscriptionDetails,
      );

      const subscriptionPayload = buildSubscriptionPayload(
        subscriptionDetails,
        membershipCategory
      );

      const applicationDetails = {
        applicationId: personalDetails.applicationId,
        userId: personalDetails.userId,
        membershipNumber: subscriptionDetails
          ? subscriptionDetails.membershipNumber
          : null,
        personalDetails: personalDetails,
        professionalDetails: professionalPayload,
        subscriptionDetails: subscriptionPayload,
        applicationStatus: personalDetails.applicationStatus,
        approvalDetails: personalDetails.approvalDetails,
        createdAt: personalDetails.createdAt,
        updatedAt: personalDetails.updatedAt,
      };

      enrichApplicationRowPersonalFullName(applicationDetails);

      resolve(applicationDetails);
    } catch (error) {
      console.error(
        "ApplicationHandler [getApplicationWithDetails] Error:",
        error,
      );
      reject(error);
    }
  });

// Original method - unchanged, returns all fields
exports.getAllApplicationsWithDetails = (
  statusFilters = [],
  page = 1,
  limit = 500,
) =>
  new Promise(async (resolve, reject) => {
    try {
      let query = {};

      if (statusFilters && statusFilters.length > 0) {
        query.applicationStatus = { $in: statusFilters };
      }

      // Calculate pagination
      const skip = (page - 1) * limit;

      // Get total count for pagination metadata
      const totalCount = await PersonalDetails.countDocuments(query);

      // Get paginated applications
      const applications = await PersonalDetails.find(query)
        .sort({
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit);

      const applicationsWithDetails = await Promise.all(
        applications.map(async (application) => {
          try {
            const [professionalDetails, subscriptionDetails] =
              await Promise.all([
                ProfessionalDetails.findOne({
                  applicationId: application.applicationId,
                }),
                findSubscriptionRecord(
                  application.applicationId,
                  application.tenantId
                ),
              ]);

            const membershipCategory =
              subscriptionDetails?.subscriptionDetails?.membershipCategory ??
              null;

            const professionalPayload = await buildProfessionalPayload(
              professionalDetails,
              membershipCategory,
              subscriptionDetails,
            );

            const subscriptionPayload = buildSubscriptionPayload(
              subscriptionDetails,
              membershipCategory
            );

            const row = {
              applicationId: application.applicationId,
              userId: application.userId,
              membershipNumber: subscriptionDetails
                ? subscriptionDetails.membershipNumber
                : null,
              personalDetails: application,
              professionalDetails: professionalPayload,
              subscriptionDetails: subscriptionPayload,
              applicationStatus: application.applicationStatus,
              approvalDetails: application.approvalDetails,
              isPotentialDuplicate:
                !!application?.duplicateDetection?.isPotentialDuplicate,
              duplicateReviewStatus:
                application?.duplicateReview?.status || "NOT_CHECKED",
              createdAt: application.createdAt,
              updatedAt: application.updatedAt,
            };
            enrichApplicationRowPersonalFullName(row);
            return row;
          } catch (error) {
            console.error("Error fetching details for application:", error);
            return null;
          }
        }),
      );

      // Filter out null values (from errors)
      const filteredApplications = applicationsWithDetails.filter(
        (app) => app !== null,
      );

      resolve({
        applications: filteredApplications,
        pagination: {
          page: page,
          limit: limit,
          totalCount: totalCount,
          totalPages: Math.ceil(totalCount / limit),
          hasNextPage: page < Math.ceil(totalCount / limit),
          hasPreviousPage: page > 1,
        },
      });
    } catch (error) {
      console.error(
        "ApplicationHandler [getAllApplicationsWithDetails] Error:",
        error,
      );
      reject(error);
    }
  });

/**
 * NEW METHOD - Helper function to filter object by specified columns
 * Supports nested fields like "personalDetails.personalInfo.name"
 * Preserves key order to match template column order (e.g. first column in template = first key in response)
 */
const filterByColumns = (obj, columns) => {
  // If no columns specified, return all fields
  if (!columns || columns.length === 0) {
    return obj;
  }

  const result = {};

  columns.forEach((column) => {
    const parts = column.split(".");
    let current = obj;
    let resultCurrent = result;

    // Navigate through nested structure
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (i === parts.length - 1) {
        // Last part - set the value
        if (current && current[part] !== undefined) {
          resultCurrent[part] = current[part];
        }
      } else {
        // Intermediate part - create nested structure
        if (current && current[part] !== undefined) {
          if (!resultCurrent[part]) {
            resultCurrent[part] = {};
          }
          current = current[part];
          resultCurrent = resultCurrent[part];
        } else {
          break;
        }
      }
    }
  });

  // Ensure top-level key order matches template column order (drag-and-drop position)
  const orderedTopKeys = [];
  for (const column of columns) {
    const topKey = column.split(".")[0];
    if (topKey && !orderedTopKeys.includes(topKey)) {
      orderedTopKeys.push(topKey);
    }
  }
  const orderedResult = {};
  for (const key of orderedTopKeys) {
    if (result[key] !== undefined) {
      orderedResult[key] = result[key];
    }
  }
  if (orderedResult.personalDetails?.personalInfo) {
    stampPersonalInfoFullName(orderedResult.personalDetails.personalInfo);
  }
  return orderedResult;
};

/**
 * NEW METHOD - Get applications with template filters and column filtering
 * Completely separate from getAllApplicationsWithDetails
 * Used exclusively by the PUT API
 * @param {Object} filters - Keyed by model field names (applicationStatus, membershipCategory). Each: { operator: "equal_to"|"not_equal_to", values: string[] }
 */
exports.getApplicationsWithTemplateFilters = (
  filters = {},
  page = 1,
  limit = 500,
  columns = [],
) =>
  new Promise(async (resolve, reject) => {
    try {
      // Start with system defaults: exclude deleted so we get maximum relevant results
      const query = { ...SYSTEM_DEFAULT_APPLICATION_FILTERS };

      // Resolve filters: frontend sends camelCase keys (e.g. workLocation); we map to DB path and apply.
      const applicationIdSets = [];

      for (const [filterKey, filterEntry] of Object.entries(filters || {})) {
        if (
          !filterEntry ||
          !filterEntry.values ||
          filterEntry.values.length === 0
        )
          continue;

        // Make filter key lookup case-insensitive (e.g. "Grade", "GRADE" -> applicationStatus)
        const resolvedKey = Object.keys(FILTER_FIELD_MAP).find(
          (k) =>
            k.toLowerCase() === (filterKey && String(filterKey).toLowerCase()),
        );
        const config = resolvedKey ? FILTER_FIELD_MAP[resolvedKey] : null;
        if (!config) continue;

        const op =
          filterEntry.operator === FILTER_OPERATOR.EQUAL_TO ? "$in" : "$nin";
        // Normalize string values carefully:
        // - applicationStatus is stored/layered in lowercase -> lower it
        // - other fields (e.g. membershipCategory) must preserve case for exact matches
        let values = filterEntry.values.map((v) =>
          typeof v === "string" ? v.trim() : v,
        );
        if (resolvedKey === "applicationStatus") {
          values = values.map((v) =>
            typeof v === "string" ? v.toLowerCase() : v,
          );
        }

        if (config.source === "personalDetails") {
          query[config.path] = { [op]: values };
        } else if (config.source === "both") {
          // membershipCategory: from SubscriptionDetails or ProfessionalDetails
          const categoryQuery = { $in: values };
          const subs = await SubscriptionDetails.find({
            [config.pathSubs]: categoryQuery,
          }).select("applicationId");
          const profs = await ProfessionalDetails.find({
            [config.pathProf]: categoryQuery,
          }).select("applicationId");
          const ids = [
            ...new Set([
              ...subs.map((s) => s.applicationId),
              ...profs.map((p) => p.applicationId),
            ]),
          ];
          applicationIdSets.push({
            ids,
            isEqual: filterEntry.operator === FILTER_OPERATOR.EQUAL_TO,
          });
        } else if (config.source === "professionalDetails") {
          // Make grade filter value case-insensitive (match \"Grade\", \"grade\", etc.)
          if (resolvedKey === "grade") {
            values = values.map((v) =>
              typeof v === "string"
                ? new RegExp(
                    `^${v.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}$`,
                    "i",
                  )
                : v,
            );
          }
          const q = { [config.path]: { [op]: values } };
          const docs =
            await ProfessionalDetails.find(q).select("applicationId");
          applicationIdSets.push({
            ids: docs.map((d) => d.applicationId),
            isEqual: filterEntry.operator === FILTER_OPERATOR.EQUAL_TO,
          });
        } else if (config.source === "subscriptionDetails") {
          const q = { [config.path]: { [op]: values } };
          const docs =
            await SubscriptionDetails.find(q).select("applicationId");
          applicationIdSets.push({
            ids: docs.map((d) => d.applicationId),
            isEqual: filterEntry.operator === FILTER_OPERATOR.EQUAL_TO,
          });
        }
      }

      const hasUsableFilterEntry = Object.values(filters || {}).some(
        (fe) => fe && Array.isArray(fe.values) && fe.values.length > 0,
      );

      // If applicationStatus is not set on the main query, historically we defaulted
      // the list to "submitted" only (when other field filters like grade/location are used).
      // When the template has no filter constraints ({} or only empty values), do not
      // apply that default — otherwise users who cleared a view see an empty grid if
      // nothing is in the submitted state. Broad list = non-deleted only (query base).
      if (!query.applicationStatus && hasUsableFilterEntry) {
        query.applicationStatus = { $in: [APPLICATION_STATUS.SUBMITTED] };
      }

      // Intersect "equal_to" applicationId sets; then exclude "not_equal_to" ids
      if (applicationIdSets.length > 0) {
        const inSets = applicationIdSets
          .filter((s) => s.isEqual)
          .map((s) => new Set(s.ids));
        const notInSets = applicationIdSets
          .filter((s) => !s.isEqual)
          .map((s) => new Set(s.ids));
        let resultIds = null;
        if (inSets.length > 0) {
          resultIds = new Set(inSets[0]);
          for (let i = 1; i < inSets.length; i++) {
            resultIds = new Set(
              [...resultIds].filter((id) => inSets[i].has(id)),
            );
          }
          for (const notIn of notInSets) {
            resultIds = new Set([...resultIds].filter((id) => !notIn.has(id)));
          }
        } else if (notInSets.length > 0) {
          const unionNotIn = new Set(notInSets.flatMap((s) => [...s]));
          query.applicationId = { $nin: [...unionNotIn] };
        }
        if (resultIds !== null) {
          query.applicationId =
            resultIds.size > 0 ? { $in: [...resultIds] } : { $in: [] };
        }
      }

      // Calculate pagination
      const skip = (page - 1) * limit;

      // Get total count for pagination metadata
      const totalCount = await PersonalDetails.countDocuments(query);

      // Get paginated applications
      const applications = await PersonalDetails.find(query)
        .sort({
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit);

      const applicationsWithDetails = await Promise.all(
        applications.map(async (application) => {
          try {
            const [professionalDetails, subscriptionDetails] =
              await Promise.all([
                ProfessionalDetails.findOne({
                  applicationId: application.applicationId,
                }),
                findSubscriptionRecord(
                  application.applicationId,
                  application.tenantId
                ),
              ]);

            const membershipCategory =
              subscriptionDetails?.subscriptionDetails?.membershipCategory ??
              null;

            const professionalPayload = await buildProfessionalPayload(
              professionalDetails,
              membershipCategory,
              subscriptionDetails,
            );

            const subscriptionPayload = buildSubscriptionPayload(
              subscriptionDetails,
              membershipCategory
            );

            const fullApplication = {
              applicationId: application.applicationId,
              userId: application.userId,
              membershipNumber: subscriptionDetails
                ? subscriptionDetails.membershipNumber
                : null,
              personalDetails: application,
              professionalDetails: professionalPayload,
              subscriptionDetails: subscriptionPayload,
              applicationStatus: application.applicationStatus,
              approvalDetails: application.approvalDetails,
              isPotentialDuplicate:
                !!application?.duplicateDetection?.isPotentialDuplicate,
              duplicateReviewStatus:
                application?.duplicateReview?.status || "NOT_CHECKED",
              createdAt: application.createdAt,
              updatedAt: application.updatedAt,
            };

            // Apply column filtering based on template
            const filtered = filterByColumns(fullApplication, columns);
            const row =
              fullApplication.applicationId !== undefined
                ? {
                    applicationId: fullApplication.applicationId,
                    ...filtered,
                  }
                : filtered;
            row.isPotentialDuplicate =
              !!fullApplication?.isPotentialDuplicate ||
              !!fullApplication?.personalDetails?.duplicateDetection
                ?.isPotentialDuplicate;
            row.duplicateReviewStatus =
              fullApplication?.duplicateReviewStatus ||
              fullApplication?.personalDetails?.duplicateReview?.status ||
              "NOT_CHECKED";
            enrichApplicationRowPersonalFullName(row);
            return row;
          } catch (error) {
            console.error("Error fetching details for application:", error);
            return null;
          }
        }),
      );

      // Filter out null values (from errors)
      const filteredApplications = applicationsWithDetails.filter(
        (app) => app !== null,
      );

      resolve({
        applications: filteredApplications,
        pagination: {
          page: page,
          limit: limit,
          totalCount: totalCount,
          totalPages: Math.ceil(totalCount / limit),
          hasNextPage: page < Math.ceil(totalCount / limit),
          hasPreviousPage: page > 1,
        },
      });
    } catch (error) {
      console.error(
        "ApplicationHandler [getApplicationsWithTemplateFilters] Error:",
        error,
      );
      reject(error);
    }
  });
