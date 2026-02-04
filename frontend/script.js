/* global createCanvas, windowWidth, windowHeight, width, height, background, push, translate, scale, noStroke, fill, rect, stroke, strokeWeight, noFill, pop, dist, mouseX, mouseY, pmouseX, pmouseY, touches, frameCount, mouseIsPressed, resizeCanvas, createVector, constrain, mouseButton, RIGHT, CENTER, LEFT, millis */

const PIXEL_SIZE = 25; 
const BOARD_SIZE = 50;
const CANVAS_SIZE = PIXEL_SIZE * BOARD_SIZE;
const COOLDOWN_TIME = 5;
const PANEL_HEIGHT = 280;

// 🔥 DOKUNMATİK AYARLARI 🔥
const DOUBLE_TAP_TIME = 400;    // Çift tıklama algılama süresi
const PAN_THRESHOLD = 10;       // Kaydırma sayılması için gereken minimum hareket

let grid = [];
let zoom = 1.0;
let offsetX = 0, offsetY = 0;
let socket;
let isLoggedIn = false;
let userDept = "";

let selectedPixel = null;
let selectedColor = "#000000";
let lastPlaceTime = 0;
let isCooldown = false;

// Efekt Listesi
let activeEffects = [];

// 🔥 DOKUNMATİK DURUM DEĞİŞKENLERİ 🔥
let touchState = {
    touches: [],
    firstTouchId: null,
    lastTapTime: 0,
    tapCount: 0,
    isPanning: false,     // Şu an kaydırıyor mu?
    panStartX: 0,         // Kaydırma başlangıç X
    panStartY: 0,         // Kaydırma başlangıç Y
    pinchStartDist: 0,    // Pinch (kıstırma) başlangıç mesafesi
    startZoom: 1.0        // Pinch başladığındaki zoom seviyesi
};

let loginScreen, gameUI, bottomPanel, msgText;
let emailInput, deptInput, codeInput, stepEmail, stepCode;

// Ses Motoru
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playPop() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
}

function playError() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.15);
}

function setup() {
    let cnv = createCanvas(windowWidth, windowHeight);
    cnv.style('display', 'block');
    cnv.style('touch-action', 'none'); // Tarayıcının zoom/scroll'unu kapat
    document.oncontextmenu = function() { return false; }

    offsetX = (windowWidth - CANVAS_SIZE) / 2;
    offsetY = (windowHeight - CANVAS_SIZE) / 2;

    setupTouchEvents();
    
    loginScreen = document.getElementById('login-screen');
    gameUI = document.getElementById('game-ui');
    bottomPanel = document.getElementById('bottom-panel');
    msgText = document.getElementById('login-msg');
    stepEmail = document.getElementById('step-email');
    stepCode = document.getElementById('step-code');
    emailInput = document.getElementById('email-input');
    deptInput = document.getElementById('dept-input');
    codeInput = document.getElementById('code-input');

    setupUI();
    setupLoginEvents();
}

// Modern Event Listener'lar (Daha performanslı)
function setupTouchEvents() {
    let canvas = document.querySelector('canvas');
    
    // { passive: false } sayesinde preventDefault() çalışır ve sayfa kaymaz
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    
    // Mouse (PC) desteği
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('wheel', handleMouseWheel, { passive: false });
}

function draw() {
    background('#050505');
    if (!isLoggedIn) return;

    push();
    translate(offsetX, offsetY);
    scale(zoom);

    fill(255); noStroke();
    rect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    if (zoom > 1.5) { 
        stroke(180); 
        strokeWeight(0.5 / zoom); 
    } else { 
        noStroke(); 
    }

    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            let color = (grid[y] && grid[y][x]) ? grid[y][x] : "#FFFFFF";
            fill(color);
            rect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
        }
    }

    updateEffects();

    if (selectedPixel) {
        stroke(0); strokeWeight(3 / zoom); noFill();
        rect(selectedPixel.x * PIXEL_SIZE, selectedPixel.y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
        stroke(255, 255, 0); strokeWeight(1.5 / zoom);
        rect(selectedPixel.x * PIXEL_SIZE, selectedPixel.y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
    }
    pop();
    
    updateCooldown();
}

// 🔥 GELİŞMİŞ DOKUNMATİK MANTIĞI 🔥

function handleTouchStart(e) {
    if (!isLoggedIn || isMouseOnUI()) { e.preventDefault(); return; }
    e.preventDefault();
    
    updateTouchState(e.touches);
    
    if (touchState.touches.length === 1) {
        // Tek parmak: Pan (Kaydırma) hazırlığı
        touchState.isPanning = false;
        touchState.panStartX = touchState.touches[0].x;
        touchState.panStartY = touchState.touches[0].y;
        touchState.firstTouchId = e.touches[0].identifier;

    } else if (touchState.touches.length === 2) {
        // İki parmak: Pinch (Zoom) hazırlığı
        touchState.pinchStartDist = dist(
            touchState.touches[0].x, touchState.touches[0].y,
            touchState.touches[1].x, touchState.touches[1].y
        );
        touchState.startZoom = zoom; // Başlangıç zoom'unu kaydet
    }
}

function handleTouchMove(e) {
    if (!isLoggedIn || isMouseOnUI()) { e.preventDefault(); return; }
    e.preventDefault();
    
    // Dokunma durumunu güncellemeden önce işlem yap
    let currentTouches = Array.from(e.touches).map(t => ({x: t.clientX, y: t.clientY, id: t.identifier}));

    if (currentTouches.length === 1 && touchState.firstTouchId === e.touches[0].identifier) {
        // --- PAN (KAYDIRMA) ---
        let touch = currentTouches[0];
        let dx = touch.x - touchState.panStartX;
        let dy = touch.y - touchState.panStartY;

        // Eğer hareket eşiği aşıldıysa "Kaydırıyor" moduna geç
        if (!touchState.isPanning && (Math.abs(dx) > PAN_THRESHOLD || Math.abs(dy) > PAN_THRESHOLD)) {
            touchState.isPanning = true;
        }

        if (touchState.isPanning) {
            offsetX += dx;
            offsetY += dy;
            // Yeni referans noktası
            touchState.panStartX = touch.x;
            touchState.panStartY = touch.y;
        }

    } else if (currentTouches.length === 2) {
        // --- PINCH (ZOOM) ---
        let currentDist = dist(
            currentTouches[0].x, currentTouches[0].y,
            currentTouches[1].x, currentTouches[1].y
        );
        
        // Sıfıra bölme hatasını önle
        if (touchState.pinchStartDist > 0) {
            let scaleFactor = currentDist / touchState.pinchStartDist;
            let newZoom = constrain(touchState.startZoom * scaleFactor, 0.3, 25);
            
            // Zoom'u iki parmağın ortasına göre yap
            let centerX = (currentTouches[0].x + currentTouches[1].x) / 2;
            let centerY = (currentTouches[0].y + currentTouches[1].y) / 2;
            
            // Zoom değişince offset'i de ayarla ki merkez kaymasın
            offsetX -= (centerX - offsetX) * (newZoom / zoom - 1);
            offsetY -= (centerY - offsetY) * (newZoom / zoom - 1);
            
            zoom = newZoom;
        }
    }
    
    updateTouchState(e.touches);
}

function handleTouchEnd(e) {
    if (!isLoggedIn || isMouseOnUI()) { e.preventDefault(); return; }
    e.preventDefault();
    
    // --- KRİTİK DÜZELTME BURADA ---
    // Eğer parmak kalktıysa (touches boşaldı) ve son hareket bir "Pan" değilse, bu bir TIKLAMADIR.
    if (e.changedTouches.length > 0 && e.touches.length === 0) {
        // Kalkan parmağın son konumunu al
        let lastTouch = {
            x: e.changedTouches[0].clientX,
            y: e.changedTouches[0].clientY
        };

        if (!touchState.isPanning) {
            handlePotentialTap(lastTouch);
        }
    }
    
    // Durumları sıfırla
    updateTouchState(e.touches);
    if (e.touches.length === 0) {
        touchState.isPanning = false;
        touchState.firstTouchId = null;
    }
}

function updateTouchState(touches) {
    touchState.touches = Array.from(touches).map(touch => ({
        x: touch.clientX,
        y: touch.clientY,
        id: touch.identifier
    }));
}

function handlePotentialTap(touch) {
    let now = millis();
    let tapDuration = now - (touchState.lastTapTime || 0);
    
    // Çift Tıklama Kontrolü (İstersen kapatabilirsin)
    if (tapDuration < DOUBLE_TAP_TIME) {
        touchState.tapCount++;
        if (touchState.tapCount === 2) {
            handleDoubleTap(touch);
            touchState.tapCount = 0;
            return;
        }
    } else {
        touchState.tapCount = 1;
    }
    
    touchState.lastTapTime = now;
    
    // Tek Tıklama (Biraz gecikmeli çalışır ki çift tık mı diye beklesin)
    setTimeout(() => {
        if (touchState.tapCount === 1) {
            handleSingleTap(touch.x, touch.y);
            touchState.tapCount = 0;
        }
    }, DOUBLE_TAP_TIME);
}

function handleSingleTap(mx, my) {
    if (!bottomPanel.classList.contains('closed')) {
        selectedPixel = null;
        closePanel();
        return;
    }

    let gridX = Math.floor(((mx - offsetX) / zoom) / PIXEL_SIZE);
    let gridY = Math.floor(((my - offsetY) / zoom) / PIXEL_SIZE);

    if (gridX >= 0 && gridX < BOARD_SIZE && gridY >= 0 && gridY < BOARD_SIZE) {
        if (!isCooldown) {
            selectedPixel = { x: gridX, y: gridY };
            openPanel();
        } else {
            playError();
        }
    }
}

function handleDoubleTap(touch) {
    // Çift tıklanan yere zoom yap
    let mx = touch.x;
    let my = touch.y;
    
    let targetZoom = zoom < 3 ? 5 : 1.0; // Yakınsa uzaklaş, uzaksa yakınlaş
    targetZoom = constrain(targetZoom, 0.3, 25);
    
    offsetX -= (mx - offsetX) * (targetZoom/zoom - 1);
    offsetY -= (my - offsetY) * (targetZoom/zoom - 1);
    zoom = targetZoom;
}

// --- MOUSE (PC) FALLBACK ---
// PC'de de aynı mantık çalışsın diye
let isMouseDown = false;
let mouseStartX = 0, mouseStartY = 0;
let isMousePanning = false;

function handleMouseDown(e) {
    if (!isLoggedIn || isMouseOnUI()) return;
    isMouseDown = true;
    mouseStartX = e.clientX;
    mouseStartY = e.clientY;
    isMousePanning = false;
}

function handleMouseMove(e) {
    if (!isLoggedIn || !isMouseDown) return;
    
    let dx = e.clientX - mouseStartX;
    let dy = e.clientY - mouseStartY;
    
    // Mouse ile sürükleme
    if (!isMousePanning && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        isMousePanning = true;
    }
    
    if (isMousePanning) {
        offsetX += e.movementX;
        offsetY += e.movementY;
    }
}

function handleMouseUp(e) {
    if (!isLoggedIn || isMouseOnUI()) return;
    isMouseDown = false;
    
    // Eğer sürüklemediysek, bu bir tıklamadır
    if (!isMousePanning) {
        handleSingleTap(e.clientX, e.clientY);
    }
}

function handleMouseWheel(e) {
    if (!isLoggedIn) return;
    e.preventDefault();
    let factor = e.deltaY > 0 ? 0.9 : 1.1;
    let newZoom = constrain(zoom * factor, 0.3, 25);
    
    offsetX -= (mouseX - offsetX) * (newZoom/zoom - 1);
    offsetY -= (mouseY - offsetY) * (newZoom/zoom - 1);
    zoom = newZoom;
}

function updateEffects() {
    for (let i = activeEffects.length - 1; i >= 0; i--) {
        let fx = activeEffects[i];
        fx.life -= 5;
        if (fx.life <= 0) {
            activeEffects.splice(i, 1);
        } else {
            noFill();
            stroke(255, 255, 255, fx.life * 2.5);
            strokeWeight((2 + (100 - fx.life) / 10) / zoom);
            let size = PIXEL_SIZE + (100 - fx.life) / 2;
            rect(fx.x * PIXEL_SIZE - (size - PIXEL_SIZE)/2, fx.y * PIXEL_SIZE - (size - PIXEL_SIZE)/2, size, size);
        }
    }
}

function isMouseOnUI() {
    if (!bottomPanel.classList.contains('closed') && mouseY > height - PANEL_HEIGHT) return true;
    return false;
}

function setupUI() {
    document.querySelectorAll('.color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active'); 
            selectedColor = btn.getAttribute('data-color');
        });
    });
    document.getElementById('btn-cancel').addEventListener('click', () => { 
        selectedPixel = null; 
        closePanel(); 
    });
    document.getElementById('btn-confirm').addEventListener('click', () => {
        if (selectedPixel && socket && socket.readyState === WebSocket.OPEN) {
            playPop();
            socket.send(JSON.stringify({ 
                type: "pixel_update", 
                x: selectedPixel.x, 
                y: selectedPixel.y, 
                color: selectedColor 
            }));
            selectedPixel = null; 
            closePanel(); 
            startCooldown();
        }
    });
}

function setupLoginEvents() {
    document.getElementById('btn-send-code').addEventListener('click', async () => {
        let email = emailInput.value.trim();
        let dept = deptInput.value;
        if (!email.endsWith("@ogr.iu.edu.tr")) { 
            msgText.innerText = "Hata: Mail @ogr.iu.edu.tr olmalı!"; 
            playError();
            return; 
        }
        if (!dept) { 
            msgText.innerText = "Bölüm seçin!"; 
            playError();
            return; 
        }
        try {
            await fetch('/api/send-code', { 
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({ email, bolum: dept }) 
            });
            stepEmail.classList.add('hidden'); 
            stepCode.classList.remove('hidden'); 
            userDept = dept; 
            msgText.innerText = "";
        } catch(e) {
            playError();
        }
    });
    
    document.getElementById('btn-verify').addEventListener('click', async () => {
        if (codeInput.value.trim()) { 
            try {
                await fetch('/api/verify', { 
                    method: 'POST', 
                    headers: {'Content-Type': 'application/json'}, 
                    body: JSON.stringify({ email: emailInput.value, code: codeInput.value }) 
                }); 
                isLoggedIn = true; 
                loginScreen.classList.add('hidden'); 
                gameUI.classList.remove('hidden'); 
                document.getElementById('user-info').innerText = userDept; 
                connectWebSocket();
            } catch(e) {
                playError();
            }
        }
    });
    
    document.getElementById('btn-back').addEventListener('click', () => { 
        stepCode.classList.add('hidden'); 
        stepEmail.classList.remove('hidden'); 
    });
}

function connectWebSocket() {
    let wsUrl = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + "/ws";
    socket = new WebSocket(wsUrl);
    socket.onopen = () => console.log("WebSocket bağlandı");
    socket.onmessage = (e) => { 
        let data = JSON.parse(e.data); 
        if (data.type === "init") { 
            grid = data.board; 
        } else if (data.type === "update") {
            if(grid[data.y]) grid[data.y][data.x] = data.color;
            activeEffects.push({ x: data.x, y: data.y, life: 100 });
        }
    };
    socket.onerror = (e) => console.error("WebSocket hatası:", e);
}

function openPanel() { bottomPanel.classList.remove('closed'); }
function closePanel() { bottomPanel.classList.add('closed'); }
function startCooldown() { 
    isCooldown = true; 
    lastPlaceTime = Date.now(); 
    document.getElementById('cooldown-toast')?.classList.remove('hidden'); 
}
function updateCooldown() { 
    if (isCooldown) { 
        let rem = Math.ceil(COOLDOWN_TIME - (Date.now() - lastPlaceTime) / 1000); 
        if (rem <= 0) { 
            isCooldown = false; 
            document.getElementById('cooldown-toast')?.classList.add('hidden'); 
        } else { 
            document.getElementById('timer-text') && (document.getElementById('timer-text').innerText = "0" + rem); 
        } 
    } 
}
function windowResized() { 
    resizeCanvas(windowWidth, windowHeight); 
    if (isLoggedIn) { 
        offsetX = (windowWidth - CANVAS_SIZE * zoom) / 2; 
        offsetY = (windowHeight - CANVAS_SIZE * zoom) / 2; 
    } 
}