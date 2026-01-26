# How to Use - Complete Setup Guide

This is a comprehensive step-by-step guide to set up the Screen Recorder application from scratch.

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Repository Setup](#2-repository-setup)
3. [GitHub Actions Setup](#3-github-actions-setup)
4. [Build and Push Docker Image](#4-build-and-push-docker-image)
5. [Kubernetes Secrets](#5-kubernetes-secrets)
6. [Deploy to Kubernetes](#6-deploy-to-kubernetes)
7. [Cloudflare Tunnel Setup](#7-cloudflare-tunnel-setup)
8. [Testing the Application](#8-testing-the-application)
9. [Updating the Application](#9-updating-the-application)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prerequisites

### Required Accounts

| Service | Purpose | Sign Up |
|---------|---------|---------|
| GitHub | Source code hosting & CI/CD | https://github.com |
| Docker Hub | Container registry | https://hub.docker.com |
| Cloudflare | Domain & tunnel | https://cloudflare.com |

### Required Tools

Install these on your local machine:

**Windows (PowerShell):**
```powershell
# Install kubectl (via winget)
winget install Kubernetes.kubectl

# Install Docker Desktop
winget install Docker.DockerDesktop

# Install Git
winget install Git.Git
```

**macOS:**
```bash
# Install Homebrew first if not installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install tools
brew install kubectl
brew install --cask docker
brew install git
```

**Linux (Ubuntu/Debian):**
```bash
# Install kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl

# Install Docker
sudo apt-get update
sudo apt-get install docker.io

# Install Git
sudo apt-get install git
```

### Kubernetes Cluster

You need a Kubernetes cluster. Options:

| Option | Best For | Setup |
|--------|----------|-------|
| Docker Desktop | Local development | Enable in Docker Desktop settings |
| minikube | Local development | `minikube start` |
| k3s | Lightweight production | https://k3s.io |
| Cloud (EKS/GKE/AKS) | Production | Follow cloud provider docs |

**Verify kubectl is configured:**
```bash
kubectl cluster-info
kubectl get nodes
```

---

## 2. Repository Setup

### 2.1 Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `recorder` (or your choice)
3. Set to **Private** (recommended)
4. Click "Create repository"

### 2.2 Create Docker Hub Repository

1. Go to https://hub.docker.com
2. Click "Create Repository"
3. Name: `recorder`
4. Visibility: **Private** (recommended)
5. Click "Create"

Your image will be: `yourusername/recorder`

### 2.3 Clone and Push Code

**Option A: Clone this repo and push to yours**
```bash
# Clone the source
git clone https://github.com/original/recorder.git
cd recorder

# Remove original remote
git remote remove origin

# Add your remote
git remote add origin https://github.com/YOUR_USERNAME/recorder.git

# Push to your repo
git branch -M main
git push -u origin main
```

**Option B: Download and initialize**
```bash
# Download code (zip) and extract
cd recorder

# Initialize git
git init
git add -A
git commit -m "Initial commit"

# Add remote and push
git remote add origin https://github.com/YOUR_USERNAME/recorder.git
git branch -M main
git push -u origin main
```

---

## 3. GitHub Actions Setup

### 3.1 Create Docker Hub Access Token

1. Go to https://hub.docker.com/settings/security
2. Click "New Access Token"
3. Description: `github-actions`
4. Permissions: **Read & Write**
5. Click "Generate"
6. **Copy the token immediately** (you won't see it again!)

### 3.2 Add GitHub Secrets

1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Click "New repository secret"
3. Add these secrets:

| Name | Value |
|------|-------|
| `DOCKER_USERNAME` | Your Docker Hub username |
| `DOCKER_PASSWORD` | The access token from step 3.1 |

### 3.3 Update Workflow File (if needed)

Edit `.github/workflows/docker-push.yml` and update the image name:

```yaml
env:
  IMAGE_NAME: YOUR_DOCKERHUB_USERNAME/recorder  # Change this!
```

---

## 4. Build and Push Docker Image

### 4.1 Automatic Build (via GitHub Actions)

Every push to `main` triggers a build:

```bash
# Make a change (or just push)
git add -A
git commit -m "Trigger build"
git push origin main
```

**Monitor the build:**
1. Go to your GitHub repo → **Actions** tab
2. Click on the running workflow
3. Wait for it to turn green ✓

### 4.2 Manual Build (Local)

For local testing before pushing:

```bash
# Build the image
docker build -t recorder:test .

# Run locally
docker run -p 8080:8080 recorder:test

# Test at http://localhost:8080
```

### 4.3 Verify Image on Docker Hub

1. Go to https://hub.docker.com/r/YOUR_USERNAME/recorder/tags
2. You should see tags: `latest`, `main`, and a commit SHA

---

## 5. Kubernetes Secrets

### 5.1 Create Namespace First

```bash
kubectl apply -f k8s/namespace.yaml
```

Or manually:
```bash
kubectl create namespace video-recorder
```

### 5.2 Create Authentication Secret

This secret stores the login password for the web interface.

**PowerShell (Windows):**
```powershell
kubectl create secret generic recorder-auth `
  -n video-recorder `
  --from-literal=login-password=YourSecurePassword123!
```

**Bash (Linux/Mac):**
```bash
kubectl create secret generic recorder-auth \
  -n video-recorder \
  --from-literal=login-password=YourSecurePassword123!
```

**Verify:**
```bash
kubectl get secret recorder-auth -n video-recorder
```

### 5.3 Create Cloudflare Tunnel Secret

You'll get the token from Cloudflare (see Section 7).

**PowerShell (Windows):**
```powershell
kubectl create secret generic cloudflare-tunnel-token `
  -n video-recorder `
  --from-literal=token=YOUR_CLOUDFLARE_TUNNEL_TOKEN
```

**Bash (Linux/Mac):**
```bash
kubectl create secret generic cloudflare-tunnel-token \
  -n video-recorder \
  --from-literal=token=YOUR_CLOUDFLARE_TUNNEL_TOKEN
```

### 5.4 View/Update Secrets

**View secret (base64 encoded):**
```bash
kubectl get secret recorder-auth -n video-recorder -o yaml
```

**Decode a value:**
```bash
# Linux/Mac
kubectl get secret recorder-auth -n video-recorder -o jsonpath='{.data.login-password}' | base64 -d

# PowerShell
[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($(kubectl get secret recorder-auth -n video-recorder -o jsonpath='{.data.login-password}')))
```

**Delete and recreate to change password:**
```bash
kubectl delete secret recorder-auth -n video-recorder
kubectl create secret generic recorder-auth -n video-recorder --from-literal=login-password=NewPassword123!
kubectl rollout restart deployment/video-recorder -n video-recorder
```

---

## 6. Deploy to Kubernetes

### 6.1 Update Deployment Image

Edit `k8s/deployment.yaml` and ensure the image matches your Docker Hub repo:

```yaml
containers:
- name: recorder
  image: YOUR_DOCKERHUB_USERNAME/recorder:latest  # Change this!
```

### 6.2 Deploy All Resources

```bash
# Create namespace (if not done)
kubectl apply -f k8s/namespace.yaml

# Deploy application
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml

# Deploy Cloudflare tunnel (after setting up tunnel - see Section 7)
kubectl apply -f k8s/cloudflare-tunnel.yaml
```

### 6.3 Verify Deployment

```bash
# Check all resources
kubectl get all -n video-recorder

# Expected output:
# NAME                                  READY   STATUS    RESTARTS   AGE
# pod/video-recorder-xxxxx-xxxxx        1/1     Running   0          1m
# pod/cloudflare-tunnel-xxxxx-xxxxx     1/1     Running   0          1m
#
# NAME                     TYPE        CLUSTER-IP      PORT(S)    AGE
# service/video-recorder   ClusterIP   10.96.x.x       8080/TCP   1m
```

**Check logs:**
```bash
# Application logs
kubectl logs -n video-recorder -l app=video-recorder -f

# Expected: "Starting server on :8080"
# Expected: "Authentication enabled"
```

---

## 7. Cloudflare Tunnel Setup

### 7.1 Add Domain to Cloudflare

1. Go to https://dash.cloudflare.com
2. Click "Add a Site"
3. Enter your domain name
4. Follow the instructions to update nameservers

### 7.2 Create Tunnel

1. Go to https://one.dash.cloudflare.com (Zero Trust dashboard)
2. Navigate to **Access** → **Tunnels**
3. Click "Create a tunnel"
4. Name: `recorder-tunnel`
5. Click "Save tunnel"
6. **Copy the tunnel token** (looks like: `eyJhIjoiNjk...`)
7. Skip the connector installation (we do it in K8s)

### 7.3 Configure Public Hostname

In the tunnel configuration:

1. Click on your tunnel → **Public Hostname** tab
2. Click "Add a public hostname"
3. Fill in:
   - **Subdomain**: `recorder` (or your choice)
   - **Domain**: Select your domain
   - **Service Type**: `HTTP`
   - **URL**: `video-recorder:8080`
4. Click "Save hostname"

### 7.4 Create Tunnel Secret in Kubernetes

**PowerShell (Windows):**
```powershell
kubectl create secret generic cloudflare-tunnel-token `
  -n video-recorder `
  --from-literal=token=eyJhIjoiNjk...YOUR_FULL_TOKEN_HERE
```

**Bash (Linux/Mac):**
```bash
kubectl create secret generic cloudflare-tunnel-token \
  -n video-recorder \
  --from-literal=token=eyJhIjoiNjk...YOUR_FULL_TOKEN_HERE
```

### 7.5 Deploy Tunnel Connector

```bash
kubectl apply -f k8s/cloudflare-tunnel.yaml
```

### 7.6 Verify Tunnel

```bash
# Check tunnel pod
kubectl get pods -n video-recorder -l app=cloudflare-tunnel

# Check tunnel logs
kubectl logs -n video-recorder -l app=cloudflare-tunnel

# Expected: "Connection registered" messages
```

In Cloudflare dashboard, the tunnel status should show "Healthy".

---

## 8. Testing the Application

### 8.1 Access the Application

Open your browser and go to:
```
https://recorder.yourdomain.com
```

### 8.2 Test Login

1. You should see the login page
2. Enter the password you set in the `recorder-auth` secret
3. Click "Sign In"
4. You should be redirected to the main recorder page

### 8.3 Test Recording

1. Click "Start Recording"
2. Select what to share (screen, window, or tab)
3. Record for a few seconds
4. Click "Stop Recording"
5. Preview the recording
6. Click "Upload for Download"
7. Click "Download Video"
8. Verify the file downloads correctly

### 8.4 Test API Endpoints

**Health check:**
```bash
curl https://recorder.yourdomain.com/healthz
# Expected: OK
```

**Login (get session cookie):**
```bash
curl -X POST https://recorder.yourdomain.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"YourPassword"}' \
  -c cookies.txt

# Expected: {"success":true}
```

### 8.5 Local Testing (without Cloudflare)

For quick local testing:

```bash
# Port forward the service
kubectl port-forward svc/video-recorder -n video-recorder 8080:8080

# Access at http://localhost:8080
```

Note: Screen recording requires HTTPS, so some features won't work locally.

---

## 9. Updating the Application

### 9.1 Make Code Changes

```bash
# Edit files...
# Then commit and push
git add -A
git commit -m "Your change description"
git push origin main
```

### 9.2 Wait for Build

1. Go to GitHub → Actions
2. Wait for the build to complete (green checkmark)

### 9.3 Deploy Update

```bash
# Restart deployment to pull new image
kubectl rollout restart deployment/video-recorder -n video-recorder

# Watch the rollout
kubectl rollout status deployment/video-recorder -n video-recorder

# Verify new pod is running
kubectl get pods -n video-recorder -l app=video-recorder
```

### 9.4 Clear Caches (if needed)

If you see old content:

1. **Hard refresh browser**: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
2. **Use incognito window**
3. **Purge Cloudflare cache**: Dashboard → Caching → Purge Everything

### 9.5 Rollback if Needed

```bash
# Rollback to previous version
kubectl rollout undo deployment/video-recorder -n video-recorder

# Check rollback status
kubectl rollout status deployment/video-recorder -n video-recorder
```

---

## 10. Troubleshooting

### Pod Won't Start

```bash
# Describe pod for events
kubectl describe pod -n video-recorder -l app=video-recorder

# Check logs
kubectl logs -n video-recorder -l app=video-recorder
```

**Common issues:**

| Error | Cause | Fix |
|-------|-------|-----|
| `ImagePullBackOff` | Can't pull image | Check image name in deployment.yaml |
| `ErrImagePull` | Auth failed | Verify Docker Hub image is public or add imagePullSecrets |
| `CrashLoopBackOff` | App crashing | Check logs for errors |
| `CreateContainerConfigError` | Missing secret | Create the `recorder-auth` secret |

### Login Not Working

1. **Check secret exists:**
   ```bash
   kubectl get secret recorder-auth -n video-recorder
   ```

2. **Check password value:**
   ```bash
   kubectl get secret recorder-auth -n video-recorder -o jsonpath='{.data.login-password}' | base64 -d
   ```

3. **Check app logs:**
   ```bash
   kubectl logs -n video-recorder -l app=video-recorder | grep -i auth
   ```

### Tunnel Not Connecting

```bash
# Check tunnel logs
kubectl logs -n video-recorder -l app=cloudflare-tunnel

# Check secret exists
kubectl get secret cloudflare-tunnel-token -n video-recorder
```

**Common tunnel errors:**

| Error | Fix |
|-------|-----|
| `failed to parse token` | Token is incorrect or malformed |
| `connection refused` | App service not running |
| `no more connections` | Token expired or invalid |

### Old Code Still Showing

1. **Check which image is running:**
   ```bash
   kubectl get pod -n video-recorder -l app=video-recorder -o jsonpath='{.items[0].spec.containers[0].image}'
   ```

2. **Force pull new image:**
   ```bash
   kubectl delete pod -n video-recorder -l app=video-recorder
   ```

3. **Check app.js version in browser:**
   - Open DevTools (F12)
   - Network tab
   - Refresh
   - Look for `app.js?v=3.0.0`

4. **Purge Cloudflare cache:**
   - Cloudflare Dashboard → Your site → Caching → Purge Everything

### Recording Doesn't Work

1. **Check HTTPS**: Screen recording only works on HTTPS
2. **Check browser console**: F12 → Console tab for errors
3. **Try different browser**: Chrome has best support
4. **Check permissions**: Browser may have blocked screen sharing

---

## Quick Reference Commands

### Kubernetes

```bash
# Get all resources
kubectl get all -n video-recorder

# View logs (follow)
kubectl logs -n video-recorder -l app=video-recorder -f

# Restart deployment
kubectl rollout restart deployment/video-recorder -n video-recorder

# Delete and recreate pod
kubectl delete pod -n video-recorder -l app=video-recorder

# Port forward for local access
kubectl port-forward svc/video-recorder -n video-recorder 8080:8080

# Delete everything
kubectl delete namespace video-recorder
```

### Secrets

```bash
# List secrets
kubectl get secrets -n video-recorder

# Create secret
kubectl create secret generic SECRET_NAME -n video-recorder --from-literal=key=value

# Delete secret
kubectl delete secret SECRET_NAME -n video-recorder
```

### Git/GitHub

```bash
# Push changes
git add -A && git commit -m "message" && git push

# Check remote
git remote -v

# View commit history
git log --oneline -5
```

### Docker

```bash
# Build locally
docker build -t recorder:test .

# Run locally
docker run -p 8080:8080 -e LOGIN_PASSWORD=test123 recorder:test

# Check image
docker images | grep recorder
```

---

## Support

If you encounter issues:

1. Check the [Troubleshooting](#10-troubleshooting) section
2. Review logs with `kubectl logs`
3. Check GitHub Actions for build errors
4. Verify secrets are created correctly
5. Check Cloudflare tunnel status in dashboard

---

**Happy Recording!** 🎬
