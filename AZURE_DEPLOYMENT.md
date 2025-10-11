# Azure Deployment Troubleshooting

## Issue

Getting `{"error":"NOT_FOUND","message":"Not found"}` when browsing the service in Azure.

## Root Causes

1. **.env files not deployed** - Azure deployment removes .env files (CI/CD line 94)
2. **Environment variables not set** in Azure Application Settings
3. **App crashes at startup** due to missing MongoDB/RabbitMQ connection

## Changes Made

### 1. Fixed Environment Loading (`app.js`)

- Changed to only load .env files in development
- Azure uses Application Settings instead of .env files
- Added better error logging for MongoDB connection

### 2. Improved 404 Handler

- Returns consistent JSON format matching the error you saw
- Includes request path for debugging

## Azure Configuration Steps

### Step 1: Set Environment Variables in Azure Portal

Go to: **App Service → Configuration → Application settings** and add:

```bash
NODE_ENV=staging
MONGO_URI=mongodb+srv://kashif147:Test12**@clusterprojectshell.tptnh8w.mongodb.net/Profile-Service?retryWrites=true&w=majority&appName=ClusterProjectShell
RABBIT_URL=amqp://guest:guest@projectshell-rabbitmq123.canadacentral.azurecontainer.io:5672
JWT_SECRET=32704701374fhfwefgwefwisagfiwudsgfui
JWT_EXPIRY=24h
AUTH_BYPASS_ENABLED=true
POLICY_SERVICE_URL=https://userserviceshell-aqf6f0b8fqgmagch.canadacentral-01.azurewebsites.net
POLICY_CACHE_TIMEOUT=300000
POLICY_TIMEOUT=5000
POLICY_RETRIES=3
REDIS_URL=redis://admin:Letme1nplz@Redis@user-service-redis.redis.cache.windows.net:6380/0
REDIS_ENABLED=true
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
```

⚠️ **Do NOT set PORT** - Azure auto-assigns it via `process.env.PORT`

### Step 2: Check Logs

```bash
# Via Azure CLI
az webapp log tail --name <your-app-name> --resource-group <your-rg>

# Via Portal
App Service → Monitoring → Log stream
```

Look for:

- `✅ MongoDB connected successfully`
- `Server Running on Port: XXXX`
- Any startup errors

### Step 3: Test Endpoints

```bash
# Health check (no auth required)
curl https://<your-app>.azurewebsites.net/health

# API docs (no auth required)
curl https://<your-app>.azurewebsites.net/api

# Protected endpoint (requires auth)
curl -H "Authorization: Bearer <token>" https://<your-app>.azurewebsites.net/api/personal-details
```

## Common Issues

### Issue: App still returns NOT_FOUND

**Fix:** Check if MongoDB connection is failing:

- Verify MongoDB Atlas allows Azure IPs (0.0.0.0/0 for testing)
- Check connection string is correct
- Test connection locally with staging credentials

### Issue: RabbitMQ errors in logs

**Fix:** RabbitMQ failure won't crash the app (it's async), but check:

- RabbitMQ container is running
- Firewall allows Azure to connect

### Issue: CORS errors

**Fix:** Add your frontend domain to `ALLOWED_ORIGINS`:

```
ALLOWED_ORIGINS=https://your-frontend.azurewebsites.net,http://localhost:3000
```

## Verify Deployment

1. **Check web.config is deployed:**

```bash
# Should see bin/profile-service.js handler
curl https://<your-app>.azurewebsites.net/web.config
```

2. **Restart App Service:**
   Portal → Overview → Restart

3. **Check startup:**
   Portal → Monitoring → Log stream (watch for errors)

## Testing Locally with Staging Config

```bash
NODE_ENV=staging npm start
```

Should load .env.staging and connect to staging MongoDB/RabbitMQ.
