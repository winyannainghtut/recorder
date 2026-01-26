# Cloudflare Tunnel Setup Guide

This guide explains how to expose your video recorder app using Cloudflare Tunnel on your local Kubernetes cluster.

## Why Cloudflare Tunnel?

- **No public IP required** - Works behind NAT/firewall
- **No port forwarding** - Cloudflare handles ingress
- **Free TLS certificates** - Automatic HTTPS
- **DDoS protection** - Included with Cloudflare
- **Zero Trust security** - Optional access policies

## Prerequisites

1. Cloudflare account (free tier works)
2. Domain managed by Cloudflare (or add your domain to Cloudflare)
3. kubectl configured for your cluster

## Step 1: Create Cloudflare Tunnel

### Option A: Via Cloudflare Dashboard (Recommended)

1. Go to [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/)
2. Navigate to **Access** → **Tunnels**
3. Click **Create a tunnel**
4. Name it: `video-recorder-tunnel`
5. Click **Save tunnel**
6. **Copy the tunnel token** (you'll need this)
7. Skip the connector installation (we'll do it in K8s)
8. Configure public hostname:
   - **Subdomain**: `recorder` (or your choice)
   - **Domain**: Select your domain
   - **Service**: `http://video-recorder.video-recorder.svc.cluster.local:80`
9. Click **Save**

### Option B: Via CLI

```bash
# Install cloudflared
# Windows: winget install Cloudflare.cloudflared
# Mac: brew install cloudflared
# Linux: Download from https://github.com/cloudflare/cloudflared/releases

# Login to Cloudflare
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create video-recorder-tunnel

# Get tunnel token
cloudflared tunnel token video-recorder-tunnel
```

## Step 2: Deploy to Kubernetes

### 2.1 Create the namespace (if not already created)

```bash
kubectl apply -f k8s/namespace.yaml
```

### 2.2 Create the tunnel token secret

```bash
# Replace <YOUR_TUNNEL_TOKEN> with the token from Step 1
kubectl create secret generic cloudflare-tunnel-token \
  -n video-recorder \
  --from-literal=token=<YOUR_TUNNEL_TOKEN>
```

### 2.3 Deploy the video recorder app

```bash
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

### 2.4 Deploy Cloudflare Tunnel connector

```bash
kubectl apply -f k8s/cloudflare-tunnel.yaml
```

## Step 3: Verify Deployment

```bash
# Check all pods are running
kubectl get pods -n video-recorder

# Expected output:
# NAME                                 READY   STATUS    RESTARTS   AGE
# video-recorder-xxxxxxxxxx-xxxxx      1/1     Running   0          1m
# cloudflare-tunnel-xxxxxxxxxx-xxxxx   1/1     Running   0          30s

# Check tunnel logs
kubectl logs -n video-recorder -l app=cloudflare-tunnel -f
```

## Step 4: Configure DNS (if using CLI method)

If you created the tunnel via CLI, add the DNS record:

```bash
# Add DNS record pointing to tunnel
cloudflared tunnel route dns video-recorder-tunnel recorder.yourdomain.com
```

Or in Cloudflare Dashboard:
1. Go to DNS settings for your domain
2. Add CNAME record:
   - Name: `recorder`
   - Target: `<TUNNEL_ID>.cfargotunnel.com`
   - Proxy: ON (orange cloud)

## Step 5: Access Your App

Open your browser and go to:
```
https://recorder.yourdomain.com
```

Your video recorder should now be accessible via HTTPS!

## Architecture

```
Browser → Cloudflare Edge → Cloudflare Tunnel → K8s Service → Pod
                                    ↓
                         cloudflared connector
                         (runs in your cluster)
```

## Troubleshooting

### Tunnel not connecting

```bash
# Check tunnel pod status
kubectl describe pod -n video-recorder -l app=cloudflare-tunnel

# Check tunnel logs
kubectl logs -n video-recorder -l app=cloudflare-tunnel

# Verify secret exists
kubectl get secret cloudflare-tunnel-token -n video-recorder
```

### 502 Bad Gateway

The service might not be reachable from the tunnel. Check:

```bash
# Verify service is running
kubectl get svc -n video-recorder

# Test internal connectivity
kubectl run test --rm -it --image=curlimages/curl -- \
  curl -v http://video-recorder.video-recorder.svc.cluster.local:80/healthz
```

### DNS not resolving

1. Ensure the CNAME record exists in Cloudflare DNS
2. Wait 1-5 minutes for DNS propagation
3. Try `nslookup recorder.yourdomain.com`

### Token issues

```bash
# Delete and recreate the secret
kubectl delete secret cloudflare-tunnel-token -n video-recorder
kubectl create secret generic cloudflare-tunnel-token \
  -n video-recorder \
  --from-literal=token=<NEW_TOKEN>

# Restart the tunnel deployment
kubectl rollout restart deployment/cloudflare-tunnel -n video-recorder
```

## Security Recommendations

### Add Cloudflare Access (Optional)

Protect your app with Zero Trust authentication:

1. Go to **Access** → **Applications** → **Add an application**
2. Select **Self-hosted**
3. Configure:
   - Name: `Video Recorder`
   - Domain: `recorder.yourdomain.com`
4. Add access policy (e.g., email domain, one-time pin, etc.)
5. Save

### Rate Limiting (Optional)

1. Go to **Security** → **WAF** → **Rate limiting rules**
2. Create rule for `recorder.yourdomain.com`
3. Set threshold (e.g., 100 requests per minute)

## Cleanup

To remove the Cloudflare Tunnel:

```bash
# Delete Kubernetes resources
kubectl delete -f k8s/cloudflare-tunnel.yaml
kubectl delete secret cloudflare-tunnel-token -n video-recorder

# Delete tunnel from Cloudflare (via dashboard or CLI)
cloudflared tunnel delete video-recorder-tunnel
```

## Quick Reference

| Component | Resource |
|-----------|----------|
| Tunnel Connector | `cloudflare/cloudflared:latest` |
| Memory | 64Mi-128Mi |
| CPU | 10m-100m |
| Port | Outbound 443 (HTTPS) |

## Comparison: Ingress vs Cloudflare Tunnel

| Feature | Traditional Ingress | Cloudflare Tunnel |
|---------|---------------------|-------------------|
| Public IP | Required | Not required |
| Port forwarding | Required | Not required |
| TLS certificates | cert-manager needed | Automatic |
| DDoS protection | Separate service | Included |
| Works behind NAT | No | Yes |
| Cost | Load balancer fees | Free |

## Next Steps

1. Test recording and downloading videos
2. Consider adding Cloudflare Access for authentication
3. Monitor tunnel health in Cloudflare Dashboard
4. Set up alerts for tunnel disconnections
