const palette = ["#ffd1dc", "#ffd8b5", "#c8f2dc", "#bfe8ff", "#dbcaff", "#fff1b8"];
const LOCAL_INDEX_KEY = "zhitu.localMaps.v1";
const LOCAL_LAST_KEY = "zhitu.lastLocalMap.v1";
const LOCAL_MAP_PREFIX = "zhitu.map.";
const LOCAL_TRASH_KEY = "zhitu.trash.v1";
const AUTOSAVE_INTERVAL = 5000;
const NODE_WIDTH_RULES = {
  root: { min: 300, max: 540, seed: 300, padding: 60, fontSize: 24, fontWeight: 750 },
  branch: { min: 220, max: 420, seed: 220, padding: 54, fontSize: 16, fontWeight: 650 },
};
const sizingContext = document.createElement("canvas").getContext("2d");

function createDefaultNodes() {
  return [
  { id: "root", parentId: null, text: "主题", side: 0, color: "#f7fff9", collapsed: false, width: NODE_WIDTH_RULES.root.seed, x: 0, y: 0 },
  { id: "n1", parentId: "root", text: "分支", side: 1, color: palette[0], collapsed: false, width: NODE_WIDTH_RULES.branch.seed, x: 0, y: 0 },
  { id: "n2", parentId: "root", text: "分支", side: 1, color: palette[1], collapsed: false, width: NODE_WIDTH_RULES.branch.seed, x: 0, y: 0 },
  { id: "n3", parentId: "root", text: "分支", side: -1, color: palette[2], collapsed: false, width: NODE_WIDTH_RULES.branch.seed, x: 0, y: 0 },
  { id: "n4", parentId: "root", text: "分支", side: -1, color: palette[3], collapsed: false, width: NODE_WIDTH_RULES.branch.seed, x: 0, y: 0 },
  ];
}

function createLocalId() {
  return window.crypto?.randomUUID?.() || `map-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
  const lines = String(node.text || (node.id === "root" ? "主题" : "分支"))
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
let editSnapshot = "";
let internalClipboard = null;
let nodeDrag = null;
let nodeResize = null;
let suppressNextClick = false;
let animatingNodeIds = new Set();
let editingSpaceHeld = false;
let currentLocalId = createLocalId();
let autosaveDirty = true;
let suppressAutosaveMark = false;
let homeMode = "maps";

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
const openLocalButton = document.querySelector("#open-local-button");
const saveButton = document.querySelector("#save-button");
const homeButton = document.querySelector("#home-button");
const homeOverlay = document.querySelector("#home-overlay");
const homeList = document.querySelector("#home-list");
const closeHomeButton = document.querySelector("#close-home");
const newLocalMapButton = document.querySelector("#new-local-map");
const trashButton = document.querySelector("#trash-button");
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
let activeDocumentId = null;

function cloneNodes(source = nodes) {
  return source.map((node) => ({ ...node }));
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

function layoutMap() {
  const root = getNode("root");
  root.x = 0;
  root.y = 0;
  const horizontalGap = 118;
  const branchGap = 44;
  const childGap = 32;
  const measureContext = document.createElement("canvas").getContext("2d");

  const estimateTextWidth = (text, font) => {
    measureContext.font = font;
    return measureContext.measureText(text).width;
  };

  const estimateLineCount = (node, maxTextWidth) => {
    const limits = nodeWidthLimits(node);
    const font = `${limits.fontWeight} ${limits.fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    const tokens = String(node.text || "未命名主题").match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|\s+/gu) || [node.text || ""];
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
    return lines;
  };

  nodes.forEach((node) => resolveNodeWidth(node, measureContext));

  const nodeHeight = (node) => {
    const limits = nodeWidthLimits(node);
    const minHeight = node.id === "root" ? 86 : 56;
    const horizontalPadding = limits.padding;
    const verticalPadding = node.id === "root" ? 26 : 24;
    const lineHeight = limits.fontSize * 1.38;
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
    element.className = `topic-node${node.id === "root" ? " root" : ""}${isSelected ? " selected" : ""}${node.id === selectedId && isSelected ? " primary" : ""}${node.id === editingId ? " editing" : ""}${animatingNodeIds.has(node.id) ? " creating" : ""}${node.collapsed ? " collapsed" : ""}`;
    element.dataset.id = node.id;
    element.style.left = `${node.x}px`;
    element.style.top = `${node.y}px`;
    element.style.width = `${node.width || defaultNodeWidth(node)}px`;
    element.style.background = node.color;
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", node.text);
    element.setAttribute("aria-selected", isSelected ? "true" : "false");

    const label = document.createElement("span");
    label.className = "topic-label";
    label.textContent = node.text;
    label.contentEditable = node.id === editingId ? "true" : "false";
    label.spellcheck = false;
    element.append(label);

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

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "connection");
    path.setAttribute("stroke", node.color === "#ffffff" ? "#8ea8cc" : node.color);
    path.setAttribute(
      "d",
      `M ${startX + 3000} ${parent.y + 3000} C ${startX + direction * bend + 3000} ${parent.y + 3000}, ${endX - direction * bend + 3000} ${node.y + 3000}, ${endX + 3000} ${node.y + 3000}`
    );
    connections.append(path);
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
  selectedId = id;
  selectedIds = new Set([id]);
  editingId = id;
  editSnapshot = node.text;
  hintText.textContent = "Enter 完成编辑 · Shift/Space+Enter 换行 · Tab 新建子主题";
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
  if (node && label) node.text = editableText(label) || "未命名主题";
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function defaultNodeDocument(node) {
  return `# ${node?.text || "未命名主题"}\n\n`;
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

  lines.forEach((line) => {
    const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (!line.trim()) {
      flushParagraph();
    } else if (image) {
      flushParagraph();
      output.push(`<figure><img src="${escapeHtml(image[2])}" alt="${escapeHtml(image[1])}"><figcaption>${escapeHtml(image[1])}</figcaption></figure>`);
    } else if (heading) {
      flushParagraph();
      const level = heading[1].length;
      output.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
    } else {
      paragraph.push(escapeHtml(line));
    }
  });
  flushParagraph();
  return output.join("") || "<p></p>";
}

function syncActiveDocument({ markDirty = true } = {}) {
  if (!activeDocumentId) return;
  const node = getNode(activeDocumentId);
  if (!node) return;
  node.document = nodeDocumentEditor.value;
  nodeDocumentPreview.innerHTML = renderMarkdown(node.document);
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
  nodeDocumentTitle.textContent = node.text || "未命名主题";
  nodeDocumentEditor.value = node.document;
  nodeDocumentPreview.innerHTML = renderMarkdown(node.document);
  nodeDocumentOverlay.hidden = false;
  render();
  nodeDocumentEditor.focus({ preventScroll: true });
}

function closeNodeDocument() {
  syncActiveDocument({ markDirty: false });
  activeDocumentId = null;
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

function finishEditing() {
  if (!editingId) return;
  syncEditingText();
  const node = getNode(editingId);
  if (node.text !== editSnapshot) {
    history.push(nodes.map((item) => item.id === node.id ? { ...item, text: editSnapshot } : { ...item }));
    future = [];
    updateHistoryButtons();
    markSaving();
  }
  editingId = null;
  hintText.textContent = "双击主题进行编辑";
  render();
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
    text: "分支",
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
  pushHistory();
  const removeIds = new Set(roots.flatMap((id) => [id, ...descendantsOf(id)]));
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
    nodes: nodes.filter((node) => copiedIds.has(node.id)).map((node) => ({ ...node })),
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
}

function setZoom(nextZoom) {
  zoom = Math.min(1.6, Math.max(0.5, nextZoom));
  applyTransform();
  markSaving();
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
  return {
    format: "mindmap",
    version: 1,
    title: document.querySelector("#document-title").value.trim() || "未命名思维导图",
    savedAt: new Date().toISOString(),
    view: {
      zoom,
      pan: { ...pan },
    },
    nodes: nodes.map(({ id, parentId, text, side, color, collapsed, width, document }) => ({
      id,
      parentId,
      text,
      side,
      color,
      collapsed: Boolean(collapsed),
      width: Number.isFinite(Number(width)) ? Number(width) : undefined,
      document: typeof document === "string" ? document : undefined,
    })),
  };
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

function updateLocalIndexEntry(data, id = currentLocalId) {
  const index = readActiveLocalIndex().filter((item) => item.id !== id);
  index.unshift({
    id,
    title: data.title || "未命名思维导图",
    updatedAt: data.savedAt,
    nodeCount: data.nodes.length,
    preview: data.nodes.find((node) => node.id === "root")?.text || "主题",
  });
  writeLocalIndex(index.slice(0, 80));
}

function autosaveLocal({ silent = true } = {}) {
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

async function saveProject() {
  if (editingId) finishEditing();
  autosaveLocal({ silent: false });
  const json = JSON.stringify(projectData(), null, 2);
  const saved = await saveBlobToFile(
    new Blob([json], { type: "application/json;charset=utf-8" }),
    exportFilename("mindmap.json"),
    {
      description: "Mindmap 工程",
      accept: { "application/json": [".mindmap.json", ".json"] },
    }
  );
  showStatus(saved ? "工程已保存" : "已取消保存");
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
    return {
      id: node.id,
      parentId: node.parentId === null ? null : String(node.parentId),
      text: String(node.text || "未命名主题").slice(0, 500),
      side: node.side === -1 ? -1 : node.side === 0 ? 0 : 1,
      color: /^#[0-9a-f]{6}$/i.test(node.color) ? node.color : "#ffffff",
      collapsed: Boolean(node.collapsed),
      width: Number.isFinite(Number(node.width)) ? clamp(Math.round(Number(node.width)), nodeWidthLimits({ id: node.id === "root" ? "root" : "branch" }).min, nodeWidthLimits({ id: node.id === "root" ? "root" : "branch" }).max) : undefined,
      document: typeof node.document === "string" ? node.document.slice(0, 200000) : undefined,
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
    title: typeof data.title === "string" ? data.title.slice(0, 120) : "未命名思维导图",
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

function applyProjectData(data, { localId = currentLocalId, status = "工程已打开", markDirty = false } = {}) {
  nodes = data.nodes;
  selectedId = "root";
  selectedIds = new Set(["root"]);
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
  zoom = data.view.zoom;
  pan = data.view.pan;
  currentLocalId = localId;
  document.querySelector("#document-title").value = data.title;
  updateHistoryButtons();
  suppressAutosaveMark = !markDirty;
  render();
  suppressAutosaveMark = false;
  autosaveDirty = markDirty;
  if (status) showStatus(status);
  viewport.focus({ preventScroll: true });
}

async function openProject(file) {
  try {
    const data = normalizeProject(JSON.parse(await file.text()));
    applyProjectData(data, { localId: createLocalId(), status: "工程已打开", markDirty: true });
    autosaveLocal();
  } catch (error) {
    console.error(error);
    showStatus("无法打开此工程", 2200);
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
  const index = isTrash ? readLocalTrash() : readActiveLocalIndex({ repair: true });
  if (trashButton) {
    trashButton.textContent = isTrash ? "返回列表" : `垃圾桶 ${readLocalTrash().length ? `(${readLocalTrash().length})` : ""}`;
    trashButton.setAttribute("aria-pressed", isTrash ? "true" : "false");
  }
  homeList.replaceChildren();
  if (!index.length) {
    const empty = document.createElement("div");
    empty.className = "home-empty";
    empty.innerHTML = isTrash
      ? "<strong>垃圾桶是空的</strong><span>删除的本地思维导图会先放在这里，可以恢复。</span>"
      : "<strong>还没有本地思维导图</strong><span>当前画布会每 5 秒自动保存，并出现在这里。</span>";
    homeList.append(empty);
    return;
  }
  index.forEach((item) => {
    const card = document.createElement("article");
    card.className = `home-card${item.id === currentLocalId && !isTrash ? " current" : ""}${isTrash ? " trashed" : ""}`;
    card.dataset.id = item.id;

    const title = document.createElement("strong");
    title.textContent = item.title || "未命名思维导图";
    const meta = document.createElement("span");
    meta.textContent = isTrash
      ? `${item.nodeCount || 0} 个主题 · 删除于 ${formatLocalTime(item.deletedAt)}`
      : `${item.nodeCount || 0} 个主题 · ${formatLocalTime(item.updatedAt)}`;
    const preview = document.createElement("small");
    preview.textContent = item.preview || "主题";

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
      remove.textContent = "移入垃圾桶";
      actions.append(open, remove);
    }
    card.append(title, meta, preview, actions);
    homeList.append(card);
  });
}

function openHome() {
  autosaveLocal();
  homeMode = "maps";
  renderHomeList();
  homeOverlay.hidden = false;
}

function closeHome() {
  homeOverlay.hidden = true;
  viewport.focus({ preventScroll: true });
}

function openLocalMap(id, { keepHomeOpen = false } = {}) {
  try {
    const raw = localStorage.getItem(`${LOCAL_MAP_PREFIX}${id}`);
    if (!raw) throw new Error("本地文件不存在");
    const data = normalizeProject(JSON.parse(raw));
    applyProjectData(data, { localId: id, status: "本地思维导图已打开" });
    localStorage.setItem(LOCAL_LAST_KEY, id);
    autosaveDirty = false;
    if (!keepHomeOpen) closeHome();
  } catch (error) {
    console.error(error);
    showStatus("无法打开本地思维导图", 2200);
  }
}

function deleteLocalMap(id) {
  const raw = localStorage.getItem(`${LOCAL_MAP_PREFIX}${id}`);
  if (!raw) {
    writeLocalIndex(readActiveLocalIndex({ repair: true }).filter((item) => item.id !== id));
    renderHomeList();
    return;
  }
  const item = readActiveLocalIndex({ repair: true }).find((entry) => entry.id === id);
  const title = item?.title || "未命名思维导图";
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
    preview: item?.preview || data?.nodes?.find((node) => node.id === "root")?.text || "主题",
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
      applyProjectData({
        title: "未命名思维导图",
        nodes: createDefaultNodes(),
        view: { zoom: 1, pan: { x: 0, y: 0 } },
      }, {
        localId: createLocalId(),
        status: "已移入垃圾桶",
        markDirty: false,
      });
    }
  }
  showStatus("已移入垃圾桶");
  renderHomeList();
}

function restoreLocalMap(id) {
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
      title: data.title,
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

function purgeLocalMap(id) {
  const entry = readLocalTrash().find((item) => item.id === id);
  const title = entry?.title || "此思维导图";
  if (!window.confirm(`彻底删除“${title}”吗？\n\n此操作无法恢复。`)) return;
  writeLocalTrash(readLocalTrash().filter((item) => item.id !== id));
  renderHomeList();
  showStatus("已彻底删除");
}

function newLocalMap({ keepHomeOpen = false } = {}) {
  homeMode = "maps";
  applyProjectData({
    title: "未命名思维导图",
    nodes: createDefaultNodes(),
    view: { zoom: 1, pan: { x: 0, y: 0 } },
  }, { localId: createLocalId(), status: "已新建本地思维导图", markDirty: true });
  autosaveLocal();
  if (!keepHomeOpen) closeHome();
  renderHomeList();
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

nodesLayer.addEventListener("click", (event) => {
  if (suppressNextClick) return;
  const foldButton = event.target.closest(".fold-toggle");
  if (foldButton) {
    event.preventDefault();
    event.stopPropagation();
    toggleFold(foldButton.dataset.id);
    return;
  }
  const element = event.target.closest(".topic-node");
  if (!element || editingId) return;
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
  getNode(editingId).text = editableText(event.target);
  syncEditingNodeWidth();
  drawConnections();
  markSaving();
});

nodesLayer.addEventListener("keydown", (event) => {
  if (!editingId) return;
  const command = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (event.key === " " && !event.repeat) {
    editingSpaceHeld = true;
  }
  if (command && key === "z") {
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
    const parentId = editingId;
    finishEditing();
    addChild(parentId, true);
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

function clearDragVisuals() {
  nodesLayer.querySelectorAll(".dragging, .drop-target").forEach((element) => {
    element.classList.remove("dragging", "drop-target");
  });
  document.querySelector(".drag-ghost")?.remove();
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
  const resizeHandle = event.target.closest(".resize-handle");
  if (resizeHandle && !editingId && event.button === 0) {
    startNodeResize(event, resizeHandle);
    return;
  }
  if (event.target.closest(".fold-toggle")) return;
  const element = event.target.closest(".topic-node");
  if (!element || editingId || event.button !== 0) return;
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
  };
  nodesLayer.setPointerCapture(event.pointerId);
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
    hintText.textContent = "拖到目标主题上以移动 · Esc 取消";
  }

  const ghost = document.querySelector(".drag-ghost");
  if (ghost) {
    ghost.style.left = `${event.clientX}px`;
    ghost.style.top = `${event.clientY}px`;
  }
  nodesLayer.querySelector(".drop-target")?.classList.remove("drop-target");
  const targetElement = document.elementFromPoint(event.clientX, event.clientY)?.closest(".topic-node");
  const targetId = targetElement?.dataset.id;
  nodeDrag.targetId = isValidDropTarget(nodeDrag.ids, targetId) ? targetId : null;
  if (nodeDrag.targetId) targetElement.classList.add("drop-target");
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

  const targetNode = getNode(dragState.targetId);
  const draggedNodes = dragState.ids.map((id) => getNode(id)).filter(Boolean);
  if (!draggedNodes.length || !targetNode || draggedNodes.every((node) => node.parentId === targetNode.id)) {
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
    addChild();
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

document.addEventListener("keydown", (event) => {
  const command = event.ctrlKey || event.metaKey;
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
  const editingText = editingId || event.target.matches("input, [contenteditable='true']");
  if (key === "s") {
    event.preventDefault();
    saveProject();
  } else if (key === "o") {
    event.preventDefault();
    openFileInput.click();
  } else if (key === "c" && !editingText) {
    event.preventDefault();
    copySelectedSubtree();
  } else if (key === "v" && !editingText) {
    event.preventDefault();
    pasteSubtree();
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
document.querySelector("#zoom-in").addEventListener("click", () => setZoom(zoom + 0.1));
document.querySelector("#zoom-out").addEventListener("click", () => setZoom(zoom - 0.1));
document.querySelector("#fit-button").addEventListener("click", fitCanvas);
undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);
saveButton.addEventListener("click", saveProject);
openLocalButton.addEventListener("click", () => openFileInput.click());
homeButton.addEventListener("click", openHome);
closeHomeButton.addEventListener("click", closeHome);
newLocalMapButton.addEventListener("click", () => newLocalMap());
trashButton.addEventListener("click", () => {
  homeMode = homeMode === "trash" ? "maps" : "trash";
  renderHomeList();
});
homeOverlay.addEventListener("click", (event) => {
  if (event.target === homeOverlay) closeHome();
});
homeList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  const card = event.target.closest(".home-card");
  if (!button || !card) return;
  if (button.dataset.action === "open") {
    autosaveLocal();
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
  if (file) openProject(file);
});

document.querySelector("#document-title").addEventListener("input", markSaving);

nodeDocumentEditor.addEventListener("input", () => syncActiveDocument());
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
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    insertAtDocumentCursor(`\n\n![${file.name}](${reader.result})\n\n`);
    documentImageInput.value = "";
  });
  reader.readAsDataURL(file);
});

viewport.addEventListener("wheel", (event) => {
  event.preventDefault();
  viewport.scrollLeft = 0;
  viewport.scrollTop = 0;
  if (event.ctrlKey) {
    setZoom(zoom + (event.deltaY > 0 ? -0.08 : 0.08));
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
  const topic = event.target.closest(".topic-node");
  if (event.button === 2 && event.shiftKey && topic) {
    event.preventDefault();
    event.stopPropagation();
    openNodeDocument(topic.dataset.id);
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
  const value = String(text || "未命名主题").trim();
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

function createExportCanvas() {
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
  const pixelRatio = Math.min(3, Math.max(2, 7000 / Math.max(logicalWidth, logicalHeight)));
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
  const title = document.querySelector("#document-title").value.trim() || "思维导图";
  const safeTitle = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  return `${safeTitle}.${extension}`;
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
  if (!window.showSaveFilePicker) {
    downloadBlob(blob, filename);
    return true;
  }
  try {
    const handle = await window.showSaveFilePicker({
      id: "zhitu-save-folder",
      suggestedName: filename,
      types: typeInfo ? [typeInfo] : undefined,
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch (error) {
    if (error?.name === "AbortError") return false;
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
  const pageScale = Math.min(1, 1440 / Math.max(imageWidth, imageHeight));
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
      const canvas = createExportCanvas();
      const jpegBlob = await canvasToBlob(canvas, "image/jpeg", 0.95);
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

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !nodeDocumentOverlay.hidden) {
    closeNodeDocument();
    return;
  }
  if (event.key === "Escape" && !homeOverlay.hidden) closeHome();
  if (event.key === "Escape" && !exportMenu.hidden && !editingId) closeExportMenu();
});

window.addEventListener("resize", () => {
  drawConnections();
  applyTransform();
});

window.addEventListener("beforeunload", () => {
  const currentMapExists = localStorage.getItem(`${LOCAL_MAP_PREFIX}${currentLocalId}`) !== null;
  if (autosaveDirty || currentMapExists) autosaveLocal();
});

window.setInterval(() => {
  if (autosaveDirty) autosaveLocal();
}, AUTOSAVE_INTERVAL);

restoreLastLocalMap();
renderHomeList();
render();
viewport.focus();
