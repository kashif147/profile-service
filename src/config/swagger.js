// config/swagger.js
import swaggerJsdoc from "swagger-jsdoc";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Profile Service API",
      version: "1.0.0",
      description: "API documentation for Profile Service",
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Development server",
      },
      {
        url: "https://userserviceshell-aqf6f0b8fqgmagch.canadacentral-01.azurewebsites.net",
        description: "Production server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  },
  apis: ["./routes/*.js", "./controllers/*.js"], // adjust paths if needed
};

const specs = swaggerJsdoc(options);

export default specs;
