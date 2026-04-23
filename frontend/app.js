// Screen Recorder Configuration
// Version: 3.2 - WITH WEBM DURATION FIX FOR SEEKABLE PLAYBACK
// UNIQUE_MARKER_2026_01_26_SCREEN_RECORD
const MAX_RECORDING_DURATION = 3 * 60 * 60 * 1000; // 3 hours
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

// ============================================================
// WebM Duration Fix - Makes recordings seekable in VLC/players
// ============================================================

/**
 * Fix WebM blob to include proper duration metadata
 * This makes the file seekable in video players like VLC
 * @param {Blob} blob - The WebM blob from MediaRecorder
 * @param {number} duration - Duration in milliseconds
 * @returns {Promise<Blob>} - Fixed WebM blob with duration metadata
 */
async function fixWebmDuration(blob, duration) {
    try {
        const buffer = await blob.arrayBuffer();
        
        // Find the Segment element and inject duration
        const fixedBuffer = injectDuration(buffer, duration);
        
        if (fixedBuffer) {
            return new Blob([fixedBuffer], { type: 'video/webm' });
        }
    } catch (error) {
        console.warn('Could not fix WebM duration, using original:', error);
    }
    return blob; // Return original if fix fails
}

/**
 * Inject duration into WebM buffer
 */
function injectDuration(buffer, durationMs) {
    const bytes = new Uint8Array(buffer);
    const durationNs = durationMs * 1000000;
    
    // Find the Info element (0x1549A966) which contains Duration
    const infoElementId = [0x15, 0x49, 0xA9, 0x66];
    let infoPos = findElement(bytes, infoElementId, 0);
    
    if (infoPos === -1) {
        console.warn('Could not find Info element in WebM');
        return null;
    }
    
    // Find Duration element (0x4489) within Info, or find where to insert it
    const durationElementId = [0x44, 0x89];
    
    // Skip the Info element ID and size to get to its contents
    let pos = infoPos + 4; // Skip element ID
    const infoSize = readVint(bytes, pos);
    pos += infoSize.length;
    const infoContentStart = pos;
    const infoContentEnd = pos + infoSize.value;
    
    // Look for existing TimecodeScale (TimestampScale) to compute duration in ticks
    const timecodeScaleElementId = [0x2A, 0xD7, 0xB1];
    let timecodeScale = 1000000;
    const timecodeScalePos = findElement(bytes, timecodeScaleElementId, infoContentStart, infoContentEnd);
    if (timecodeScalePos !== -1) {
        let tPos = timecodeScalePos + 3; // Skip element ID
        const tSize = readVint(bytes, tPos);
        tPos += tSize.length;
        timecodeScale = readUint(bytes, tPos, tSize.value);
    }

    const durationTicks = durationNs / timecodeScale;

    // Look for existing Duration element
    let durationPos = findElement(bytes, durationElementId, infoContentStart, infoContentEnd);
    
    if (durationPos !== -1) {
        // Duration exists, update it in-place when possible
        let dPos = durationPos + 2; // Skip element ID
        const dSize = readVint(bytes, dPos);
        dPos += dSize.length;

        if (dSize.value === 8) {
            // Write the new duration as float64
            const durationFloat = new Float64Array([durationTicks]);
            const durationBytes = new Uint8Array(durationFloat.buffer);
            for (let i = 0; i < 8; i++) {
                bytes[dPos + i] = durationBytes[7 - i];
            }
            return bytes.buffer;
        }

        if (dSize.value === 4) {
            // Write the new duration as float32
            const durationFloat = new Float32Array([durationTicks]);
            const durationBytes = new Uint8Array(durationFloat.buffer);
            for (let i = 0; i < 4; i++) {
                bytes[dPos + i] = durationBytes[3 - i];
            }
            return bytes.buffer;
        }

        // Fallback: treat as missing and insert a new 8-byte duration element
        durationPos = -1;
    }
    
    // Duration doesn't exist, we need to insert it
    // This is more complex as it requires adjusting sizes
    // For simplicity, we'll create a new buffer with the duration inserted
    
    // Create duration element: ID (2 bytes) + Size (1 byte) + Float64 (8 bytes) = 11 bytes
    const durationElement = new Uint8Array(11);
    durationElement[0] = 0x44; // Duration element ID
    durationElement[1] = 0x89;
    durationElement[2] = 0x88; // Size: 8 bytes (VINT)
    
    // Float64 big-endian
    const durationFloat = new Float64Array([durationTicks]);
    const durationBytes = new Uint8Array(durationFloat.buffer);
    for (let i = 0; i < 8; i++) {
        durationElement[3 + i] = durationBytes[7 - i];
    }
    
    // Insert duration element at the start of Info content
    const newBuffer = new Uint8Array(bytes.length + 11);
    
    // Copy everything before Info content
    newBuffer.set(bytes.slice(0, infoContentStart), 0);
    
    // Insert duration element
    newBuffer.set(durationElement, infoContentStart);
    
    // Copy rest of the file
    newBuffer.set(bytes.slice(infoContentStart), infoContentStart + 11);
    
    // Update Info element size
    // This is tricky because VINT sizes can change length
    // For now, we'll try a simple approach that works for most cases
    updateElementSize(newBuffer, infoPos + 4, infoSize.value + 11, infoSize.length);
    
    // Also need to update Segment size if it exists
    const segmentId = [0x18, 0x53, 0x80, 0x67];
    const segmentPos = findElement(newBuffer, segmentId, 0);
    if (segmentPos !== -1) {
        let sPos = segmentPos + 4;
        const segSize = readVint(newBuffer, sPos);
        if (segSize.value !== 0xFFFFFFFFFFFFFF) { // Not unknown size
            updateElementSize(newBuffer, sPos, segSize.value + 11, segSize.length);
        }
    }
    
    return newBuffer.buffer;
}

/**
 * Find an EBML element by its ID
 */
function findElement(bytes, elementId, start, end) {
    end = end || bytes.length - elementId.length;
    for (let i = start; i < end; i++) {
        let found = true;
        for (let j = 0; j < elementId.length; j++) {
            if (bytes[i + j] !== elementId[j]) {
                found = false;
                break;
            }
        }
        if (found) return i;
    }
    return -1;
}

/**
 * Read a variable-length integer (VINT) from EBML
 */
function readVint(bytes, pos) {
    const first = bytes[pos];
    let length = 1;
    let mask = 0x80;
    
    while (length <= 8 && !(first & mask)) {
        length++;
        mask >>= 1;
    }
    
    if (length > 8) {
        return { value: 0, length: 1 };
    }
    
    let value = first & (mask - 1);
    for (let i = 1; i < length; i++) {
        value = (value << 8) | bytes[pos + i];
    }
    
    return { value, length };
}

/**
 * Read an unsigned integer (big-endian) with a given byte length
 */
function readUint(bytes, pos, length) {
    let value = 0;
    for (let i = 0; i < length; i++) {
        value = (value << 8) | bytes[pos + i];
    }
    return value;
}

/**
 * Update an element's size in the buffer
 */
function updateElementSize(bytes, pos, newSize, currentLength) {
    // Encode the new size as VINT with the same length
    let size = newSize;
    const sizeBytes = [];
    
    for (let i = currentLength - 1; i >= 0; i--) {
        sizeBytes[i] = size & 0xFF;
        size >>= 8;
    }
    
    // Add length marker to first byte
    const marker = 0x80 >> (currentLength - 1);
    sizeBytes[0] |= marker;
    
    for (let i = 0; i < currentLength; i++) {
        bytes[pos + i] = sizeBytes[i];
    }
}

// ============================================================
// End WebM Duration Fix
// ============================================================

// State
let mediaRecorder = null;
let recordedChunks = [];
let startTime = null;
let timerInterval = null;
let currentBlob = null;
let recordingStream = null;
let activeStreams = [];
let audioContext = null;
let audioSources = [];
let state = 'idle'; // idle, recording, stopped, deleted

// Elements
const liveVideo = document.getElementById('liveVideo');
const recordedVideo = document.getElementById('recordedVideo');
const idleControls = document.getElementById('idleControls');
const recordingControls = document.getElementById('recordingControls');
const previewControls = document.getElementById('previewControls');
const deletedControls = document.getElementById('deletedControls');
const timerDisplay = document.getElementById('timerDisplay');
const message = document.getElementById('message');
const stateTitle = document.getElementById('stateTitle');
const statusPill = document.getElementById('statusPill');
const videoFrame = document.getElementById('videoFrame');

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
    deletedControls.classList.add('hidden');
    videoFrame.dataset.state = newState;

    switch (newState) {
        case 'idle':
            stateTitle.textContent = 'Ready';
            statusPill.textContent = 'Idle';
            idleControls.classList.remove('hidden');
            liveVideo.style.display = 'block';
            recordedVideo.style.display = 'none';
            break;
        case 'recording':
            stateTitle.textContent = 'Recording';
            statusPill.textContent = 'Live';
            recordingControls.classList.remove('hidden');
            break;
        case 'stopped':
            stateTitle.textContent = 'Preview';
            statusPill.textContent = 'Ready';
            previewControls.classList.remove('hidden');
            break;
        case 'deleted':
            stateTitle.textContent = 'Deleted';
            statusPill.textContent = 'Reset';
            deletedControls.classList.remove('hidden');
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

async function createRecordingStream(displayStream, micStream) {
    const videoTracks = displayStream.getVideoTracks();
    const audioStreams = [];

    if (displayStream.getAudioTracks().length > 0) {
        audioStreams.push(new MediaStream(displayStream.getAudioTracks()));
    }

    if (micStream && micStream.getAudioTracks().length > 0) {
        audioStreams.push(new MediaStream(micStream.getAudioTracks()));
    }

    if (audioStreams.length === 0) {
        return new MediaStream(videoTracks);
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
        const audioTracks = audioStreams.flatMap(stream => stream.getAudioTracks());
        return new MediaStream([...videoTracks, ...audioTracks]);
    }

    audioContext = new AudioContextClass();
    const destination = audioContext.createMediaStreamDestination();
    audioSources = audioStreams.map((stream) => {
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(destination);
        return source;
    });

    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    return new MediaStream([...videoTracks, ...destination.stream.getAudioTracks()]);
}

function getSupportedMimeType() {
    const mimeTypes = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm'
    ];

    return mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';
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
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            },
            systemAudio: 'include'
        });

        // Try to get microphone audio separately for better compatibility
        let audioStream = null;
        try {
            audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });
        } catch (audioError) {
            console.log('Microphone not available, using display audio only');
        }

        activeStreams = [displayStream, audioStream].filter(Boolean);
        recordingStream = await createRecordingStream(displayStream, audioStream);

        liveVideo.srcObject = recordingStream;

        // Handle when user stops sharing via browser UI
        displayStream.getVideoTracks()[0].onended = () => {
            if (state === 'recording') {
                stopRecording();
                showMessage('Screen sharing stopped', 'info');
            }
        };

        recordedChunks = [];
        const mimeType = getSupportedMimeType();
        mediaRecorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            const rawBlob = new Blob(recordedChunks, { type: 'video/webm' });

            // Check file size
            if (rawBlob.size > MAX_FILE_SIZE) {
                showMessage(`Recording too large (${formatBytes(rawBlob.size)}). Max: ${formatBytes(MAX_FILE_SIZE)}`, 'error');
                stopStream();
                setState('idle');
                return;
            }

            // Calculate recording duration
            const recordingDuration = Date.now() - startTime;
            
            // Show processing message
            showMessage('Processing recording...', 'info');
            
            // Fix WebM duration metadata for seekable playback
            const blob = await fixWebmDuration(rawBlob, recordingDuration);
            
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
            showMessage('Recording ready!', 'success');
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
        stopStream();
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
    activeStreams.forEach(stream => {
        stream.getTracks().forEach(track => track.stop());
    });
    activeStreams = [];

    if (recordingStream) {
        recordingStream.getTracks().forEach(track => track.stop());
        recordingStream = null;
    }

    audioSources.forEach(source => source.disconnect());
    audioSources = [];

    if (audioContext) {
        audioContext.close().catch(() => {});
        audioContext = null;
    }

    liveVideo.srcObject = null;
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

// Direct download
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

// Delete recording
function deleteRecording() {
    currentBlob = null;
    recordedChunks = [];
    recordedVideo.src = '';
    showMessage('Recording deleted', 'info');
    setState('deleted');
}

// Reset
function reset() {
    currentBlob = null;
    recordedChunks = [];
    recordedVideo.src = '';
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
document.getElementById('deleteBtn').addEventListener('click', deleteRecording);
document.getElementById('resetBtn').addEventListener('click', reset);

// Initialize
setState('idle');
