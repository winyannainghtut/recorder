# Screen Recorder - Kubernetes Web App

A lightweight screen recording web app for Kubernetes. It records in the browser, mixes microphone audio with computer/display audio when the browser exposes it, and lets the user download the recording directly. Recordings are not uploaded to or stored by the server.

## Features

- Browser-based screen capture with `getDisplayMedia`
- Screen, window, or browser tab recording
- Microphone plus computer/display audio mixed into one recorder audio track
- Direct local WebM download only
- Password-protected access with secure session cookies
- No database, PVC, upload endpoint, or server-side video storage
- Lightweight Go backend for auth, health checks, and static files
- CDN-safe cache control headers for frontend assets

## Quick Start

```bash
# Create namespace
kubectl apply -f k8s/namespace.yaml

# Create login password
kubectl create secret generic recorder-auth -n video-recorder --from-literal=login-password=YourPassword

# Deploy app
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml

# Deploy Cloudflare Tunnel after creating its token secret
kubectl apply -f k8s/cloudflare-tunnel.yaml
```

## User Flow

1. Open the app URL.
2. Sign in with the configured password.
3. Click **Start Recording**.
4. Choose the screen, window, or tab to share.
5. Enable system/tab audio in the browser picker when available.
6. Allow microphone access when prompted.
7. Stop recording, preview the result, and click **Download Now**.

## Audio Notes

The frontend requests display audio and microphone audio separately. If either source is available, the app creates a Web Audio graph and mixes all available audio sources into a single `MediaStreamAudioDestinationNode`. `MediaRecorder` then receives the display video track plus one combined audio track.

Computer audio support is browser and operating-system dependent. Chromium-based browsers usually provide the best support, and the user may need to select a tab or source with an audio sharing checkbox.

## API Endpoints

- `GET /` - Main recorder app, redirects to `/login` if unauthenticated
- `GET /login` - Login page
- `POST /auth/login` - Creates a secure session cookie
- `GET /auth/logout` - Clears the session and redirects to login
- `GET /healthz` - Kubernetes health check

There are intentionally no video upload or download-link endpoints.

## Configuration

| Setting | Value | Location |
| --- | --- | --- |
| Max recording duration | 3 hours | `frontend/app.js` |
| Max file size | 2 GB | `frontend/app.js` |
| Login password | `LOGIN_PASSWORD` env var | `k8s/deployment.yaml` |

If `LOGIN_PASSWORD` is empty, authentication is disabled.

## Deployment

The Docker image builds a static Go binary and serves the frontend from `/app/frontend`. The Kubernetes deployment runs as non-root, drops Linux capabilities, and uses a read-only root filesystem because videos are no longer written to the pod.

Cloudflare Tunnel can expose the `video-recorder` service without an ingress controller. See `CLOUDFLARE_TUNNEL_SETUP.md` for tunnel setup.

## Browser Support

| Browser | System audio | Notes |
| --- | --- | --- |
| Chrome / Edge | Best support | Use tab/window/screen picker audio option when shown |
| Firefox | Limited | System audio support varies |
| Safari | Limited / none | Screen capture support exists, system audio is limited |

Screen recording APIs require HTTPS outside localhost.
