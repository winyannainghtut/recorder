# Cloudflare Tunnel Setup Guide

This guide explains how to expose your screen recorder app using Cloudflare Tunnel on your local Kubernetes cluster.

## Why Cloudflare Tunnel?

- **No public IP required** - Works behind NAT/firewall
- **No port forwarding** - Cloudflare handles ingress
- **Free TLS certificates** - Automatic HTTPS
- **DDoS protection** - Included with Cloudflare
- **Zero Trust security** - Optional access policies
- **Easy setup** - No Ingress controller or cert-manager needed

## Prerequisites

1. Cloudflare account (free tier works)
2. Domain managed by Cloudflare (or add your domain to Cloudflare)
3. kubectl configured for your cluster

## Step 1: Create Cloudflare Tunnel

### Option A: Via Cloudflare Dashboard (Recommended)

1. Go to [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/)
2. Navigate to **Access** → **Tunnels**
3. Click **Create a tunnel**
4. Name it: `recorder-tunnel`
5. Click **Save tunnel**
6. **Copy the tunnel token** (you'll need this)
7. Skip the connector installation (we'll do it in K8s)
8. Configure public hostname:
   - **Subdomain**: `recorder` (or your choice)
   - **Domain**: Select your domain
   - **Service**: `http://video-recorder:8080`
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

**PowerShell (Windows):**
```powershell
kubectl create secret generic cloudflare-tunnel-token `
  -n video-recorder `
  --from-literal=token=<YOUR_TUNNEL_TOKEN>
```

**Bash (Linux/Mac):**
```bash
kubectl create secret generic cloudflare-tunnel-token \
  -n video-recorder \
  --from-literal=token=<YOUR_TUNNEL_TOKEN>
```

### 2.3 Create the authentication secret

```powershell
# PowerShell (Windows)
kubectl create secret generic recorder-auth `
  -n video-recorder `
  --from-literal=login-password=YourSecurePassword
```

```bash
# Bash (Linux/Mac)
kubectl create secret generic recorder-auth \
  -n video-recorder \
  --from-literal=login-password=YourSecurePassword
```

### 2.4 Deploy the screen recorder app

```bash
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

### 2.5 Deploy Cloudflare Tunnel connector

```bash
kubectl apply -f k8s/cloudflare-tunnel.yaml
```

**Important:** The tunnel connector includes `--metrics 0.0.0.0:2000` for health probes. This is required for Kubernetes to properly monitor the tunnel pod.

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

You'll be redirected to a **login page**. Enter the password you configured in the `recorder-auth` secret.

After successful login, you'll have access to the screen recorder for 24 hours.

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

# Verify app pod is running
kubectl get pods -n video-recorder -l app=video-recorder

# Test the service endpoint
kubectl port-forward svc/video-recorder -n video-recorder 8080:8080
# Then visit http://localhost:8080 in your browser
```

### Tunnel Pod Not Ready (0/1)

If the tunnel pod shows `0/1 Ready`:

```bash
# Check tunnel logs for errors
kubectl logs -n video-recorder -l app=cloudflare-tunnel

# Ensure the metrics endpoint is enabled (required for health probes)
# The args should include: --metrics 0.0.0.0:2000

# Restart the tunnel
kubectl rollout restart deployment/cloudflare-tunnel -n video-recorder
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

## CDN Caching Notes

Cloudflare may cache static files. The application includes cache-control headers to prevent this:

- **JS/CSS files**: `Cache-Control: no-cache, no-store, must-revalidate`
- **HTML files**: `Cache-Control: no-cache, must-revalidate`
- **Cache-busting**: Static files use version strings (`app.js?v=3.0.0`)

If you experience issues with old code being served after updates:

1. **Hard refresh**: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
2. **Use incognito window** to bypass browser cache
3. **Purge Cloudflare cache**: Dashboard → Caching → Purge Everything

## Next Steps

1. Test screen recording and downloading
2. Consider adding Cloudflare Access for authentication
3. Monitor tunnel health in Cloudflare Dashboard
4. Set up alerts for tunnel disconnections
