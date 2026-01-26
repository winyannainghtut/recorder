# Screen Recorder - Kubernetes Web App

A lightweight, production-ready screen recording web application designed for Kubernetes deployment with minimal resource usage and no persistent storage. Exposed via Cloudflare Tunnel for secure, easy access.

## Features

- **Browser-based screen capture** using getDisplayMedia API
- **Record entire screen, window, or browser tab** with optional audio
- **Support for long recordings** - up to 3 hours, 2GB file size
- **One-time download** - recordings are deleted immediately after download
- **Auto-expiration** - recordings expire after 1 hour
- **Zero persistence** - no database, no PVC, temporary storage only
- **Ultra-lightweight** - optimized for 128-256Mi memory usage
- **Secure tokens** - cryptographically secure one-time download tokens
- **Streaming I/O** - no full files in RAM, efficient memory usage
- **CDN-safe** - proper cache control headers prevent stale content

## Quick Start

```bash
# 1. Clone and push to your GitHub repo
git clone <this-repo>
cd recorder

# 2. Set up GitHub Actions secrets (DOCKER_USERNAME, DOCKER_PASSWORD)

# 3. Push to trigger Docker build
git push origin main

# 4. Deploy to Kubernetes
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml

# 5. Set up Cloudflare Tunnel (see CLOUDFLARE_TUNNEL_SETUP.md)
```

## Architecture

### Why No Persistent Storage?

This app is designed for **ephemeral** recordings only:

1. **User flow**: Record → Upload → Download (once) → Auto-delete
2. **No long-term storage needed** - recordings are meant for immediate use
3. **Privacy by design** - recordings are never kept permanently
4. **Cost effective** - no S3/MinIO, no database, no PVC
5. **Kubernetes-native** - uses emptyDir for temporary storage

### Streaming vs Temp File Choice

The app uses **streaming upload → temp file → streaming download**:

**Why temp file instead of pure memory streaming:**

- **Memory safety**: Prevents OOM with large recordings (up to 2GB)
- **Reliability**: Survives brief interruptions
- **Simpler logic**: Easier to implement correctly with Go's io.Copy
- **Predictable memory**: Memory usage stays ~128-256Mi regardless of file size

**Streaming benefits:**

- **No buffering**: Upload writes directly to disk, not RAM
- **Fast download**: Streams directly from disk to client
- **Concurrent safe**: Multiple uploads/downloads don't exhaust memory

### Memory Usage Control

The app achieves low memory usage through:

1. **Go binary compiled with `-ldflags="-w -s"`** - stripped binary (~5-10MB)
2. **Distroless base image** - minimal runtime overhead
3. **Streaming I/O** - never loads full files into RAM
4. **Single replica** - no resource multiplication
5. **Resource limits** - Kubernetes enforces 256Mi max
6. **No frameworks** - plain HTML/CSS/JS frontend, Go stdlib backend

### CDN Cache Control

To prevent CDN caching issues (especially with Cloudflare), the app implements:

1. **Cache-busting version strings** in HTML (`app.js?v=3.0.0`)
2. **No-cache headers** for JS/CSS files (`Cache-Control: no-cache, no-store, must-revalidate`)
3. **Must-revalidate headers** for HTML files

This ensures that code updates are served immediately without CDN cache purging.

## Project Structure

```
recorder/
├── backend/
│   ├── main.go          # Go backend server
│   ├── go.mod           # Go dependencies
│   └── go.sum           # Dependency checksums
├── frontend/
│   ├── index.html       # Main HTML page
│   ├── styles.css       # Styling
│   └── app.js           # Screen recording logic (getDisplayMedia)
├── k8s/
│   ├── deployment.yaml       # Kubernetes deployment
│   ├── service.yaml          # ClusterIP service
│   ├── namespace.yaml        # Namespace
│   └── cloudflare-tunnel.yaml # Cloudflare Tunnel connector
├── .github/
│   └── workflows/
│       └── docker-push.yml   # CI/CD pipeline
├── Dockerfile           # Multi-stage build
├── .dockerignore        # Docker ignore file
├── CLOUDFLARE_TUNNEL_SETUP.md  # Tunnel setup guide
├── GITHUB_ACTIONS_SETUP.md     # CI/CD setup guide
└── README.md           # This file
```

## Prerequisites

### Required

- Kubernetes cluster (1.20+)
- kubectl configured
- Docker Hub account
- GitHub account
- Cloudflare account with a domain

### For CI/CD

- GitHub repository with Actions enabled
- Docker Hub credentials as GitHub secrets

## Step-by-Step Deployment Guide

### Step 1: Set Up GitHub Actions

1. Create GitHub repository secrets:
   - `DOCKER_USERNAME` - Your Docker Hub username
   - `DOCKER_PASSWORD` - Your Docker Hub password or access token

2. Push code to trigger the build:
   ```bash
   git push origin main
   ```

3. Monitor build at: `https://github.com/<your-user>/<your-repo>/actions`

See `GITHUB_ACTIONS_SETUP.md` for detailed instructions.

### Step 2: Deploy to Kubernetes

```bash
# Create namespace
kubectl apply -f k8s/namespace.yaml

# Deploy application
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml

# Verify deployment
kubectl get pods -n video-recorder
kubectl get svc -n video-recorder
```

### Step 3: Set Up Cloudflare Tunnel

1. Create a tunnel in Cloudflare Zero Trust dashboard
2. Configure public hostname to point to `video-recorder:8080`
3. Create Kubernetes secret with tunnel token:
   ```bash
   kubectl create secret generic cloudflare-tunnel-token -n video-recorder --from-literal=token=<YOUR_TOKEN>
   ```
4. Deploy the tunnel connector:
   ```bash
   kubectl apply -f k8s/cloudflare-tunnel.yaml
   ```

See `CLOUDFLARE_TUNNEL_SETUP.md` for detailed instructions.

### Step 4: Verify Deployment

```bash
# Check all resources
kubectl get all -n video-recorder

# View application logs
kubectl logs -n video-recorder -l app=video-recorder -f

# View tunnel logs
kubectl logs -n video-recorder -l app=cloudflare-tunnel -f
```

Expected output:
```
NAME                              READY   STATUS    RESTARTS   AGE
pod/video-recorder-xxxxx          1/1     Running   0          5m
pod/cloudflare-tunnel-xxxxx       1/1     Running   0          5m

NAME                    TYPE        CLUSTER-IP      PORT(S)
service/video-recorder  ClusterIP   10.96.xxx.xxx   8080/TCP
```

### Step 5: Test the Application

1. Open your configured domain (e.g., `https://recorder.yourdomain.com`)
2. Click "Start Recording"
3. Select what to share: entire screen, application window, or browser tab
4. Optionally enable audio capture (system audio and/or microphone)
5. Record your screen (max 3 hours)
6. Click "Stop Recording" or stop sharing via browser UI
7. Preview the recording
8. Click "Upload for Download"
9. Click "Download Video" to save locally
10. File is auto-deleted after download

## API Endpoints

### POST /upload

Upload a video recording.

**Request:**
```
Content-Type: multipart/form-data
X-Auth-Token: optional-auth-header  # If AUTH_TOKEN env var is set

Form data:
  video: <video file>  # video/webm
```

**Response (201 Created):**
```json
{
  "token": "abc123...",
  "expiresAt": "2026-01-26T16:30:00Z"
}
```

**Error Responses:**
- `400 Bad Request` - Invalid file type or no file provided
- `401 Unauthorized` - Invalid auth token
- `413 Payload Too Large` - File exceeds 2GB limit
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error

### GET /download/{token}

Download a video recording (one-time use).

**Response (200 OK):**
```
Content-Type: video/webm
Content-Disposition: attachment; filename="recording_20260126_153005.webm"
Content-Length: <size>
Cache-Control: no-store, no-cache, must-revalidate
```

**Error Responses:**
- `404 Not Found` - Token invalid or expired
- `410 Gone` - Download already used

### GET /healthz

Health check endpoint for Kubernetes probes.

**Response (200 OK):**
```
OK
```

### GET /

Serve the frontend application with proper cache control headers.

## Configuration

### Recording Limits

| Setting | Value | Location |
|---------|-------|----------|
| Max recording duration | 3 hours | `frontend/app.js` |
| Max file size | 2 GB | `frontend/app.js`, `backend/main.go` |
| Auto-delete TTL | 1 hour | `backend/main.go` |
| Rate limit | 10 uploads/min/IP | `backend/main.go` |

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AUTH_TOKEN` | Optional auth token for uploads | none (public) |

To enable auth, add to deployment:
```yaml
env:
- name: AUTH_TOKEN
  valueFrom:
    secretKeyRef:
      name: recorder-secrets
      key: auth-token
```

### Resource Limits

Current configuration in `k8s/deployment.yaml`:

```yaml
resources:
  requests:
    memory: "128Mi"
    cpu: "100m"
  limits:
    memory: "256Mi"
    cpu: "500m"
```

### Storage Limits

```yaml
volumes:
- name: tmp-videos
  emptyDir:
    sizeLimit: "5Gi"  # Supports multiple concurrent recordings
```

## Security

### Implemented

1. **One-time tokens** - Downloads expire after first use
2. **TTL-based expiration** - Auto-delete after 1 hour
3. **File type validation** - Only accepts video content
4. **Size limits** - Max 2GB upload
5. **Rate limiting** - 10 uploads per minute per IP
6. **Non-root container** - Runs as UID 65532
7. **Dropped capabilities** - Minimal container privileges
8. **Cache control headers** - Prevent sensitive data caching
9. **Cloudflare protection** - DDoS protection, WAF, automatic HTTPS

### Recommendations for Production

1. Enable `AUTH_TOKEN` for upload authentication
2. Configure Cloudflare WAF rules
3. Set up Cloudflare Access for additional auth layer
4. Monitor logs for abuse patterns
5. Keep base images updated

## Troubleshooting

### Pod Not Starting

```bash
kubectl describe pod -n video-recorder -l app=video-recorder
kubectl logs -n video-recorder -l app=video-recorder
```

Common issues:
- `ImagePullBackOff` → Check Docker Hub credentials and image name
- `OOMKilled` → Increase memory limit
- `CrashLoopBackOff` → Check logs for application errors

### Cloudflare Tunnel Issues

```bash
kubectl logs -n video-recorder -l app=cloudflare-tunnel
```

Common issues:
- `no more connections active` → Check tunnel token and configuration
- Pod not ready → Ensure `--metrics 0.0.0.0:2000` is in args for health probes

### Old Code Being Served (CDN Caching)

If updates aren't appearing:

1. **Check the app.js version** in browser dev tools Network tab
   - Should show `app.js?v=3.0.0`

2. **Hard refresh** the browser: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)

3. **Use incognito window** to bypass browser cache

4. **Verify K8s is running latest image:**
   ```bash
   kubectl rollout restart deployment/video-recorder -n video-recorder
   ```

5. **If still cached**, purge Cloudflare cache:
   - Cloudflare Dashboard → Caching → Purge Everything

### Recording Not Starting

- Ensure browser supports `getDisplayMedia` (Chrome 72+, Firefox 66+, Edge 79+)
- Check browser console for permission errors
- Verify HTTPS is enabled (required for screen capture API)

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/docker-push.yml`):

1. Triggers on push to `main` branch
2. Logs into Docker Hub
3. Builds Docker image for `linux/amd64`
4. Pushes with tags: `latest`, `main`, commit SHA
5. Verifies source code contains screen recording logic

After pushing code changes:
1. Wait for GitHub Actions to complete
2. Restart Kubernetes deployment to pull new image:
   ```bash
   kubectl rollout restart deployment/video-recorder -n video-recorder
   ```

## Performance

| Metric | Value |
|--------|-------|
| Cold start | ~2-3 seconds |
| Idle memory | ~50-70Mi |
| Active memory | ~100-200Mi |
| Max concurrent uploads | ~5-10 (with current limits) |
| Max recording duration | 3 hours |
| Max file size | 2GB |

## Screen Recording Notes

### Browser Support

| Browser | Version | System Audio | Notes |
|---------|---------|--------------|-------|
| Chrome | 72+ | Yes (Windows/ChromeOS) | Best support |
| Firefox | 66+ | Limited | Tab audio only |
| Edge | 79+ | Yes (Windows) | Chromium-based |
| Safari | 13+ | No | Screen only |

### Audio Capture

The application captures:
1. **System audio** - from the shared screen/tab (browser/OS dependent)
2. **Microphone audio** - for voiceover/narration (optional)

### Privacy

- Screen recording requires explicit user permission
- Users choose what to share (screen, window, or tab)
- Browser shows recording indicator while sharing
- Users can stop sharing anytime via browser controls

## Maintenance

### Update Application

```bash
# Make code changes
git add -A
git commit -m "description of changes"
git push origin main

# Wait for GitHub Actions to build

# Restart deployment to pull new image
kubectl rollout restart deployment/video-recorder -n video-recorder
```

### Rollback

```bash
kubectl rollout undo deployment/video-recorder -n video-recorder
```

### Cleanup

```bash
kubectl delete namespace video-recorder
```

## License

MIT License - Feel free to use and modify as needed.

---

**Built with simplicity, security, and efficiency in mind.**
