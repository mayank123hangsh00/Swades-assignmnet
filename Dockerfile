# Use the official Bun image
FROM oven/bun:latest

# Set the working directory
WORKDIR /app

# Copy the entire monorepo (to resolve shared packages)
COPY . .

# Install all dependencies for the monorepo
RUN bun install

# Build the server app specifically using Bun & Turbo
RUN bun run build --filter server

# Expose the API port
EXPOSE 3000

# The command to start the server!
CMD ["bun", "run", "--filter", "server", "start"]
