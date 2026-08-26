(() => {
  if (document.getElementById("teacher-day-plane-flights")) return;

  const keyword = new URLSearchParams(location.search).get("wd") || "";
  if (location.protocol !== "file:" && !keyword.includes("教师节")) return;

  const VERSION = "planes-826-71";
  const assetUrl = (path) => new URL(`plane-assets/${path}?v=${VERSION}`, document.baseURI || location.href).href;
  const guideButtonUrl = new URL(`guide-button.png?v=${VERSION}`, document.baseURI || location.href).href;
  const guideLightUrl = new URL(`guide-light.png?v=${VERSION}`, document.baseURI || location.href).href;
  const planeFolders = ["blue", "green", "pink", "orange", "yellow"];
  const blueCopyFiles = ["10.png", "5.png"];
  const otherCopyFiles = ["1.png", "2.png", "3.png", "4.png", "6.png", "7.png", "8.png", "9.png"];
  const copyQueues = new Map();
  const copyLastFiles = new Map();
  const planeDisplayScale = 1;
  const yellowDisplayScale = 1;
  const maxActivePlanes = 6;
  const guideWaitDuration = 3000;
  const clock = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

  const waitForImage = (image) => new Promise((resolve) => {
    const finish = () => {
      if (typeof image.decode !== "function") {
        resolve();
        return;
      }
      image.decode().catch(() => {}).finally(resolve);
    };
    if (image.complete) finish();
    else {
      image.addEventListener("load", finish, { once: true });
      image.addEventListener("error", finish, { once: true });
    }
  });

  const planeImageCache = new Map(planeFolders.map((folder) => {
    const image = new Image();
    image.decoding = "async";
    image.src = assetUrl(`planes/${folder}/plane.png`);
    return [folder, image];
  }));
  const guideButtonImage = new Image();
  guideButtonImage.decoding = "async";
  guideButtonImage.src = guideButtonUrl;
  const guideLightImage = new Image();
  guideLightImage.decoding = "async";
  guideLightImage.src = guideLightUrl;

  const flightsStage = document.createElement("div");
  flightsStage.id = "teacher-day-plane-flights";
  flightsStage.setAttribute("aria-live", "polite");

  const guide = document.createElement("div");
  guide.className = "teacher-day-plane-guide";
  guide.alt = "点击纸飞机有惊喜";
  guide.setAttribute("aria-hidden", "true");
  const guideLight = document.createElement("img");
  guideLight.className = "teacher-day-plane-guide-light";
  guideLight.alt = "";
  guideLight.decoding = "async";
  guideLight.src = guideLightUrl;
  const guideButton = document.createElement("img");
  guideButton.className = "teacher-day-plane-guide-button";
  guideButton.alt = "点击纸飞机有惊喜";
  guideButton.decoding = "async";
  guideButton.src = guideButtonUrl;
  guide.append(guideLight, guideButton);
  flightsStage.appendChild(guide);
  document.body.appendChild(flightsStage);

  let disposed = false;
  let phase = "entry";
  let flights = [];
  let entryRemaining = 0;
  const spawnTimers = new Set();
  let replacementSequence = 0;
  let pendingSpawnCount = 0;
  let respawnEnabled = true;
  let guideTimer = 0;
  let departureSpeed = 480;

  const cubicPoint = (p0, p1, p2, p3, t) => {
    const inverse = 1 - t;
    return {
      x: inverse ** 3 * p0.x + 3 * inverse ** 2 * t * p1.x + 3 * inverse * t ** 2 * p2.x + t ** 3 * p3.x,
      y: inverse ** 3 * p0.y + 3 * inverse ** 2 * t * p1.y + 3 * inverse * t ** 2 * p2.y + t ** 3 * p3.y,
    };
  };

  const cubicTangent = (p0, p1, p2, p3, t) => ({
    x: 3 * (1 - t) ** 2 * (p1.x - p0.x) + 6 * (1 - t) * t * (p2.x - p1.x) + 3 * t ** 2 * (p3.x - p2.x),
    y: 3 * (1 - t) ** 2 * (p1.y - p0.y) + 6 * (1 - t) * t * (p2.y - p1.y) + 3 * t ** 2 * (p3.y - p2.y),
  });

  const routeTAtProgress = (route, progress) => {
    if (!route.distanceTable) {
      const samples = 96;
      const table = [{ t: 0, distance: 0 }];
      let previous = route.p0;
      let distance = 0;
      for (let index = 1; index <= samples; index += 1) {
        const t = index / samples;
        const point = cubicPoint(route.p0, route.p1, route.p2, route.p3, t);
        distance += Math.hypot(point.x - previous.x, point.y - previous.y);
        table.push({ t, distance });
        previous = point;
      }
      route.distanceTable = table;
      route.totalDistance = distance;
    }
    const target = Math.max(0, Math.min(1, progress)) * route.totalDistance;
    const table = route.distanceTable;
    let low = 1;
    let high = table.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (table[middle].distance < target) low = middle + 1;
      else high = middle;
    }
    const next = table[low];
    const previous = table[Math.max(0, low - 1)];
    const span = next.distance - previous.distance;
    const local = span > 0 ? (target - previous.distance) / span : 0;
    return previous.t + (next.t - previous.t) * local;
  };

  const routeLength = (route) => {
    routeTAtProgress(route, 1);
    return route.totalDistance;
  };

  const durationForFlightRoute = (route) => Math.max(1600, routeLength(route) / departureSpeed * 1000);

  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
  // The artwork's nose is 22deg above its local x-axis. A vertical flip
  // mirrors that offset, so every route can derive its heading from the
  // existing final CSS rotation without changing the artwork itself.
  const noseOffset = (flipY, flipX = false) => {
    const baseAngle = flipY ? 22 : -22;
    if (!flipX) return baseAngle;
    // Mirroring on the horizontal axis changes the local nose direction
    // without turning the artwork upside down.
    return 180 - baseAngle;
  };
  const headingFromRotation = (rotate, flipY, flipX = false) => (rotate + noseOffset(flipY, flipX)) * Math.PI / 180;
  const rotationFromTangent = (tangent, flipY, flipX = false) => {
    const tangentAngle = Math.atan2(tangent.y, tangent.x) * 180 / Math.PI;
    return tangentAngle - noseOffset(flipY, flipX);
  };
  const unitVector = (angle) => ({ x: Math.cos(angle), y: Math.sin(angle) });
  const normalVector = (direction) => ({ x: -direction.y, y: direction.x });

  const applyTransform = (element, point, rotate, scale = 1, flipY = false, flipX = false) => {
    element.style.transform = `translate3d(${point.x}px, ${point.y}px, 0) translate(-50%, -50%) rotate(${rotate}deg) scale(${scale}) scaleX(${flipX ? -1 : 1}) scaleY(${flipY ? -1 : 1})`;
  };

  const readElementRotation = (element, fallback = 0) => {
    if (!element) return fallback;
    const transform = window.getComputedStyle(element).transform;
    if (!transform || transform === "none") return fallback;
    try {
      const matrix = typeof DOMMatrixReadOnly === "function"
        ? new DOMMatrixReadOnly(transform)
        : new DOMMatrix(transform);
      return Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
    } catch {
      const values = transform.match(/^matrix(?:3d)?\(([^)]+)\)$/)?.[1]
        ?.split(",")
        .map((value) => Number.parseFloat(value.trim()));
      if (values && values.length >= 6 && Number.isFinite(values[0]) && Number.isFinite(values[1])) {
        return Math.atan2(values[1], values[0]) * 180 / Math.PI;
      }
      return fallback;
    }
  };

  const normalizeAngle = (angle) => {
    const normalized = angle % 360;
    return normalized > 180 ? normalized - 360 : normalized < -180 ? normalized + 360 : normalized;
  };

  const textRotationCorrection = (paperRotate) => {
    const normalized = normalizeAngle(Number.isFinite(paperRotate) ? paperRotate : 0);
    return normalized > 90 || normalized < -90 ? 180 : 0;
  };

  const readElementCenter = (element, fallback) => {
    if (!element) return fallback;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return fallback;
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  };

  const lockDisplaySize = (element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      element.style.width = `${rect.width}px`;
      element.style.height = `${rect.height}px`;
    }
  };

  const randomCopy = (folder, files) => {
    let queue = copyQueues.get(folder);
    if (!queue || queue.length === 0) {
      queue = [...files];
      for (let index = queue.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [queue[index], queue[swapIndex]] = [queue[swapIndex], queue[index]];
      }
      const previous = copyLastFiles.get(folder);
      if (previous && queue.length > 1 && queue[queue.length - 1] === previous) {
        const swapIndex = Math.floor(Math.random() * (queue.length - 1));
        [queue[queue.length - 1], queue[swapIndex]] = [queue[swapIndex], queue[queue.length - 1]];
      }
    }
    const file = queue.pop();
    copyQueues.set(folder, queue);
    copyLastFiles.set(folder, file);
    return `${folder}/${file}`;
  };

  const makeEntryRoute = (end, rotate, flipY, distance, offset) => {
    const direction = unitVector(headingFromRotation(rotate, flipY, false));
    const normal = normalVector(direction);
    const start = {
      x: end.x - direction.x * distance + normal.x * offset,
      y: end.y - direction.y * distance + normal.y * offset,
    };
    return {
      p0: start,
      // Both endpoint handles follow the nose direction. The offset start
      // gives the cubic a shallow arc without making the plane turn sharply.
      p1: { x: start.x + direction.x * distance * .34, y: start.y + direction.y * distance * .34 },
      p2: { x: end.x - direction.x * distance * .28, y: end.y - direction.y * distance * .28 },
      p3: end,
    };
  };

  const distanceToViewportExit = (point, direction, margin = 300) => {
    const { width, height } = viewport();
    const distances = [];
    if (direction.x > .001) distances.push((width + margin - point.x) / direction.x);
    if (direction.x < -.001) distances.push((-margin - point.x) / direction.x);
    if (direction.y > .001) distances.push((height + margin - point.y) / direction.y);
    if (direction.y < -.001) distances.push((-margin - point.y) / direction.y);
    return Math.max(520, Math.min(...distances.filter((value) => value > 0)) + margin);
  };

  const isOutsideViewport = (point, margin = 180) => {
    const { width, height } = viewport();
    return point.x < -margin || point.x > width + margin || point.y < -margin || point.y > height + margin;
  };

  const isNearForwardExit = (point, direction, margin = 170) => {
    const { width, height } = viewport();
    return (direction.x > .001 && point.x > width - margin)
      || (direction.x < -.001 && point.x < margin)
      || (direction.y > .001 && point.y > height - margin)
      || (direction.y < -.001 && point.y < margin);
  };

  const activePlaneCount = () => flights.filter((flight) =>
    !flight.isYellow
    && flight.plane?.isConnected
    && ["waiting", "flying"].includes(flight.state)
  ).length;

  const hasLiveFirstWavePlane = () => flights.some((flight) =>
    flight.isFirstWave
    && !flight.isYellow
    && flight.plane?.isConnected
    && ["waiting", "flying"].includes(flight.state)
  );

  const stopReplacementGeneration = () => {
    if (!respawnEnabled) return;
    respawnEnabled = false;
    spawnTimers.forEach(clearTimeout);
    spawnTimers.clear();
    pendingSpawnCount = 0;
  };

  const maybeStopReplacementGeneration = () => {
    if (phase === "active" && !hasLiveFirstWavePlane()) stopReplacementGeneration();
  };

  const isInsideRevealZone = (point, margin = 132) => {
    const { width, height } = viewport();
    return point.x >= margin
      && point.x <= width - margin
      && point.y >= margin
      && point.y <= height - margin;
  };

  const makeDepartureRoute = (flight, index) => {
    const direction = unitVector(headingFromRotation(flight.rotate, flight.flipY, flight.flipX));
    const normal = normalVector(direction);
    const distance = distanceToViewportExit(flight.point, direction, 320);
    // Keep opposing headings on separate sides of the crossing. Each lane is
    // assigned a stable signed offset so the arcs do not converge in the page.
    const offsets = [-180, -180, 170, 180, -140];
    const offset = offsets[index % offsets.length];
    const start = { ...flight.point };
    const end = {
      x: start.x + direction.x * distance + normal.x * offset,
      y: start.y + direction.y * distance + normal.y * offset,
    };
    return {
      p0: start,
      p1: {
        x: start.x + direction.x * Math.min(260, distance * .28),
        y: start.y + direction.y * Math.min(260, distance * .28),
      },
      p2: {
        x: end.x - direction.x * Math.min(300, distance * .3),
        y: end.y - direction.y * Math.min(300, distance * .3),
      },
      p3: end,
    };
  };

  const makeTransitRoute = (rotate, flipY, index) => {
    const { width, height } = viewport();
    const direction = unitVector(headingFromRotation(rotate, flipY));
    const normal = normalVector(direction);
    const laneOffsets = [-110, 54, 128, -42, 86, -138];
    const lane = laneOffsets[index % laneOffsets.length];
    const curve = index % 2 ? 145 : -155;
    const center = {
      x: width * .5 + normal.x * lane,
      y: height * .52 + normal.y * lane,
    };
    // Start just beyond the first viewport edge on the plane's forward path.
    // This keeps replacement planes entering promptly without shortening the
    // slow, curved crossing through the page.
    const entryBase = {
      x: center.x + normal.x * curve,
      y: center.y + normal.y * curve,
    };
    const entryMargin = 34;
    const entryDistances = [];
    if (direction.x > .001) entryDistances.push((entryBase.x + entryMargin) / direction.x);
    if (direction.x < -.001) entryDistances.push((width + entryMargin - entryBase.x) / -direction.x);
    if (direction.y > .001) entryDistances.push((entryBase.y + entryMargin) / direction.y);
    if (direction.y < -.001) entryDistances.push((height + entryMargin - entryBase.y) / -direction.y);
    const validEntryDistances = entryDistances.filter((distance) => Number.isFinite(distance) && distance > 0);
    const fallbackSpan = Math.max(width, height) * .58;
    const span = Math.max(260, validEntryDistances.length ? Math.min(...validEntryDistances) : fallbackSpan);
    const start = {
      x: center.x - direction.x * span + normal.x * curve,
      y: center.y - direction.y * span + normal.y * curve,
    };
    const end = {
      x: center.x + direction.x * span - normal.x * curve * .55,
      y: center.y + direction.y * span - normal.y * curve * .55,
    };
    return {
      p0: start,
      p1: { x: start.x + direction.x * span * .56, y: start.y + direction.y * span * .56 },
      p2: { x: end.x - direction.x * span * .48, y: end.y - direction.y * span * .48 },
      p3: end,
    };
  };

  const makePinkTransitRoute = () => {
    const { width, height } = viewport();
    // Enter from the upper-middle right and leave through the lower-middle
    // left. The control points create one broad, gentle arc instead of a
    // diagonal line across the page.
    return {
      p0: { x: width + 90, y: height * .30 },
      p1: { x: width * .78, y: height * .34 },
      p2: { x: width * .34, y: height * .64 },
      p3: { x: -90, y: height * .70 },
    };
  };

  const renderEffectFrame = (video, canvas, renderState) => {
    if (!video.videoWidth || video.readyState < 2 || disposed) return false;

    if (!renderState.layout) {
      const horizontal = video.videoWidth >= video.videoHeight;
      const half = Math.floor((horizontal ? video.videoWidth : video.videoHeight) / 2);
      renderState.layout = horizontal
        ? { color: { x: half, y: 0, w: half, h: video.videoHeight }, alpha: { x: 0, y: 0, w: half, h: video.videoHeight } }
        : { color: { x: 0, y: half, w: video.videoWidth, h: half }, alpha: { x: 0, y: 0, w: video.videoWidth, h: half } };
      canvas.width = renderState.layout.color.w;
      canvas.height = renderState.layout.color.h;
      renderState.workCanvas = document.createElement("canvas");
      renderState.workCanvas.width = video.videoWidth;
      renderState.workCanvas.height = video.videoHeight;
      renderState.workCtx = renderState.workCanvas.getContext("2d", { willReadFrequently: true });
      renderState.composite = document.createElement("canvas");
      renderState.composite.width = canvas.width;
      renderState.composite.height = canvas.height;
      renderState.compositeCtx = renderState.composite.getContext("2d");
      canvas.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    }

    const { color, alpha } = renderState.layout;
    renderState.workCtx.clearRect(0, 0, video.videoWidth, video.videoHeight);
    renderState.workCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

    let colorData;
    let alphaData;
    try {
      colorData = renderState.workCtx.getImageData(color.x, color.y, color.w, color.h);
      alphaData = renderState.workCtx.getImageData(alpha.x, alpha.y, alpha.w, alpha.h);
    } catch {
      return false;
    }

    if (renderState.alphaInverted === undefined) {
      let edge = 0;
      [[2, 2], [alpha.w - 3, 2], [2, alpha.h - 3], [alpha.w - 3, alpha.h - 3]].forEach(([x, y]) => {
        const safeX = Math.max(0, Math.min(alpha.w - 1, x));
        const safeY = Math.max(0, Math.min(alpha.h - 1, y));
        edge += alphaData.data[(safeY * alpha.w + safeX) * 4];
      });
      renderState.alphaInverted = edge / 4 > 127;
    }

    const pixels = colorData.data;
    const mask = alphaData.data;
    let visibleCoverage = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const luma = mask[index] * .299 + mask[index + 1] * .587 + mask[index + 2] * .114;
      const rawAlpha = renderState.alphaInverted ? 255 - luma : luma;
      const progress = Math.max(0, Math.min(1, (rawAlpha - 46) / 170));
      const easedProgress = progress * progress * (3 - 2 * progress);
      pixels[index + 3] = easedProgress * 255;
      visibleCoverage += easedProgress;
    }

    // The greeting is a static image, while the paper's alpha is animated in
    // the video. Expose the same normalized progress to the text layer so it
    // cannot become readable before the paper is visually present.
    const pixelCount = pixels.length / 4;
    const coverage = pixelCount > 0 ? visibleCoverage / pixelCount : 0;
    renderState.maxRevealCoverage = Math.max(renderState.maxRevealCoverage || 0, coverage);
    const coverageProgress = renderState.maxRevealCoverage > 0
      ? Math.min(1, coverage / renderState.maxRevealCoverage)
      : 0;
    renderState.revealProgress = Math.max(renderState.revealProgress || 0, coverageProgress);

    renderState.compositeCtx.putImageData(colorData, 0, 0);
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(renderState.composite, 0, 0);
    return true;
  };

  const removeFlight = (flight) => {
    if (flight.raf) cancelAnimationFrame(flight.raf);
    if (flight.entryTimer) clearTimeout(flight.entryTimer);
    if (flight.cleanupTimer) clearTimeout(flight.cleanupTimer);
    if (flight.fadeTimer) clearTimeout(flight.fadeTimer);
    if (flight.handoffTimer) clearTimeout(flight.handoffTimer);
    flight.video?.pause();
    [flight.plane, flight.hit, flight.reveal, flight.effect, flight.copyWrap, flight.video].forEach((element) => element?.remove());
  };

  const cleanupOpenedFlight = (flight) => {
    flight.reveal?.classList.remove("is-visible");
    flight.effect?.classList.remove("is-visible");
    flight.copy?.classList.remove("is-opening");
    flight.cleanupTimer = setTimeout(() => {
      removeFlight(flight);
      maybeRemoveStage();
    }, 420);
  };

  const openBlessing = (flight) => {
    if (!flight || !["waiting", "flying"].includes(flight.state)) return;

    // `flight.rotate` is the unmirrored angle used for the last rendered
    // plane frame. A computed CSS matrix includes scaleX/scaleY reflections,
    // which would turn a left-up heading into a left-down reveal angle.
    const planeRotate = Number.isFinite(flight.rotate)
      ? flight.rotate
      : readElementRotation(flight.plane, 0);
    // The reveal video is authored as a front-facing, right-up plane. For a
    // plane travelling left, mirror the reveal horizontally so its top side
    // stays facing up instead of achieving the leftward heading with a
    // vertical flip. The clicked plane's heading still determines the exact
    // rotation, including any curve-induced angle at the click instant.
    const planeHeading = headingFromRotation(planeRotate, flight.flipY, flight.flipX);
    const revealFlipX = Math.cos(planeHeading) < 0;
    const revealNoseOffset = noseOffset(false, revealFlipX);
    const lockedRotate = normalizeAngle(
      planeRotate + noseOffset(flight.flipY, flight.flipX) - revealNoseOffset
    );
    const lockedPoint = readElementCenter(flight.plane, flight.point);
    flight.point = lockedPoint;
    flight.state = "opening";
    if (flight.raf) cancelAnimationFrame(flight.raf);
    flight.hit.style.pointerEvents = "none";

    const reveal = document.createElement("div");
    reveal.className = "teacher-day-plane-reveal";
    const effect = document.createElement("canvas");
    effect.className = "teacher-day-plane-effect";
    const copyWrap = document.createElement("div");
    copyWrap.className = "teacher-day-plane-copy-wrap";
    const copy = document.createElement("img");
    copy.className = "teacher-day-plane-copy";
    copy.alt = "教师节祝福";
    const copyFolder = flight.folder === "blue" ? "copy-blue-random" : "copy-random";
    const copyFiles = flight.folder === "blue" ? blueCopyFiles : otherCopyFiles;
    copy.src = assetUrl(randomCopy(copyFolder, copyFiles));
    const video = flight.video;

    flight.effect = effect;
    flight.copyWrap = copyWrap;
    flight.reveal = reveal;
    flight.copy = copy;
    flight.video = video;
    flight.renderState = {};
    copyWrap.appendChild(copy);
    reveal.append(effect, copyWrap);
    flightsStage.appendChild(reveal);
    lockDisplaySize(effect);

    const interactionPaperScale = 1;
    const paperEffectScale = 1.4;
    const blessingScale = .82 * interactionPaperScale;
    const blessingTextScale = .756;
    applyTransform(effect, lockedPoint, lockedRotate, paperEffectScale, false, revealFlipX);
    applyTransform(copyWrap, lockedPoint, lockedRotate, 1, false, revealFlipX);
    // Keep the paper's original angle, but turn the text upright whenever the
    // inherited rotation would put its top edge below the baseline.
    const copyCorrection = textRotationCorrection(lockedRotate);
    // The parent mirror keeps the paper front-facing; cancel it on the text
    // itself so the greeting remains readable and never becomes mirrored.
    copy.style.transform = `rotate(${copyCorrection}deg) scale(${blessingTextScale * blessingScale}) scaleX(${revealFlipX ? -1 : 1})`;
    const syncCopyToPaper = () => {
      const videoProgress = Number.isFinite(video.duration) && video.duration > 0
        ? Math.max(0, Math.min(1, video.currentTime / video.duration))
        : 0;
      const paperProgress = Number.isFinite(flight.renderState.revealProgress)
        ? flight.renderState.revealProgress
        : videoProgress;
      // Gate the text by both clocks and hold it until the paper is in its
      // final opening phase. This keeps the greeting from becoming readable
      // while the paper is still visibly unfolding.
      const syncedProgress = Math.min(videoProgress, paperProgress);
      const textRevealStart = .42;
      const textProgress = Math.max(0, Math.min(1, (syncedProgress - textRevealStart) / (1 - textRevealStart)));
      copy.style.opacity = `${textProgress}`;
    };

    const finishEffect = () => {
      if (disposed || flight.state !== "opening" || flight.effectFinished) return;
      flight.effectFinished = true;
      if (flight.cleanupTimer) clearTimeout(flight.cleanupTimer);
      renderEffectFrame(video, effect, flight.renderState);
      syncCopyToPaper();
      flight.cleanupTimer = setTimeout(() => cleanupOpenedFlight(flight), 2600);
    };

    const playEffect = () => {
      if (flight.state !== "opening") return;
      // Decode the text before starting the video so both layers become
      // visible on the same animation frame. The parent owns visibility;
      // children retain their existing dimensions, transforms, and scale.
      const waitForVideoData = () => {
        if (video.readyState >= 2) return Promise.resolve();
        return new Promise((resolve) => {
          const ready = () => resolve();
          video.addEventListener("loadeddata", ready, { once: true });
          video.addEventListener("error", ready, { once: true });
        });
      };
      Promise.all([waitForImage(copy), waitForVideoData()]).then(() => {
        if (flight.state !== "opening") return;
        // Paint the video's first frame while the shared parent is still
        // hidden, so the text can never become visible before the paper.
        renderEffectFrame(video, effect, flight.renderState);
        syncCopyToPaper();
        reveal.classList.add("is-visible");
        effect.classList.add("is-visible");
        copy.classList.add("is-opening");
        video.play().catch(() => {});
        // Keep the clicked plane visible until the effect canvas has a real
        // visible frame. The video can report metadata before its first
        // decoded frame is painted; hiding the plane on a fixed timer creates
        // a brief transparent gap on slower devices.
        const handoffToReveal = () => {
          if (flight.state !== "opening") return;
          const revealProgress = Number.isFinite(flight.renderState.revealProgress)
            ? flight.renderState.revealProgress
            : 0;
          if (revealProgress > .015) {
            flight.handoffTimer = 0;
            flight.plane.style.opacity = "0";
            return;
          }
          flight.handoffTimer = setTimeout(handoffToReveal, 24);
        };
        handoffToReveal();
        const draw = () => {
          if (flight.state !== "opening") return;
          renderEffectFrame(video, effect, flight.renderState);
          syncCopyToPaper();
          if (video.ended) {
            finishEffect();
            return;
          }
          if (typeof video.requestVideoFrameCallback === "function") video.requestVideoFrameCallback(draw);
          else flight.raf = requestAnimationFrame(draw);
        };
        draw();
        flight.cleanupTimer = setTimeout(finishEffect, 1400);
      });
    };

    video.addEventListener("ended", finishEffect, { once: true });
    if (video.readyState >= 1) playEffect();
    else video.addEventListener("loadedmetadata", playEffect, { once: true });
  };

  const animateEntry = (flight) => {
    if (disposed || flight.state !== "entering") return;
    const elapsed = clock() - flight.entryStartedAt;
    const progress = Math.min(1, elapsed / flight.entryDuration);
    const eased = 1 - Math.pow(1 - progress, 1.22);
    const point = cubicPoint(flight.route.p0, flight.route.p1, flight.route.p2, flight.route.p3, eased);
    const tangent = cubicTangent(flight.route.p0, flight.route.p1, flight.route.p2, flight.route.p3, eased);
    const rotate = rotationFromTangent(tangent, flight.flipY, flight.flipX);
    flight.point = point;
    flight.rotate = rotate;
    applyTransform(flight.plane, point, rotate, flight.scale, flight.flipY, flight.flipX);
    applyTransform(flight.hit, point, rotate, flight.scale, flight.flipY, flight.flipX);
    if (progress >= 1) {
      flight.state = "waiting";
      flight.point = flight.route.p3;
      flight.rotate = rotationFromTangent(
        cubicTangent(flight.route.p0, flight.route.p1, flight.route.p2, flight.route.p3, 1),
        flight.flipY,
        flight.flipX
      );
      applyTransform(flight.plane, flight.point, flight.rotate, flight.scale, flight.flipY, flight.flipX);
      applyTransform(flight.hit, flight.point, flight.rotate, flight.scale, flight.flipY, flight.flipX);
      entryRemaining -= 1;
      if (entryRemaining === 0) finishEntry();
      return;
    }
    flight.raf = requestAnimationFrame(() => animateEntry(flight));
  };

  const animateDeparture = (flight) => {
    if (disposed || phase !== "active" || flight.state !== "flying") return;
    const elapsed = clock() - flight.motionStartedAt;
    const progress = Math.min(1, elapsed / flight.motionDuration);
    const routeT = routeTAtProgress(flight.motionRoute, progress);
    const point = cubicPoint(flight.motionRoute.p0, flight.motionRoute.p1, flight.motionRoute.p2, flight.motionRoute.p3, routeT);
    const tangent = cubicTangent(flight.motionRoute.p0, flight.motionRoute.p1, flight.motionRoute.p2, flight.motionRoute.p3, routeT);
    const rotate = rotationFromTangent(tangent, flight.flipY, flight.flipX);
    flight.point = point;
    flight.rotate = rotate;
    applyTransform(flight.plane, point, rotate, flight.scale, flight.flipY, flight.flipX);
    applyTransform(flight.hit, point, rotate, flight.scale, flight.flipY, flight.flipX);
    if (!flight.hasEntered) {
      const entered = flight.revealAfterSafeEntry ? isInsideRevealZone(point) : !isOutsideViewport(point);
      if (entered) {
        flight.hasEntered = true;
        if (flight.revealAfterSafeEntry) {
          flight.plane.style.opacity = "1";
          flight.hit.style.pointerEvents = "auto";
        }
      }
    }
    const direction = unitVector(headingFromRotation(rotate, flight.flipY, flight.flipX));
    if (flight.respawn && flight.hasEntered && !flight.replacementScheduled && isNearForwardExit(point, direction) && phase === "active") {
      flight.replacementScheduled = Boolean(scheduleReplacement(flight.folder));
    }
    // Let planes leave cleanly without showing partial artwork at the edge.
    if (flight.hasEntered && !isInsideRevealZone(point, 72)) {
      flight.plane.style.opacity = "0";
      flight.hit.style.pointerEvents = "none";
    }
    if (flight.respawn && flight.hasEntered && isOutsideViewport(point) && phase === "active") {
      const shouldReplace = !flight.replacementScheduled;
      const replacementFolder = flight.folder;
      flight.respawn = false;
      removeFlight(flight);
      if (shouldReplace && respawnEnabled) scheduleReplacement(replacementFolder, 100);
      maybeStopReplacementGeneration();
      maybeRemoveStage();
      return;
    }
    if (progress >= 1) {
      const shouldReplace = flight.respawn && !flight.replacementScheduled && phase === "active";
      const replacementFolder = flight.folder;
      flight.replacementScheduled = true;
      removeFlight(flight);
      if (shouldReplace && respawnEnabled) scheduleReplacement(replacementFolder);
      maybeStopReplacementGeneration();
      maybeRemoveStage();
      return;
    }
    flight.raf = requestAnimationFrame(() => animateDeparture(flight));
  };

  const hideGuide = () => {
    guide.classList.remove("is-visible");
    guide.classList.add("is-hidden");
    guide.style.pointerEvents = "none";
  };

  const clearGuideTimer = () => {
    if (!guideTimer) return;
    clearTimeout(guideTimer);
    guideTimer = 0;
  };

  const resumeYellowAfterGuideTimeout = (yellowFlight) => {
    guideTimer = 0;
    if (disposed || phase !== "waiting" || yellowFlight.state !== "waiting") return;
    // A timeout ends the guide-only waiting state. Let the current wave leave
    // naturally, but prevent any later colored replacement wave from spawning.
    respawnEnabled = false;
    phase = "active";
    hideGuide();
    yellowFlight.hit.style.pointerEvents = "none";
    yellowFlight.state = "flying";
    yellowFlight.hasEntered = true;
    yellowFlight.respawn = false;
    yellowFlight.motionRoute = makeDepartureRoute(yellowFlight, flights.length);
    yellowFlight.motionStartedAt = clock();
    yellowFlight.motionDuration = durationForFlightRoute(yellowFlight.motionRoute);
    animateDeparture(yellowFlight);
    // The other planes were held in place while the guide was waiting. Once
    // the guide times out, release them on their existing departure routes too.
    startFreeFlights();
  };

  const startFreeFlights = () => {
    flights.filter((flight) => !flight.isYellow).forEach((flight, index) => {
      flight.entryTimer = setTimeout(() => {
        if (disposed || phase !== "active" || flight.state !== "waiting") return;
        flight.state = "flying";
        flight.hit.style.pointerEvents = "auto";
        flight.hasEntered = true;
        flight.motionRoute = makeDepartureRoute(flight, index);
        flight.motionStartedAt = clock();
        flight.respawn = true;
        flight.motionDuration = durationForFlightRoute(flight.motionRoute);
        animateDeparture(flight);
      }, 80 + index * 125);
    });
  };

  const startTransitFlight = (folder, index) => {
    if (disposed || phase !== "active") return;
    const profiles = {
      // Mirror left-to-right so the replacement faces left while keeping the
      // top and bottom of the pink artwork in their original orientation.
      pink: { rotate: -28, flipX: true, flipY: false },
      blue: { rotate: 172, flipY: true },
      green: { rotate: 35, flipY: false },
      orange: { rotate: -163, flipY: true },
      yellow: { rotate: 0, flipY: false },
    };
    const profile = profiles[folder] || profiles.pink;
    const route = folder === "pink"
      ? makePinkTransitRoute()
      : makeTransitRoute(profile.rotate, profile.flipY, index);
    const flight = createFlight({
      folder,
      isYellow: false,
      isFirstWave: false,
      revealAfterSafeEntry: true,
      route,
      startRotate: profile.rotate,
      endRotate: profile.rotate,
      flipX: profile.flipX,
      flipY: profile.flipY,
      entryDuration: 0,
      entryDelay: 0,
    }, flights.length);
    flights.push(flight);
    flight.state = "flying";
    flight.respawn = true;
    flight.hit.style.pointerEvents = "none";
    flight.plane.style.opacity = "0";
    flight.motionRoute = route;
    flight.motionStartedAt = clock();
    flight.motionDuration = durationForFlightRoute(route);
    animateDeparture(flight);
  };

  function scheduleReplacement(folder, delayOverride) {
    if (disposed || phase !== "active" || !respawnEnabled) return false;
    if (activePlaneCount() + pendingSpawnCount >= maxActivePlanes) return false;
    const sequence = replacementSequence++;
    const delay = Number.isFinite(delayOverride) ? delayOverride : 260 + (sequence % 3) * 180;
    let timer = 0;
    pendingSpawnCount += 1;
    const trySpawn = () => {
      spawnTimers.delete(timer);
      if (disposed || phase !== "active") {
        pendingSpawnCount = Math.max(0, pendingSpawnCount - 1);
        return;
      }
      if (activePlaneCount() >= maxActivePlanes) {
        timer = setTimeout(trySpawn, 760 + (sequence % 3) * 120);
        spawnTimers.add(timer);
        return;
      }
      pendingSpawnCount = Math.max(0, pendingSpawnCount - 1);
      startTransitFlight(folder, sequence);
    };
    timer = setTimeout(trySpawn, delay);
    spawnTimers.add(timer);
    return true;
  }

  const maybeRemoveStage = () => {
    if (disposed || !["active", "fading"].includes(phase)) return;
    const hasLiveArtwork = flights.some((flight) =>
      flight.plane?.isConnected || flight.hit?.isConnected || flight.reveal?.isConnected || flight.effect?.isConnected || flight.copyWrap?.isConnected
    );
    if (!hasLiveArtwork) {
      flightsStage.remove();
      phase = "done";
    }
  };

  const activatePlanes = (yellowFlight) => {
    if (phase !== "waiting" || yellowFlight.state !== "waiting") return;
    clearGuideTimer();
    phase = "active";
    hideGuide();
    openBlessing(yellowFlight);
    startFreeFlights();
    // Fill the field immediately with two staggered, edge-entering planes.
    // The active/pending cap still prevents more than six ordinary planes.
    scheduleReplacement("yellow", 140);
    scheduleReplacement("pink", 420);
    // Keep this click to one replacement wave; later departures do not start
    // another round of planes.
    respawnEnabled = false;
  };

  const finishEntry = () => {
    if (disposed || phase !== "entry") return;
    phase = "waiting";
    const yellowFlight = flights.find((flight) => flight.isYellow);
    if (!yellowFlight) return;
    yellowFlight.hit.style.pointerEvents = "auto";
    // Keep the guide artwork anchored to the yellow plane's final position.
    // The plane remains its own DOM layer above this image.
    guide.style.left = `${yellowFlight.point.x}px`;
    guide.style.top = `${yellowFlight.point.y}px`;
    guide.classList.remove("is-hidden");
    guide.classList.add("is-visible");
    clearGuideTimer();
    guideTimer = setTimeout(() => resumeYellowAfterGuideTimeout(yellowFlight), guideWaitDuration);
  };

  const createFlight = (spec, index) => {
    const plane = document.createElement("img");
    plane.className = `teacher-day-plane-flight${spec.isYellow ? " is-yellow" : ""}`;
    plane.alt = spec.isYellow ? "黄色纸飞机" : "纸飞机";
    plane.decoding = "async";
    plane.src = planeImageCache.get(spec.folder)?.src || assetUrl(`planes/${spec.folder}/plane.png`);
    plane.style.opacity = "0";

    const hit = document.createElement("button");
    hit.className = `teacher-day-plane-flight-hit${spec.isYellow ? " is-yellow" : ""}`;
    hit.type = "button";
    hit.setAttribute("aria-label", spec.isYellow ? "点击纸飞机有惊喜" : "点击纸飞机查看祝福");
    hit.style.pointerEvents = "none";

    const video = document.createElement("video");
    video.className = "teacher-day-plane-source";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = assetUrl(`planes/${spec.folder}/effect.mp4`);
    video.load();
    video.setAttribute("aria-hidden", "true");

    const flight = {
      id: index,
      folder: spec.folder,
      isYellow: Boolean(spec.isYellow),
      isFirstWave: Boolean(spec.isFirstWave),
      revealAfterSafeEntry: Boolean(spec.revealAfterSafeEntry),
      plane,
      hit,
      video,
      route: spec.route,
      point: spec.route.p0,
      rotate: spec.startRotate,
      endRotate: spec.endRotate,
      flipX: Boolean(spec.flipX),
      flipY: Boolean(spec.flipY),
      scale: spec.isYellow ? yellowDisplayScale : planeDisplayScale,
      entryDuration: spec.entryDuration,
      entryDelay: spec.entryDelay,
      state: "entering",
      hasEntered: false,
      raf: 0,
      entryTimer: 0,
      cleanupTimer: 0,
    };

    hit.addEventListener("click", (event) => {
      event.stopPropagation();
      if (flight.isYellow) activatePlanes(flight);
      else {
        const shouldReplace = phase === "active"
          && !flight.replacementScheduled
          && ["waiting", "flying"].includes(flight.state);
        openBlessing(flight);
        // Reserve a replacement after this plane is locked into the paper
        // animation, so its slot is already free when the cap is evaluated.
        if (shouldReplace && flight.state === "opening") {
          flight.replacementScheduled = Boolean(scheduleReplacement(flight.folder, 320));
        }
        maybeStopReplacementGeneration();
      }
    });

    flightsStage.append(plane, hit, video);
    return flight;
  };

  const createEntrySpecs = () => {
    const { width, height } = viewport();
    const arrivalAt = 3400;
    const entryConfigs = [
      {
        folder: "pink",
        end: { x: width * .334, y: height * .318 },
        rotate: 0,
        distance: Math.max(width, height) * 1.2,
        offset: -108,
        delay: 80,
      },
      {
        folder: "blue",
        end: { x: width * .857, y: height * .341 },
        rotate: 172,
        flipY: true,
        distance: Math.max(width, height) * 1.28,
        offset: 94,
        delay: 120,
      },
      {
        folder: "green",
        end: { x: width * .166, y: height * .620 },
        rotate: 35,
        distance: Math.max(width, height) * 1.16,
        offset: -116,
        delay: 160,
      },
      {
        folder: "orange",
        end: { x: width * .851, y: height * .687 },
        rotate: -163,
        flipY: true,
        distance: Math.max(width, height) * 1.26,
        offset: 112,
        delay: 200,
      },
      {
        folder: "yellow",
        end: { x: width * .548, y: height * .735 },
        rotate: 0,
        distance: Math.max(width, height) * 1.3,
        offset: -88,
        // Finish last so the guide appears on the same beat as the yellow
        // plane's final stop.
        delay: 240,
      },
    ];
    return entryConfigs.map((config) => ({
      folder: config.folder,
      isYellow: config.folder === "yellow",
      isFirstWave: true,
      revealAfterSafeEntry: false,
      route: makeEntryRoute(config.end, config.rotate, Boolean(config.flipY), config.distance, config.offset),
      startRotate: 0,
      endRotate: config.rotate,
      flipY: Boolean(config.flipY),
      entryDuration: Math.max(900, arrivalAt - config.delay),
      entryDelay: config.delay,
    }));
  };

  const startEntry = () => {
    if (disposed || phase !== "entry") return;
    const specs = createEntrySpecs();
    flights = specs.map(createFlight);
    const entrySpeeds = flights
      .filter((flight) => !flight.isYellow)
      .map((flight) => routeLength(flight.route) / (flight.entryDuration / 1000))
      .filter((speed) => Number.isFinite(speed) && speed > 0);
    if (entrySpeeds.length) {
      const entryAverageSpeed = entrySpeeds.reduce((sum, speed) => sum + speed, 0) / entrySpeeds.length;
      // Keep the same smooth, constant-speed motion while giving the post-click
      // flight a calmer pace than the quicker entry pass.
      departureSpeed = entryAverageSpeed * .55;
    }
    entryRemaining = flights.length;
    flights.forEach((flight) => {
      flight.entryTimer = setTimeout(() => {
        if (disposed || phase !== "entry") return;
        flight.entryStartedAt = clock();
        flight.plane.style.opacity = "1";
        animateEntry(flight);
      }, flight.entryDelay);
    });
  };

  const startWhenReady = () => {
    if (disposed || !document.body.classList.contains("search-page-ready")) return;
    Promise.all([...planeImageCache.values(), guideButtonImage, guideLightImage].map(waitForImage)).then(() => {
      if (!disposed && phase === "entry") startEntry();
    });
  };

  document.addEventListener("search-page-ready", startWhenReady, { once: true });
  if (document.body.classList.contains("search-page-ready")) startWhenReady();

  window.addEventListener("pagehide", () => {
    disposed = true;
    clearGuideTimer();
    spawnTimers.forEach(clearTimeout);
    spawnTimers.clear();
    pendingSpawnCount = 0;
    flights.forEach(removeFlight);
    flightsStage.remove();
  }, { once: true });
})();
