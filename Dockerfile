# Use the official Bun image
FROM oven/bun:latest

# Set the working directory
WORKDIR /app

# Copy the entire monorepo
COPY . .

# Install all dependencies using Bun
RUN bun install

# Build the server app DIRECTLY (skipping Turbo to avoid binary path issues)
RUN cd apps/server && bun run build

# Switch to the server app directory for execution
WORKDIR /app/apps/server

# Expose the API port
EXPOSE 3000

# Start the Hono server!
CMD ["bun", "run", "dist/index.mjs"]
