const Profile = require("../models/profile.model");
const PersonalDetails = require("../models/personal.details.model");
const SubscriptionDetails = require("../models/subscription.model");
const ProfessionalDetails = require("../models/professional.details.model");
const { normalizeEmail } = require("../helpers/profileLookup.service");

/**
 * Universal Search Service
 * Handles searching and filtering for profiles, applications, and future pages
 */
class UniversalSearchService {
  /**
   * Escape special regex characters
   */
  escapeRegex(value = "") {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Build search conditions for common fields
   */
  buildSearchConditions(searchTerm, pageType) {
    const conditions = [];
    if (!searchTerm) return conditions;

    const regex = new RegExp(this.escapeRegex(searchTerm), "i");
    const normalized = normalizeEmail(searchTerm);

    if (pageType === "profile") {
      // Profile search conditions
      // Membership number: match from first 3 characters (starts with)
      if (searchTerm.length >= 3) {
        const membershipNumberRegex = new RegExp(`^${this.escapeRegex(searchTerm)}`, "i");
        conditions.push({ membershipNumber: membershipNumberRegex });
      }
      
      if (normalized) {
        conditions.push({ normalizedEmail: normalized });
        conditions.push({ "contactInfo.personalEmail": regex });
        conditions.push({ "contactInfo.workEmail": regex });
        conditions.push({ "contactInfo.preferredEmail": regex });
      }

      conditions.push({ "personalInfo.forename": regex });
      conditions.push({ "personalInfo.surname": regex });
      conditions.push({
        $expr: {
          $regexMatch: {
            input: {
              $concat: [
                { $ifNull: ["$personalInfo.forename", ""] },
                " ",
                { $ifNull: ["$personalInfo.surname", ""] },
              ],
            },
            regex: this.escapeRegex(searchTerm),
            options: "i",
          },
        },
      });

      conditions.push({ "contactInfo.mobileNumber": regex });
      conditions.push({ "contactInfo.telephoneNumber": regex });

      const digitsOnly = searchTerm.replace(/\D/g, "");
      if (digitsOnly.length >= 4) {
        const digitsRegex = new RegExp(this.escapeRegex(digitsOnly));
        conditions.push({ "contactInfo.mobileNumber": { $regex: digitsRegex } });
        conditions.push({ "contactInfo.telephoneNumber": { $regex: digitsRegex } });
      }
    } else if (pageType === "application") {
      // Application search conditions
      if (normalized) {
        conditions.push({ "contactInfo.personalEmail": regex });
        conditions.push({ "contactInfo.workEmail": regex });
      }

      conditions.push({ "personalInfo.forename": regex });
      conditions.push({ "personalInfo.surname": regex });
      conditions.push({
        $expr: {
          $regexMatch: {
            input: {
              $concat: [
                { $ifNull: ["$personalInfo.forename", ""] },
                " ",
                { $ifNull: ["$personalInfo.surname", ""] },
              ],
            },
            regex: this.escapeRegex(searchTerm),
            options: "i",
          },
        },
      });

      conditions.push({ "contactInfo.mobileNumber": regex });
      conditions.push({ "contactInfo.telephoneNumber": regex });
      conditions.push({ applicationId: regex });
    }

    return conditions;
  }

  /**
   * Build filter conditions based on provided filters
   */
  buildFilterConditions(filters, pageType, tenantId) {
    const query = {};

    // Always include tenantId for profiles
    if (pageType === "profile" && tenantId) {
      query.tenantId = tenantId;
    }

    // Application Status filter (for applications)
    if (pageType === "application" && filters.applicationStatus) {
      const statuses = Array.isArray(filters.applicationStatus)
        ? filters.applicationStatus
        : [filters.applicationStatus];
      query.applicationStatus = { $in: statuses.map(s => s.toLowerCase()) };
    }

    // Email filter
    if (filters.email) {
      const emailRegex = new RegExp(this.escapeRegex(filters.email), "i");
      if (pageType === "profile") {
        query.$or = query.$or || [];
        query.$or.push(
          { normalizedEmail: normalizeEmail(filters.email) },
          { "contactInfo.personalEmail": emailRegex },
          { "contactInfo.workEmail": emailRegex },
          { "contactInfo.preferredEmail": emailRegex }
        );
      } else if (pageType === "application") {
        query.$or = query.$or || [];
        query.$or.push(
          { "contactInfo.personalEmail": emailRegex },
          { "contactInfo.workEmail": emailRegex }
        );
      }
    }

    // Membership Category filter
    if (filters.membershipCategory) {
      const categories = Array.isArray(filters.membershipCategory)
        ? filters.membershipCategory
        : [filters.membershipCategory];
      
      // This will need to be handled differently for profiles vs applications
      // For now, we'll add it to a filter that can be applied after initial query
      query._membershipCategoryFilter = categories;
    }

    // Date range filters
    if (filters.submissionDateFrom || filters.submissionDateTo) {
      query.submissionDate = {};
      if (filters.submissionDateFrom) {
        query.submissionDate.$gte = new Date(filters.submissionDateFrom);
      }
      if (filters.submissionDateTo) {
        query.submissionDate.$lte = new Date(filters.submissionDateTo);
      }
    }

    if (filters.createdAtFrom || filters.createdAtTo) {
      query.createdAt = {};
      if (filters.createdAtFrom) {
        query.createdAt.$gte = new Date(filters.createdAtFrom);
      }
      if (filters.createdAtTo) {
        query.createdAt.$lte = new Date(filters.createdAtTo);
      }
    }

    if (filters.updatedAtFrom || filters.updatedAtTo) {
      query.updatedAt = {};
      if (filters.updatedAtFrom) {
        query.updatedAt.$gte = new Date(filters.updatedAtFrom);
      }
      if (filters.updatedAtTo) {
        query.updatedAt.$lte = new Date(filters.updatedAtTo);
      }
    }

    // Grade filter
    if (filters.grade) {
      const grades = Array.isArray(filters.grade) ? filters.grade : [filters.grade];
      query["professionalDetails.grade"] = { $in: grades };
    }

    // Section filter
    if (filters.primarySection) {
      const sections = Array.isArray(filters.primarySection)
        ? filters.primarySection
        : [filters.primarySection];
      query["professionalDetails.primarySection"] = { $in: sections };
    }

    // Work Location filter
    if (filters.workLocation) {
      const locations = Array.isArray(filters.workLocation)
        ? filters.workLocation
        : [filters.workLocation];
      query["professionalDetails.workLocation"] = { $in: locations };
    }

    // Branch filter
    if (filters.branch) {
      const branches = Array.isArray(filters.branch) ? filters.branch : [filters.branch];
      query["professionalDetails.branch"] = { $in: branches };
    }

    // Region filter
    if (filters.region) {
      const regions = Array.isArray(filters.region) ? filters.region : [filters.region];
      query["professionalDetails.region"] = { $in: regions };
    }

    // Mobile Number filter
    if (filters.mobileNo) {
      const mobileRegex = new RegExp(this.escapeRegex(filters.mobileNo), "i");
      query["contactInfo.mobileNumber"] = mobileRegex;
    }

    // Active/Inactive filter
    if (filters.isActive !== undefined) {
      if (pageType === "profile") {
        query.isActive = filters.isActive === true || filters.isActive === "true";
      } else if (pageType === "application") {
        query["meta.isActive"] = filters.isActive === true || filters.isActive === "true";
      }
    }

    // Deleted filter (for applications)
    if (pageType === "application" && filters.deleted !== undefined) {
      query["meta.deleted"] = filters.deleted === true || filters.deleted === "true";
    }

    return query;
  }

  /**
   * Build sort object
   */
  buildSort(sortBy, sortOrder = "desc") {
    const order = sortOrder.toLowerCase() === "asc" ? 1 : -1;
    
    // Map common field names to actual database fields
    const fieldMap = {
      createdAt: "createdAt",
      updatedAt: "updatedAt",
      submissionDate: "submissionDate",
      membershipNumber: "membershipNumber",
      fullName: "personalInfo.surname", // Sort by surname for full name
      email: "normalizedEmail",
      applicationId: "applicationId",
      status: "applicationStatus",
    };

    const actualField = fieldMap[sortBy] || sortBy || "updatedAt";
    return { [actualField]: order };
  }

  /**
   * Search profiles
   */
  async searchProfiles(query, filters, pagination, sort) {
    const searchConditions = this.buildSearchConditions(filters.search || filters.q, "profile");
    const filterConditions = this.buildFilterConditions(filters, "profile", query.tenantId);

    // Combine search and filter conditions
    const mongoQuery = { ...filterConditions };
    
    if (searchConditions.length > 0) {
      if (mongoQuery.$or) {
        // Merge with existing $or conditions
        mongoQuery.$and = [
          { $or: mongoQuery.$or },
          { $or: searchConditions }
        ];
        delete mongoQuery.$or;
      } else {
        mongoQuery.$or = searchConditions;
      }
    }

    const skip = (pagination.page - 1) * pagination.limit;
    const sortObj = this.buildSort(sort.sortBy, sort.sortOrder);

    const [results, total] = await Promise.all([
      Profile.find(mongoQuery)
        .sort(sortObj)
        .skip(skip)
        .limit(pagination.limit)
        .lean(),
      Profile.countDocuments(mongoQuery),
    ]);

    return { results, total };
  }

  /**
   * Search applications
   */
  async searchApplications(query, filters, pagination, sort) {
    const searchConditions = this.buildSearchConditions(filters.search || filters.q, "application");
    const filterConditions = this.buildFilterConditions(filters, "application", query.tenantId);

    // Combine search and filter conditions
    const mongoQuery = { ...filterConditions };
    
    if (searchConditions.length > 0) {
      if (mongoQuery.$or) {
        mongoQuery.$and = [
          { $or: mongoQuery.$or },
          { $or: searchConditions }
        ];
        delete mongoQuery.$or;
      } else {
        mongoQuery.$or = searchConditions;
      }
    }

    const skip = (pagination.page - 1) * pagination.limit;
    const sortObj = this.buildSort(sort.sortBy, sort.sortOrder);

    let applications = await PersonalDetails.find(mongoQuery)
      .sort(sortObj)
      .skip(skip)
      .limit(pagination.limit)
      .lean();

    const total = await PersonalDetails.countDocuments(mongoQuery);

    // If membershipCategory filter is applied, we need to filter after fetching
    if (filterConditions._membershipCategoryFilter) {
      const categories = filterConditions._membershipCategoryFilter;
      const applicationIds = applications.map(app => app.applicationId);

      // Get subscription and professional details for these applications
      const [subscriptions, professionals] = await Promise.all([
        SubscriptionDetails.find({ applicationId: { $in: applicationIds } }).lean(),
        ProfessionalDetails.find({ applicationId: { $in: applicationIds } }).lean(),
      ]);

      const subscriptionMap = new Map(
        subscriptions.map(sub => [sub.applicationId, sub])
      );
      const professionalMap = new Map(
        professionals.map(prof => [prof.applicationId, prof])
      );

      // Filter applications by membership category
      applications = applications.filter(app => {
        const subscription = subscriptionMap.get(app.applicationId);
        const professional = professionalMap.get(app.applicationId);
        
        const membershipCategory =
          subscription?.subscriptionDetails?.membershipCategory ||
          professional?.professionalDetails?.membershipCategory ||
          null;

        return categories.includes(membershipCategory);
      });
    }

    return { results: applications, total };
  }

  /**
   * Universal search method
   */
  async search(page, query, filters, pagination, sort) {
    switch (page) {
      case "profile":
        return await this.searchProfiles(query, filters, pagination, sort);
      case "application":
        return await this.searchApplications(query, filters, pagination, sort);
      default:
        throw new Error(`Unsupported page type: ${page}`);
    }
  }
}

module.exports = new UniversalSearchService();
