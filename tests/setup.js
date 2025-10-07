// Test setup file
const mongoose = require('mongoose');

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.PORT = '4001';
process.env.MONGO_URI = 'mongodb://localhost:27017/profile-service-test';
process.env.JWT_SECRET = 'test-jwt-secret-key';
process.env.RABBIT_URL = 'amqp://guest:guest@localhost:5672';
process.env.AUTH_BYPASS_ENABLED = 'true';

// Mock RabbitMQ to prevent connection attempts during testing
jest.mock('../rabbitMQ', () => ({
  initEventSystem: jest.fn().mockResolvedValue(),
  setupConsumers: jest.fn().mockResolvedValue()
}));

// Mock MongoDB connection
jest.mock('../config/db', () => ({
  mongooseConnection: jest.fn().mockResolvedValue()
}));

// Global test teardown
afterAll(async () => {
  // Close any open handles
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
});
