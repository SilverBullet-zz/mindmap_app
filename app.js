const palette = ["#ffd1dc", "#ffd8b5", "#c8f2dc", "#bfe8ff", "#dbcaff", "#fff1b8"];
const LOCAL_INDEX_KEY = "zhitu.localMaps.v1";
const LOCAL_LAST_KEY = "zhitu.lastLocalMap.v1";
const LOCAL_MAP_PREFIX = "zhitu.map.";
const LOCAL_TRASH_KEY = "zhitu.trash.v1";
const WORKSPACE_DB_NAME = "zhitu.workspace.v1";
const WORKSPACE_STORE_NAME = "handles";
const WORKSPACE_HANDLE_KEY = "working-directory";
const WORKSPACE_NAME_KEY = "zhitu.workspaceName.v1";
const WORKSPACE_WIDTH_KEY = "zhitu.workspaceWidth.v1";
const WORKSPACE_COLLAPSED_KEY = "zhitu.workspaceCollapsed.v1";
const WORKSPACE_CURRENT_FILE_KEY = "zhitu.workspaceCurrentFile.v1";
const WORKSPACE_TRASH_DIR = ".mindmap_trash";
const WORKSPACE_TRASH_FORMAT = "mindmap-trash";
const AUTOSAVE_INTERVAL = 5000;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.6;
const BUTTON_ZOOM_STEP = 0.1;
const WHEEL_ZOOM_STEP = 0.08;
const KEYBOARD_ZOOM_STEP = 0.04;
const DEFAULT_DOCUMENT_TITLE = "未命名思维导图";
const ROOT_TOPIC_TEXT = "主题";
const NEW_TOPIC_TEXT = "分支";
const LEGACY_NEW_TOPIC_TEXT = "新主题";
const DOCUMENT_IMAGE_MIN_SIZE = 56;
const DOCUMENT_IMAGE_MAX_SIZE = 1200;
const NODE_WIDTH_RULES = {
  root: { min: 300, max: 540, seed: 300, padding: 60, fontSize: 24, fontWeight: 750 },
  branch: { min: 220, max: 420, seed: 220, padding: 54, fontSize: 16, fontWeight: 650 },
};
const sizingContext = document.createElement("canvas").getContext("2d");

function createDefaultNodes() {
  return [
  { id: "root", parentId: null, text: ROOT_TOPIC_TEXT, side: 0, color: "#f7fff9", collapsed: false, width: NODE_WIDTH_RULES.root.seed, x: 0, y: 0 },
  { id: "n1", parentId: "root", text: NEW_TOPIC_TEXT, side: 1, color: palette[0], collapsed: false, width: NODE_WIDTH_RULES.branch.seed, x: 0, y: 0 },
  { id: "n2", parentId: "root", text: NEW_TOPIC_TEXT, side: 1, color: palette[1], collapsed: false, width: NODE_WIDTH_RULES.branch.seed, x: 0, y: 0 },
  { id: "n3", parentId: "root", text: NEW_TOPIC_TEXT, side: -1, color: palette[2], collapsed: false, width: NODE_WIDTH_RULES.branch.seed, x: 0, y: 0 },
  { id: "n4", parentId: "root", text: NEW_TOPIC_TEXT, side: -1, color: palette[3], collapsed: false, width: NODE_WIDTH_RULES.branch.seed, x: 0, y: 0 },
  ];
}

function createDefaultProjectData() {
  return {
    title: ROOT_TOPIC_TEXT,
    nodes: createDefaultNodes(),
    view: { zoom: 1, pan: { x: 0, y: 0 } },
  };
}

function createLocalId() {
  return window.crypto?.randomUUID?.() || `map-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function defaultTopicText(node) {
  return node?.id === "root" || node?.parentId === null ? ROOT_TOPIC_TEXT : NEW_TOPIC_TEXT;
}

function nodeWidthLimits(node) {
  const spec = node.id === "root" ? NODE_WIDTH_RULES.root : NODE_WIDTH_RULES.branch;
  const viewportCap = viewport?.clientWidth ? Math.max(spec.min, Math.floor(viewport.clientWidth * 0.42)) : spec.max;
  return { ...spec, max: Math.min(spec.max, viewportCap) };
}

function estimateNodeTextWidth(node, measureText) {
  const context = measureText || sizingContext;
  const limits = nodeWidthLimits(node);
  const font = `${limits.fontWeight} ${limits.fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
  const lines = String(node.text || defaultTopicText(node))
    .replace(/\r\n/g, "\n")
    .split("\n");
  return Math.max(
    ...lines.map((line) => {
      context.font = font;
      return context.measureText(line || " ").width;
    }),
    0
  );
}

function resolveNodeWidth(node, measureText) {
  const limits = nodeWidthLimits(node);
  const measured = estimateNodeTextWidth(node, measureText) + limits.padding;
  const autoWidth = clamp(Math.ceil(measured), limits.min, limits.max);
  const currentWidth = Number(node.width);
  if (!Number.isFinite(currentWidth)) {
    node.width = autoWidth;
  } else if (editingId === node.id && autoWidth > currentWidth) {
    node.width = autoWidth;
  } else {
    node.width = clamp(Math.round(currentWidth), limits.min, limits.max);
  }
  return node.width;
}

function defaultNodeWidth(node) {
  return nodeWidthLimits(node).seed;
}

function syncEditingNodeWidth() {
  if (!editingId) return;
  const node = getNode(editingId);
  const element = nodesLayer.querySelector(`[data-id="${editingId}"]`);
  if (!node || !element) return;
  const nextWidth = resolveNodeWidth(node, sizingContext);
  element.style.width = `${nextWidth}px`;
}

let nodes = createDefaultNodes();

let selectedId = "root";
let selectedIds = new Set(["root"]);
let editingId = null;
let nodeCounter = 5;
let zoom = 1;
let pan = { x: 0, y: 0 };
let history = [];
let future = [];
let editSnapshot = null;
let internalClipboard = null;
let nodeDrag = null;
let nodeImageDrag = null;
let nodeResize = null;
let suppressNextClick = false;
let animatingNodeIds = new Set();
let editingSpaceHeld = false;
let currentLocalId = createLocalId();
let autosaveDirty = false;
let suppressAutosaveMark = false;
let homeMode = "maps";
let workspaceDirectoryHandle = null;
let workspaceResize = null;
let workspaceFiles = [];
let workspaceHomeItems = [];
let workspaceTrashItems = [];
let workspaceTree = [];
let currentCompareEntries = [];
let expandedWorkspaceFolders = new Set();
let currentWorkspaceFileName = null;
let currentWorkspaceFileModifiedAt = 0;
let currentWorkspaceFileFingerprint = "";
let workspaceConflictPaused = false;
let workspaceConflictFileName = null;
let autosaveWorkspacePromise = null;
let autosaveWorkspaceQueued = false;
let workspaceRefreshTimer = null;
let workspaceDragFilePath = "";
let workspaceSelectedFileKey = "";
let currentMapImageFolder = "";
let mapReturnStack = [];
let titleEditedByUser = false;
let nodeLinkMenu = null;
let documentImageResize = null;
let selectedDocumentImageLine = null;
let documentImagePreviewToken = 0;
const documentImageObjectUrls = new Map();
let nodeImagePreviewToken = 0;
let pendingNodeImageTargetId = null;
const nodeImagePastePendingIds = new Set();
let searchState = {
  query: "",
  caseSensitive: false,
  scope: "current",
  results: [],
  active: null,
  jumpArmed: false,
};
const activeCanvasTouches = new Map();
let touchCanvasState = null;

const viewport = document.querySelector("#canvas-viewport");
const stage = document.querySelector("#mindmap-stage");
const nodesLayer = document.querySelector("#nodes-layer");
const connections = document.querySelector("#connections");
const hintText = document.querySelector("#hint-text");
const zoomLabel = document.querySelector("#zoom-label");
const undoButton = document.querySelector("#undo-button");
const redoButton = document.querySelector("#redo-button");
const exportButton = document.querySelector("#export-button");
const exportMenu = document.querySelector("#export-menu");
const copyButton = document.querySelector("#copy-button");
const pasteButton = document.querySelector("#paste-button");
const searchInput = document.querySelector("#search-input");
const searchCaseToggle = document.querySelector("#search-case-toggle");
const searchScopeToggle = document.querySelector("#search-scope-toggle");
const searchResults = document.querySelector("#search-results");
const documentTitleInput = document.querySelector("#document-title");
const openLocalButton = document.querySelector("#open-local-button");
const saveButton = document.querySelector("#save-button");
const workspaceSidebar = document.querySelector("#workspace-sidebar");
const workspaceCollapseButton = document.querySelector("#workspace-collapse");
const workspaceResizer = document.querySelector("#workspace-resizer");
const workspaceFolderName = document.querySelector("#workspace-folder-name");
const workspaceFolderStatus = document.querySelector("#workspace-folder-status");
const workspaceModeLabel = document.querySelector("#workspace-mode-label");
const workspaceCapabilities = document.querySelector("#workspace-capabilities");
const workspaceSourceNote = document.querySelector("#workspace-source-note");
const chooseWorkspaceFolderButton = document.querySelector("#choose-workspace-folder");
const openWorkspaceFileButton = document.querySelector("#open-workspace-file");
const newWorkspaceMapButton = document.querySelector("#new-workspace-map");
const refreshWorkspaceFilesButton = document.querySelector("#refresh-workspace-files");
const workspaceFileCount = document.querySelector("#workspace-file-count");
const workspaceFileList = document.querySelector("#workspace-file-list");
const mapReturnButton = document.querySelector("#map-return-button");
const homeButton = document.querySelector("#home-button");
const homeOverlay = document.querySelector("#home-overlay");
const homeList = document.querySelector("#home-list");
const closeHomeButton = document.querySelector("#close-home");
const newLocalMapButton = document.querySelector("#new-local-map");
const trashButton = document.querySelector("#trash-button");
const compareButton = document.querySelector("#compare-button");
const compareOverlay = document.querySelector("#compare-overlay");
const closeCompareButton = document.querySelector("#close-compare");
const compareLeftSelect = document.querySelector("#compare-left");
const compareRightSelect = document.querySelector("#compare-right");
const runCompareButton = document.querySelector("#run-compare");
const compareResult = document.querySelector("#compare-result");
const openFileInput = document.querySelector("#open-file-input");
const selectionMarquee = document.querySelector("#selection-marquee");
const nodeDocumentOverlay = document.querySelector("#node-document-overlay");
const nodeDocumentTitle = document.querySelector("#node-document-title");
const nodeDocumentEditor = document.querySelector("#node-document-editor");
const nodeDocumentPreview = document.querySelector("#node-document-preview");
const closeDocumentButton = document.querySelector("#close-document-button");
const copyDocumentButton = document.querySelector("#copy-document-button");
const insertImageButton = document.querySelector("#insert-image-button");
const documentImageInput = document.querySelector("#document-image-input");
const nodeImageInput = document.querySelector("#node-image-input");
const documentImageViewer = document.querySelector("#document-image-viewer");
const documentImageViewerImg = document.querySelector("#document-image-viewer-img");
const closeImageViewerButton = document.querySelector("#close-image-viewer");
const workspaceConflictOverlay = document.querySelector("#workspace-conflict-overlay");
const workspaceConflictMessage = document.querySelector("#workspace-conflict-message");
const conflictSaveCopyButton = document.querySelector("#conflict-save-copy");
const conflictOverwriteButton = document.querySelector("#conflict-overwrite");
const conflictReloadButton = document.querySelector("#conflict-reload");
const conflictDismissButton = document.querySelector("#conflict-dismiss");
let activeDocumentId = null;

function cloneNodes(source = nodes) {
  return source.map((node) => ({
    ...node,
    mapLink: node.mapLink ? { ...node.mapLink } : undefined,
    images: Array.isArray(node.images) ? node.images.map((image) => ({ ...image })) : undefined,
  }));
}

function pushHistory() {
  history.push(cloneNodes());
  if (history.length > 60) history.shift();
  future = [];
  updateHistoryButtons();
  markSaving();
}

function updateHistoryButtons() {
  undoButton.disabled = history.length === 0;
  redoButton.disabled = future.length === 0;
}

function markSaving() {
  if (suppressAutosaveMark) return;
  autosaveDirty = true;
  const label = document.querySelector(".save-state");
  label.textContent = "有未保存更改";
  window.clearTimeout(markSaving.timer);
  markSaving.timer = window.setTimeout(() => {
    label.textContent = "等待自动保存";
  }, 900);
}

function showStatus(text, duration = 1300) {
  const label = document.querySelector(".save-state");
  window.clearTimeout(markSaving.timer);
  label.textContent = text;
  markSaving.timer = window.setTimeout(() => {
    label.textContent = autosaveDirty ? "等待自动保存" : "本地已保存";
  }, duration);
}

function getNode(id) {
  return nodes.find((node) => node.id === id);
}

function childrenOf(id) {
  return nodes.filter((node) => node.parentId === id);
}

function visibleChildrenOf(id) {
  const parent = getNode(id);
  return parent?.collapsed ? [] : childrenOf(id);
}

function descendantsOf(id) {
  const output = [];
  const visit = (parentId) => {
    childrenOf(parentId).forEach((child) => {
      output.push(child.id);
      visit(child.id);
    });
  };
  visit(id);
  return output;
}

function isHiddenByFold(id) {
  let parentId = getNode(id)?.parentId;
  while (parentId !== null && parentId !== undefined) {
    const parent = getNode(parentId);
    if (!parent) return true;
    if (parent.collapsed) return true;
    parentId = parent.parentId;
  }
  return false;
}

function visibleNodes() {
  return nodes.filter((node) => !isHiddenByFold(node.id));
}

function nearestVisibleId(id) {
  let currentId = getNode(id) ? id : "root";
  while (currentId && isHiddenByFold(currentId)) {
    currentId = getNode(currentId)?.parentId || "root";
  }
  return getNode(currentId) ? currentId : "root";
}

function ensureVisibleSelection() {
  selectedIds = new Set([...selectedIds].filter((id) => getNode(id) && !isHiddenByFold(id)));
  if (!selectedIds.size || !selectedIds.has(selectedId)) {
    selectedId = nearestVisibleId(selectedId);
    selectedIds = new Set([selectedId]);
  }
}

function selectionRootIds({ excludeRoot = false } = {}) {
  const candidates = [...selectedIds].filter((id) => getNode(id) && (!excludeRoot || id !== "root"));
  const candidateSet = new Set(candidates);
  return candidates.filter((id) => {
    let parentId = getNode(id)?.parentId;
    while (parentId !== null && parentId !== undefined) {
      if (candidateSet.has(parentId)) return false;
      parentId = getNode(parentId)?.parentId;
    }
    return true;
  });
}

function refreshSelectionClasses() {
  ensureVisibleSelection();
  nodesLayer.querySelectorAll(".topic-node").forEach((element) => {
    const selected = selectedIds.has(element.dataset.id);
    element.classList.toggle("selected", selected);
    element.classList.toggle("primary", selected && element.dataset.id === selectedId);
    element.setAttribute("aria-selected", selected ? "true" : "false");
  });
}

function setSelection(ids, primaryId) {
  const validIds = [...new Set(ids)].filter((id) => getNode(id));
  selectedIds = new Set(validIds);
  selectedId = getNode(primaryId) ? primaryId : validIds[0] || "root";
  editingId = null;
  refreshSelectionClasses();
}

function searchText(value) {
  return searchState.caseSensitive ? String(value || "") : String(value || "").toLocaleLowerCase();
}

function currentMapTitle() {
  return documentTitleInput.value.trim() || getNode("root")?.text?.trim() || DEFAULT_DOCUMENT_TITLE;
}

function rootTopicTitle() {
  return getNode("root")?.text?.trim() || ROOT_TOPIC_TEXT;
}

function rootTitleFromNodes(projectNodes = nodes) {
  return projectNodes.find((node) => node.id === "root" || node.parentId === null)?.text?.trim() || ROOT_TOPIC_TEXT;
}

function isDefaultBlankProject(data) {
  const projectNodes = Array.isArray(data?.nodes) ? data.nodes : [];
  if (projectNodes.length !== 5) return false;
  const root = projectNodes.find((node) => node.id === "root" || node.parentId === null);
  if (!root || String(root.text || "").trim() !== ROOT_TOPIC_TEXT) return false;
  return projectNodes.every((node) => {
    const text = String(node.text || "").trim();
    const isExpectedText = node === root
      ? text === ROOT_TOPIC_TEXT
      : text === NEW_TOPIC_TEXT || text === LEGACY_NEW_TOPIC_TEXT;
    return isExpectedText &&
      typeof node.document !== "string" &&
      !node.mapLink &&
      (!Array.isArray(node.images) || node.images.length === 0);
  });
}

function shouldUseRootTitle(value = documentTitleInput.value) {
  const title = String(value || "").trim();
  return !title || title === DEFAULT_DOCUMENT_TITLE || title === ROOT_TOPIC_TEXT;
}

function projectDisplayTitle(data) {
  const title = String(data?.title || "").trim();
  const rootTitle = rootTitleFromNodes(data?.nodes || []);
  if (isDefaultBlankProject(data)) return rootTitle;
  return shouldUseRootTitle(title) ? rootTitle : title;
}

function syncDocumentTitleFromRoot({ force = false } = {}) {
  if (!documentTitleInput) return;
  if (!force && titleEditedByUser && !shouldUseRootTitle()) return;
  if (force || shouldUseRootTitle()) {
    documentTitleInput.value = rootTopicTitle();
  }
}

function currentMapSnapshot({ focusNodeId = selectedId } = {}) {
  return {
    data: normalizeProject(projectData()),
    localId: currentLocalId,
    workspaceFileName: currentWorkspaceFileName,
    workspaceModifiedAt: currentWorkspaceFileModifiedAt,
    workspaceFingerprint: currentWorkspaceFileFingerprint,
    selectedId: getNode(focusNodeId) ? focusNodeId : selectedId,
    selectedIds: getNode(focusNodeId) ? [focusNodeId] : [...selectedIds],
    zoom,
    pan: { ...pan },
  };
}

function restoreMapSnapshot(snapshot) {
  if (!snapshot?.data) return;
  currentWorkspaceFileName = snapshot.workspaceFileName || null;
  currentWorkspaceFileModifiedAt = snapshot.workspaceModifiedAt || 0;
  currentWorkspaceFileFingerprint = snapshot.workspaceFingerprint || "";
  workspaceConflictPaused = false;
  workspaceConflictFileName = null;
  if (localStorageAvailable()) {
    if (currentWorkspaceFileName) localStorage.setItem(WORKSPACE_CURRENT_FILE_KEY, currentWorkspaceFileName);
    else localStorage.removeItem(WORKSPACE_CURRENT_FILE_KEY);
  }
  applyProjectData(snapshot.data, {
    localId: snapshot.localId || currentLocalId,
    status: "已返回链接前位置",
    markDirty: false,
    selectedNodeId: snapshot.selectedId || "root",
    selectedNodeIds: snapshot.selectedIds || [snapshot.selectedId || "root"],
    view: {
      zoom: Number.isFinite(snapshot.zoom) ? snapshot.zoom : snapshot.data.view.zoom,
      pan: snapshot.pan || snapshot.data.view.pan,
    },
  });
  revealNodePath(snapshot.selectedId || "root");
  render();
  centerOnNode(snapshot.selectedId || "root");
  autosaveDirty = false;
}

function updateMapReturnButton() {
  if (!mapReturnButton) return;
  mapReturnButton.hidden = mapReturnStack.length === 0;
}

function isLinkedNode(node) {
  return Boolean(node?.mapLink?.fileName || node?.mapLink?.name || node?.mapLink?.fingerprint || node?.mapLink?.localId);
}

function branchRootFor(node) {
  if (!node || node.id === "root") return null;
  let current = node;
  let parent = getNode(current.parentId);
  while (parent && parent.id !== "root") {
    current = parent;
    parent = getNode(current.parentId);
  }
  return current;
}

function branchColorFor(node) {
  return branchRootFor(node)?.color || node?.color || palette[0];
}

function ensureBranchColors() {
  nodes.forEach((node) => {
    if (node.id === "root") return;
    node.color = branchColorFor(node);
  });
}

function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!match) return { r: 140, g: 168, b: 204 };
  const value = Number.parseInt(match[1], 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function contrastStrokeColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.72 ? "rgba(42, 77, 63, 0.38)" : "rgba(255, 255, 255, 0.78)";
}

function hasSearchMatch(text) {
  const query = searchState.query.trim();
  if (!query) return false;
  return searchText(text).includes(searchText(query));
}

function appendHighlightedText(container, text) {
  const value = String(text || "");
  const query = searchState.query.trim();
  if (!query || !hasSearchMatch(value)) {
    container.textContent = value;
    return;
  }

  const haystack = searchState.caseSensitive ? value : value.toLocaleLowerCase();
  const needle = searchState.caseSensitive ? query : query.toLocaleLowerCase();
  let cursor = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    if (index > cursor) container.append(document.createTextNode(value.slice(cursor, index)));
    const mark = document.createElement("mark");
    mark.className = "search-highlight";
    mark.textContent = value.slice(index, index + query.length);
    container.append(mark);
    cursor = index + query.length;
    index = haystack.indexOf(needle, cursor);
  }
  if (cursor < value.length) container.append(document.createTextNode(value.slice(cursor)));
}

function revealNodePath(id) {
  let parentId = getNode(id)?.parentId;
  while (parentId !== null && parentId !== undefined) {
    const parent = getNode(parentId);
    if (!parent) return;
    parent.collapsed = false;
    parentId = parent.parentId;
  }
}

function centerOnNode(id) {
  const node = getNode(id);
  if (!node) return;
  pan.x = -node.x * zoom;
  pan.y = -node.y * zoom;
  applyTransform();
}

function searchMaps() {
  const maps = [{
    id: currentLocalId,
    title: currentMapTitle(),
    nodes,
    current: true,
  }];

  if (searchState.scope !== "all" || !localStorageAvailable()) return maps;

  readActiveLocalIndex({ repair: true }).forEach((item) => {
    if (!item?.id || item.id === currentLocalId) return;
    const raw = localStorage.getItem(`${LOCAL_MAP_PREFIX}${item.id}`);
    if (!raw) return;
    try {
      const data = normalizeProject(JSON.parse(raw));
      maps.push({
        id: item.id,
        title: projectDisplayTitle(data) || item.title || DEFAULT_DOCUMENT_TITLE,
        nodes: data.nodes,
        current: false,
      });
    } catch {
      // Ignore damaged local maps in search instead of blocking the current page.
    }
  });
  return maps;
}

function updateSearchResults() {
  const query = searchState.query.trim();
  searchState.results = [];
  if (!query) {
    searchResults.hidden = true;
    render();
    return;
  }

  searchMaps().forEach((map) => {
    map.nodes.forEach((node) => {
      if (!hasSearchMatch(node.text)) return;
      searchState.results.push({
        key: `${map.id}:${node.id}`,
        mapId: map.id,
        mapTitle: map.title,
        nodeId: node.id,
        nodeText: node.text,
        current: map.current,
      });
    });
  });
  renderSearchResults();
  render();
}

function renderSearchResults() {
  const count = searchState.results.length;
  searchResults.replaceChildren();
  searchResults.hidden = false;

  const summary = document.createElement("div");
  summary.className = "search-summary";
  summary.textContent = `${searchState.scope === "all" ? "全部本地脑图" : "本页脑图"} · ${count} 个结果`;
  searchResults.append(summary);

  if (!count) {
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = "没有找到匹配主题";
    searchResults.append(empty);
    return;
  }

  searchState.results.slice(0, 80).forEach((result) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `search-result${searchState.active?.key === result.key ? " active" : ""}`;
    item.dataset.key = result.key;

    const topic = document.createElement("strong");
    topic.textContent = result.nodeText || NEW_TOPIC_TEXT;
    const map = document.createElement("span");
    map.textContent = result.mapTitle;
    const detail = document.createElement("small");
    detail.textContent = result.current ? "当前脑图" : "本地保存脑图";
    item.append(topic, map, detail);
    searchResults.append(item);
  });
}

function focusSearchMode() {
  searchState.jumpArmed = false;
  hintText.textContent = "查找模式";
  searchInput.focus({ preventScroll: true });
  searchInput.select();
  if (searchState.query.trim()) renderSearchResults();
}

async function jumpToSearchResult(key) {
  const result = searchState.results.find((item) => item.key === key);
  if (!result) return;
  if (result.mapId !== currentLocalId) {
    const opened = await openLocalMap(result.mapId, { keepHomeOpen: true });
    if (!opened) {
      showStatus("无法打开搜索结果所在的思维导图", 2200);
      return;
    }
  }
  const node = getNode(result.nodeId);
  if (!node) return;
  revealNodePath(result.nodeId);
  setSelection([result.nodeId], result.nodeId);
  searchState.active = { key: result.key, nodeId: result.nodeId, mapId: result.mapId };
  searchState.jumpArmed = true;
  render();
  centerOnNode(result.nodeId);
  hintText.textContent = "按任意键返回查找";
  renderSearchResults();
  searchResults.hidden = false;
  viewport.focus({ preventScroll: true });
}

function layoutMap() {
  const root = getNode("root");
  root.x = 0;
  root.y = 0;
  ensureBranchColors();
  const horizontalGap = 132;
  const branchGap = 64;
  const childGap = 48;
  const measureContext = document.createElement("canvas").getContext("2d");

  const estimateTextWidth = (text, font) => {
    measureContext.font = font;
    return measureContext.measureText(text).width;
  };

  const estimateLineCount = (node, maxTextWidth) => {
    const limits = nodeWidthLimits(node);
    const font = `${limits.fontWeight} ${limits.fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    return String(node.text || NEW_TOPIC_TEXT)
      .replace(/\r\n/g, "\n")
      .split("\n")
      .reduce((total, paragraph) => {
        const tokens = paragraph.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|\s+/gu) || [paragraph || ""];
        let line = "";
        let lines = 1;
        tokens.forEach((token) => {
          if (/^\s+$/.test(token) && !line) return;
          const candidate = line + token;
          if (line && estimateTextWidth(candidate, font) > maxTextWidth) {
            lines += 1;
            line = token.trimStart();
          } else {
            line = candidate;
          }
        });
        return total + lines;
      }, 0);
  };

  nodes.forEach((node) => resolveNodeWidth(node, measureContext));

  const nodeHeight = (node) => {
    const limits = nodeWidthLimits(node);
    const minHeight = node.id === "root" ? 86 : 56;
    const horizontalPadding = limits.padding;
    const imageHeaderHeight = nodeImages(node).length ? 34 : 0;
    const verticalPadding = (node.id === "root" ? 32 : 30) + imageHeaderHeight;
    const lineHeight = limits.fontSize * 1.42;
    const widthForWrap = clamp(node.width || limits.seed, limits.min, limits.max) - horizontalPadding;
    return Math.max(minHeight, estimateLineCount(node, widthForWrap) * lineHeight + verticalPadding);
  };

  const subtreeHeight = (node, gap = childGap) => {
    const children = visibleChildrenOf(node.id);
    const ownHeight = nodeHeight(node);
    if (!children.length) return ownHeight;
    const childrenHeight = children.reduce((sum, child) => sum + subtreeHeight(child, gap), 0) + gap * (children.length - 1);
    return Math.max(ownHeight, childrenHeight);
  };

  [-1, 1].forEach((side) => {
    const firstLevel = visibleChildrenOf("root").filter((node) => node.side === side);
    const totalHeight = firstLevel.reduce((sum, node) => sum + subtreeHeight(node, branchGap), 0)
      + branchGap * Math.max(0, firstLevel.length - 1);
    let cursor = -totalHeight / 2;

    const positionSubtree = (node, parent, top, height) => {
      const parentWidth = parent.width || defaultNodeWidth(parent);
      const nodeWidth = node.width || defaultNodeWidth(node);
      node.x = parent.x + side * (parentWidth / 2 + nodeWidth / 2 + horizontalGap);

      const children = visibleChildrenOf(node.id);
      if (!children.length) {
        node.y = top + height / 2;
        return;
      }

      const childrenTotalHeight = children.reduce((sum, child) => sum + subtreeHeight(child), 0)
        + childGap * (children.length - 1);
      let childTop = top + (height - childrenTotalHeight) / 2;
      children.forEach((child) => {
        child.side = side;
        const childHeight = subtreeHeight(child);
        positionSubtree(child, node, childTop, childHeight);
        childTop += childHeight + childGap;
      });
      node.y = children.reduce((sum, child) => sum + child.y, 0) / children.length;
    };

    firstLevel.forEach((node) => {
      const height = subtreeHeight(node, branchGap);
      positionSubtree(node, root, cursor, height);
      cursor += height + branchGap;
    });
  });
}

function applyTransform() {
  stage.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

function keepNodeVisible(id) {
  const element = nodesLayer.querySelector(`[data-id="${id}"]`);
  if (!element) return;
  const viewportRect = viewport.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const margin = 36;
  let deltaX = 0;
  if (rect.right > viewportRect.right - margin) {
    deltaX -= rect.right - (viewportRect.right - margin);
  }
  if (rect.left < viewportRect.left + margin) {
    deltaX += (viewportRect.left + margin) - rect.left;
  }
  if (!deltaX) return;
  pan.x += deltaX;
  applyTransform();
}

function render() {
  ensureVisibleSelection();
  layoutMap();
  nodesLayer.replaceChildren();

  visibleNodes().forEach((node) => {
    const element = document.createElement("div");
    const isSelected = selectedIds.has(node.id);
    const childCount = childrenOf(node.id).length;
    const searchHit = searchState.query.trim() && hasSearchMatch(node.text);
    const linked = isLinkedNode(node);
    const attachedImages = nodeImages(node);
    element.className = `topic-node${node.id === "root" ? " root" : ""}${isSelected ? " selected" : ""}${node.id === selectedId && isSelected ? " primary" : ""}${node.id === editingId ? " editing" : ""}${animatingNodeIds.has(node.id) ? " creating" : ""}${node.collapsed ? " collapsed" : ""}${searchHit ? " search-hit" : ""}${linked ? " linked" : ""}${attachedImages.length ? " has-image" : ""}`;
    element.dataset.id = node.id;
    element.style.left = `${node.x}px`;
    element.style.top = `${node.y}px`;
    element.style.width = `${node.width || defaultNodeWidth(node)}px`;
    element.style.background = node.color;
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", node.text);
    element.setAttribute("aria-selected", isSelected ? "true" : "false");
    if (linked) element.title = `Ctrl+点击打开：${node.mapLink.title || node.mapLink.name || node.mapLink.fileName}`;

    const label = document.createElement("span");
    label.className = "topic-label";
    label.contentEditable = node.id === editingId ? "true" : "false";
    label.spellcheck = false;
    appendTopicLabelContent(label, node, { editing: node.id === editingId });
    element.append(label);

    if (attachedImages.length) {
      const image = latestNodeImage(node);
      const imageBadge = document.createElement("button");
      imageBadge.type = "button";
      imageBadge.className = "node-image-badge";
      imageBadge.dataset.action = "view-node-image";
      imageBadge.dataset.id = node.id;
      imageBadge.dataset.imageIndex = String(attachedImages.length - 1);
      imageBadge.dataset.imagePath = image.src;
      imageBadge.title = attachedImages.length > 1
        ? `查看图片（${attachedImages.length} 张）· 拖动可移动`
        : "查看图片 · 拖动可移动";
      imageBadge.setAttribute("aria-label", imageBadge.title);
      const thumbnail = document.createElement("img");
      thumbnail.alt = image.name || "图片";
      thumbnail.dataset.imagePath = image.src;
      if (isInlineDocumentImageSource(image.src)) thumbnail.src = image.src;
      const fallback = document.createElement("span");
      fallback.setAttribute("aria-hidden", "true");
      imageBadge.append(thumbnail, fallback);
      element.append(imageBadge);
    }

    if (linked && node.id !== editingId) {
      const linkBadge = document.createElement("span");
      linkBadge.className = "map-link-badge";
      linkBadge.setAttribute("aria-hidden", "true");
      linkBadge.textContent = "↗";
      element.append(linkBadge);
    }

    if (isSelected && node.id === selectedId && node.id !== editingId) {
      const leftHandle = document.createElement("span");
      leftHandle.className = "resize-handle left";
      leftHandle.dataset.action = "resize";
      leftHandle.dataset.side = "left";
      leftHandle.dataset.id = node.id;
      leftHandle.setAttribute("aria-hidden", "true");
      const rightHandle = document.createElement("span");
      rightHandle.className = "resize-handle right";
      rightHandle.dataset.action = "resize";
      rightHandle.dataset.side = "right";
      rightHandle.dataset.id = node.id;
      rightHandle.setAttribute("aria-hidden", "true");
      element.append(leftHandle, rightHandle);
    }

    if (childCount && node.id !== editingId) {
      const fold = document.createElement("button");
      const direction = node.id === "root" ? 1 : node.side || 1;
      fold.type = "button";
      fold.className = "fold-toggle";
      fold.dataset.action = "toggle-fold";
      fold.dataset.id = node.id;
      fold.dataset.side = direction > 0 ? "right" : "left";
      fold.title = node.collapsed ? `展开 ${childCount} 个子主题` : "折叠子主题";
      fold.setAttribute("aria-label", fold.title);
      fold.setAttribute("aria-pressed", node.collapsed ? "true" : "false");
      fold.textContent = node.collapsed ? String(childCount) : "−";
      element.append(fold);
    }
    nodesLayer.append(element);
  });

  requestAnimationFrame(drawConnections);
  hydrateNodeImageBadges();
  applyTransform();
  pasteButton.disabled = !internalClipboard;

  if (editingId) {
    const label = nodesLayer.querySelector(`[data-id="${editingId}"] .topic-label`);
    if (label && document.activeElement !== label) {
      label.focus();
      const range = document.createRange();
      range.selectNodeContents(label);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    window.requestAnimationFrame(() => keepNodeVisible(editingId));
  }
}

function animateNewNode(id) {
  animatingNodeIds.add(id);
  window.setTimeout(() => {
    animatingNodeIds.delete(id);
    nodesLayer.querySelector(`[data-id="${id}"]`)?.classList.remove("creating");
  }, 520);
}

function drawConnections() {
  connections.replaceChildren();
  const visible = new Set(visibleNodes().map((node) => node.id));
  nodes.filter((node) => node.parentId && visible.has(node.id)).forEach((node) => {
    const parent = getNode(node.parentId);
    if (!parent || !visible.has(parent.id)) return;
    const direction = node.x >= parent.x ? 1 : -1;
    const parentWidth = nodesLayer.querySelector(`[data-id="${parent.id}"]`)?.offsetWidth || 170;
    const nodeWidth = nodesLayer.querySelector(`[data-id="${node.id}"]`)?.offsetWidth || 170;
    const startX = parent.x + direction * parentWidth / 2;
    const endX = node.x - direction * nodeWidth / 2;
    const bend = Math.max(44, Math.abs(endX - startX) * 0.52);

    const d = `M ${startX + 3000} ${parent.y + 3000} C ${startX + direction * bend + 3000} ${parent.y + 3000}, ${endX - direction * bend + 3000} ${node.y + 3000}, ${endX + 3000} ${node.y + 3000}`;
    const strokeColor = node.color === "#ffffff" ? "#8ea8cc" : node.color;
    const outline = document.createElementNS("http://www.w3.org/2000/svg", "path");
    outline.setAttribute("class", "connection-outline");
    outline.setAttribute("stroke", contrastStrokeColor(strokeColor));
    outline.setAttribute("d", d);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "connection");
    path.setAttribute("stroke", strokeColor);
    path.setAttribute("d", d);
    connections.append(outline, path);
  });
}

function selectNode(id) {
  if (!getNode(id)) return;
  selectedId = id;
  selectedIds = new Set([id]);
  editingId = null;
  hintText.textContent = "双击主题进行编辑";
  render();
  viewport.focus({ preventScroll: true });
}

function beginEditing(id = selectedId, selectAll = false) {
  const node = getNode(id);
  if (!node) return;
  setWorkspaceCollapsed(true);
  selectedId = id;
  selectedIds = new Set([id]);
  editingId = id;
  editSnapshot = { text: node.text, richText: node.richText };
  hintText.textContent = "Ctrl+Shift++ 上标 · Ctrl+Shift+- 下标 · Enter 完成";
  render();
  if (selectAll) {
    requestAnimationFrame(() => {
      const label = nodesLayer.querySelector(`[data-id="${id}"] .topic-label`);
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(label);
      selection.removeAllRanges();
      selection.addRange(range);
    });
  }
}

function syncEditingText() {
  if (!editingId) return;
  const node = getNode(editingId);
  const label = nodesLayer.querySelector(`[data-id="${editingId}"] .topic-label`);
  if (!node || !label) return;
  node.text = editableText(label) || defaultTopicText(node);
  node.richText = sanitizeTopicRichText(label.innerHTML, node.text) || undefined;
}

function editableText(label) {
  return (label.textContent || label.innerText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\u200b/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function appendSanitizedTopicNodes(source, target) {
  [...source.childNodes].forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      target.append(document.createTextNode((child.textContent || "").replace(/\u200b/g, "")));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const tag = child.tagName.toLowerCase();
    if (tag === "br") {
      target.append(document.createTextNode("\n"));
      return;
    }
    if (tag === "sup" || tag === "sub") {
      const formatted = document.createElement(tag);
      appendSanitizedTopicNodes(child, formatted);
      if (formatted.textContent) target.append(formatted);
      return;
    }
    const isBlock = tag === "div" || tag === "p";
    if (isBlock && target.textContent && !target.textContent.endsWith("\n")) {
      target.append(document.createTextNode("\n"));
    }
    appendSanitizedTopicNodes(child, target);
    if (isBlock && target.textContent && !target.textContent.endsWith("\n")) {
      target.append(document.createTextNode("\n"));
    }
  });
}

function sanitizeTopicRichText(value, expectedText) {
  if (typeof value !== "string" || !/<\/?(?:sup|sub)\b/i.test(value)) return "";
  const template = document.createElement("template");
  template.innerHTML = value.slice(0, 4000);
  const clean = document.createElement("span");
  appendSanitizedTopicNodes(template.content, clean);
  if (!clean.querySelector("sup, sub")) return "";
  if (editableText(clean) !== String(expectedText || "")) return "";
  const html = clean.innerHTML;
  return html.length <= 2000 ? html : "";
}

function appendTopicLabelContent(container, node, { editing = false } = {}) {
  if (!editing && searchState.query.trim() && hasSearchMatch(node.text)) {
    appendHighlightedText(container, node.text);
    return;
  }
  if (node.richText) {
    const template = document.createElement("template");
    template.innerHTML = node.richText;
    container.append(template.content.cloneNode(true));
    return;
  }
  container.textContent = node.text;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isSafeUrl(value) {
  try {
    const url = new URL(String(value).trim(), window.location.href);
    return ["http:", "https:", "mailto:", "tel:", "data:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function renderInlineMarkdown(value) {
  const source = escapeHtml(value);
  const linked = source.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, text, url) => {
    const decodedUrl = url.replace(/&amp;/g, "&");
    if (!isSafeUrl(decodedUrl)) return match;
    return `<a href="${escapeAttribute(decodedUrl)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });
  return linked.replace(/(^|[\s>])((?:https?:\/\/|mailto:)[^\s<]+)/g, (match, prefix, url) => {
    const cleanUrl = url.replace(/[.,;:!?)]$/, "");
    const suffix = url.slice(cleanUrl.length);
    if (!isSafeUrl(cleanUrl)) return match;
    return `${prefix}<a href="${escapeAttribute(cleanUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(cleanUrl)}</a>${escapeHtml(suffix)}`;
  });
}

function defaultNodeDocument(node) {
  return `# ${node?.text || defaultTopicText(node)}\n\n`;
}

function parseMarkdownImageLine(line) {
  const match = String(line || "").match(/^!\[([^\]]*)\]\(([^)]+)\)(?:\{([^}]+)\})?\s*$/);
  if (!match) return null;
  return {
    alt: match[1],
    src: match[2],
    dimensions: parseImageDimensions(match[3]),
  };
}

function parseImageDimensions(value) {
  const dimensions = {};
  String(value || "").replace(/(width|height)\s*=\s*(\d+)/gi, (_, key, amount) => {
    dimensions[key.toLowerCase()] = clamp(Number(amount), DOCUMENT_IMAGE_MIN_SIZE, DOCUMENT_IMAGE_MAX_SIZE);
    return "";
  });
  return dimensions;
}

function formatDocumentImageMarkdown(alt, src, dimensions = {}) {
  const safeAlt = String(alt || "image").replace(/[\r\n\]]/g, " ").trim() || "image";
  const safeSrc = String(src || "").replace(/[\r\n)]/g, "").trim();
  const width = Number(dimensions.width);
  const height = Number(dimensions.height);
  const attrs = [
    Number.isFinite(width) ? `width=${Math.round(clamp(width, DOCUMENT_IMAGE_MIN_SIZE, DOCUMENT_IMAGE_MAX_SIZE))}` : "",
    Number.isFinite(height) ? `height=${Math.round(clamp(height, DOCUMENT_IMAGE_MIN_SIZE, DOCUMENT_IMAGE_MAX_SIZE))}` : "",
  ].filter(Boolean).join(" ");
  return `![${safeAlt}](${safeSrc})${attrs ? `{${attrs}}` : ""}`;
}

function documentImageStyle(dimensions) {
  const style = [];
  if (Number.isFinite(dimensions.width)) style.push(`width:${Math.round(dimensions.width)}px`);
  if (Number.isFinite(dimensions.height)) {
    style.push(`height:${Math.round(dimensions.height)}px`);
    style.push("object-fit:contain");
  }
  return style.join(";");
}

function isInlineDocumentImageSource(src) {
  const value = String(src || "").trim();
  if (/^data:image\//i.test(value)) return true;
  if (/^blob:/i.test(value)) return true;
  if (/^https?:\/\//i.test(value)) return isSafeUrl(value);
  return false;
}

function renderMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const output = [];
  let paragraph = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${paragraph.join("<br>")}</p>`);
    paragraph = [];
  };

  lines.forEach((line, index) => {
    const image = parseMarkdownImageLine(line);
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (!line.trim()) {
      flushParagraph();
    } else if (image) {
      flushParagraph();
      const inlineSrc = isInlineDocumentImageSource(image.src);
      const imageSrc = inlineSrc ? image.src : "";
      const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"]
        .map((handle) => `<span class="image-resize-handle ${handle}" data-image-resize="${handle}" aria-hidden="true"></span>`)
        .join("");
      output.push(
        `<figure class="document-image" data-image-line="${index}" data-image-source="${escapeAttribute(image.src)}">` +
        `<img src="${escapeAttribute(imageSrc)}" data-image-path="${escapeAttribute(image.src)}" alt="${escapeAttribute(image.alt)}" style="${escapeAttribute(documentImageStyle(image.dimensions))}">` +
        `<span class="image-missing" hidden>图片文件无法读取</span>` +
        `<span class="image-resize-handles">${handles}</span>` +
        (image.alt ? `<figcaption>${escapeHtml(image.alt)}</figcaption>` : "") +
        `</figure>`
      );
    } else if (heading) {
      flushParagraph();
      const level = heading[1].length;
      output.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
    } else {
      paragraph.push(renderInlineMarkdown(line));
    }
  });
  flushParagraph();
  return output.join("") || "<p></p>";
}

function clearSelectedDocumentImage() {
  selectedDocumentImageLine = null;
  nodeDocumentPreview.querySelectorAll(".document-image.selected").forEach((item) => item.classList.remove("selected"));
}

function selectDocumentImage(figure) {
  nodeDocumentPreview.querySelectorAll(".document-image.selected").forEach((item) => item.classList.remove("selected"));
  figure.classList.add("selected");
  selectedDocumentImageLine = Number(figure.dataset.imageLine);
}

async function resolveDocumentImageUrl(src) {
  const value = String(src || "").trim();
  if (!value) return "";
  if (isInlineDocumentImageSource(value)) return value;
  if (documentImageObjectUrls.has(value)) return documentImageObjectUrls.get(value);
  if (!workspaceDirectoryHandle || !await hasWorkspacePermission("read")) return "";
  const handle = await getWorkspaceFileHandleByPath(value);
  if (!handle) return "";
  const file = await handle.getFile();
  const url = URL.createObjectURL(file);
  documentImageObjectUrls.set(value, url);
  return url;
}

async function hydrateMarkdownImages() {
  const token = ++documentImagePreviewToken;
  const images = [...nodeDocumentPreview.querySelectorAll("img[data-image-path]")];
  await Promise.all(images.map(async (image) => {
    const source = image.dataset.imagePath || "";
    if (isInlineDocumentImageSource(source)) return;
    const url = await resolveDocumentImageUrl(source);
    if (token !== documentImagePreviewToken || !image.isConnected) return;
    const figure = image.closest(".document-image");
    if (url) {
      image.src = url;
      image.hidden = false;
      figure?.querySelector(".image-missing")?.setAttribute("hidden", "");
    } else {
      image.removeAttribute("src");
      image.hidden = true;
      figure?.querySelector(".image-missing")?.removeAttribute("hidden");
    }
  }));
}

async function hydrateNodeImageBadges() {
  const token = ++nodeImagePreviewToken;
  const badges = [...nodesLayer.querySelectorAll(".node-image-badge")];
  await Promise.all(badges.map(async (badge) => {
    const source = badge.dataset.imagePath || "";
    const image = badge.querySelector("img");
    if (!image) return;
    const url = isInlineDocumentImageSource(source) ? source : await resolveDocumentImageUrl(source);
    if (token !== nodeImagePreviewToken || !badge.isConnected) return;
    if (url) {
      image.src = url;
      badge.classList.add("loaded");
    } else {
      image.removeAttribute("src");
      badge.classList.remove("loaded");
    }
  }));
}

function renderDocumentPreview(markdown) {
  nodeDocumentPreview.innerHTML = renderMarkdown(markdown);
  if (Number.isFinite(selectedDocumentImageLine)) {
    const selected = nodeDocumentPreview.querySelector(`.document-image[data-image-line="${selectedDocumentImageLine}"]`);
    if (selected) selected.classList.add("selected");
  }
  hydrateMarkdownImages();
}

function markdownLinksFromHtml(html) {
  if (!html) return "";
  const template = document.createElement("template");
  template.innerHTML = html;
  const links = [...template.content.querySelectorAll("a[href]")];
  if (!links.length) return "";
  return links
    .map((link) => {
      const href = link.href;
      const text = (link.textContent || href).replace(/\s+/g, " ").trim();
      if (!/^https?:\/\//i.test(href)) return "";
      return `[${text || href}](${href})`;
    })
    .filter(Boolean)
    .join("\n");
}

function normalizePastedDocumentText(event) {
  const htmlLinks = markdownLinksFromHtml(event.clipboardData?.getData("text/html"));
  if (htmlLinks) return htmlLinks;
  return event.clipboardData?.getData("text/plain") || "";
}

function linkAtDocumentPosition(position) {
  const value = nodeDocumentEditor.value;
  const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let match;
  while ((match = markdownLinkPattern.exec(value))) {
    if (position >= match.index && position <= match.index + match[0].length) return match[2];
  }

  const urlPattern = /https?:\/\/[^\s)]+/g;
  while ((match = urlPattern.exec(value))) {
    if (position >= match.index && position <= match.index + match[0].length) return match[0];
  }
  return "";
}

function syncActiveDocument({ markDirty = true } = {}) {
  if (!activeDocumentId) return;
  const node = getNode(activeDocumentId);
  if (!node) return;
  node.document = nodeDocumentEditor.value;
  renderDocumentPreview(node.document);
  if (markDirty) markSaving();
}

function openNodeDocument(id) {
  const node = getNode(id);
  if (!node) return;
  if (editingId) finishEditing();
  activeDocumentId = id;
  selectedId = id;
  selectedIds = new Set([id]);
  if (typeof node.document !== "string") node.document = defaultNodeDocument(node);
  nodeDocumentTitle.textContent = node.text || defaultTopicText(node);
  nodeDocumentEditor.value = node.document;
  selectedDocumentImageLine = null;
  renderDocumentPreview(node.document);
  nodeDocumentOverlay.hidden = false;
  render();
  nodeDocumentEditor.focus({ preventScroll: true });
}

function closeNodeDocument() {
  syncActiveDocument({ markDirty: false });
  activeDocumentId = null;
  clearSelectedDocumentImage();
  closeDocumentImageViewer();
  nodeDocumentOverlay.hidden = true;
  viewport.focus({ preventScroll: true });
}

function insertAtDocumentCursor(text) {
  const start = nodeDocumentEditor.selectionStart ?? nodeDocumentEditor.value.length;
  const end = nodeDocumentEditor.selectionEnd ?? start;
  const before = nodeDocumentEditor.value.slice(0, start);
  const after = nodeDocumentEditor.value.slice(end);
  nodeDocumentEditor.value = `${before}${text}${after}`;
  const caret = start + text.length;
  nodeDocumentEditor.setSelectionRange(caret, caret);
  syncActiveDocument();
}

function insertDocumentLink(url) {
  const start = nodeDocumentEditor.selectionStart ?? nodeDocumentEditor.value.length;
  const end = nodeDocumentEditor.selectionEnd ?? start;
  const selectedText = nodeDocumentEditor.value.slice(start, end).trim();
  if (selectedText && isSafeUrl(url)) {
    insertAtDocumentCursor(`[${selectedText}](${url.trim()})`);
    return true;
  }
  return false;
}

function pastedImageFile(event) {
  const files = [...(event.clipboardData?.files || [])];
  const file = files.find((item) => item.type?.startsWith("image/"));
  if (file) return file;
  const items = [...(event.clipboardData?.items || [])];
  const imageItem = items.find((item) => item.kind === "file" && item.type?.startsWith("image/"));
  return imageItem?.getAsFile?.() || null;
}

function normalizeNodeImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .map((image) => ({
      src: String(image?.src || "").slice(0, 320),
      name: String(image?.name || "image").slice(0, 120),
      createdAt: String(image?.createdAt || "").slice(0, 40),
    }))
    .filter((image) => image.src)
    .slice(0, 24);
}

function nodeImages(node) {
  return normalizeNodeImages(node?.images);
}

function latestNodeImage(node) {
  const images = nodeImages(node);
  return images.at(-1) || null;
}

async function openImageViewer(src, alt = "") {
  const url = await resolveDocumentImageUrl(src);
  if (!url) {
    showStatus("图片文件无法读取", 2200);
    return;
  }
  documentImageViewerImg.src = url;
  documentImageViewerImg.alt = alt || "";
  documentImageViewer.hidden = false;
  closeImageViewerButton.focus({ preventScroll: true });
}

function documentImageLine(lineIndex) {
  const lines = nodeDocumentEditor.value.replace(/\r\n/g, "\n").split("\n");
  const line = lines[lineIndex];
  const image = parseMarkdownImageLine(line);
  return image ? { lines, line, image } : null;
}

function updateDocumentImageLine(lineIndex, dimensions) {
  const data = documentImageLine(lineIndex);
  if (!data) return;
  const selectionStart = nodeDocumentEditor.selectionStart;
  const selectionEnd = nodeDocumentEditor.selectionEnd;
  data.lines[lineIndex] = formatDocumentImageMarkdown(data.image.alt, data.image.src, dimensions);
  nodeDocumentEditor.value = data.lines.join("\n");
  nodeDocumentEditor.setSelectionRange(selectionStart, selectionEnd);
  selectedDocumentImageLine = lineIndex;
  syncActiveDocument();
}

function imageResizeDimensions(mode, startWidth, startHeight, dx, dy) {
  let width = startWidth;
  let height = startHeight;
  if (mode.includes("e")) width = startWidth + dx;
  if (mode.includes("w")) width = startWidth - dx;
  if (mode.includes("s")) height = startHeight + dy;
  if (mode.includes("n")) height = startHeight - dy;

  const corner = mode.length === 2;
  if (corner) {
    const ratio = startWidth / Math.max(startHeight, 1);
    if (Math.abs(width - startWidth) >= Math.abs(height - startHeight)) {
      height = width / ratio;
    } else {
      width = height * ratio;
    }
  }

  return {
    width: Math.round(clamp(width, DOCUMENT_IMAGE_MIN_SIZE, DOCUMENT_IMAGE_MAX_SIZE)),
    height: Math.round(clamp(height, DOCUMENT_IMAGE_MIN_SIZE, DOCUMENT_IMAGE_MAX_SIZE)),
  };
}

function commitDocumentImageResize(state) {
  const existing = documentImageLine(state.lineIndex)?.image.dimensions || {};
  const dimensions = { ...existing };
  if (state.mode === "e" || state.mode === "w") {
    dimensions.width = state.current.width;
  } else if (state.mode === "n" || state.mode === "s") {
    dimensions.height = state.current.height;
  } else {
    dimensions.width = state.current.width;
    dimensions.height = state.current.height;
  }
  updateDocumentImageLine(state.lineIndex, dimensions);
}

async function openDocumentImageViewerFromImage(image) {
  const src = image?.dataset.imagePath || image?.getAttribute("src") || "";
  return openImageViewer(image?.currentSrc || src, image?.alt || "");
}

function closeDocumentImageViewer() {
  if (!documentImageViewer || documentImageViewer.hidden) return;
  documentImageViewer.hidden = true;
  documentImageViewerImg.removeAttribute("src");
  if (!nodeDocumentOverlay.hidden) nodeDocumentEditor.focus({ preventScroll: true });
}

function removeTrailingSpaceBeforeCaret() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || range.startContainer.nodeType !== Node.TEXT_NODE || range.startOffset < 1) return;
  const text = range.startContainer.textContent;
  if (text[range.startOffset - 1] !== " ") return;
  range.setStart(range.startContainer, range.startOffset - 1);
  range.deleteContents();
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertEditingLineBreak() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const lineBreak = document.createTextNode("\n\u200b");
  range.deleteContents();
  range.insertNode(lineBreak);
  range.setStart(lineBreak, lineBreak.textContent.length);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  syncEditingText();
  drawConnections();
  markSaving();
}

function closestTopicScript(node, label) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const script = element?.closest?.("sup, sub");
  return script && label.contains(script) ? script : null;
}

function topicRangeOffsets(label, range) {
  const before = range.cloneRange();
  before.selectNodeContents(label);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  return { start, end: start + range.toString().length };
}

function restoreTopicRange(label, offsets, selection) {
  const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;
  let startPoint = null;
  let endPoint = null;
  let node;
  while ((node = walker.nextNode())) {
    const nextOffset = currentOffset + node.textContent.length;
    if (!startPoint && offsets.start <= nextOffset) {
      startPoint = { node, offset: clamp(offsets.start - currentOffset, 0, node.textContent.length) };
    }
    if (!endPoint && offsets.end <= nextOffset) {
      endPoint = { node, offset: clamp(offsets.end - currentOffset, 0, node.textContent.length) };
      break;
    }
    currentOffset = nextOffset;
  }
  if (!startPoint || !endPoint) return false;
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function unwrapSelectedTopicScripts(label, range, selection, tag) {
  if (range.collapsed) return false;
  const scripts = [...label.querySelectorAll(tag)].filter((element) => {
    try {
      return range.intersectsNode(element);
    } catch {
      return false;
    }
  });
  if (!scripts.length) return false;
  const offsets = topicRangeOffsets(label, range);
  scripts.reverse().forEach((element) => element.replaceWith(...element.childNodes));
  label.normalize();
  restoreTopicRange(label, offsets, selection);
  return true;
}

function unwrapTopicScripts(container) {
  [...container.querySelectorAll("sup, sub")].reverse().forEach((element) => {
    element.replaceWith(...element.childNodes);
  });
}

function removeEmptyTopicScripts(label) {
  [...label.querySelectorAll("sup, sub")].forEach((element) => {
    if (!(element.textContent || "").replace(/\u200b/g, "")) element.remove();
  });
}

function toggleTopicScript(command) {
  if (!editingId) return;
  const label = nodesLayer.querySelector(`[data-id="${editingId}"] .topic-label`);
  if (!label) return;
  label.focus({ preventScroll: true });
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  let range = selection.getRangeAt(0);
  if (!label.contains(range.commonAncestorContainer)) return;
  const tag = command === "superscript" ? "sup" : "sub";
  const oppositeTag = tag === "sup" ? "sub" : "sup";
  const activeScript = closestTopicScript(selection.anchorNode, label);
  let active = false;

  if (!range.collapsed && unwrapSelectedTopicScripts(label, range, selection, tag)) {
    active = false;
  } else if (range.collapsed && activeScript?.tagName.toLowerCase() === tag) {
    range = document.createRange();
    range.setStartAfter(activeScript);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  } else {
    if (!range.collapsed && unwrapSelectedTopicScripts(label, range, selection, oppositeTag)) {
      range = selection.getRangeAt(0);
    }
    if (range.collapsed && activeScript) {
      range = document.createRange();
      range.setStartAfter(activeScript);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    const formatted = document.createElement(tag);
    if (range.collapsed) {
      const marker = document.createTextNode("\u200b");
      formatted.append(marker);
      range.insertNode(formatted);
      range.setStart(marker, marker.textContent.length);
      range.collapse(true);
    } else {
      const contents = range.extractContents();
      unwrapTopicScripts(contents);
      formatted.append(contents);
      range.insertNode(formatted);
      range.selectNodeContents(formatted);
    }
    selection.removeAllRanges();
    selection.addRange(range);
    active = true;
  }

  if (!active) removeEmptyTopicScripts(label);

  syncEditingText();
  syncEditingNodeWidth();
  drawConnections();
  markSaving();
  const labelText = command === "superscript" ? "上标" : "下标";
  showStatus(active ? `已启用${labelText}` : "已恢复普通文字", 1200);
}

function finishEditing() {
  if (!editingId) return;
  const finishedId = editingId;
  syncEditingText();
  const node = getNode(editingId);
  const previousText = editSnapshot?.text ?? node.text;
  const previousRichText = editSnapshot?.richText;
  if (node.text !== previousText || (node.richText || "") !== (previousRichText || "")) {
    history.push(nodes.map((item) => item.id === node.id ? { ...item, text: previousText, richText: previousRichText } : { ...item }));
    future = [];
    updateHistoryButtons();
    markSaving();
  }
  if (finishedId === "root") {
    syncDocumentTitleFromRoot();
  }
  editingId = null;
  editSnapshot = null;
  hintText.textContent = "双击主题进行编辑";
  render();
  if (nodeImagePastePendingIds.has(finishedId)) {
    nodeImagePastePendingIds.delete(finishedId);
    showStatus("图片已生成为链接，点击缩略图可查看原图", 2600);
  }
  viewport.focus({ preventScroll: true });
}

function chooseSide(parent) {
  if (parent.id !== "root") return parent.side || 1;
  const left = childrenOf("root").filter((node) => node.side === -1).length;
  const right = childrenOf("root").filter((node) => node.side === 1).length;
  return right <= left ? 1 : -1;
}

function addChild(parentId = selectedId, startEditing = true) {
  if (editingId) syncEditingText();
  const parent = getNode(parentId);
  if (!parent) return;
  pushHistory();
  parent.collapsed = false;
  const siblings = childrenOf(parentId);
  const side = chooseSide(parent);
  const id = `n${nodeCounter++}`;
  nodes.push({
    id,
    parentId,
    text: NEW_TOPIC_TEXT,
    side,
    color: parent.id === "root" ? palette[(siblings.length + (side === -1 ? 2 : 0)) % palette.length] : parent.color,
    collapsed: false,
    width: defaultNodeWidth(parent.id === "root" ? { id: "branch" } : parent),
    x: 0,
    y: 0,
  });
  selectedId = id;
  selectedIds = new Set([id]);
  editingId = null;
  animateNewNode(id);
  render();
  if (startEditing) beginEditing(id, true);
}

function addParent(childId = selectedId, startEditing = true) {
  if (editingId) syncEditingText();
  const child = getNode(childId);
  if (!child) return;
  if (child.parentId === null) {
    showStatus("中心主题不能再增加父主题", 1800);
    return;
  }
  const currentParent = getNode(child.parentId);
  if (!currentParent) return;
  pushHistory();
  const id = `n${nodeCounter++}`;
  const parentNode = {
    id,
    parentId: currentParent.id,
    text: NEW_TOPIC_TEXT,
    side: child.side || chooseSide(currentParent),
    color: child.color || currentParent.color,
    collapsed: false,
    width: defaultNodeWidth({ id: "branch" }),
    x: 0,
    y: 0,
  };
  const childIndex = nodes.findIndex((node) => node.id === child.id);
  nodes.splice(Math.max(0, childIndex), 0, parentNode);
  child.parentId = id;
  selectedId = id;
  selectedIds = new Set([id]);
  editingId = null;
  animateNewNode(id);
  render();
  if (startEditing) beginEditing(id, true);
}

function toggleFold(id) {
  const node = getNode(id);
  if (!node || !childrenOf(id).length) return;
  pushHistory();
  node.collapsed = !node.collapsed;
  if (node.collapsed) {
    const hidden = new Set(descendantsOf(id));
    if ([...selectedIds].some((selected) => hidden.has(selected))) {
      selectedId = id;
      selectedIds = new Set([id]);
      editingId = null;
    }
  }
  render();
  showStatus(node.collapsed ? `已折叠 ${childrenOf(id).length} 个子主题` : "已展开子主题");
}

function addSibling(id = selectedId, startEditing = true) {
  if (editingId) syncEditingText();
  const node = getNode(id);
  if (!node) return;
  if (node.parentId === null) {
    addChild(node.id, startEditing);
    return;
  }
  addChild(node.parentId, startEditing);
}

function deleteSelected() {
  const roots = selectionRootIds({ excludeRoot: true });
  if (!roots.length) return;
  const fallbackId = getNode(roots[0])?.parentId || "root";
  const removeIds = new Set(roots.flatMap((id) => [id, ...descendantsOf(id)]));
  const removeCount = removeIds.size;
  const riskyDelete = nodes.length >= 12 && removeCount >= Math.max(5, Math.ceil(nodes.length * 0.35));
  if (riskyDelete && !window.confirm(`将删除 ${removeCount} 个主题。\n\n这属于大规模删除。删除后可立即按 Ctrl+Z 撤销；保存前也会触发文件保护。确认继续吗？`)) {
    return;
  }
  pushHistory();
  selectedId = fallbackId;
  selectedIds = new Set([fallbackId]);
  editingId = null;
  nodes = nodes.filter((item) => !removeIds.has(item.id));
  render();
}

function copySelectedSubtree() {
  const rootIds = selectionRootIds();
  if (!rootIds.length) return;
  const copiedIds = new Set(rootIds.flatMap((id) => [id, ...descendantsOf(id)]));
  internalClipboard = {
    rootIds,
    nodes: cloneNodes(nodes.filter((node) => copiedIds.has(node.id))),
  };
  pasteButton.disabled = false;
  showStatus(`已复制 ${internalClipboard.nodes.length} 个主题`);
  viewport.focus({ preventScroll: true });
}

function pasteSubtree(targetId = selectedId) {
  const target = getNode(targetId);
  if (!target || !internalClipboard) return;
  pushHistory();
  const idMap = new Map();
  internalClipboard.nodes.forEach((node) => {
    idMap.set(node.id, `n${nodeCounter++}`);
  });
  const rootIdSet = new Set(internalClipboard.rootIds);
  const pastedNodes = internalClipboard.nodes.map((node) => ({
    ...node,
    id: idMap.get(node.id),
    parentId: rootIdSet.has(node.id) ? target.id : idMap.get(node.parentId),
    side: target.id === "root" ? chooseSide(target) : target.side || 1,
    x: 0,
    y: 0,
  }));
  target.collapsed = false;
  nodes.push(...pastedNodes);
  const newRootIds = internalClipboard.rootIds.map((id) => idMap.get(id));
  selectedId = newRootIds[0];
  selectedIds = new Set(newRootIds);
  editingId = null;
  render();
  showStatus(`已粘贴到“${target.text}”下`);
}

function navigate(direction) {
  const current = getNode(selectedId);
  if (!current) return;
  const vector = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  }[direction];
  if (!vector) return;

  const candidates = visibleNodes()
    .filter((node) => node.id !== current.id)
    .map((node) => {
      const dx = node.x - current.x;
      const dy = node.y - current.y;
      const forward = dx * vector[0] + dy * vector[1];
      const sideways = Math.abs(dx * vector[1] - dy * vector[0]);
      return { node, forward, score: forward + sideways * 2.4 };
    })
    .filter((item) => item.forward > 10)
    .sort((a, b) => a.score - b.score);

  if (candidates[0]) selectNode(candidates[0].node.id);
}

function undo() {
  if (editingId) finishEditing();
  if (!history.length) return;
  future.push(cloneNodes());
  nodes = history.pop();
  selectedId = getNode(selectedId) ? selectedId : "root";
  selectedIds = new Set([...selectedIds].filter((id) => getNode(id)));
  if (!selectedIds.size) selectedIds.add(selectedId);
  updateHistoryButtons();
  render();
  markSaving();
}

function redo() {
  if (!future.length) return;
  if (editingId) finishEditing();
  history.push(cloneNodes());
  nodes = future.pop();
  selectedId = getNode(selectedId) ? selectedId : "root";
  selectedIds = new Set([...selectedIds].filter((id) => getNode(id)));
  if (!selectedIds.size) selectedIds.add(selectedId);
  updateHistoryButtons();
  render();
  markSaving();
}

function setZoom(nextZoom) {
  zoom = clamp(nextZoom, ZOOM_MIN, ZOOM_MAX);
  applyTransform();
  markSaving();
}

function setZoomAt(nextZoom, clientX, clientY, { mark = true } = {}) {
  const next = clamp(nextZoom, ZOOM_MIN, ZOOM_MAX);
  if (next === zoom) return;
  const viewportRect = viewport.getBoundingClientRect();
  const centerX = viewportRect.left + viewportRect.width / 2;
  const centerY = viewportRect.top + viewportRect.height / 2;
  const worldX = (clientX - centerX - pan.x) / zoom;
  const worldY = (clientY - centerY - pan.y) / zoom;
  zoom = next;
  pan.x = clientX - centerX - worldX * zoom;
  pan.y = clientY - centerY - worldY * zoom;
  applyTransform();
  if (mark) markSaving();
  else autosaveDirty = true;
}

function fitCanvas() {
  pan = { x: 0, y: 0 };
  viewport.scrollLeft = 0;
  viewport.scrollTop = 0;
  const mapNodes = visibleNodes();
  const maxX = Math.max(...mapNodes.map((node) => Math.abs(node.x) + (node.width || defaultNodeWidth(node)) / 2), 0);
  const maxY = Math.max(...mapNodes.map((node) => Math.abs(node.y)), 0) + 70;
  const availableWidth = Math.max(320, viewport.clientWidth - 100);
  const availableHeight = Math.max(260, viewport.clientHeight - 100);
  setZoom(Math.min(1, availableWidth / (maxX * 2), availableHeight / (maxY * 2)));
}

function projectData() {
  if (editingId) syncEditingText();
  syncDocumentTitleFromRoot();
  return {
    format: "mindmap",
    version: 1,
    title: currentMapTitle(),
    imageFolder: currentMapImageFolder || undefined,
    savedAt: new Date().toISOString(),
    view: {
      zoom,
      pan: { ...pan },
    },
    nodes: nodes.map((node) => ({
      id: node.id,
      parentId: node.parentId,
      text: node.text,
      richText: typeof node.richText === "string" ? node.richText : undefined,
      side: node.side,
      color: node.color,
      collapsed: Boolean(node.collapsed),
      width: Number.isFinite(Number(node.width)) ? Number(node.width) : undefined,
      document: typeof node.document === "string" ? node.document : undefined,
      images: nodeImages(node).length ? nodeImages(node) : undefined,
      mapLink: isLinkedNode(node) ? {
        kind: "workspace-map",
        fileName: String(node.mapLink.fileName || node.mapLink.path || node.mapLink.name || "").slice(0, 260),
        name: String(node.mapLink.name || node.mapLink.title || node.mapLink.fileName || "").slice(0, 260),
        title: String(node.mapLink.title || node.mapLink.name || "").slice(0, 160),
        fingerprint: String(node.mapLink.fingerprint || "").slice(0, 80),
        localId: String(node.mapLink.localId || "").slice(0, 120),
        linkedAt: String(node.mapLink.linkedAt || "").slice(0, 40),
      } : undefined,
    })),
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashText(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function projectFingerprint(raw) {
  const data = normalizeProject(raw);
  return hashText(stableStringify({
    format: "mindmap",
    version: 1,
    localId: typeof raw?.localId === "string" ? raw.localId : "",
    title: data.title,
    imageFolder: data.imageFolder,
    view: data.view,
    nodes: data.nodes,
  }));
}

function clearWorkspaceFileIdentity() {
  currentWorkspaceFileName = null;
  currentWorkspaceFileModifiedAt = 0;
  currentWorkspaceFileFingerprint = "";
}

function localStorageAvailable() {
  try {
    const key = "__zhitu_storage_test__";
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function openWorkspaceDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      resolve(null);
      return;
    }
    const request = indexedDB.open(WORKSPACE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(WORKSPACE_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readWorkspaceHandle() {
  const db = await openWorkspaceDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const transaction = db.transaction(WORKSPACE_STORE_NAME, "readonly");
    const store = transaction.objectStore(WORKSPACE_STORE_NAME);
    const request = store.get(WORKSPACE_HANDLE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
}

async function writeWorkspaceHandle(handle) {
  const db = await openWorkspaceDb();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(WORKSPACE_STORE_NAME, "readwrite");
    transaction.objectStore(WORKSPACE_STORE_NAME).put(handle, WORKSPACE_HANDLE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function ensureWorkspacePermission(mode = "read") {
  if (!workspaceDirectoryHandle) return false;
  const options = { mode };
  if ((await workspaceDirectoryHandle.queryPermission(options)) === "granted") return true;
  return (await workspaceDirectoryHandle.requestPermission(options)) === "granted";
}

async function hasWorkspacePermission(mode = "read") {
  if (!workspaceDirectoryHandle) return false;
  return (await workspaceDirectoryHandle.queryPermission({ mode })) === "granted";
}

function supportsWorkspaceDirectoryAccess() {
  return Boolean(window.showDirectoryPicker && window.showOpenFilePicker && window.showSaveFilePicker);
}

function supportsSystemOpenPicker() {
  return Boolean(window.showOpenFilePicker);
}

function supportsSystemSavePicker() {
  return Boolean(window.showSaveFilePicker);
}

function runtimeSourceState() {
  if (window.location.protocol === "file:") {
    return {
      label: "文件直开",
      tone: "warn",
      detail: "当前从 file:// 打开；建议使用 http://127.0.0.1:4173/，避免和本地服务器形成两套浏览器状态。",
    };
  }
  if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") {
    return {
      label: "本地服务器",
      tone: "ok",
      detail: "",
    };
  }
  return {
    label: "网页模式",
    tone: window.isSecureContext ? "ok" : "warn",
    detail: window.isSecureContext ? "" : "当前不是安全上下文，部分文件夹能力可能不可用。",
  };
}

function setWorkspaceCapability(label, value, tone = "ok") {
  const item = document.createElement("span");
  item.className = `workspace-capability ${tone}`;
  item.title = `${label}：${value}`;
  const labelElement = document.createElement("b");
  labelElement.textContent = label;
  const valueElement = document.createElement("span");
  valueElement.textContent = value;
  item.append(labelElement, valueElement);
  return item;
}

function updateWorkspaceCapabilities() {
  if (!workspaceCapabilities) return;
  const folderSupported = supportsWorkspaceDirectoryAccess();
  const localSupported = localStorageAvailable();
  const pickerSupported = supportsSystemOpenPicker() || supportsSystemSavePicker();
  const runtime = runtimeSourceState();
  workspaceCapabilities.replaceChildren(
    setWorkspaceCapability(
      "运行方式",
      runtime.label,
      runtime.tone
    ),
    setWorkspaceCapability(
      "文件夹",
      workspaceDirectoryHandle ? "已连接" : folderSupported ? "可授权" : "不可用",
      workspaceDirectoryHandle ? "ok" : folderSupported ? "warn" : "off"
    ),
    setWorkspaceCapability(
      "本地备份",
      localSupported ? "可用" : "不可用",
      localSupported ? "ok" : "off"
    ),
    setWorkspaceCapability(
      "导入导出",
      pickerSupported ? "系统窗口" : "下载模式",
      pickerSupported ? "ok" : "warn"
    )
  );
}

function workspaceSaveSourceText() {
  const runtime = runtimeSourceState();
  if (workspaceDirectoryHandle) {
    const fileLabel = workspaceCurrentFileLabel();
    return fileLabel
      ? `保存到：${workspaceDirectoryHandle.name} / ${fileLabel}`
      : `保存到：${workspaceDirectoryHandle.name}`;
  }
  if (!localStorageAvailable()) {
    return "未启用自动保存，请导出 .mindmap.json";
  }
  if (runtime.label === "文件直开") {
    return "保存到：当前 file:// 浏览器本地（建议使用本地服务器）";
  }
  return "保存到：浏览器本地（选择文件夹可改为文件夹保存）";
}

function updateWorkspaceSourceNote() {
  if (!workspaceSourceNote) return;
  workspaceSourceNote.textContent = workspaceSaveSourceText();
  workspaceSourceNote.title = workspaceSourceNote.textContent;
}

function updateWorkspaceUi() {
  const savedName = localStorageAvailable() ? localStorage.getItem(WORKSPACE_NAME_KEY) : "";
  const supported = supportsWorkspaceDirectoryAccess();
  workspaceFolderName.textContent = workspaceDirectoryHandle?.name || savedName || (supported ? "未选择文件夹" : "浏览器本地");
  workspaceFolderName.title = workspaceFolderName.textContent;
  updateWorkspaceStatusText({ supported });
  updateWorkspaceCapabilities();
  updateWorkspaceSourceNote();
  const collapsed = localStorageAvailable() && localStorage.getItem(WORKSPACE_COLLAPSED_KEY) === "true";
  workspaceSidebar.classList.toggle("collapsed", collapsed);
  workspaceSidebar.classList.toggle("connected", Boolean(workspaceDirectoryHandle));
  workspaceSidebar.classList.toggle("unconfigured", !workspaceDirectoryHandle && supported);
  workspaceSidebar.classList.toggle("local-fallback", !workspaceDirectoryHandle && !supported);
  if (workspaceModeLabel) {
    workspaceModeLabel.textContent = workspaceDirectoryHandle ? "已连接" : supported ? "未设置" : "本地模式";
  }
  workspaceCollapseButton.title = collapsed ? "展开工作目录" : "收起工作目录";
  workspaceCollapseButton.setAttribute("aria-label", workspaceCollapseButton.title);
  chooseWorkspaceFolderButton.querySelector(".workspace-action-label").textContent = supported ? "选择文件夹" : "本地模式";
  chooseWorkspaceFolderButton.disabled = !supported;
  openWorkspaceFileButton.querySelector(".workspace-action-label").textContent = supported ? "打开文件" : "导入文件";
  const width = Number(localStorageAvailable() ? localStorage.getItem(WORKSPACE_WIDTH_KEY) : 0);
  if (Number.isFinite(width) && width >= 190 && width <= 420) {
    document.documentElement.style.setProperty("--workspace-sidebar-width", `${width}px`);
  }
  renderWorkspaceFiles();
}

function workspaceCurrentFileLabel() {
  if (!currentWorkspaceFileName) return "";
  const entry = workspaceFileByName(currentWorkspaceFileName);
  const displayName = entry ? workspaceEntryDisplayName(entry) : currentWorkspaceFileName.split("/").filter(Boolean).at(-1);
  return displayName || currentWorkspaceFileName;
}

function updateWorkspaceStatusText({ supported = supportsWorkspaceDirectoryAccess() } = {}) {
  if (!workspaceFolderStatus) return;
  const runtime = runtimeSourceState();
  if (workspaceDirectoryHandle) {
    const currentFile = workspaceCurrentFileLabel();
    workspaceFolderStatus.textContent = currentFile ? `当前：${currentFile}` : "打开与保存使用此文件夹";
    workspaceFolderStatus.title = workspaceFolderStatus.textContent;
    return;
  }
  if (runtime.detail) {
    workspaceFolderStatus.textContent = runtime.detail;
    workspaceFolderStatus.title = runtime.detail;
    return;
  }
  if (!supported) {
    workspaceFolderStatus.textContent = "此设备不支持文件夹授权，使用浏览器本地与导入/导出";
    workspaceFolderStatus.title = workspaceFolderStatus.textContent;
    return;
  }
  workspaceFolderStatus.textContent = "选择文件夹后，打开与保存使用同一位置";
  workspaceFolderStatus.title = workspaceFolderStatus.textContent;
}

function createWorkspaceFileAction(action, label, iconClass) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "workspace-file-action";
  button.dataset.action = action;
  button.title = label;
  button.setAttribute("aria-label", label);
  const icon = document.createElement("span");
  icon.className = iconClass;
  icon.setAttribute("aria-hidden", "true");
  button.append(icon);
  return button;
}

function renderWorkspaceEmptyState(title, detail, { actionText = "", action = "" } = {}) {
  const empty = document.createElement("div");
  empty.className = "workspace-file-empty";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const message = document.createElement("span");
  message.textContent = detail;
  empty.append(heading, message);
  if (actionText && action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "text-button";
    button.dataset.action = action;
    button.textContent = actionText;
    empty.append(button);
  }
  workspaceFileList.append(empty);
}

function setWorkspaceCollapsed(collapsed, { persist = true } = {}) {
  if (!workspaceSidebar || !workspaceCollapseButton) return;
  if (persist && localStorageAvailable()) {
    localStorage.setItem(WORKSPACE_COLLAPSED_KEY, String(collapsed));
  }
  workspaceSidebar.classList.toggle("collapsed", collapsed);
  workspaceCollapseButton.title = collapsed ? "展开工作目录" : "收起工作目录";
  workspaceCollapseButton.setAttribute("aria-label", workspaceCollapseButton.title);
}

function openWorkspacePanel() {
  setWorkspaceCollapsed(false);
  renderWorkspaceFiles();
  window.requestAnimationFrame(() => focusWorkspaceFileList());
  showStatus("已打开工作目录面板", 1200);
}

async function initializeWorkspaceDirectory() {
  updateWorkspaceUi();
  try {
    workspaceDirectoryHandle = await readWorkspaceHandle();
  } catch {
    workspaceDirectoryHandle = null;
  }
  updateWorkspaceUi();
  await refreshWorkspaceFiles();
  clearWorkspaceFileIdentity();
  workspaceConflictPaused = false;
  workspaceConflictFileName = null;
  if (localStorageAvailable()) localStorage.removeItem(WORKSPACE_CURRENT_FILE_KEY);
}

async function chooseWorkspaceDirectory() {
  if (!supportsWorkspaceDirectoryAccess()) {
    updateWorkspaceUi();
    showStatus("此设备不支持选择文件夹，请使用导入文件和导出保存", 2600);
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({
      id: "zhitu-working-directory",
      mode: "readwrite",
    });
    workspaceDirectoryHandle = handle;
    if (localStorageAvailable()) localStorage.setItem(WORKSPACE_NAME_KEY, handle.name);
    await writeWorkspaceHandle(handle);
    updateWorkspaceUi();
    await refreshWorkspaceFiles();
    showStatus("工作目录已设置");
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.error(error);
      showStatus("无法设置工作目录", 2200);
    }
  }
}

function isDedicatedMindmapFileName(name) {
  return String(name || "").toLocaleLowerCase().endsWith(".mindmap.json");
}

function isJsonFileName(name) {
  return String(name || "").toLocaleLowerCase().endsWith(".json");
}

function joinWorkspacePath(parentPath, name) {
  return parentPath ? `${parentPath}/${name}` : name;
}

function workspacePathDirectory(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function workspacePathFileName(path) {
  return String(path || "").split("/").filter(Boolean).at(-1) || "";
}

function pathDepth(path) {
  return String(path || "").split("/").filter(Boolean).length - 1;
}

function updateWorkspaceFileCount(count = 0) {
  if (!workspaceFileCount) return;
  workspaceFileCount.textContent = `${count} 个`;
}

function renderWorkspaceFiles() {
  if (!workspaceFileList) return;
  updateWorkspaceStatusText();
  updateWorkspaceSourceNote();
  workspaceFileList.replaceChildren();
  if (!workspaceDirectoryHandle) {
    if (!supportsWorkspaceDirectoryAccess()) {
      updateWorkspaceFileCount(localStorageAvailable() ? readActiveLocalIndex({ repair: true }).length : 0);
      renderBrowserLocalWorkspaceFiles();
      return;
    }
    updateWorkspaceFileCount(0);
    renderWorkspaceEmptyState(
      "未连接工作目录",
      "选择一个文件夹后，首页、自动保存、链接和文件列表会共用这个位置。",
      { actionText: "选择文件夹", action: "choose-workspace-folder" }
    );
    return;
  }
  updateWorkspaceFileCount(workspaceFiles.length);
  const visibleWorkspaceTree = workspaceTree.filter((entry) => hasLinkableWorkspaceFile(entry));
  if (!visibleWorkspaceTree.length) {
    renderWorkspaceEmptyState(
      "没有 mindmap 文件",
      "当前文件夹中暂时没有 .mindmap.json。编辑当前画布后会自动保存到这里。",
      { actionText: "刷新", action: "refresh-workspace-files" }
    );
    return;
  }

  const renderEntries = (entries, depth = 0) => {
    entries.forEach((entry) => {
      if (entry.kind === "directory") {
        if (!hasLinkableWorkspaceFile(entry)) return;
        const row = document.createElement("button");
        row.type = "button";
        row.className = "workspace-tree-row folder";
        row.dataset.action = "toggle-folder";
        row.dataset.dropFolder = entry.path;
        row.dataset.path = entry.path;
        row.style.setProperty("--tree-depth", depth);
        row.setAttribute("aria-expanded", String(expandedWorkspaceFolders.has(entry.path)));
        const chevron = document.createElement("span");
        chevron.className = "tree-chevron";
        chevron.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.className = "tree-label";
        label.textContent = entry.name;
        row.append(chevron, label);
        workspaceFileList.append(row);
        if (expandedWorkspaceFolders.has(entry.path)) renderEntries(entry.children, depth + 1);
        return;
      }

      const isCurrent = entry.path === currentWorkspaceFileName;
      const item = document.createElement("div");
      item.className = `workspace-tree-row file${isCurrent ? " current" : ""}`;
      item.dataset.name = entry.path;
      item.dataset.workspaceKind = "workspace";
      item.dataset.workspaceKey = `workspace:${entry.path}`;
      item.draggable = true;
      item.style.setProperty("--tree-depth", depth);
      const isSelected = item.dataset.workspaceKey === workspaceSelectedFileKey;
      item.classList.toggle("keyboard-selected", isSelected);
      item.setAttribute("aria-selected", String(isSelected));

      const name = document.createElement("button");
      name.type = "button";
      name.className = "workspace-file-name";
      name.dataset.action = "open";
      name.title = entry.path;
      name.textContent = workspaceEntryDisplayName(entry);

      const actions = document.createElement("div");
      actions.className = "workspace-file-actions";
      if (isCurrent) {
        const current = document.createElement("span");
        current.className = "workspace-current-badge";
        current.textContent = "当前";
        actions.append(current);
      }
      const displayName = workspaceEntryDisplayName(entry);
      const open = createWorkspaceFileAction("open", `打开 ${displayName}`, "workspace-open-icon");
      actions.append(open);
      item.append(name, actions);
      workspaceFileList.append(item);
    });
  };

  renderEntries(visibleWorkspaceTree);
}

async function refreshWorkspaceFiles() {
  workspaceFiles = [];
  workspaceHomeItems = [];
  workspaceTrashItems = [];
  workspaceTree = [];
  if (!workspaceDirectoryHandle) {
    renderWorkspaceFiles();
    renderHomeList();
    return;
  }
  try {
    if (!await ensureWorkspacePermission("read")) {
      renderWorkspaceFiles();
      showStatus("需要授权工作目录", 2200);
      return;
    }
    const scanDirectory = async (directoryHandle, parentPath = "") => {
      const entries = [];
      for await (const [name, handle] of directoryHandle.entries()) {
        const path = joinWorkspacePath(parentPath, name);
        if (handle.kind === "directory") {
          if (!parentPath && name === WORKSPACE_TRASH_DIR) continue;
          const directoryEntry = {
            kind: "directory",
            name,
            path,
            handle,
            children: await scanDirectory(handle, path),
          };
          entries.push(directoryEntry);
          continue;
        }
        if (!isJsonFileName(name)) continue;
        const item = { kind: "file", name, path, id: path, handle, title: name, updatedAt: "", nodeCount: 0, preview: ROOT_TOPIC_TEXT, fingerprint: "", localId: "" };
        try {
          const file = await handle.getFile();
          const raw = JSON.parse(await file.text());
          const data = normalizeProject(raw);
          item.title = projectDisplayTitle(data) || name;
          item.updatedAt = file.lastModified ? new Date(file.lastModified).toISOString() : new Date().toISOString();
          item.nodeCount = data.nodes.length;
          item.preview = data.nodes.find((node) => node.id === "root")?.text || ROOT_TOPIC_TEXT;
          item.fingerprint = projectFingerprint(raw);
          item.localId = typeof raw.localId === "string" ? raw.localId : "";
        } catch {
          if (!isDedicatedMindmapFileName(name)) continue;
          item.title = name;
        }
        workspaceFiles.push(item);
        workspaceHomeItems.push(item);
        entries.push(item);
      }
      entries.sort((a, b) => {
        const order = { directory: 0, file: 1 };
        if (a.kind !== b.kind) return (order[a.kind] ?? 9) - (order[b.kind] ?? 9);
        return a.name.localeCompare(b.name, "zh-CN", { numeric: true });
      });
      return entries;
    };

    workspaceTree = await scanDirectory(workspaceDirectoryHandle);
    workspaceTrashItems = await scanWorkspaceTrash();
    workspaceFiles.sort((a, b) => a.path.localeCompare(b.path, "zh-CN", { numeric: true }));
    workspaceHomeItems.sort((a, b) => {
      const time = new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
      return time || a.path.localeCompare(b.path, "zh-CN", { numeric: true });
    });
    workspaceTrashItems.sort((a, b) => {
      const time = new Date(b.deletedAt || 0).getTime() - new Date(a.deletedAt || 0).getTime();
      return time || a.name.localeCompare(b.name, "zh-CN", { numeric: true });
    });
    renderWorkspaceFiles();
    renderHomeList();
  } catch (error) {
    console.error(error);
    renderWorkspaceFiles();
    renderHomeList();
    showStatus("无法读取工作目录文件", 2200);
  }
}

function scheduleWorkspaceRefresh(delay = 300) {
  if (!workspaceDirectoryHandle) return;
  window.clearTimeout(workspaceRefreshTimer);
  workspaceRefreshTimer = window.setTimeout(() => refreshWorkspaceFiles(), delay);
}

function workspaceFileByName(name) {
  return workspaceFiles.find((file) => file.path === name || file.name === name);
}

function workspaceFileByLink(link) {
  if (!link) return null;
  const direct = workspaceFileByName(link.fileName || link.path || "");
  if (direct) return direct;
  const fingerprint = String(link.fingerprint || "").trim();
  if (fingerprint) {
    const matches = workspaceFiles.filter((file) => file.fingerprint === fingerprint);
    if (matches.length === 1) return matches[0];
  }
  const localId = String(link.localId || "").trim();
  if (localId) {
    const matches = workspaceFiles.filter((file) => file.localId === localId);
    if (matches.length === 1) return matches[0];
  }
  const displayName = String(link.title || link.name || "").trim();
  if (!displayName) return null;
  const matches = workspaceFiles.filter((file) => workspaceEntryDisplayName(file) === displayName || file.title === displayName);
  return matches.length === 1 ? matches[0] : null;
}

function workspaceEntryDisplayName(entry) {
  return entry?.title || entry?.preview || entry?.name || DEFAULT_DOCUMENT_TITLE;
}

function hasLinkableWorkspaceFile(entry) {
  if (entry?.kind === "file") return true;
  if (entry?.kind !== "directory") return false;
  return entry.children.some((child) => hasLinkableWorkspaceFile(child));
}

function renderBrowserLocalWorkspaceFiles() {
  const items = localStorageAvailable() ? readActiveLocalIndex({ repair: true }) : [];
  if (!items.length) {
    renderWorkspaceEmptyState(
      localStorageAvailable() ? "浏览器本地为空" : "无法使用本地存储",
      localStorageAvailable()
        ? "此设备不能直接授权文件夹。新建或导入 map 后，会先保存在这个浏览器里。"
        : "此设备无法访问文件夹，也不能写入浏览器存储。请使用导入和导出文件。",
      { actionText: localStorageAvailable() ? "导入文件" : "", action: localStorageAvailable() ? "open-file-picker" : "" }
    );
    return;
  }
  items.forEach((entry) => {
    const item = document.createElement("div");
    const isCurrent = entry.id === currentLocalId;
    item.className = `workspace-tree-row file local${isCurrent ? " current" : ""}`;
    item.dataset.localId = entry.id;
    item.dataset.workspaceKind = "local";
    item.dataset.workspaceKey = `local:${entry.id}`;
    item.style.setProperty("--tree-depth", 0);
    const isSelected = item.dataset.workspaceKey === workspaceSelectedFileKey;
    item.classList.toggle("keyboard-selected", isSelected);
    item.setAttribute("aria-selected", String(isSelected));

    const name = document.createElement("button");
    name.type = "button";
    name.className = "workspace-file-name";
    name.dataset.action = "open-local-workspace";
    name.textContent = entry.title || DEFAULT_DOCUMENT_TITLE;
    name.title = name.textContent;

    const actions = document.createElement("span");
    actions.className = "workspace-file-actions";
    if (isCurrent) {
      const current = document.createElement("span");
      current.className = "workspace-current-badge";
      current.textContent = "当前";
      actions.append(current);
    }
    const displayName = entry.title || DEFAULT_DOCUMENT_TITLE;
    const open = createWorkspaceFileAction("open-local-workspace", `打开 ${displayName}`, "workspace-open-icon");
    actions.append(open);
    item.append(name, actions);
    workspaceFileList.append(item);
  });
}

async function scanWorkspaceTrash() {
  if (!workspaceDirectoryHandle) return [];
  let trashDirectory;
  try {
    trashDirectory = await workspaceDirectoryHandle.getDirectoryHandle(WORKSPACE_TRASH_DIR);
  } catch {
    return [];
  }
  const items = [];
  for await (const [name, handle] of trashDirectory.entries()) {
    if (handle.kind !== "file" || !name.endsWith(".json")) continue;
    try {
      const file = await handle.getFile();
      const raw = JSON.parse(await file.text());
      if (raw?.format !== WORKSPACE_TRASH_FORMAT || raw?.version !== 1 || !raw?.data) continue;
      const data = normalizeProject(raw.data);
      items.push({
        id: name,
        name,
        path: `${WORKSPACE_TRASH_DIR}/${name}`,
        handle,
        title: projectDisplayTitle(data) || raw.title || DEFAULT_DOCUMENT_TITLE,
        deletedAt: raw.deletedAt || (file.lastModified ? new Date(file.lastModified).toISOString() : new Date().toISOString()),
        originalPath: raw.originalPath || raw.originalName || "",
        updatedAt: raw.updatedAt || raw.data?.savedAt || "",
        nodeCount: data.nodes.length,
        preview: data.nodes.find((node) => node.id === "root")?.text || ROOT_TOPIC_TEXT,
        data: raw.data,
      });
    } catch {
      // Ignore malformed trash entries instead of blocking the whole folder.
    }
  }
  return items;
}

function safeFileBaseName(value) {
  const cleaned = String(value || "mindmap")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "mindmap";
}

function defaultFileBaseName() {
  return safeFileBaseName(rootTopicTitle() || ROOT_TOPIC_TEXT);
}

async function uniqueWorkspaceFileName(baseName) {
  const base = safeFileBaseName(baseName);
  const existing = new Set(workspaceFiles.map((file) => file.path.toLocaleLowerCase()));
  let name = `${base}.mindmap.json`;
  let index = 2;
  while (existing.has(name.toLocaleLowerCase())) {
    name = `${base}-${index}.mindmap.json`;
    index += 1;
  }
  return name;
}

async function uniqueWorkspaceFilePath(baseName, directoryPath = "", ignorePath = "") {
  const base = safeFileBaseName(baseName);
  const directory = String(directoryPath || "").split("/").filter(Boolean).join("/");
  const prefix = directory ? `${directory}/` : "";
  const ignored = String(ignorePath || "").toLocaleLowerCase();
  const existing = new Set(
    workspaceFiles
      .map((file) => file.path.toLocaleLowerCase())
      .filter((path) => path !== ignored)
  );
  let name = `${base}.mindmap.json`;
  let index = 2;
  while (existing.has(`${prefix}${name}`.toLocaleLowerCase())) {
    name = `${base}-${index}.mindmap.json`;
    index += 1;
  }
  return `${prefix}${name}`;
}

async function uniqueDirectoryFileName(directoryHandle, baseName, extension = ".json") {
  const base = safeFileBaseName(baseName);
  let name = `${base}${extension}`;
  let index = 2;
  while (await workspaceFileExists(directoryHandle, name)) {
    name = `${base}-${index}${extension}`;
    index += 1;
  }
  return name;
}

async function getWorkspaceFileHandleByPath(path, { create = false } = {}) {
  if (!workspaceDirectoryHandle) return null;
  const parts = String(path || "").split("/").filter(Boolean);
  if (!parts.length) return null;
  let directory = workspaceDirectoryHandle;
  for (const folder of parts.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(folder, { create });
  }
  return directory.getFileHandle(parts.at(-1), { create });
}

async function getWorkspaceDirectoryHandleByPath(path, { create = false } = {}) {
  if (!workspaceDirectoryHandle) return null;
  const parts = String(path || "").split("/").filter(Boolean);
  let directory = workspaceDirectoryHandle;
  for (const folder of parts) {
    directory = await directory.getDirectoryHandle(folder, { create });
  }
  return directory;
}

function splitWorkspaceMapFileName(fileName) {
  const name = workspacePathFileName(fileName);
  if (name.toLocaleLowerCase().endsWith(".mindmap.json")) {
    return { base: name.slice(0, -".mindmap.json".length), extension: ".mindmap.json" };
  }
  if (name.toLocaleLowerCase().endsWith(".json")) {
    return { base: name.slice(0, -".json".length), extension: ".json" };
  }
  return { base: name || "mindmap", extension: ".mindmap.json" };
}

function imageExtensionForFile(file) {
  const fromName = String(file?.name || "").match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  if (fromName && /^(png|jpe?g|gif|webp|bmp|svg)$/.test(fromName)) return fromName === "jpeg" ? "jpg" : fromName;
  const fromType = String(file?.type || "").split("/").pop()?.toLowerCase();
  if (fromType && /^(png|jpe?g|gif|webp|bmp|svg\+xml)$/.test(fromType)) return fromType === "jpeg" ? "jpg" : fromType.replace("+xml", "");
  return "png";
}

function extensionForMimeType(type) {
  const value = String(type || "").toLowerCase();
  if (value.includes("jpeg")) return "jpg";
  if (value.includes("png")) return "png";
  if (value.includes("webp")) return "webp";
  if (value.includes("gif")) return "gif";
  if (value.includes("bmp")) return "bmp";
  return "png";
}

async function readClipboardImageFile() {
  if (!navigator.clipboard?.read) return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types?.find((type) => type.startsWith("image/"));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      return new File([blob], `pasted-image-${Date.now()}.${extensionForMimeType(imageType)}`, { type: imageType });
    }
  } catch {
    return null;
  }
  return null;
}

function safeImageFileBaseName(value) {
  return safeFileBaseName(String(value || "image").replace(/\.[^.]+$/, ""))
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, "_")
    .slice(0, 56) || "image";
}

function normalizeWorkspaceImageFolder(value) {
  const parts = String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length || parts.length > 12) return "";
  if (parts.some((part) => part === "." || part === ".." || part.length > 120 || /[<>:"|?*\x00-\x1f]/.test(part))) return "";
  return parts.join("/").slice(0, 600);
}

function workspaceImageFolderFromSource(source) {
  const value = String(source || "").trim().replace(/\\/g, "/");
  if (!value || isInlineDocumentImageSource(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) return "";
  const folder = normalizeWorkspaceImageFolder(workspacePathDirectory(value));
  return /_pictures$/i.test(workspacePathFileName(folder)) ? folder : "";
}

function inferProjectImageFolder(data, projectNodes = []) {
  const configured = normalizeWorkspaceImageFolder(data?.imageFolder);
  if (configured) return configured;
  const counts = new Map();
  const countSource = (source) => {
    const folder = workspaceImageFolderFromSource(source);
    if (folder) counts.set(folder, (counts.get(folder) || 0) + 1);
  };
  projectNodes.forEach((node) => {
    nodeImages(node).forEach((image) => countSource(image.src));
    String(node.document || "").split(/\r?\n/).forEach((line) => countSource(parseMarkdownImageLine(line)?.src));
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function defaultMapImageFolder() {
  if (currentWorkspaceFileName) {
    const directory = workspacePathDirectory(currentWorkspaceFileName);
    if (/_pictures$/i.test(workspacePathFileName(directory))) return directory;
    const { base } = splitWorkspaceMapFileName(currentWorkspaceFileName);
    return joinWorkspacePath(directory, `${safeFileBaseName(base)}_pictures`);
  }
  return `${safeFileBaseName(rootTopicTitle() || ROOT_TOPIC_TEXT)}_pictures`;
}

async function workspaceFileExists(directoryHandle, fileName) {
  try {
    await directoryHandle.getFileHandle(fileName);
    return true;
  } catch {
    return false;
  }
}

async function uniqueWorkspaceImageFileName(directoryHandle, baseName, extension) {
  let fileName = `${baseName}.${extension}`;
  let index = 2;
  while (await workspaceFileExists(directoryHandle, fileName)) {
    fileName = `${baseName}-${index}.${extension}`;
    index += 1;
  }
  return fileName;
}

async function ensureCurrentMapInImageFolder(folderPath) {
  const normalizedFolder = normalizeWorkspaceImageFolder(folderPath);
  if (!normalizedFolder) throw new Error("INVALID_IMAGE_FOLDER");
  if (currentWorkspaceFileName && workspacePathDirectory(currentWorkspaceFileName) === normalizedFolder) {
    return true;
  }

  if (!currentWorkspaceFileName) {
    const directory = await getWorkspaceDirectoryHandleByPath(normalizedFolder, { create: true });
    const fileName = await uniqueDirectoryFileName(directory, defaultFileBaseName(), ".mindmap.json");
    const targetPath = joinWorkspacePath(normalizedFolder, fileName);
    const data = projectData();
    data.localId = currentLocalId;
    data.imageFolder = normalizedFolder;
    let saved = false;
    try {
      saved = await writeWorkspaceProjectFile(targetPath, data);
    } catch (error) {
      if (currentWorkspaceFileName !== targetPath) {
        try {
          await removeWorkspaceFileByPath(targetPath);
        } catch {
          // The target may not have been created yet.
        }
      }
      throw error;
    }
    if (!saved) {
      try {
        await removeWorkspaceFileByPath(targetPath);
      } catch {
        // The target may not have been created yet.
      }
      throw new Error("MAP_FILE_MOVE_FAILED");
    }
    autosaveDirty = false;
    expandedWorkspaceFolders.add(normalizedFolder);
    await refreshWorkspaceFiles();
    return true;
  }

  if (!workspaceFileByName(currentWorkspaceFileName)) await refreshWorkspaceFiles();
  const moved = await moveWorkspaceMapFile(currentWorkspaceFileName, normalizedFolder);
  if (!moved) throw new Error("MAP_FILE_MOVE_FAILED");
  return true;
}

async function saveDocumentImageFile(file) {
  if (!file?.type?.startsWith("image/")) throw new Error("NOT_IMAGE");
  if (!workspaceDirectoryHandle) throw new Error("NO_WORKSPACE");
  if (!await ensureWorkspacePermission("readwrite")) throw new Error("NO_WORKSPACE_PERMISSION");
  if (!currentMapImageFolder) currentMapImageFolder = defaultMapImageFolder();
  const folderPath = normalizeWorkspaceImageFolder(currentMapImageFolder);
  if (!folderPath) throw new Error("INVALID_IMAGE_FOLDER");
  currentMapImageFolder = folderPath;
  const directory = await getWorkspaceDirectoryHandleByPath(folderPath, { create: true });
  await ensureCurrentMapInImageFolder(folderPath);
  const extension = imageExtensionForFile(file);
  const baseName = safeImageFileBaseName(file.name || `image-${Date.now()}`);
  const fileName = await uniqueWorkspaceImageFileName(directory, baseName, extension);
  const handle = await directory.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(file);
  await writable.close();
  return `${folderPath}/${fileName}`;
}

async function insertDocumentImageFile(file) {
  try {
    const src = await saveDocumentImageFile(file);
    const alt = safeFileBaseName(file.name || "image");
    insertAtDocumentCursor(`\n\n${formatDocumentImageMarkdown(alt, src, { width: 360 })}\n\n`);
    showStatus("图片已保存到工作目录");
  } catch (error) {
    console.error(error);
    if (error?.message === "NO_WORKSPACE") {
      showStatus("请先选择工作目录后再插入图片", 2600);
    } else if (error?.message === "NO_WORKSPACE_PERMISSION") {
      showStatus("需要授权工作目录写入权限", 2600);
    } else if (error?.message === "MAP_FILE_MOVE_FAILED") {
      showStatus("脑图文件未能安全移入图片文件夹，图片未添加", 3000);
    } else {
      showStatus("无法保存图片", 2200);
    }
  } finally {
    documentImageInput.value = "";
  }
}

async function attachImageToNode(file, nodeId = selectedId, { fromPaste = false } = {}) {
  const node = getNode(nodeId);
  if (!node) return false;
  try {
    const src = await saveDocumentImageFile(file);
    pushHistory();
    node.images = [
      ...nodeImages(node),
      {
        src,
        name: safeFileBaseName(file.name || "image"),
        createdAt: new Date().toISOString(),
      },
    ];
    selectedId = node.id;
    selectedIds = new Set([node.id]);
    render();
    markSaving();
    if (fromPaste) {
      nodeImagePastePendingIds.add(node.id);
      showStatus("图片已保存，按 Enter 完成后生成链接", 2600);
    } else {
      showStatus(`图片已添加到“${node.text || defaultTopicText(node)}”`);
    }
    return true;
  } catch (error) {
    console.error(error);
    if (error?.message === "NO_WORKSPACE") {
      showStatus("请先选择工作目录后再粘贴图片", 2600);
    } else if (error?.message === "NO_WORKSPACE_PERMISSION") {
      showStatus("需要授权工作目录写入权限", 2600);
    } else if (error?.message === "MAP_FILE_MOVE_FAILED") {
      showStatus("脑图文件未能安全移入图片文件夹，图片未添加", 3000);
    } else {
      showStatus("无法粘贴图片", 2200);
    }
    return false;
  }
}

async function openNodeImage(nodeId) {
  const node = getNode(nodeId);
  const image = latestNodeImage(node);
  if (!image) return;
  try {
    await openImageViewer(image.src, image.name || node?.text || "");
  } catch (error) {
    console.error(error);
    showStatus("图片文件无法读取", 2200);
  }
}

function removeNodeImage(nodeId, imageIndex) {
  const node = getNode(nodeId);
  const images = nodeImages(node);
  const index = clamp(Number(imageIndex), 0, Math.max(0, images.length - 1));
  const image = images[index];
  if (!node || !image) return false;
  const confirmed = window.confirm(
    `从“${node.text || defaultTopicText(node)}”移除图片“${image.name || "图片"}”吗？\n\n` +
    "原始图片文件会保留在工作目录中；移除后可按 Ctrl+Z 撤销。"
  );
  if (!confirmed) return false;
  pushHistory();
  images.splice(index, 1);
  node.images = images.length ? images : undefined;
  nodeImagePastePendingIds.delete(node.id);
  render();
  showStatus("图片已从主题移除，可按 Ctrl+Z 撤销", 2400);
  return true;
}

function moveNodeImage(sourceNodeId, imageIndex, targetNodeId) {
  const source = getNode(sourceNodeId);
  const target = getNode(targetNodeId);
  if (!source || !target || source.id === target.id) return false;
  const sourceImages = nodeImages(source);
  const index = clamp(Number(imageIndex), 0, Math.max(0, sourceImages.length - 1));
  const [image] = sourceImages.splice(index, 1);
  if (!image) return false;
  pushHistory();
  source.images = sourceImages.length ? sourceImages : undefined;
  target.images = [...nodeImages(target), image];
  nodeImagePastePendingIds.delete(source.id);
  selectedId = target.id;
  selectedIds = new Set([target.id]);
  render();
  showStatus(`图片已移动到“${target.text || defaultTopicText(target)}”`, 2200);
  return true;
}

function chooseNodeImage(nodeId = selectedId) {
  const node = getNode(nodeId);
  if (!node || !nodeImageInput) return;
  pendingNodeImageTargetId = node.id;
  nodeImageInput.click();
}

async function workspaceFileChangedExternally(handle, name) {
  if (!currentWorkspaceFileModifiedAt || name !== currentWorkspaceFileName) return false;
  const file = await handle.getFile();
  if (file.lastModified <= currentWorkspaceFileModifiedAt + 1200) return false;
  let externalFingerprint = "";
  try {
    externalFingerprint = projectFingerprint(JSON.parse(await file.text()));
  } catch {
    return {
      fileName: name,
      externalModifiedAt: file.lastModified,
      localKnownModifiedAt: currentWorkspaceFileModifiedAt,
      externalFingerprint: "",
      localKnownFingerprint: currentWorkspaceFileFingerprint,
      unreadable: true,
    };
  }
  if (currentWorkspaceFileFingerprint && externalFingerprint === currentWorkspaceFileFingerprint) {
    currentWorkspaceFileModifiedAt = file.lastModified || Date.now();
    showStatus("文件时间变化但内容一致，已自动同步", 1800);
    return false;
  }
  return {
    fileName: name,
    externalModifiedAt: file.lastModified,
    localKnownModifiedAt: currentWorkspaceFileModifiedAt,
    externalFingerprint,
    localKnownFingerprint: currentWorkspaceFileFingerprint,
  };
}

function workspaceConflictError(conflict) {
  const error = new Error("WORKSPACE_FILE_CONFLICT");
  error.fileName = conflict.fileName;
  error.externalModifiedAt = conflict.externalModifiedAt;
  error.localKnownModifiedAt = conflict.localKnownModifiedAt;
  error.externalFingerprint = conflict.externalFingerprint;
  error.localKnownFingerprint = conflict.localKnownFingerprint;
  error.unreadable = conflict.unreadable;
  return error;
}

function workspaceWriteRiskError(risk) {
  const error = new Error("WORKSPACE_WRITE_RISK");
  Object.assign(error, risk);
  return error;
}

function workspaceProjectSummary(raw) {
  try {
    if (!raw || raw.format !== "mindmap" || raw.version !== 1 || !Array.isArray(raw.nodes)) return null;
    return {
      localId: raw.localId || "",
      title: String(raw.title || "").trim(),
      rootText: String(raw.nodes.find((node) => node.id === "root")?.text || "").trim(),
      nodeCount: raw.nodes.length,
    };
  } catch {
    return null;
  }
}

async function workspaceWriteRisk(handle, name, nextData) {
  if (!handle || name !== currentWorkspaceFileName) return null;
  let file;
  let raw;
  try {
    file = await handle.getFile();
    raw = JSON.parse(await file.text());
  } catch {
    return null;
  }
  const previous = workspaceProjectSummary(raw);
  const next = workspaceProjectSummary(nextData);
  if (!previous || !next) return null;

  const nodeLoss = previous.nodeCount - next.nodeCount;
  const massDelete = previous.nodeCount >= 10 && nodeLoss >= Math.max(5, Math.ceil(previous.nodeCount * 0.35));
  const differentMap = Boolean(previous.localId && next.localId && previous.localId !== next.localId);
  if (!massDelete && !differentMap) return null;

  return {
    fileName: name,
    previousRaw: raw,
    previousModifiedAt: file.lastModified || 0,
    previous,
    next,
    massDelete,
    differentMap,
    nodeLoss,
  };
}

async function writeWorkspaceTrashBackup(name, raw, reason = "overwrite") {
  if (!workspaceDirectoryHandle || !raw) return null;
  const data = normalizeProject(raw);
  const displayTitle = projectDisplayTitle(data) || name;
  const trashDirectory = await workspaceDirectoryHandle.getDirectoryHandle(WORKSPACE_TRASH_DIR, { create: true });
  const trashName = await uniqueDirectoryFileName(
    trashDirectory,
    `${Date.now()} ${safeFileBaseName(displayTitle)} ${reason === "overwrite" ? "覆盖前备份" : "备份"}`,
    ".mindmap-trash.json"
  );
  const trashHandle = await trashDirectory.getFileHandle(trashName, { create: true });
  const payload = {
    format: WORKSPACE_TRASH_FORMAT,
    version: 1,
    deletedAt: new Date().toISOString(),
    originalPath: name,
    originalName: String(name || "").split("/").filter(Boolean).at(-1) || name,
    title: displayTitle || raw.title || DEFAULT_DOCUMENT_TITLE,
    updatedAt: raw.savedAt || "",
    reason,
    data: raw,
  };
  const writable = await trashHandle.createWritable();
  await writable.write(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }));
  await writable.close();
  return trashName;
}

async function writeWorkspaceProjectFile(name, data, { allowOverwrite = false } = {}) {
  if (!workspaceDirectoryHandle) return false;
  if (!await ensureWorkspacePermission("readwrite")) return false;
  const handle = await getWorkspaceFileHandleByPath(name, { create: true });
  const conflict = await workspaceFileChangedExternally(handle, name);
  if (conflict && !allowOverwrite) {
    workspaceConflictPaused = true;
    workspaceConflictFileName = name;
    throw workspaceConflictError(conflict);
  }
  const risk = await workspaceWriteRisk(handle, name, data);
  if (risk && !allowOverwrite) {
    workspaceConflictPaused = true;
    workspaceConflictFileName = name;
    throw workspaceWriteRiskError(risk);
  }
  if (risk && allowOverwrite) {
    await writeWorkspaceTrashBackup(name, risk.previousRaw, "overwrite");
  }
  const writable = await handle.createWritable();
  await writable.write(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }));
  await writable.close();
  currentWorkspaceFileName = name;
  currentWorkspaceFileModifiedAt = (await handle.getFile()).lastModified || Date.now();
  currentWorkspaceFileFingerprint = projectFingerprint(data);
  workspaceConflictPaused = false;
  workspaceConflictFileName = null;
  if (localStorageAvailable()) localStorage.setItem(WORKSPACE_CURRENT_FILE_KEY, name);
  return true;
}

async function removeWorkspaceFileByPath(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  if (!parts.length || !workspaceDirectoryHandle) return false;
  let directory = workspaceDirectoryHandle;
  for (const folder of parts.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(folder);
  }
  await directory.removeEntry(parts.at(-1));
  return true;
}

async function moveWorkspaceMapFile(sourcePath, targetDirectoryPath = "") {
  let sourceName = sourcePath;
  if (sourceName === currentWorkspaceFileName && autosaveDirty) {
    const saved = await autosaveLocal({ silent: false });
    if (!saved) return false;
    sourceName = currentWorkspaceFileName;
  }
  const sourceEntry = workspaceFileByName(sourceName);
  if (!workspaceDirectoryHandle || !sourceEntry) {
    showStatus("工作目录中找不到此文件", 2200);
    await refreshWorkspaceFiles();
    return false;
  }
  const normalizedTargetDirectory = String(targetDirectoryPath || "").split("/").filter(Boolean).join("/");
  const sourceDirectory = workspacePathDirectory(sourceEntry.path);
  if (sourceDirectory === normalizedTargetDirectory) {
    showStatus("文件已在此文件夹中", 1800);
    return false;
  }
  if (!await ensureWorkspacePermission("readwrite")) {
    showStatus("需要授权工作目录", 2200);
    return false;
  }
  try {
    const sourceFile = await sourceEntry.handle.getFile();
    const targetDirectory = await getWorkspaceDirectoryHandleByPath(normalizedTargetDirectory, { create: false });
    if (!targetDirectory) {
      showStatus("找不到目标文件夹", 2200);
      return false;
    }
    const { base, extension } = splitWorkspaceMapFileName(sourceEntry.name);
    const targetName = await uniqueDirectoryFileName(targetDirectory, base, extension);
    const targetHandle = await targetDirectory.getFileHandle(targetName, { create: true });
    const writable = await targetHandle.createWritable();
    await writable.write(await sourceFile.arrayBuffer());
    await writable.close();
    await removeWorkspaceFileByPath(sourceEntry.path);

    const targetPath = joinWorkspacePath(normalizedTargetDirectory, targetName);
    if (currentWorkspaceFileName === sourceEntry.path) {
      currentWorkspaceFileName = targetPath;
      currentWorkspaceFileModifiedAt = (await targetHandle.getFile()).lastModified || Date.now();
      if (localStorageAvailable()) localStorage.setItem(WORKSPACE_CURRENT_FILE_KEY, targetPath);
    }
    expandedWorkspaceFolders.add(normalizedTargetDirectory);
    await refreshWorkspaceFiles();
    showStatus(`已移动到 ${normalizedTargetDirectory || "工作目录"}`, 2200);
    return true;
  } catch (error) {
    console.error(error);
    showStatus("移动失败，原文件已保留", 2600);
    await refreshWorkspaceFiles();
    return false;
  }
}

async function workspaceSaveTargetName() {
  const base = defaultFileBaseName();
  if (!currentWorkspaceFileName) return uniqueWorkspaceFileName(base);
  const directory = workspacePathDirectory(currentWorkspaceFileName);
  const desiredLeaf = `${safeFileBaseName(base)}.mindmap.json`;
  if (workspacePathFileName(currentWorkspaceFileName).toLocaleLowerCase() === desiredLeaf.toLocaleLowerCase()) {
    return currentWorkspaceFileName;
  }
  return uniqueWorkspaceFilePath(base, directory, currentWorkspaceFileName);
}

async function writeWorkspaceProjectFileWithRename(data) {
  const previousName = currentWorkspaceFileName;
  const targetName = await workspaceSaveTargetName();
  if (previousName && targetName !== previousName) {
    const previousHandle = await getWorkspaceFileHandleByPath(previousName);
    const conflict = previousHandle ? await workspaceFileChangedExternally(previousHandle, previousName) : null;
    if (conflict) {
      workspaceConflictPaused = true;
      workspaceConflictFileName = previousName;
      throw workspaceConflictError(conflict);
    }
  }
  const saved = await writeWorkspaceProjectFile(targetName, data);
  if (saved && previousName && targetName !== previousName) {
    try {
      await removeWorkspaceFileByPath(previousName);
      showStatus(`已重命名为 ${workspacePathFileName(targetName)}`, 2200);
    } catch (error) {
      console.error(error);
      showStatus("已保存新文件名，旧文件未能自动删除", 3200);
    }
  }
  return saved;
}

function formatConflictTime(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function showWorkspaceConflictDialog(error) {
  workspaceConflictPaused = true;
  workspaceConflictFileName = error?.fileName || currentWorkspaceFileName;
  if (!workspaceConflictOverlay || !workspaceConflictMessage) return;
  if (error?.message === "WORKSPACE_WRITE_RISK") {
    const reasons = [
      error.differentMap ? "将用另一个思维导图的内容覆盖当前文件" : "",
      error.massDelete ? `将减少 ${error.nodeLoss} 个主题` : "",
    ].filter(Boolean).join("；");
    workspaceConflictMessage.textContent =
      `“${workspaceConflictFileName || "当前文件"}”即将发生高风险保存：${reasons || "内容变化较大"}。` +
      "自动保存已暂停。你可以先按 Ctrl+Z 撤销，或另存为副本；如果选择覆盖，旧版本会先备份到垃圾桶。";
  } else {
    const reason = error?.unreadable
      ? "磁盘上的文件暂时无法读取为 Mindmap 工程。"
      : "磁盘上的文件内容确实和当前打开时不同。";
    workspaceConflictMessage.textContent =
      `“${workspaceConflictFileName || "当前文件"}”在你打开后发生变化。${reason}` +
      `外部修改时间：${formatConflictTime(error?.externalModifiedAt)}。` +
      "自动保存已暂停，避免覆盖那个版本。";
  }
  workspaceConflictOverlay.hidden = false;
  conflictSaveCopyButton?.focus({ preventScroll: true });
}

function hideWorkspaceConflictDialog() {
  if (workspaceConflictOverlay) workspaceConflictOverlay.hidden = true;
  viewport.focus({ preventScroll: true });
}

async function overwriteWorkspaceConflict() {
  if (!workspaceConflictFileName) return;
  try {
    const data = projectData();
    data.localId = currentLocalId;
    const saved = await writeWorkspaceProjectFile(workspaceConflictFileName, data, { allowOverwrite: true });
    if (!saved) return;
    autosaveDirty = false;
    hideWorkspaceConflictDialog();
    await refreshWorkspaceFiles();
    showStatus("已覆盖保存当前版本");
  } catch (error) {
    console.error(error);
    showStatus("覆盖保存失败", 2200);
  }
}

async function saveWorkspaceConflictCopy() {
  try {
    const data = projectData();
    data.localId = currentLocalId;
    const base = `${defaultFileBaseName()} 副本`;
    const copyName = await uniqueWorkspaceFileName(base);
    const saved = await writeWorkspaceProjectFile(copyName, data, { allowOverwrite: false });
    if (!saved) return;
    autosaveDirty = false;
    hideWorkspaceConflictDialog();
    await refreshWorkspaceFiles();
    showStatus(`已另存为 ${copyName}`, 2600);
  } catch (error) {
    console.error(error);
    showStatus("另存副本失败", 2200);
  }
}

async function reloadWorkspaceConflictFile() {
  const fileName = workspaceConflictFileName || currentWorkspaceFileName;
  if (!fileName) return;
  hideWorkspaceConflictDialog();
  workspaceConflictPaused = false;
  workspaceConflictFileName = null;
  await openWorkspaceMapFile(fileName, { restore: true });
}

async function autosaveWorkspace({ silent = true } = {}) {
  if (!workspaceDirectoryHandle) return autosaveLocalStorage({ silent });
  if (workspaceConflictPaused && currentWorkspaceFileName) {
    autosaveDirty = true;
    document.querySelector(".save-state").textContent = "检测到文件冲突，已暂停自动保存";
    if (!silent) {
      showWorkspaceConflictDialog({
        fileName: workspaceConflictFileName || currentWorkspaceFileName,
      });
    }
    return false;
  }
  if (autosaveWorkspacePromise) {
    autosaveWorkspaceQueued = true;
    return autosaveWorkspacePromise;
  }
  autosaveWorkspacePromise = (async () => {
    try {
      const data = projectData();
      data.localId = currentLocalId;
      const saved = await writeWorkspaceProjectFileWithRename(data);
      if (!saved) return autosaveLocalStorage({ silent });
      autosaveDirty = false;
      window.clearTimeout(markSaving.timer);
      document.querySelector(".save-state").textContent = silent ? "工作目录已自动保存" : "工作目录已保存";
      await refreshWorkspaceFiles();
      return true;
    } catch (error) {
      if (error?.message === "WORKSPACE_FILE_CONFLICT" || error?.message === "WORKSPACE_WRITE_RISK") {
        autosaveDirty = true;
        window.clearTimeout(markSaving.timer);
        document.querySelector(".save-state").textContent = error.message === "WORKSPACE_WRITE_RISK"
          ? "检测到高风险保存，已暂停自动保存"
          : "检测到文件冲突，已暂停自动保存";
        showWorkspaceConflictDialog(error);
        return false;
      }
      console.error(error);
      if (!silent) showStatus("工作目录自动保存失败", 2200);
      return autosaveLocalStorage({ silent });
    } finally {
      autosaveWorkspacePromise = null;
      if (autosaveWorkspaceQueued) {
        autosaveWorkspaceQueued = false;
        autosaveWorkspace({ silent: true });
      }
    }
  })();
  return autosaveWorkspacePromise;
}

async function openWorkspaceMapFile(name, { fromLinkNodeId = null, restore = false } = {}) {
  if (!restore && currentWorkspaceFileName && currentWorkspaceFileName !== name && autosaveDirty) {
    const saved = await autosaveLocal({ silent: false });
    if (!saved) {
      showStatus("当前文件未安全保存，已取消跳转", 2600);
      return false;
    }
  }
  let entry = workspaceFileByName(name);
  if (!entry) {
    await refreshWorkspaceFiles();
    entry = workspaceFileByName(name);
  }
  if (!entry) {
    showStatus("工作目录中找不到链接文件", 2400);
    return false;
  }
  try {
    if (fromLinkNodeId) mapReturnStack.push(currentMapSnapshot({ focusNodeId: fromLinkNodeId }));
    const file = await entry.handle.getFile();
    const opened = await openProject(file, {
      status: restore ? "已恢复工作目录文件" : fromLinkNodeId ? `已打开链接：${name}` : "工作目录文件已打开",
      keepReturnStack: Boolean(fromLinkNodeId),
      workspaceFileName: name,
      workspaceModifiedAt: file.lastModified || 0,
      markDirty: false,
    });
    if (!opened && fromLinkNodeId) mapReturnStack.pop();
    updateMapReturnButton();
    return opened;
  } catch (error) {
    if (fromLinkNodeId) mapReturnStack.pop();
    console.error(error);
    showStatus("无法打开此链接文件", 2200);
    updateMapReturnButton();
    return false;
  }
}

async function workspaceMapLinkForEntry(entry) {
  const file = await entry.handle.getFile();
  const raw = JSON.parse(await file.text());
  const data = normalizeProject(raw);
  return {
    kind: "workspace-map",
    fileName: entry.path,
    name: workspaceEntryDisplayName(entry),
    title: projectDisplayTitle(data) || workspaceEntryDisplayName(entry),
    fingerprint: projectFingerprint(raw),
    localId: typeof raw.localId === "string" ? raw.localId : "",
    linkedAt: new Date().toISOString(),
  };
}

async function linkSelectedNodeToWorkspaceFile(name) {
  const node = getNode(selectedId);
  if (!node) return;
  const entry = workspaceFileByName(name);
  if (!entry) {
    showStatus("找不到可链接的 map 文件", 2200);
    return;
  }
  let link;
  try {
    link = await workspaceMapLinkForEntry(entry);
  } catch (error) {
    console.error(error);
    showStatus("无法读取链接目标", 2200);
    return;
  }
  pushHistory();
  node.mapLink = link;
  render();
  showStatus(`已将“${node.text || defaultTopicText(node)}”链接到 ${link.name}`, 2200);
}

function ensureNodeLinkMenu() {
  if (nodeLinkMenu) return nodeLinkMenu;
  nodeLinkMenu = document.createElement("div");
  nodeLinkMenu.className = "node-link-menu";
  nodeLinkMenu.hidden = true;
  document.body.append(nodeLinkMenu);
  return nodeLinkMenu;
}

function hideNodeLinkMenu() {
  if (nodeLinkMenu) nodeLinkMenu.hidden = true;
}

function renderNodeLinkMenu(nodeId, { showFiles = false } = {}) {
  const menu = ensureNodeLinkMenu();
  const node = getNode(nodeId);
  menu.replaceChildren();
  if (!node) return;

  const title = document.createElement("div");
  title.className = "node-link-menu-title";
  title.textContent = `“${node.text || defaultTopicText(node)}”`;
  menu.append(title);

  const insertImage = document.createElement("button");
  insertImage.type = "button";
  insertImage.className = "node-link-menu-item";
  insertImage.dataset.action = "insert-node-image";
  insertImage.dataset.nodeId = nodeId;
  insertImage.textContent = "插入图片";
  const openDocument = document.createElement("button");
  openDocument.type = "button";
  openDocument.className = "node-link-menu-item";
  openDocument.dataset.action = "open-document";
  openDocument.dataset.nodeId = nodeId;
  openDocument.textContent = "打开文档";
  const showFilesButton = document.createElement("button");
  showFilesButton.type = "button";
  showFilesButton.className = "node-link-menu-item";
  showFilesButton.dataset.action = "show-link-files";
  showFilesButton.dataset.nodeId = nodeId;
  showFilesButton.textContent = "链接到思维导图";
  menu.append(insertImage, openDocument, showFilesButton);

  if (isLinkedNode(node)) {
    const linkedEntry = workspaceFileByLink(node.mapLink);
    const linkedDisplayName = workspaceEntryDisplayName(linkedEntry) || node.mapLink.title || node.mapLink.name || node.mapLink.fileName;
    const current = document.createElement("button");
    current.type = "button";
    current.className = "node-link-menu-item";
    current.dataset.action = "open-linked";
    current.dataset.nodeId = nodeId;
    current.textContent = `打开当前链接：${linkedDisplayName}`;
    const unlink = document.createElement("button");
    unlink.type = "button";
    unlink.className = "node-link-menu-item danger";
    unlink.dataset.action = "unlink";
    unlink.dataset.nodeId = nodeId;
    unlink.textContent = "取消此链接";
    menu.append(current, unlink);
  }

  const divider = document.createElement("div");
  divider.className = "node-link-menu-divider";
  menu.append(divider);

  if (!showFiles) {
    const hint = document.createElement("div");
    hint.className = "node-link-menu-empty";
    hint.textContent = "选择一个操作。文件列表只在链接思维导图时展开。";
    menu.append(hint);
    return;
  }

  if (!workspaceTree.length) {
    const empty = document.createElement("div");
    empty.className = "node-link-menu-empty";
    empty.textContent = workspaceDirectoryHandle ? "工作目录没有可链接的 map 文件" : "请先选择工作目录";
    menu.append(empty);
  } else {
    const renderEntries = (entries, depth = 0) => {
      entries.forEach((entry) => {
        if (entry.kind === "directory") {
          if (!hasLinkableWorkspaceFile(entry)) return;
          const folder = document.createElement("button");
          folder.type = "button";
          folder.className = "node-link-menu-item folder";
          folder.dataset.action = "toggle-link-folder";
          folder.dataset.nodeId = nodeId;
          folder.dataset.path = entry.path;
          folder.style.setProperty("--tree-depth", depth);
          folder.setAttribute("aria-expanded", String(expandedWorkspaceFolders.has(entry.path)));
          folder.textContent = entry.name;
          menu.append(folder);
          if (expandedWorkspaceFolders.has(entry.path)) renderEntries(entry.children, depth + 1);
          return;
        }
        if (entry.kind !== "file") return;
        const item = document.createElement("button");
        item.type = "button";
        item.className = "node-link-menu-item";
        item.dataset.action = "link-file";
        item.dataset.nodeId = nodeId;
        item.dataset.name = entry.path;
        item.style.setProperty("--tree-depth", depth);
        item.textContent = workspaceEntryDisplayName(entry);
        item.title = entry.path;
        menu.append(item);
      });
    };
    const linkableTree = workspaceTree.filter((entry) => hasLinkableWorkspaceFile(entry));
    if (linkableTree.length) renderEntries(linkableTree);
    else {
      const empty = document.createElement("div");
      empty.className = "node-link-menu-empty";
      empty.textContent = "工作目录没有可链接的 map 文件";
      menu.append(empty);
    }
  }

  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "node-link-menu-item subtle";
  refresh.dataset.action = "refresh-files";
  refresh.dataset.nodeId = nodeId;
  refresh.textContent = "刷新工作目录文件";
  menu.append(refresh);
}

function renderNodeImageMenu(nodeId, imageIndex) {
  const menu = ensureNodeLinkMenu();
  const node = getNode(nodeId);
  const images = nodeImages(node);
  const index = clamp(Number(imageIndex), 0, Math.max(0, images.length - 1));
  const image = images[index];
  menu.replaceChildren();
  if (!node || !image) return false;

  const title = document.createElement("div");
  title.className = "node-link-menu-title";
  title.textContent = image.name || "图片";
  const view = document.createElement("button");
  view.type = "button";
  view.className = "node-link-menu-item";
  view.dataset.action = "view-node-image";
  view.dataset.nodeId = nodeId;
  view.textContent = "查看原图";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "node-link-menu-item danger";
  remove.dataset.action = "remove-node-image";
  remove.dataset.nodeId = nodeId;
  remove.dataset.imageIndex = String(index);
  remove.textContent = "删除图片";
  const hint = document.createElement("div");
  hint.className = "node-link-menu-empty";
  hint.textContent = "删除只移除当前主题中的图片链接，原始文件会保留。";
  menu.append(title, view, remove, hint);
  return true;
}

function positionNodeMenu(menu, x, y) {
  const menuWidth = 260;
  const menuHeight = Math.min(menu.scrollHeight || 220, window.innerHeight - 24);
  menu.style.left = `${clamp(x, 12, window.innerWidth - menuWidth - 12)}px`;
  menu.style.top = `${clamp(y, 12, window.innerHeight - menuHeight - 12)}px`;
}

async function showNodeLinkMenu(nodeId, x, y) {
  if (!workspaceFiles.length && workspaceDirectoryHandle) await refreshWorkspaceFiles();
  renderNodeLinkMenu(nodeId);
  const menu = ensureNodeLinkMenu();
  menu.hidden = false;
  positionNodeMenu(menu, x, y);
}

function showNodeImageMenu(nodeId, imageIndex, x, y) {
  const menu = ensureNodeLinkMenu();
  if (!renderNodeImageMenu(nodeId, imageIndex)) return;
  menu.hidden = false;
  positionNodeMenu(menu, x, y);
}

function unlinkNodeMap(nodeId) {
  const node = getNode(nodeId);
  if (!node?.mapLink) return;
  pushHistory();
  delete node.mapLink;
  render();
  showStatus("已取消链接");
}

async function followNodeMapLink(id) {
  const node = getNode(id);
  if (!isLinkedNode(node)) return false;
  if (!workspaceFiles.length && workspaceDirectoryHandle) await refreshWorkspaceFiles();
  const entry = workspaceFileByLink(node.mapLink);
  if (!entry) {
    showStatus("链接目标未找到或不唯一", 2600);
    return false;
  }
  return openWorkspaceMapFile(entry.path, { fromLinkNodeId: id });
}

async function openProjectFromPicker() {
  if (!supportsSystemOpenPicker()) {
    openFileInput.click();
    return;
  }
  let options;
  try {
    options = {
      id: "zhitu-open-folder",
      multiple: false,
      types: [{
        description: "Mindmap 工程",
        accept: { "application/json": [".mindmap.json", ".json"] },
      }],
    };
    if (workspaceDirectoryHandle && await ensureWorkspacePermission("read")) {
      options.startIn = workspaceDirectoryHandle;
    }
    const [handle] = await window.showOpenFilePicker(options);
    if (!handle) return;
    const file = await handle.getFile();
    await openProject(file, { status: workspaceDirectoryHandle ? "工程已导入，保存时会写入工作目录" : "工程已导入，保存到浏览器本地" });
  } catch (error) {
    if (error?.name !== "AbortError" && options?.startIn) {
      try {
        delete options.startIn;
        const [handle] = await window.showOpenFilePicker(options);
        if (!handle) return;
        const file = await handle.getFile();
        await openProject(file, { status: workspaceDirectoryHandle ? "工程已导入，保存时会写入工作目录" : "工程已导入，保存到浏览器本地" });
        return;
      } catch (retryError) {
        if (retryError?.name === "AbortError") return;
        console.error(retryError);
      }
    }
    if (error?.name !== "AbortError") {
      console.error(error);
      openFileInput.click();
    }
  }
}

function readLocalIndex() {
  try {
    const index = JSON.parse(localStorage.getItem(LOCAL_INDEX_KEY) || "[]");
    return Array.isArray(index) ? index : [];
  } catch {
    return [];
  }
}

function writeLocalIndex(index) {
  localStorage.setItem(LOCAL_INDEX_KEY, JSON.stringify(index));
}

function readLocalTrash() {
  try {
    const trash = JSON.parse(localStorage.getItem(LOCAL_TRASH_KEY) || "[]");
    return Array.isArray(trash) ? trash : [];
  } catch {
    return [];
  }
}

function writeLocalTrash(trash) {
  localStorage.setItem(LOCAL_TRASH_KEY, JSON.stringify(trash.slice(0, 80)));
}

function readActiveLocalIndex({ repair = false } = {}) {
  const trashIds = new Set(readLocalTrash().map((item) => item?.id).filter(Boolean));
  const seen = new Set();
  const active = readLocalIndex().filter((item) => {
    if (!item?.id || seen.has(item.id) || trashIds.has(item.id)) return false;
    seen.add(item.id);
    return localStorage.getItem(`${LOCAL_MAP_PREFIX}${item.id}`) !== null;
  });

  if (repair) {
    const stored = readLocalIndex();
    const changed =
      stored.length !== active.length ||
      stored.some((item, index) => item?.id !== active[index]?.id);
    if (changed) writeLocalIndex(active);
  }

  return active;
}

function localMapEntries() {
  if (!localStorageAvailable()) return [];
  return readActiveLocalIndex({ repair: true }).map((entry) => ({
    ...entry,
    source: "local",
    compareId: `local:${entry.id}`,
  }));
}

function readLocalMapData(id) {
  if (!localStorageAvailable()) throw new Error("浏览器本地存储不可用");
  const rawText = localStorage.getItem(`${LOCAL_MAP_PREFIX}${id}`);
  if (!rawText) throw new Error("找不到本地思维导图");
  const raw = JSON.parse(rawText);
  return {
    entry: localMapEntries().find((item) => item.id === id) || { id, title: DEFAULT_DOCUMENT_TITLE, source: "local" },
    raw,
    data: normalizeProject(raw),
  };
}

function updateLocalIndexEntry(data, id = currentLocalId) {
  const index = readActiveLocalIndex().filter((item) => item.id !== id);
  index.unshift({
    id,
    title: projectDisplayTitle(data) || DEFAULT_DOCUMENT_TITLE,
    updatedAt: data.savedAt,
    nodeCount: data.nodes.length,
    preview: data.nodes.find((node) => node.id === "root")?.text || ROOT_TOPIC_TEXT,
  });
  writeLocalIndex(index.slice(0, 80));
}

function autosaveLocalStorage({ silent = true } = {}) {
  if (!localStorageAvailable()) {
    if (!silent) showStatus("浏览器本地存储不可用", 2200);
    return false;
  }
  try {
    if (readLocalTrash().some((item) => item.id === currentLocalId)) {
      currentLocalId = createLocalId();
    }
    const data = projectData();
    data.localId = currentLocalId;
    localStorage.setItem(`${LOCAL_MAP_PREFIX}${currentLocalId}`, JSON.stringify(data));
    localStorage.setItem(LOCAL_LAST_KEY, currentLocalId);
    updateLocalIndexEntry(data);
    autosaveDirty = false;
    window.clearTimeout(markSaving.timer);
    document.querySelector(".save-state").textContent = silent ? "本地已自动保存" : "本地已保存";
    renderHomeList();
    return true;
  } catch (error) {
    console.error(error);
    if (!silent) showStatus("自动保存失败", 2200);
    return false;
  }
}

function autosaveLocal(options = {}) {
  return autosaveWorkspace(options);
}

async function waitForAutosaveIdle() {
  const pending = autosaveWorkspacePromise;
  if (!pending) return;
  try {
    await pending;
  } catch {
    // Save errors are reported by the save path; this only prevents identity races.
  }
}

async function saveProject() {
  if (editingId) finishEditing();
  const saved = await autosaveLocal({ silent: false });
  if (!saved && workspaceConflictPaused) return;
  showStatus(saved ? "工程已保存到工作目录" : "工程已保存到浏览器本地");
}

function normalizeProject(data) {
  if (!data || data.format !== "mindmap" || data.version !== 1 || !Array.isArray(data.nodes)) {
    throw new Error("这不是受支持的 Mindmap 工程文件");
  }
  if (data.nodes.length < 1 || data.nodes.length > 3000) {
    throw new Error("工程文件的主题数量无效");
  }

  const ids = new Set();
  const normalizedNodes = data.nodes.map((node) => {
    if (!node || typeof node.id !== "string" || !node.id || ids.has(node.id)) {
      throw new Error("工程文件包含重复或无效的主题 ID");
    }
    ids.add(node.id);
    const text = String(node.text || defaultTopicText(node)).slice(0, 500);
    const richText = sanitizeTopicRichText(node.richText, text);
    return {
      id: node.id,
      parentId: node.parentId === null ? null : String(node.parentId),
      text,
      richText: richText || undefined,
      side: node.side === -1 ? -1 : node.side === 0 ? 0 : 1,
      color: /^#[0-9a-f]{6}$/i.test(node.color) ? node.color : "#ffffff",
      collapsed: Boolean(node.collapsed),
      width: Number.isFinite(Number(node.width)) ? clamp(Math.round(Number(node.width)), nodeWidthLimits({ id: node.id === "root" ? "root" : "branch" }).min, nodeWidthLimits({ id: node.id === "root" ? "root" : "branch" }).max) : undefined,
      document: typeof node.document === "string" ? node.document.slice(0, 200000) : undefined,
      images: normalizeNodeImages(node.images),
      mapLink: node.mapLink && typeof node.mapLink === "object" ? {
        kind: String(node.mapLink.kind || "workspace-map").slice(0, 40),
        fileName: String(node.mapLink.fileName || node.mapLink.path || node.mapLink.name || "").slice(0, 260),
        name: String(node.mapLink.name || node.mapLink.title || node.mapLink.fileName || "").slice(0, 260),
        title: String(node.mapLink.title || node.mapLink.name || "").slice(0, 160),
        fingerprint: String(node.mapLink.fingerprint || "").slice(0, 80),
        localId: String(node.mapLink.localId || "").slice(0, 120),
        linkedAt: String(node.mapLink.linkedAt || "").slice(0, 40),
      } : undefined,
      x: 0,
      y: 0,
    };
  });

  const roots = normalizedNodes.filter((node) => node.parentId === null);
  if (roots.length !== 1 || roots[0].id !== "root") {
    throw new Error("工程文件必须包含一个中心主题");
  }
  const nodesById = new Map(normalizedNodes.map((node) => [node.id, node]));
  roots[0].side = 0;
  normalizedNodes.forEach((node) => {
    if (node.parentId !== null && !ids.has(node.parentId)) {
      throw new Error(`主题“${node.text}”缺少父主题`);
    }
    const visited = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId !== null) {
      if (visited.has(parentId)) throw new Error("工程文件包含循环层级");
      visited.add(parentId);
      parentId = nodesById.get(parentId)?.parentId ?? null;
    }
  });

  const viewZoom = Number(data.view?.zoom);
  const viewPanX = Number(data.view?.pan?.x);
  const viewPanY = Number(data.view?.pan?.y);
  return {
    title: typeof data.title === "string" ? data.title.slice(0, 120) : DEFAULT_DOCUMENT_TITLE,
    imageFolder: inferProjectImageFolder(data, normalizedNodes),
    nodes: normalizedNodes,
    view: {
      zoom: Number.isFinite(viewZoom) ? Math.min(1.6, Math.max(0.5, viewZoom)) : 1,
      pan: {
        x: Number.isFinite(viewPanX) ? viewPanX : 0,
        y: Number.isFinite(viewPanY) ? viewPanY : 0,
      },
    },
  };
}

function applyProjectData(
  data,
  {
    localId = currentLocalId,
    status = "工程已打开",
    markDirty = false,
    selectedNodeId = "root",
    selectedNodeIds = [selectedNodeId],
    view = data.view,
  } = {}
) {
  nodes = data.nodes;
  currentMapImageFolder = normalizeWorkspaceImageFolder(data.imageFolder);
  const validSelectedIds = selectedNodeIds.filter((id) => data.nodes.some((node) => node.id === id));
  selectedId = data.nodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : validSelectedIds[0] || "root";
  selectedIds = new Set(validSelectedIds.length ? validSelectedIds : [selectedId]);
  editingId = null;
  activeDocumentId = null;
  if (nodeDocumentOverlay) nodeDocumentOverlay.hidden = true;
  internalClipboard = null;
  history = [];
  future = [];
  nodeCounter = Math.max(
    1,
    ...nodes.map((node) => Number(node.id.match(/^n(\d+)$/)?.[1] || 0))
  ) + 1;
  zoom = view?.zoom ?? data.view.zoom;
  pan = view?.pan ?? data.view.pan;
  currentLocalId = localId;
  const dataRootTitle = rootTitleFromNodes(data.nodes);
  const dataTitle = String(data.title || "").trim();
  documentTitleInput.value = projectDisplayTitle(data);
  titleEditedByUser = Boolean(dataTitle) && !shouldUseRootTitle(dataTitle) && dataTitle !== dataRootTitle;
  updateHistoryButtons();
  suppressAutosaveMark = !markDirty;
  render();
  suppressAutosaveMark = false;
  autosaveDirty = markDirty;
  if (status) showStatus(status);
  viewport.focus({ preventScroll: true });
}

async function openProject(
  file,
  {
    status = "工程已打开",
    localId = null,
    markDirty = true,
    keepReturnStack = false,
    workspaceFileName = null,
    workspaceModifiedAt = 0,
  } = {}
) {
  try {
    if (!keepReturnStack) mapReturnStack = [];
    const raw = JSON.parse(await file.text());
    const data = normalizeProject(raw);
    const fingerprint = projectFingerprint(raw);
    const projectLocalId = typeof raw.localId === "string" && raw.localId ? raw.localId : localId || createLocalId();
    currentWorkspaceFileName = workspaceFileName || null;
    currentWorkspaceFileModifiedAt = workspaceFileName ? workspaceModifiedAt || file.lastModified || 0 : 0;
    currentWorkspaceFileFingerprint = workspaceFileName ? fingerprint : "";
    workspaceConflictPaused = false;
    workspaceConflictFileName = null;
    hideWorkspaceConflictDialog();
    if (currentWorkspaceFileName && localStorageAvailable()) {
      localStorage.setItem(WORKSPACE_CURRENT_FILE_KEY, currentWorkspaceFileName);
    }
    applyProjectData(data, { localId: projectLocalId, status, markDirty });
    if (markDirty) await autosaveLocal();
    updateWorkspaceStatusText();
    renderWorkspaceFiles();
    updateMapReturnButton();
    return true;
  } catch (error) {
    console.error(error);
    showStatus("无法打开此工程", 2200);
    return false;
  } finally {
    openFileInput.value = "";
  }
}

function formatLocalTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderHomeList() {
  if (!homeList) return;
  const isTrash = homeMode === "trash";
  const usingWorkspace = Boolean(workspaceDirectoryHandle);
  const usingLocalFallback = !usingWorkspace;
  const index = usingWorkspace
    ? isTrash ? workspaceTrashItems : workspaceHomeItems
    : usingLocalFallback && localStorageAvailable()
      ? isTrash ? readLocalTrash() : readActiveLocalIndex({ repair: true })
      : [];
  if (trashButton) {
    trashButton.hidden = !(usingWorkspace || usingLocalFallback);
    trashButton.setAttribute("aria-pressed", String(isTrash));
    trashButton.textContent = isTrash ? "返回文件" : "垃圾桶";
  }
  homeList.replaceChildren();
  if (!index.length) {
    const empty = document.createElement("div");
    empty.className = "home-empty";
    empty.innerHTML = usingWorkspace
      ? isTrash
        ? "<strong>垃圾桶是空的</strong><span>删除的思维导图会先移动到工作目录的 .mindmap_trash 文件夹。</span>"
        : "<strong>工作目录中还没有思维导图</strong><span>当前画布会每 5 秒自动保存到这个文件夹，并出现在这里。</span>"
      : usingLocalFallback
        ? isTrash
          ? "<strong>本地垃圾桶是空的</strong><span>此设备不支持文件夹授权，删除的 map 会先保存在浏览器本地垃圾桶。</span>"
          : "<strong>浏览器本地还没有思维导图</strong><span>此设备不支持文件夹授权。新建或导入 map 后会自动保存在本地列表。</span>"
        : "<strong>浏览器本地还没有思维导图</strong><span>未选择 Working Folder 时，首页会先显示浏览器本地保存的 map。</span>";
    homeList.append(empty);
    return;
  }
  index.forEach((item) => {
    const card = document.createElement("article");
    const current = !isTrash && (usingWorkspace ? item.path === currentWorkspaceFileName : item.id === currentLocalId);
    card.className = `home-card${current ? " current" : ""}${isTrash ? " trashed" : ""}`;
    card.dataset.id = item.id;
    if (item.path) card.dataset.name = item.path;

    const title = document.createElement("strong");
    title.textContent = item.title || DEFAULT_DOCUMENT_TITLE;
    const meta = document.createElement("span");
    if (isTrash) {
      meta.textContent = `${item.nodeCount || 0} 个主题 · 删除于 ${formatLocalTime(item.deletedAt)} · 原位置：${item.originalPath || "浏览器本地"}`;
    } else {
      const location = usingWorkspace ? workspacePathDirectory(item.path) || "工作目录" : "浏览器本地";
      meta.textContent = `${item.nodeCount || 0} 个主题 · ${formatLocalTime(item.updatedAt)} · ${location}`;
    }
    const preview = document.createElement("small");
    preview.textContent = item.preview || ROOT_TOPIC_TEXT;

    const actions = document.createElement("div");
    actions.className = "home-card-actions";
    if (isTrash) {
      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "secondary-button";
      restore.dataset.action = "restore";
      restore.textContent = "恢复";
      const purge = document.createElement("button");
      purge.type = "button";
      purge.className = "text-button danger";
      purge.dataset.action = "purge";
      purge.textContent = "彻底删除";
      actions.append(restore, purge);
    } else {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "secondary-button";
      open.dataset.action = "open";
      open.textContent = "打开";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "text-button danger";
      remove.dataset.action = "delete";
      remove.textContent = "移到垃圾桶";
      actions.append(open, remove);
    }
    card.append(title, meta, preview, actions);
    homeList.append(card);
  });
}

async function openHome() {
  if (!workspaceDirectoryHandle && supportsWorkspaceDirectoryAccess()) {
    await chooseWorkspaceDirectory();
  }
  await autosaveLocal();
  homeMode = "maps";
  if (workspaceDirectoryHandle) await refreshWorkspaceFiles();
  renderHomeList();
  homeOverlay.hidden = false;
}

function closeHome() {
  homeOverlay.hidden = true;
  viewport.focus({ preventScroll: true });
}

function compareOptionLabel(entry) {
  if (entry.source === "local") {
    return `${entry.title || DEFAULT_DOCUMENT_TITLE} · 浏览器本地`;
  }
  const folder = workspacePathDirectory(entry.path);
  return `${workspaceEntryDisplayName(entry)}${folder ? ` · ${folder}` : ""}`;
}

function compareEntries() {
  return workspaceDirectoryHandle
    ? workspaceFiles.map((entry) => ({ ...entry, source: "workspace", compareId: `workspace:${entry.path}` }))
    : localMapEntries();
}

function populateCompareSelectors() {
  [compareLeftSelect, compareRightSelect].forEach((select) => select.replaceChildren());
  currentCompareEntries = compareEntries();
  currentCompareEntries.forEach((entry) => {
    [compareLeftSelect, compareRightSelect].forEach((select) => {
      const option = document.createElement("option");
      option.value = entry.compareId;
      option.textContent = compareOptionLabel(entry);
      select.append(option);
    });
  });
  const currentIndex = Math.max(0, currentCompareEntries.findIndex((entry) => (
    entry.source === "workspace" ? entry.path === currentWorkspaceFileName : entry.id === currentLocalId
  )));
  compareLeftSelect.selectedIndex = currentIndex;
  compareRightSelect.selectedIndex = currentCompareEntries.length > 1
    ? currentIndex === 0 ? 1 : 0
    : currentIndex;
  runCompareButton.disabled = currentCompareEntries.length < 2;
}

function renderCompareMessage(message, tone = "empty") {
  compareResult.replaceChildren();
  const empty = document.createElement("div");
  empty.className = `compare-empty ${tone}`;
  empty.textContent = message;
  compareResult.append(empty);
}

async function openCompareOverlay() {
  if (!workspaceDirectoryHandle && supportsWorkspaceDirectoryAccess()) {
    await chooseWorkspaceDirectory();
  }
  if (autosaveDirty) {
    const saved = await autosaveLocal({ silent: false });
    if (!saved) return;
  }
  if (workspaceDirectoryHandle) await refreshWorkspaceFiles();
  populateCompareSelectors();
  compareOverlay.hidden = false;
  if (currentCompareEntries.length < 2) {
    renderCompareMessage(workspaceDirectoryHandle
      ? "工作目录中至少需要两个可打开的 mindmap 文件"
      : "浏览器本地至少需要两个可打开的 mindmap");
  } else {
    renderCompareMessage("选择两个 map 后开始对比");
    runMapCompare();
  }
}

function closeCompareOverlay() {
  compareOverlay.hidden = true;
  viewport.focus({ preventScroll: true });
}

async function readWorkspaceProject(entry) {
  const file = await entry.handle.getFile();
  const raw = JSON.parse(await file.text());
  return {
    entry,
    raw,
    data: normalizeProject(raw),
  };
}

async function readCompareProject(entry) {
  if (entry?.source === "local") return readLocalMapData(entry.id);
  return readWorkspaceProject(entry);
}

function shortText(value, fallback = "空") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 120) : fallback;
}

function compareValue(value) {
  return stableStringify(value ?? "");
}

function mapLinkCompareValue(node) {
  return node.mapLink ? {
    fileName: node.mapLink.fileName || "",
    name: node.mapLink.name || "",
  } : "";
}

function nodeImageCompareValue(node) {
  return Array.isArray(node.images)
    ? node.images.map((image) => ({
      name: image.name || "",
      src: image.src || "",
      width: image.width || "",
      height: image.height || "",
    }))
    : [];
}

function flattenComparableProject(data) {
  const nodeMap = new Map(data.nodes.map((node) => [node.id, node]));
  const children = new Map();
  data.nodes.forEach((node) => {
    if (node.parentId === null) return;
    if (!children.has(node.parentId)) children.set(node.parentId, []);
    children.get(node.parentId).push(node);
  });
  const root = data.nodes.find((node) => node.parentId === null) || data.nodes[0];
  const result = new Map();
  const ordered = [];
  const visit = (node, key, pathParts) => {
    const path = [...pathParts, shortText(node.text, defaultTopicText(node))];
    const item = {
      key,
      node,
      path: path.join(" / "),
      signature: {
        text: node.text || "",
        side: node.side,
        color: node.color || "",
        collapsed: Boolean(node.collapsed),
        width: Number.isFinite(Number(node.width)) ? Number(node.width) : "",
        document: node.document || "",
        images: nodeImageCompareValue(node),
        mapLink: mapLinkCompareValue(node),
        parentId: node.parentId === null ? null : nodeMap.get(node.parentId)?.text || node.parentId,
      },
    };
    result.set(key, item);
    ordered.push(key);
    (children.get(node.id) || []).forEach((child, index) => {
      visit(child, `${key}.${index + 1}`, path);
    });
  };
  visit(root, "root", []);
  return { map: result, ordered };
}

function compareProjects(left, right) {
  const leftFlat = flattenComparableProject(left.data);
  const rightFlat = flattenComparableProject(right.data);
  const diffs = [];
  if (left.data.title !== right.data.title) {
    diffs.push({
      type: "changed",
      key: "title",
      path: "文件名 / 标题",
      fields: ["标题"],
      leftText: left.data.title,
      rightText: right.data.title,
    });
  }
  const keys = [...new Set([...leftFlat.ordered, ...rightFlat.ordered])].filter((key) => key !== "root" || leftFlat.map.has(key) || rightFlat.map.has(key));
  keys.forEach((key) => {
    const leftItem = leftFlat.map.get(key);
    const rightItem = rightFlat.map.get(key);
    if (!leftItem && rightItem) {
      diffs.push({
        type: "added",
        key,
        path: rightItem.path,
        fields: ["新增主题"],
        rightText: rightItem.node.text,
      });
      return;
    }
    if (leftItem && !rightItem) {
      diffs.push({
        type: "removed",
        key,
        path: leftItem.path,
        fields: ["删除主题"],
        leftText: leftItem.node.text,
      });
      return;
    }
    const fields = [];
    const fieldLabels = {
      text: "主题文字",
      side: "方向",
      color: "颜色",
      collapsed: "折叠",
      width: "宽度",
      document: "文档",
      images: "图片",
      mapLink: "链接",
      parentId: "父主题",
    };
    Object.keys(fieldLabels).forEach((field) => {
      if (compareValue(leftItem.signature[field]) !== compareValue(rightItem.signature[field])) {
        fields.push(fieldLabels[field]);
      }
    });
    if (fields.length) {
      diffs.push({
        type: "changed",
        key,
        path: rightItem.path || leftItem.path,
        fields,
        leftText: leftItem.node.text,
        rightText: rightItem.node.text,
      });
    }
  });
  return diffs;
}

function renderCompareDiffCard(diff) {
  const card = document.createElement("article");
  card.className = `compare-diff-card ${diff.type}`;

  const header = document.createElement("header");
  const type = document.createElement("span");
  type.className = "compare-type";
  type.textContent = diff.type === "added" ? "新增" : diff.type === "removed" ? "删除" : "修改";
  const path = document.createElement("strong");
  path.textContent = diff.path;
  header.append(type, path);

  const body = document.createElement("div");
  body.className = "compare-diff-body";
  const left = document.createElement("div");
  left.className = "compare-side old";
  left.innerHTML = "<span>左</span>";
  const leftText = document.createElement("p");
  leftText.textContent = diff.leftText === undefined ? "无" : shortText(diff.leftText);
  left.append(leftText);

  const arrow = document.createElement("div");
  arrow.className = "compare-arrow";
  arrow.textContent = "→";

  const right = document.createElement("div");
  right.className = "compare-side new";
  right.innerHTML = "<span>右</span>";
  const rightText = document.createElement("p");
  rightText.textContent = diff.rightText === undefined ? "无" : shortText(diff.rightText);
  right.append(rightText);
  body.append(left, arrow, right);

  const fields = document.createElement("div");
  fields.className = "compare-fields";
  diff.fields.forEach((field) => {
    const chip = document.createElement("span");
    chip.textContent = field;
    fields.append(chip);
  });
  card.append(header, body, fields);
  return card;
}

function renderCompareResult(diffs) {
  compareResult.replaceChildren();
  if (!diffs.length) {
    renderCompareMessage("无区别", "success");
    return;
  }
  const summary = document.createElement("div");
  summary.className = "compare-summary";
  const counts = {
    added: diffs.filter((diff) => diff.type === "added").length,
    removed: diffs.filter((diff) => diff.type === "removed").length,
    changed: diffs.filter((diff) => diff.type === "changed").length,
  };
  [
    ["added", "新增", counts.added],
    ["removed", "删除", counts.removed],
    ["changed", "修改", counts.changed],
  ].forEach(([type, label, count]) => {
    const item = document.createElement("span");
    item.className = `compare-count ${type}`;
    item.textContent = `${label} ${count}`;
    summary.append(item);
  });
  const list = document.createElement("div");
  list.className = "compare-diff-list";
  diffs.forEach((diff) => list.append(renderCompareDiffCard(diff)));
  compareResult.append(summary, list);
}

async function runMapCompare() {
  const entries = currentCompareEntries.length ? currentCompareEntries : compareEntries();
  const leftEntry = entries.find((entry) => entry.compareId === compareLeftSelect.value);
  const rightEntry = entries.find((entry) => entry.compareId === compareRightSelect.value);
  if (!leftEntry || !rightEntry) {
    renderCompareMessage("找不到选中的 map 文件");
    return;
  }
  runCompareButton.disabled = true;
  renderCompareMessage("正在对比...");
  try {
    const [left, right] = await Promise.all([
      readCompareProject(leftEntry),
      readCompareProject(rightEntry),
    ]);
    renderCompareResult(compareProjects(left, right));
  } catch (error) {
    console.error(error);
    renderCompareMessage("无法读取其中一个 map 文件");
  } finally {
    runCompareButton.disabled = entries.length < 2;
  }
}

async function openLocalMap(id, { keepHomeOpen = false } = {}) {
  if (workspaceDirectoryHandle) {
    return openWorkspaceMapFile(id).then((opened) => {
      if (opened && !keepHomeOpen) closeHome();
      return opened;
    });
  }
  try {
    if (autosaveDirty) {
      const saved = await autosaveLocal({ silent: false });
      if (!saved) return false;
    }
    const { data } = readLocalMapData(id);
    clearWorkspaceFileIdentity();
    workspaceConflictPaused = false;
    workspaceConflictFileName = null;
    hideWorkspaceConflictDialog();
    applyProjectData(data, { localId: id, status: "本地思维导图已打开", markDirty: false });
    if (localStorageAvailable()) localStorage.setItem(LOCAL_LAST_KEY, id);
    updateWorkspaceStatusText();
    renderWorkspaceFiles();
    updateMapReturnButton();
    if (!keepHomeOpen) closeHome();
    return true;
  } catch (error) {
    console.error(error);
    showStatus("无法打开本地思维导图", 2200);
    return false;
  }
}

async function writeWorkspaceTrashEntry(entry) {
  const file = await entry.handle.getFile();
  const raw = JSON.parse(await file.text());
  const data = normalizeProject(raw);
  const trashDirectory = await workspaceDirectoryHandle.getDirectoryHandle(WORKSPACE_TRASH_DIR, { create: true });
  const trashName = await uniqueDirectoryFileName(
    trashDirectory,
    `${Date.now()} ${workspaceEntryDisplayName(entry)}`,
    ".mindmap-trash.json"
  );
  const trashHandle = await trashDirectory.getFileHandle(trashName, { create: true });
  const payload = {
    format: WORKSPACE_TRASH_FORMAT,
    version: 1,
    deletedAt: new Date().toISOString(),
    originalPath: entry.path,
    originalName: entry.name,
    title: projectDisplayTitle(data) || workspaceEntryDisplayName(entry),
    updatedAt: entry.updatedAt || raw.savedAt || "",
    data: raw,
  };
  const writable = await trashHandle.createWritable();
  await writable.write(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }));
  await writable.close();
  return { trashName, payload };
}

function resetToUnsavedDefaultMap(status = "已移到垃圾桶") {
  clearWorkspaceFileIdentity();
  workspaceConflictPaused = false;
  workspaceConflictFileName = null;
  applyProjectData(createDefaultProjectData(), { localId: createLocalId(), status, markDirty: false });
  updateMapReturnButton();
}

async function deleteWorkspaceMapFile(name) {
  const entry = workspaceFileByName(name);
  const title = entry?.title || name;
  if (!workspaceDirectoryHandle || !entry) {
    showStatus("工作目录中找不到此文件", 2200);
    await refreshWorkspaceFiles();
    return;
  }
  if (!window.confirm(`确认将“${title}”移到垃圾桶吗？\n\n文件会移动到工作目录的 ${WORKSPACE_TRASH_DIR} 文件夹，可在首页垃圾桶中恢复。`)) return;
  try {
    if (!await ensureWorkspacePermission("readwrite")) {
      showStatus("需要授权工作目录", 2200);
      return;
    }
    await writeWorkspaceTrashEntry(entry);
    const parts = String(name || "").split("/").filter(Boolean);
    let directory = workspaceDirectoryHandle;
    for (const folder of parts.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(folder);
    }
    await directory.removeEntry(parts.at(-1));
    if (currentWorkspaceFileName === name) {
      resetToUnsavedDefaultMap();
    }
    await refreshWorkspaceFiles();
    showStatus("已移到垃圾桶");
  } catch (error) {
    console.error(error);
    showStatus("无法移到垃圾桶，文件未删除", 2600);
  }
}

function deleteLocalMap(id) {
  if (workspaceDirectoryHandle) return deleteWorkspaceMapFile(id);
  const raw = localStorage.getItem(`${LOCAL_MAP_PREFIX}${id}`);
  if (!raw) {
    writeLocalIndex(readActiveLocalIndex({ repair: true }).filter((item) => item.id !== id));
    renderHomeList();
    return;
  }
  const item = readActiveLocalIndex({ repair: true }).find((entry) => entry.id === id);
  const title = item?.title || DEFAULT_DOCUMENT_TITLE;
  const confirmed = window.confirm(`确认删除“${title}”吗？\n\n它会被移入垃圾桶，你可以在“垃圾桶”中恢复。`);
  if (!confirmed) return;

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  const trash = readLocalTrash().filter((entry) => entry.id !== id);
  trash.unshift({
    id,
    title,
    deletedAt: new Date().toISOString(),
    updatedAt: item?.updatedAt,
    nodeCount: item?.nodeCount || data?.nodes?.length || 0,
    preview: item?.preview || data?.nodes?.find((node) => node.id === "root")?.text || ROOT_TOPIC_TEXT,
    data,
  });
  writeLocalTrash(trash);
  localStorage.removeItem(`${LOCAL_MAP_PREFIX}${id}`);
  writeLocalIndex(readActiveLocalIndex({ repair: true }).filter((item) => item.id !== id));
  if (localStorage.getItem(LOCAL_LAST_KEY) === id) localStorage.removeItem(LOCAL_LAST_KEY);
  if (currentLocalId === id) {
    const nextMap = readActiveLocalIndex({ repair: true })[0];
    if (nextMap) {
      openLocalMap(nextMap.id, { keepHomeOpen: true });
    } else {
      applyProjectData(createDefaultProjectData(), {
        localId: createLocalId(),
        status: "已移入垃圾桶",
        markDirty: false,
      });
    }
  }
  showStatus("已移入垃圾桶");
  renderHomeList();
}

async function restoreWorkspaceTrashItem(id) {
  const entry = workspaceTrashItems.find((item) => item.id === id || item.path === id);
  if (!workspaceDirectoryHandle || !entry) {
    showStatus("垃圾桶中找不到此文件", 2200);
    await refreshWorkspaceFiles();
    return;
  }
  try {
    if (!await ensureWorkspacePermission("readwrite")) {
      showStatus("需要授权工作目录", 2200);
      return;
    }
    const originalPath = entry.originalPath || `${safeFileBaseName(entry.title)}.mindmap.json`;
    const parts = String(originalPath).split("/").filter(Boolean);
    let directory = workspaceDirectoryHandle;
    for (const folder of parts.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(folder, { create: true });
    }
    const originalName = parts.at(-1) || `${safeFileBaseName(entry.title)}.mindmap.json`;
    const baseName = originalName.replace(/(?:\.mindmap)?\.json$/i, "");
    const extension = originalName.toLocaleLowerCase().endsWith(".mindmap.json") ? ".mindmap.json" : ".json";
    const restoredName = await uniqueDirectoryFileName(directory, baseName, extension);
    const restoredHandle = await directory.getFileHandle(restoredName, { create: true });
    const writable = await restoredHandle.createWritable();
    await writable.write(new Blob([JSON.stringify(entry.data, null, 2)], { type: "application/json;charset=utf-8" }));
    await writable.close();

    const trashDirectory = await workspaceDirectoryHandle.getDirectoryHandle(WORKSPACE_TRASH_DIR);
    await trashDirectory.removeEntry(entry.name);
    homeMode = "maps";
    await refreshWorkspaceFiles();
    const restoredPath = joinWorkspacePath(workspacePathDirectory(originalPath), restoredName);
    await openWorkspaceMapFile(restoredPath, { restore: true });
    renderHomeList();
    showStatus(restoredName === originalName ? "已从垃圾桶恢复" : `已恢复为 ${restoredName}`, 2600);
  } catch (error) {
    console.error(error);
    showStatus("无法恢复此文件", 2200);
  }
}

function restoreLocalMap(id) {
  if (workspaceDirectoryHandle) return restoreWorkspaceTrashItem(id);
  const trash = readLocalTrash();
  const entry = trash.find((item) => item.id === id);
  if (!entry?.data) {
    showStatus("无法恢复此文件", 2200);
    return;
  }
  try {
    const data = normalizeProject(entry.data);
    localStorage.setItem(`${LOCAL_MAP_PREFIX}${id}`, JSON.stringify({ ...entry.data, localId: id }));
    updateLocalIndexEntry({
      ...entry.data,
      title: projectDisplayTitle(data),
      savedAt: entry.data.savedAt || entry.updatedAt || new Date().toISOString(),
      nodes: data.nodes,
    }, id);
    writeLocalTrash(trash.filter((item) => item.id !== id));
    homeMode = "maps";
    openLocalMap(id);
    renderHomeList();
    showStatus("已从垃圾桶恢复");
  } catch (error) {
    console.error(error);
    showStatus("无法恢复此文件", 2200);
  }
}

async function purgeWorkspaceTrashItem(id) {
  const entry = workspaceTrashItems.find((item) => item.id === id || item.path === id);
  const title = entry?.title || "此思维导图";
  if (!workspaceDirectoryHandle || !entry) {
    showStatus("垃圾桶中找不到此文件", 2200);
    await refreshWorkspaceFiles();
    return;
  }
  if (!window.confirm(`彻底删除“${title}”吗？\n\n这会删除 ${WORKSPACE_TRASH_DIR} 中的备份，无法恢复。`)) return;
  try {
    if (!await ensureWorkspacePermission("readwrite")) {
      showStatus("需要授权工作目录", 2200);
      return;
    }
    const trashDirectory = await workspaceDirectoryHandle.getDirectoryHandle(WORKSPACE_TRASH_DIR);
    await trashDirectory.removeEntry(entry.name);
    await refreshWorkspaceFiles();
    showStatus("已彻底删除");
  } catch (error) {
    console.error(error);
    showStatus("无法彻底删除", 2200);
  }
}

function purgeLocalMap(id) {
  if (workspaceDirectoryHandle) return purgeWorkspaceTrashItem(id);
  const entry = readLocalTrash().find((item) => item.id === id);
  const title = entry?.title || "此思维导图";
  if (!window.confirm(`彻底删除“${title}”吗？\n\n此操作无法恢复。`)) return;
  writeLocalTrash(readLocalTrash().filter((item) => item.id !== id));
  renderHomeList();
  showStatus("已彻底删除");
}

async function newLocalMap({ keepHomeOpen = false } = {}) {
  if (editingId) finishEditing();
  if (autosaveDirty) {
    const saved = await autosaveLocal({ silent: false });
    if (!saved) {
      showStatus("当前文件未安全保存，已取消新建", 2600);
      return false;
    }
  }
  await waitForAutosaveIdle();
  homeMode = "maps";
  mapReturnStack = [];
  clearWorkspaceFileIdentity();
  workspaceConflictPaused = false;
  workspaceConflictFileName = null;
  hideWorkspaceConflictDialog();
  const blankProject = createDefaultProjectData();
  applyProjectData(blankProject, {
    localId: createLocalId(),
    status: workspaceDirectoryHandle ? "已新建工作目录思维导图" : "已新建浏览器本地思维导图",
    markDirty: true,
  });
  await autosaveLocal();
  updateMapReturnButton();
  if (!keepHomeOpen) closeHome();
  renderHomeList();
  return true;
}

function restoreLastLocalMap() {
  if (!localStorageAvailable()) return;
  const lastId = localStorage.getItem(LOCAL_LAST_KEY);
  if (!lastId) return;
  if (readLocalTrash().some((item) => item.id === lastId)) {
    localStorage.removeItem(LOCAL_LAST_KEY);
    return;
  }
  const raw = localStorage.getItem(`${LOCAL_MAP_PREFIX}${lastId}`);
  if (!raw) return;
  try {
    const data = normalizeProject(JSON.parse(raw));
    applyProjectData(data, { localId: lastId, status: "已恢复上次编辑", markDirty: false });
  } catch (error) {
    console.error(error);
  }
}

nodesLayer.addEventListener("click", async (event) => {
  if (suppressNextClick) return;
  const imageBadge = event.target.closest(".node-image-badge");
  if (imageBadge) {
    event.preventDefault();
    event.stopPropagation();
    await openNodeImage(imageBadge.dataset.id);
    return;
  }
  const foldButton = event.target.closest(".fold-toggle");
  if (foldButton) {
    event.preventDefault();
    event.stopPropagation();
    toggleFold(foldButton.dataset.id);
    return;
  }
  const element = event.target.closest(".topic-node");
  if (!element || editingId) return;
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    await followNodeMapLink(element.dataset.id);
    return;
  }
  if (event.detail >= 2) {
    event.preventDefault();
    beginEditing(element.dataset.id);
    return;
  }
  selectNode(element.dataset.id);
});

nodesLayer.addEventListener("dblclick", (event) => {
  if (event.target.closest(".fold-toggle")) return;
  const element = event.target.closest(".topic-node");
  if (!element) return;
  event.preventDefault();
  beginEditing(element.dataset.id);
});

nodesLayer.addEventListener("input", (event) => {
  if (!event.target.matches(".topic-label") || !editingId) return;
  syncEditingText();
  syncEditingNodeWidth();
  drawConnections();
  markSaving();
});

nodesLayer.addEventListener("paste", async (event) => {
  if (!editingId || !event.target.matches(".topic-label")) return;
  const imageFile = pastedImageFile(event);
  if (!imageFile) return;
  event.preventDefault();
  event.stopPropagation();
  syncEditingText();
  await attachImageToNode(imageFile, editingId, { fromPaste: true });
});

nodesLayer.addEventListener("keydown", (event) => {
  if (!editingId) return;
  const command = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (event.key === " " && !event.repeat) {
    editingSpaceHeld = true;
  }
  const superscriptShortcut = command && event.shiftKey && !event.altKey
    && (event.key === "+" || event.code === "Equal" || event.code === "NumpadAdd");
  const subscriptShortcut = command && event.shiftKey && !event.altKey
    && (event.key === "-" || event.key === "_" || event.code === "Minus" || event.code === "NumpadSubtract");
  if (superscriptShortcut) {
    event.preventDefault();
    event.stopPropagation();
    toggleTopicScript("superscript");
  } else if (subscriptShortcut) {
    event.preventDefault();
    event.stopPropagation();
    toggleTopicScript("subscript");
  } else if (command && key === "z") {
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) {
      redo();
    } else {
      undo();
    }
  } else if (command && key === "y") {
    event.preventDefault();
    event.stopPropagation();
    redo();
  } else if (event.key === "Enter" && (event.shiftKey || editingSpaceHeld)) {
    event.preventDefault();
    event.stopPropagation();
    if (editingSpaceHeld) removeTrailingSpaceBeforeCaret();
    insertEditingLineBreak();
  } else if (event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    syncEditingText();
    finishEditing();
  } else if (event.key === "Tab") {
    event.preventDefault();
    event.stopPropagation();
    syncEditingText();
    const currentId = editingId;
    finishEditing();
    if (event.shiftKey) {
      addParent(currentId, true);
    } else {
      addChild(currentId, true);
    }
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    finishEditing();
  }
});

function isValidDropTarget(draggedIds, targetId) {
  if (!targetId || draggedIds.includes(targetId)) return false;
  return draggedIds.every((id) => !descendantsOf(id).includes(targetId));
}

function dropIntentForPointer(event, targetElement, draggedIds) {
  const targetId = targetElement?.dataset.id;
  if (!isValidDropTarget(draggedIds, targetId)) return null;
  const targetNode = getNode(targetId);
  if (!targetNode) return null;
  const rect = targetElement.getBoundingClientRect();
  const relativeY = (event.clientY - rect.top) / Math.max(1, rect.height);
  const direction = targetNode.id === "root"
    ? event.clientX >= rect.left + rect.width / 2 ? "right" : "left"
    : (targetNode.side || 1) > 0 ? "right" : "left";
  if (targetNode.parentId !== null && relativeY < 0.32) {
    return { mode: "sibling", targetId, position: "before", direction };
  }
  if (targetNode.parentId !== null && relativeY > 0.68) {
    return { mode: "sibling", targetId, position: "after", direction };
  }
  return { mode: "child", targetId, position: null, direction };
}

function reorderDraggedAsSiblings(draggedIds, targetId, position) {
  const target = getNode(targetId);
  if (!target || target.parentId === null) return false;
  const draggedNodes = draggedIds.map((id) => getNode(id)).filter(Boolean);
  if (!draggedNodes.length) return false;
  const parent = getNode(target.parentId);
  const nextParentId = target.parentId;
  const nextSide = target.side || parent?.side || 1;
  draggedNodes.forEach((node) => {
    node.parentId = nextParentId;
    node.side = nextParentId === "root" ? target.side || node.side || 1 : nextSide;
  });

  const moving = [];
  const remaining = [];
  nodes.forEach((node) => {
    if (draggedIds.includes(node.id)) moving.push(node);
    else remaining.push(node);
  });
  const targetIndex = remaining.findIndex((node) => node.id === targetId);
  if (targetIndex === -1) return false;
  const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
  nodes = [
    ...remaining.slice(0, insertIndex),
    ...moving,
    ...remaining.slice(insertIndex),
  ];
  return true;
}

function clearDragVisuals() {
  nodesLayer.querySelectorAll(".dragging, .drop-target, .drop-child-left, .drop-child-right, .drop-before, .drop-after").forEach((element) => {
    element.classList.remove("dragging", "drop-target", "drop-child-left", "drop-child-right", "drop-before", "drop-after");
  });
  document.querySelector(".drag-ghost")?.remove();
}

function clearNodeImageDragVisuals() {
  nodesLayer.querySelectorAll(".image-dragging, .image-drop-target").forEach((element) => {
    element.classList.remove("image-dragging", "image-drop-target");
  });
  document.querySelector(".image-drag-ghost")?.remove();
}

function startNodeImageDrag(event, badge) {
  const sourceNodeId = badge.dataset.id;
  const source = getNode(sourceNodeId);
  const imageIndex = Number(badge.dataset.imageIndex);
  if (!source || !nodeImages(source)[imageIndex]) return;
  event.preventDefault();
  event.stopPropagation();
  hideNodeLinkMenu();
  nodeImageDrag = {
    sourceNodeId,
    imageIndex,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
    targetId: null,
  };
  nodesLayer.setPointerCapture(event.pointerId);
}

function updateNodeImageDrag(event) {
  if (!nodeImageDrag || nodeImageDrag.pointerId !== event.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  const distance = Math.hypot(event.clientX - nodeImageDrag.startX, event.clientY - nodeImageDrag.startY);
  if (!nodeImageDrag.active && distance < 6) return;

  if (!nodeImageDrag.active) {
    nodeImageDrag.active = true;
    const badge = nodesLayer.querySelector(`.node-image-badge[data-id="${nodeImageDrag.sourceNodeId}"]`);
    badge?.classList.add("image-dragging");
    const ghost = document.createElement("div");
    ghost.className = "image-drag-ghost";
    const preview = badge?.querySelector("img");
    if (preview?.src) {
      const image = document.createElement("img");
      image.src = preview.src;
      image.alt = "";
      ghost.append(image);
    } else {
      const placeholder = document.createElement("span");
      placeholder.setAttribute("aria-hidden", "true");
      ghost.append(placeholder);
    }
    document.body.append(ghost);
    hintText.textContent = "拖到另一主题以移动图片 · Esc 取消";
  }

  const ghost = document.querySelector(".image-drag-ghost");
  if (ghost) {
    ghost.style.left = `${event.clientX}px`;
    ghost.style.top = `${event.clientY}px`;
  }
  nodesLayer.querySelectorAll(".image-drop-target").forEach((element) => element.classList.remove("image-drop-target"));
  const targetElement = document.elementFromPoint(event.clientX, event.clientY)?.closest(".topic-node");
  const targetId = targetElement?.dataset.id;
  nodeImageDrag.targetId = targetId && targetId !== nodeImageDrag.sourceNodeId ? targetId : null;
  if (nodeImageDrag.targetId) {
    targetElement.classList.add("image-drop-target");
    const target = getNode(nodeImageDrag.targetId);
    hintText.textContent = `将图片移动到“${target?.text || defaultTopicText(target)}”`;
  }
}

function finishNodeImageDrag(event, cancelled = false) {
  if (!nodeImageDrag || (event && nodeImageDrag.pointerId !== event.pointerId)) return;
  const dragState = nodeImageDrag;
  nodeImageDrag = null;
  if (nodesLayer.hasPointerCapture(dragState.pointerId)) {
    nodesLayer.releasePointerCapture(dragState.pointerId);
  }
  clearNodeImageDragVisuals();
  hintText.textContent = "双击主题进行编辑";
  if (!dragState.active) {
    if (cancelled) return;
    suppressNextClick = true;
    window.setTimeout(() => {
      suppressNextClick = false;
    }, 0);
    void openNodeImage(dragState.sourceNodeId);
    return;
  }
  suppressNextClick = true;
  window.setTimeout(() => {
    suppressNextClick = false;
  }, 0);
  if (cancelled || !dragState.targetId) return;
  moveNodeImage(dragState.sourceNodeId, dragState.imageIndex, dragState.targetId);
}

function setNodeWidth(node, nextWidth) {
  const limits = nodeWidthLimits(node);
  node.width = clamp(Math.round(nextWidth), limits.min, limits.max);
  const element = nodesLayer.querySelector(`[data-id="${node.id}"]`);
  if (element) element.style.width = `${node.width}px`;
}

function startNodeResize(event, handle) {
  const nodeId = handle.dataset.id || handle.closest(".topic-node")?.dataset.id;
  const node = getNode(nodeId);
  if (!node) return;
  event.preventDefault();
  event.stopPropagation();
  if (!selectedIds.has(node.id) || selectedId !== node.id) {
    setSelection([node.id], node.id);
  }
  nodeResize = {
    id: node.id,
    pointerId: event.pointerId,
    side: handle.dataset.side || "right",
    startX: event.clientX,
    startWidth: Number(node.width) || defaultNodeWidth(node),
    snapshot: cloneNodes(),
  };
  nodesLayer.setPointerCapture(event.pointerId);
  hintText.textContent = "拖动左右手柄调整宽度";
}

function updateNodeResize(event) {
  if (!nodeResize || nodeResize.pointerId !== event.pointerId) return;
  const node = getNode(nodeResize.id);
  if (!node) return;
  const delta = event.clientX - nodeResize.startX;
  const direction = nodeResize.side === "left" ? -1 : 1;
  setNodeWidth(node, nodeResize.startWidth + delta * 2 * direction);
  drawConnections();
  keepNodeVisible(node.id);
}

function finishNodeResize(event, cancelled = false) {
  if (!nodeResize || (event && nodeResize.pointerId !== event.pointerId)) return;
  const resizeState = nodeResize;
  nodeResize = null;
  if (nodesLayer.hasPointerCapture(resizeState.pointerId)) {
    nodesLayer.releasePointerCapture(resizeState.pointerId);
  }
  hintText.textContent = "双击主题进行编辑";
  const currentNode = getNode(resizeState.id);
  const changed = !cancelled && currentNode && currentNode.width !== resizeState.startWidth;
  if (changed) {
    history.push(resizeState.snapshot);
    if (history.length > 60) history.shift();
    future = [];
    updateHistoryButtons();
    markSaving();
  }
  render();
}

nodesLayer.addEventListener("pointerdown", (event) => {
  const imageBadge = event.target.closest(".node-image-badge");
  if (imageBadge) {
    if (!editingId && event.button === 0) startNodeImageDrag(event, imageBadge);
    return;
  }
  const resizeHandle = event.target.closest(".resize-handle");
  if (resizeHandle && !editingId && event.button === 0) {
    startNodeResize(event, resizeHandle);
    return;
  }
  if (event.target.closest(".fold-toggle")) return;
  const element = event.target.closest(".topic-node");
  if (!element || editingId || event.button !== 0) return;
  if (event.ctrlKey || event.metaKey) return;
  const clickedId = element.dataset.id;
  if (!selectedIds.has(clickedId)) setSelection([clickedId], clickedId);
  if (clickedId === "root") return;
  const draggedIds = selectionRootIds({ excludeRoot: true });
  if (!draggedIds.length) return;
  nodeDrag = {
    ids: draggedIds,
    primaryId: draggedIds.includes(selectedId) ? selectedId : draggedIds[0],
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
    targetId: null,
    dropMode: null,
    insertPosition: null,
  };
  nodesLayer.setPointerCapture(event.pointerId);
});

nodesLayer.addEventListener("pointermove", (event) => {
  if (nodeImageDrag) updateNodeImageDrag(event);
});

nodesLayer.addEventListener("pointermove", (event) => {
  if (nodeResize) updateNodeResize(event);
});

nodesLayer.addEventListener("pointermove", (event) => {
  if (!nodeDrag || nodeDrag.pointerId !== event.pointerId) return;
  const distance = Math.hypot(event.clientX - nodeDrag.startX, event.clientY - nodeDrag.startY);
  if (!nodeDrag.active && distance < 6) return;

  if (!nodeDrag.active) {
    nodeDrag.active = true;
    nodeDrag.ids.forEach((id) => {
      nodesLayer.querySelector(`[data-id="${id}"]`)?.classList.add("dragging");
    });
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = nodeDrag.ids.length === 1
      ? getNode(nodeDrag.ids[0])?.text || ""
      : `${nodeDrag.ids.length} 个主题`;
    document.body.append(ghost);
    hintText.textContent = "拖到主题中部成为子主题，拖到上/下边缘调整同级顺序 · Esc 取消";
  }

  const ghost = document.querySelector(".drag-ghost");
  if (ghost) {
    ghost.style.left = `${event.clientX}px`;
    ghost.style.top = `${event.clientY}px`;
  }
  nodesLayer.querySelectorAll(".drop-target, .drop-child-left, .drop-child-right, .drop-before, .drop-after").forEach((element) => {
    element.classList.remove("drop-target", "drop-child-left", "drop-child-right", "drop-before", "drop-after");
  });
  const targetElement = document.elementFromPoint(event.clientX, event.clientY)?.closest(".topic-node");
  const intent = dropIntentForPointer(event, targetElement, nodeDrag.ids);
  nodeDrag.targetId = intent?.targetId || null;
  nodeDrag.dropMode = intent?.mode || null;
  nodeDrag.insertPosition = intent?.position || null;
  if (intent?.mode === "child") {
    targetElement.classList.add("drop-target", intent.direction === "left" ? "drop-child-left" : "drop-child-right");
    const targetNode = getNode(intent.targetId);
    hintText.textContent = `放到“${targetNode?.text || defaultTopicText(targetNode)}”下`;
  } else if (intent?.mode === "sibling") {
    targetElement.classList.add(intent.position === "before" ? "drop-before" : "drop-after");
    hintText.textContent = intent.position === "before" ? "插入到此主题上方" : "插入到此主题下方";
  }
});

function finishNodeDrag(event, cancelled = false) {
  if (!nodeDrag || (event && nodeDrag.pointerId !== event.pointerId)) return;
  const dragState = nodeDrag;
  nodeDrag = null;
  if (nodesLayer.hasPointerCapture(dragState.pointerId)) {
    nodesLayer.releasePointerCapture(dragState.pointerId);
  }
  clearDragVisuals();
  hintText.textContent = "双击主题进行编辑";

  if (dragState.active) {
    suppressNextClick = true;
    window.setTimeout(() => {
      suppressNextClick = false;
    }, 0);
  }
  if (cancelled || !dragState.active || !dragState.targetId) {
    render();
    return;
  }

  const draggedNodes = dragState.ids.map((id) => getNode(id)).filter(Boolean);
  const targetNode = getNode(dragState.targetId);
  if (!draggedNodes.length || !targetNode) {
    render();
    return;
  }
  if (dragState.dropMode === "sibling") {
    pushHistory();
    const reordered = reorderDraggedAsSiblings(dragState.ids, dragState.targetId, dragState.insertPosition);
    if (!reordered) {
      render();
      return;
    }
    selectedId = dragState.primaryId;
    selectedIds = new Set(dragState.ids);
    render();
    showStatus(`已调整 ${draggedNodes.length} 个主题的同级顺序`);
    return;
  }

  if (draggedNodes.every((node) => node.parentId === targetNode.id)) {
    render();
    return;
  }
  pushHistory();
  targetNode.collapsed = false;
  draggedNodes.forEach((node) => {
    node.parentId = targetNode.id;
    node.side = targetNode.id === "root" ? chooseSide(targetNode) : targetNode.side || 1;
  });
  selectedId = dragState.primaryId;
  selectedIds = new Set(dragState.ids);
  render();
  showStatus(`已将 ${draggedNodes.length} 个主题移到“${targetNode.text}”下`);
}

nodesLayer.addEventListener("pointerup", (event) => finishNodeImageDrag(event));
nodesLayer.addEventListener("pointercancel", (event) => finishNodeImageDrag(event, true));
nodesLayer.addEventListener("pointerup", (event) => finishNodeDrag(event));
nodesLayer.addEventListener("pointercancel", (event) => finishNodeDrag(event, true));
nodesLayer.addEventListener("pointerup", (event) => finishNodeResize(event));
nodesLayer.addEventListener("pointercancel", (event) => finishNodeResize(event, true));

viewport.addEventListener("keydown", (event) => {
  if (editingId || event.target.matches("input")) return;
  if (event.key.startsWith("Arrow")) {
    event.preventDefault();
    navigate(event.key);
  } else if (event.key === "Enter") {
    event.preventDefault();
    addSibling();
  } else if (event.key === "Tab") {
    event.preventDefault();
    if (event.shiftKey) {
      addParent();
    } else {
      addChild();
    }
  } else if (event.key === "F2") {
    event.preventDefault();
    beginEditing();
  } else if (event.key === " ") {
    event.preventDefault();
    beginEditing();
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteSelected();
  } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    beginEditing(selectedId, true);
    requestAnimationFrame(() => document.execCommand("insertText", false, event.key));
  }
});

document.addEventListener("keydown", async (event) => {
  const command = event.ctrlKey || event.metaKey;
  if (command && event.shiftKey && !event.altKey && event.key.toLowerCase() === "p") {
    event.preventDefault();
    event.stopPropagation();
    openWorkspacePanel();
    return;
  }
  if (event.key === "Escape" && nodeImageDrag) {
    event.preventDefault();
    finishNodeImageDrag(null, true);
    return;
  }
  if (event.key === "Escape" && nodeDrag) {
    event.preventDefault();
    finishNodeDrag(null, true);
    return;
  }
  if (event.defaultPrevented) return;
  if (!event.defaultPrevented && event.key === " " && !editingId && !event.target.matches("input, textarea, select, [contenteditable='true']")) {
    event.preventDefault();
    beginEditing();
    return;
  }
  if (!command) return;
  const key = event.key.toLowerCase();
  const editingText = editingId || event.target.matches("input, textarea, select, [contenteditable='true']");
  if (key === "n" && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    await newLocalMap();
  } else if (!editingText && key === "f") {
    event.preventDefault();
    focusSearchMode();
  } else if (!editingText && (key === "=" || key === "+" || key === "-")) {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const direction = key === "-" ? -1 : 1;
    setZoomAt(zoom + direction * KEYBOARD_ZOOM_STEP, rect.left + rect.width / 2, rect.top + rect.height / 2);
  } else if (!editingText && key === "0") {
    event.preventDefault();
    fitCanvas();
  } else if (key === "s") {
    event.preventDefault();
    saveProject();
  } else if (key === "o") {
    event.preventDefault();
    openProjectFromPicker();
  } else if (key === "c" && !editingText) {
    event.preventDefault();
    copySelectedSubtree();
  } else if (key === "v" && !editingText) {
    if (navigator.clipboard?.read) {
      event.preventDefault();
      const imageFile = await readClipboardImageFile();
      if (imageFile) {
        await attachImageToNode(imageFile, selectedId);
      } else if (internalClipboard) {
        pasteSubtree();
      }
    } else if (internalClipboard) {
      event.preventDefault();
      pasteSubtree();
    }
  } else if (key === "z" && event.shiftKey) {
    event.preventDefault();
    redo();
  } else if (key === "z") {
    event.preventDefault();
    undo();
  } else if (key === "y") {
    event.preventDefault();
    redo();
  }
});

document.addEventListener("keyup", (event) => {
  if (event.key === " ") editingSpaceHeld = false;
});

document.querySelector("#add-button").addEventListener("click", () => addChild());
document.querySelector("#edit-button").addEventListener("click", () => beginEditing());
document.querySelector("#delete-button").addEventListener("click", deleteSelected);
copyButton.addEventListener("click", copySelectedSubtree);
pasteButton.addEventListener("click", () => pasteSubtree());
document.querySelector("#zoom-in").addEventListener("click", () => setZoom(zoom + BUTTON_ZOOM_STEP));
document.querySelector("#zoom-out").addEventListener("click", () => setZoom(zoom - BUTTON_ZOOM_STEP));
document.querySelector("#fit-button").addEventListener("click", fitCanvas);
undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);
saveButton.addEventListener("click", saveProject);
openLocalButton.addEventListener("click", openProjectFromPicker);
chooseWorkspaceFolderButton.addEventListener("click", chooseWorkspaceDirectory);
openWorkspaceFileButton.addEventListener("click", openProjectFromPicker);
refreshWorkspaceFilesButton.addEventListener("click", () => refreshWorkspaceFiles());
function clearWorkspaceDropState() {
  workspaceFileList.classList.remove("drop-root");
  workspaceFileList.querySelectorAll(".workspace-tree-row.drop-target").forEach((row) => row.classList.remove("drop-target"));
}

function workspaceDropTargetFolder(event) {
  return event.target.closest("[data-drop-folder]")?.dataset.dropFolder || "";
}

function workspaceFileRows() {
  return [...workspaceFileList.querySelectorAll(".workspace-tree-row.file")];
}

function selectWorkspaceFileRow(row, { focus = true } = {}) {
  if (!row) return null;
  workspaceSelectedFileKey = row.dataset.workspaceKey || "";
  workspaceFileRows().forEach((item) => {
    const selected = item === row;
    item.classList.toggle("keyboard-selected", selected);
    item.setAttribute("aria-selected", String(selected));
  });
  if (focus) workspaceFileList.focus({ preventScroll: true });
  row.scrollIntoView({ block: "nearest" });
  return row;
}

function focusWorkspaceFileList() {
  const rows = workspaceFileRows();
  if (!rows.length) {
    workspaceFileList.focus({ preventScroll: true });
    return;
  }
  const selected = rows.find((row) => row.dataset.workspaceKey === workspaceSelectedFileKey);
  selectWorkspaceFileRow(selected || rows.find((row) => row.classList.contains("current")) || rows[0]);
}

async function openWorkspaceFileRow(row) {
  if (!row) return;
  selectWorkspaceFileRow(row);
  hideNodeLinkMenu();
  if (row.dataset.workspaceKind === "local") {
    await autosaveLocal();
    openLocalMap(row.dataset.localId);
    return;
  }
  mapReturnStack = [];
  await openWorkspaceMapFile(row.dataset.name);
}

function showWorkspaceFileMenu(row, x, y) {
  const menu = ensureNodeLinkMenu();
  const displayName = row.querySelector(".workspace-file-name")?.textContent?.trim() || "思维导图";
  const kind = row.dataset.workspaceKind || "workspace";
  const value = kind === "local" ? row.dataset.localId : row.dataset.name;
  menu.replaceChildren();

  const title = document.createElement("div");
  title.className = "node-link-menu-title";
  title.textContent = displayName;
  const open = document.createElement("button");
  open.type = "button";
  open.className = "node-link-menu-item";
  open.dataset.action = "open-workspace-context";
  open.dataset.workspaceKind = kind;
  open.dataset.workspaceValue = value;
  open.textContent = "打开";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "node-link-menu-item danger";
  remove.dataset.action = "delete-workspace-context";
  remove.dataset.workspaceKind = kind;
  remove.dataset.workspaceValue = value;
  remove.textContent = "移到垃圾桶";
  const hint = document.createElement("div");
  hint.className = "node-link-menu-empty";
  hint.textContent = "删除前会再次确认，可从垃圾桶恢复。";
  menu.append(title, open, remove, hint);
  menu.hidden = false;
  positionNodeMenu(menu, x, y);
}

workspaceFileList.addEventListener("keydown", async (event) => {
  if (!["ArrowUp", "ArrowDown", "Enter"].includes(event.key)) return;
  const rows = workspaceFileRows();
  if (!rows.length) return;
  event.preventDefault();
  event.stopPropagation();
  const selected = rows.find((row) => row.dataset.workspaceKey === workspaceSelectedFileKey);
  if (event.key === "Enter") {
    if (!event.repeat) await openWorkspaceFileRow(selected || rows.find((row) => row.classList.contains("current")) || rows[0]);
    return;
  }
  const currentIndex = rows.indexOf(selected);
  const nextIndex = currentIndex < 0
    ? (event.key === "ArrowDown" ? 0 : rows.length - 1)
    : clamp(currentIndex + (event.key === "ArrowDown" ? 1 : -1), 0, rows.length - 1);
  selectWorkspaceFileRow(rows[nextIndex]);
});

workspaceFileList.addEventListener("contextmenu", (event) => {
  const row = event.target.closest(".workspace-tree-row.file");
  if (!row) return;
  event.preventDefault();
  event.stopPropagation();
  selectWorkspaceFileRow(row);
  showWorkspaceFileMenu(row, event.clientX, event.clientY);
});

workspaceFileList.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "choose-workspace-folder") {
    chooseWorkspaceDirectory();
    return;
  }
  if (action === "open-file-picker") {
    openProjectFromPicker();
    return;
  }
  if (action === "refresh-workspace-files") {
    refreshWorkspaceFiles();
    return;
  }
  const item = event.target.closest(".workspace-tree-row.file");
  if (item) selectWorkspaceFileRow(item, { focus: false });
  const localItem = event.target.closest(".workspace-tree-row.local");
  if (localItem && action === "open-local-workspace") {
    openWorkspaceFileRow(localItem);
    return;
  }
  const folder = event.target.closest("[data-action='toggle-folder']");
  if (folder) {
    const path = folder.dataset.path;
    if (expandedWorkspaceFolders.has(path)) expandedWorkspaceFolders.delete(path);
    else expandedWorkspaceFolders.add(path);
    renderWorkspaceFiles();
    return;
  }
  if (!action || !item) return;
  if (action === "open") {
    openWorkspaceFileRow(item);
  }
});
workspaceFileList.addEventListener("dragstart", (event) => {
  const item = event.target.closest(".workspace-tree-row.file");
  if (!item) return;
  workspaceDragFilePath = item.dataset.name || "";
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", workspaceDragFilePath);
  item.classList.add("dragging");
});
workspaceFileList.addEventListener("dragend", () => {
  workspaceDragFilePath = "";
  clearWorkspaceDropState();
  workspaceFileList.querySelectorAll(".workspace-tree-row.dragging").forEach((row) => row.classList.remove("dragging"));
});
workspaceFileList.addEventListener("dragover", (event) => {
  const sourcePath = workspaceDragFilePath || event.dataTransfer.getData("text/plain");
  if (!sourcePath || !workspaceFileByName(sourcePath)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  clearWorkspaceDropState();
  const folder = event.target.closest("[data-drop-folder]");
  if (folder) folder.classList.add("drop-target");
  else workspaceFileList.classList.add("drop-root");
});
workspaceFileList.addEventListener("dragleave", (event) => {
  if (!workspaceFileList.contains(event.relatedTarget)) clearWorkspaceDropState();
});
workspaceFileList.addEventListener("drop", async (event) => {
  const sourcePath = workspaceDragFilePath || event.dataTransfer.getData("text/plain");
  if (!sourcePath || !workspaceFileByName(sourcePath)) return;
  event.preventDefault();
  const targetFolder = workspaceDropTargetFolder(event);
  clearWorkspaceDropState();
  workspaceDragFilePath = "";
  await moveWorkspaceMapFile(sourcePath, targetFolder);
});
document.addEventListener("click", (event) => {
  if (event.target.closest(".node-link-menu")) return;
  hideNodeLinkMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideNodeLinkMenu();
});
document.addEventListener("click", async (event) => {
  const item = event.target.closest(".node-link-menu-item");
  if (!item) return;
  const nodeId = item.dataset.nodeId;
  if (item.dataset.action === "link-file") {
    setSelection([nodeId], nodeId);
    await linkSelectedNodeToWorkspaceFile(item.dataset.name);
    hideNodeLinkMenu();
  } else if (item.dataset.action === "insert-node-image") {
    setSelection([nodeId], nodeId);
    hideNodeLinkMenu();
    chooseNodeImage(nodeId);
  } else if (item.dataset.action === "view-node-image") {
    hideNodeLinkMenu();
    await openNodeImage(nodeId);
  } else if (item.dataset.action === "remove-node-image") {
    hideNodeLinkMenu();
    removeNodeImage(nodeId, Number(item.dataset.imageIndex));
  } else if (item.dataset.action === "open-workspace-context") {
    const row = workspaceFileRows().find((candidate) => {
      const value = item.dataset.workspaceKind === "local" ? candidate.dataset.localId : candidate.dataset.name;
      return candidate.dataset.workspaceKind === item.dataset.workspaceKind && value === item.dataset.workspaceValue;
    });
    hideNodeLinkMenu();
    await openWorkspaceFileRow(row);
  } else if (item.dataset.action === "delete-workspace-context") {
    hideNodeLinkMenu();
    if (item.dataset.workspaceKind === "local") {
      deleteLocalMap(item.dataset.workspaceValue);
    } else {
      await deleteWorkspaceMapFile(item.dataset.workspaceValue);
    }
  } else if (item.dataset.action === "open-document") {
    hideNodeLinkMenu();
    openNodeDocument(nodeId);
  } else if (item.dataset.action === "show-link-files") {
    if (!workspaceFiles.length && workspaceDirectoryHandle) await refreshWorkspaceFiles();
    renderNodeLinkMenu(nodeId, { showFiles: true });
  } else if (item.dataset.action === "open-linked") {
    hideNodeLinkMenu();
    await followNodeMapLink(nodeId);
  } else if (item.dataset.action === "unlink") {
    unlinkNodeMap(nodeId);
    hideNodeLinkMenu();
  } else if (item.dataset.action === "refresh-files") {
    await refreshWorkspaceFiles();
    renderNodeLinkMenu(nodeId, { showFiles: true });
  } else if (item.dataset.action === "toggle-link-folder") {
    const path = item.dataset.path;
    if (expandedWorkspaceFolders.has(path)) expandedWorkspaceFolders.delete(path);
    else expandedWorkspaceFolders.add(path);
    renderNodeLinkMenu(nodeId, { showFiles: true });
  }
});
mapReturnButton.addEventListener("click", () => {
  const snapshot = mapReturnStack.pop();
  restoreMapSnapshot(snapshot);
  updateMapReturnButton();
});
["pointerdown", "pointerup", "click"].forEach((eventName) => {
  mapReturnButton.addEventListener(eventName, (event) => {
    event.stopPropagation();
  });
});
workspaceCollapseButton.addEventListener("click", () => {
  const collapse = !workspaceSidebar.classList.contains("collapsed");
  setWorkspaceCollapsed(collapse);
  if (!collapse) window.requestAnimationFrame(() => focusWorkspaceFileList());
});
workspaceResizer.addEventListener("pointerdown", (event) => {
  if (workspaceSidebar.classList.contains("collapsed")) return;
  event.preventDefault();
  workspaceResize = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: workspaceSidebar.getBoundingClientRect().width,
  };
  workspaceSidebar.classList.add("resizing");
  workspaceResizer.setPointerCapture(event.pointerId);
});
workspaceResizer.addEventListener("pointermove", (event) => {
  if (!workspaceResize || workspaceResize.pointerId !== event.pointerId) return;
  const nextWidth = clamp(workspaceResize.startWidth + event.clientX - workspaceResize.startX, 190, 420);
  document.documentElement.style.setProperty("--workspace-sidebar-width", `${nextWidth}px`);
});
workspaceResizer.addEventListener("pointerup", (event) => {
  if (!workspaceResize || workspaceResize.pointerId !== event.pointerId) return;
  const width = Math.round(workspaceSidebar.getBoundingClientRect().width);
  if (localStorageAvailable()) localStorage.setItem(WORKSPACE_WIDTH_KEY, String(width));
  workspaceResize = null;
  workspaceSidebar.classList.remove("resizing");
  if (workspaceResizer.hasPointerCapture(event.pointerId)) workspaceResizer.releasePointerCapture(event.pointerId);
});
workspaceResizer.addEventListener("pointercancel", (event) => {
  if (!workspaceResize || workspaceResize.pointerId !== event.pointerId) return;
  workspaceResize = null;
  workspaceSidebar.classList.remove("resizing");
  if (workspaceResizer.hasPointerCapture(event.pointerId)) workspaceResizer.releasePointerCapture(event.pointerId);
});
homeButton.addEventListener("click", openHome);
compareButton.addEventListener("click", openCompareOverlay);
closeHomeButton.addEventListener("click", closeHome);
closeCompareButton.addEventListener("click", closeCompareOverlay);
runCompareButton.addEventListener("click", runMapCompare);
compareOverlay.addEventListener("click", (event) => {
  if (event.target === compareOverlay) closeCompareOverlay();
});
newLocalMapButton.addEventListener("click", () => newLocalMap());
newWorkspaceMapButton.addEventListener("click", () => newLocalMap());
trashButton.addEventListener("click", () => {
  homeMode = homeMode === "trash" ? "maps" : "trash";
  renderHomeList();
});
homeOverlay.addEventListener("click", (event) => {
  if (event.target === homeOverlay) closeHome();
});
homeList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  const card = event.target.closest(".home-card");
  if (!button || !card) return;
  if (button.dataset.action === "open") {
    await autosaveLocal();
    openLocalMap(card.dataset.id);
  } else if (button.dataset.action === "delete") {
    deleteLocalMap(card.dataset.id);
  } else if (button.dataset.action === "restore") {
    restoreLocalMap(card.dataset.id);
  } else if (button.dataset.action === "purge") {
    purgeLocalMap(card.dataset.id);
  }
});
openFileInput.addEventListener("change", () => {
  const file = openFileInput.files?.[0];
  if (file) {
    openProject(file, { status: workspaceDirectoryHandle ? "工程已导入，保存时会写入工作目录" : "工程已导入，保存到浏览器本地" });
  }
  openFileInput.value = "";
});

documentTitleInput.addEventListener("input", () => {
  titleEditedByUser = !shouldUseRootTitle();
  markSaving();
});
document.addEventListener("keydown", (event) => {
  if (!searchState.jumpArmed) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target.matches("input, textarea, select, [contenteditable='true']")) return;
  event.preventDefault();
  event.stopPropagation();
  focusSearchMode();
}, true);
searchInput.addEventListener("input", () => {
  searchState.query = searchInput.value;
  searchState.active = null;
  searchState.jumpArmed = false;
  updateSearchResults();
});
searchInput.addEventListener("focus", () => {
  if (searchState.query.trim()) renderSearchResults();
});
searchCaseToggle.addEventListener("click", () => {
  searchState.caseSensitive = !searchState.caseSensitive;
  searchCaseToggle.setAttribute("aria-pressed", String(searchState.caseSensitive));
  updateSearchResults();
  searchInput.focus({ preventScroll: true });
});
searchScopeToggle.addEventListener("click", () => {
  searchState.scope = searchState.scope === "current" ? "all" : "current";
  const all = searchState.scope === "all";
  searchScopeToggle.textContent = all ? "全部" : "本页";
  searchScopeToggle.setAttribute("aria-pressed", String(all));
  updateSearchResults();
  searchInput.focus({ preventScroll: true });
});
searchResults.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".search-result")) event.preventDefault();
});
searchResults.addEventListener("click", async (event) => {
  const item = event.target.closest(".search-result");
  if (!item) return;
  event.preventDefault();
  await jumpToSearchResult(item.dataset.key);
});
document.addEventListener("pointerdown", (event) => {
  if (event.target.closest("#search-box")) return;
  if (document.activeElement === searchInput) searchResults.hidden = true;
});

document.addEventListener("paste", (event) => {
  if (!nodeDocumentOverlay.hidden) return;
  if (editingId || event.target.matches("input, textarea, select, [contenteditable='true']")) return;
  const imageFile = pastedImageFile(event);
  if (!imageFile) return;
  event.preventDefault();
  attachImageToNode(imageFile, selectedId);
});

nodeDocumentEditor.addEventListener("input", () => syncActiveDocument());
nodeDocumentEditor.addEventListener("paste", (event) => {
  const imageFile = pastedImageFile(event);
  if (imageFile) {
    event.preventDefault();
    insertDocumentImageFile(imageFile);
    return;
  }
  const pasted = normalizePastedDocumentText(event);
  if (!pasted) return;
  if (/^https?:\/\/\S+$/i.test(pasted.trim()) && insertDocumentLink(pasted)) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  insertAtDocumentCursor(pasted);
});
nodeDocumentPreview.addEventListener("click", (event) => {
  const figure = event.target.closest(".document-image");
  if (!figure) {
    clearSelectedDocumentImage();
    return;
  }
  selectDocumentImage(figure);
});
nodeDocumentPreview.addEventListener("dblclick", (event) => {
  const image = event.target.closest(".document-image img");
  if (!image) return;
  event.preventDefault();
  openDocumentImageViewerFromImage(image);
});
nodeDocumentPreview.addEventListener("pointerdown", (event) => {
  const handle = event.target.closest("[data-image-resize]");
  if (!handle) return;
  const figure = handle.closest(".document-image");
  const image = figure?.querySelector("img");
  if (!figure || !image || image.hidden) return;
  event.preventDefault();
  event.stopPropagation();
  selectDocumentImage(figure);
  const rect = image.getBoundingClientRect();
  documentImageResize = {
    pointerId: event.pointerId,
    handle,
    image,
    lineIndex: Number(figure.dataset.imageLine),
    mode: handle.dataset.imageResize,
    startX: event.clientX,
    startY: event.clientY,
    startWidth: rect.width,
    startHeight: rect.height,
    current: { width: rect.width, height: rect.height },
  };
  handle.setPointerCapture(event.pointerId);
});
document.addEventListener("pointermove", (event) => {
  if (!documentImageResize || event.pointerId !== documentImageResize.pointerId) return;
  event.preventDefault();
  const next = imageResizeDimensions(
    documentImageResize.mode,
    documentImageResize.startWidth,
    documentImageResize.startHeight,
    event.clientX - documentImageResize.startX,
    event.clientY - documentImageResize.startY
  );
  documentImageResize.current = next;
  documentImageResize.image.style.width = `${next.width}px`;
  documentImageResize.image.style.height = `${next.height}px`;
  documentImageResize.image.style.objectFit = "contain";
});
document.addEventListener("pointerup", (event) => {
  if (!documentImageResize || event.pointerId !== documentImageResize.pointerId) return;
  event.preventDefault();
  const state = documentImageResize;
  documentImageResize = null;
  try {
    state.handle.releasePointerCapture(event.pointerId);
  } catch {}
  commitDocumentImageResize(state);
});
nodeDocumentEditor.addEventListener("click", (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  const link = linkAtDocumentPosition(nodeDocumentEditor.selectionStart || 0);
  if (!link) return;
  event.preventDefault();
  window.open(link, "_blank", "noopener,noreferrer");
});
closeDocumentButton.addEventListener("click", closeNodeDocument);
nodeDocumentOverlay.addEventListener("click", (event) => {
  if (event.target === nodeDocumentOverlay) closeNodeDocument();
});
copyDocumentButton.addEventListener("click", async () => {
  syncActiveDocument({ markDirty: false });
  try {
    await navigator.clipboard.writeText(nodeDocumentEditor.value);
    showStatus("文档内容已复制");
  } catch {
    nodeDocumentEditor.select();
    document.execCommand("copy");
    showStatus("文档内容已复制");
  }
});
insertImageButton.addEventListener("click", () => documentImageInput.click());
documentImageInput.addEventListener("change", () => {
  const file = documentImageInput.files?.[0];
  if (!file) return;
  insertDocumentImageFile(file);
});
nodeImageInput?.addEventListener("change", async () => {
  const file = nodeImageInput.files?.[0];
  const targetId = pendingNodeImageTargetId || selectedId;
  pendingNodeImageTargetId = null;
  nodeImageInput.value = "";
  if (!file) return;
  await attachImageToNode(file, targetId);
});
documentImageViewer.addEventListener("click", (event) => {
  if (event.target === documentImageViewer) closeDocumentImageViewer();
});
closeImageViewerButton.addEventListener("click", closeDocumentImageViewer);

viewport.addEventListener("wheel", (event) => {
  event.preventDefault();
  viewport.scrollLeft = 0;
  viewport.scrollTop = 0;
  if (event.ctrlKey) {
    setZoomAt(zoom + (event.deltaY > 0 ? -WHEEL_ZOOM_STEP : WHEEL_ZOOM_STEP), event.clientX, event.clientY);
    return;
  }
  if (event.shiftKey && Math.abs(event.deltaX) < 1) {
    pan.x -= event.deltaY;
  } else {
    pan.x -= event.deltaX;
    pan.y -= event.deltaY;
  }
  applyTransform();
  autosaveDirty = true;
}, { passive: false });

let dragStart = null;
let marqueeState = null;

function canvasTouchPoint(event) {
  return {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    targetId: event.target.closest(".topic-node")?.dataset.id || null,
  };
}

function touchPair() {
  return [...activeCanvasTouches.values()].slice(0, 2);
}

function touchDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function touchCenter(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function cancelCanvasMarquee() {
  marqueeState = null;
  selectionMarquee.hidden = true;
  viewport.classList.remove("selecting");
}

function cancelCanvasMousePan() {
  dragStart = null;
  viewport.classList.remove("panning");
}

function safeSetPointerCapture(element, pointerId) {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Some browsers reject synthetic or interrupted touch pointers.
  }
}

function safeReleasePointerCapture(element, pointerId) {
  try {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  } catch {
    // Ignore stale pointer captures.
  }
}

function startTouchGesture(event) {
  if (event.target.closest(".zoom-controls, .map-return-button")) return false;
  event.preventDefault();
  event.stopPropagation();
  activeCanvasTouches.set(event.pointerId, canvasTouchPoint(event));
  safeSetPointerCapture(viewport, event.pointerId);
  cancelCanvasMarquee();
  cancelCanvasMousePan();

  const touches = touchPair();
  if (touches.length >= 2) {
    const [first, second] = touches;
    const center = touchCenter(first, second);
    touchCanvasState = {
      mode: "pinch",
      startDistance: Math.max(1, touchDistance(first, second)),
      startZoom: zoom,
      worldX: (center.x - (viewport.getBoundingClientRect().left + viewport.clientWidth / 2) - pan.x) / zoom,
      worldY: (center.y - (viewport.getBoundingClientRect().top + viewport.clientHeight / 2) - pan.y) / zoom,
    };
    viewport.classList.add("panning");
  } else {
    const touch = touches[0];
    touchCanvasState = {
      mode: "pan",
      pointerId: event.pointerId,
      startX: touch.x,
      startY: touch.y,
      panX: pan.x,
      panY: pan.y,
      moved: false,
      targetId: touch.targetId,
    };
    viewport.classList.add("panning");
  }
  return true;
}

function updateTouchGesture(event) {
  if (!activeCanvasTouches.has(event.pointerId)) return false;
  event.preventDefault();
  event.stopPropagation();
  const previous = activeCanvasTouches.get(event.pointerId);
  activeCanvasTouches.set(event.pointerId, { ...previous, x: event.clientX, y: event.clientY });
  const touches = touchPair();

  if (touches.length >= 2) {
    const [first, second] = touches;
    if (!touchCanvasState || touchCanvasState.mode !== "pinch") {
      const center = touchCenter(first, second);
      touchCanvasState = {
        mode: "pinch",
        startDistance: Math.max(1, touchDistance(first, second)),
        startZoom: zoom,
        worldX: (center.x - (viewport.getBoundingClientRect().left + viewport.clientWidth / 2) - pan.x) / zoom,
        worldY: (center.y - (viewport.getBoundingClientRect().top + viewport.clientHeight / 2) - pan.y) / zoom,
      };
    }
    const center = touchCenter(first, second);
    const viewportRect = viewport.getBoundingClientRect();
    zoom = clamp(touchCanvasState.startZoom * (touchDistance(first, second) / touchCanvasState.startDistance), ZOOM_MIN, ZOOM_MAX);
    pan.x = center.x - (viewportRect.left + viewportRect.width / 2) - touchCanvasState.worldX * zoom;
    pan.y = center.y - (viewportRect.top + viewportRect.height / 2) - touchCanvasState.worldY * zoom;
    applyTransform();
    autosaveDirty = true;
    return true;
  }

  if (touchCanvasState?.mode === "pan" && touchCanvasState.pointerId === event.pointerId) {
    const dx = event.clientX - touchCanvasState.startX;
    const dy = event.clientY - touchCanvasState.startY;
    if (Math.hypot(dx, dy) <= 5 && !touchCanvasState.moved) return true;
    touchCanvasState.moved = true;
    pan.x = touchCanvasState.panX + dx;
    pan.y = touchCanvasState.panY + dy;
    applyTransform();
    autosaveDirty = true;
    return true;
  }
  return true;
}

function finishTouchGesture(event) {
  if (!activeCanvasTouches.has(event.pointerId)) return false;
  event.preventDefault();
  event.stopPropagation();
  const endedTouch = activeCanvasTouches.get(event.pointerId);
  activeCanvasTouches.delete(event.pointerId);
  safeReleasePointerCapture(viewport, event.pointerId);

  if (!activeCanvasTouches.size) {
    const wasTap = event.type !== "pointercancel" && touchCanvasState?.mode === "pan" && !touchCanvasState.moved && endedTouch?.targetId;
    if (wasTap) selectNode(endedTouch.targetId);
    const changedView = touchCanvasState?.mode === "pinch" || touchCanvasState?.moved;
    touchCanvasState = null;
    viewport.classList.remove("panning");
    if (changedView) markSaving();
    return true;
  }

  const touches = touchPair();
  if (touches.length === 1) {
    const touch = touches[0];
    touchCanvasState = {
      mode: "pan",
      pointerId: touch.id,
      startX: touch.x,
      startY: touch.y,
      panX: pan.x,
      panY: pan.y,
      moved: true,
      targetId: touch.targetId,
    };
  }
  return true;
}

function startCanvasPan(event) {
  event.preventDefault();
  event.stopPropagation();
  dragStart = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    panX: pan.x,
    panY: pan.y,
  };
  viewport.classList.add("panning");
  viewport.setPointerCapture(event.pointerId);
}

viewport.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "touch" && startTouchGesture(event)) return;
  if (event.target.closest(".map-return-button")) return;
  const imageBadge = event.target.closest(".node-image-badge");
  const topic = event.target.closest(".topic-node");
  if (event.button === 2 && imageBadge) {
    event.preventDefault();
    event.stopPropagation();
    selectNode(imageBadge.dataset.id);
    showNodeImageMenu(imageBadge.dataset.id, Number(imageBadge.dataset.imageIndex), event.clientX, event.clientY);
    return;
  }
  if (event.button === 2 && event.shiftKey && topic) {
    event.preventDefault();
    event.stopPropagation();
    openNodeDocument(topic.dataset.id);
    return;
  }
  if (event.button === 2 && topic) {
    event.preventDefault();
    event.stopPropagation();
    selectNode(topic.dataset.id);
    showNodeLinkMenu(topic.dataset.id, event.clientX, event.clientY);
    return;
  }
  const wantsPan = event.button === 1 || event.button === 2;
  if (wantsPan) {
    startCanvasPan(event);
    return;
  }
  if (event.target.closest(".zoom-controls")) return;
  if (topic) return;
  if (event.button === 0) {
    event.preventDefault();
    marqueeState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      baseIds: event.ctrlKey || event.metaKey ? new Set(selectedIds) : new Set(),
    };
    viewport.classList.add("selecting");
    viewport.setPointerCapture(event.pointerId);
  }
}, true);

viewport.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch" && updateTouchGesture(event)) return;
  if (dragStart && dragStart.pointerId === event.pointerId) {
    pan.x = dragStart.panX + event.clientX - dragStart.x;
    pan.y = dragStart.panY + event.clientY - dragStart.y;
    applyTransform();
    return;
  }
  if (!marqueeState || marqueeState.pointerId !== event.pointerId) return;
  const dx = event.clientX - marqueeState.startX;
  const dy = event.clientY - marqueeState.startY;
  if (!marqueeState.active && Math.hypot(dx, dy) < 4) return;
  marqueeState.active = true;

  const viewportRect = viewport.getBoundingClientRect();
  const left = Math.min(marqueeState.startX, event.clientX);
  const top = Math.min(marqueeState.startY, event.clientY);
  const right = Math.max(marqueeState.startX, event.clientX);
  const bottom = Math.max(marqueeState.startY, event.clientY);
  selectionMarquee.hidden = false;
  selectionMarquee.style.left = `${left - viewportRect.left}px`;
  selectionMarquee.style.top = `${top - viewportRect.top}px`;
  selectionMarquee.style.width = `${right - left}px`;
  selectionMarquee.style.height = `${bottom - top}px`;

  const matches = [];
  nodesLayer.querySelectorAll(".topic-node").forEach((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom) {
      matches.push(element.dataset.id);
    }
  });
  const nextIds = new Set([...marqueeState.baseIds, ...matches]);
  const primaryId = nextIds.has(selectedId) ? selectedId : matches[0] || [...nextIds][0];
  setSelection([...nextIds], primaryId);
  hintText.textContent = nextIds.size ? `已选择 ${nextIds.size} 个主题` : "拖动框选多个主题";
});

function finishCanvasPointer(event) {
  if (event.pointerType === "touch" && finishTouchGesture(event)) return;
  if (dragStart && dragStart.pointerId === event.pointerId) {
    dragStart = null;
    viewport.classList.remove("panning");
    markSaving();
  }
  if (marqueeState && marqueeState.pointerId === event.pointerId) {
    if (!marqueeState.active && !event.ctrlKey && !event.metaKey) setSelection([], "root");
    marqueeState = null;
    selectionMarquee.hidden = true;
    viewport.classList.remove("selecting");
    hintText.textContent = selectedIds.size > 1
      ? `已选择 ${selectedIds.size} 个主题 · 拖动任一主题可批量移动`
      : "双击主题进行编辑";
  }
  if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
}

viewport.addEventListener("pointerup", finishCanvasPointer);
viewport.addEventListener("pointercancel", finishCanvasPointer);
viewport.addEventListener("mousedown", (event) => {
  if (event.button !== 2) return;
  event.preventDefault();
  event.stopPropagation();
}, true);
viewport.addEventListener("contextmenu", (event) => {
  if (event.target.closest(".node-image-badge")) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const topic = event.target.closest(".topic-node");
  if (event.shiftKey && topic) {
    event.preventDefault();
    event.stopPropagation();
    openNodeDocument(topic.dataset.id);
    return;
  }
  event.preventDefault();
  event.stopPropagation();
}, true);
document.addEventListener("auxclick", (event) => {
  if (event.button !== 2 || !event.target.closest("#canvas-viewport")) return;
  event.preventDefault();
  event.stopPropagation();
}, true);
document.addEventListener("pointerdown", (event) => {
  if (event.button !== 2 || !event.target.closest("#canvas-viewport")) return;
  event.preventDefault();
}, true);
document.addEventListener("pointerup", (event) => {
  if (event.button !== 2 || !event.target.closest("#canvas-viewport")) return;
  event.preventDefault();
}, true);
document.addEventListener("contextmenu", (event) => {
  if (!event.target.closest("#canvas-viewport")) return;
  event.preventDefault();
  event.stopPropagation();
}, true);

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function wrapCanvasText(context, text, maxWidth) {
  const value = String(text || NEW_TOPIC_TEXT).trim();
  const tokens = value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|\s+/gu) || [value];
  const lines = [];
  let line = "";
  tokens.forEach((token) => {
    const isSpace = /^\s+$/.test(token);
    if (isSpace && !line) return;
    const candidate = line + token;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line.trimEnd());
      line = isSpace ? "" : token.trimStart();
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line.trimEnd());
  return lines;
}

function createExportCanvas({ maxPixelRatio = 3, maxLongEdge = 7000 } = {}) {
  if (editingId) finishEditing();
  layoutMap();

  const boxes = nodes.map((node) => {
    const element = nodesLayer.querySelector(`[data-id="${node.id}"]`);
    return {
      node,
      width: element?.offsetWidth || node.width || defaultNodeWidth(node),
      height: element?.offsetHeight || (node.id === "root" ? 76 : 52),
    };
  });
  const boxById = new Map(boxes.map((box) => [box.node.id, box]));
  const padding = 90;
  const minX = Math.min(...boxes.map((box) => box.node.x - box.width / 2)) - padding;
  const maxX = Math.max(...boxes.map((box) => box.node.x + box.width / 2)) + padding;
  const minY = Math.min(...boxes.map((box) => box.node.y - box.height / 2)) - padding;
  const maxY = Math.max(...boxes.map((box) => box.node.y + box.height / 2)) + padding;
  const logicalWidth = Math.ceil(maxX - minX);
  const logicalHeight = Math.ceil(maxY - minY);
  const pixelRatio = Math.min(maxPixelRatio, Math.max(2, maxLongEdge / Math.max(logicalWidth, logicalHeight)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(logicalWidth * pixelRatio);
  canvas.height = Math.ceil(logicalHeight * pixelRatio);
  const context = canvas.getContext("2d");
  context.scale(pixelRatio, pixelRatio);
  context.fillStyle = "#eefbf3";
  context.fillRect(0, 0, logicalWidth, logicalHeight);
  context.translate(-minX, -minY);

  context.lineWidth = 2;
  context.lineCap = "round";
  nodes.filter((node) => node.parentId).forEach((node) => {
    const parent = getNode(node.parentId);
    const parentBox = boxById.get(parent.id);
    const nodeBox = boxById.get(node.id);
    const direction = node.x >= parent.x ? 1 : -1;
    const startX = parent.x + direction * parentBox.width / 2;
    const endX = node.x - direction * nodeBox.width / 2;
    const bend = Math.max(44, Math.abs(endX - startX) * 0.52);
    context.beginPath();
    context.moveTo(startX, parent.y);
    context.bezierCurveTo(
      startX + direction * bend,
      parent.y,
      endX - direction * bend,
      node.y,
      endX,
      node.y
    );
    context.strokeStyle = node.color === "#ffffff" ? "#8ea8cc" : node.color;
    context.globalAlpha = 0.85;
    context.stroke();
  });
  context.globalAlpha = 1;

  boxes.forEach(({ node, width, height }) => {
    const left = node.x - width / 2;
    const top = node.y - height / 2;
    context.save();
    context.shadowColor = "rgba(27, 36, 52, 0.12)";
    context.shadowBlur = node.id === "root" ? 14 : 9;
    context.shadowOffsetY = 4;
    roundedRect(context, left, top, width, height, 8);
    context.fillStyle = node.color;
    context.fill();
    context.restore();

    if (node.id === "root") {
      roundedRect(context, left, top, width, height, 8);
      context.lineWidth = 2;
      context.strokeStyle = "#8dd7c7";
      context.stroke();
    }

    const fontSize = node.id === "root" ? 24 : 16;
    const fontWeight = node.id === "root" ? 700 : 600;
    context.font = `${fontWeight} ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    context.fillStyle = "#26352e";
    context.textAlign = "center";
    context.textBaseline = "middle";
    const lines = wrapCanvasText(context, node.text, width - 38);
    const lineHeight = fontSize * 1.35;
    const firstY = node.y - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, index) => context.fillText(line, node.x, firstY + index * lineHeight));
  });

  return canvas;
}

function exportFilename(extension) {
  return `${defaultFileBaseName()}.${extension}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveBlobToFile(blob, filename, typeInfo) {
  if (!supportsSystemSavePicker()) {
    downloadBlob(blob, filename);
    return true;
  }
  let options;
  try {
    options = {
      id: "zhitu-save-folder",
      suggestedName: filename,
      types: typeInfo ? [typeInfo] : undefined,
    };
    if (workspaceDirectoryHandle && await ensureWorkspacePermission("readwrite")) {
      options.startIn = workspaceDirectoryHandle;
    }
    const handle = await window.showSaveFilePicker(options);
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch (error) {
    if (error?.name === "AbortError") return false;
    if (options?.startIn) {
      try {
        delete options.startIn;
        const handle = await window.showSaveFilePicker(options);
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
      } catch (retryError) {
        if (retryError?.name === "AbortError") return false;
        console.error(retryError);
      }
    }
    console.error(error);
    downloadBlob(blob, filename);
    return true;
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法生成导出文件")), type, quality);
  });
}

function buildPdf(jpegBytes, imageWidth, imageHeight) {
  const encoder = new TextEncoder();
  const pageScale = Math.min(1, 1800 / Math.max(imageWidth, imageHeight));
  const pageWidth = Math.round(imageWidth * pageScale);
  const pageHeight = Math.round(imageHeight * pageScale);
  const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`;
  const objects = [
    encoder.encode("<< /Type /Catalog /Pages 2 0 R >>"),
    encoder.encode("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`),
    encoder.encode(`<< /Length ${content.length} >>\nstream\n${content}endstream`),
    null,
  ];
  const chunks = [new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 226, 227, 207, 211, 10])];
  const offsets = [0];
  let byteLength = chunks[0].length;

  objects.forEach((object, index) => {
    offsets.push(byteLength);
    const prefix = encoder.encode(`${index + 1} 0 obj\n`);
    const suffix = encoder.encode("\nendobj\n");
    chunks.push(prefix);
    byteLength += prefix.length;
    if (index === 4) {
      const imageHeader = encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);
      const imageFooter = encoder.encode("\nendstream");
      chunks.push(imageHeader, jpegBytes, imageFooter);
      byteLength += imageHeader.length + jpegBytes.length + imageFooter.length;
    } else {
      chunks.push(object);
      byteLength += object.length;
    }
    chunks.push(suffix);
    byteLength += suffix.length;
  });

  const xrefOffset = byteLength;
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(encoder.encode(xref));
  return new Blob(chunks, { type: "application/pdf" });
}

async function exportMap(format) {
  const status = document.querySelector(".save-state");
  status.textContent = "正在导出…";
  closeExportMenu();
  try {
    if (format === "mindmap") {
      if (editingId) finishEditing();
      autosaveLocal();
      const json = JSON.stringify(projectData(), null, 2);
      const saved = await saveBlobToFile(
        new Blob([json], { type: "application/json;charset=utf-8" }),
        exportFilename("mindmap.json"),
        {
          description: "Mindmap 工程",
          accept: { "application/json": [".mindmap.json", ".json"] },
        }
      );
      if (!saved) {
        status.textContent = "已取消导出";
        return;
      }
    } else if (format === "png") {
      const canvas = createExportCanvas();
      const blob = await canvasToBlob(canvas, "image/png");
      const saved = await saveBlobToFile(blob, exportFilename("png"), {
        description: "PNG 图片",
        accept: { "image/png": [".png"] },
      });
      if (!saved) {
        status.textContent = "已取消导出";
        return;
      }
    } else {
      const canvas = createExportCanvas({ maxPixelRatio: 3.25, maxLongEdge: 8600 });
      const jpegBlob = await canvasToBlob(canvas, "image/jpeg", 0.97);
      const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
      const pdf = buildPdf(jpegBytes, canvas.width, canvas.height);
      const saved = await saveBlobToFile(pdf, exportFilename("pdf"), {
        description: "PDF 文档",
        accept: { "application/pdf": [".pdf"] },
      });
      if (!saved) {
        status.textContent = "已取消导出";
        return;
      }
    }
    status.textContent = "导出完成";
  } catch (error) {
    console.error(error);
    status.textContent = "导出失败";
  }
  window.setTimeout(() => {
    status.textContent = autosaveDirty ? "等待自动保存" : "本地已保存";
  }, 1600);
}

function closeExportMenu() {
  exportMenu.hidden = true;
  exportButton.setAttribute("aria-expanded", "false");
}

exportButton.addEventListener("click", (event) => {
  event.stopPropagation();
  exportMenu.hidden = !exportMenu.hidden;
  exportButton.setAttribute("aria-expanded", String(!exportMenu.hidden));
});

exportMenu.addEventListener("click", (event) => {
  const item = event.target.closest("[data-export-format]");
  if (item) exportMap(item.dataset.exportFormat);
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".export-control")) closeExportMenu();
});

conflictSaveCopyButton?.addEventListener("click", saveWorkspaceConflictCopy);
conflictOverwriteButton?.addEventListener("click", overwriteWorkspaceConflict);
conflictReloadButton?.addEventListener("click", reloadWorkspaceConflictFile);
conflictDismissButton?.addEventListener("click", () => {
  hideWorkspaceConflictDialog();
  showStatus("冲突仍未处理，自动保存保持暂停", 2400);
});
workspaceConflictOverlay?.addEventListener("click", (event) => {
  if (event.target !== workspaceConflictOverlay) return;
  hideWorkspaceConflictDialog();
  showStatus("冲突仍未处理，自动保存保持暂停", 2400);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && workspaceConflictOverlay && !workspaceConflictOverlay.hidden) {
    hideWorkspaceConflictDialog();
    showStatus("冲突仍未处理，自动保存保持暂停", 2400);
    return;
  }
  if (event.key === "Escape" && !documentImageViewer.hidden) {
    closeDocumentImageViewer();
    return;
  }
  if (event.key === "Escape" && !nodeDocumentOverlay.hidden) {
    closeNodeDocument();
    return;
  }
  if (event.key === "Escape" && compareOverlay && !compareOverlay.hidden) {
    closeCompareOverlay();
    return;
  }
  if (event.key === "Escape" && !homeOverlay.hidden) closeHome();
  if (event.key === "Escape" && !exportMenu.hidden && !editingId) closeExportMenu();
});

window.addEventListener("resize", () => {
  drawConnections();
  applyTransform();
});

window.addEventListener("focus", () => scheduleWorkspaceRefresh(250));

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) scheduleWorkspaceRefresh(250);
});

window.addEventListener("beforeunload", () => {
  const currentMapExists = localStorage.getItem(`${LOCAL_MAP_PREFIX}${currentLocalId}`) !== null;
  if (autosaveDirty || currentMapExists) autosaveLocal();
});

window.setInterval(() => {
  if (autosaveDirty) autosaveLocal();
}, AUTOSAVE_INTERVAL);

function consumeLaunchAction() {
  const params = new URLSearchParams(window.location.search);
  const action = params.get("action");
  if (!action) return;
  window.history.replaceState({}, "", window.location.pathname || "./");
  if (action === "new") {
    newLocalMap();
  } else if (action === "workspace") {
    openWorkspacePanel();
  }
}

async function bootstrapApp() {
  applyProjectData(createDefaultProjectData(), { localId: currentLocalId, status: "", markDirty: false });
  await initializeWorkspaceDirectory();
  renderHomeList();
  render();
  consumeLaunchAction();
  viewport.focus();
}

bootstrapApp();
