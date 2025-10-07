# Profile Service

A microservice for managing user profiles in the membership management system.

## 🚀 Features

- **Personal Details Management** - Store and manage user personal information
- **Professional Details Management** - Handle professional background and qualifications
- **Subscription Details Management** - Manage membership subscriptions and billing
- **Application Processing** - Handle membership applications and approvals
- **Event-Driven Architecture** - RabbitMQ integration for real-time updates
- **Multi-tenant Support** - Tenant isolation and security
- **RESTful API** - Clean API endpoints with proper authentication

## 🛠️ Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Message Queue**: RabbitMQ
- **Authentication**: JWT tokens
- **Validation**: Joi schema validation
- **Containerization**: Docker

## 📋 Prerequisites

- Node.js 18 or higher
- MongoDB (local or Atlas)
- RabbitMQ server
- Redis (optional, for caching)

## 🔧 Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/kashif147/profile-service.git
   cd profile-service
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   ```bash
   # Copy environment template
   cp .env.development.template .env.development
   cp .env.staging.template .env.staging
   
   # Update the values in .env.development
   ```

4. **Start the service**
   ```bash
   npm start
   ```

## 🌐 API Endpoints

### Public Endpoints
- `GET /` - Service homepage
- `GET /health` - Health check
- `GET /api` - API documentation

### Protected Endpoints (Require JWT Token)
- `GET /api/personal-details` - Get personal details
- `POST /api/personal-details` - Create/update personal details
- `GET /api/professional-details` - Get professional details
- `POST /api/professional-details` - Create/update professional details
- `GET /api/subscription-details` - Get subscription details
- `POST /api/subscription-details` - Create/update subscription details
- `GET /api/applications` - Get applications
- `POST /api/applications` - Create new application

## 🐳 Docker

### Build and Run with Docker
```bash
# Build the image
npm run docker:build

# Run the container
npm run docker:run
```

### Docker Compose (Recommended)
```yaml
version: '3.8'
services:
  profile-service:
    build: .
    ports:
      - "4001:4001"
    environment:
      - NODE_ENV=development
      - MONGO_URI=mongodb://mongo:27017/Profile-Service
      - RABBIT_URL=amqp://rabbitmq:5672
    depends_on:
      - mongo
      - rabbitmq
  
  mongo:
    image: mongo:6.0
    ports:
      - "27017:27017"
  
  rabbitmq:
    image: rabbitmq:3-management
    ports:
      - "5672:5672"
      - "15672:15672"
```

## 🔄 CI/CD Pipeline

The service includes GitHub Actions workflows for:

- **Continuous Integration**: Automated testing and linting
- **Docker Build**: Automated Docker image creation
- **Deployment**: Staging and production deployment pipelines

### Workflow Files
- `.github/workflows/ci-cd.yml` - Main CI/CD pipeline
- `.github/workflows/docker.yml` - Docker build and deployment

## 🧪 Testing

```bash
# Run tests
npm test

# Run with coverage
npm run test:coverage

# Run linting
npm run lint
```

## 📊 Monitoring

- **Health Check**: `GET /health`
- **Logs**: Structured logging with Winston
- **Metrics**: Application metrics via `/metrics` endpoint

## 🔐 Security

- JWT-based authentication
- CORS configuration
- Input validation with Joi
- Rate limiting
- Environment variable protection

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the ISC License.

## 🆘 Support

For support and questions:
- Create an issue in the GitHub repository
- Check the API documentation at `/api`
- Review the health check at `/health`

## 🔄 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 4001 |
| `NODE_ENV` | Environment | development |
| `MONGO_URI` | MongoDB connection string | mongodb://localhost:27017/Profile-Service |
| `JWT_SECRET` | JWT signing secret | Required |
| `RABBIT_URL` | RabbitMQ connection URL | amqp://localhost:5672 |
| `POLICY_SERVICE_URL` | Policy service endpoint | http://localhost:5001 |
