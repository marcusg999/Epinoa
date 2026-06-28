(function () {
    'use strict';

    const $ = (sel) => document.querySelector(sel);
    const on = (el, evt, fn, opts) => el.addEventListener(evt, fn, opts);

    // State
    const state = {
        overlayImage: null,
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        opacity: 0.5,
        locked: false,
        cameraStream: null,
        facingMode: 'environment',
        imageWidth: 0,
        imageHeight: 0,
    };

    // Touch tracking
    const touch = {
        active: false,
        startX: 0,
        startY: 0,
        lastX: 0,
        lastY: 0,
        startDist: 0,
        startAngle: 0,
        startScale: 1,
        startRotation: 0,
        pointers: new Map(),
    };

    // DOM refs
    const els = {
        landingScreen: $('#landing-screen'),
        cameraScreen: $('#camera-screen'),
        uploadArea: $('#upload-area'),
        imageInput: $('#image-input'),
        sampleBtn: $('#sample-btn'),
        cameraFeed: $('#camera-feed'),
        overlayImage: $('#overlay-image'),
        overlayContainer: $('#overlay-container'),
        opacitySlider: $('#opacity-slider'),
        opacityValue: $('#opacity-value'),
        backBtn: $('#back-btn'),
        switchCameraBtn: $('#switch-camera-btn'),
        resetBtn: $('#reset-btn'),
        lockBtn: $('#lock-btn'),
        newImageBtn: $('#new-image-btn'),
        newImageInput: $('#new-image-input'),
        errorOverlay: $('#error-overlay'),
        errorMessage: $('#error-message'),
        errorRetryBtn: $('#error-retry-btn'),
        errorDismissBtn: $('#error-dismiss-btn'),
        statusText: $('#status-text'),
    };

    // ── Image Loading ──

    function loadImage(file) {
        if (!file || !file.type.startsWith('image/')) {
            showError('Please select a valid image file.');
            return;
        }

        const reader = new FileReader();
        reader.onload = function (e) {
            setOverlayImage(e.target.result);
        };
        reader.onerror = function () {
            showError('Failed to read the image file.');
        };
        reader.readAsDataURL(file);
    }

    function setOverlayImage(src) {
        const img = new Image();
        img.onload = function () {
            state.imageWidth = img.naturalWidth;
            state.imageHeight = img.naturalHeight;

            fitImageToScreen();

            els.overlayImage.src = src;
            els.overlayImage.classList.add('loaded');
            state.overlayImage = src;

            updateOverlayTransform();
            showScreen('camera');
            startCamera();
        };
        img.onerror = function () {
            showError('Failed to load the image.');
        };
        img.src = src;
    }

    function fitImageToScreen() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const imgAspect = state.imageWidth / state.imageHeight;
        const screenAspect = vw / vh;

        let displayW, displayH;
        if (imgAspect > screenAspect) {
            displayW = vw * 0.85;
            displayH = displayW / imgAspect;
        } else {
            displayH = vh * 0.7;
            displayW = displayH * imgAspect;
        }

        state.scale = displayW / state.imageWidth;
        state.x = 0;
        state.y = 0;
        state.rotation = 0;

        els.overlayImage.style.width = state.imageWidth + 'px';
        els.overlayImage.style.height = state.imageHeight + 'px';
    }

    function createSampleImage() {
        const canvas = document.createElement('canvas');
        canvas.width = 600;
        canvas.height = 800;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, 600, 800);

        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.ellipse(300, 350, 120, 160, 0, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(250, 310, 25, 15, -0.1, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(350, 310, 25, 15, 0.1, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(250, 310, 8, 8, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(350, 310, 8, 8, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(290, 370);
        ctx.lineTo(300, 400);
        ctx.lineTo(310, 370);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(300, 440, 40, 15, 0, 0, Math.PI);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.font = '16px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Sample Reference', 300, 700);
        ctx.fillText('Upload your own image to trace', 300, 730);

        return canvas.toDataURL('image/png');
    }

    // ── Camera ──

    async function startCamera() {
        try {
            if (state.cameraStream) {
                state.cameraStream.getTracks().forEach((t) => t.stop());
            }

            const constraints = {
                video: {
                    facingMode: state.facingMode,
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: false,
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            state.cameraStream = stream;
            els.cameraFeed.srcObject = stream;

            await els.cameraFeed.play();

            els.statusText.textContent = 'Adjust your overlay';
        } catch (err) {
            els.statusText.textContent = 'Camera unavailable — overlay only';
            if (
                err.name === 'NotAllowedError' ||
                err.name === 'PermissionDeniedError'
            ) {
                showError(
                    'Camera access denied. Your image is still loaded — you can use it without the camera, or allow camera access in your browser settings and tap retry.'
                );
            } else if (
                err.name === 'NotFoundError' ||
                err.name === 'DevicesNotFoundError'
            ) {
                showError(
                    'No camera found. Your image is still loaded — connect a camera and tap retry.'
                );
            } else if (
                err.name === 'NotReadableError' ||
                err.name === 'TrackStartError'
            ) {
                showError(
                    'Camera is in use by another application. Your image is still loaded — close other camera apps and tap retry.'
                );
            } else {
                showError('Could not access camera: ' + err.message);
            }
        }
    }

    async function switchCamera() {
        state.facingMode =
            state.facingMode === 'environment' ? 'user' : 'environment';
        await startCamera();
    }

    function stopCamera() {
        if (state.cameraStream) {
            state.cameraStream.getTracks().forEach((t) => t.stop());
            state.cameraStream = null;
        }
        els.cameraFeed.srcObject = null;
    }

    // ── Overlay Transform ──

    function updateOverlayTransform() {
        const tx = state.x;
        const ty = state.y;
        const s = state.scale;
        const r = state.rotation;

        els.overlayImage.style.transform =
            'translate(-50%, -50%) ' +
            'translate(' + tx + 'px, ' + ty + 'px) ' +
            'scale(' + s + ') ' +
            'rotate(' + r + 'deg)';

        els.overlayImage.style.opacity = state.opacity;
    }

    // ── Touch/Pointer Handling ──

    function getDistance(p1, p2) {
        const dx = p2.clientX - p1.clientX;
        const dy = p2.clientY - p1.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function getAngle(p1, p2) {
        return (Math.atan2(p2.clientY - p1.clientY, p2.clientX - p1.clientX) * 180) / Math.PI;
    }

    function getMidpoint(p1, p2) {
        return {
            x: (p1.clientX + p2.clientX) / 2,
            y: (p1.clientY + p2.clientY) / 2,
        };
    }

    function onPointerDown(e) {
        if (state.locked) return;
        if (e.target === els.opacitySlider) return;

        touch.pointers.set(e.pointerId, e);

        if (touch.pointers.size === 1) {
            touch.active = true;
            touch.startX = e.clientX;
            touch.startY = e.clientY;
            touch.lastX = state.x;
            touch.lastY = state.y;
        } else if (touch.pointers.size === 2) {
            const pts = Array.from(touch.pointers.values());
            touch.startDist = getDistance(pts[0], pts[1]);
            touch.startAngle = getAngle(pts[0], pts[1]);
            touch.startScale = state.scale;
            touch.startRotation = state.rotation;

            const mid = getMidpoint(pts[0], pts[1]);
            touch.startX = mid.x;
            touch.startY = mid.y;
            touch.lastX = state.x;
            touch.lastY = state.y;
        }
    }

    function onPointerMove(e) {
        if (!touch.active || state.locked) return;

        touch.pointers.set(e.pointerId, e);

        if (touch.pointers.size === 1) {
            const dx = e.clientX - touch.startX;
            const dy = e.clientY - touch.startY;
            state.x = touch.lastX + dx;
            state.y = touch.lastY + dy;
        } else if (touch.pointers.size === 2) {
            const pts = Array.from(touch.pointers.values());
            const dist = getDistance(pts[0], pts[1]);
            const angle = getAngle(pts[0], pts[1]);
            const mid = getMidpoint(pts[0], pts[1]);

            const scaleRatio = dist / touch.startDist;
            state.scale = Math.max(0.05, Math.min(10, touch.startScale * scaleRatio));

            state.rotation = touch.startRotation + (angle - touch.startAngle);

            const dx = mid.x - touch.startX;
            const dy = mid.y - touch.startY;
            state.x = touch.lastX + dx;
            state.y = touch.lastY + dy;
        }

        updateOverlayTransform();
    }

    function onPointerUp(e) {
        touch.pointers.delete(e.pointerId);

        if (touch.pointers.size === 0) {
            touch.active = false;
        } else if (touch.pointers.size === 1) {
            const remaining = Array.from(touch.pointers.values())[0];
            touch.startX = remaining.clientX;
            touch.startY = remaining.clientY;
            touch.lastX = state.x;
            touch.lastY = state.y;
        }
    }

    // Mouse wheel zoom (desktop)
    function onWheel(e) {
        if (state.locked) return;
        e.preventDefault();

        const delta = e.deltaY > 0 ? 0.95 : 1.05;
        state.scale = Math.max(0.05, Math.min(10, state.scale * delta));
        updateOverlayTransform();
    }

    // ── UI Helpers ──

    function showScreen(name) {
        els.landingScreen.classList.remove('active');
        els.cameraScreen.classList.remove('active');

        if (name === 'landing') {
            els.landingScreen.classList.add('active');
        } else if (name === 'camera') {
            els.cameraScreen.classList.add('active');
        }
    }

    function showError(message) {
        els.errorMessage.textContent = message;
        els.errorOverlay.hidden = false;
    }

    function hideError() {
        els.errorOverlay.hidden = true;
    }

    function setOpacity(value) {
        state.opacity = value / 100;
        els.opacityValue.textContent = value + '%';
        updateOverlayTransform();
    }

    function resetOverlay() {
        if (state.imageWidth && state.imageHeight) {
            fitImageToScreen();
            state.opacity = 0.5;
            els.opacitySlider.value = 50;
            els.opacityValue.textContent = '50%';
            updateOverlayTransform();
        }
    }

    function toggleLock() {
        state.locked = !state.locked;
        els.lockBtn.classList.toggle('active', state.locked);
        els.overlayImage.classList.toggle('locked', state.locked);
        els.statusText.textContent = state.locked
            ? 'Overlay locked'
            : 'Adjust your overlay';
    }

    // ── Event Binding ──

    function init() {
        // Upload area click
        on(els.uploadArea, 'click', function () {
            els.imageInput.click();
        });

        // File input change
        on(els.imageInput, 'change', function (e) {
            if (e.target.files && e.target.files[0]) {
                loadImage(e.target.files[0]);
            }
        });

        // Drag and drop
        on(els.uploadArea, 'dragover', function (e) {
            e.preventDefault();
            e.stopPropagation();
            els.uploadArea.classList.add('dragover');
        });

        on(els.uploadArea, 'dragleave', function (e) {
            e.preventDefault();
            e.stopPropagation();
            els.uploadArea.classList.remove('dragover');
        });

        on(els.uploadArea, 'drop', function (e) {
            e.preventDefault();
            e.stopPropagation();
            els.uploadArea.classList.remove('dragover');
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                loadImage(e.dataTransfer.files[0]);
            }
        });

        // Sample image
        on(els.sampleBtn, 'click', function () {
            setOverlayImage(createSampleImage());
        });

        // Opacity slider
        on(els.opacitySlider, 'input', function (e) {
            setOpacity(parseInt(e.target.value, 10));
        });

        // Prevent slider from triggering overlay drag
        on(els.opacitySlider, 'pointerdown', function (e) {
            e.stopPropagation();
        });

        // Back button
        on(els.backBtn, 'click', function () {
            stopCamera();
            els.overlayImage.classList.remove('loaded');
            els.overlayImage.src = '';
            state.overlayImage = null;
            state.locked = false;
            els.lockBtn.classList.remove('active');
            els.overlayImage.classList.remove('locked');
            showScreen('landing');
        });

        // Switch camera
        on(els.switchCameraBtn, 'click', function () {
            switchCamera();
        });

        // Reset
        on(els.resetBtn, 'click', resetOverlay);

        // Lock
        on(els.lockBtn, 'click', toggleLock);

        // New image button
        on(els.newImageBtn, 'click', function () {
            els.newImageInput.click();
        });

        on(els.newImageInput, 'change', function (e) {
            if (e.target.files && e.target.files[0]) {
                loadImage(e.target.files[0]);
            }
        });

        // Error overlay
        on(els.errorRetryBtn, 'click', function () {
            hideError();
            if (state.overlayImage) {
                startCamera();
            }
        });

        on(els.errorDismissBtn, 'click', hideError);

        // Touch/pointer events on overlay container
        const container = els.overlayContainer;
        on(container, 'pointerdown', onPointerDown);
        on(container, 'pointermove', onPointerMove);
        on(container, 'pointerup', onPointerUp);
        on(container, 'pointercancel', onPointerUp);
        on(container, 'wheel', onWheel, { passive: false });

        // Prevent default touch behaviors on the camera screen
        on(els.cameraScreen, 'touchmove', function (e) {
            if (e.target !== els.opacitySlider) {
                e.preventDefault();
            }
        }, { passive: false });

        // Handle orientation changes
        on(window, 'resize', function () {
            if (state.overlayImage && els.cameraScreen.classList.contains('active')) {
                updateOverlayTransform();
            }
        });

        // Keyboard shortcuts (desktop)
        on(document, 'keydown', function (e) {
            if (!els.cameraScreen.classList.contains('active')) return;

            if (e.key === 'r' || e.key === 'R') {
                resetOverlay();
            } else if (e.key === 'l' || e.key === 'L') {
                toggleLock();
            } else if (e.key === 'Escape') {
                els.backBtn.click();
            } else if (e.key === '+' || e.key === '=') {
                state.scale = Math.min(10, state.scale * 1.1);
                updateOverlayTransform();
            } else if (e.key === '-' || e.key === '_') {
                state.scale = Math.max(0.05, state.scale * 0.9);
                updateOverlayTransform();
            } else if (e.key === '[') {
                state.rotation -= 5;
                updateOverlayTransform();
            } else if (e.key === ']') {
                state.rotation += 5;
                updateOverlayTransform();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setOpacity(Math.min(100, parseInt(els.opacitySlider.value, 10) + 5));
                els.opacitySlider.value = state.opacity * 100;
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpacity(Math.max(0, parseInt(els.opacitySlider.value, 10) - 5));
                els.opacitySlider.value = state.opacity * 100;
            }
        });
    }

    // ── Start ──
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
