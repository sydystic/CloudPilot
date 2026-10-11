# Dockerfile for CloudPilot Backend Node.js Service
FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application source code
COPY . .

# Expose backend port
EXPOSE 4000

# Environment variables defaults
ENV PORT=4000
ENV NODE_ENV=production

# Start application
CMD ["node", "server.js"]
