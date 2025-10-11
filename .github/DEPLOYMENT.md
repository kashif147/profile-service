# GitHub Actions Deployment Setup

## Overview

This repository is configured to automatically deploy to Azure App Service on every push to the `main` branch.

## Azure App Service Details

- **App Name:** profileserviceShell
- **Resource Group:** profileserviceShell_group
- **Subscription ID:** 5594b6b1-65e0-4b4d-a0fd-bf61c91df834
- **App URL:** https://profileserviceShell.azurewebsites.net

## Required GitHub Secrets

The following secrets must be configured in your GitHub repository:

### AZURE_CLIENT_ID

Value: `ad25f823-e2d3-43e2-bea5-a9e6c9b0dbae`

### AZURE_TENANT_ID

Value: `39866a06-30bc-4a89-80c6-9dd9357dd453`

### AZURE_SUBSCRIPTION_ID

Value: `5594b6b1-65e0-4b4d-a0fd-bf61c91df834`

These secrets are provided by Azure and should be configured in:
**GitHub Repository → Settings → Secrets and variables → Actions → Repository secrets**

## Workflow Features

- **Automatic deployment** on push to main branch
- **Manual deployment** via workflow_dispatch (Actions tab in GitHub)
- **Build verification** with npm ci and test:ci
- **Deployment package** creation with only necessary files
- **Health check** endpoint verification after deployment

## Deployment Process

1. Code is checked out
2. Node.js 18.x is set up
3. Dependencies are installed via `npm ci`
4. Tests are run (non-blocking)
5. Deployment package is created
6. Azure authentication is performed
7. Package is deployed to Azure App Service
8. Azure logout and deployment summary

## Manual Deployment

To manually trigger a deployment:

1. Go to the **Actions** tab in GitHub
2. Select **Deploy Profile Service to Azure**
3. Click **Run workflow**
4. Select the `main` branch
5. Click **Run workflow**

## Verifying Deployment

After deployment completes:

1. **Health Check:** https://profileserviceShell.azurewebsites.net/health
2. **API Docs:** https://profileserviceShell.azurewebsites.net/api
3. **Azure Logs:** Check Azure Portal → App Service → Log Stream

## Troubleshooting

### Deployment fails with authentication error

- Verify all three secrets exist in GitHub repository settings:
  - `AZURE_CLIENT_ID`
  - `AZURE_TENANT_ID`
  - `AZURE_SUBSCRIPTION_ID`
- Check the service principal has contributor access to the App Service
- Ensure the subscription ID matches your Azure subscription
- Verify Federated Credentials are configured in Azure for GitHub Actions

### Deployment succeeds but app doesn't work

- Check Azure Application Settings are configured (see AZURE_DEPLOYMENT.md)
- Verify MongoDB connection string is valid
- Check Azure Log Stream for startup errors
- Restart the App Service from Azure Portal

### Tests fail during deployment

Tests are set to `continue-on-error: true`, so they won't block deployment. However, you should still fix any failing tests for production reliability.

## Environment Variables

Remember to configure these in Azure Portal → App Service → Configuration → Application Settings:

- NODE_ENV
- MONGO_URI
- RABBIT_URL
- JWT_SECRET
- JWT_EXPIRY
- AUTH_BYPASS_ENABLED
- POLICY_SERVICE_URL
- POLICY_CACHE_TIMEOUT
- POLICY_TIMEOUT
- POLICY_RETRIES
- REDIS_URL
- REDIS_ENABLED
- ALLOWED_ORIGINS

See `AZURE_DEPLOYMENT.md` for complete configuration details.
