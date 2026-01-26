# GitHub Actions Setup Guide

This guide explains how to set up GitHub Actions for automatic Docker image building and pushing to Docker Hub.

## Workflow Overview

### Docker Build and Push (`.github/workflows/docker-push.yml`)

**Triggers:**
- Push to `main` branch
- Version tags (e.g., `v1.0.0`)
- Pull requests to `main`
- Manual trigger via UI

**Features:**
- Single platform build (linux/amd64)
- Automated tagging (latest, branch name, commit SHA)
- Docker Hub authentication
- Cache-busting for fresh builds
- Source code verification step

## Required GitHub Secrets

### For Docker Hub (Required)

1. Go to your GitHub repository: `https://github.com/<your-username>/recorder/settings/secrets/actions`
2. Click "New repository secret"
3. Add these secrets:

| Secret Name | Value | Description |
|-------------|--------|-------------|
| `DOCKER_USERNAME` | Your Docker Hub username | Your Docker Hub account username |
| `DOCKER_PASSWORD` | Your Docker Hub password/token | Use access token (recommended) |

**How to create Docker Hub access token:**
1. Log in to https://hub.docker.com
2. Go to Account Settings → Security
3. Click "New Access Token"
4. Give it a name (e.g., "github-actions")
5. Select "Read & Write" permissions
6. Copy token
7. Add it as `DOCKER_PASSWORD` secret

## Configuration

### Update Image Name

Update `.github/workflows/docker-push.yml` with your Docker Hub username:

```yaml
env:
  IMAGE_NAME: your-username/recorder  # Change this
```

## Usage

### Automatic Docker Build on Push

Every push to `main` triggers:
1. Checkout code
2. Verify source code contains screen recording logic
3. Build Docker image (linux/amd64)
4. Push to Docker Hub with tags: `latest`, `main`, commit SHA

### Manual Build

1. Go to Actions tab in GitHub
2. Select "Build and Push Docker Image"
3. Click "Run workflow"
4. Choose branch
5. Click "Run workflow"

### Versioned Releases

```bash
# Tag and push
git tag v1.0.0
git push origin v1.0.0
```

This creates tags:
- `your-username/recorder:1.0.0`
- `your-username/recorder:1.0`
- `your-username/recorder:1`
- `your-username/recorder:latest`

## Deploying After Build

After the Docker image is built and pushed:

```bash
# Option 1: Restart deployment to pull new image
kubectl rollout restart deployment/video-recorder -n video-recorder

# Option 2: Delete pods to force new pull
kubectl delete pod -n video-recorder -l app=video-recorder

# Verify the rollout
kubectl rollout status deployment/video-recorder -n video-recorder

# Check pods
kubectl get pods -n video-recorder -l app=video-recorder
```

## Important: Cache Control

The application includes cache-busting to prevent CDN (Cloudflare) from serving stale files:

1. **Version strings in HTML**: `app.js?v=3.0.0`
2. **No-cache headers**: Set by Go backend for JS/CSS files
3. **Fresh builds**: Workflow uses `no-cache: true` and `pull: true`

If you see old code being served:
1. Hard refresh browser (`Ctrl+Shift+R`)
2. Use incognito window
3. Check if K8s is running latest image
4. Purge Cloudflare cache if needed

## Troubleshooting

### Docker Hub Authentication Failed

**Error:** `unauthorized: authentication required`

**Solution:**
1. Verify `DOCKER_USERNAME` and `DOCKER_PASSWORD` secrets
2. Use access token instead of password
3. Check token has "Read & Write" permissions

### Build Failed

**Error:** Various build errors

**Solution:**
1. Check the "Verify source code" step output in Actions
2. Ensure `frontend/app.js` contains `getDisplayMedia`
3. Review Dockerfile for syntax errors
4. Check Go code compiles: `go build ./backend/main.go`

### Old Code Still Being Served

After successful build and deployment:

1. **Check browser network tab** - should see `app.js?v=3.0.0`
2. **Hard refresh**: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
3. **Verify pod is updated**:
   ```bash
   kubectl describe pod -n video-recorder -l app=video-recorder | grep Image
   ```
4. **Purge Cloudflare cache** if needed

### Workflow Not Triggering

**Solution:**
1. Ensure workflow file is in `.github/workflows/`
2. Check branch protection rules
3. Verify the push is to `main` branch

## Workflow File Details

Key sections of `.github/workflows/docker-push.yml`:

```yaml
# Triggers
on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:
    branches: [main]
  workflow_dispatch:

# Build settings
- name: Build and push Docker image
  uses: docker/build-push-action@v5
  with:
    context: .
    push: ${{ github.event_name != 'pull_request' }}
    tags: ${{ steps.meta.outputs.tags }}
    no-cache: true        # Force fresh build
    pull: true            # Pull latest base images
```

## Best Practices

1. **Use tags for releases**, not just `latest`
2. **Monitor build times** in Actions tab
3. **Keep secrets updated** and rotate regularly
4. **Review workflow logs** for debugging
5. **Use semantic versioning** (v1.0.0, v1.1.0, etc.)
6. **Test locally** before pushing:
   ```bash
   docker build -t recorder:test .
   docker run -p 8080:8080 recorder:test
   ```

## Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Docker Build Push Action](https://github.com/docker/build-push-action)
- [Docker Hub Access Tokens](https://docs.docker.com/security/for-developers/access-tokens/)
