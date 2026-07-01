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
const timelineScrubber = document.getElementById('timeline-scrubber');

// Grab the Upper Interactive Trimming Sliders Elements
const trimStartSlider = document.getElementById('trim-start-slider');
const trimEndSlider = document.getElementById('trim-end-slider');

// Grab the Upper Trimming 5s Skip Handles Buttons
const btnTstartBack = document.getElementById('btn-tstart-back');
const btnTstartForward = document.getElementById('btn-tstart-forward');
const btnTendBack = document.getElementById('btn-tend-back');
const btnTendForward = document.getElementById('btn-tend-forward');

// Grab Trim Readout UI Badges
const trimBadge = document.getElementById('trim-badge');
const trimDurationTxt = document.getElementById('trim-duration-txt');
const trimStartMin = document.getElementById('trim-start-min'); 
const trimStartSec = document.getElementById('trim-start-sec'); 
const trimEndMin = document.getElementById('trim-end-min');     
const trimEndSec = document.getElementById('trim-end-sec');     

// State Variables
let currentSpeed = 1.0;
let trimStart = 0; 
let trimEnd = 0;   
let rawFileReference = null;
let isPreviewModeActive = false;
let isProgrammaticUpdate = false; 
let trimZoneRegion = null; // Stably targets the active region object

// Time code formatting helper
const formatTime = (seconds) => {
    if (isNaN(seconds) || seconds < 0) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

// Initialize the visual player with light-mode visual configuration mappings
const wavesurfer = WaveSurfer.create({
    container: '#waveform-container',
    waveColor: '#cbd5e1',
    progressColor: '#0284c7',
    cursorColor: '#ef4444',
    barWidth: 2,
    barGap: 1,
    height: 120,
    responsive: true
});

const wsRegions = wavesurfer.registerPlugin(RegionsPlugin.create());

// Capture uploaded file reference safely
fileInput.addEventListener('change', function (event) {
    const file = event.target.files[0];
    if (file) {
        rawFileReference = file;
        const fileUrl = URL.createObjectURL(file);

        const dummyPeaks = [];
        for (let i = 0; i < 150; i++) {
            dummyPeaks.push(Math.sin(i * 0.15) * 0.4 + 0.5);
        }
        wavesurfer.load(fileUrl, [dummyPeaks]);

        dropZone.classList.add('hidden');
        controlsSection.classList.remove('hidden');
        document.getElementById('waveform-workspace').classList.remove('hidden');

        speedSlider.value = 1.0;
        speedCustomInput.value = '1.00';
        seekMinInput.value = '00';
        seekSecInput.value = '00';
        timelineScrubber.value = 0;
        currentSpeed = 1.0;
    }
});

// Real-Time Scaled Two-Way Core Synchronization Readout Display Data Pipeline
const updateTrimUIReadout = (start, end) => {
    const scaledStart = start / currentSpeed;
    const scaledEnd = end / currentSpeed;
    const scaledDuration = (end - start) / currentSpeed;

    const userIsCurrentlyTyping = [
        trimStartMin, 
        trimStartSec, 
        trimEndMin, 
        trimEndSec
    ].includes(document.activeElement);

    // Block timeline reads from changing data inside your active typing window
    if (!userIsCurrentlyTyping) {
        trimStartMin.value = Math.floor(scaledStart / 60).toString().padStart(2, '0');
        trimStartSec.value = Math.floor(scaledStart % 60).toString().padStart(2, '0');
        trimEndMin.value = Math.floor(scaledEnd / 60).toString().padStart(2, '0');
        trimEndSec.value = Math.floor(scaledEnd % 60).toString().padStart(2, '0');
    }
    
    trimDurationTxt.textContent = `${scaledDuration.toFixed(1)}s`;

    // Sync positions of upper sliders fluidly
    trimStartSlider.value = start;
    trimEndSlider.value = end;
};

// Handle region assignment once audio metadata mounts
wavesurfer.on('ready', function () {
    const duration = wavesurfer.getDuration();
    wsRegions.clearRegions();
    const defaultEnd = duration * 0.3;

    wavesurfer.setPlaybackRate(currentSpeed);

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
// CORE IMPLEMENTATION: MANUAL TYPING & SLIDER ENGINE RESTORED
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

// NEW & RESTORED: Manual Timecode Typing Input Listener
const executeManualTrimUpdate = () => {
    const totalDuration = wavesurfer.getDuration();
    if (!trimZoneRegion || totalDuration === 0) return;

    let startMin = parseInt(trimStartMin.value) || 0;
    let startSec = parseInt(trimStartSec.value) || 0;
    let endMin = parseInt(trimEndMin.value) || 0;
    let endSec = parseInt(trimEndSec.value) || 0;

    // Boundary check seconds
    if (startSec > 59) { startSec = 59; trimStartSec.value = '59'; }
    if (endSec > 59) { endSec = 59; trimEndSec.value = '59'; }

    // Factor in speed settings adjustments
    let scaledStart = (startMin * 60) + startSec;
    let scaledEnd = (endMin * 60) + endSec;

    let rawStart = scaledStart * currentSpeed;
    let rawEnd = scaledEnd * currentSpeed;

    if (rawStart < 0) rawStart = 0;
    if (rawEnd > totalDuration) rawEnd = totalDuration;

    // Push handles if values cross limits mid-typing
    if (rawStart >= rawEnd) {
        if (document.activeElement === trimStartMin || document.activeElement === trimStartSec) {
            rawEnd = Math.min(totalDuration, rawStart + 2);
        } else {
            rawStart = Math.max(0, rawEnd - 2);
        }
    }

    trimStart = rawStart;
    trimEnd = rawEnd;

    applyUpperSliderTrimChanges();
};

// RE-ATTACHED CRITICAL TEXT FIELD LISTENERS: Fires when hitting Enter or clicking away
trimStartMin.addEventListener('change', executeManualTrimUpdate);
trimStartSec.addEventListener('change', executeManualTrimUpdate);
trimEndMin.addEventListener('change', executeManualTrimUpdate);
trimEndSec.addEventListener('change', executeManualTrimUpdate);

const cleanTrimPaddingOnBlur = (event) => {
    const value = parseInt(event.target.value) || 0;
    event.target.value = value.toString().padStart(2, '0');
};
trimStartMin.addEventListener('blur', cleanTrimPaddingOnBlur);
trimStartSec.addEventListener('blur', cleanTrimPaddingOnBlur);
trimEndMin.addEventListener('blur', cleanTrimPaddingOnBlur);
trimEndSec.addEventListener('blur', cleanTrimPaddingOnBlur);


// Drag Handle 1: Moving the Selection START slider stick
trimStartSlider.addEventListener('input', function(event) {
    let value = parseFloat(event.target.value);
    if (value >= trimEnd) {
        value = Math.max(0, trimEnd - 0.5);
        trimStartSlider.value = value;
    }
    trimStart = value;
    applyUpperSliderTrimChanges();
});

// Drag Handle 2: Moving the Selection END slider stick
trimEndSlider.addEventListener('input', function(event) {
    let value = parseFloat(event.target.value);
    if (value <= trimStart) {
        value = Math.min(wavesurfer.getDuration(), trimStart + 0.5);
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
    trimStart = Math.min(trimEnd - 0.5, trimStart + 5);
    applyUpperSliderTrimChanges();
});

btnTendBack.addEventListener('click', function() {
    trimEnd = Math.max(trimStart + 0.5, trimEnd - 5);
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

// Time tracker playback ticker
wavesurfer.on('timeupdate', function (currentTime) {
    const duration = wavesurfer.getDuration();
    const scaledTime = currentTime / currentSpeed;
    const scaledDuration = duration / currentSpeed;

    timeDisplay.textContent = `${formatTime(scaledTime)} / ${formatTime(scaledDuration)}`;

    if (duration > 0) {
        timelineScrubber.value = (currentTime / duration) * 100;
    }

    if (document.activeElement !== seekMinInput && document.activeElement !== seekSecInput) {
        const currentMins = Math.floor(scaledTime / 60);
        const currentSecs = Math.floor(scaledTime % 60);
        seekMinInput.value = currentMins.toString().padStart(2, '0');
        seekSecInput.value = currentSecs.toString().padStart(2, '0');
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

// Manual Timecode Navigation Seeker Input Calculations
const executeManualTimecodeSeek = () => {
    let inputMinutes = parseInt(seekMinInput.value) || 0;
    let inputSeconds = parseInt(seekSecInput.value) || 0;
    const totalDuration = wavesurfer.getDuration();
    const maxScaledDuration = totalDuration / currentSpeed;

    if (inputSeconds > 59) { inputSeconds = 59; seekSecInput.value = '59'; }
    if (inputMinutes < 0) { inputMinutes = 0; seekMinInput.value = '00'; }
    if (inputSeconds < 0) { inputSeconds = 0; seekSecInput.value = '00'; }

    let computedScaledSeconds = (inputMinutes * 60) + inputSeconds;

    if (computedScaledSeconds > maxScaledDuration) {
        computedScaledSeconds = maxScaledDuration;
        const maxMins = Math.floor(maxScaledDuration / 60);
        const maxSecs = Math.floor(maxScaledDuration % 60);
        seekMinInput.value = maxMins.toString().padStart(2, '0');
        seekSecInput.value = maxSecs.toString().padStart(2, '0');
    }

    let originalSecondsTarget = computedScaledSeconds * currentSpeed;
    wavesurfer.setTime(originalSecondsTarget);
};

seekMinInput.addEventListener('input', executeManualTimecodeSeek);
seekSecInput.addEventListener('input', executeManualTimecodeSeek);

const cleanPaddedViewOnBlur = (event) => {
    const value = parseInt(event.target.value) || 0;
    event.target.value = value.toString().padStart(2, '0');
};
seekMinInput.addEventListener('blur', cleanPaddedViewOnBlur);
seekSecInput.addEventListener('blur', cleanPaddedViewOnBlur);

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
// ========================================================
// SECURE & PATCHED INPUT-TRIM COMPILATION PIPELINE
// ========================================================
downloadBtn.addEventListener('click', async function () {
    if (!rawFileReference) return;

    const selectedFormat = formatSelect.value;
    const outputFilename = `output.${selectedFormat}`;
    let fileSystemSaveHandle = null;

    let mimeType = 'audio/mp3';
    if (selectedFormat === 'wav') mimeType = 'audio/wav';
    if (selectedFormat === 'm4a') mimeType = 'audio/x-m4a';

    // 1. Secure download handle while gesture is fresh
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

        // Calculate the precise amount of RAW input seconds to extract
        const durationOfCut = trimEnd - trimStart;

        // CRITICAL RE-ORDER FIX: -ss and -t are placed BEFORE -i to lock input boundaries
        await ffmpeg.exec([
            '-ss', trimStart.toFixed(2),      // Seek to original file start point
            '-t', durationOfCut.toFixed(2),   // Read ONLY the length of the highlighted segment
            '-i', 'input.mp3',                // Load source asset
            '-filter:a', `atempo=${currentSpeed.toFixed(2)}`, // Speed up the isolated chunk
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