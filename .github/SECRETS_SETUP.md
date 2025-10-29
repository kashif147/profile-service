# GitHub Secrets Setup Guide

## Error: "Not all values are present. Ensure 'client-id' and 'tenant-id' are supplied"

This error means the GitHub secrets are not configured. Follow these steps:

## Step 1: Go to GitHub Repository Settings

1. Navigate to your GitHub repository
2. Click **Settings** (top right)
3. In left sidebar, click **Secrets and variables** → **Actions**
4. Click **New repository secret**

## Step 2: Add Each Secret

### Secret 1: AZURE_CLIENT_ID

- Name: `AZURE_CLIENT_ID`
- Value: `ad25f823-e2d3-43e2-bea5-a9e6c9b0dbae`
- Click **Add secret**

### Secret 2: AZURE_TENANT_ID

- Name: `AZURE_TENANT_ID`
- Value: `39866a06-30bc-4a89-80c6-9dd9357dd453`
- Click **Add secret**

### Secret 3: AZURE_SUBSCRIPTION_ID

- Name: `AZURE_SUBSCRIPTION_ID`
- Value: `5594b6b1-65e0-4b4d-a0fd-bf61c91df834`
- Click **Add secret**

## Step 3: Verify Secrets Are Created

You should see all three secrets listed:

```
AZURE_CLIENT_ID
AZURE_TENANT_ID
AZURE_SUBSCRIPTION_ID
```

## Step 4: Manage Azure Federated Credentials

The Azure App Service must have federated credentials configured for GitHub Actions.

### List existing federated credentials:

```bash
az ad app federated-credential list --id ad25f823-e2d3-43e2-bea5-a9e6c9b0dbae
```

### Delete existing federated credential:

If you need to remove an old/incorrect federated credential:

```bash
az ad app federated-credential delete \
  --id ad25f823-e2d3-43e2-bea5-a9e6c9b0dbae \
  --federated-credential-id <CREDENTIAL_NAME>
```

Replace `<CREDENTIAL_NAME>` with the name from the list command output.

### Create new federated credential:

```bash
az ad app federated-credential create \
  --id ad25f823-e2d3-43e2-bea5-a9e6c9b0dbae \
  --parameters '{
    "name": "profileserviceShell-github-actions",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:YOUR_GITHUB_USERNAME/YOUR_REPO_NAME:ref:refs/heads/main",
    "description": "GitHub Actions for profileserviceShell",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

**Replace:**

- `YOUR_GITHUB_USERNAME` with your GitHub username
- `YOUR_REPO_NAME` with your repository name (e.g., `repo:john/profile-service:ref:refs/heads/main`)

## Step 5: Test Deployment

After setting up secrets:

1. Go to **Actions** tab in GitHub
2. Click **Build and deploy Node.js app to Azure Web App - profileserviceShell**
3. Click **Run workflow** → Select `main` branch → **Run workflow**
4. Monitor the deployment logs

## Common Issues

### Issue: Secrets are set but still getting error

- **Solution:** Click on each secret and re-save it to ensure it's properly stored
- **Solution:** Verify the secret names are EXACTLY as shown (case-sensitive)

### Issue: Login succeeds but deployment fails

- **Solution:** Check Azure App Service is running and accessible
- **Solution:** Verify the app-name matches: `profileserviceShell`

### Issue: Federated credential error

- **Solution:** The subject in federated credential must match your repo exactly:
  ```
  repo:username/repository-name:ref:refs/heads/main
  ```

### Issue: "No subscriptions found" error

- **Solution:** The service principal needs role assignment. Run:
  ```bash
  az role assignment create \
    --assignee ad25f823-e2d3-43e2-bea5-a9e6c9b0dbae \
    --role Contributor \
    --scope /subscriptions/5594b6b1-65e0-4b4d-a0fd-bf61c91df834/resourceGroups/profileserviceShell_group/providers/Microsoft.Web/sites/profileserviceShell
  ```
- **Verify:** Check role assignment exists:
  ```bash
  az role assignment list --scope /subscriptions/5594b6b1-65e0-4b4d-a0fd-bf61c91df834/resourceGroups/profileserviceShell_group/providers/Microsoft.Web/sites/profileserviceShell --query "[?principalId=='1da03864-8b39-4305-ac06-b56d5b81053e']" --output table
  ```

## Verification Checklist

- [ ] All 3 secrets created in GitHub repository
- [ ] Secret names are exact (AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID)
- [ ] Azure federated credential configured for GitHub Actions
- [ ] Subject in federated credential matches your repository: `repo:kashif147/profile-service:ref:refs/heads/main`
- [ ] Service principal has Contributor role on App Service resource
- [ ] App Service name is correct: profileserviceShell
