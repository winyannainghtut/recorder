// Screen Recorder Configuration
// Version: 3.1 - SCREEN RECORDING WITH DIRECT DOWNLOAD OPTION
// UNIQUE_MARKER_2026_01_26_SCREEN_RECORD
const MAX_RECORDING_DURATION = 3 * 60 * 60 * 1000; // 3 hours
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
const UPLOAD_URL = '/upload';
const API_BASE = window.location.origin;

// State
let mediaRecorder = null;
let recordedChunks = [];
let startTime = null;
let timerInterval = null;
let currentBlob = null;
let downloadToken = null;
let state = 'idle'; // idle, recording, stopped, uploading, ready, expired

// Elements
const liveVideo = document.getElementById('liveVideo');
const recordedVideo = document.getElementById('recordedVideo');
const idleControls = document.getElementById('idleControls');
const recordingControls = document.getElementById('recordingControls');
const previewControls = document.getElementById('previewControls');
const uploadingControls = document.getElementById('uploadingControls');
const downloadControls = document.getElementById('downloadControls');
const expiredControls = document.getElementById('expiredControls');
const timerDisplay = document.getElementById('timerDisplay');
const message = document.getElementById('message');
const downloadLink = document.getElementById('downloadLink');

// Show message
function showMessage(text, type = 'info') {
    message.textContent = text;
    message.className = `message ${type}`;
    setTimeout(() => {
        message.classList.add('hidden');
    }, 5000);
}

// Update UI state
function setState(newState) {
    state = newState;
    idleControls.classList.add('hidden');
    recordingControls.classList.add('hidden');
    previewControls.classList.add('hidden');
    uploadingControls.classList.add('hidden');
    downloadControls.classList.add('hidden');
    expiredControls.classList.add('hidden');

    switch (newState) {
        case 'idle':
            idleControls.classList.remove('hidden');
            liveVideo.style.display = 'block';
            recordedVideo.style.display = 'none';
            break;
        case 'recording':
            recordingControls.classList.remove('hidden');
            break;
        case 'stopped':
            previewControls.classList.remove('hidden');
            break;
        case 'uploading':
            uploadingControls.classList.remove('hidden');
            break;
        case 'ready':
            downloadControls.classList.remove('hidden');
            break;
        case 'expired':
            expiredControls.classList.remove('hidden');
            break;
    }
}

// Format time
function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Start recording
async function startRecording() {
    try {
        // Request screen capture with audio
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                displaySurface: 'monitor',
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 }
            },
            audio: true  // Capture system audio if supported
        });

        // Try to get microphone audio separately for better compatibility
        let audioStream = null;
        try {
            audioStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false
            });
        } catch (audioError) {
            console.log('Microphone not available, using display audio only');
        }

        // Combine streams if we have both
        let combinedStream;
        if (audioStream) {
            const audioTracks = audioStream.getAudioTracks();
            const displayAudioTracks = displayStream.getAudioTracks();
            combinedStream = new MediaStream([
                ...displayStream.getVideoTracks(),
                ...displayAudioTracks,
                ...audioTracks
            ]);
        } else {
            combinedStream = displayStream;
        }

        liveVideo.srcObject = combinedStream;

        // Handle when user stops sharing via browser UI
        displayStream.getVideoTracks()[0].onended = () => {
            if (state === 'recording') {
                stopRecording();
                showMessage('Screen sharing stopped', 'info');
            }
        };

        recordedChunks = [];
        mediaRecorder = new MediaRecorder(combinedStream, {
            mimeType: 'video/webm;codecs=vp9'
        });

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });

            // Check file size
            if (blob.size > MAX_FILE_SIZE) {
                showMessage(`Recording too large (${formatBytes(blob.size)}). Max: ${formatBytes(MAX_FILE_SIZE)}`, 'error');
                stopStream();
                setState('idle');
                return;
            }

            currentBlob = blob;
            recordedVideo.src = URL.createObjectURL(blob);
            liveVideo.style.display = 'none';
            recordedVideo.style.display = 'block';
            
            // Show file size
            const fileSizeDisplay = document.getElementById('fileSizeDisplay');
            if (fileSizeDisplay) {
                fileSizeDisplay.textContent = `Recording size: ${formatBytes(blob.size)}`;
            }
            
            setState('stopped');
            stopStream();
        };

        mediaRecorder.start(1000); // Collect chunks every second
        startTime = Date.now();
        timerInterval = setInterval(updateTimer, 1000);
        updateTimer();
        setState('recording');

        // Auto-stop after max duration
        setTimeout(() => {
            if (state === 'recording') {
                stopRecording();
                showMessage('Maximum recording duration reached', 'info');
            }
        }, MAX_RECORDING_DURATION);

    } catch (error) {
        console.error('Error starting recording:', error);
        if (error.name === 'NotAllowedError') {
            showMessage('Screen sharing was cancelled or denied.', 'error');
        } else {
            showMessage('Failed to start screen recording. Please try again.', 'error');
        }
    }
}

// Stop recording
function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    clearInterval(timerInterval);
}

// Stop media stream
function stopStream() {
    if (liveVideo.srcObject) {
        liveVideo.srcObject.getTracks().forEach(track => track.stop());
        liveVideo.srcObject = null;
    }
}

// Update timer
function updateTimer() {
    const elapsed = Date.now() - startTime;
    timerDisplay.textContent = formatTime(elapsed);
}

// Format bytes
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Direct download (no server upload)
function directDownload() {
    if (!currentBlob) {
        showMessage('No recording to download', 'error');
        return;
    }

    // Create download link
    const url = URL.createObjectURL(currentBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recording_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // Clean up the URL after a short delay
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    
    showMessage('Download started!', 'success');
}

// Upload recording
async function uploadRecording() {
    if (!currentBlob) {
        showMessage('No recording to upload', 'error');
        return;
    }

    setState('uploading');

    try {
        const formData = new FormData();
        formData.append('video', currentBlob, 'recording.webm');

        const response = await fetch(UPLOAD_URL, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Upload failed');
        }

        const data = await response.json();
        downloadToken = data.token;
        downloadLink.href = `/download/${downloadToken}`;
        showMessage('Upload successful! Download ready.', 'success');
        setState('ready');

    } catch (error) {
        console.error('Upload error:', error);
        showMessage(`Upload failed: ${error.message}`, 'error');
        setState('stopped');
    }
}

// Delete recording
function deleteRecording() {
    currentBlob = null;
    recordedChunks = [];
    recordedVideo.src = '';
    downloadToken = null;
    showMessage('Recording deleted', 'info');
    setState('expired');
}

// Reset
function reset() {
    currentBlob = null;
    recordedChunks = [];
    recordedVideo.src = '';
    downloadToken = null;
    liveVideo.style.display = 'block';
    recordedVideo.style.display = 'none';
    setState('idle');
}

// Event listeners
document.getElementById('startBtn').addEventListener('click', startRecording);
document.getElementById('stopBtn').addEventListener('click', stopRecording);
document.getElementById('recordAgainBtn').addEventListener('click', () => {
    currentBlob = null;
    recordedChunks = [];
    recordedVideo.src = '';
    liveVideo.style.display = 'block';
    recordedVideo.style.display = 'none';
    setState('idle');
});
document.getElementById('directDownloadBtn').addEventListener('click', directDownload);
document.getElementById('uploadBtn').addEventListener('click', uploadRecording);
document.getElementById('deleteBtn').addEventListener('click', deleteRecording);
document.getElementById('resetBtn').addEventListener('click', reset);

// Initialize
setState('idle');
