const PH_MIN = 0;
const PH_MAX = 14;
const NEUTRAL_PH = 7;
const SERIAL_BAUD = 9600;
const VIDEO_W = 640;
const VIDEO_H = 480;
const PROCESS_SCALE = 0.56;
const PROCESS_W = Math.floor(VIDEO_W * PROCESS_SCALE);
const PROCESS_H = Math.floor(VIDEO_H * PROCESS_SCALE);
const GRID_STEP = 2;
const NOISE_SCALE = 0.014;
const CHAOS_MAX = 4;
const PH_SMOOTHING = 0.08;
const PIXEL_SAMPLE_EVERY = 2;
const FOREGROUND_THRESHOLD = 0.18;
const FOREGROUND_STRONG_THRESHOLD = 0.42;
const DEPTH_STRENGTH = 72;
const BODY_FILL_STRENGTH = 2.0;
const BODY_NEIGHBOR_BLEND = 0.55;
const EDGE_STRENGTH = 0.18;
const MOTION_STRENGTH = 0.12;
const BACKGROUND_WARMUP_FRAMES = 45;
const BACKGROUND_LEARN_RATE = 0.15;
const BACKGROUND_HOLD_THRESHOLD = 0.05;

let capture;
let captureReady = false;
let bootMessageEl;
let processBuffer;
let processPixels = null;
let pointGrid = [];
let drawW = 0;
let drawH = 0;
let backgroundBrightness = null;
let backgroundWarmupFrame = 0;
let backgroundReady = false;
let bgLayer;

const PH_COLORS = [
  [175, 1, 2],    // pH 1 (Baterías)
  [224, 0, 0],    // pH 2 (Limón)
  [253, 1, 0],    // pH 3 (Vinagre)
  [255, 125, 5],  // pH 4 (Tomate)
  [251, 174, 58], // pH 5 (Café)
  [255, 219, 1],  // pH 6 (Leche)
  [202, 222, 101],// pH 7 (Agua)
  [169, 202, 1],  // pH 8 (Sangre)
  [1, 171, 0],    // pH 9 (Clara de huevo)
  [63, 130, 93],  // pH 10 (Bicarbonato)
  [157, 227, 237],// pH 11 (Amoniaco)
  [11, 175, 210], // pH 12 (Jabón)
  [74, 114, 186], // pH 13 (Cloro)
  [97, 63, 150]   // pH 14 (Destapacaños)
];

let currentPh = NEUTRAL_PH;
let targetPh = NEUTRAL_PH;
let lastPhUpdateMs = 0;

let serialPort = null;
let serialReader = null;
let serialBuffer = "";
let serialReconnectTimer = null;
let serialOpening = false;
let serialClosing = false;
let authorizedPorts = [];

let startInProgress = false;
let startupComplete = false;

const textDecoder = new TextDecoder();

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  pixelDensity(1);
  frameRate(30);
  noFill();
  strokeCap(ROUND);
  processBuffer = createGraphics(PROCESS_W, PROCESS_H);
  processBuffer.pixelDensity(1);
  backgroundBrightness = new Float32Array(PROCESS_W * PROCESS_H);
  updateDrawMetrics();
  bgLayer = createGraphics(width, height);
  rebuildPointGrid();

  bootMessageEl = document.getElementById("boot-message");

  registerInteractionHandlers();
  registerSerialListeners();
  void prepareAuthorizedPorts();
}

function draw() {
  currentPh = lerp(currentPh, targetPh, PH_SMOOTHING);

  if (!captureReady) {
    // Aún esperando la cámara, no hacer nada.
    return;
  }

  // --- LÓGICA DE CAOS INVERTIDO ---
  const chaosNorm = pow(constrain(map(currentPh, PH_MIN, PH_MAX, 1, 0), 0, 1), 2.0);

  // --- LÓGICA DE FONDO DINÁMICO ---
  // El nivel de desenfoque y la visibilidad del fondo dependen del pH.
  const bgBlur = map(chaosNorm, 0, 1, 2, 20); // Menos blur a mayor pH.
  const bgAlpha = map(chaosNorm, 0, 1, 220, 0); // Más visible a mayor pH.

  // Dibuja la imagen de la cámara en la capa de fondo con el desenfoque calculado.
  bgLayer.push();
  bgLayer.translate(width, 0);
  bgLayer.scale(-1, 1);
  bgLayer.image(capture, 0, 0, width, height);
  bgLayer.pop();
  bgLayer.filter(BLUR, bgBlur);

  // Dibuja el fondo 2D con la transparencia calculada.
  push();
  translate(-width / 2, -height / 2);
  tint(255, bgAlpha);
  image(bgLayer, 0, 0, width, height);
  noTint();
  pop();

  refreshProcessFrame();
  if (!processPixels) {
    return;
  }

  updateBackgroundModel();
  if (!backgroundReady) {
    return;
  }

  const chaosAmplitude = lerp(0, CHAOS_MAX, chaosNorm);
  const noiseDrift = lerp(0.12, 0.65, chaosNorm);

  const now = millis() * 0.001;
  const timeA = now * noiseDrift;
  const timeB = now * (noiseDrift * 0.82 + 0.05) + 12.0;
  const timeC = now * 1.2; // Una segunda capa de ruido más rápida y constante

  // --- PROPUESTA 2: PULSO DE ENERGÍA ---
  const pulseFrequency = lerp(1.0, 12.0, chaosNorm); // La velocidad del pulso depende del caos
  const pulseSignal = (sin(now * pulseFrequency) + 1) / 2; // Onda sinusoidal de 0 a 1
  const pulseWeight = lerp(0, 2.5, chaosNorm) * pulseSignal; // Amplitud del pulso de tamaño
  const pointWeight = lerp(2.8, 4.5, chaosNorm) + pulseWeight;

  strokeWeight(pointWeight);
  beginShape(POINTS);

  for (const pointData of pointGrid) {
    // El código de detección de figura se mueve a una función para mayor claridad
    const pointState = getPointState(pointData);
    if (pointState.fillBody <= 0.025) {
      continue;
    }

    const { fillBody, alpha, depth } = pointState;

    const noiseA = noise(pointData.noiseX, pointData.noiseY, timeA) - 0.5;
    const noiseB = noise(pointData.noiseX + 19.4, pointData.noiseY + 11.2, timeB) - 0.5;
    const noiseC = noise(pointData.noiseX - 25.1, pointData.noiseY + 33.7, timeC) - 0.5;

    const chaosFactor = lerp(0.1, 1.0, fillBody);
    const offsetX = (noiseA * 1.15 + noiseB * 0.45 + noiseC * 0.35) * chaosAmplitude * chaosFactor * 0.8;
    const offsetY = (noiseB * 1.05 - noiseA * 0.35 + noiseC * 0.45) * chaosAmplitude * chaosFactor * 0.8;
    const offsetZ = (noiseA + noiseB) * chaosAmplitude * 0.32 * chaosFactor;

    // --- LÓGICA DE COLOR CON DEGRADADO ---
    const phFloor = floor(currentPh);
    const lerpAmt = currentPh - phFloor;
    const index1 = constrain(phFloor - 1, 0, PH_COLORS.length - 1);
    const index2 = constrain(ceil(currentPh) - 1, 0, PH_COLORS.length - 1);
    const r = lerp(PH_COLORS[index1][0], PH_COLORS[index2][0], lerpAmt);
    const g = lerp(PH_COLORS[index1][1], PH_COLORS[index2][1], lerpAmt);
    const b = lerp(PH_COLORS[index1][2], PH_COLORS[index2][2], lerpAmt);

    const pulseBrightness = lerp(0, 80, chaosNorm) * pulseSignal;

    stroke(
      constrain(r + pulseBrightness, 0, 255),
      constrain(g + pulseBrightness, 0, 255),
      constrain(b + pulseBrightness, 0, 255),
      alpha
    );
    vertex(pointData.baseX + offsetX, pointData.baseY + offsetY, depth + offsetZ);
  }
  endShape();

  if (serialPort && millis() - lastPhUpdateMs > 5000) {
    targetPh = lerp(targetPh, NEUTRAL_PH, 0.01);
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  updateDrawMetrics();
  bgLayer.resize(width, height);
  rebuildPointGrid();
}

function registerInteractionHandlers() {
  window.addEventListener("pointerdown", handleStartInteraction);
  window.addEventListener("keydown", handleStartInteraction);
}

function registerSerialListeners() {
  if (!("serial" in navigator)) {
    setBootMessage("Abre este sketch en Chrome o Edge y haz clic para iniciar.");
    return;
  }

  navigator.serial.addEventListener("disconnect", () => {
    void handleSerialDisconnect();
  });
}

async function prepareAuthorizedPorts() {
  if (!("serial" in navigator)) {
    return;
  }

  try {
    authorizedPorts = await navigator.serial.getPorts();
    if (authorizedPorts.length > 0) {
      await openSerialPort(authorizedPorts[0]);
      if (captureReady) {
        hideBootMessage();
      } else {
        setBootMessage("Haz clic una vez para activar la camara.");
      }
    }
  } catch (error) {
    console.warn("No se pudieron leer los puertos autorizados.", error);
  }
}

function handleStartInteraction() {
  if (startInProgress) {
    return;
  }

  if (startupComplete && captureReady && serialPort) {
    return;
  }

  void beginExperience();
}

async function beginExperience() {
  startInProgress = true;

  try {
    if (!serialPort) {
      if (!("serial" in navigator)) {
        throw new Error("Web Serial no esta disponible aqui. Usa Chrome o Edge.");
      }

      if (authorizedPorts.length > 0) {
        await openSerialPort(authorizedPorts[0]);
      } else {
        const requestedPort = await navigator.serial.requestPort();
        authorizedPorts = [requestedPort];
        await openSerialPort(requestedPort);
      }
    }

    if (!captureReady) {
      await setupCamera();
    }

    startupComplete = true;
    hideBootMessage();
  } catch (error) {
    const message = formatStartError(error);
    setBootMessage(message);
    console.error(error);
  } finally {
    startInProgress = false;
  }
}

function formatStartError(error) {
  if (!error) {
    return "No se pudo iniciar. Haz clic para reintentar.";
  }

  if (error.name === "NotFoundError") {
    return "No se eligio un puerto serial. Haz clic para reintentar.";
  }

  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return "Permiso denegado. Da acceso a camara y serial, luego haz clic otra vez.";
  }

  return error.message || "No se pudo iniciar. Haz clic para reintentar.";
}

async function setupCamera() {
  if (captureReady) {
    return;
  }

  capture = await new Promise((resolve, reject) => {
    const video = createCapture(
      {
        audio: false,
        video: {
          width: { ideal: VIDEO_W },
          height: { ideal: VIDEO_H },
          frameRate: { ideal: 30, max: 30 }
        }
      },
      () => resolve(video)
    );

    video.elt.addEventListener(
      "error",
      () => reject(new Error("No se pudo acceder a la camara.")),
      { once: true }
    );
  });

  capture.size(VIDEO_W, VIDEO_H);
  capture.hide();
  captureReady = true;
}

function refreshProcessFrame() {
  if (frameCount % PIXEL_SAMPLE_EVERY !== 0 && processPixels) {
    return;
  }

  processBuffer.push();
  processBuffer.translate(PROCESS_W, 0);
  processBuffer.scale(-1, 1);
  processBuffer.image(capture, 0, 0, PROCESS_W, PROCESS_H);
  processBuffer.pop();
  processBuffer.loadPixels();

  if (processBuffer.pixels.length) {
    processPixels = processBuffer.pixels;
  }
}

function updateDrawMetrics() {
  const drawScale = max(width / PROCESS_W, height / PROCESS_H); // Usar 'max' para cubrir toda la pantalla
  drawW = PROCESS_W * drawScale;
  drawH = PROCESS_H * drawScale;
}

function rebuildPointGrid() {
  pointGrid = [];

  for (let y = 0; y < PROCESS_H; y += GRID_STEP) {
    const py = (y / (PROCESS_H - 1) - 0.5) * drawH;

    for (let x = 0; x < PROCESS_W; x += GRID_STEP) {
      const px = (x / (PROCESS_W - 1) - 0.5) * drawW;
      const pixelNumber = x + y * PROCESS_W;
      pointGrid.push({
        pixelNumber,
        pixelIndex: pixelNumber * 4,
        leftPixelNumber: max(x - GRID_STEP, 0) + y * PROCESS_W,
        upPixelNumber: x + max(y - GRID_STEP, 0) * PROCESS_W,
        rightPixelNumber: min(x + GRID_STEP, PROCESS_W - 1) + y * PROCESS_W,
        downPixelNumber: x + min(y + GRID_STEP, PROCESS_H - 1) * PROCESS_W,
        leftIndex: (max(x - GRID_STEP, 0) + y * PROCESS_W) * 4,
        upIndex: (x + max(y - GRID_STEP, 0) * PROCESS_W) * 4,
        rightIndex: ((min(x + GRID_STEP, PROCESS_W - 1)) + y * PROCESS_W) * 4,
        downIndex: (x + min(y + GRID_STEP, PROCESS_H - 1) * PROCESS_W) * 4,
        baseX: px,
        baseY: py,
        noiseX: x * NOISE_SCALE,
        noiseY: y * NOISE_SCALE,
        lastBrightness: 0,
        skipOdd: ((x / GRID_STEP + y / GRID_STEP) & 1) === 1
      });
    }
  }
}

function getBrightnessAt(index, fallbackBrightness) {
  if (index < 0 || index + 2 >= processPixels.length) {
    return fallbackBrightness;
  }

  return (
    processPixels[index] * 0.299 +
    processPixels[index + 1] * 0.587 +
    processPixels[index + 2] * 0.114
  );
}

function updateBackgroundModel() {
  for (const pointData of pointGrid) {
    const index = pointData.pixelIndex;
    const pixelNumber = pointData.pixelNumber;
    const brightness =
      processPixels[index] * 0.299 +
      processPixels[index + 1] * 0.587 +
      processPixels[index + 2] * 0.114;

    if (!backgroundReady) {
      const current = backgroundBrightness[pixelNumber];
      backgroundBrightness[pixelNumber] = current === 0
        ? brightness
        : lerp(current, brightness, 0.25);
      continue;
    }

    // El fondo siempre se adapta un poco para evitar que se congele.
    let learnRate = BACKGROUND_LEARN_RATE * 0.1;

    const foregroundSignal = abs(brightness - backgroundBrightness[pixelNumber]) / 255;
    if (foregroundSignal < FOREGROUND_THRESHOLD) {
      // Si no hay figura, se adapta mucho más rápido.
      learnRate = BACKGROUND_LEARN_RATE;
    }
    backgroundBrightness[pixelNumber] = lerp(backgroundBrightness[pixelNumber], brightness, learnRate);
  }

  if (!backgroundReady) {
    backgroundWarmupFrame += 1;
    if (backgroundWarmupFrame >= BACKGROUND_WARMUP_FRAMES) {
      backgroundReady = true;
    }
  }
}

async function openSerialPort(port) {
  if (serialPort || serialOpening) {
    return;
  }

  serialOpening = true;

  try {
    await port.open({ baudRate: SERIAL_BAUD });
    serialPort = port;
    serialBuffer = "";
    hideBootMessage();
    clearReconnectTimer();
    void readSerialLoop(port);
  } finally {
    serialOpening = false;
  }
}

async function readSerialLoop(port) {
  try {
    serialReader = port.readable.getReader();

    while (true) {
      const { value, done } = await serialReader.read();
      if (done) {
        break;
      }

      if (value) {
        handleSerialChunk(textDecoder.decode(value, { stream: true }));
      }
    }
  } catch (error) {
    if (!serialClosing) {
      console.warn("La lectura serial termino de forma inesperada.", error);
    }
  } finally {
    if (serialReader) {
      try {
        serialReader.releaseLock();
      } catch (error) {
        console.warn("No se pudo liberar el reader serial.", error);
      }
      serialReader = null;
    }

    if (serialPort === port) {
      serialPort = null;
    }

    try {
      await port.close();
    } catch (error) {
      if (!serialClosing) {
        console.warn("No se pudo cerrar el puerto serial.", error);
      }
    }

    if (!serialClosing) {
      await handleSerialDisconnect();
    }

    serialClosing = false;
  }
}

function handleSerialChunk(chunk) {
  serialBuffer += chunk;
  const lines = serialBuffer.split(/\r?\n/);
  serialBuffer = lines.pop() || "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const parsed = parseFloat(trimmed);
    if (!Number.isFinite(parsed)) {
      continue;
    }

    if (parsed < PH_MIN || parsed > PH_MAX) {
      continue;
    }

    targetPh = parsed;
    lastPhUpdateMs = millis();
  }
}

async function handleSerialDisconnect() {
  if (serialOpening) {
    return;
  }

  if (captureReady) {
    setBootMessage("Serial desconectado. Reconectando...");
  }

  await prepareAuthorizedPorts();

  if (!serialPort) {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (serialReconnectTimer !== null) {
    return;
  }

  serialReconnectTimer = window.setInterval(async () => {
    if (serialPort || serialOpening) {
      clearReconnectTimer();
      return;
    }

    try {
      authorizedPorts = await navigator.serial.getPorts();
      if (authorizedPorts.length > 0) {
        await openSerialPort(authorizedPorts[0]);
        if (captureReady) {
          hideBootMessage();
        } else {
          setBootMessage("Haz clic una vez para activar la camara.");
        }
      }
    } catch (error) {
      console.warn("No se pudo reintentar la conexion serial.", error);
    }
  }, 2500);
}

function clearReconnectTimer() {
  if (serialReconnectTimer !== null) {
    window.clearInterval(serialReconnectTimer);
    serialReconnectTimer = null;
  }
}

function hideBootMessage() {
  document.body.classList.add("running");
}

function setBootMessage(message) {
  if (bootMessageEl) {
    bootMessageEl.textContent = message;
  }
  document.body.classList.remove("running");
}

/**
 * Calcula el estado de un punto (figura, fondo, etc.) para el frame actual.
 * @param {object} pointData - Los datos del punto de la rejilla.
 * @returns {object} Un objeto con fillBody, alpha, y depth.
 */
function getPointState(pointData) {
  const index = pointData.pixelIndex;
  const r = processPixels[index];
  const g = processPixels[index + 1];
  const b = processPixels[index + 2];

  const brightness = r * 0.299 + g * 0.587 + b * 0.114;
  const bgBrightness = backgroundBrightness[pointData.pixelNumber];
  const rightBrightness = getBrightnessAt(pointData.rightIndex, brightness);
  const downBrightness = getBrightnessAt(pointData.downIndex, brightness);
  const edge = ((abs(brightness - rightBrightness) + abs(brightness - downBrightness)) * 0.5) / 255;
  const motion = abs(brightness - pointData.lastBrightness) / 255;
  const foreground = abs(brightness - bgBrightness) / 255;
  const leftBrightness = getBrightnessAt(pointData.leftIndex, brightness);
  const upBrightness = getBrightnessAt(pointData.upIndex, brightness);
  const rightForeground = abs(rightBrightness - backgroundBrightness[pointData.rightPixelNumber]) / 255;
  const downForeground = abs(downBrightness - backgroundBrightness[pointData.downPixelNumber]) / 255;
  const leftForeground = abs(leftBrightness - backgroundBrightness[pointData.leftPixelNumber]) / 255;
  const upForeground = abs(upBrightness - backgroundBrightness[pointData.upPixelNumber]) / 255;
  const neighborForeground =
    (foreground + rightForeground + downForeground + leftForeground + upForeground) / 5;
  const localForeground = max(
    foreground,
    rightForeground,
    downForeground,
    leftForeground,
    upForeground
  );
  const amplifiedBody = pow(localForeground, 0.75) * 2.5;
  const body = constrain(
    map(amplifiedBody, FOREGROUND_THRESHOLD, FOREGROUND_STRONG_THRESHOLD, 0, 1),
    0,
    1
  );
  const denseBody = constrain(
    lerp(body, constrain(map(neighborForeground, FOREGROUND_THRESHOLD * 0.75, FOREGROUND_STRONG_THRESHOLD, 0, 1), 0, 1), BODY_NEIGHBOR_BLEND),
    0,
    1
  );
  const fillBody = constrain(denseBody * BODY_FILL_STRENGTH + localForeground * 0.28, 0, 1);
  pointData.lastBrightness = brightness;

  const alpha = constrain(50 + fillBody * 205, 0, 255);
  const depth = map(fillBody, 0, 1, -12, DEPTH_STRENGTH);

  return { fillBody, alpha, depth };
}
