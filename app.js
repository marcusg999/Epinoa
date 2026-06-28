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
        cameraReady: false,
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
        cameraLoading: $('#camera-loading'),
        httpsWarning: $('#https-warning'),
    };

    // ── Secure Context Check ──

    function isSecureContext() {
        if (window.isSecureContext) return true;
        var loc = window.location;
        if (loc.protocol === 'https:') return true;
        if (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') return true;
        return false;
    }

    function checkCameraSupport() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            if (!isSecureContext()) {
                if (els.httpsWarning) els.httpsWarning.hidden = false;
                return 'insecure';
            }
            return 'unsupported';
        }
        return 'supported';
    }

    // ── Image Loading ──

    function loadImage(file) {
        if (!file || !file.type.startsWith('image/')) {
            showError('Please select a valid image file.');
            return;
        }

        var reader = new FileReader();
        reader.onload = function (e) {
            setOverlayImage(e.target.result);
        };
        reader.onerror = function () {
            showError('Failed to read the image file.');
        };
        reader.readAsDataURL(file);
    }

    function setOverlayImage(src) {
        var img = new Image();
        img.onload = function () {
            state.imageWidth = img.naturalWidth;
            state.imageHeight = img.naturalHeight;

            fitImageToScreen();

            els.overlayImage.src = src;
            els.overlayImage.classList.add('loaded');
            state.overlayImage = src;

            updateOverlayTransform();
            showScreen('camera');
            showCameraLoading(true);
            startCamera();
        };
        img.onerror = function () {
            showError('Failed to load the image.');
        };
        img.src = src;
    }

    function fitImageToScreen() {
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var imgAspect = state.imageWidth / state.imageHeight;
        var screenAspect = vw / vh;

        var displayW, displayH;
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
        var canvas = document.createElement('canvas');
        canvas.width = 600;
        canvas.height = 800;
        var ctx = canvas.getContext('2d');

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

    function showCameraLoading(show) {
        if (els.cameraLoading) {
            els.cameraLoading.hidden = !show;
        }
    }

    async function startCamera() {
        var support = checkCameraSupport();
        if (support !== 'supported') {
            showCameraLoading(false);
            state.cameraReady = false;
            if (support === 'insecure') {
                els.statusText.textContent = 'HTTPS required for camera';
                showError(
                    'Camera requires a secure connection (HTTPS). ' +
                    'Please access this app via HTTPS to enable the camera for AR tracing. ' +
                    'Your reference image is loaded — you can still view it.'
                );
            } else {
                els.statusText.textContent = 'Camera not supported';
                showError(
                    'Your browser does not support camera access. ' +
                    'Try using Chrome, Safari, or Firefox on your phone. ' +
                    'Your reference image is loaded — you can still view it.'
                );
            }
            return;
        }

        els.statusText.textContent = 'Starting camera...';

        try {
            if (state.cameraStream) {
                state.cameraStream.getTracks().forEach(function (t) { t.stop(); });
                state.cameraStream = null;
            }

            var stream = await tryGetCamera();
            state.cameraStream = stream;
            els.cameraFeed.srcObject = stream;

            await els.cameraFeed.play();

            state.cameraReady = true;
            showCameraLoading(false);
            els.statusText.textContent = 'Position your paper below — adjust overlay to trace';
        } catch (err) {
            showCameraLoading(false);
            state.cameraReady = false;
            handleCameraError(err);
        }
    }

    async function tryGetCamera() {
        // Try 1: Preferred facing mode with ideal resolution
        try {
            return await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: state.facingMode },
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: false,
            });
        } catch (e) {
            if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
                throw e;
            }
        }

        // Try 2: Preferred facing mode, no resolution constraint
        try {
            return await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: state.facingMode } },
                audio: false,
            });
        } catch (e) {
            if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
                throw e;
            }
        }

        // Try 3: Any camera
        try {
            return await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false,
            });
        } catch (e) {
            throw e;
        }
    }

    function handleCameraError(err) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            els.statusText.textContent = 'Camera access denied';
            showError(
                'Camera access was denied. The camera shows your drawing surface ' +
                '(paper/canvas) so you can trace the reference image onto it.\n\n' +
                'To enable:\n' +
                '• iOS Safari: Settings > Safari > Camera > Allow\n' +
                '• Android Chrome: Tap the lock icon in the address bar > Permissions > Camera > Allow\n\n' +
                'Then tap Retry below.'
            );
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            els.statusText.textContent = 'No camera found';
            showError(
                'No camera was found on this device. ' +
                'The camera is needed to show your drawing surface for AR tracing. ' +
                'Please use a device with a camera (phone or tablet).'
            );
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
            els.statusText.textContent = 'Camera busy';
            showError(
                'The camera is being used by another app. ' +
                'Close any other apps using the camera (video calls, other camera apps) and tap Retry.'
            );
        } else if (err.name === 'OverconstrainedError') {
            els.statusText.textContent = 'Camera error';
            showError(
                'Could not start the camera with the requested settings. Tap Retry to try again.'
            );
        } else {
            els.statusText.textContent = 'Camera error';
            showError(
                'Could not access camera: ' + (err.message || 'Unknown error') + '. ' +
                'Make sure no other app is using the camera and tap Retry.'
            );
        }
    }

    async function switchCamera() {
        state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
        showCameraLoading(true);
        await startCamera();
    }

    function stopCamera() {
        if (state.cameraStream) {
            state.cameraStream.getTracks().forEach(function (t) { t.stop(); });
            state.cameraStream = null;
        }
        els.cameraFeed.srcObject = null;
        state.cameraReady = false;
    }

    // ── Overlay Transform ──

    function updateOverlayTransform() {
        var tx = state.x;
        var ty = state.y;
        var s = state.scale;
        var r = state.rotation;

        els.overlayImage.style.transform =
            'translate(-50%, -50%) ' +
            'translate(' + tx + 'px, ' + ty + 'px) ' +
            'scale(' + s + ') ' +
            'rotate(' + r + 'deg)';

        els.overlayImage.style.opacity = state.opacity;
    }

    // ── Touch/Pointer Handling ──

    function getDistance(p1, p2) {
        var dx = p2.clientX - p1.clientX;
        var dy = p2.clientY - p1.clientY;
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
            var pts = Array.from(touch.pointers.values());
            touch.startDist = getDistance(pts[0], pts[1]);
            touch.startAngle = getAngle(pts[0], pts[1]);
            touch.startScale = state.scale;
            touch.startRotation = state.rotation;

            var mid = getMidpoint(pts[0], pts[1]);
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
            var dx = e.clientX - touch.startX;
            var dy = e.clientY - touch.startY;
            state.x = touch.lastX + dx;
            state.y = touch.lastY + dy;
        } else if (touch.pointers.size === 2) {
            var pts = Array.from(touch.pointers.values());
            var dist = getDistance(pts[0], pts[1]);
            var angle = getAngle(pts[0], pts[1]);
            var mid = getMidpoint(pts[0], pts[1]);

            var scaleRatio = dist / touch.startDist;
            state.scale = Math.max(0.05, Math.min(10, touch.startScale * scaleRatio));

            state.rotation = touch.startRotation + (angle - touch.startAngle);

            var dx2 = mid.x - touch.startX;
            var dy2 = mid.y - touch.startY;
            state.x = touch.lastX + dx2;
            state.y = touch.lastY + dy2;
        }

        updateOverlayTransform();
    }

    function onPointerUp(e) {
        touch.pointers.delete(e.pointerId);

        if (touch.pointers.size === 0) {
            touch.active = false;
        } else if (touch.pointers.size === 1) {
            var remaining = Array.from(touch.pointers.values())[0];
            touch.startX = remaining.clientX;
            touch.startY = remaining.clientY;
            touch.lastX = state.x;
            touch.lastY = state.y;
        }
    }

    function onWheel(e) {
        if (state.locked) return;
        e.preventDefault();

        var delta = e.deltaY > 0 ? 0.95 : 1.05;
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
            ? 'Overlay locked — trace onto your surface'
            : 'Position your paper below — adjust overlay to trace';
    }

    // ── Event Binding ──

    function init() {
        // Check camera support on load
        checkCameraSupport();

        on(els.uploadArea, 'click', function () {
            els.imageInput.click();
        });

        on(els.imageInput, 'change', function (e) {
            if (e.target.files && e.target.files[0]) {
                loadImage(e.target.files[0]);
            }
        });

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

        on(els.sampleBtn, 'click', function () {
            setOverlayImage(createSampleImage());
        });

        on(els.opacitySlider, 'input', function (e) {
            setOpacity(parseInt(e.target.value, 10));
        });

        on(els.opacitySlider, 'pointerdown', function (e) {
            e.stopPropagation();
        });

        on(els.backBtn, 'click', function () {
            stopCamera();
            els.overlayImage.classList.remove('loaded');
            els.overlayImage.src = '';
            state.overlayImage = null;
            state.locked = false;
            els.lockBtn.classList.remove('active');
            els.overlayImage.classList.remove('locked');
            showCameraLoading(false);
            showScreen('landing');
        });

        on(els.switchCameraBtn, 'click', function () {
            switchCamera();
        });

        on(els.resetBtn, 'click', resetOverlay);

        on(els.lockBtn, 'click', toggleLock);

        on(els.newImageBtn, 'click', function () {
            els.newImageInput.click();
        });

        on(els.newImageInput, 'change', function (e) {
            if (e.target.files && e.target.files[0]) {
                loadImage(e.target.files[0]);
            }
        });

        on(els.errorRetryBtn, 'click', function () {
            hideError();
            if (state.overlayImage) {
                showCameraLoading(true);
                startCamera();
            }
        });

        on(els.errorDismissBtn, 'click', hideError);

        // Touch/pointer events on overlay container
        var container = els.overlayContainer;
        on(container, 'pointerdown', onPointerDown);
        on(container, 'pointermove', onPointerMove);
        on(container, 'pointerup', onPointerUp);
        on(container, 'pointercancel', onPointerUp);
        on(container, 'wheel', onWheel, { passive: false });

        on(els.cameraScreen, 'touchmove', function (e) {
            if (e.target !== els.opacitySlider) {
                e.preventDefault();
            }
        }, { passive: false });

        on(window, 'resize', function () {
            if (state.overlayImage && els.cameraScreen.classList.contains('active')) {
                updateOverlayTransform();
            }
        });

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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
