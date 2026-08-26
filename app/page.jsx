"use client";

import {
  Bell,
  Bot,
  ChevronRight,
  CloudSun,
  Image as ImageIcon,
  Link2,
  Mic,
  PawPrint,
  QrCode,
  RefreshCw,
  Settings,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

const navItems = ["新闻", "hao123", "地图", "贴吧", "视频", "图片", "网盘", "文库", "文心", "更多"];

const trendItems = [
  { title: "腾讯回应微信提现可免手续费", tag: "沸" },
  { title: "男明星新闻", tag: "热" },
  { title: "男子与白俄女子婚礼上演最萌身高差", tag: "热" },
  { title: "关键词解码读懂中国" },
  { title: "“我说的不是段子是生活”" },
  { title: "后后女护士将房间住包浆后失联后后女护士" },
  { title: "马龙被赞击穿民进党“心墙”", tag: "新" },
  { title: "灵活上班弹性工作的“妈妈岗”来了", tag: "热" },
  { title: "拜登即将下台为何调动三航母?" },
];

const appItems = ["百度网盘", "百度地图", "百度文库", "百度健康", "百度翻译", "百度百科"];
const DEPLOY_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
const withBasePath = (path) => `${DEPLOY_BASE_PATH}${path}`;

const HOVER_IN_FRAME_COUNT = 31;
// The AE hold section repeats every 8 frames. Three complete cycles are
// exported in the supplied loop sequence; the remaining files are endpoint
// duplicates and would make the loop cadence uneven.
const HOVER_LOOP_CYCLE_FRAMES = 8;
const HOVER_LOOP_FRAME_COUNT = HOVER_LOOP_CYCLE_FRAMES * 3;
// The refreshed AE exit export contains 30 clean, full-canvas frames. Keep
// the source cadence instead of synthesizing blended in-betweens: each frame
// contains one complete grass pose, so no second position can show through.
const HOVER_OUT_FRAME_COUNT = 30;
// The reference export is 24fps (168 frames over 7 seconds). This is the base
// cadence for the loop; the measured transition stretches are defined below.
const AE_VIDEO_FPS = 24;
const DOODLE_FRAME_DURATION = 1000 / AE_VIDEO_FPS;
// The supplied AE export stretches the bloom-in movement to about 38 frames.
// Exit uses the refreshed 30-frame export at the same 24fps cadence, keeping
// its authored hold and easing beats intact.
const HOVER_IN_FRAME_DURATION = DOODLE_FRAME_DURATION * (38 / HOVER_IN_FRAME_COUNT);
const HOVER_OUT_FRAME_DURATION = DOODLE_FRAME_DURATION;
const HOVER_LOOP_FRAME_DURATION = DOODLE_FRAME_DURATION;
const HOVER_IN_EAGER_FRAME_COUNT = 10;
const FRAME_LOAD_BATCH_SIZE = 8;
const DOODLE_ASSET_VERSION = "doodle-813-6";
const HOVER_OUT_ASSET_VERSION = "doodle-813-7";
// The source sequences use the same canvas size, but the bloom-in export is
// offset by one small step at its final frame. Correct that export offset at
// draw time so all three states share the same visual anchor without editing
// the source assets.
const DOODLE_FRAME_OFFSETS = {
  hoverIn: { x: -32 / 1714, y: -8 / 577 },
  hoverLoop: { x: -32 / 1714, y: -8 / 577 },
  hoverOut: { x: -32 / 1714, y: -8 / 577 },
};
const doodleFrameSources = {
  hoverIn: Array.from({ length: HOVER_IN_FRAME_COUNT }, (_, index) => withBasePath(`/media/doodle-813/hover-in/frame-${String(index).padStart(3, "0")}.webp?v=${DOODLE_ASSET_VERSION}`)),
  hoverLoop: Array.from({ length: HOVER_LOOP_FRAME_COUNT }, (_, index) => withBasePath(`/media/doodle-813/hover-loop/frame-${String(index).padStart(3, "0")}.webp?v=${DOODLE_ASSET_VERSION}`)),
  hoverOut: Array.from({ length: HOVER_OUT_FRAME_COUNT }, (_, index) => withBasePath(`/media/doodle-813/hover-out-ae/frame-${String(index).padStart(3, "0")}.webp?v=${HOVER_OUT_ASSET_VERSION}`)),
};

function DoodleVideo() {
  const hoveredRef = useRef(false);
  const canvasRef = useRef(null);
  const canvasContextRef = useRef(null);
  const framesRef = useRef({
    hoverIn: Array(HOVER_IN_FRAME_COUNT).fill(null),
    hoverLoop: Array(HOVER_LOOP_FRAME_COUNT).fill(null),
    hoverOut: Array(HOVER_OUT_FRAME_COUNT).fill(null),
  });
  const frameLoadStateRef = useRef({
    hoverIn: Array(HOVER_IN_FRAME_COUNT).fill(false),
    hoverLoop: Array(HOVER_LOOP_FRAME_COUNT).fill(false),
    hoverOut: Array(HOVER_OUT_FRAME_COUNT).fill(false),
  });
  const framesReadyRef = useRef(false);
  const animationFrameRef = useRef(null);
  const transitionTimerRef = useRef(null);
  const animationGenerationRef = useRef(0);
  const loopStartedRef = useRef(false);
  const currentFrameRef = useRef({ kind: "hoverIn", index: 0 });
  const exitSnapshotRef = useRef(null);

  const stopAnimation = () => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    // A cancelled RAF can already be queued at the edge of a pointer event.
    // Advancing the generation makes that callback harmless if it still runs.
    animationGenerationRef.current += 1;
  };

  const stopTransitionTimer = () => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
  };

  const drawFrame = (kind, index) => {
    const canvas = canvasRef.current;
    const frame = framesRef.current[kind][index];
    if (!canvas || !frame) return;

    // Bring the cached canvas back in one paint before drawing the next pose.
    // Exit completion hides this layer with opacity instead of clearing it,
    // so restoring it here avoids exposing a blank frame on re-entry.
    canvas.style.opacity = "1";

    const context = canvasContextRef.current || canvas.getContext("2d", { alpha: true });
    canvasContextRef.current = context;
    const baseOffset = DOODLE_FRAME_OFFSETS[kind] ?? { x: 0, y: 0 };
    const offsetProgress = kind === "hoverIn"
      ? index / Math.max(1, HOVER_IN_FRAME_COUNT - 1)
      : 1;
    const offset = {
      x: baseOffset.x * offsetProgress,
      y: baseOffset.y * offsetProgress,
    };
    context.globalCompositeOperation = "copy";
    const exitSnapshot = kind === "hoverOut" ? exitSnapshotRef.current : null;
    const holdSnapshot = exitSnapshot && exitSnapshot.startIndex === index;
    if (holdSnapshot) {
      context.drawImage(exitSnapshot.canvas, 0, 0, canvas.width, canvas.height);
    } else {
      context.drawImage(
        frame,
        offset.x * canvas.width,
        offset.y * canvas.height,
        canvas.width,
        canvas.height,
      );
    }
    context.globalCompositeOperation = "source-over";
    canvas.dataset.frameKind = kind;
    canvas.dataset.frameIndex = String(index);
    currentFrameRef.current = { kind, index };
  };

  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width) return;

    // The source frames are much larger than their rendered size. Keep a
    // retina-quality buffer while avoiding a full-size 1714px redraw on every
    // hover frame.
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const targetWidth = Math.min(1280, Math.max(960, Math.round(bounds.width * pixelRatio * 2)));
    const targetHeight = Math.round(targetWidth * 577 / 1714);
    if (canvas.width === targetWidth && canvas.height === targetHeight && canvasContextRef.current) return;

    canvas.width = targetWidth;
    canvas.height = targetHeight;
    canvasContextRef.current = canvas.getContext("2d", { alpha: true });
    const { kind, index } = currentFrameRef.current;
    if (framesRef.current[kind]?.[index]) drawFrame(kind, index);
  };

  const clearFrame = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Keep the final exit pixels cached and hide the layer as one unit. Clearing
    // the transparent canvas while switching layers can expose a white frame.
    canvas.style.opacity = "0";
    exitSnapshotRef.current = null;
    currentFrameRef.current = { kind: "idle", index: 0 };
    canvas.dataset.frameKind = "idle";
    canvas.dataset.frameIndex = "0";
  };

  const playSequence = (kind, startIndex = 0, loop = false, onComplete) => {
    const frames = framesRef.current[kind];
    if (!frames.length) return;

    stopAnimation();
    stopTransitionTimer();
    const generation = animationGenerationRef.current;
    const lastIndex = frames.length - 1;
    const firstIndex = Math.max(0, Math.min(lastIndex, Math.round(startIndex)));
    const frameDuration = kind === "hoverLoop"
      ? HOVER_LOOP_FRAME_DURATION
      : kind === "hoverIn"
        ? HOVER_IN_FRAME_DURATION
        : HOVER_OUT_FRAME_DURATION;
    const startedAt = window.performance.now();
    let drawnIndex = firstIndex;

    drawFrame(kind, firstIndex);

    const tick = (now) => {
      if (generation !== animationGenerationRef.current) return;

      const elapsedFrames = Math.floor((now - startedAt) / frameDuration);
      const nextIndex = loop ? (firstIndex + elapsedFrames) % frames.length : Math.min(lastIndex, firstIndex + elapsedFrames);

      if (nextIndex !== drawnIndex && frames[nextIndex]) {
        drawFrame(kind, nextIndex);
        drawnIndex = nextIndex;
      }

      // Keep the timeline alive while a background batch is still decoding.
      // The current pose remains on canvas until the next frame is available,
      // so progressive loading never exposes a blank or partial animation.
      if (loop || nextIndex < lastIndex || !frameLoadStateRef.current[kind][lastIndex]) {
        animationFrameRef.current = window.requestAnimationFrame(tick);
        return;
      }

      animationFrameRef.current = null;
      if (loop) {
        onComplete?.();
        return;
      }
      transitionTimerRef.current = window.setTimeout(() => {
        if (generation !== animationGenerationRef.current) return;
        transitionTimerRef.current = null;
        onComplete?.();
      }, frameDuration);
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);
  };

  useEffect(() => {
    let cancelled = false;
    const loadFrame = (src, priority = "low") => new Promise((resolve) => {
      const image = new Image();
      image.decoding = "async";
      if ("fetchPriority" in image) image.fetchPriority = priority;
      image.onload = () => {
        if (typeof image.decode !== "function") {
          resolve(image);
          return;
        }
        image.decode().catch(() => {}).finally(() => resolve(image));
      };
      image.onerror = () => resolve(null);
      image.src = src;
    });

    const sequenceEntries = Object.entries(doodleFrameSources);
    const assignFrames = (entries, images) => {
      entries.forEach(([kind, index], entryIndex) => {
        if (cancelled) return;
        framesRef.current[kind][index] = images[entryIndex];
        frameLoadStateRef.current[kind][index] = true;
      });
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const eagerEntries = doodleFrameSources.hoverIn
      .slice(0, HOVER_IN_EAGER_FRAME_COUNT)
      .map((_, index) => ["hoverIn", index]);
    Promise.all(eagerEntries.map(([, index]) => loadFrame(doodleFrameSources.hoverIn[index], "high")))
      .then(async (images) => {
        if (cancelled) return;
        assignFrames(eagerEntries, images);
        if (images.some(Boolean)) {
          framesReadyRef.current = true;
          if (canvasRef.current) canvasRef.current.dataset.ready = "true";
          if (hoveredRef.current) activate();
        }

        const backgroundEntries = sequenceEntries.flatMap(([kind, sources]) => (
          sources.map((_, index) => [kind, index])
        )).filter(([kind, index]) => !(kind === "hoverIn" && index < HOVER_IN_EAGER_FRAME_COUNT));

        for (let offset = 0; offset < backgroundEntries.length && !cancelled; offset += FRAME_LOAD_BATCH_SIZE) {
          const batch = backgroundEntries.slice(offset, offset + FRAME_LOAD_BATCH_SIZE);
          const batchImages = await Promise.all(batch.map(([kind, index]) => (
            loadFrame(doodleFrameSources[kind][index])
          )));
          assignFrames(batch, batchImages);
        }
      });

    return () => {
      cancelled = true;
      framesReadyRef.current = false;
      stopAnimation();
      stopTransitionTimer();
      window.removeEventListener("resize", resizeCanvas);
    };
  }, []);

  const activate = () => {
    hoveredRef.current = true;
    if (!framesReadyRef.current || loopStartedRef.current) return;
    exitSnapshotRef.current = null;
    stopTransitionTimer();
    let startIndex = 0;
    if (currentFrameRef.current.kind === "hoverOut") {
      const outProgress = currentFrameRef.current.index / Math.max(1, HOVER_OUT_FRAME_COUNT - 1);
      startIndex = (1 - outProgress) * (HOVER_IN_FRAME_COUNT - 1);
    }

    playSequence("hoverIn", startIndex, false, () => {
      if (hoveredRef.current) {
        loopStartedRef.current = true;
        playSequence("hoverLoop", 0, true);
      }
    });
  };

  const deactivate = () => {
    hoveredRef.current = false;
    if (!framesReadyRef.current) return;
    loopStartedRef.current = false;
    let startIndex = 0;
    if (currentFrameRef.current.kind === "hoverIn") {
      const inProgress = currentFrameRef.current.index / Math.max(1, HOVER_IN_FRAME_COUNT - 1);
      startIndex = Math.max(0, (1 - inProgress) * (HOVER_OUT_FRAME_COUNT - 1));
    }
    const canvas = canvasRef.current;
    if (canvas) {
      const snapshot = document.createElement("canvas");
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      snapshot.getContext("2d", { alpha: true }).drawImage(canvas, 0, 0);
      exitSnapshotRef.current = {
        canvas: snapshot,
        startIndex: Math.round(startIndex),
      };
    }
    stopTransitionTimer();
    stopAnimation();
    playSequence("hoverOut", startIndex, false, () => {
      if (!hoveredRef.current) {
        clearFrame();
      }
    });
  };

  const openSearch = () => {
    window.location.href = withBasePath("/reference/search/index.html?wd=%E6%95%99%E5%B8%88%E8%8A%82");
  };

  return (
    <div className="doodle-layer" aria-hidden="false">
      <div className="doodle-grass-layer" aria-hidden="true">
        <canvas
          ref={canvasRef}
          className="doodle-grass-frame doodle-grass-canvas"
          data-testid="grass-canvas"
          data-ready="loading"
          data-frame-kind="idle"
          data-frame-index="0"
          width="1714"
          height="577"
        />
      </div>
      <div className="doodle-page-turn-layer" aria-hidden="true">
        <img
          className="doodle-page-turn-animation"
          data-testid="page-turn-animation"
          data-animation="continuous"
          src={withBasePath(`/media/doodle-813/page-turn.webp?v=${DOODLE_ASSET_VERSION}`)}
          alt=""
          draggable="false"
          fetchPriority="high"
        />
      </div>
      <button
        className="doodle-hit-area"
        data-testid="doodle-hit-area"
        type="button"
        aria-label="教师节 Doodle，悬停开花，移开凋落，点击查看教师节搜索结果"
        onMouseEnter={activate}
        onMouseLeave={deactivate}
        onFocus={activate}
        onBlur={deactivate}
        onClick={openSearch}
      />
    </div>
  );
}

function TopBar({ notify }) {
  return (
    <header className="topbar">
      <nav className="primary-nav" aria-label="主要导航">
        {navItems.map((item) => (
          <a key={item} href={`https://www.baidu.com/s?wd=${encodeURIComponent(item)}`} target="_blank" rel="noreferrer">
            {item}
          </a>
        ))}
      </nav>
      <div className="utility-nav">
        <span className="weather"><span>北京</span><strong>25°</strong><CloudSun size={17} aria-hidden="true" /></span>
        <span className="air-quality">优</span>
        <button type="button" className="utility-button" title="通知" onClick={() => notify("暂无新通知")}>
          <Bell size={17} aria-hidden="true" /><span>通知</span>
        </button>
        <button type="button" className="utility-button" title="设置" onClick={() => notify("设置面板已准备好")}>
          <Settings size={17} aria-hidden="true" /><span>设置</span>
        </button>
        <button type="button" className="account-button" onClick={() => notify("你好，白小度")}>
          <span className="account-mark"><PawPrint size={15} aria-hidden="true" /></span><span>白小度</span>
        </button>
      </div>
    </header>
  );
}

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState("百度热搜");
  const [trendOffset, setTrendOffset] = useState(0);
  const [toast, setToast] = useState("");

  const notify = (message) => {
    setToast(message);
    window.clearTimeout(window.__teacherDayToastTimer);
    window.__teacherDayToastTimer = window.setTimeout(() => setToast(""), 1800);
  };

  const submitSearch = (event) => {
    event.preventDefault();
    const searchTerm = query.trim() || "教师节";
    window.location.href = withBasePath(`/reference/search/index.html?wd=${encodeURIComponent(searchTerm)}`);
  };

  const visibleTrends = trendItems.map((_, index) => trendItems[(index + trendOffset) % trendItems.length]);

  return (
    <main className="baidu-page">
      <TopBar notify={notify} />
      <DoodleVideo />

      <section className="search-stage" aria-label="搜索">
        <form className="search-box" onSubmit={submitSearch}>
          <label className="sr-only" htmlFor="search-input">搜索内容</label>
          <input
            id="search-input"
            name="wd"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="七月份去广西旅游，四个人同行，五天四晚常"
            autoComplete="off"
          />
          <div className="search-tools" aria-label="搜索工具">
            <button type="button" title="语音搜索" aria-label="语音搜索" onClick={() => notify("语音搜索已准备好")}><Mic /></button>
            <button type="button" title="添加链接" aria-label="添加链接" onClick={() => notify("可以粘贴需要搜索的链接")}><Link2 /></button>
            <button type="button" title="以图搜图" aria-label="以图搜图" onClick={() => notify("以图搜图已准备好")}><ImageIcon /></button>
          </div>
          <button className="search-submit" type="submit">百度一下</button>
        </form>

        <button className="assistant-entry" type="button" onClick={() => notify("文心助手已准备好")}>
          <span className="assistant-icon"><Sparkles size={16} aria-hidden="true" /></span>
          <strong>文心</strong>
          <span>复杂问题就找文心助手，深入思考回答更优</span>
          <ChevronRight size={17} aria-hidden="true" />
        </button>
      </section>

      <section className="content-panel" aria-label="推荐内容">
        <div className="content-toolbar">
          <div className="content-tabs" role="tablist" aria-label="内容分类">
            {["常用应用", "百度热搜"].map((tab) => (
              <button
                key={tab}
                className={activeTab === tab ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
            <ChevronRight className="tab-chevron" size={17} aria-hidden="true" />
          </div>
          {activeTab === "百度热搜" && (
            <button className="refresh-button" type="button" onClick={() => setTrendOffset((value) => (value + 3) % trendItems.length)}>
              <RefreshCw size={15} aria-hidden="true" />换一换
            </button>
          )}
        </div>

        {activeTab === "百度热搜" ? (
          <div className="trend-grid" role="tabpanel">
            <ol className="trend-list">
              {visibleTrends.slice(0, 4).map((item, index) => (
                <li key={item.title}>
                  <span className={`trend-rank rank-${index + 1}`}>{index === 0 ? "↑" : index}</span>
                  <button type="button" onClick={() => setQuery(item.title)}>{item.title}</button>
                  {item.tag && <span className={`trend-tag tag-${item.tag}`}>{item.tag}</span>}
                </li>
              ))}
            </ol>
            <ol className="trend-list" start="5">
              {visibleTrends.slice(4).map((item, index) => (
                <li key={item.title}>
                  <span className="trend-rank">{index + 5}</span>
                  <button type="button" onClick={() => setQuery(item.title)}>{item.title}</button>
                  {item.tag && <span className={`trend-tag tag-${item.tag}`}>{item.tag}</span>}
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="app-grid" role="tabpanel">
            {appItems.map((item, index) => (
              <button key={item} type="button" onClick={() => notify(`${item}已准备好`)}>
                <span>{item.slice(2, 3) || item.slice(0, 1)}</span>{item}
              </button>
            ))}
          </div>
        )}

        <article className="editorial-item">
          <div className="editorial-image" aria-hidden="true"><span>▶</span></div>
          <div><h2>从山河诗意到数字未来，传统文化正以新的方式走进日常生活</h2><p>文化 · 今日推荐</p></div>
        </article>
      </section>

      <aside className="floating-tools" aria-label="快捷工具">
        <button type="button" title="智能助手" aria-label="智能助手" onClick={() => notify("智能助手已准备好")}><Bot size={18} /></button>
        <button type="button" title="更多服务" aria-label="更多服务" onClick={() => notify("更多服务已展开")}><QrCode size={18} /></button>
      </aside>
      <div className={`toast${toast ? " is-visible" : ""}`} role="status" aria-live="polite">{toast}</div>
    </main>
  );
}
