# Start from official Node image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first (for caching)
COPY package*.json ./

# Install Node dependencies
RUN npm install

# Copy the rest of the React app
COPY . .

# Expose port 3000
EXPOSE 3000

# Start React dev server
CMD ["npm", "run","dev"]