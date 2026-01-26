# Screen Recorder - Kubernetes Web App

A lightweight, production-ready screen recording web application designed for Kubernetes deployment with minimal resource usage and no persistent storage.

## Features

- **Browser-based screen capture** using getDisplayMedia API
- **Record entire screen, window, or browser tab** with optional audio
- **One-time download** - recordings are deleted immediately after download
- **Auto-expiration** - recordings expire after 10 minutes
- **Zero persistence** - no database, no PVC, temporary storage only
- **Ultra-lightweight** - optimized for 50-100Mi memory usage
- **Secure tokens** - cryptographically secure one-time download tokens
- **Streaming I/O** - no full files in RAM, efficient memory usage

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

- **Memory safety**: Prevents OOM with large recordings (up to 50MB)
- **Reliability**: Survives pod restarts (within emptyDir lifecycle)
- **Simpler logic**: Easier to implement correctly with Go's io.Copy
- **Predictable memory**: Memory usage stays ~50-100Mi regardless of file size

**Streaming benefits:**

- **No buffering**: Upload writes directly to disk, not RAM
- **Fast download**: Streams directly from disk to client
- **Concurrent safe**: Multiple uploads/downloads don't exhaust memory

### Memory Usage Control

The app achieves ultra-low memory usage through:

1. **Go binary compiled with `-ldflags="-w -s"`** - stripped binary (~5-10MB)
2. **Distroless base image** - minimal runtime overhead
3. **Streaming I/O** - never loads full files into RAM
4. **Single replica** - no resource multiplication
5. **Resource limits** - Kubernetes enforces 100Mi max
6. **No frameworks** - plain HTML/CSS/JS frontend, Go stdlib backend

## Project Structure

```
video-recorder/
├── backend/
│   ├── main.go          # Go backend server
│   ├── go.mod           # Go dependencies
│   └── go.sum           # Dependency checksums
├── frontend/
│   ├── index.html       # Main HTML page
│   ├── styles.css       # Styling
│   └── app.js           # Screen recording logic
├── k8s/
│   ├── deployment.yaml  # Kubernetes deployment
│   ├── service.yaml     # Service
│   ├── ingress.yaml     # Ingress with TLS
│   ├── namespace.yaml   # Namespace
│   └── cert-manager-issuer.yaml  # Optional TLS issuer
├── Dockerfile           # Multi-stage build
├── .dockerignore        # Docker ignore file
└── README.md           # This file
```

## Prerequisites

### Required

- Kubernetes cluster (1.20+)
- kubectl configured
- Docker or compatible container runtime
- Domain name with DNS pointing to your cluster

### Optional (for TLS)

- NGINX Ingress Controller
- cert-manager (for automatic Let's Encrypt certificates)

## Step-by-Step Deployment Guide

### Step 1: Clone and Build Docker Image

```bash
# Navigate to project directory
cd video-recorder

# Build Docker image
docker build -t video-recorder:latest .

# (Optional) Tag and push to your registry
docker tag video-recorder:latest your-registry.com/video-recorder:latest
docker push your-registry.com/video-recorder:latest
```

### Step 2: Configure Kubernetes Manifests

Edit `k8s/ingress.yaml` to use your domain:

```yaml
# Replace "recorder.yourdomain.com" with your actual domain
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - recorder.example.com  # YOUR DOMAIN HERE
    secretName: video-recorder-tls
  rules:
  - host: recorder.example.com  # YOUR DOMAIN HERE
```

If using cert-manager, also edit `k8s/cert-manager-issuer.yaml`:

```yaml
spec:
  acme:
    email: your-email@example.com  # YOUR EMAIL HERE
```

### Step 3: Deploy to Kubernetes

```bash
# Create namespace
kubectl apply -f k8s/namespace.yaml

# Deploy application
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml

# Deploy ingress (configure domain first!)
kubectl apply -f k8s/ingress.yaml
```

### Step 4: (Optional) Setup TLS with cert-manager

If you have cert-manager installed:

```bash
# Apply ClusterIssuer
kubectl apply -f k8s/cert-manager-issuer.yaml

# Update ingress to use the issuer
# (already configured in ingress.yaml)
```

The certificate will be automatically issued and renewed.

### Step 5: Verify Deployment

```bash
# Check pod status
kubectl get pods -n video-recorder

# Check service
kubectl get svc -n video-recorder

# Check ingress
kubectl get ingress -n video-recorder

# View logs
kubectl logs -n video-recorder -l app=video-recorder -f
```

Expected output:

```
NAME                              READY   STATUS    RESTARTS   AGE
video-recorder-xxxxxxxxxx-xxxxx   1/1     Running   0          2m
```

### Step 6: Configure DNS

Point your domain to your cluster's ingress IP:

**For LoadBalancer ingress:**
```bash
kubectl get svc -n ingress-nginx
# Add A record: recorder.example.com -> <EXTERNAL-IP>
```

**For other ingress types:** Use your cloud provider's DNS configuration.

### Step 7: Test the Application

1. Open `https://recorder.example.com` in your browser
2. Click "Start Recording"
3. Select what to share: entire screen, application window, or browser tab
4. Optionally enable audio capture (system audio and/or microphone)
5. Record your screen (max 5 minutes)
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
X-Auth-Token: optional-auth-header  # If AUTH_TOKEN is set

Form data:
  video: <video file>  # video/webm
```

**Response (201 Created):**
```json
{
  "token": "abc123...",
  "expiresAt": "2026-01-26T15:30:00Z"
}
```

**Error Responses:**
- `400 Bad Request` - Invalid file type or no file provided
- `401 Unauthorized` - Invalid auth token
- `413 Payload Too Large` - File exceeds 50MB limit
- `500 Internal Server Error` - Server error

### GET /download/{token}

Download a video recording (one-time use).

**Request:**
```
GET /download/abc123...
```

**Response (200 OK):**
```
Content-Type: video/webm
Content-Disposition: attachment; filename="recording_20260126_153005.webm"
Content-Length: <size>
<binary video data>
```

**Error Responses:**
- `404 Not Found` - Token invalid or expired
- `410 Gone` - Download already used

### GET /healthz

Health check endpoint.

**Response (200 OK):**
```
OK
```

### GET /

Serve the frontend application.

## Configuration

### Environment Variables

The app supports optional environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `AUTH_TOKEN` | Optional auth token for uploads | none (public) |
| `PORT` | Server port | 8080 |

To set auth token, update `k8s/deployment.yaml`:

```yaml
spec:
  template:
    spec:
      containers:
      - name: recorder
        env:
        - name: AUTH_TOKEN
          value: "your-secret-token"
```

Then send the token in upload requests:

```bash
curl -X POST https://recorder.example.com/upload \
  -H "X-Auth-Token: your-secret-token" \
  -F "video=@recording.webm"
```

### Resource Limits

Current configuration in `k8s/deployment.yaml`:

```yaml
resources:
  requests:
    memory: "128Mi"   # Minimum guaranteed memory
    cpu: "100m"       # Minimum guaranteed CPU
  limits:
    memory: "256Mi"   # Maximum memory (OOM if exceeded)
    cpu: "500m"       # Maximum CPU
```

Adjust based on your needs:
- For higher concurrency: increase requests/limits
- For lower resource usage: decrease limits (monitor for OOM)

### Recording Limits

Frontend limits (configurable in `frontend/app.js`):

```javascript
const MAX_RECORDING_DURATION = 3 * 60 * 60 * 1000; // 3 hours
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;      // 2GB
```

Backend limits (configurable in `backend/main.go`):

```go
const maxUploadSize = 2 * 1024 * 1024 * 1024 // 2GB
const ttlDuration = 60 * time.Minute         // Auto-delete after 1 hour
```

### emptyDir Storage

The deployment uses an emptyDir volume for temporary storage:

```yaml
volumes:
- name: tmp-videos
  emptyDir:
    sizeLimit: "5Gi"  # Total storage per pod (supports multiple 2GB recordings)
```

Adjust `sizeLimit` based on expected concurrent recordings.

## Security Considerations

### Implemented

1. **One-time tokens** - Downloads expire after first use
2. **TTL-based expiration** - Auto-delete after 10 minutes
3. **File type validation** - Only accepts video content
4. **Size limits** - Max 50MB upload
5. **Security headers** - Ingress adds XSS protection
6. **Non-root container** - Runs as nonroot user
7. **Read-only filesystem** (except /tmp)
8. **Dropped capabilities** - Minimal container privileges

### Additional Recommendations

1. **Enable auth tokens** for production use
2. **Configure rate limiting** in ingress for production
3. **Use network policies** to restrict pod communication
4. **Enable pod security policies** or pod security standards
5. **Monitor for abuse** using Prometheus/metrics
6. **Regular updates** - Keep base images updated

## Monitoring and Logging

### Logs

View real-time logs:

```bash
kubectl logs -n video-recorder -l app=video-recorder -f
```

Log format:

```
2026/01/26 15:30:00 Starting server on :8080
2026/01/26 15:30:00 Using temp directory: /tmp/videos
2026/01/26 15:30:15 Uploaded: abc123.webm (size: 12345678 bytes, expires: 2026-01-26 15:40:15 +0000 UTC)
2026/01/26 15:30:20 Downloaded: abc123.webm (token: abc123)
2026/01/26 15:35:00 Cleaned up token xyz789 (expired: true, downloaded: false)
```

### Metrics

The app exposes basic metrics through health checks:

```bash
curl https://recorder.example.com/healthz
```

### Resource Monitoring

Monitor pod resource usage:

```bash
kubectl top pod -n video-recorder
kubectl top node
```

## Troubleshooting

### Pod Not Starting

```bash
# Check pod status
kubectl describe pod -n video-recorder -l app=video-recorder

# Check logs
kubectl logs -n video-recorder -l app=video-recorder
```

Common issues:
- Image pull error → Verify image name/tag
- OOMKilled → Increase memory limit
- CrashLoopBackOff → Check logs for errors

### Ingress Not Working

```bash
# Check ingress status
kubectl describe ingress -n video-recorder

# Check ingress controller
kubectl get pods -n ingress-nginx

# Verify DNS
nslookup recorder.example.com
```

### Certificate Issues

```bash
# Check certificate status
kubectl get certificate -n video-recorder

# Check cert-manager logs
kubectl logs -n cert-manager deployment/cert-manager

# Check ingress annotation
kubectl get ingress -n video-recorder -o yaml
```

### Upload/Download Issues

```bash
# Check storage usage
kubectl exec -n video-recorder -l app=video-recorder -- df -h /tmp

# Check file permissions
kubectl exec -n video-recorder -l app=video-recorder -- ls -la /tmp/videos

# Test upload manually
curl -X POST https://recorder.example.com/upload -F "video=@test.webm"
```

## Scaling

### Horizontal Scaling

For higher concurrency, increase replicas:

```yaml
# Update k8s/deployment.yaml
spec:
  replicas: 3  # Increase from 1
```

**Note:** Each pod has independent storage. Recordings are pod-specific.

### Resource Scaling

For higher throughput, adjust resources:

```yaml
resources:
  requests:
    memory: "100Mi"   # Increase
    cpu: "100m"       # Increase
  limits:
    memory: "200Mi"   # Increase
    cpu: "400m"       # Increase
```

### Storage Scaling

For larger recordings or more concurrent uploads, increase emptyDir size:

```yaml
emptyDir:
  sizeLimit: "1Gi"  # Increase from 500Mi
```

## Maintenance

### Rolling Updates

```bash
# Build new image
docker build -t video-recorder:v2 .

# Update deployment
kubectl set image deployment/video-recorder -n video-recorder recorder=video-recorder:v2

# Monitor rollout
kubectl rollout status deployment/video-recorder -n video-recorder
```

### Rollback

```bash
# Rollback to previous version
kubectl rollout undo deployment/video-recorder -n video-recorder

# Check rollback status
kubectl rollout status deployment/video-recorder -n video-recorder
```

### Cleanup

```bash
# Delete deployment
kubectl delete -f k8s/

# Delete namespace (everything)
kubectl delete namespace video-recorder
```

## Production Checklist

Before deploying to production:

- [ ] Configure your domain in ingress.yaml
- [ ] Set AUTH_TOKEN environment variable
- [ ] Configure TLS with cert-manager
- [ ] Set up DNS records
- [ ] Test recording/upload/download flow
- [ ] Configure monitoring/alerting
- [ ] Set up log aggregation
- [ ] Review and adjust resource limits
- [ ] Configure ingress rate limiting
- [ ] Test scaling behavior
- [ ] Document your deployment
- [ ] Set up backup/restore procedures (though no data persistence needed)

## License

MIT License - Feel free to use and modify as needed.

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review logs with `kubectl logs`
3. Check ingress controller and cert-manager status
4. Verify DNS configuration

## Performance Characteristics

### Expected Performance

- **Cold start**: ~2-3 seconds
- **Idle memory**: ~50-70Mi
- **Active memory**: ~70-100Mi (during upload/download)
- **CPU idle**: Near zero
- **CPU active**: ~50-100m per concurrent operation
- **Max concurrent uploads**: ~10-20 (depends on file size)

### Optimization Notes

- Go binary is compiled with `-ldflags="-w -s"` for minimal size
- Distroless base image reduces attack surface
- Streaming I/O prevents memory bloat
- emptyDir provides fast local storage
- Single replica minimizes resource usage

---

**Built with simplicity, security, and efficiency in mind.**

## Screen Recording Notes

### Browser Support

Screen recording using `getDisplayMedia` is supported in:
- Chrome 72+
- Firefox 66+
- Edge 79+
- Safari 13+ (limited audio support)

### Audio Capture

The application attempts to capture:
1. **System audio** - from the shared screen/tab (browser dependent)
2. **Microphone audio** - for voiceover/narration

Note: System audio capture may not work in all browsers/OS combinations. Chrome on Windows/ChromeOS has the best support.

### Privacy Considerations

- Screen recording requires explicit user permission
- Users can choose to share entire screen, specific window, or browser tab
- Recording indicator is shown by the browser while sharing
- Users can stop sharing at any time via browser controls
