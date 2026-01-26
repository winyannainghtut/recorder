# GitHub Actions Setup Guide

This guide explains how to set up GitHub Actions for automatic Docker image building and pushing to Docker Hub.

## Workflow File

### Docker Build and Push (`.github/workflows/docker-push.yml`)

**Triggers:**
- Push to `main` branch
- Version tags (e.g., `v1.0.0`)
- Pull requests to `main`
- Manual trigger via UI

**Features:**
- Multi-platform builds (linux/amd64, linux/arm64)
- Automated tagging (latest, branch name, version tags)
- Docker Hub authentication
- Layer caching for faster builds
- Vulnerability scanning with Trivy
- Results uploaded to GitHub Security tab

## Required GitHub Secrets

### For Docker Hub (Required)

1. Go to your GitHub repository: `https://github.com/winyannainghtut/webrecorder/settings/secrets/actions`
2. Click "New repository secret"
3. Add these secrets:

| Secret Name | Value | Description |
|-------------|--------|-------------|
| `DOCKER_USERNAME` | Your Docker Hub username | Your Docker Hub account username |
| `DOCKER_PASSWORD` | Your Docker Hub password/token | Use access token, not password |

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

If your Docker Hub username is different, update `.github/workflows/docker-push.yml`:

```yaml
env:
  IMAGE_NAME: your-username/webrecorder  # Change this
```

## Usage

### Automatic Docker Build on Push

Every push to `main` triggers:
1. Build Docker image
2. Push to Docker Hub with tags: `latest`, `sha-<commit>`
3. Scan for vulnerabilities
4. Upload results to GitHub Security tab

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
- `winyannainghtut/webrecorder:1.0.0`
- `winyannainghtut/webrecorder:1.0`
- `winyannainghtut/webrecorder:1`
- `latest` (if pushing to main)

## Manual Deployment to Kubernetes

After the Docker image is built and pushed, you can manually deploy to your Kubernetes cluster:

```bash
# Pull the latest image
docker pull winyannainghtut/webrecorder:latest

# Update deployment to use new image
kubectl set image deployment/video-recorder \
  recorder=winyannainghtut/webrecorder:latest \
  -n video-recorder

# Verify the rollout
kubectl rollout status deployment/video-recorder -n video-recorder

# Check pods
kubectl get pods -n video-recorder -l app=video-recorder
```

Or apply manifests with updated image:
```bash
# Update image in k8s/deployment.yaml
sed -i 's|image: video-recorder:latest|image: winyannainghtut/webrecorder:latest|g' k8s/deployment.yaml

# Apply the updated deployment
kubectl apply -f k8s/deployment.yaml
```

## Customization

### Disable Multi-Platform Builds

To build only for linux/amd64, edit `.github/workflows/docker-push.yml`:

```yaml
- name: Build and push Docker image
  uses: docker/build-push-action@v5
  with:
    platforms: linux/amd64  # Remove linux/arm64
    # ... rest of config
```

### Disable Vulnerability Scanning

To skip Trivy scanning, remove these steps from `.github/workflows/docker-push.yml`:

```yaml
- name: Run Trivy vulnerability scanner
  # ... remove this step

- name: Upload Trivy results to GitHub Security tab
  # ... remove this step
```

### Add Notifications

Add Slack/Email notifications in `.github/workflows/docker-push.yml`:

```yaml
- name: Notify Slack on success
  if: success()
  uses: 8398a7/action-slack@v3
  with:
    status: ${{ job.status }}
    text: 'Docker image pushed successfully!'
    webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

### Build on Different Branches

To trigger builds on different branches, edit `.github/workflows/docker-push.yml`:

```yaml
on:
  push:
    branches:
      - main
      - develop
      - staging
```

## Troubleshooting

### Docker Hub Authentication Failed

**Error:** `unauthorized: authentication required`

**Solution:**
1. Verify `DOCKER_USERNAME` and `DOCKER_PASSWORD` secrets
2. Use access token instead of password
3. Check token has "Read & Write" permissions

### Build Timeout

**Error:** `The operation was canceled`

**Solution:**
1. Increase `timeout-minutes:` in workflow file
2. Check for resource limits
3. Verify network connectivity

### Vulnerability Scan Failed

**Error:** `Vulnerability scan failed`

**Solution:**
1. Check Trivy action version compatibility
2. Review scan logs in Actions tab
3. Update base image if vulnerabilities are critical

## Best Practices

1. **Use tags for releases**, not just `latest`
2. **Monitor build times** and optimize with caching
3. **Review security alerts** in GitHub Security tab
4. **Keep secrets updated** and rotate regularly
5. **Review workflow logs** for debugging
6. **Use semantic versioning** (v1.0.0, v1.1.0, etc.)
7. **Deploy to staging first** before production

## Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Docker Build Push Action](https://github.com/docker/build-push-action)
- [Trivy Scanner](https://aquasecurity.github.io/trivy/)
- [Docker Hub Access Tokens](https://docs.docker.com/security/for-developers/access-tokens/)
