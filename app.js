// ========================================================
// BYPASS CDN WEB WORKER SAME-ORIGIN BLOCK
// ========================================================
const NativeWorker = window.Worker;
window.Worker = class extends NativeWorker {
    constructor(scriptURL, options) {
        const urlString = scriptURL.toString();
        if (urlString.includes('cdn.jsdelivr.net')) {
            const blobCode = `import "${urlString}";`;
            const workerBlob = new Blob([blobCode], { type: 'text/javascript' });
            const localBlobURL = URL.createObjectURL(workerBlob);
            super(localBlobURL, options);
        } else {
            super(scriptURL, options);
        }
    }
};

import WaveSurfer from 'https://cdn.jsdelivr.net/npm/wavesurfer.js@7/dist/wavesurfer.esm.js';
import RegionsPlugin from 'https://cdn.jsdelivr.net/npm/wavesurfer.js@7/dist/plugins/regions.esm.js';
import { FFmpeg } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js';
import { fetchFile, toBlobURL } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js';

// Grab HTML elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('audio-file-input');
const controlsSection = document.getElementById('controls');
const playBtn = document.getElementById('btn-play');
const previewBtn = document.getElementById('btn-preview');
const formatSelect = document.getElementById('format-select');
const timeDisplay = document.getElementById('time-display');
const speedSlider = document.getElementById('speed-slider');
const speedCustomInput = document.getElementById('speed-custom');
const downloadBtn = document.getElementById('btn-download');
const statusMessage = document.getElementById('status-message');
const statusText = document.getElementById('status-text');
const spinner = document.querySelector('.loading-spinner');

// Audio Timeline Navigation Buttons
const back5sBtn = document.getElementById('btn-back-5s');
const forward5sBtn = document.getElementById('btn-forward-5s');
const removeBtn = document.getElementById('btn-remove');

// Seek Navigation Handles
const seekMinInput = document.getElementById('seek-min');
const seekSecInput = document.getElementById('seek-sec');
const seekMsInput = document.getElementById('seek-ms'); // NEW
const timelineScrubber = document.getElementById('timeline-scrubber');

// Grab the Upper Interactive Trimming Sliders Elements
const trimStartSlider = document.getElementById('trim-start-slider');
const trimEndSlider = document.getElementById('trim-end-slider');

// Grab the Upper Trimming 5s Skip Handles Buttons
const btnTstartBack = document.getElementById('btn-tstart-back');
const btnTstartForward = document.getElementById('btn-tstart-forward');
const btnTendBack = document.getElementById('btn-tend-back');
const btnTendForward = document.getElementById('btn-tend-forward');

// Grab High-Resolution Magnification Slider Track Element
const waveformZoomSlider = document.getElementById('waveform-zoom-slider');

// Grab Trim Readout UI Badges
const trimBadge = document.getElementById('trim-badge');
const trimDurationTxt = document.getElementById('trim-duration-txt');
const trimStartMin = document.getElementById('trim-start-min'); 
const trimStartSec = document.getElementById('trim-start-sec'); 
const trimStartMs = document.getElementById('trim-start-ms');   // NEW
const trimEndMin = document.getElementById('trim-end-min');     
const trimEndSec = document.getElementById('trim-end-sec');     
const trimEndMs = document.getElementById('trim-end-ms');       // NEW

// State Variables
let currentSpeed = 1.0;
let trimStart = 0; 
let trimEnd = 0;   
let rawFileReference = null;
let isPreviewModeActive = false;
let isProgrammaticUpdate = false; 
let trimZoneRegion = null; 

// UPGRADED: High-Resolution Time Formatter (Returns MM:SS.mmm)
const formatTime = (seconds) => {
    if (isNaN(seconds) || seconds < 0) return "00:00.000";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
};

// Initialize the visual player with light-mode visual configuration mappings
const wavesurfer = WaveSurfer.create({
    container: '#waveform-container',
    waveColor: '#cbd5e1',
    progressColor: '#0284c7',
    cursorColor: '#ef4444',
    barWidth: 2,
    barGap: 1,
    height: 120
});

const wsRegions = wavesurfer.registerPlugin(RegionsPlugin.create());

// Capture uploaded file reference safely
// ========================================================
// INSTANT-SEEDING FILE INPUT PIPELINE
// ========================================================
fileInput.addEventListener('change', function (event) {
    const file = event.target.files[0];
    if (file) {
        rawFileReference = file;
        const fileUrl = URL.createObjectURL(file);

        // 1. GENERATE AN INSTANT STRUCTURAL PEAK PROFILE (Takes < 3 milliseconds)
        // This tricks the engine into skipping heavy decoding, keeping the main thread free
        const fastPeaks = [];
        for (let i = 0; i < 300; i++) {
            fastPeaks.push(Math.sin(i * 0.1) * 0.3 + 0.4 + (Math.random() * 0.15));
        }

        // 2. PASS THE FAST PEAKS DIRECTLY INTO THE LOAD CORE
        // In WaveSurfer v7, passing peaks prevents the entire UI from freezing up
        wavesurfer.load(fileUrl, [fastPeaks]);

        // 3. RE-TOGGLE DASHBOARD SECTIONS INSTANTLY
        dropZone.classList.add('hidden');
        controlsSection.classList.remove('hidden');
        document.getElementById('waveform-workspace').classList.remove('hidden');

        // Reset system dashboard coordinates values
        speedSlider.value = 1.0;
        speedCustomInput.value = '1.00';
        seekMinInput.value = '00';
        seekSecInput.value = '00';
        seekMsInput.value = '000';
        timelineScrubber.value = 0;
        waveformZoomSlider.value = 0; 
        currentSpeed = 1.0;
    }
});

// UPGRADED TWO-WAY REGION VALUE DISPLAY SYSTEM WITH FLOATING MILLISECOND RESOLUTION
const updateTrimUIReadout = (start, end) => {
    const scaledStart = start / currentSpeed;
    const scaledEnd = end / currentSpeed;
    const scaledDuration = (end - start) / currentSpeed;

    const userIsCurrentlyTyping = [
        trimStartMin, trimStartSec, trimStartMs,
        trimEndMin, trimEndSec, trimEndMs
    ].includes(document.activeElement);

    if (!userIsCurrentlyTyping) {
        trimStartMin.value = Math.floor(scaledStart / 60).toString().padStart(2, '0');
        trimStartSec.value = Math.floor(scaledStart % 60).toString().padStart(2, '0');
        trimStartMs.value = Math.floor((scaledStart % 1) * 1000).toString().padStart(3, '0');

        trimEndMin.value = Math.floor(scaledEnd / 60).toString().padStart(2, '0');
        trimEndSec.value = Math.floor(scaledEnd % 60).toString().padStart(2, '0');
        trimEndMs.value = Math.floor((scaledEnd % 1) * 1000).toString().padStart(3, '0');
    }
    
    trimDurationTxt.textContent = `${scaledDuration.toFixed(3)}s`;

    trimStartSlider.value = start;
    trimEndSlider.value = end;
};

// Handle region assignment once audio metadata mounts
wavesurfer.on('ready', function () {
    const duration = wavesurfer.getDuration();
    wsRegions.clearRegions();
    const defaultEnd = duration * 0.3;

    wavesurfer.setPlaybackRate(currentSpeed);

    // Enforce safety ceiling calculations for canvas boundaries
    const safeMaxZoomPxPerSec = Math.floor(30000 / duration);
    waveformZoomSlider.max = Math.max(5, safeMaxZoomPxPerSec).toString(); 
    waveformZoomSlider.value = "0";
    wavesurfer.zoom(0);

    trimStartSlider.max = duration;
    trimEndSlider.max = duration;

    trimZoneRegion = wsRegions.addRegion({
        id: 'trim-zone',
        start: 0,
        end: defaultEnd,
        color: 'rgba(2, 132, 199, 0.12)',
        drag: true,
        resize: true
    });

    trimStart = 0;
    trimEnd = defaultEnd;

    trimBadge.classList.remove('hidden');
    updateTrimUIReadout(trimStart, trimEnd);
});

// Listens to the region plugin in REAL TIME as handles are dragged manually on wave canvas
wsRegions.on('region-updated', function (region) {
    if (region.id === 'trim-zone') {
        trimStart = region.start;
        trimEnd = region.end;
        
        if (!isProgrammaticUpdate) {
            updateTrimUIReadout(trimStart, trimEnd);
        }
    }
});


// ========================================================
// CORE IMPLEMENTATION: HIGH-RESOLUTION ZOOM ENGAGEMENT
// ========================================================
waveformZoomSlider.addEventListener('input', function(event) {
    wavesurfer.zoom(Number(event.target.value));
});


// ========================================================
// CORE IMPLEMENTATION: UPGRADED FLOATING-POINT INPUT ENGINE
// ========================================================

const applyUpperSliderTrimChanges = () => {
    if (!trimZoneRegion) return;

    isProgrammaticUpdate = true;
    trimZoneRegion.setOptions({
        start: trimStart,
        end: trimEnd
    });

    updateTrimUIReadout(trimStart, trimEnd);
    isProgrammaticUpdate = false;
};

const executeManualTrimUpdate = () => {
    const totalDuration = wavesurfer.getDuration();
    if (!trimZoneRegion || totalDuration === 0) return;

    let startMin = parseInt(trimStartMin.value) || 0;
    let startSec = parseInt(trimStartSec.value) || 0;
    let startMs = parseInt(trimStartMs.value) || 0;
    let endMin = parseInt(trimEndMin.value) || 0;
    let endSec = parseInt(trimEndSec.value) || 0;
    let endMs = parseInt(trimEndMs.value) || 0;

    // Enforce parameter boundaries limits loops guards
    if (startSec > 59) { startSec = 59; trimStartSec.value = '59'; }
    if (startMs > 999) { startMs = 999; trimStartMs.value = '999'; }
    if (endSec > 59) { endSec = 59; trimEndSec.value = '59'; }
    if (endMs > 999) { endMs = 999; trimEndMs.value = '999'; }

    // Merge integers into precise decimal coordinates seconds representations
    let scaledStart = (startMin * 60) + startSec + (startMs / 1000);
    let scaledEnd = (endMin * 60) + endSec + (endMs / 1000);

    let rawStart = scaledStart * currentSpeed;
    let rawEnd = scaledEnd * currentSpeed;

    if (rawStart < 0) rawStart = 0;
    if (rawEnd > totalDuration) rawEnd = totalDuration;

    if (rawStart >= rawEnd) {
        if ([trimStartMin, trimStartSec, trimStartMs].includes(document.activeElement)) {
            rawEnd = Math.min(totalDuration, rawStart + 0.1); // 100ms offset cushion
        } else {
            rawStart = Math.max(0, rawEnd - 0.1);
        }
    }

    trimStart = rawStart;
    trimEnd = rawEnd;

    applyUpperSliderTrimChanges();
};

// Attach listeners to all six configuration entry coordinates
trimStartMin.addEventListener('change', executeManualTrimUpdate);
trimStartSec.addEventListener('change', executeManualTrimUpdate);
trimStartMs.addEventListener('change', executeManualTrimUpdate);
trimEndMin.addEventListener('change', executeManualTrimUpdate);
trimEndSec.addEventListener('change', executeManualTrimUpdate);
trimEndMs.addEventListener('change', executeManualTrimUpdate);

const cleanTrimPaddingOnBlur = (event) => {
    const value = parseInt(event.target.value) || 0;
    if (event.target.classList.contains('ms-field')) {
        event.target.value = value.toString().padStart(3, '0');
    } else {
        event.target.value = value.toString().padStart(2, '0');
    }
};
[trimStartMin, trimStartSec, trimStartMs, trimEndMin, trimEndSec, trimEndMs].forEach(input => {
    input.addEventListener('blur', cleanTrimPaddingOnBlur);
});


// Drag Handle 1: Moving the Selection START slider stick
trimStartSlider.addEventListener('input', function(event) {
    let value = parseFloat(event.target.value);
    if (value >= trimEnd) {
        value = Math.max(0, trimEnd - 0.01);
        trimStartSlider.value = value;
    }
    trimStart = value;
    applyUpperSliderTrimChanges();
});

// Drag Handle 2: Moving the Selection END slider stick
trimEndSlider.addEventListener('input', function(event) {
    let value = parseFloat(event.target.value);
    if (value <= trimStart) {
        value = Math.min(wavesurfer.getDuration(), trimStart + 0.01);
        trimEndSlider.value = value;
    }
    trimEnd = value;
    applyUpperSliderTrimChanges();
});


// ========================================================
// UPPER 5s FINE-TUNERS NUDGE LISTENERS
// ========================================================
btnTstartBack.addEventListener('click', function() {
    trimStart = Math.max(0, trimStart - 5);
    applyUpperSliderTrimChanges();
});

btnTstartForward.addEventListener('click', function() {
    trimStart = Math.min(trimEnd - 0.1, trimStart + 5);
    applyUpperSliderTrimChanges();
});

btnTendBack.addEventListener('click', function() {
    trimEnd = Math.max(trimStart + 0.1, trimEnd - 5);
    applyUpperSliderTrimChanges();
});

btnTendForward.addEventListener('click', function() {
    const duration = wavesurfer.getDuration();
    trimEnd = Math.min(duration, trimEnd + 5);
    applyUpperSliderTrimChanges();
});


// Preview Selection Button Listener
previewBtn.addEventListener('click', function () {
    wavesurfer.setTime(trimStart);
    wavesurfer.play();
    isPreviewModeActive = true;
});

// Time tracker playback ticker with high-res millisecond formatting mappings
wavesurfer.on('timeupdate', function (currentTime) {
    const duration = wavesurfer.getDuration();
    const scaledTime = currentTime / currentSpeed;
    const scaledDuration = duration / currentSpeed;

    timeDisplay.textContent = `${formatTime(scaledTime)} / ${formatTime(scaledDuration)}`;

    if (duration > 0) {
        timelineScrubber.value = (currentTime / duration) * 100;
    }

    const userIsSeeking = [seekMinInput, seekSecInput, seekMsInput].includes(document.activeElement);
    if (!userIsSeeking) {
        const currentMins = Math.floor(scaledTime / 60);
        const currentSecs = Math.floor(scaledTime % 60);
        const currentMs = Math.floor((scaledTime % 1) * 1000);
        seekMinInput.value = currentMins.toString().padStart(2, '0');
        seekSecInput.value = currentSecs.toString().padStart(2, '0');
        seekMsInput.value = currentMs.toString().padStart(3, '0');
    }

    if (isPreviewModeActive && currentTime >= trimEnd) {
        wavesurfer.pause();
        isPreviewModeActive = false;
    }
});

wavesurfer.on('pause', () => { isPreviewModeActive = false; });

// Playhead Pointer Drag Seeker Listener
timelineScrubber.addEventListener('input', function (event) {
    const percentage = parseFloat(event.target.value) / 100;
    const duration = wavesurfer.getDuration();
    if (duration > 0) wavesurfer.setTime(percentage * duration);
});

// 5s Playback Navigation Jump Listeners
back5sBtn.addEventListener('click', () => wavesurfer.skip(-5));
forward5sBtn.addEventListener('click', () => wavesurfer.skip(5));

// Wipe Workspace Canvas Reset Action
removeBtn.addEventListener('click', function () {
    wavesurfer.empty();
    wsRegions.clearRegions();
    rawFileReference = null;
    trimZoneRegion = null;
    fileInput.value = '';
    isPreviewModeActive = false;

    controlsSection.classList.add('hidden');
    trimBadge.classList.add('hidden');
    document.getElementById('waveform-workspace').classList.add('hidden');
    dropZone.classList.remove('hidden');
    console.log("Workspace layout tracking reset.");
});

// UPGRADED: Manual Timecode Navigation Seeker Input Calculations with milliseconds support
const executeManualTimecodeSeek = () => {
    let inputMinutes = parseInt(seekMinInput.value) || 0;
    let inputSeconds = parseInt(seekSecInput.value) || 0;
    let inputMs = parseInt(seekMsInput.value) || 0;
    const totalDuration = wavesurfer.getDuration();
    const maxScaledDuration = totalDuration / currentSpeed;

    if (inputSeconds > 59) { inputSeconds = 59; seekSecInput.value = '59'; }
    if (inputMs > 999) { inputMs = 999; seekMsInput.value = '999'; }
    if (inputMinutes < 0) { inputMinutes = 0; seekMinInput.value = '00'; }
    if (inputSeconds < 0) { inputSeconds = 0; seekSecInput.value = '00'; }
    if (inputMs < 0) { inputMs = 0; seekMsInput.value = '000'; }

    let computedScaledSeconds = (inputMinutes * 60) + inputSeconds + (inputMs / 1000);

    if (computedScaledSeconds > maxScaledDuration) {
        computedScaledSeconds = maxScaledDuration;
        const maxMins = Math.floor(maxScaledDuration / 60);
        const maxSecs = Math.floor(maxScaledDuration % 60);
        const maxMs = Math.floor((maxScaledDuration % 1) * 1000);
        seekMinInput.value = maxMins.toString().padStart(2, '0');
        seekSecInput.value = maxSecs.toString().padStart(2, '0');
        seekMsInput.value = maxMs.toString().padStart(3, '0');
    }

    let originalSecondsTarget = computedScaledSeconds * currentSpeed;
    wavesurfer.setTime(originalSecondsTarget);
};

seekMinInput.addEventListener('input', executeManualTimecodeSeek);
seekSecInput.addEventListener('input', executeManualTimecodeSeek);
seekMsInput.addEventListener('input', executeManualTimecodeSeek);

[seekMinInput, seekSecInput, seekMsInput].forEach(input => {
    input.addEventListener('blur', cleanTrimPaddingOnBlur);
});

// Core Audio Speed Modifier
const applyEngineSpeed = (speedValue) => {
    currentSpeed = speedValue;
    const mediaElement = wavesurfer.getMediaElement();
    if (mediaElement) mediaElement.preservesPitch = true;
    wavesurfer.setPlaybackRate(currentSpeed);

    updateTrimUIReadout(trimStart, trimEnd);
    if (wavesurfer.isReady) {
        const currentTime = wavesurfer.getCurrentTime();
        const duration = wavesurfer.getDuration();
        timeDisplay.textContent = `${formatTime(currentTime / currentSpeed)} / ${formatTime(duration / currentSpeed)}`;
    }
};

// Two-way speed controls synchronizer listeners
speedSlider.addEventListener('input', function (event) {
    const value = parseFloat(event.target.value);
    speedCustomInput.value = value.toFixed(2);
    applyEngineSpeed(value);
});

speedCustomInput.addEventListener('input', function (event) {
    let value = parseFloat(event.target.value);
    if (isNaN(value) || value <= 0.05) return;
    if (value > 4.0) value = 4.0;
    if (value >= 0.5 && value <= 2.0) {
        speedSlider.value = value;
    }
    applyEngineSpeed(value);
});

playBtn.addEventListener('click', () => wavesurfer.playPause());
wavesurfer.on('play', () => playBtn.textContent = 'Pause');
wavesurfer.on('pause', () => playBtn.textContent = 'Play');

// SECURE & OPTIMIZED COMPILATION PIPELINE WITH LOCATION PICKING
downloadBtn.addEventListener('click', async function () {
    if (!rawFileReference) return;

    const selectedFormat = formatSelect.value;
    const outputFilename = `output.${selectedFormat}`;
    let fileSystemSaveHandle = null;

    let mimeType = 'audio/mp3';
    if (selectedFormat === 'wav') mimeType = 'audio/wav';
    if (selectedFormat === 'm4a') mimeType = 'audio/x-m4a';

    if ('showSaveFilePicker' in window) {
        try {
            const originalNamePrefix = rawFileReference.name.substring(0, rawFileReference.name.lastIndexOf('.')) || rawFileReference.name;

            const pickerOptions = {
                suggestedName: `edited_${originalNamePrefix}.${selectedFormat}`,
                types: [{
                    description: `${selectedFormat.toUpperCase()} Audio Track`,
                    accept: { [mimeType]: [`.${selectedFormat}`] }
                }]
            };

            fileSystemSaveHandle = await window.showSaveFilePicker(pickerOptions);
        } catch (pickerError) {
            console.log("User cancelled file location selection window:", pickerError);
            return; 
        }
    }

    statusMessage.classList.remove('hidden', 'success');
    spinner.style.display = 'block';
    statusText.textContent = "Initializing Audio Compiler Engine...";
    downloadBtn.disabled = true;

    try {
        const ffmpeg = new FFmpeg();
        const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

        await ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });

        statusText.textContent = "Reading source file bits...";
        await ffmpeg.writeFile('input.mp3', await fetchFile(rawFileReference));

        statusText.textContent = `Compiling! Converting into ${selectedFormat.toUpperCase()} and locking pitch at ${currentSpeed.toFixed(2)}x...`;

        const durationOfCut = trimEnd - trimStart;

        await ffmpeg.exec([
            '-ss', trimStart.toFixed(2),
            '-t', durationOfCut.toFixed(2),
            '-i', 'input.mp3',
            '-filter:a', `atempo=${currentSpeed.toFixed(2)}`,
            outputFilename
        ]);

        statusText.textContent = "Finalizing data streaming blocks to disk...";
        const compiledData = await ffmpeg.readFile(outputFilename);
        const finalAudioBlob = new Blob([compiledData.buffer], { type: mimeType });

        if (fileSystemSaveHandle) {
            const diskFileSystemWritableChannel = await fileSystemSaveHandle.createWritable();
            await diskFileSystemWritableChannel.write(finalAudioBlob);
            await diskFileSystemWritableChannel.close();
        } else {
            const downloadUrl = URL.createObjectURL(finalAudioBlob);
            const invisibleAnchor = document.createElement('a');
            invisibleAnchor.href = downloadUrl;
            invisibleAnchor.download = `edited_${rawFileReference.name.split('.')[0]}.${selectedFormat}`;
            document.body.appendChild(invisibleAnchor);
            invisibleAnchor.click();
            document.body.removeChild(invisibleAnchor);
        }

        spinner.style.display = 'none';
        statusMessage.classList.add('success');
        statusText.textContent = "🎉 Success! Your edited audio file has been downloaded safely.";

        setTimeout(() => {
            statusMessage.classList.add('hidden');
        }, 3500);

    } catch (error) {
        console.error("Compilation process exception details tracker logs:", error);
        spinner.style.display = 'none';
        statusText.textContent = "Error occurred during audio baking process.";
        setTimeout(() => { statusMessage.classList.add('hidden'); }, 2000);
    } finally {
        downloadBtn.disabled = false;
    }
});

// ========================================================
// HIGH-PERFORMANCE CLIENT-SIDE 3D MATRIX WAVE ENGINE
// ========================================================
const init3DBackgroundMatrix = () => {
    const canvas = document.getElementById('bg-3d-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    // Grid Mesh Configuration Tokens
    const numCols = 32;
    const numRows = 24;
    const spacing = 45; // Separation space between intersection nodes

    // 3D Perspective Metrics
    const fov = 380;    // Focal length/camera magnification strength
    const viewingAngleX = 0.55; // Tilted downward angle vector pitch

    let timeTicker = 0;

    // Resize Handler Listener thread
    window.addEventListener('resize', () => {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    });

    const renderLoop = () => {
        ctx.clearRect(0, 0, width, height);
        timeTicker += 0.012; // Controls wave modulation animation speed velocity

        const centerX = width / 2;
        const centerY = height / 2 + 80; // Offsets the center line lower for desk depth look

        // Render standard horizontal grid structural linking lines
        for (let r = 0; r < numRows; r++) {
            ctx.beginPath();
            let lineStarted = false;

            for (let c = 0; c < numCols; c++) {
                // 1. Map raw flat coordinates relative to center space point coordinates
                const x3d = (c - numCols / 2) * spacing;
                const z3d = (r - numRows / 2) * spacing + 250; // Push depth outwards

                // 2. Generate 3D wave undulation using double-sine trigonometric algorithms
                const waveFactor1 = Math.sin(c * 0.18 + timeTicker);
                const waveFactor2 = Math.cos(r * 0.14 + timeTicker * 0.8);
                const y3d = waveFactor1 * waveFactor2 * 32; // 32 is wave amplitude height displacement

                // 3. Rotate coordinates on X-axis to create the angled perspective plane layout
                const cosX = Math.cos(viewingAngleX);
                const sinX = Math.sin(viewingAngleX);

                const rotY = y3d * cosX - z3d * sinX;
                const rotZ = y3d * sinX + z3d * cosX;

                // 4. Extract 3D perspective projection factor rules to convert coordinates onto 2D screens
                const projectionScale = fov / (rotZ + fov);
                const screenX = x3d * projectionScale + centerX;
                const screenY = rotY * projectionScale + centerY;

                // 5. Build coordinate vector connection lines mapping paths
                if (!lineStarted) {
                    ctx.moveTo(screenX, screenY);
                    lineStarted = true;
                } else {
                    ctx.lineTo(screenX, screenY);
                }
            }

            // Give closer lines more prominence than distant background lines (Atmospheric Depth)
            const depthOpacity = (r / numRows) * 0.15;
            ctx.strokeStyle = `rgba(2, 132, 199, ${depthOpacity})`; // Matches sky blue theme color safely
            ctx.lineWidth = 1.2;
            ctx.stroke();
        }

        requestAnimationFrame(renderLoop);
    };

    renderLoop();
};

// Fire up the 3D visualization canvas matrix loop!
init3DBackgroundMatrix();