# Multi-stage Dockerfile for video recorder app
# Stage 1: Build Go backend
FROM golang:1.21-alpine AS builder
WORKDIR /build

# Install build dependencies
RUN apk add --no-cache git

# Copy Go modules
COPY backend/go.mod backend/go.sum ./
RUN go mod download

# Copy backend source
COPY backend/ ./

# Build backend binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-w -s" -o /app/recorder ./main.go

# Stage 2: Final runtime image (distroless for minimal size)
FROM gcr.io/distroless/static-debian12

# Copy compiled binary (already executable from build)
COPY --from=builder /app/recorder /app/recorder

# Copy frontend files
COPY frontend/ /app/frontend/

# Set working directory
WORKDIR /app

# Expose port
EXPOSE 8080

# Use non-root user (distroless runs as nonroot by default)
USER nonroot:nonroot

# Note: Health checks are handled by Kubernetes probes (liveness/readiness)
# Docker HEALTHCHECK is not needed and won't work well with distroless

# Run the application
ENTRYPOINT ["/app/recorder"]
