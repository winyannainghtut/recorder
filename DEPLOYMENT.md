# Quick Deployment Guide

> Current behavior: the upload/link flow has been removed. The app now records in the browser, mixes microphone and computer audio client-side, and downloads directly without server-side video storage. See `README.md` for the current endpoints and flow.

This is a condensed version of README.md for quick reference.

## Prerequisites

- Kubernetes cluster with kubectl
- Docker installed
- Domain name with DNS configured

## Quick Start

### 1. Build Image

```bash
docker build -t video-recorder:latest .
```

### 2. Configure Domain

Edit `k8s/ingress.yaml`:
```yaml
# Replace recorder.yourdomain.com with your domain
- hosts:
  - recorder.example.com
```

### 3. Deploy

```bash
# Create namespace
kubectl apply -f k8s/namespace.yaml

# Deploy app
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml

# (Optional) Setup TLS with cert-manager
kubectl apply -f k8s/cert-manager-issuer.yaml
```

### 4. Verify

```bash
# Check pod
kubectl get pods -n video-recorder

# Check logs
kubectl logs -n video-recorder -l app=video-recorder -f

# Check ingress
kubectl get ingress -n video-recorder
```

### 5. Test

Open `https://recorder.example.com` in your browser.

## Key Configuration

### Auth Token (Optional)

Add to `k8s/deployment.yaml`:
```yaml
env:
- name: AUTH_TOKEN
  value: "your-secret-token"
```

### Resource Limits

In `k8s/deployment.yaml`:
```yaml
resources:
  requests:
    memory: "50Mi"
    cpu: "50m"
  limits:
    memory: "100Mi"
    cpu: "200m"
```

### Recording Limits

Edit `frontend/app.js`:
```javascript
const MAX_RECORDING_DURATION = 5 * 60 * 1000; // 5 minutes
const MAX_FILE_SIZE = 50 * 1024 * 1024;        // 50MB
```

## Troubleshooting

### Pod not running:
```bash
kubectl describe pod -n video-recorder -l app=video-recorder
kubectl logs -n video-recorder -l app=video-recorder
```

### Ingress not working:
```bash
kubectl describe ingress -n video-recorder
kubectl get pods -n ingress-nginx
```

### Certificate issues:
```bash
kubectl get certificate -n video-recorder
kubectl logs -n cert-manager deployment/cert-manager
```

## API Endpoints

- `POST /upload` - Upload video (multipart/form-data)
- `GET /download/{token}` - One-time download
- `GET /healthz` - Health check
- `GET /` - Frontend

## Security

- One-time tokens (invalid after use)
- Auto-expire after 10 minutes
- Max file size: 50MB
- No persistent storage

## Resource Usage

- Memory: 50-100Mi
- CPU: 50m idle, up to 200m active
- Storage: emptyDir (500Mi limit)

## Cleanup

```bash
kubectl delete -f k8s/
kubectl delete namespace video-recorder
```

For full documentation, see README.md.
