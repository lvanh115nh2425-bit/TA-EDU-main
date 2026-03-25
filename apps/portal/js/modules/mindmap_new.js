const STORAGE_KEY = "taedu:mindmap:data";
const SKIP_CACHE_SESSION_KEY = "taedu:mindmap:skipCacheOnce";
const AI_ENDPOINT =
  (typeof window !== "undefined" && (window.TA_EDU_MINDMAP_AI_ENDPOINT || window.__TAEDU_MINDMAP_AI_ENDPOINT)) ||
  "/api/mindmap-ai";
const IS_LOCAL_MINDMAP =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

const MIN_SCALE = 0.45;
const MAX_SCALE = 2.4;
const SCALE_STEP = 0.14;
const SCENE_SIZE = 3600;
const HALF_SCENE = SCENE_SIZE / 2;
const MIN_NODE_WIDTH = 140;
const MIN_NODE_HEIGHT = 60;
const MAX_NODE_WIDTH = 520;
const MAX_NODE_HEIGHT = 240;
const DEFAULT_LINK_STYLE = { arrow: "end", strokeWidth: 4, strokeOpacity: 0.85, color: "#2f3c4d" };
const LINK_WIDTH_MAP = { thin: 2, medium: 4, thick: 6 };
const LINK_OPACITY_MAP = { soft: 0.35, normal: 0.85, bold: 1 };
const FONT_SCALE = { min: 0.85, max: 1.45, step: 0.08, base: 1 };
const SHAPES = ["pill", "rect", "oval", "cloud"];
const RESIZE_HANDLES = ["top-left", "top-right", "bottom-left", "bottom-right"];
const SVG_NS = "http://www.w3.org/2000/svg";

const CANVAS_THEMES = {
  soft: { id: "soft", canvas: "linear-gradient(180deg, rgba(255,246,239,0.98), rgba(255,255,255,0.95))", bodyTop: "#f8eee5" },
  sunset: { id: "sunset", canvas: "linear-gradient(180deg, rgba(255,224,206,0.98), rgba(255,246,234,0.96))", bodyTop: "#f9e5d6" },
  ocean: { id: "ocean", canvas: "linear-gradient(180deg, rgba(223,243,255,0.98), rgba(246,253,255,0.96))", bodyTop: "#e3f3fb" },
  forest: { id: "forest", canvas: "linear-gradient(180deg, rgba(229,247,235,0.98), rgba(248,255,250,0.96))", bodyTop: "#e7f5ea" },
  night: { id: "night", canvas: "linear-gradient(180deg, rgba(236,228,255,0.98), rgba(250,247,255,0.96))", bodyTop: "#ece5fb" },
  custom: { id: "custom", canvas: "linear-gradient(180deg, rgba(255,247,241,0.98), rgba(255,255,255,0.96))", bodyTop: "#fff7f1" }
};

const NODE_COLOR_PRESETS = {
  purple: { id: "purple", fill: "#d8c8ff", border: "#8b5cf6", text: "#312142", linkColor: "#6d28d9" },
  mint: { id: "mint", fill: "#bdf3d7", border: "#22c55e", text: "#123826", linkColor: "#15803d" },
  peach: { id: "peach", fill: "#ffd9b8", border: "#f97316", text: "#5a2d08", linkColor: "#c2410c" },
  rose: { id: "rose", fill: "#ffc0ca", border: "#f43f5e", text: "#5e1d2f", linkColor: "#e11d48" },
  yellow: { id: "yellow", fill: "#ffe89b", border: "#eab308", text: "#614b06", linkColor: "#ca8a04" },
  lilac: { id: "lilac", fill: "#cdd6ff", border: "#6366f1", text: "#232562", linkColor: "#4f46e5" }
};

const COLOR_SEQUENCE = ["purple", "peach", "mint", "rose", "yellow", "lilac"];

const dom = {
  toolbar: document.getElementById("mindmapToolbar"),
  selectionMeta: document.getElementById("mindmapSelectionMeta"),
  zoomMeta: document.getElementById("mindmapZoomMeta"),
  canvas: document.getElementById("mindmapCanvas"),
  cacheStatus: document.getElementById("mindmapCacheStatus"),
  fileInput: document.getElementById("mindmapFileInput"),
  contextMenu: document.getElementById("mindmapContextMenu"),
  contextButtons: document.querySelectorAll("[data-context-action]"),
  modalBackdrop: document.getElementById("mindmapModalBackdrop"),
  modal: document.getElementById("mindmapModal"),
  modalTitle: document.getElementById("mindmapModalTitle"),
  modalMessage: document.getElementById("mindmapModalMessage"),
  modalInputWrap: document.getElementById("mindmapModalInputWrap"),
  modalInput: document.getElementById("mindmapModalInput"),
  modalTextareaWrap: document.getElementById("mindmapModalTextareaWrap"),
  modalTextarea: document.getElementById("mindmapModalTextarea"),
  modalConfirm: document.getElementById("mindmapModalConfirm"),
  modalCancel: document.getElementById("mindmapModalCancel"),
  modalCloseButtons: document.querySelectorAll("[data-modal-action='close']"),
  aiModal: document.getElementById("aiModal"),
  aiPrompt: document.getElementById("aiPromptInput"),
  aiFileInput: document.getElementById("aiFileInput"),
  aiFileName: document.getElementById("aiFileName"),
  aiGenerate: document.querySelector("[data-ai-action='generate']"),
  aiClearFile: document.querySelector("[data-ai-action='clear-file']"),
  aiCloseButtons: document.querySelectorAll("[data-ai-action='close']"),
  aiStatus: document.querySelector("[data-ai-status]"),
  themeCustomColor: document.getElementById("themeCustomColor"),
  contextFontValue: document.getElementById("contextFontValue"),
  actionButtons: document.querySelectorAll("[data-action]")
};

const state = {
  tree: null,
  selectedNodeId: null,
  canvasTheme: "soft",
  customTheme: null,
  nodeMap: new Map(),
  parentMap: new Map(),
  depthMap: new Map(),
  scene: null,
  content: null,
  connectorLayer: null,
  connectorDefs: null,
  nodeLayer: null,
  markers: new Map(),
  view: { scale: 1, panX: 0, panY: 0 },
  pointerPan: { active: false, pointerId: null, startX: 0, startY: 0, panX: 0, panY: 0 },
  dragNode: { active: false, pointerId: null, nodeId: null, startX: 0, startY: 0, nodeX: 0, nodeY: 0 },
  resizeNode: { active: false, pointerId: null, nodeId: null, handle: null, startX: 0, startY: 0, width: 0, height: 0, posX: 0, posY: 0 },
  contextMenu: { open: false, targetId: null, targetType: "node" },
  modal: { resolver: null, mode: "notice" },
  ai: { generating: false, fileText: "", reading: false },
  skipCache: false
};

function generateNodeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `node-${crypto.randomUUID()}`;
  }
  return `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneJson(data) {
  return JSON.parse(JSON.stringify(data));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function trySetPointerCapture(element, pointerId) {
  if (!element || typeof element.setPointerCapture !== "function") return false;
  try {
    element.setPointerCapture(pointerId);
    return true;
  } catch (error) {
    return false;
  }
}

function parseColorString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function styleFromPreset(presetName) {
  const preset = NODE_COLOR_PRESETS[presetName] || NODE_COLOR_PRESETS.purple;
  return {
    preset: preset.id,
    fill: preset.fill,
    border: preset.border,
    text: preset.text,
    linkColor: preset.linkColor,
    fontSize: FONT_SCALE.base,
    link: { ...DEFAULT_LINK_STYLE, color: preset.linkColor }
  };
}

function defaultSizeForDepth(depth) {
  if (depth === 0) return { width: 166, height: 60 };
  if (depth === 1) return { width: 138, height: 54 };
  return { width: 124, height: 48 };
}

function getDefaultShape(depth) {
  if (depth === 0) return "pill";
  if (depth === 1) return "rect";
  if (depth === 2) return "oval";
  return "cloud";
}

function baseRootNode() {
  return {
    id: "root",
    content: "Ý tưởng chính",
    shape: "pill",
    position: { x: 0, y: 0 },
    size: { width: 166, height: 60 },
    style: styleFromPreset("purple"),
    children: []
  };
}

function defaultTree() {
  const root = baseRootNode();
  root.children = [
    {
      id: "branch-1",
      content: "Mục tiêu",
      shape: "rect",
      position: { x: 280, y: -180 },
      size: { width: 138, height: 54 },
      style: styleFromPreset("peach"),
      children: [
        { id: "branch-1-1", content: "Ngắn hạn", shape: "pill", position: { x: 530, y: -250 }, size: defaultSizeForDepth(2), style: styleFromPreset("yellow"), children: [] },
        { id: "branch-1-2", content: "Dài hạn", shape: "pill", position: { x: 530, y: -110 }, size: defaultSizeForDepth(2), style: styleFromPreset("lilac"), children: [] }
      ]
    },
    {
      id: "branch-2",
      content: "Kiến thức",
      shape: "rect",
      position: { x: 280, y: 0 },
      size: { width: 146, height: 54 },
      style: styleFromPreset("mint"),
      children: [
        { id: "branch-2-1", content: "Lý thuyết", shape: "oval", position: { x: 540, y: -60 }, size: defaultSizeForDepth(2), style: styleFromPreset("yellow"), children: [] },
        { id: "branch-2-2", content: "Thực hành", shape: "oval", position: { x: 540, y: 90 }, size: defaultSizeForDepth(2), style: styleFromPreset("lilac"), children: [] }
      ]
    },
    {
      id: "branch-3",
      content: "Kỹ năng",
      shape: "cloud",
      position: { x: 280, y: 190 },
      size: { width: 138, height: 54 },
      style: styleFromPreset("rose"),
      children: []
    }
  ];
  return root;
}

function normalizeSize(raw) {
  if (!raw || typeof raw !== "object") return null;
  const width = Number(raw.width);
  const height = Number(raw.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return {
    width: clamp(width, MIN_NODE_WIDTH, MAX_NODE_WIDTH),
    height: clamp(height, MIN_NODE_HEIGHT, MAX_NODE_HEIGHT)
  };
}

function normalizePosition(raw) {
  if (!raw || typeof raw !== "object") return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function normalizeLinkStyle(rawLink) {
  if (!rawLink || typeof rawLink !== "object") return null;
  const style = {};
  if (["none", "start", "end", "both"].includes(rawLink.arrow)) style.arrow = rawLink.arrow;
  if (Number.isFinite(rawLink.strokeWidth)) style.strokeWidth = clamp(rawLink.strokeWidth, LINK_WIDTH_MAP.thin, LINK_WIDTH_MAP.thick * 1.5);
  if (Number.isFinite(rawLink.strokeOpacity)) style.strokeOpacity = clamp(rawLink.strokeOpacity, 0.2, 1);
  if (parseColorString(rawLink.color)) style.color = rawLink.color.trim();
  return Object.keys(style).length ? style : null;
}

function normalizeStyle(rawStyle) {
  if (!rawStyle || typeof rawStyle !== "object") return null;
  const presetId = typeof rawStyle.preset === "string" ? rawStyle.preset : null;
  const base = presetId && NODE_COLOR_PRESETS[presetId] ? styleFromPreset(presetId) : {};
  const style = {
    ...base,
    fill: parseColorString(rawStyle.fill) || base.fill,
    border: parseColorString(rawStyle.border) || base.border,
    text: parseColorString(rawStyle.text) || base.text,
    linkColor: parseColorString(rawStyle.linkColor) || base.linkColor,
    preset: presetId || base.preset,
    fontSize: Number.isFinite(rawStyle.fontSize) ? clamp(rawStyle.fontSize, FONT_SCALE.min, FONT_SCALE.max) : (base.fontSize || FONT_SCALE.base)
  };
  const link = normalizeLinkStyle(rawStyle.link) || base.link || DEFAULT_LINK_STYLE;
  style.link = {
    arrow: link.arrow || DEFAULT_LINK_STYLE.arrow,
    strokeWidth: link.strokeWidth || DEFAULT_LINK_STYLE.strokeWidth,
    strokeOpacity: link.strokeOpacity || DEFAULT_LINK_STYLE.strokeOpacity,
    color: parseColorString(link.color) || style.linkColor || base.linkColor || DEFAULT_LINK_STYLE.color
  };
  return style;
}

function suggestPosition(parent, index, total, depth) {
  if (!parent || !parent.position) return { x: 0, y: 0 };
  const horizontal = depth === 1 ? 280 : 240;
  const vertical = depth === 1 ? 180 : 130;
  const offsetY = total > 1 ? (index - (total - 1) / 2) * vertical : 0;
  return {
    x: (Number.isFinite(parent.position.x) ? parent.position.x : 0) + horizontal,
    y: (Number.isFinite(parent.position.y) ? parent.position.y : 0) + offsetY
  };
}

function unwrapLegacyTree(raw) {
  if (!raw || typeof raw !== "object") return { tree: null, migrated: false };
  if (raw.format === "node_tree" && raw.data) return { tree: raw.data, migrated: true };
  if (raw.data && raw.meta && raw.data.id) return { tree: raw.data, migrated: true };
  return { tree: raw, migrated: false };
}

function normalizeNode(rawNode, depth = 0, index = 0, parent = null, siblingCount = 1) {
  if (!rawNode || typeof rawNode !== "object") return null;
  const content = typeof rawNode.content === "string" && rawNode.content.trim()
    ? rawNode.content.trim()
    : typeof rawNode.topic === "string" && rawNode.topic.trim()
      ? rawNode.topic.trim()
      : "Ý tưởng";
  const normalized = {
    id: typeof rawNode.id === "string" && rawNode.id.trim() ? rawNode.id.trim() : generateNodeId(),
    content,
    shape: SHAPES.includes(rawNode.shape) ? rawNode.shape : getDefaultShape(depth),
    position: normalizePosition(rawNode.position),
    size: normalizeSize(rawNode.size),
    style: normalizeStyle(rawNode.style),
    children: []
  };
  const rawChildren = Array.isArray(rawNode.children) ? rawNode.children : [];
  normalized.children = rawChildren
    .map((child, childIndex) => normalizeNode(child, depth + 1, childIndex, normalized, rawChildren.length || 1))
    .filter(Boolean);
  if (!normalized.position) normalized.position = suggestPosition(parent, index, siblingCount, depth);
  if (!normalized.size) normalized.size = defaultSizeForDepth(depth);
  if (!normalized.style) normalized.style = styleFromPreset(COLOR_SEQUENCE[depth % COLOR_SEQUENCE.length]);
  if (!normalized.style.link) normalized.style.link = { ...DEFAULT_LINK_STYLE, color: normalized.style.linkColor || DEFAULT_LINK_STYLE.color };
  return normalized;
}

function ensureRenderableGeometry(node, parent = null, depth = 0) {
  if (!node) return;
  if (!node.position) node.position = suggestPosition(parent, 0, 1, depth);
  if (!node.size) node.size = defaultSizeForDepth(depth);
  if (!node.style) node.style = styleFromPreset(COLOR_SEQUENCE[depth % COLOR_SEQUENCE.length]);
  if (!node.style.link) node.style.link = { ...DEFAULT_LINK_STYLE, color: node.style.linkColor || DEFAULT_LINK_STYLE.color };
  if (!Array.isArray(node.children)) node.children = [];
  const total = node.children.length || 1;
  node.children.forEach((child, index) => {
    if (!child.position) child.position = suggestPosition(node, index, total, depth + 1);
    if (!child.size) child.size = defaultSizeForDepth(depth + 1);
    ensureRenderableGeometry(child, node, depth + 1);
  });
}

function ensureNodeGeometry(node, parent = null, depth = 0) {
  if (!node) return null;
  if (!node.position) node.position = suggestPosition(parent, 0, 1, depth);
  if (!node.size) node.size = defaultSizeForDepth(depth);
  return node;
}

function readUrlSkipCache() {
  const params = new URLSearchParams(window.location.search);
  const queryDisabled = params.has("nocache") || params.has("fresh") || params.get("cache") === "off";
  let sessionDisabled = false;
  try {
    sessionDisabled = sessionStorage.getItem(SKIP_CACHE_SESSION_KEY) === "1";
    if (sessionDisabled) sessionStorage.removeItem(SKIP_CACHE_SESSION_KEY);
  } catch (error) {
    sessionDisabled = false;
  }
  return queryDisabled || sessionDisabled;
}

function loadTree() {
  state.skipCache = readUrlSkipCache();
  if (state.skipCache) {
    state.canvasTheme = "soft";
    state.customTheme = null;
    return defaultTree();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      state.canvasTheme = "soft";
      state.customTheme = null;
      return defaultTree();
    }
    const parsed = JSON.parse(raw);
    const { tree, migrated } = unwrapLegacyTree(parsed);
    const normalized = normalizeNode(tree);
    state.canvasTheme = parsed.canvasTheme && CANVAS_THEMES[parsed.canvasTheme] ? parsed.canvasTheme : "soft";
    state.customTheme = parsed.customTheme && parseColorString(parsed.customTheme.base) ? { base: parsed.customTheme.base } : null;
    if (migrated && normalized) saveTree(normalized);
    return normalized || defaultTree();
  } catch (error) {
    console.warn("Mindmap load error:", error);
    state.canvasTheme = "soft";
    state.customTheme = null;
    return defaultTree();
  }
}

function saveTree(treeOverride = state.tree) {
  if (state.skipCache) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...cloneJson(treeOverride),
      canvasTheme: state.canvasTheme,
      customTheme: state.customTheme
    }));
  } catch (error) {
    console.warn("Mindmap save error:", error);
  }
}

function ensureScene() {
  if (state.scene) return;
  const scene = document.createElement("div");
  scene.className = "mindmap-scene";
  scene.style.setProperty("--scene-size", `${SCENE_SIZE}px`);
  const content = document.createElement("div");
  content.className = "mindmap-content";
  const connectorLayer = document.createElementNS(SVG_NS, "svg");
  connectorLayer.classList.add("mindmap-connector-layer");
  connectorLayer.setAttribute("width", String(SCENE_SIZE));
  connectorLayer.setAttribute("height", String(SCENE_SIZE));
  connectorLayer.setAttribute("viewBox", `0 0 ${SCENE_SIZE} ${SCENE_SIZE}`);
  const defs = document.createElementNS(SVG_NS, "defs");
  connectorLayer.appendChild(defs);
  const nodeLayer = document.createElement("div");
  nodeLayer.className = "mindmap-node-layer";
  content.appendChild(connectorLayer);
  content.appendChild(nodeLayer);
  scene.appendChild(content);
  dom.canvas.appendChild(scene);
  state.scene = scene;
  state.content = content;
  state.connectorLayer = connectorLayer;
  state.connectorDefs = defs;
  state.nodeLayer = nodeLayer;
}

function rebuildIndexes() {
  state.nodeMap = new Map();
  state.parentMap = new Map();
  state.depthMap = new Map();
  traverseTree(state.tree, null, 0);
}

function traverseTree(node, parent, depth) {
  state.nodeMap.set(node.id, node);
  state.depthMap.set(node.id, depth);
  if (parent) state.parentMap.set(node.id, parent.id);
  node.children.forEach((child) => traverseTree(child, node, depth + 1));
}

function getNode(nodeId) {
  return state.nodeMap.get(nodeId) || null;
}

function getParent(nodeId) {
  const parentId = state.parentMap.get(nodeId);
  return parentId ? getNode(parentId) : null;
}

function getDepth(nodeId) {
  return state.depthMap.get(nodeId) || 0;
}

function flattenNodes() {
  return Array.from(state.nodeMap.values());
}

function getIncomingLinkStyle(node) {
  const link = node?.style?.link || DEFAULT_LINK_STYLE;
  return {
    arrow: link.arrow || DEFAULT_LINK_STYLE.arrow,
    strokeWidth: Number.isFinite(link.strokeWidth) ? link.strokeWidth : DEFAULT_LINK_STYLE.strokeWidth,
    strokeOpacity: Number.isFinite(link.strokeOpacity) ? link.strokeOpacity : DEFAULT_LINK_STYLE.strokeOpacity,
    color: parseColorString(link.color) || node?.style?.linkColor || DEFAULT_LINK_STYLE.color
  };
}

function getNodeVisualStyle(node) {
  const depth = getDepth(node.id);
  const preset = node.style?.preset && NODE_COLOR_PRESETS[node.style.preset]
    ? NODE_COLOR_PRESETS[node.style.preset]
    : NODE_COLOR_PRESETS[COLOR_SEQUENCE[depth % COLOR_SEQUENCE.length]];
  return {
    fill: node.style?.fill || preset.fill,
    border: node.style?.border || preset.border,
    text: node.style?.text || preset.text,
    fontSize: Number.isFinite(node.style?.fontSize) ? node.style.fontSize : FONT_SCALE.base
  };
}

function updateCanvasTheme() {
  const theme = state.canvasTheme === "custom" && state.customTheme?.base
    ? {
        bodyTop: state.customTheme.base,
        canvas: `linear-gradient(180deg, ${state.customTheme.base}, rgba(255,255,255,0.96))`
      }
    : CANVAS_THEMES[state.canvasTheme] || CANVAS_THEMES.soft;
  document.documentElement.style.setProperty("--mm-bg-top", theme.bodyTop);
  document.documentElement.style.setProperty("--mm-canvas", theme.canvas);
}

function applySceneTransform() {
  if (!state.scene) return;
  state.scene.style.transform = `translate(calc(-50% + ${state.view.panX}px), calc(-50% + ${state.view.panY}px)) scale(${state.view.scale})`;
  if (dom.zoomMeta) {
    dom.zoomMeta.textContent = `${Math.round(state.view.scale * 100)}%`;
  }
}

function centerView(resetScale = false) {
  state.view.panX = 0;
  state.view.panY = 0;
  if (resetScale) state.view.scale = 1;
  applySceneTransform();
}

function connectorPath(parent, child) {
  const startX = HALF_SCENE + parent.position.x + parent.size.width / 2;
  const startY = HALF_SCENE + parent.position.y;
  const endX = HALF_SCENE + child.position.x - child.size.width / 2;
  const endY = HALF_SCENE + child.position.y;
  const delta = Math.max(80, Math.abs(endX - startX) * 0.45);
  return `M ${startX} ${startY} C ${startX + delta} ${startY}, ${endX - delta} ${endY}, ${endX} ${endY}`;
}

function markerId(style, direction) {
  const key = `${direction}-${style.color}-${style.strokeWidth}`;
  if (state.markers.has(key)) return state.markers.get(key);
  const id = `marker-${state.markers.size + 1}`;
  const marker = document.createElementNS(SVG_NS, "marker");
  marker.setAttribute("id", id);
  marker.setAttribute("markerWidth", "10");
  marker.setAttribute("markerHeight", "10");
  marker.setAttribute("refX", direction === "start" ? "2" : "8");
  marker.setAttribute("refY", "5");
  marker.setAttribute("orient", "auto");
  marker.setAttribute("markerUnits", "strokeWidth");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", direction === "start" ? "M 10 0 L 0 5 L 10 10 z" : "M 0 0 L 10 5 L 0 10 z");
  path.setAttribute("fill", style.color);
  marker.appendChild(path);
  state.connectorDefs.appendChild(marker);
  state.markers.set(key, id);
  return id;
}

function renderConnectors() {
  state.markers = new Map();
  state.connectorLayer.innerHTML = "";
  state.connectorDefs = document.createElementNS(SVG_NS, "defs");
  state.connectorLayer.appendChild(state.connectorDefs);
  flattenNodes().forEach((node) => {
    const parent = getParent(node.id);
    if (!parent) return;
    if (!parent.position || !parent.size || !node.position || !node.size) return;
    const style = getIncomingLinkStyle(node);
    const path = document.createElementNS(SVG_NS, "path");
    path.classList.add("mindmap-connector");
    path.setAttribute("d", connectorPath(parent, node));
    path.setAttribute("stroke", style.color);
    path.setAttribute("stroke-width", String(style.strokeWidth));
    path.setAttribute("stroke-opacity", String(style.strokeOpacity));
    path.dataset.childId = node.id;
    if (style.arrow === "start" || style.arrow === "both") {
      path.setAttribute("marker-start", `url(#${markerId(style, "start")})`);
    }
    if (style.arrow === "end" || style.arrow === "both") {
      path.setAttribute("marker-end", `url(#${markerId(style, "end")})`);
    }
    path.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      selectNode(node.id);
      openContextMenu("link", node.id, event.clientX, event.clientY);
    });
    state.connectorLayer.appendChild(path);
  });
}

function createResizeHandle(handleName) {
  const handle = document.createElement("span");
  handle.className = "resize-handle";
  handle.dataset.handle = handleName;
  return handle;
}

function renderNodes() {
  state.nodeLayer.innerHTML = "";
  flattenNodes().forEach((node) => {
    if (!node.position || !node.size) return;
    const depth = getDepth(node.id);
    const visual = getNodeVisualStyle(node);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mindmap-node";
    if (depth === 0) button.classList.add("mindmap-node-root");
    if (node.id === state.selectedNodeId) button.classList.add("is-selected");
    button.dataset.nodeId = node.id;
    button.dataset.shape = node.shape;
    button.style.left = `${HALF_SCENE + node.position.x}px`;
    button.style.top = `${HALF_SCENE + node.position.y}px`;
    button.style.width = `${node.size.width}px`;
    button.style.height = `${node.size.height}px`;
    button.style.setProperty("--node-fill", visual.fill);
    button.style.setProperty("--node-border", visual.border);
    button.style.setProperty("--node-text", visual.text);
    button.style.setProperty("--node-font-scale", visual.fontSize);
    button.textContent = node.content;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      selectNode(node.id);
    });
    button.addEventListener("dblclick", async (event) => {
      event.stopPropagation();
      selectNode(node.id);
      await editNode(node.id);
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      selectNode(node.id);
      openContextMenu("node", node.id, event.clientX, event.clientY);
    });
    button.addEventListener("pointerdown", (event) => startNodeDrag(event, node.id));
    const handles = document.createElement("div");
    handles.className = "resize-handles";
    RESIZE_HANDLES.forEach((handleName) => {
      const handle = createResizeHandle(handleName);
      handle.addEventListener("pointerdown", (event) => startResize(event, node.id, handleName));
      handles.appendChild(handle);
    });
    button.appendChild(handles);
    state.nodeLayer.appendChild(button);
  });
}

function refreshMeta() {
  if (!dom.selectionMeta) return;
  const node = getNode(state.selectedNodeId);
  dom.selectionMeta.textContent = node
    ? `${node.content} • depth ${getDepth(node.id)}`
    : "Chua chon node";
}

function updateContextMenuState() {
  if (!dom.contextMenu) return;
  const targetId = state.contextMenu.targetId;
  const targetType = state.contextMenu.targetType;
  const node = targetId ? getNode(targetId) : null;
  const incomingLink = node ? getIncomingLinkStyle(node) : null;
  const fontValue = node ? Math.round((node.style?.fontSize || FONT_SCALE.base) * 100) : 100;
  if (dom.contextFontValue) dom.contextFontValue.textContent = `${fontValue}%`;

  dom.contextMenu.querySelectorAll("[data-context-for]").forEach((section) => {
    const sectionFor = section.getAttribute("data-context-for");
    let visible = false;
    if (sectionFor === "canvas") visible = targetType === "canvas";
    if (sectionFor === "node") visible = targetType === "node";
    if (sectionFor === "link") visible = (targetType === "link") || (targetType === "node" && node && node.id !== "root");
    section.hidden = !visible;
  });

  dom.contextMenu.querySelectorAll("[data-theme]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.theme === state.canvasTheme);
  });
  dom.contextMenu.querySelectorAll("[data-shape]").forEach((button) => {
    button.classList.toggle("is-active", node?.shape === button.dataset.shape);
  });
  dom.contextMenu.querySelectorAll("[data-color-preset]").forEach((button) => {
    button.classList.toggle("is-active", node?.style?.preset === button.dataset.colorPreset);
  });
  dom.contextMenu.querySelectorAll("[data-link-arrow]").forEach((button) => {
    button.classList.toggle("is-active", incomingLink?.arrow === button.dataset.linkArrow);
  });
  dom.contextMenu.querySelectorAll("[data-link-width]").forEach((button) => {
    button.classList.toggle("is-active", incomingLink?.strokeWidth === LINK_WIDTH_MAP[button.dataset.linkWidth]);
  });
  dom.contextMenu.querySelectorAll("[data-link-opacity]").forEach((button) => {
    button.classList.toggle("is-active", incomingLink?.strokeOpacity === LINK_OPACITY_MAP[button.dataset.linkOpacity]);
  });
}

function updateCacheStatus() {
  if (!dom.cacheStatus) return;
  if (state.skipCache) {
    dom.cacheStatus.classList.add("is-off");
    dom.cacheStatus.textContent = "Cache đang tắt cho lần tải này. Lần tải tiếp theo sẽ không giữ dữ liệu nếu bạn chọn 'Tải mới'.";
    return;
  }
  dom.cacheStatus.classList.remove("is-off");
  dom.cacheStatus.textContent = "Dữ liệu được lưu tự động vào localStorage của trình duyệt. Bạn có thể xuất JSON để sao lưu.";
}

function render() {
  if (!dom.canvas) return;
  ensureScene();
  rebuildIndexes();
  updateCanvasTheme();
  renderConnectors();
  renderNodes();
  applySceneTransform();
  refreshMeta();
  updateContextMenuState();
  updateCacheStatus();
}

function updateToolbar(message) {
  if (dom.toolbar) dom.toolbar.textContent = message;
}

function selectNode(nodeId) {
  state.selectedNodeId = nodeId;
  render();
}

function duplicateStyle(style) {
  return JSON.parse(JSON.stringify(style || styleFromPreset("purple")));
}

function rebalanceChildren(parent, depth) {
  const total = parent.children.length;
  parent.children.forEach((child, index) => {
    const target = suggestPosition(parent, index, total, depth);
    if (!child.position) child.position = { x: target.x, y: target.y };
    child.position.y = target.y;
  });
}

function persistAndRender(message) {
  saveTree();
  render();
  updateToolbar(message);
}

async function addChildNode(nodeId = state.selectedNodeId) {
  const parent = getNode(nodeId);
  if (!parent) return;
  const value = await showInputModal({
    title: "Thêm nhánh con",
    message: "Nhập tên nhánh mới.",
    initialValue: "Nhánh mới",
    confirmLabel: "Thêm"
  });
  if (!value) return;
  const index = parent.children.length;
  const node = {
    id: generateNodeId(),
    content: value,
    shape: getDefaultShape(getDepth(parent.id) + 1),
    position: suggestPosition(parent, index, index + 1, getDepth(parent.id) + 1),
    size: defaultSizeForDepth(getDepth(parent.id) + 1),
    style: duplicateStyle(styleFromPreset(COLOR_SEQUENCE[(getDepth(parent.id) + 1) % COLOR_SEQUENCE.length])),
    children: []
  };
  parent.children.push(node);
  state.selectedNodeId = node.id;
  persistAndRender(`Đã thêm nhánh con cho "${parent.content}"`);
}

async function addSiblingNode(nodeId = state.selectedNodeId) {
  const node = getNode(nodeId);
  const parent = getParent(nodeId);
  if (!node || !parent) {
    await showNoticeModal({ title: "Không thể thêm", message: "Node gốc không có nhánh cùng cấp. Hãy thêm nhánh con." });
    return;
  }
  const depth = getDepth(node.id);
  ensureNodeGeometry(parent, getParent(parent.id), Math.max(getDepth(parent.id), 0));
  ensureNodeGeometry(node, parent, Math.max(depth, 0));
  const value = await showInputModal({
    title: "Thêm nhánh cùng cấp",
    message: `Nhập tên nhánh cùng cấp với "${node.content}".`,
    initialValue: "Nhánh mới",
    confirmLabel: "Thêm"
  });
  if (!value) return;
  const nodeIndex = parent.children.findIndex((child) => child.id === node.id);
  const sibling = {
    id: generateNodeId(),
    content: value,
    shape: node.shape,
    position: { x: node.position?.x ?? 0, y: (node.position?.y ?? 0) + 120 },
    size: { ...node.size },
    style: duplicateStyle(node.style),
    children: []
  };
  parent.children.splice(nodeIndex + 1, 0, sibling);
  state.selectedNodeId = sibling.id;
  rebalanceChildren(parent, depth);
  persistAndRender(`Đã thêm nhánh cùng cấp cho "${node.content}"`);
}

async function editNode(nodeId = state.selectedNodeId) {
  const node = getNode(nodeId);
  if (!node) return;
  const value = await showInputModal({
    title: "Đổi tiêu đề node",
    message: "Cập nhật nội dung cho node đang chọn.",
    initialValue: node.content,
    confirmLabel: "Lưu"
  });
  if (!value) return;
  node.content = value;
  persistAndRender(`Đã cập nhật node "${value}"`);
}

function removeNodeById(targetId, node = state.tree) {
  if (!node?.children?.length) return false;
  const index = node.children.findIndex((child) => child.id === targetId);
  if (index >= 0) {
    node.children.splice(index, 1);
    return true;
  }
  return node.children.some((child) => removeNodeById(targetId, child));
}

async function deleteNode(nodeId = state.selectedNodeId) {
  const node = getNode(nodeId);
  const parent = getParent(nodeId);
  if (!node || !parent) {
    await showNoticeModal({ title: "Không thể xóa", message: "Node trung tâm không thể bị xóa." });
    return;
  }
  const confirmed = await showConfirmModal({
    title: "Xóa nhanh?",
    message: `Node "${node.content}" và tất cả nhánh con sẽ bị xóa.`,
    confirmLabel: "Xóa",
    cancelLabel: "Hủy",
    danger: true
  });
  if (!confirmed) return;
  removeNodeById(nodeId);
  state.selectedNodeId = parent.id;
  persistAndRender(`Đã xóa "${node.content}"`);
}

function changeNodeShape(nodeId, shape) {
  const node = getNode(nodeId);
  if (!node || !SHAPES.includes(shape)) return;
  node.shape = shape;
  persistAndRender("Đã đổi hình dạng node");
}

function changeNodeColor(nodeId, presetName) {
  const node = getNode(nodeId);
  const preset = NODE_COLOR_PRESETS[presetName];
  if (!node || !preset) return;
  node.style = {
    ...node.style,
    preset: preset.id,
    fill: preset.fill,
    border: preset.border,
    text: preset.text,
    linkColor: preset.linkColor,
    link: {
      ...(node.style?.link || DEFAULT_LINK_STYLE),
      color: preset.linkColor
    }
  };
  persistAndRender("Đã đổi màu node");
}

function changeFontSize(nodeId, mode) {
  const node = getNode(nodeId);
  if (!node) return;
  const current = Number.isFinite(node.style?.fontSize) ? node.style.fontSize : FONT_SCALE.base;
  if (mode === "reset") {
    node.style.fontSize = FONT_SCALE.base;
  } else if (mode === "increase") {
    node.style.fontSize = clamp(current + FONT_SCALE.step, FONT_SCALE.min, FONT_SCALE.max);
  } else if (mode === "decrease") {
    node.style.fontSize = clamp(current - FONT_SCALE.step, FONT_SCALE.min, FONT_SCALE.max);
  }
  persistAndRender("Đã cập nhật cỡ chữ");
}

function changeLinkArrow(nodeId, arrow) {
  const node = getNode(nodeId);
  if (!node) return;
  node.style.link = {
    ...getIncomingLinkStyle(node),
    arrow
  };
  persistAndRender("Đã cập nhật mũi tên");
}

function changeLinkThickness(nodeId, widthKey) {
  const node = getNode(nodeId);
  if (!node || !LINK_WIDTH_MAP[widthKey]) return;
  node.style.link = {
    ...getIncomingLinkStyle(node),
    strokeWidth: LINK_WIDTH_MAP[widthKey]
  };
  persistAndRender("Đã cập nhật độ dày đường nối");
}

function changeLinkOpacity(nodeId, opacityKey) {
  const node = getNode(nodeId);
  if (!node || !LINK_OPACITY_MAP[opacityKey]) return;
  node.style.link = {
    ...getIncomingLinkStyle(node),
    strokeOpacity: LINK_OPACITY_MAP[opacityKey]
  };
  persistAndRender("Đã cập nhật độ đậm đường nối");
}

function changeCanvasTheme(themeId) {
  if (!CANVAS_THEMES[themeId]) return;
  state.canvasTheme = themeId;
  if (themeId !== "custom") state.customTheme = null;
  persistAndRender("Đã đổi theme canvas");
}

function applyCustomCanvasTheme() {
  const color = dom.themeCustomColor?.value;
  if (!color) return;
  state.canvasTheme = "custom";
  state.customTheme = { base: color };
  persistAndRender("Đã áp dụng màu nền tùy chỉnh");
}

function openContextMenu(type, nodeId, clientX, clientY) {
  state.contextMenu = { open: true, targetId: nodeId, targetType: type };
  updateContextMenuState();
  dom.contextMenu.hidden = false;
  const rect = dom.canvas.getBoundingClientRect();
  const menuWidth = 280;
  const left = clamp(clientX - rect.left, 12, rect.width - menuWidth - 12);
  const top = clamp(clientY - rect.top, 12, rect.height - 260);
  dom.contextMenu.style.left = `${left}px`;
  dom.contextMenu.style.top = `${top}px`;
}

function closeContextMenu() {
  state.contextMenu.open = false;
  state.contextMenu.targetId = null;
  state.contextMenu.targetType = "node";
  dom.contextMenu.hidden = true;
}

function openNoticeBackdrop() {
  dom.modalBackdrop.hidden = false;
}

function closeModals() {
  dom.modal.hidden = true;
  dom.aiModal.hidden = true;
  dom.modalBackdrop.hidden = true;
  state.modal.resolver = null;
}

function resolveModal(value) {
  const resolver = state.modal.resolver;
  closeModals();
  if (resolver) resolver(value);
}

function showModalBase({ title, message, mode = "notice", inputValue = "", confirmLabel = "Xong", cancelLabel = "Hủy" }) {
  openNoticeBackdrop();
  dom.modal.hidden = false;
  dom.modalTitle.textContent = title;
  dom.modalMessage.textContent = message;
  dom.modalInputWrap.hidden = mode !== "input";
  dom.modalTextareaWrap.hidden = mode !== "textarea";
  dom.modalInput.classList.remove("has-error");
  dom.modalTextarea.classList.remove("has-error");
  dom.modalInput.value = inputValue;
  dom.modalTextarea.value = inputValue;
  dom.modalConfirm.textContent = confirmLabel;
  dom.modalCancel.textContent = cancelLabel;
  state.modal.mode = mode;
  return new Promise((resolve) => {
    state.modal.resolver = resolve;
    requestAnimationFrame(() => {
      if (mode === "input") dom.modalInput.focus();
      else if (mode === "textarea") dom.modalTextarea.focus();
      else dom.modalConfirm.focus();
    });
  });
}

function showNoticeModal({ title, message }) {
  return showModalBase({ title, message, mode: "notice", confirmLabel: "Đóng", cancelLabel: "Đóng" }).then(() => true);
}

function showConfirmModal({ title, message, confirmLabel = "Đồng ý", cancelLabel = "Hủy" }) {
  return showModalBase({ title, message, mode: "confirm", confirmLabel, cancelLabel });
}

function showInputModal({ title, message, initialValue = "", confirmLabel = "Xong" }) {
  return showModalBase({ title, message, mode: "input", inputValue: initialValue, confirmLabel }).then((value) => {
    if (value === false) return null;
    return value;
  });
}

function setAiStatus(message = "", type = "info") {
  if (!dom.aiStatus) return;
  dom.aiStatus.textContent = message;
  dom.aiStatus.classList.remove("is-error", "is-success");
  if (type === "error") dom.aiStatus.classList.add("is-error");
  if (type === "success") dom.aiStatus.classList.add("is-success");
}

function updateAiButtonsState() {
  const hasPrompt = Boolean(dom.aiPrompt?.value.trim());
  const hasFile = Boolean(dom.aiFileInput?.files?.[0]);
  dom.aiModal.querySelectorAll("[data-ai-mode]").forEach((card) => {
    const mode = card.dataset.aiMode;
    const active = (mode === "prompt" && hasPrompt && !hasFile) || (mode === "file" && hasFile && !hasPrompt);
    const disabled = state.ai.generating || state.ai.reading || (mode === "prompt" ? hasFile : hasPrompt);
    card.classList.toggle("is-active", active);
    card.classList.toggle("is-disabled", disabled && !active);
  });
  dom.aiPrompt.disabled = state.ai.generating || state.ai.reading || hasFile;
  dom.aiFileInput.disabled = state.ai.generating || hasPrompt;
  dom.aiClearFile.hidden = !hasFile;
  if (state.ai.generating) {
    dom.aiGenerate.disabled = true;
    dom.aiGenerate.textContent = "Đang tạo...";
  } else if (state.ai.reading) {
    dom.aiGenerate.disabled = true;
    dom.aiGenerate.textContent = "Đang đọc file...";
  } else if (hasPrompt || hasFile) {
    dom.aiGenerate.disabled = false;
    dom.aiGenerate.textContent = "Tạo mindmap";
  } else {
    dom.aiGenerate.disabled = true;
    dom.aiGenerate.textContent = "Đang chờ lựa chọn...";
  }
}

function resetAiForm() {
  dom.aiPrompt.value = "";
  state.ai.fileText = "";
  state.ai.reading = false;
  dom.aiFileInput.value = "";
  dom.aiFileName.textContent = "Chưa chọn file";
  dom.aiClearFile.hidden = true;
  setAiStatus("");
  updateAiButtonsState();
}

function openAiModal() {
  openNoticeBackdrop();
  dom.aiModal.hidden = false;
  setAiStatus("");
  updateAiButtonsState();
}

function closeAiModal(force = false) {
  if (state.ai.generating && !force) {
    setAiStatus("AI đang tạo sơ đồ, vui lòng chờ xong.", "info");
    return;
  }
  dom.aiModal.hidden = true;
  if (dom.modal.hidden) dom.modalBackdrop.hidden = true;
}

async function handleAiFileChange(event) {
  const file = event.target.files?.[0];
  state.ai.fileText = "";
  if (!file) {
    dom.aiFileName.textContent = "Chưa chọn file";
    setAiStatus("");
    updateAiButtonsState();
    return;
  }
  state.ai.reading = true;
  dom.aiFileName.textContent = "Đang đọc file...";
  updateAiButtonsState();
  try {
    const text = await file.text();
    state.ai.fileText = text;
    dom.aiFileName.textContent = file.name || "Đã tải file";
    setAiStatus(text.trim() ? `Đã nạp "${file.name}"` : "File TXT đang trống.", text.trim() ? "success" : "error");
  } catch (error) {
    console.error("AI file read error:", error);
    state.ai.fileText = "";
    dom.aiFileName.textContent = "Chưa chọn file";
    setAiStatus("Không thể đọc file TXT.", "error");
  } finally {
    state.ai.reading = false;
    updateAiButtonsState();
  }
}

function normalizeImportedPayload(raw) {
  const unwrapped = unwrapLegacyTree(raw);
  const source = unwrapped.tree || raw;
  const tree = normalizeNode(source);
  const canvasTheme = raw?.canvasTheme && CANVAS_THEMES[raw.canvasTheme] ? raw.canvasTheme : null;
  const customTheme = raw?.customTheme?.base && parseColorString(raw.customTheme.base)
    ? { base: raw.customTheme.base.trim() }
    : null;
  return { tree, canvasTheme, customTheme };
}

function applyImportedTree(payload) {
  if (!payload?.tree) return;
  ensureRenderableGeometry(payload.tree);
  state.tree = payload.tree;
  state.selectedNodeId = payload.tree.id;
  state.canvasTheme = payload.canvasTheme || "soft";
  state.customTheme = state.canvasTheme === "custom" ? payload.customTheme : null;
  state.view.scale = 1;
  state.view.panX = 0;
  state.view.panY = 0;
  saveTree();
  render();
}

async function handleAiGenerate() {
  if (state.ai.generating || state.ai.reading) return;
  const prompt = dom.aiPrompt.value.trim();
  const hasPrompt = Boolean(prompt);
  const hasFile = Boolean(dom.aiFileInput.files?.[0]);
  if (!hasPrompt && !hasFile) {
    setAiStatus("Hãy nhập prompt hoặc chọn file TXT.", "error");
    return;
  }
  if (hasFile && !state.ai.fileText.trim()) {
    setAiStatus("File TXT đang trống, hãy chọn file khác.", "error");
    return;
  }
  state.ai.generating = true;
  updateAiButtonsState();
  setAiStatus("Đang tạo mindmap với AI...", "info");
  try {
    const payload = hasPrompt ? { prompt } : { fileText: state.ai.fileText.slice(0, 15000) };
    if (IS_LOCAL_MINDMAP) payload.mock = true;
    const response = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include"
    });
    const isJson = (response.headers.get("content-type") || "").includes("application/json");
    const data = isJson ? await response.json() : { error: await response.text() };
    if (!response.ok) throw new Error(data?.message || data?.error || "Không thể tạo sơ đồ từ AI.");
    const normalized = normalizeImportedPayload(data.tree || data.data || data);
    if (!normalized?.tree) throw new Error("Dữ liệu AI trả về không hợp lệ.");
    applyImportedTree(normalized);
    resetAiForm();
    closeAiModal(true);
    updateToolbar("AI đã tạo sơ đồ mới");
  } catch (error) {
    console.error("mindmap AI error:", error);
    setAiStatus(error.message || "Không thể tạo sơ đồ.", "error");
  } finally {
    state.ai.generating = false;
    updateAiButtonsState();
  }
}

async function importMindmapText(rawText) {
  if (!rawText) throw new Error("Không có dữ liệu");
  const parsed = JSON.parse(rawText);
  const normalized = normalizeImportedPayload(parsed);
  if (!normalized?.tree) throw new Error("Dữ liệu mindmap không hợp lệ");
  applyImportedTree(normalized);
}

async function handleImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    await importMindmapText(text);
    updateToolbar(`Đã nhập file "${file.name}"`);
  } catch (error) {
    await showNoticeModal({ title: "Không thể nhập file", message: error.message || "File không hợp lệ." });
  } finally {
    event.target.value = "";
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJsonFile() {
  const data = JSON.stringify({
    ...cloneJson(state.tree),
    canvasTheme: state.canvasTheme,
    customTheme: state.customTheme
  }, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  downloadBlob(blob, `taedu-mindmap-${Date.now()}.json`);
  updateToolbar("Đã xuất JSON");
}

async function ensureDomToImage() {
  if (window.domtoimage) return window.domtoimage;
  if (!window.__mindmapDomToImagePromise) {
    window.__mindmapDomToImagePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/dom-to-image-more@3.2.0/dist/dom-to-image-more.min.js";
      script.async = true;
      script.onload = () => resolve(window.domtoimage);
      script.onerror = () => reject(new Error("Không thể tải thư viện xuất PNG"));
      document.head.appendChild(script);
    });
  }
  return window.__mindmapDomToImagePromise;
}

async function exportPngFile() {
  try {
    const domtoimage = await ensureDomToImage();
    const dataUrl = await domtoimage.toPng(dom.canvas, { cacheBust: true, bgcolor: "#fff7f1" });
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = `taedu-mindmap-${Date.now()}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    updateToolbar("Đã xuất PNG");
  } catch (error) {
    await showNoticeModal({ title: "Không thể xuất PNG", message: error.message || "Vui lòng thử lại." });
  }
}

async function resetMap() {
  const confirmed = await showConfirmModal({
    title: "Reset mindmap?",
    message: "Toàn bộ node hiện tại sẽ bị xóa và chỉ giữ node trung tâm.",
    confirmLabel: "Reset",
    cancelLabel: "Hủy"
  });
  if (!confirmed) return;
  localStorage.removeItem(STORAGE_KEY);
  state.tree = baseRootNode();
  state.selectedNodeId = state.tree.id;
  centerView(true);
  saveTree();
  render();
  updateToolbar("Đã reset mindmap");
}

function reloadWithoutCache() {
  localStorage.removeItem(STORAGE_KEY);
  try {
    sessionStorage.setItem(SKIP_CACHE_SESSION_KEY, "1");
  } catch (error) {
    console.warn("Skip cache flag error:", error);
  }
  window.location.reload();
}

function zoom(direction) {
  if (direction === "in") state.view.scale = clamp(state.view.scale + SCALE_STEP, MIN_SCALE, MAX_SCALE);
  if (direction === "out") state.view.scale = clamp(state.view.scale - SCALE_STEP, MIN_SCALE, MAX_SCALE);
  applySceneTransform();
}

function triggerImportPicker() {
  dom.fileInput.value = "";
  dom.fileInput.click();
}

function toSceneDelta(clientDelta) {
  return clientDelta / state.view.scale;
}

function startPan(event) {
  if (event.button !== 0) return;
  if (event.target.closest(".mindmap-node, .mindmap-context-menu, .mindmap-modal-card")) return;
  closeContextMenu();
  state.pointerPan.active = true;
  state.pointerPan.pointerId = event.pointerId;
  state.pointerPan.startX = event.clientX;
  state.pointerPan.startY = event.clientY;
  state.pointerPan.panX = state.view.panX;
  state.pointerPan.panY = state.view.panY;
  dom.canvas.classList.add("is-panning");
  trySetPointerCapture(dom.canvas, event.pointerId);
}

function movePan(event) {
  if (!state.pointerPan.active || state.pointerPan.pointerId !== event.pointerId) return;
  state.view.panX = state.pointerPan.panX + (event.clientX - state.pointerPan.startX);
  state.view.panY = state.pointerPan.panY + (event.clientY - state.pointerPan.startY);
  applySceneTransform();
}

function stopPan(event) {
  if (!state.pointerPan.active || (event && state.pointerPan.pointerId !== event.pointerId)) return;
  state.pointerPan.active = false;
  dom.canvas.classList.remove("is-panning");
}

function startNodeDrag(event, nodeId) {
  if (event.button !== 0) return;
  if (event.target.closest(".resize-handle")) return;
  const node = getNode(nodeId);
  if (!node) return;
  ensureNodeGeometry(node, getParent(nodeId), getDepth(nodeId));
  state.dragNode.active = true;
  state.dragNode.pointerId = event.pointerId;
  state.dragNode.nodeId = nodeId;
  state.dragNode.startX = event.clientX;
  state.dragNode.startY = event.clientY;
  state.dragNode.nodeX = node.position?.x ?? 0;
  state.dragNode.nodeY = node.position?.y ?? 0;
  selectNode(nodeId);
  trySetPointerCapture(event.currentTarget, event.pointerId);
  dom.canvas.classList.add("is-node-dragging");
}

function moveNodeDrag(event) {
  if (!state.dragNode.active || state.dragNode.pointerId !== event.pointerId) return;
  const node = getNode(state.dragNode.nodeId);
  if (!node) return;
  ensureNodeGeometry(node, getParent(node.id), getDepth(node.id));
  node.position.x = state.dragNode.nodeX + toSceneDelta(event.clientX - state.dragNode.startX);
  node.position.y = state.dragNode.nodeY + toSceneDelta(event.clientY - state.dragNode.startY);
  render();
}

function stopNodeDrag(event) {
  if (!state.dragNode.active || (event && state.dragNode.pointerId !== event.pointerId)) return;
  state.dragNode.active = false;
  dom.canvas.classList.remove("is-node-dragging");
  saveTree();
}

function startResize(event, nodeId, handle) {
  event.stopPropagation();
  const node = getNode(nodeId);
  if (!node) return;
  ensureNodeGeometry(node, getParent(nodeId), getDepth(nodeId));
  state.resizeNode.active = true;
  state.resizeNode.pointerId = event.pointerId;
  state.resizeNode.nodeId = nodeId;
  state.resizeNode.handle = handle;
  state.resizeNode.startX = event.clientX;
  state.resizeNode.startY = event.clientY;
  state.resizeNode.width = node.size?.width ?? defaultSizeForDepth(getDepth(nodeId)).width;
  state.resizeNode.height = node.size?.height ?? defaultSizeForDepth(getDepth(nodeId)).height;
  state.resizeNode.posX = node.position?.x ?? 0;
  state.resizeNode.posY = node.position?.y ?? 0;
  trySetPointerCapture(event.target, event.pointerId);
}

function moveResize(event) {
  if (!state.resizeNode.active || state.resizeNode.pointerId !== event.pointerId) return;
  const node = getNode(state.resizeNode.nodeId);
  if (!node) return;
  ensureNodeGeometry(node, getParent(node.id), getDepth(node.id));
  const dx = toSceneDelta(event.clientX - state.resizeNode.startX);
  const dy = toSceneDelta(event.clientY - state.resizeNode.startY);
  let width = state.resizeNode.width;
  let height = state.resizeNode.height;
  let x = state.resizeNode.posX;
  let y = state.resizeNode.posY;
  if (state.resizeNode.handle.includes("right")) {
    width += dx;
    x += dx / 2;
  }
  if (state.resizeNode.handle.includes("left")) {
    width -= dx;
    x += dx / 2;
  }
  if (state.resizeNode.handle.includes("bottom")) {
    height += dy;
    y += dy / 2;
  }
  if (state.resizeNode.handle.includes("top")) {
    height -= dy;
    y += dy / 2;
  }
  node.size.width = clamp(width, MIN_NODE_WIDTH, MAX_NODE_WIDTH);
  node.size.height = clamp(height, MIN_NODE_HEIGHT, MAX_NODE_HEIGHT);
  node.position.x = x;
  node.position.y = y;
  render();
}

function stopResize(event) {
  if (!state.resizeNode.active || (event && state.resizeNode.pointerId !== event.pointerId)) return;
  state.resizeNode.active = false;
  saveTree();
}

function bindCanvasEvents() {
  dom.canvas.addEventListener("pointerdown", startPan);
  dom.canvas.addEventListener("pointermove", (event) => {
    movePan(event);
    moveNodeDrag(event);
    moveResize(event);
  });
  dom.canvas.addEventListener("pointerup", (event) => {
    stopPan(event);
    stopNodeDrag(event);
    stopResize(event);
  });
  dom.canvas.addEventListener("pointercancel", (event) => {
    stopPan(event);
    stopNodeDrag(event);
    stopResize(event);
  });
  dom.canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? "in" : "out");
  }, { passive: false });
  dom.canvas.addEventListener("click", (event) => {
    if (event.target === dom.canvas || event.target.classList.contains("mindmap-grid-glow")) {
      state.selectedNodeId = null;
      render();
    }
  });
  dom.canvas.addEventListener("contextmenu", (event) => {
    if (event.target.closest(".mindmap-node, .mindmap-connector, .mindmap-context-menu")) return;
    event.preventDefault();
    openContextMenu("canvas", null, event.clientX, event.clientY);
  });
}

function bindActionButtons() {
  const actions = {
    "open-ai-modal": openAiModal,
    "export-png": exportPngFile,
    "export-json-file": exportJsonFile,
    "import-json-file": triggerImportPicker,
    "reset-map": resetMap,
    "reload-fresh": reloadWithoutCache,
    "zoom-in": () => zoom("in"),
    "zoom-out": () => zoom("out"),
    center: () => centerView(true)
  };
  dom.actionButtons.forEach((button) => {
    const action = button.dataset.action;
    if (actions[action]) button.addEventListener("click", actions[action]);
  });

  const contextActions = {
    "add-child": () => addChildNode(state.contextMenu.targetId || state.selectedNodeId),
    "add-sibling": () => addSiblingNode(state.contextMenu.targetId || state.selectedNodeId),
    "edit-node": () => editNode(state.contextMenu.targetId || state.selectedNodeId),
    "delete-node": () => deleteNode(state.contextMenu.targetId || state.selectedNodeId),
    "shape-pill": () => changeNodeShape(state.contextMenu.targetId, "pill"),
    "shape-rect": () => changeNodeShape(state.contextMenu.targetId, "rect"),
    "shape-oval": () => changeNodeShape(state.contextMenu.targetId, "oval"),
    "shape-cloud": () => changeNodeShape(state.contextMenu.targetId, "cloud"),
    "color-purple": () => changeNodeColor(state.contextMenu.targetId, "purple"),
    "color-mint": () => changeNodeColor(state.contextMenu.targetId, "mint"),
    "color-peach": () => changeNodeColor(state.contextMenu.targetId, "peach"),
    "color-rose": () => changeNodeColor(state.contextMenu.targetId, "rose"),
    "color-yellow": () => changeNodeColor(state.contextMenu.targetId, "yellow"),
    "color-lilac": () => changeNodeColor(state.contextMenu.targetId, "lilac"),
    "font-decrease": () => changeFontSize(state.contextMenu.targetId, "decrease"),
    "font-increase": () => changeFontSize(state.contextMenu.targetId, "increase"),
    "font-reset": () => changeFontSize(state.contextMenu.targetId, "reset"),
    "link-arrow-none": () => changeLinkArrow(state.contextMenu.targetId, "none"),
    "link-arrow-start": () => changeLinkArrow(state.contextMenu.targetId, "start"),
    "link-arrow-end": () => changeLinkArrow(state.contextMenu.targetId, "end"),
    "link-arrow-both": () => changeLinkArrow(state.contextMenu.targetId, "both"),
    "link-width-thin": () => changeLinkThickness(state.contextMenu.targetId, "thin"),
    "link-width-medium": () => changeLinkThickness(state.contextMenu.targetId, "medium"),
    "link-width-thick": () => changeLinkThickness(state.contextMenu.targetId, "thick"),
    "link-opacity-soft": () => changeLinkOpacity(state.contextMenu.targetId, "soft"),
    "link-opacity-normal": () => changeLinkOpacity(state.contextMenu.targetId, "normal"),
    "link-opacity-bold": () => changeLinkOpacity(state.contextMenu.targetId, "bold"),
    "theme-soft": () => changeCanvasTheme("soft"),
    "theme-sunset": () => changeCanvasTheme("sunset"),
    "theme-ocean": () => changeCanvasTheme("ocean"),
    "theme-forest": () => changeCanvasTheme("forest"),
    "theme-night": () => changeCanvasTheme("night"),
    "theme-custom": applyCustomCanvasTheme
  };

  dom.contextButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const action = button.dataset.contextAction;
      if (!contextActions[action]) return;
      contextActions[action]();
      if (button.dataset.stayOpen !== "true") closeContextMenu();
    });
  });
}

function bindModalEvents() {
  dom.modalConfirm.addEventListener("click", () => {
    if (state.modal.mode === "input") {
      const value = dom.modalInput.value.trim();
      if (!value) {
        dom.modalInput.classList.add("has-error");
        dom.modalInput.focus();
        return;
      }
      resolveModal(value);
      return;
    }
    if (state.modal.mode === "textarea") {
      const value = dom.modalTextarea.value.trim();
      if (!value) {
        dom.modalTextarea.classList.add("has-error");
        dom.modalTextarea.focus();
        return;
      }
      resolveModal(value);
      return;
    }
    resolveModal(true);
  });
  dom.modalCancel.addEventListener("click", () => resolveModal(false));
  dom.modalCloseButtons.forEach((button) => button.addEventListener("click", () => resolveModal(false)));
  dom.modalBackdrop.addEventListener("click", () => {
    if (!dom.aiModal.hidden) {
      closeAiModal();
      return;
    }
    resolveModal(false);
  });
  dom.modalInput.addEventListener("input", () => dom.modalInput.classList.remove("has-error"));
  dom.modalTextarea.addEventListener("input", () => dom.modalTextarea.classList.remove("has-error"));
  dom.modalInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      dom.modalConfirm.click();
    }
  });
  dom.modalTextarea.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      dom.modalConfirm.click();
    }
  });
}

function bindAiEvents() {
  dom.aiPrompt.addEventListener("input", () => {
    if (dom.aiStatus.classList.contains("is-error")) setAiStatus("");
    updateAiButtonsState();
  });
  dom.aiFileInput.addEventListener("change", handleAiFileChange);
  dom.aiGenerate.addEventListener("click", handleAiGenerate);
  dom.aiClearFile.addEventListener("click", () => {
    dom.aiFileInput.value = "";
    state.ai.fileText = "";
    dom.aiFileName.textContent = "Chưa chọn file";
    setAiStatus("");
    updateAiButtonsState();
  });
  dom.aiCloseButtons.forEach((button) => button.addEventListener("click", () => closeAiModal()));
}

function bindGlobalEvents() {
  document.addEventListener("click", (event) => {
    if (!dom.contextMenu.hidden && !dom.contextMenu.contains(event.target)) {
      closeContextMenu();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!dom.aiModal.hidden) {
        closeAiModal();
        return;
      }
      if (!dom.modal.hidden) {
        resolveModal(false);
        return;
      }
      closeContextMenu();
    }
    if ((event.key === "Delete" || event.key === "Backspace") && state.selectedNodeId && state.selectedNodeId !== "root" && !event.target.closest("input, textarea")) {
      event.preventDefault();
      deleteNode(state.selectedNodeId);
    }
  });
  window.addEventListener("resize", () => {
    closeContextMenu();
    applySceneTransform();
  });
}

function refreshMeta() {
  if (!dom.selectionMeta) return;
  const node = getNode(state.selectedNodeId);
  dom.selectionMeta.textContent = node
    ? `${node.content} • tầng ${getDepth(node.id)}`
    : "Chưa chọn node";
}

function bootstrap() {
  if (!dom.canvas) return;
  state.tree = loadTree();
  state.selectedNodeId = state.tree.id;
  render();
  bindCanvasEvents();
  bindActionButtons();
  bindModalEvents();
  bindAiEvents();
  bindGlobalEvents();
  dom.fileInput.addEventListener("change", handleImportFile);
  updateToolbar("Sẵn sàng: click node để chọn, kéo để di chuyển, chuột phải để mở menu nhanh.");
  updateAiButtonsState();
}

document.addEventListener("DOMContentLoaded", bootstrap);
