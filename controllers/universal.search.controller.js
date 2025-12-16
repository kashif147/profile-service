const universalSearchService = require("../services/universal.search.service");
const { AppError } = require("../errors/AppError");
const { extractUserAndCreatorContext } = require("../helpers/get.user.info");

/**
 * Universal Search Controller
 * Handles search and filter requests for profiles, applications, and future pages
 * POST API - All parameters must be sent in request.body
 */
class UniversalSearchController {
  /**
   * Universal search endpoint
   * POST /api/universal/search
   * All parameters must be in request.body
   * First parameter 'page' is mandatory
   */
  async search(req, res, next) {
    try {
      const { userType } = extractUserAndCreatorContext(req);

      // Only allow CRM users for now (can be extended)
      if (userType !== "CRM") {
        return next(
          AppError.forbidden("Access denied. Only CRM users can access this endpoint.")
        );
      }

      // Validate request body exists
      if (!req.body || typeof req.body !== "object") {
        return next(
          AppError.badRequest(
            "Request body is required. All parameters must be sent in the request body."
          )
        );
      }

      // Extract page parameter - MANDATORY and must be first
      const page = req.body.page;
      if (!page) {
        return next(
          AppError.badRequest(
            "'page' parameter is required and must be the first parameter in the request body. Valid values: 'profile', 'application'"
          )
        );
      }

      // Validate page type
      const validPages = ["profile", "application"];
      if (!validPages.includes(page.toLowerCase())) {
        return next(
          AppError.badRequest(
            `Invalid page type. Must be one of: ${validPages.join(", ")}`
          )
        );
      }

      // Extract query parameters
      const query = {
        tenantId: req.tenantId,
      };

      // Extract filters from request body only
      const filters = {
        // Search term (Reg No or Surname)
        search: req.body.search || req.body.q,

        // Email filter
        email: req.body.email,

        // Application Status (for applications)
        applicationStatus: req.body.applicationStatus || req.body.status,

        // Membership Category
        membershipCategory: req.body.membershipCategory,

        // Date filters
        submissionDateFrom: req.body.submissionDateFrom,
        submissionDateTo: req.body.submissionDateTo,
        createdAtFrom: req.body.createdAtFrom,
        createdAtTo: req.body.createdAtTo,
        updatedAtFrom: req.body.updatedAtFrom,
        updatedAtTo: req.body.updatedAtTo,

        // Professional details filters
        grade: req.body.grade,
        primarySection: req.body.primarySection || req.body.section,
        workLocation: req.body.workLocation,
        branch: req.body.branch,
        region: req.body.region,

        // Contact filters
        mobileNo: req.body.mobileNo || req.body.mobileNumber,

        // Status filters
        isActive: req.body.isActive,
        deleted: req.body.deleted,
      };

      // Extract pagination
      const pagination = {
        page: parseInt(req.body.pageNum || req.body.pageNumber || 1),
        limit: parseInt(req.body.limit) || 100,
      };

      // Extract sorting
      const sort = {
        sortBy: req.body.sortBy || "updatedAt",
        sortOrder: req.body.sortOrder || req.body.order || "desc",
      };

      // Validate pagination
      if (pagination.page < 1) {
        pagination.page = 1;
      }
      if (pagination.limit < 1 || pagination.limit > 1000) {
        pagination.limit = 100;
      }

      // Perform search
      const { results, total } = await universalSearchService.search(
        page.toLowerCase(),
        query,
        filters,
        pagination,
        sort
      );

      // Calculate pagination metadata
      const totalPages = Math.ceil(total / pagination.limit);

      return res.success({
        page: page.toLowerCase(),
        count: results.length,
        total,
        currentPage: pagination.page,
        limit: pagination.limit,
        totalPages,
        results,
        filters: filters,
        sort: sort,
      });
    } catch (error) {
      console.error("UniversalSearchController [search] Error:", error);
      return next(
        AppError.internalServerError(
          error.message || "Failed to perform search"
        )
      );
    }
  }
}

module.exports = new UniversalSearchController();
