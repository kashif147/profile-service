# Use the Node.js 18 base image
FROM node:18

# Create and set the working directory
WORKDIR /app

# Copy only package files first to leverage Docker cache
COPY package*.json ./
# Install project dependencies
RUN npm install

# Copy the entire project into the container
COPY . .

# Expose port (adjust if needed per service)
EXPOSE 5001

# Start the app using the actual entry file
CMD ["node", "./bin/profile-service.js"]