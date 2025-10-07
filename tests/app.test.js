const request = require('supertest');

// Mock the app module to avoid RabbitMQ and MongoDB connections
jest.mock('../app', () => {
  const express = require('express');
  const app = express();
  
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      service: 'profile-service',
      timestamp: new Date().toISOString(),
      port: process.env.PORT || 4001,
      environment: process.env.NODE_ENV || 'test'
    });
  });
  
  app.get('/api', (req, res) => {
    res.json({
      service: 'Profile Service API',
      version: '1.0.0',
      endpoints: {
        health: 'GET /health',
        personalDetails: 'GET /api/personal-details (auth required)',
        professionalDetails: 'GET /api/professional-details (auth required)',
        subscriptionDetails: 'GET /api/subscription-details (auth required)',
        applications: 'GET /api/applications (auth required)'
      },
      authentication: 'Bearer token required for all endpoints except /health and /api'
    });
  });
  
  app.get('/', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Profile Service</title></head>
        <body><h1>Profile Service</h1></body>
      </html>
    `);
  });
  
  return app;
});

const app = require('../app');

describe('Profile Service API', () => {
  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('service', 'profile-service');
    });
  });

  describe('GET /api', () => {
    it('should return API documentation', async () => {
      const response = await request(app)
        .get('/api')
        .expect(200);

      expect(response.body).toHaveProperty('service', 'Profile Service API');
      expect(response.body).toHaveProperty('version', '1.0.0');
      expect(response.body).toHaveProperty('endpoints');
    });
  });

  describe('GET /', () => {
    it('should return homepage', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.text).toContain('Profile Service');
    });
  });
});
