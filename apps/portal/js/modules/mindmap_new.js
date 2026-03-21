// Vanilla Mind Map Builder - No external libraries
const STORAGE_KEY = "taedu:mindmap:data";
const containerId = "mindmapCanvas";
const toolbar = document.getElementById("mindmap-toolbar");
const fileInput = document.getElementById("mindmapFileInput");
const buttons = document.querySelectorAll("[data-action]");
const canvas = document.getElementById(containerId);
const cacheStatus = document.getElementById("mindmapCacheStatus");
const stageElement = document.querySelector(".mindmap-stage");
const contextMenu = document.getElementById("mindmapContextMenu");
const contextMenuButtons = contextMenu ? contextMenu.querySelectorAll("[data-context-action]") : [];
const contextSections = contextMenu ? contextMenu.querySelectorAll(".context-section, .context-divider") : [];
const contextShapeButtons = contextMenu ? contextMenu.querySelectorAll(".shape-options button") : [];
const themeButtons = contextMenu ? contextMenu.querySelectorAll(".theme-options button[data-theme]") : [];
const themeCustomColor = document.getElementById("themeCustomColor");
const colorButtons = contextMenu ? contextMenu.querySelectorAll("[data-color-preset]") : [];
const arrowButtons = contextMenu ? contextMenu.querySelectorAll("[data-link-arrow]") : [];
const widthButtons = contextMenu ? contextMenu.querySelectorAll("[data-link-width]") : [];
const opacityButtons = contextMenu ? contextMenu.querySelectorAll("[data-link-opacity]") : [];
const modalBackdrop = document.getElementById("mindmapModalBackdrop");
const modalElement = document.getElementById("mindmapModal");
const aiModal = document.getElementById("aiModal");
const modalTitle = document.getElementById("mindmapModalTitle");
const modalMessage = document.getElementById("mindmapModalMessage");
const modalInputWrap = document.getElementById("mindmapModalInputWrap");
const modalInput = document.getElementById("mindmapModalInput");
const modalTextareaWrap = document.getElementById("mindmapModalTextareaWrap");
const modalTextarea = document.getElementById("mindmapModalTextarea");
const modalConfirmBtn = document.getElementById("mindmapModalConfirm");
const modalCancelBtn = document.getElementById("mindmapModalCancel");
const modalCloseButtons = modalElement ? modalElement.querySelectorAll("[data-modal-action=\"close\"]") : [];
const aiFileInput = document.getElementById("aiFileInput");
const aiFileName = document.getElementById("aiFileName");
const aiClearFileBtn = document.querySelector('[data-ai-action="clear-file"]');
const aiPromptInput = document.getElementById("aiPromptInput");
const aiGenerateBtn = aiModal ? aiModal.querySelector('[data-ai-action="generate"]') : null;
const aiStatusText = aiModal ? aiModal.querySelector("[data-ai-status]") : null;
const AI_ENDPOINT =
  (typeof window !== "undefined" && (window.TA_EDU_MINDMAP_AI_ENDPOINT || window.__TAEDU_MINDMAP_AI_ENDPOINT)) ||
  "/api/mindmap-ai";
const AI_GENERATE_TEXT = "Tạo mindmap";
const AI_GENERATE_LOADING_TEXT = "Đang tạo...";
let aiFileText = "";
let aiFileReading = false;
let aiIsGenerating = false;

const UNTITLED_NODE = "Ý tưởng";
const DRAGGING_CLASS = "is-dragging";
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.2;
const SCALE_STEP = 0.15;
const SCENE_SIZE = 2400;
const HALF_SCENE = SCENE_SIZE / 2;
const SVG_NS = "http://www.w3.org/2000/svg";
const SHAPE_OPTIONS = ["pill", "rect", "oval", "cloud"];
const RESIZE_HANDLES = ["top", "right", "bottom", "left", "top-right", "bottom-right", "bottom-left", "top-left"];
const MIN_NODE_WIDTH = 130;
const MIN_NODE_HEIGHT = 48;
const MAX_NODE_WIDTH = 620;
const MAX_NODE_HEIGHT = 300;
const CANVAS_THEMES = {
  soft: {
    id: "soft",
    bodyStart: "#fff7f1",
    canvas: "linear-gradient(180deg, rgba(255,247,241,0.9), rgba(255,255,255,0.9))",
    scene: "transparent"
  },
  sunset: {
    id: "sunset",
    bodyStart: "#fff0f3",
    canvas: "linear-gradient(180deg, #ffe0e0, #fff5e1)",
    scene: "transparent"
  },
  ocean: {
    id: "ocean",
    bodyStart: "#e0f7ff",
    canvas: "linear-gradient(180deg, #d7f0ff, #f2fbff)",
    scene: "transparent"
  },
  forest: {
    id: "forest",
    bodyStart: "#e7f8f0",
    canvas: "linear-gradient(180deg, #d4f3e6, #f5fff7)",
    scene: "transparent"
  },
  night: {
    id: "night",
    bodyStart: "#f3e8ff",
    canvas: "linear-gradient(180deg, #f1e0ff, #fff5ff)",
    scene: "transparent"
  },
  custom: {
    id: "custom",
    bodyStart: "#fff7f1",
    canvas: "linear-gradient(180deg, #fff7f1, #fefefe)",
    scene: "transparent"
  }
};
const NODE_COLOR_PRESETS = {
  purple: { id: "purple", fill: "#d8c8ff", border: "#a78bfa", text: "#2f2a33", linkColor: "#5b4abf" },
  mint: { id: "mint", fill: "#b2f2d5", border: "#36ba92", text: "#14532d", linkColor: "#1f7a64" },
  peach: { id: "peach", fill: "#ffd9b6", border: "#fb923c", text: "#78350f", linkColor: "#b45309" },
  rose: { id: "rose", fill: "#ffb3ba", border: "#f97373", text: "#7f1d1d", linkColor: "#be123c" },
  yellow: { id: "yellow", fill: "#ffe7a3", border: "#facc15", text: "#713f12", linkColor: "#a16207" },
  lilac: { id: "lilac", fill: "#c7d2fe", border: "#7c3aed", text: "#312e81", linkColor: "#5b21b6" }
};
const COLOR_SEQUENCE = ["purple", "peach", "mint", "rose", "yellow", "lilac"];
const LINK_DEFAULT_STYLE = {
  arrow: "end",
  strokeWidth: 4,
  strokeOpacity: 1,
  color: "#2f3c4d"
};
const LINK_WIDTH_MAP = {
  thin: 2,
  medium: 4,
  thick: 6
};
const LINK_OPACITY_MAP = {
  soft: 0.4,
  normal: 0.75,
  bold: 1
};
const FONT_SIZE_MAP = {
  min: 0.85,
  max: 1.4,
  step: 0.07,
  default: 1
};

let treeData = null;
let selectedNodeId = null;
let sceneEl = null;
let contentEl = null;
let nodeLayer = null;
let connectorLayer = null;
let nodeElements = new Map();
let connectorElements = new Map();
let parentLookup = {};
let hasRenderedOnce = false;
let layoutDirty = false;
let contextMenuTargetId = null;
let contextMenuTargetType = "node";
const modalState = {
  resolver: null,
  mode: "info",
  pendingValue: null
};
let canvasTheme = "soft";

const viewState = {
  scale: 1,
  panX: 0,
  panY: 0
};

const pointerState = {
  pointerId: null,
  active: false,
  origin: { x: 0, y: 0 },
  panOrigin: { x: 0, y: 0 }
};

const nodeDragState = {
  pointerId: null,
  nodeId: null,
  origin: { x: 0, y: 0 },
  startPosition: { x: 0, y: 0 },
  element: null
};

const nodeResizeState = {
  pointerId: null,
  nodeId: null,
  handle: null,
  startPointer: { x: 0, y: 0 },
  startSize: { width: 0, height: 0 },
  startPosition: { x: 0, y: 0 },
  element: null
};

let connectorDefs = null;
const markerCache = new Map();
let markerCounter = 0;

const SKIP_CACHE_SESSION_KEY = "taedu:mindmap:skipCacheOnce";
const urlParams = new URLSearchParams(window.location.search);
let skipCacheFromSession = false;
try {
  skipCacheFromSession = sessionStorage.getItem(SKIP_CACHE_SESSION_KEY) === "1";
  if (skipCacheFromSession) {
    sessionStorage.removeItem(SKIP_CACHE_SESSION_KEY);
  }
} catch (err) {
  skipCacheFromSession = false;
}
const skipCacheFromQuery = urlParams.has("nocache") || urlParams.has("fresh") || urlParams.get("cache") === "off";
const DISABLE_LOCAL_CACHE = skipCacheFromQuery || skipCacheFromSession;

// Theme palettes reused from previous edition
let themeIndex = 0;
const themePalettes = [
  ["#0ea5e9", "#06b6d4", "#8b5cf6", "#ec4899", "#10b981", "#f59e0b"],
  ["#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe", "#f5f3ff"],
  ["#ec4899", "#f472b6", "#fb7185", "#fda4af", "#fecdd3", "#ffe4e6"],
  ["#10b981", "#34d399", "#6ee7b7", "#a7f3d0", "#d1fae5", "#ecfdf5"],
  ["#f59e0b", "#fbbf24", "#fcd34d", "#fde047", "#fef08a", "#fef9c3"]
];

// Data helpers
function baseRootNode() {
  return {
    id: "root",
    content: "Ý tưởng chính",
    position: { x: 0, y: 0 },
    shape: "pill",
    canvasTheme: "soft",
    children: []
  };
}

function defaultData() {
  const root = baseRootNode();
  root.children = [
    {
      id: "branch-1",
      content: "Mục tiêu",
      position: { x: 220, y: -140 },
      shape: "rect",
      children: [
        { id: "branch-1-1", content: "Ngắn hạn", position: { x: 460, y: -220 }, shape: "pill", children: [] },
        { id: "branch-1-2", content: "Dài hạn", position: { x: 460, y: -60 }, shape: "pill", children: [] }
      ]
    },
    {
      id: "branch-2",
      content: "Kiến thức",
      position: { x: 220, y: 20 },
      shape: "rect",
      children: [
        { id: "branch-2-1", content: "Lý thuyết", position: { x: 460, y: -40 }, shape: "oval", children: [] },
        { id: "branch-2-2", content: "Thực hành", position: { x: 460, y: 100 }, shape: "oval", children: [] }
      ]
    },
    {
      id: "branch-3",
      content: "Kỹ năng",
      position: { x: 220, y: 200 },
      shape: "cloud",
      children: []
    }
  ];
  return root;
}

function generateNodeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `node-${crypto.randomUUID()}`;
  }
  return `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizePosition(rawPosition) {
  if (!rawPosition || typeof rawPosition !== "object") return null;
  const x = Number(rawPosition.x);
  const y = Number(rawPosition.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function extractNodeContent(rawNode) {
  const value = rawNode?.content ?? rawNode?.topic ?? rawNode?.name ?? rawNode?.title;
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return UNTITLED_NODE;
}

function normalizeNode(rawNode) {
  if (!rawNode) return null;
  const children = Array.isArray(rawNode.children)
    ? rawNode.children.map(normalizeNode).filter(Boolean)
    : [];
  return {
    id: (typeof rawNode.id === "string" && rawNode.id.trim().length > 0) ? rawNode.id : generateNodeId(),
    content: extractNodeContent(rawNode),
    position: sanitizePosition(rawNode.position),
    shape: typeof rawNode.shape === "string" ? rawNode.shape : undefined,
    size: sanitizeSize(rawNode.size),
    style: sanitizeStyle(rawNode.style),
    customTheme: sanitizeCustomTheme(rawNode.customTheme),
    children,
    canvasTheme: typeof rawNode.canvasTheme === "string" ? rawNode.canvasTheme : undefined
  };
}

function sanitizeSize(rawSize) {
  if (!rawSize || typeof rawSize !== "object") return null;
  const width = Number(rawSize.width);
  const height = Number(rawSize.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return {
    width: Math.min(Math.max(width, MIN_NODE_WIDTH), MAX_NODE_WIDTH),
    height: Math.min(Math.max(height, MIN_NODE_HEIGHT), MAX_NODE_HEIGHT)
  };
}

function sanitizeStyle(rawStyle) {
  if (!rawStyle || typeof rawStyle !== "object") return null;
  const style = {};
  if (typeof rawStyle.fill === "string") style.fill = rawStyle.fill;
  if (typeof rawStyle.border === "string") style.border = rawStyle.border;
  if (typeof rawStyle.text === "string") style.text = rawStyle.text;
  if (typeof rawStyle.linkColor === "string") style.linkColor = rawStyle.linkColor;
  if (typeof rawStyle.preset === "string") style.preset = rawStyle.preset;
  if (typeof rawStyle.fontSize === "string") style.fontSize = rawStyle.fontSize;
  if (rawStyle.link && typeof rawStyle.link === "object") {
    const link = {};
    if (["none", "end", "start", "both"].includes(rawStyle.link.arrow)) {
      link.arrow = rawStyle.link.arrow;
    }
    if (Number.isFinite(rawStyle.link.strokeWidth)) {
      link.strokeWidth = clampValue(rawStyle.link.strokeWidth, LINK_WIDTH_MAP.thin, LINK_WIDTH_MAP.thick * 1.5);
    }
    if (Number.isFinite(rawStyle.link.strokeOpacity)) {
      link.strokeOpacity = clampValue(rawStyle.link.strokeOpacity, 0.2, 1);
    }
    if (typeof rawStyle.link.color === "string") {
      link.color = rawStyle.link.color;
    }
    if (Object.keys(link).length) {
      style.link = link;
    }
  }
  return Object.keys(style).length ? style : null;
}

function sanitizeCustomTheme(rawTheme) {
  if (!rawTheme || typeof rawTheme !== "object") return null;
  if (typeof rawTheme.base === "string") {
    return { base: rawTheme.base };
  }
  return null;
}

function unwrapLegacyTree(raw) {
  if (!raw || typeof raw !== "object") {
    return { tree: null, migrated: false };
  }

  if (raw.format === "node_tree" && raw.data) {
    return { tree: raw.data, migrated: true };
  }

  if (raw.data && raw.meta && raw.data.id) {
    return { tree: raw.data, migrated: true };
  }

  return { tree: raw, migrated: false };
}

function loadData() {
  try {
    if (DISABLE_LOCAL_CACHE) {
      return defaultData();
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw);
    const { tree, migrated } = unwrapLegacyTree(parsed);
    const normalized = normalizeNode(tree);
    if (!normalized) return defaultData();
    if (migrated) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    }
    if (normalized.canvasTheme) {
      canvasTheme = normalized.canvasTheme;
    }
    return normalized;
  } catch (err) {
    console.warn("Mind map load error:", err);
    return defaultData();
  }
}

function saveData() {
  try {
    if (DISABLE_LOCAL_CACHE) return;
    const payload = { ...treeData, canvasTheme };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    layoutDirty = false;
  } catch (err) {
    console.warn("Mind map save error:", err);
  }
}

function findNode(tree, id) {
  if (!tree) return null;
  if (tree.id === id) return tree;
  if (!Array.isArray(tree.children)) return null;
  for (const child of tree.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function findParent(tree, childId, parent = null) {
  if (!tree) return null;
  if (tree.id === childId) return parent;
  if (!Array.isArray(tree.children)) return null;
  for (const child of tree.children) {
    const found = findParent(child, childId, tree);
    if (found) return found;
  }
  return null;
}

function getNodeDepth(targetId, node = treeData, depth = 0) {
  if (!node) return -1;
  if (node.id === targetId) return depth;
  if (!Array.isArray(node.children)) return -1;
  for (const child of node.children) {
    const found = getNodeDepth(targetId, child, depth + 1);
    if (found >= 0) return found;
  }
  return -1;
}

// Rendering
function ensureScene() {
  if (!canvas) return;
  if (sceneEl && contentEl && nodeLayer && connectorLayer) return;

  sceneEl = document.createElement("div");
  sceneEl.className = "mindmap-scene";
  sceneEl.style.setProperty("--mindmap-scene-size", `${SCENE_SIZE}px`);

  contentEl = document.createElement("div");
  contentEl.className = "mindmap-content";
  contentEl.style.width = `${SCENE_SIZE}px`;
  contentEl.style.height = `${SCENE_SIZE}px`;

  connectorLayer = document.createElementNS(SVG_NS, "svg");
  connectorLayer.classList.add("mindmap-connector-layer");
  connectorLayer.setAttribute("width", SCENE_SIZE);
  connectorLayer.setAttribute("height", SCENE_SIZE);
  connectorLayer.setAttribute("viewBox", `0 0 ${SCENE_SIZE} ${SCENE_SIZE}`);
  connectorDefs = document.createElementNS(SVG_NS, "defs");
  connectorLayer.appendChild(connectorDefs);
  markerCache.clear();
  markerCounter = 0;

  nodeLayer = document.createElement("div");
  nodeLayer.className = "mindmap-node-layer";

  contentEl.appendChild(connectorLayer);
  contentEl.appendChild(nodeLayer);
  sceneEl.appendChild(contentEl);
  canvas.innerHTML = "";
  canvas.appendChild(sceneEl);
  applyCanvasTheme(canvasTheme);
}

function getNodeColor(depth) {
  const palette = themePalettes[themeIndex];
  if (!palette || !palette.length) return "#0ea5e9";
  return palette[depth % palette.length];
}

function ensureNodePosition(node, depth = 0, parent = null, index = 0, total = 1) {
  if (!node) return { x: 0, y: 0 };
  if (node.position && Number.isFinite(node.position.x) && Number.isFinite(node.position.y)) {
    return node.position;
  }
  const spacingX = 240;
  const spacingY = 140;
  let x = 0;
  let y = 0;
  if (parent && parent.position) {
    x = parent.position.x + spacingX;
    const offset = total > 1 ? (index - (total - 1) / 2) * spacingY : 0;
    y = parent.position.y + offset;
  }
  node.position = { x, y };
  layoutDirty = true;
  return node.position;
}

function getDefaultShape(depth) {
  if (depth === 0) return "pill";
  if (depth === 1) return "rect";
  if (depth === 2) return "oval";
  return "cloud";
}

function getDefaultNodeStyle(depth = 0) {
  const presetId = COLOR_SEQUENCE[depth % COLOR_SEQUENCE.length];
  const preset = NODE_COLOR_PRESETS[presetId] || NODE_COLOR_PRESETS.purple;
  return {
    ...preset,
    preset: presetId,
    fontSize: FONT_SIZE_MAP.default,
    link: {
      ...LINK_DEFAULT_STYLE,
      color: preset.linkColor || LINK_DEFAULT_STYLE.color
    }
  };
}

function getDefaultSize(shape = "pill") {
  switch (shape) {
    case "rect":
      return { width: 200, height: 64 };
    case "oval":
      return { width: 220, height: 70 };
    case "cloud":
      return { width: 240, height: 72 };
    case "pill":
    default:
      return { width: 220, height: 64 };
  }
}

function ensureNodeSize(node, depth = 0) {
  if (!node) return { width: MIN_NODE_WIDTH, height: MIN_NODE_HEIGHT };
  const shape = node.shape || getDefaultShape(depth);
  if (node.size && Number.isFinite(node.size.width) && Number.isFinite(node.size.height)) {
    const sanitized = sanitizeSize(node.size);
    node.size = sanitized || getDefaultSize(shape);
    if (!sanitized) {
      layoutDirty = true;
    }
    return node.size;
  }
  node.size = getDefaultSize(shape);
  layoutDirty = true;
  return node.size;
}

function ensureNodeStyle(node, depth = 0) {
  if (!node) return getDefaultNodeStyle(depth);
  const defaults = getDefaultNodeStyle(depth);
  if (!node.style || typeof node.style !== "object") {
    node.style = { ...defaults };
  }
  if (!node.style.fill) node.style.fill = defaults.fill;
  if (!node.style.border) node.style.border = defaults.border;
  if (!node.style.text) node.style.text = defaults.text;
  if (!node.style.linkColor) node.style.linkColor = defaults.linkColor || defaults.border;
  if (!node.style.preset) node.style.preset = defaults.preset;
  if (!node.style.link || typeof node.style.link !== "object") {
    node.style.link = { ...defaults.link };
  } else {
    node.style.link.arrow = ["none", "end", "start", "both"].includes(node.style.link.arrow)
      ? node.style.link.arrow
      : defaults.link.arrow;
    const width = Number(node.style.link.strokeWidth);
    node.style.link.strokeWidth = Number.isFinite(width) ? clampValue(width, LINK_WIDTH_MAP.thin, LINK_WIDTH_MAP.thick * 1.5) : defaults.link.strokeWidth;
    const opacity = Number(node.style.link.strokeOpacity);
    node.style.link.strokeOpacity = Number.isFinite(opacity) ? clampValue(opacity, 0.2, 1) : defaults.link.strokeOpacity;
    node.style.link.color = node.style.link.color || node.style.linkColor || defaults.link.color;
  }
  if (!node.style.fontSize) node.style.fontSize = FONT_SIZE_MAP.default;
  return node.style;
}

function setNodeElementPosition(element, position) {
  if (!element || !position) return;
  const x = HALF_SCENE + position.x;
  const y = HALF_SCENE + position.y;
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
}

function applyNodeSize(element, size) {
  if (!element || !size) return;
  element.style.width = `${size.width}px`;
  element.style.height = `${size.height}px`;
}

function applyNodeStyle(element, style) {
  if (!element || !style) return;
  element.style.background = style.fill;
  element.style.borderColor = style.border;
  element.style.color = style.text;
  element.style.setProperty("--node-accent", style.border || style.fill);
  const fontSize = Number(style.fontSize) || FONT_SIZE_MAP.default;
  element.style.fontSize = `${fontSize}rem`;
}

function applyCanvasTheme(themeId = "soft") {
  if (themeId === "custom" && treeData?.customTheme?.base) {
    const base = treeData.customTheme.base;
    CANVAS_THEMES.custom = {
      id: "custom",
      bodyStart: base,
      canvas: `linear-gradient(180deg, ${base}, #ffffff)`,
      scene: "transparent"
    };
    if (themeCustomColor) {
      themeCustomColor.value = base;
    }
  }
  const theme = CANVAS_THEMES[themeId] || CANVAS_THEMES.soft;
  if (sceneEl) {
    sceneEl.style.background = theme.scene;
  }
  if (canvas) {
    canvas.style.background = theme.canvas;
  }
  document.body.style.setProperty("--mindmap-bg", theme.bodyStart);
}

function suggestChildPosition(parent, index = 0) {
  if (parent) {
    ensureNodePosition(parent);
  }
  const parentPos = parent?.position ?? { x: 0, y: 0 };
  const spacingX = 240;
  const spacingY = 140;
  const total = (parent?.children?.length ?? 0) + 1;
  const offset = total > 1 ? (index - (total - 1) / 2) * spacingY : 0;
  return {
    x: parentPos.x + spacingX,
    y: parentPos.y + offset
  };
}

function createNodeElement(node, depth) {
  const nodeButton = document.createElement("button");
  nodeButton.type = "button";
  nodeButton.className = "tree-node";
  nodeButton.dataset.nodeId = node.id;
  nodeButton.dataset.nodeDepth = depth;
  if (!node.shape || !SHAPE_OPTIONS.includes(node.shape)) {
    node.shape = getDefaultShape(depth);
  }
  nodeButton.dataset.nodeShape = node.shape;
  nodeButton.textContent = node.content || UNTITLED_NODE;
  nodeButton.style.setProperty("--node-accent", getNodeColor(depth));
  if (node.id === selectedNodeId) {
    nodeButton.classList.add("is-selected");
  }

  nodeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    handleNodeSelection(node);
  });

  nodeButton.addEventListener("pointerdown", (event) => handleNodePointerDown(event, node));
  nodeButton.addEventListener("contextmenu", (event) => handleNodeContextMenu(event, node));

  nodeLayer.appendChild(nodeButton);
  applyNodeSize(nodeButton, node.size);
  applyNodeStyle(nodeButton, node.style);
  setNodeElementPosition(nodeButton, node.position);
  nodeElements.set(node.id, {
    element: nodeButton,
    node,
    size: { ...node.size }
  });
  attachResizeHandles(nodeButton, node);
  return nodeButton;
}

function attachResizeHandles(nodeElement, node) {
  const container = document.createElement("div");
  container.className = "resize-handles";
  RESIZE_HANDLES.forEach(handle => {
    const span = document.createElement("span");
    span.className = "resize-handle";
    span.dataset.handle = handle;
    span.addEventListener("pointerdown", (event) => handleResizePointerDown(event, node, handle));
    container.appendChild(span);
  });
  nodeElement.appendChild(container);
}

function drawConnector(parentNode, childNode) {
  const parentEntry = nodeElements.get(parentNode.id);
  const childEntry = nodeElements.get(childNode.id);
  if (!connectorLayer || !parentEntry || !childEntry) return;
  const path = document.createElementNS(SVG_NS, "path");
  path.classList.add("mindmap-connector");
  updateConnectorPath(path, parentEntry, childEntry);
  applyConnectorStyle(path, childEntry.node?.style);
  path.addEventListener("contextmenu", (event) => handleLinkContextMenu(event, childNode));
  connectorLayer.appendChild(path);
  connectorElements.set(childNode.id, path);
}

function toScenePosition(position) {
  return {
    x: HALF_SCENE + (position?.x ?? 0),
    y: HALF_SCENE + (position?.y ?? 0)
  };
}

function computeEdgeAnchor(center, size, toward) {
  if (!center || !toward || !size) return center;
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const halfWidth = (size.width || 0) / 2;
  const halfHeight = (size.height || 0) / 2;
  let scaleX = dx !== 0 ? halfWidth / Math.abs(dx) : Infinity;
  let scaleY = dy !== 0 ? halfHeight / Math.abs(dy) : Infinity;
  let scale = Math.min(scaleX, scaleY);
  if (!Number.isFinite(scale) || scale <= 0) {
    scale = 0;
  }
  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale
  };
}

function updateConnectorPath(pathEl, parentEntry, childEntry) {
  if (!pathEl || !parentEntry || !childEntry) return;
  const parentCenter = toScenePosition(parentEntry.node.position);
  const childCenter = toScenePosition(childEntry.node.position);
  const start = computeEdgeAnchor(parentCenter, parentEntry.size, childCenter);
  const end = computeEdgeAnchor(childCenter, childEntry.size, parentCenter);
  
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  
  let control1X, control1Y, control2X, control2Y;
  
  const controlDistance = Math.max(Math.abs(dx) * 0.5, 60);
  const approachDistance = Math.min(Math.abs(dx) * 0.3, 80);
  const angle = Math.atan2(dy, dx);
  
  if (dx >= 0) {
    //handle right line
    control1X = start.x + controlDistance;
    control1Y = start.y;
    control2X = end.x - Math.cos(angle) * approachDistance;
    control2Y = end.y - Math.sin(angle) * approachDistance;
  } else {
    //handle for left
    control1X = start.x - controlDistance;
    control1Y = start.y;
    control2X = end.x - Math.cos(angle) * approachDistance;
    control2Y = end.y - Math.sin(angle) * approachDistance;
  }
  
  const d = `M ${start.x} ${start.y} C ${control1X} ${control1Y}, ${control2X} ${control2Y}, ${end.x} ${end.y}`;
  pathEl.setAttribute("d", d);
}

function applyConnectorStyle(pathEl, nodeStyle) {
  const style = nodeStyle || {};
  const linkStyle = style.link || LINK_DEFAULT_STYLE;
  const strokeColor = linkStyle.color || style.linkColor || style.border || LINK_DEFAULT_STYLE.color;
  pathEl.style.stroke = strokeColor;
  pathEl.style.strokeWidth = `${linkStyle.strokeWidth || LINK_DEFAULT_STYLE.strokeWidth}px`;
  pathEl.style.opacity = linkStyle.strokeOpacity ?? LINK_DEFAULT_STYLE.strokeOpacity;
  pathEl.removeAttribute("marker-start");
  pathEl.removeAttribute("marker-end");
  if (linkStyle.arrow === "start" || linkStyle.arrow === "both") {
    const startId = getMarkerId("start", strokeColor);
    if (startId) {
      pathEl.setAttribute("marker-start", `url(#${startId})`);
    }
  }
  if (linkStyle.arrow === "end" || linkStyle.arrow === "both" || !linkStyle.arrow) {
    const endId = getMarkerId("end", strokeColor);
    if (endId) {
      pathEl.setAttribute("marker-end", `url(#${endId})`);
    }
  }
}

function getMarkerId(direction, color) {
  if (!connectorDefs) return null;
  const key = `${direction}:${color}`;
  if (markerCache.has(key)) {
    return markerCache.get(key);
  }
  const markerId = `mindmap-${direction}-${markerCounter++}`;
  const marker = document.createElementNS(SVG_NS, "marker");
  marker.setAttribute("id", markerId);
  marker.setAttribute("markerWidth", "7");
  marker.setAttribute("markerHeight", "7");
  marker.setAttribute("markerUnits", "strokeWidth");
  if (direction === "start") {
    marker.setAttribute("refX", "0");
    marker.setAttribute("refY", "3.5");
    marker.setAttribute("orient", "auto-start-reverse");
  } else {
    marker.setAttribute("refX", "7");
    marker.setAttribute("refY", "3.5");
    marker.setAttribute("orient", "auto");
  }
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", direction === "start" ? "M 7 0 L 0 3.5 L 7 7 z" : "M 0 0 L 7 3.5 L 0 7 z");
  path.setAttribute("fill", color);
  marker.appendChild(path);
  connectorDefs.appendChild(marker);
  markerCache.set(key, markerId);
  return markerId;
}

function renderNodeTree(node, depth = 0, parent = null, index = 0, total = 1) {
  if (!node) return;
  if (parent) {
    ensureNodePosition(parent);
  }
  ensureNodePosition(node, depth, parent, index, total);
  ensureNodeSize(node, depth);
  ensureNodeStyle(node, depth);
  const element = createNodeElement(node, depth);
  if (parent) {
    parentLookup[node.id] = parent.id;
    drawConnector(parent, node);
  } else {
    parentLookup[node.id] = null;
  }
  element.dataset.nodeDepth = depth;

  if (Array.isArray(node.children) && node.children.length > 0) {
    node.children.forEach((child, idx) => {
      renderNodeTree(child, depth + 1, node, idx, node.children.length);
    });
  }
}

function renderMindmap() {
  ensureScene();
  if (!contentEl || !nodeLayer || !connectorLayer) return;
  if (!treeData) {
    treeData = defaultData();
  }

  nodeLayer.innerHTML = "";
  while (connectorLayer.firstChild) {
    connectorLayer.removeChild(connectorLayer.firstChild);
  }
  
  connectorDefs = document.createElementNS(SVG_NS, "defs");
  connectorLayer.appendChild(connectorDefs);
  markerCache.clear();
  markerCounter = 0;
  
  nodeElements = new Map();
  connectorElements = new Map();
  parentLookup = {};

  renderNodeTree(treeData, 0, null, 0, 1);
  treeData.canvasTheme = canvasTheme;
  applyCanvasTheme(canvasTheme);

  updateSelectionHighlight();
  applyTransform();

  if (!hasRenderedOnce) {
    hasRenderedOnce = true;
    centerView({ resetScale: true, silent: true });
  }
}

function updateSelectionHighlight() {
  if (!nodeElements) return;
  nodeElements.forEach(({ element }, nodeId) => {
    element.classList.toggle("is-selected", nodeId === selectedNodeId);
  });
}

function handleNodeSelection(node) {
  if (!node) return;
  selectedNodeId = node.id;
  const entry = nodeElements.get(node.id);
  if (entry && nodeLayer) {
    nodeLayer.appendChild(entry.element);
  }
  notifyUser(`Đã chọn: "${node.content || UNTITLED_NODE}"`);
  updateSelectionHighlight();
}

function notifyUser(message) {
  if (!toolbar || !message) return;
  toolbar.textContent = message;
}

function handleNodeContextMenu(event, node) {
  event.preventDefault();
  event.stopPropagation();
  handleNodeSelection(node);
  openContextMenu(node, { x: event.clientX, y: event.clientY }, "node");
}

function handleLinkContextMenu(event, childNode) {
  event.preventDefault();
  event.stopPropagation();
  contextMenuTargetId = childNode.id;
  handleNodeSelection(childNode);
  openContextMenu(childNode, { x: event.clientX, y: event.clientY }, "link");
}

function openContextMenu(node, position, mode = "node") {
  if (!contextMenu || !stageElement) return;
  if (mode !== "canvas" && !node) return;
  contextMenuTargetId = node?.id ?? null;
  setContextMenuMode(mode);
  if (mode === "node" && node) {
    updateContextMenuButtons(node);
  } else if (mode === "link" && node) {
    highlightArrowOptions(node);
    highlightWidthOptions(node);
    highlightOpacityOptions(node);
  } else if (mode === "canvas") {
    highlightThemeOptions(canvasTheme);
  }
  const stageRect = stageElement.getBoundingClientRect();
  let left = position.x - stageRect.left;
  let top = position.y - stageRect.top;
  contextMenu.hidden = false;
  contextMenu.style.left = `${left}px`;
  contextMenu.style.top = `${top}px`;

  const menuRect = contextMenu.getBoundingClientRect();
  const overflowX = Math.max(0, menuRect.right - stageRect.right);
  const overflowY = Math.max(0, menuRect.bottom - stageRect.bottom);
  if (overflowX > 0) {
    left -= overflowX;
  }
  if (overflowY > 0) {
    top -= overflowY;
  }
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  contextMenu.style.left = `${left}px`;
  contextMenu.style.top = `${top}px`;
}

function closeContextMenu() {
  if (!contextMenu) return;
  contextMenu.hidden = true;
  contextMenuTargetId = null;
  setContextMenuMode("node");
}

function isModalOpen() {
  return modalElement && !modalElement.hidden;
}

function setContextMenuMode(mode = "node") {
  contextMenuTargetType = mode;
  if (!contextSections) return;
  contextSections.forEach(section => {
    const target = section.dataset.contextFor || "node";
    if (target === "both") {
      section.hidden = false;
      return;
    }
    section.hidden = target !== mode;
  });
  if (mode === "canvas") {
    highlightThemeOptions(canvasTheme);
  }
}

function hideModalFrame() {
  if (modalBackdrop) modalBackdrop.hidden = true;
  if (modalElement) modalElement.hidden = true;
  if (modalInput) {
    modalInput.value = "";
    modalInput.classList.remove("has-error");
  }
  if (modalTextarea) {
    modalTextarea.value = "";
    modalTextarea.classList.remove("has-error");
  }
}

function resolveModal(result) {
  if (!modalState.resolver) {
    hideModalFrame();
    return;
  }
  const resolver = modalState.resolver;
  modalState.resolver = null;
  hideModalFrame();
  resolver(result);
}

function showModalDialog(options = {}) {
  if (!modalElement || !modalBackdrop) return Promise.resolve(null);
  return new Promise((resolve) => {
    closeContextMenu();
    modalState.resolver = resolve;
    modalState.mode = options.mode || "info";

    modalTitle.textContent = options.title || "Thông báo";
    if (options.message) {
      modalMessage.textContent = options.message;
      modalMessage.hidden = false;
    } else {
      modalMessage.hidden = true;
    }

    modalInputWrap.hidden = modalState.mode !== "input";
    modalTextareaWrap.hidden = modalState.mode !== "textarea";

    if (modalState.mode === "input") {
      modalInput.value = options.defaultValue || "";
      modalInput.placeholder = options.placeholder || "Nhập nội dung...";
      modalInput.classList.remove("has-error");
      setTimeout(() => modalInput.focus(), 30);
    }

    if (modalState.mode === "textarea") {
      modalTextarea.value = options.defaultValue || "";
      modalTextarea.placeholder = options.placeholder || "Dán nội dung tại đây...";
      modalTextarea.classList.remove("has-error");
      setTimeout(() => modalTextarea.focus(), 30);
    }

    modalConfirmBtn.textContent = options.confirmLabel || "Xong";
    modalConfirmBtn.classList.toggle("is-danger", !!options.danger);
    modalCancelBtn.textContent = options.cancelLabel || "Huỷ";
    modalCancelBtn.hidden = !!options.hideCancel;

    modalBackdrop.hidden = false;
    modalElement.hidden = false;
  });
}

function showInputModal(options = {}) {
  return showModalDialog({
    ...options,
    mode: "input",
    confirmLabel: options.confirmLabel || "Lưu"
  });
}

function showConfirmModal(options = {}) {
  return showModalDialog({
    ...options,
    mode: "confirm",
    confirmLabel: options.confirmLabel || "Đồng ý",
    cancelLabel: options.cancelLabel || "Huỷ"
  });
}

function showNoticeModal(options = {}) {
  return showModalDialog({
    ...options,
    mode: "info",
    confirmLabel: options.confirmLabel || "Đã hiểu",
    hideCancel: true
  });
}

function updateContextMenuButtons(node) {
  if (contextMenuTargetType !== "node") return;
  if (!contextMenuButtons) return;
  const isRoot = node.id === treeData?.id;
  contextMenuButtons.forEach(btn => {
    const action = btn.dataset.contextAction;
    if (!action) return;
    if (action === "add-sibling" || action === "delete-node") {
      btn.disabled = isRoot;
    } else {
      btn.disabled = false;
    }
  });
  const depth = getNodeDepth(node.id);
  ensureNodeStyle(node, depth);
  highlightShapeOptions(node.shape || getDefaultShape(depth));
  highlightColorOptions(node);
  highlightFontOptions(node);
  highlightArrowOptions(node);
  highlightWidthOptions(node);
  highlightOpacityOptions(node);
}

function highlightShapeOptions(activeShape) {
  if (!contextShapeButtons) return;
  contextShapeButtons.forEach(btn => {
    const action = btn.dataset.contextAction;
    const buttonShape = action?.replace("shape-", "");
    if (!buttonShape) return;
    if (buttonShape === activeShape) {
      btn.classList.add("is-active");
    } else {
      btn.classList.remove("is-active");
    }
  });
}

function highlightColorOptions(node) {
  if (!colorButtons) return;
  const depth = getNodeDepth(node.id);
  ensureNodeStyle(node, depth);
  const active = node?.style?.preset;
  colorButtons.forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.colorPreset === active);
  });
}

function highlightArrowOptions(node) {
  if (!arrowButtons) return;
  ensureNodeStyle(node, getNodeDepth(node.id));
  const arrow = node?.style?.link?.arrow || LINK_DEFAULT_STYLE.arrow;
  arrowButtons.forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.linkArrow === arrow);
  });
}

function highlightWidthOptions(node) {
  if (!widthButtons) return;
  ensureNodeStyle(node, getNodeDepth(node.id));
  const width = node?.style?.link?.strokeWidth || LINK_DEFAULT_STYLE.strokeWidth;
  let key = "medium";
  if (width <= LINK_WIDTH_MAP.thin) key = "thin";
  else if (width >= LINK_WIDTH_MAP.thick) key = "thick";
  widthButtons.forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.linkWidth === key);
  });
}

function highlightOpacityOptions(node) {
  if (!opacityButtons) return;
  ensureNodeStyle(node, getNodeDepth(node.id));
  const opacity = node?.style?.link?.strokeOpacity || LINK_DEFAULT_STYLE.strokeOpacity;
  let key = "normal";
  if (opacity <= LINK_OPACITY_MAP.soft + 0.05) key = "soft";
  else if (opacity >= LINK_OPACITY_MAP.bold - 0.05) key = "bold";
  opacityButtons.forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.linkOpacity === key);
  });
}

function highlightFontOptions(node) {
  const fontButtons = contextMenu?.querySelectorAll(".font-options button");
  if (!fontButtons || !node) return;
  ensureNodeStyle(node, getNodeDepth(node.id));
  const current = Number(node.style.fontSize) || FONT_SIZE_MAP.default;
  const valueEl = document.getElementById("contextFontValue");
  if (valueEl) {
    valueEl.textContent = `${Math.round((current / FONT_SIZE_MAP.default) * 100)}%`;
  }
  fontButtons.forEach(btn => {
    const action = btn.dataset.contextAction;
    btn.classList.remove("is-active");
    btn.disabled = false;
    if (action === "font-decrease" && current <= FONT_SIZE_MAP.min + 0.001) {
      btn.disabled = true;
    }
    if (action === "font-increase" && current >= FONT_SIZE_MAP.max - 0.001) {
      btn.disabled = true;
    }
    if (action === "font-reset" && Math.abs(current - FONT_SIZE_MAP.default) < 0.001) {
      btn.classList.add("is-active");
    }
  });
}

function highlightThemeOptions(activeTheme) {
  if (themeButtons) {
    themeButtons.forEach(btn => {
      btn.classList.toggle("is-active", btn.dataset.theme === activeTheme);
    });
  }
  if (themeCustomColor) {
    if (activeTheme === "custom" && treeData?.customTheme) {
      themeCustomColor.value = treeData.customTheme.base;
    } else {
      themeCustomColor.value = CANVAS_THEMES.custom.bodyStart;
    }
    themeCustomColor.previousElementSibling?.style?.setProperty("--swatch-color", themeCustomColor.value);
  }
}

function handleNodePointerDown(event, node) {
  if (event.button !== 0) return;
  event.stopPropagation();
  const entry = nodeElements.get(node.id);
  if (!entry) return;
  nodeDragState.pointerId = event.pointerId;
  nodeDragState.nodeId = node.id;
  nodeDragState.origin = { x: event.clientX, y: event.clientY };
  nodeDragState.startPosition = {
    x: node.position?.x ?? 0,
    y: node.position?.y ?? 0
  };
  nodeDragState.element = entry.element;
  if (nodeLayer) {
    nodeLayer.appendChild(entry.element);
  }
  entry.element.setPointerCapture?.(event.pointerId);
  entry.element.classList.add("is-dragging-node");
  canvas?.classList.add("is-node-dragging");
  document.addEventListener("pointermove", handleNodePointerMove);
  document.addEventListener("pointerup", handleNodePointerUp);
  document.addEventListener("pointercancel", handleNodePointerUp);
}

function handleNodePointerMove(event) {
  if (!nodeDragState.nodeId || event.pointerId !== nodeDragState.pointerId) return;
  const dx = (event.clientX - nodeDragState.origin.x) / viewState.scale;
  const dy = (event.clientY - nodeDragState.origin.y) / viewState.scale;
  const node = findNodeById(nodeDragState.nodeId);
  if (!node) return;
  node.position = {
    x: nodeDragState.startPosition.x + dx,
    y: nodeDragState.startPosition.y + dy
  };
  const entry = nodeElements.get(node.id);
  if (entry) {
    setNodeElementPosition(entry.element, node.position);
  }
  updateConnectedEdges(node.id);
}

function handleNodePointerUp(event) {
  if (event.pointerId !== nodeDragState.pointerId) return;
  const nodeId = nodeDragState.nodeId;
  const element = nodeDragState.element;
  element?.classList.remove("is-dragging-node");
  element?.releasePointerCapture?.(event.pointerId);
  canvas?.classList.remove("is-node-dragging");
  nodeDragState.pointerId = null;
  nodeDragState.nodeId = null;
  nodeDragState.element = null;
  document.removeEventListener("pointermove", handleNodePointerMove);
  document.removeEventListener("pointerup", handleNodePointerUp);
  document.removeEventListener("pointercancel", handleNodePointerUp);
  saveData();
  updateConnectedEdges(nodeId);
}

function updateConnectedEdges(nodeId) {
  if (!nodeId) return;
  const nodeEntry = nodeElements.get(nodeId);
  const node = nodeEntry?.node;
  if (!node || !node.position) return;
  ensureNodeStyle(node, getNodeDepth(nodeId));
  const parentId = parentLookup[nodeId];
  if (parentId && connectorElements.has(nodeId)) {
    const parentEntry = nodeElements.get(parentId);
    const path = connectorElements.get(nodeId);
    if (parentEntry && path) {
      updateConnectorPath(path, parentEntry, nodeEntry);
      applyConnectorStyle(path, nodeEntry.node?.style);
    }
  }
  if (Array.isArray(node.children)) {
    node.children.forEach(child => {
      const path = connectorElements.get(child.id);
      const childEntry = nodeElements.get(child.id);
      if (path && childEntry) {
        updateConnectorPath(path, nodeEntry, childEntry);
        applyConnectorStyle(path, childEntry.node?.style);
      }
    });
  }
}

function handleResizePointerDown(event, node, handle) {
  event.stopPropagation();
  event.preventDefault();
  closeContextMenu();
  const entry = nodeElements.get(node.id);
  if (!entry) return;
  const element = entry.element;
  const pointerId = event.pointerId;
  nodeResizeState.pointerId = pointerId;
  nodeResizeState.nodeId = node.id;
  nodeResizeState.handle = handle;
  nodeResizeState.startPointer = { x: event.clientX, y: event.clientY };
  nodeResizeState.startSize = {
    width: node.size?.width || entry.size?.width || MIN_NODE_WIDTH,
    height: node.size?.height || entry.size?.height || MIN_NODE_HEIGHT
  };
  nodeResizeState.startPosition = { ...node.position };
  nodeResizeState.element = element;
  element.classList.add("is-resizing-node");
  canvas?.classList.add("is-node-resizing");
  document.addEventListener("pointermove", handleResizePointerMove);
  document.addEventListener("pointerup", handleResizePointerUp);
  document.addEventListener("pointercancel", handleResizePointerUp);
}

function handleResizePointerMove(event) {
  if (!nodeResizeState.pointerId || event.pointerId !== nodeResizeState.pointerId) return;
  const entry = nodeElements.get(nodeResizeState.nodeId);
  if (!entry) return;
  const node = entry.node;
  const dx = (event.clientX - nodeResizeState.startPointer.x) / viewState.scale;
  const dy = (event.clientY - nodeResizeState.startPointer.y) / viewState.scale;

  const { width: startWidth, height: startHeight } = nodeResizeState.startSize;
  const startPos = nodeResizeState.startPosition;
  let newWidth = startWidth;
  let newHeight = startHeight;
  let newPosX = startPos.x;
  let newPosY = startPos.y;
  const handle = nodeResizeState.handle;

  const affectsWest = handle.includes("left");
  const affectsEast = handle.includes("right") && !handle.includes("left");
  const affectsNorth = handle.includes("top");
  const affectsSouth = handle.includes("bottom") && !handle.includes("top");

  if (handle === "left") {
    const proposed = clampSize(startWidth - dx, MIN_NODE_WIDTH, MAX_NODE_WIDTH);
    const diff = startWidth - proposed;
    newWidth = proposed;
    newPosX = startPos.x + diff / 2;
  } else if (handle === "right") {
    const proposed = clampSize(startWidth + dx, MIN_NODE_WIDTH, MAX_NODE_WIDTH);
    const diff = proposed - startWidth;
    newWidth = proposed;
    newPosX = startPos.x + diff / 2;
  }

  if (handle === "top") {
    const proposed = clampSize(startHeight - dy, MIN_NODE_HEIGHT, MAX_NODE_HEIGHT);
    const diff = startHeight - proposed;
    newHeight = proposed;
    newPosY = startPos.y + diff / 2;
  } else if (handle === "bottom") {
    const proposed = clampSize(startHeight + dy, MIN_NODE_HEIGHT, MAX_NODE_HEIGHT);
    const diff = proposed - startHeight;
    newHeight = proposed;
    newPosY = startPos.y + diff / 2;
  }

  if (affectsWest && handle !== "left") {
    const proposed = clampSize(startWidth - dx, MIN_NODE_WIDTH, MAX_NODE_WIDTH);
    const diff = startWidth - proposed;
    newWidth = proposed;
    newPosX = startPos.x + diff / 2;
  }
  if (affectsEast && handle !== "right") {
    const proposed = clampSize(startWidth + dx, MIN_NODE_WIDTH, MAX_NODE_WIDTH);
    const diff = proposed - startWidth;
    newWidth = proposed;
    newPosX = startPos.x + diff / 2;
  }
  if (affectsNorth && handle !== "top") {
    const proposed = clampSize(startHeight - dy, MIN_NODE_HEIGHT, MAX_NODE_HEIGHT);
    const diff = startHeight - proposed;
    newHeight = proposed;
    newPosY = startPos.y + diff / 2;
  }
  if (affectsSouth && handle !== "bottom") {
    const proposed = clampSize(startHeight + dy, MIN_NODE_HEIGHT, MAX_NODE_HEIGHT);
    const diff = proposed - startHeight;
    newHeight = proposed;
    newPosY = startPos.y + diff / 2;
  }

  node.size = { width: newWidth, height: newHeight };
  node.position = { x: newPosX, y: newPosY };
  entry.size = { ...node.size };
  applyNodeSize(entry.element, node.size);
  setNodeElementPosition(entry.element, node.position);
  updateConnectedEdges(node.id);
}

function handleResizePointerUp(event) {
  if (!nodeResizeState.pointerId || event.pointerId !== nodeResizeState.pointerId) return;
  const entry = nodeElements.get(nodeResizeState.nodeId);
  entry?.element?.classList.remove("is-resizing-node");
  canvas?.classList.remove("is-node-resizing");
  nodeResizeState.pointerId = null;
  nodeResizeState.nodeId = null;
  nodeResizeState.handle = null;
  nodeResizeState.element = null;
  document.removeEventListener("pointermove", handleResizePointerMove);
  document.removeEventListener("pointerup", handleResizePointerUp);
  document.removeEventListener("pointercancel", handleResizePointerUp);
  saveData();
}

function clampSize(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// View controls
function applyTransform() {
  if (!sceneEl) return;
  sceneEl.style.transform = `translate(-50%, -50%) translate(${viewState.panX}px, ${viewState.panY}px) scale(${viewState.scale})`;
}

function centerView({ resetScale = false, silent = false } = {}) {
  viewState.panX = 0;
  viewState.panY = 0;
  if (resetScale) {
    viewState.scale = 1;
  }
  applyTransform();
  if (!silent && toolbar) {
    toolbar.textContent = "Đã căn giữa sơ đồ";
  }
}

function zoom(direction) {
  const nextScale = viewState.scale * (direction === "in" ? (1 + SCALE_STEP) : (1 - SCALE_STEP));
  viewState.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
  applyTransform();
}

function handlePointerDown(event) {
  if (event.button !== 0) return;
  closeContextMenu();
  pointerState.active = true;
  pointerState.pointerId = event.pointerId;
  pointerState.origin = { x: event.clientX, y: event.clientY };
  pointerState.panOrigin = { x: viewState.panX, y: viewState.panY };
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add(DRAGGING_CLASS);
}

function handlePointerMove(event) {
  if (!pointerState.active || event.pointerId !== pointerState.pointerId) return;
  const dx = event.clientX - pointerState.origin.x;
  const dy = event.clientY - pointerState.origin.y;
  viewState.panX = pointerState.panOrigin.x + dx;
  viewState.panY = pointerState.panOrigin.y + dy;
  applyTransform();
}

function handlePointerUp(event) {
  if (!pointerState.active || event.pointerId !== pointerState.pointerId) return;
  pointerState.active = false;
  canvas.classList.remove(DRAGGING_CLASS);
  if (typeof canvas.releasePointerCapture === "function" && canvas.hasPointerCapture?.(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

function handleWheel(event) {
  event.preventDefault();
  const direction = event.deltaY < 0 ? "in" : "out";
  zoom(direction);
}

function bindCanvasInteractions() {
  if (!canvas) return;
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointerleave", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerUp);
  canvas.addEventListener("wheel", handleWheel, { passive: false });
  canvas.addEventListener("contextmenu", (event) => {
    const isNode = event.target.closest?.(".tree-node");
    const isMenu = event.target.closest?.(".mindmap-context-menu");
    const isConnector = event.target.closest?.(".mindmap-connector");
    if (!isNode && !isMenu && !isConnector) {
      event.preventDefault();
      openContextMenu(null, { x: event.clientX, y: event.clientY }, "canvas");
    }
  });
}

// CRUD helpers
function getSelectedNode() {
  if (!selectedNodeId) {
    notifyUser("Vui lòng chọn một nhánh trên sơ đồ trước.");
    return null;
  }
  const node = findNode(treeData, selectedNodeId);
  if (!node) {
    notifyUser("Không tìm thấy node đã chọn, vui lòng chọn lại.");
    selectedNodeId = treeData?.id ?? null;
    updateSelectionHighlight();
    return null;
  }
  return node;
}

function rerenderMap(options = {}) {
  const { preserveSelection = true, skipSave = false } = options;
  if (!preserveSelection) {
    selectedNodeId = treeData?.id ?? null;
  }
  renderMindmap();
  if (!skipSave) {
    saveData();
  }
}

async function addChildNode(targetId = null) {
  closeContextMenu();
  let targetNode = null;
  if (targetId) {
    targetNode = findNode(treeData, targetId);
  } else {
    targetNode = selectedNodeId ? getSelectedNode() : treeData;
  }
  if (!targetNode) return;

  const name = await showInputModal({
    title: "Nhánh con mới",
    message: `Nhập tên cho nhánh con của "${targetNode.content}"`,
    defaultValue: "Nhánh mới",
    placeholder: "Ví dụ: Kế hoạch, Ý tưởng..."
  });
  if (!name) return;

  if (!Array.isArray(targetNode.children)) {
    targetNode.children = [];
  }

  const nextIndex = targetNode.children.length;
  const childDepth = Math.max(0, getNodeDepth(targetNode.id)) + 1;
  const childShape = getDefaultShape(childDepth);
  const newChild = {
    id: generateNodeId(),
    content: name,
    position: suggestChildPosition(targetNode, nextIndex),
    shape: childShape,
    size: getDefaultSize(childShape),
    children: []
  };
  targetNode.children.push(newChild);

  selectedNodeId = newChild.id;
  rerenderMap();
  notifyUser(`Đã thêm nhánh con cho "${targetNode.content}"`);
}

async function addSiblingNode(targetId = null) {
  closeContextMenu();
  const node = targetId ? findNode(treeData, targetId) : getSelectedNode();
  if (!node) return;

  const parent = findParent(treeData, node.id);
  if (!parent) {
    await showNoticeModal({
      title: "Không thể thêm nhánh",
      message: "Node gốc không thể thêm nhánh cùng cấp. Vui lòng dùng 'Nhánh con'."
    });
    return;
  }

  const name = await showInputModal({
    title: "Nhánh cùng cấp",
    message: `Nhập tên cho nhánh cùng cấp với "${node.content}"`,
    defaultValue: "Nhánh mới",
    placeholder: "Ví dụ: Thử nghiệm, Mở rộng..."
  });
  if (!name) return;

  if (!Array.isArray(parent.children)) {
    parent.children = [];
  }

  const nextIndex = parent.children.length;
  const siblingDepth = Math.max(0, getNodeDepth(node.id));
  const siblingShape = getDefaultShape(siblingDepth);
  const sibling = {
    id: generateNodeId(),
    content: name,
    position: suggestChildPosition(parent, nextIndex),
    shape: siblingShape,
    size: getDefaultSize(siblingShape),
    children: []
  };
  parent.children.push(sibling);

  selectedNodeId = sibling.id;
  rerenderMap();
  notifyUser(`Đã thêm nhánh bên cạnh "${node.content}"`);
}

async function editNode(targetId = null) {
  closeContextMenu();
  const node = targetId ? findNode(treeData, targetId) : getSelectedNode();
  if (!node) return;

  const newName = await showInputModal({
    title: "Đổi tên nhánh",
    message: `Nhập tên mới cho "${node.content}"`,
    defaultValue: node.content,
    placeholder: "Tên nhánh"
  });
  if (!newName) return;

  node.content = newName;
  rerenderMap({ skipSave: false });
  notifyUser(`Đã đổi tên thành: "${newName}"`);
}

async function deleteNode(targetId = null) {
  closeContextMenu();
  const node = targetId ? findNode(treeData, targetId) : getSelectedNode();
  if (!node) return;

  const parent = findParent(treeData, node.id);
  if (!parent) {
    await showNoticeModal({
      title: "Không thể xóa",
      message: "Không thể xóa node gốc."
    });
    return;
  }

  const confirmDelete = await showConfirmModal({
    title: "Xóa nhánh?",
    message: `Xóa "${node.content}" và toàn bộ nhánh con?`,
    confirmLabel: "Xóa",
    cancelLabel: "Giữ lại",
    danger: true
  });
  if (!confirmDelete) return;

  parent.children = parent.children.filter(child => child.id !== node.id);
  selectedNodeId = parent.id;

  rerenderMap();
  notifyUser("Node đã xóa");
}

function changeNodeShape(targetId = null, shape = "pill") {
  if (!SHAPE_OPTIONS.includes(shape)) return;
  const node = targetId ? findNode(treeData, targetId) : getSelectedNode();
  if (!node) return;
  ensureNodeStyle(node, getNodeDepth(node.id));
  node.shape = shape;
  if (!node.size) {
    node.size = getDefaultSize(shape);
  }
  rerenderMap();
  notifyUser(`Đã đổi hình dạng của "${node.content}"`);
}

function changeNodeColor(targetId = null, presetId = "purple") {
  const preset = NODE_COLOR_PRESETS[presetId];
  if (!preset) return;
  const node = targetId ? findNode(treeData, targetId) : getSelectedNode();
  if (!node) return;
  const depth = getNodeDepth(node.id);
  ensureNodeStyle(node, depth);
  node.style = {
    ...node.style,
    fill: preset.fill,
    border: preset.border,
    text: preset.text,
    linkColor: preset.linkColor,
    preset: presetId
  };
  if (node.style.link) {
    node.style.link.color = preset.linkColor || node.style.link.color;
  }
  rerenderMap({ skipSave: false });
  notifyUser("Đã đổi màu nhánh");
}

function changeLinkArrow(targetId = null, arrow = "end") {
  if (!["none", "end", "start", "both"].includes(arrow)) return;
  const node = targetId ? findNode(treeData, targetId) : getSelectedNode();
  if (!node) return;
  ensureNodeStyle(node, getNodeDepth(node.id));
  node.style.link.arrow = arrow;
  rerenderMap({ skipSave: false });
  notifyUser("Đã cập nhật mũi tên đường nối");
}

function changeLinkThickness(targetId = null, key = "medium") {
  const value = LINK_WIDTH_MAP[key];
  if (!value) return;
  const node = targetId ? findNode(treeData, targetId) : getSelectedNode();
  if (!node) return;
  ensureNodeStyle(node, getNodeDepth(node.id));
  node.style.link.strokeWidth = value;
  rerenderMap({ skipSave: false });
  notifyUser("Đã đổi độ dày đường nối");
}

function changeLinkOpacity(targetId = null, key = "normal") {
  const value = LINK_OPACITY_MAP[key];
  if (!value) return;
  const node = targetId ? findNode(treeData, targetId) : getSelectedNode();
  if (!node) return;
  ensureNodeStyle(node, getNodeDepth(node.id));
  node.style.link.strokeOpacity = value;
  rerenderMap({ skipSave: false });
  notifyUser("Đã đổi độ đậm đường nối");
}

function changeCanvasTheme(themeId = "soft") {
  if (!CANVAS_THEMES[themeId]) return;
  canvasTheme = themeId;
  if (treeData) {
    treeData.canvasTheme = themeId;
    if (themeId !== "custom") {
      delete treeData.customTheme;
    }
  }
  applyCanvasTheme(themeId);
  highlightThemeOptions(themeId);
  saveData();
  notifyUser("Đã đổi chủ đề nền");
}

function applyCustomCanvasTheme() {
  if (!themeCustomColor) return;
  const base = themeCustomColor.value || "#fff7f1";
  const gradient = `linear-gradient(180deg, ${base}, #ffffff)`;
  CANVAS_THEMES.custom = {
    id: "custom",
    bodyStart: base,
    canvas: gradient,
    scene: "transparent"
  };
  canvasTheme = "custom";
  if (treeData) {
    treeData.canvasTheme = "custom";
    treeData.customTheme = { base };
  }
  applyCanvasTheme("custom");
  highlightThemeOptions("custom");
  saveData();
  notifyUser("Đã áp dụng màu nền tùy chỉnh");
}

function changeFontSize(targetId = null, key = "medium") {
  const node = targetId ? findNode(treeData, targetId) : getSelectedNode();
  if (!node) return;
  ensureNodeStyle(node, getNodeDepth(node.id));
  let current = Number(node.style.fontSize) || FONT_SIZE_MAP.default;
  if (key === "increase") {
    current = Math.min(FONT_SIZE_MAP.max, current + FONT_SIZE_MAP.step);
  } else if (key === "decrease") {
    current = Math.max(FONT_SIZE_MAP.min, current - FONT_SIZE_MAP.step);
  } else {
    current = FONT_SIZE_MAP.default;
  }
  node.style.fontSize = current;
  rerenderMap({ skipSave: false });
  highlightFontOptions(node);
  notifyUser("Đã cập nhật cỡ chữ");
}

function setAiStatus(message = "", type = "info") {
  if (!aiStatusText) return;
  aiStatusText.textContent = message || "";
  aiStatusText.classList.remove("is-error", "is-success");
  if (type === "error") {
    aiStatusText.classList.add("is-error");
  } else if (type === "success") {
    aiStatusText.classList.add("is-success");
  }
}

function setAiGenerating(state) {
  aiIsGenerating = state;
  if (aiModal) {
    aiModal.classList.toggle("is-generating", state);
  }
  updateAiButtonsState();
}

function clearAiFileSelection() {
  if (aiFileInput) {
    aiFileInput.value = "";
  }
  aiFileText = "";
  aiFileReading = false;
  if (aiFileName) {
    aiFileName.textContent = "Chưa chọn file";
  }
  if (aiClearFileBtn) {
    aiClearFileBtn.hidden = true;
  }
  updateAiButtonsState();
}

function resetAiForm() {
  if (aiPromptInput) {
    aiPromptInput.value = "";
  }
  clearAiFileSelection();
  setAiStatus("");
}

function openAIModal() {
  if (!aiModal || !modalBackdrop) return;
  modalBackdrop.hidden = false;
  aiModal.hidden = false;
  setAiStatus("");
  updateAiButtonsState();
}

function closeAIModal(force = false) {
  if (!aiModal || !modalBackdrop) return;
  if (aiIsGenerating && !force) {
    setAiStatus("Đang tạo sơ đồ, vui lòng chờ AI hoàn tất...", "info");
    return;
  }
  aiModal.hidden = true;
  modalBackdrop.hidden = true;
  setAiStatus("");
}

async function handleAiFileChange(event) {
  const file = event.target.files?.[0];
  aiFileText = "";
  if (aiFileName) {
    aiFileName.textContent = file ? "Đang đọc file..." : "Chưa chọn file";
  }
  if (aiClearFileBtn) {
    aiClearFileBtn.hidden = !file;
  }
  if (!file) {
    aiFileReading = false;
    setAiStatus("");
    updateAiButtonsState();
    return;
  }
  aiFileReading = true;
  updateAiButtonsState();
  try {
    const text = await file.text();
    aiFileText = text;
    if (aiFileName) {
      aiFileName.textContent = file.name || "Đã tải file";
    }
    if (!text.trim()) {
      setAiStatus("File TXT đang trống, hãy nhập nội dung trước.", "error");
    } else {
      setAiStatus(`Đã tải "${file.name}"`, "success");
    }
  } catch (err) {
    console.error("AI file read error:", err);
    setAiStatus("Không thể đọc file TXT, thử lại nhé.", "error");
    aiFileText = "";
    if (aiFileName) {
      aiFileName.textContent = "Chưa chọn file";
    }
    if (aiFileInput) {
      aiFileInput.value = "";
    }
  } finally {
    aiFileReading = false;
    updateAiButtonsState();
  }
}

function handleAiPromptInput() {
  if (aiStatusText && aiStatusText.classList.contains("is-error")) {
    setAiStatus("");
  }
  updateAiButtonsState();
}

function updateAiButtonsState() {
  const hasPrompt = Boolean(aiPromptInput?.value.trim());
  const hasFile = Boolean(aiFileInput?.files?.[0]);
  const promptOption = aiPromptInput?.closest(".ai-option");
  const fileOption = aiFileInput?.closest(".ai-option");
  const disablePrompt = hasFile || aiIsGenerating || aiFileReading;
  const disableFile = hasPrompt || aiIsGenerating;
  if (promptOption) {
    promptOption.classList.toggle("is-disabled", disablePrompt && !hasPrompt);
    promptOption.classList.toggle("is-active", hasPrompt && !hasFile);
  }
  if (fileOption) {
    fileOption.classList.toggle("is-disabled", disableFile);
    fileOption.classList.toggle("is-active", hasFile && !hasPrompt);
  }
  if (aiPromptInput) aiPromptInput.disabled = disablePrompt;
  if (aiFileInput) aiFileInput.disabled = disableFile;
  if (aiClearFileBtn) {
    aiClearFileBtn.hidden = !hasFile;
  }
  if (!aiGenerateBtn) return;
  if (aiIsGenerating) {
    aiGenerateBtn.disabled = true;
    aiGenerateBtn.textContent = AI_GENERATE_LOADING_TEXT;
    return;
  }
  if (aiFileReading) {
    aiGenerateBtn.disabled = true;
    aiGenerateBtn.textContent = "Đang đọc file...";
    return;
  }
  if (hasPrompt || hasFile) {
    aiGenerateBtn.disabled = false;
    aiGenerateBtn.textContent = AI_GENERATE_TEXT;
  } else {
    aiGenerateBtn.disabled = true;
    aiGenerateBtn.textContent = "Đang chờ lựa chọn...";
  }
}

async function handleAiGenerate() {
  if (aiIsGenerating || aiFileReading) return;
  const prompt = (aiPromptInput?.value || "").trim();
  const file = aiFileInput?.files?.[0];
  const hasPrompt = Boolean(prompt);
  const hasFile = Boolean(file);
  if (!hasPrompt && !hasFile) {
    setAiStatus("Hãy nhập prompt hoặc chọn file TXT.", "error");
    return;
  }
  if (hasFile && !aiFileText.trim()) {
    setAiStatus("File TXT đang trống, hãy chọn file khác.", "error");
    return;
  }
  const payload = hasPrompt ? { prompt } : { fileText: aiFileText.slice(0, 15000) };
  setAiStatus("Đang tạo sơ đồ với Gemini...", "info");
  setAiGenerating(true);
  try {
    const response = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include"
    });
    const isJson = (response.headers.get("content-type") || "").includes("application/json");
    const data = isJson ? await response.json() : { error: await response.text() };
    if (!response.ok) {
      throw new Error(data?.error || "Máy chủ AI đang bận, thử lại nhé.");
    }
    const normalized = normalizeNode(data.tree || data.data || data);
    if (!normalized) {
      throw new Error("Dữ liệu AI không hợp lệ.");
    }
    applyImportedTree(normalized);
    resetAiForm();
    closeAIModal(true);
    notifyUser("AI đã tạo sơ đồ tư duy mới");
  } catch (err) {
    console.error("mindmap AI error:", err);
    setAiStatus(err.message || "Không thể tạo sơ đồ, vui lòng thử lại.", "error");
  } finally {
    setAiGenerating(false);
  }
}

// Export / Import
async function ensureDomToImage() {
  if (window.domtoimage) return window.domtoimage;
  if (!window.__domToImagePromise) {
    window.__domToImagePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/dom-to-image-more@3.2.0/dist/dom-to-image-more.min.js";
      script.async = true;
      script.onload = () => resolve(window.domtoimage);
      script.onerror = () => reject(new Error("Không thể tải thư viện xuất PNG"));
      document.head.appendChild(script);
    });
  }
  return window.__domToImagePromise;
}

function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportPNGFile() {
  try {
    const domtoimage = await ensureDomToImage();
    const target = document.getElementById(containerId);
    if (!target) return;
    const dataUrl = await domtoimage.toPng(target, {
      cacheBust: true,
      bgcolor: "#fff7f1"
    });
    downloadDataUrl(dataUrl, `taedu-mindmap-${Date.now()}.png`);
    notifyUser("Đã xuất PNG thành công!");
  } catch (err) {
    await showNoticeModal({
      title: "Lỗi khi xuất PNG",
      message: err.message || "Vui lòng thử lại sau."
    });
  }
}

function exportJSONFile() {
  try {
    const payload = { ...treeData, canvasTheme };
    const data = JSON.stringify(payload, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    downloadBlob(blob, `taedu-mindmap-${Date.now()}.json`);
    notifyUser("Đã tải file mindmap (.json).");
  } catch (err) {
    console.warn("Export JSON error:", err);
  }
}

function triggerFileImport() {
  if (!fileInput) return;
  fileInput.value = "";
  fileInput.click();
}

async function handleFileInputChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    await importMindmapFromString(text);
    notifyUser(`Đã nhập mindmap từ "${file.name}"`);
  } catch (err) {
    await showNoticeModal({
      title: "Không thể nhập file",
      message: err.message || "File không hợp lệ."
    });
  } finally {
    event.target.value = "";
  }
}

async function importMindmapFromString(raw) {
  if (!raw) throw new Error("Không có dữ liệu");
  const data = JSON.parse(raw);
  const normalized = normalizeNode(data);
  if (!normalized) {
    throw new Error("Dữ liệu không hợp lệ");
  }
  applyImportedTree(normalized);
}

function applyImportedTree(normalized) {
  if (!normalized) {
    throw new Error("Dữ liệu mindmap không hợp lệ");
  }
  treeData = normalized;
  selectedNodeId = treeData.id;
  if (normalized.canvasTheme && CANVAS_THEMES[normalized.canvasTheme]) {
    canvasTheme = normalized.canvasTheme;
  } else {
    canvasTheme = "soft";
  }
  if (normalized.customTheme?.base) {
    treeData.customTheme = normalized.customTheme;
  } else {
    delete treeData.customTheme;
  }
  treeData.canvasTheme = canvasTheme;
  rerenderMap({ preserveSelection: true });
}

async function resetMap() {
  const confirmed = await showConfirmModal({
    title: "Reset mind map?",
    message: "Xóa toàn bộ sơ đồ hiện tại và chỉ giữ lại 1 nút trung tâm?",
    confirmLabel: "Reset",
    cancelLabel: "Giữ lại",
    danger: true
  });
  if (!confirmed) return;
  localStorage.removeItem(STORAGE_KEY);
  treeData = baseRootNode();
  selectedNodeId = treeData.id;
  viewState.scale = 1;
  viewState.panX = 0;
  viewState.panY = 0;
  rerenderMap({ preserveSelection: true, skipSave: false });
  notifyUser("Đã reset mind map");
}

function reloadWithoutCache() {
  localStorage.removeItem(STORAGE_KEY);
  try {
    sessionStorage.setItem(SKIP_CACHE_SESSION_KEY, "1");
  } catch (err) {
    console.warn("Skip cache flag error:", err);
  }
  window.location.reload();
}

function findNodeById(id) {
  return findNode(treeData, id);
}

// Actions
const ACTIONS = {
  "add-child": addChildNode,
  "add-sibling": addSiblingNode,
  "edit-node": editNode,
  "delete-node": deleteNode,
  "zoom-in": () => zoom("in"),
  "zoom-out": () => zoom("out"),
  "center": () => centerView({ resetScale: true }),
  "reset-theme": () => {
    themeIndex = (themeIndex + 1) % themePalettes.length;
    rerenderMap({ skipSave: true });
    if (toolbar) {
      toolbar.textContent = "Đã đổi theme Mind Map";
    }
  },
  "export-json-file": exportJSONFile,
  "export-png": exportPNGFile,
  "import-json-file": triggerFileImport,
  "reset-map": resetMap,
  "reload-fresh": reloadWithoutCache,
  "open-ai-modal": () => openAIModal()
};

const CONTEXT_ACTIONS = {
  "add-child": (targetId) => addChildNode(targetId),
  "add-sibling": (targetId) => addSiblingNode(targetId),
  "edit-node": (targetId) => editNode(targetId),
  "delete-node": (targetId) => deleteNode(targetId),
  "shape-pill": (targetId) => changeNodeShape(targetId, "pill"),
  "shape-rect": (targetId) => changeNodeShape(targetId, "rect"),
  "shape-oval": (targetId) => changeNodeShape(targetId, "oval"),
  "shape-cloud": (targetId) => changeNodeShape(targetId, "cloud"),
  "color-purple": (targetId) => changeNodeColor(targetId, "purple"),
  "color-mint": (targetId) => changeNodeColor(targetId, "mint"),
  "color-peach": (targetId) => changeNodeColor(targetId, "peach"),
  "color-rose": (targetId) => changeNodeColor(targetId, "rose"),
  "color-yellow": (targetId) => changeNodeColor(targetId, "yellow"),
  "color-lilac": (targetId) => changeNodeColor(targetId, "lilac"),
  "link-arrow-none": (targetId) => changeLinkArrow(targetId, "none"),
  "link-arrow-end": (targetId) => changeLinkArrow(targetId, "end"),
  "link-arrow-start": (targetId) => changeLinkArrow(targetId, "start"),
  "link-arrow-both": (targetId) => changeLinkArrow(targetId, "both"),
  "link-width-thin": (targetId) => changeLinkThickness(targetId, "thin"),
  "link-width-medium": (targetId) => changeLinkThickness(targetId, "medium"),
  "link-width-thick": (targetId) => changeLinkThickness(targetId, "thick"),
  "link-opacity-soft": (targetId) => changeLinkOpacity(targetId, "soft"),
  "link-opacity-normal": (targetId) => changeLinkOpacity(targetId, "normal"),
  "link-opacity-bold": (targetId) => changeLinkOpacity(targetId, "bold"),
  "theme-soft": () => changeCanvasTheme("soft"),
  "theme-sunset": () => changeCanvasTheme("sunset"),
  "theme-ocean": () => changeCanvasTheme("ocean"),
  "theme-forest": () => changeCanvasTheme("forest"),
  "theme-night": () => changeCanvasTheme("night"),
  "theme-custom": () => applyCustomCanvasTheme(),
  "font-decrease": (targetId) => changeFontSize(targetId, "decrease"),
  "font-reset": (targetId) => changeFontSize(targetId, "reset"),
  "font-increase": (targetId) => changeFontSize(targetId, "increase")
};

function bindActionButtons() {
  buttons.forEach(btn => {
    const action = btn.dataset.action;
    if (!action || !ACTIONS[action]) return;
    btn.addEventListener("click", ACTIONS[action]);
  });

  if (contextMenu && contextMenuButtons.length) {
    contextMenuButtons.forEach(btn => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const action = btn.dataset.contextAction;
        const targetId = contextMenuTargetId;
        const stayOpen = btn.dataset.stayOpen === "true";
        if (!stayOpen) {
          closeContextMenu();
        }
        if (!action || !CONTEXT_ACTIONS[action]) return;
        CONTEXT_ACTIONS[action](targetId);
      });
    });
  }
}

if (fileInput) {
  fileInput.addEventListener("change", handleFileInputChange);
}

if (themeCustomColor) {
  themeCustomColor.addEventListener("input", () => {
    themeCustomColor.previousElementSibling?.style?.setProperty("--swatch-color", themeCustomColor.value);
  });
}

if (aiFileInput) {
  aiFileInput.addEventListener("change", handleAiFileChange);
}

if (aiPromptInput) {
  aiPromptInput.addEventListener("input", handleAiPromptInput);
}

if (aiModal) {
  aiModal.querySelectorAll('[data-ai-action="close"]').forEach(btn => {
    btn.addEventListener("click", closeAIModal);
  });
  if (aiGenerateBtn) {
    aiGenerateBtn.addEventListener("click", handleAiGenerate);
  }
  updateAiButtonsState();
}

if (aiClearFileBtn) {
  aiClearFileBtn.addEventListener("click", () => {
    clearAiFileSelection();
    setAiStatus("");
  });
}

if (modalConfirmBtn) {
  modalConfirmBtn.addEventListener("click", () => {
    if (modalState.mode === "input") {
      const value = modalInput.value.trim();
      if (!value) {
        modalInput.classList.add("has-error");
        modalInput.focus();
        return;
      }
      resolveModal(value);
      return;
    }
    if (modalState.mode === "textarea") {
      const raw = modalTextarea.value;
      if (!raw.trim()) {
        modalTextarea.classList.add("has-error");
        modalTextarea.focus();
        return;
      }
      resolveModal(raw);
      return;
    }
    resolveModal(true);
  });
}

if (modalCancelBtn) {
  modalCancelBtn.addEventListener("click", () => resolveModal(false));
}

if (modalBackdrop) {
  modalBackdrop.addEventListener("click", () => {
    if (aiModal && !aiModal.hidden) {
      closeAIModal();
      return;
    }
    resolveModal(false);
  });
}

modalCloseButtons.forEach(btn => {
  btn.addEventListener("click", () => resolveModal(false));
});

if (modalInput) {
  modalInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      modalConfirmBtn?.click();
    }
  });
  modalInput.addEventListener("input", () => modalInput.classList.remove("has-error"));
}

if (modalTextarea) {
modalTextarea.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    modalConfirmBtn?.click();
  }
});
modalTextarea.addEventListener("input", () => modalTextarea.classList.remove("has-error"));
}

function bootstrap() {
  if (!canvas || !toolbar) return;
  treeData = loadData();
  if (!treeData) {
    treeData = defaultData();
  }
  canvasTheme = treeData.canvasTheme || canvasTheme;
  treeData.canvasTheme = canvasTheme;
  selectedNodeId = treeData.id;
  ensureScene();
  renderMindmap();
  if (layoutDirty) {
    saveData();
  }
  bindCanvasInteractions();
  bindActionButtons();
  updateCacheStatus();
  if (toolbar) {
    const cacheHint = DISABLE_LOCAL_CACHE ? " • Cache đang TẮT cho lần tải này" : "";
    toolbar.textContent = "Click node để chọn • Kéo nền để di chuyển • Cuộn để zoom • Kéo node để đổi vị trí • Rê vào cạnh để chỉnh kích thước • Chuột phải để mở menu nhanh" + cacheHint;
  }
}

function updateCacheStatus() {
  if (!cacheStatus) return;
  if (DISABLE_LOCAL_CACHE) {
    cacheStatus.textContent = "Đang chạy chế độ không cache. Dữ liệu sẽ không lưu lại sau khi tải lại trang.";
    cacheStatus.classList.add("is-off");
  } else {
    cacheStatus.textContent = "Dữ liệu được tự động lưu vào trình duyệt của bạn (localStorage).";
    cacheStatus.classList.remove("is-off");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  bootstrap();
});

window.addEventListener("resize", () => {
  applyTransform();
  closeContextMenu();
  if (isModalOpen()) {
    resolveModal(false);
  }
});

document.addEventListener("click", (event) => {
  if (isModalOpen() && modalElement.contains(event.target)) {
    return;
  }
  if (!contextMenu || contextMenu.hidden) return;
  if (contextMenu.contains(event.target)) return;
  closeContextMenu();
});

document.addEventListener("keydown", (event) => {
  if (isModalOpen()) {
    if (event.key === "Escape") {
      event.preventDefault();
      resolveModal(false);
    }
    return;
  }
  if (event.key === "Escape") {
    closeContextMenu();
  }
});

window.addEventListener("scroll", () => {
  closeContextMenu();
  if (isModalOpen()) {
    resolveModal(false);
  }
}, true);
