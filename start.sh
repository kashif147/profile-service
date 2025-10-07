#!/bin/bash

# Azure App Service startup script
echo "Starting Profile Service..."

# Set default environment if not set
export NODE_ENV=${NODE_ENV:-staging}

# Log environment info
echo "Environment: $NODE_ENV"
echo "Port: $PORT"
echo "Node Version: $(node --version)"
echo "NPM Version: $(npm --version)"

# Start the application
echo "Starting application..."
exec node ./bin/profile-service.js
