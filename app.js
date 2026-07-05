const palette = ["#ff6b70", "#ff9e63", "#53b7a8", "#7b9ee8", "#b17ad3", "#e3b94f"];

let nodes = [
  { id: "root", parentId: null, text: "中心主题", side: 0, color: "#ffffff", x: 0, y: 0 },
  { id: "n1", parentId: "root", text: "分支主题 1", side: 1, color: palette[0], x: 0, y: 0 },
  { id: "n2", parentId: "root", text: "分支主题 2", side: 1, color: palette[1], x: 0, y: 0 },
  { id: "n3", parentId: "root", text: "分支主题 3", side: -1, color: "#8fd2b4", x: 0, y: 0 },
  { id: "n4", parentId: "root", text: "分支主题 4", side: -1, color: "#7edbd0", x: 0, y: 0 },
];

let selectedId = "root";
let editingId = null;
let nodeCounter = 5;
let zoom = 1;
let pan = { x: 0, y: 0 };
let history = [];
let future = [];
let editSnapshot = "";
let internalClipboard = null;
let nodeDrag = null;
let suppressNextClick = false;

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
const openButton = document.querySelector("#open-button");
const saveButton = document.querySelector("#save-button");
const openFileInput = document.querySelector("#open-file-input");

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
  const label = document.querySelector(".save-state");
  label.textContent = "保存中…";
  window.clearTimeout(markSaving.timer);
  markSaving.timer = window.setTimeout(() => {
    label.textContent = "已保存";
  }, 450);
}

function showStatus(text, duration = 1300) {
  const label = document.querySelector(".save-state");
  window.clearTimeout(markSaving.timer);
  label.textContent = text;
  markSaving.timer = window.setTimeout(() => {
    label.textContent = "已保存";
  }, duration);
}

function getNode(id) {
  return nodes.find((node) => node.id === id);
}

function childrenOf(id) {
  return nodes.filter((node) => node.parentId === id);
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

function leafWeight(id) {
  const children = childrenOf(id);
  return children.length ? children.reduce((sum, child) => sum + leafWeight(child.id), 0) : 1;
}

function layoutMap() {
  const root = getNode("root");
  root.x = 0;
  root.y = 0;
  const levelGap = 260;
  const rowGap = 96;

  [-1, 1].forEach((side) => {
    const firstLevel = childrenOf("root").filter((node) => node.side === side);
    const totalWeight = firstLevel.reduce((sum, node) => sum + leafWeight(node.id), 0);
    let cursor = -(totalWeight * rowGap) / 2;

    const positionSubtree = (node, depth) => {
      const weight = leafWeight(node.id);
      const centerY = cursor + (weight * rowGap) / 2;
      node.x = side * depth * levelGap;
      node.y = centerY;

      const children = childrenOf(node.id);
      if (!children.length) {
        cursor += rowGap;
        return;
      }

      children.forEach((child) => {
        child.side = side;
        positionSubtree(child, depth + 1);
      });
      node.y = children.reduce((sum, child) => sum + child.y, 0) / children.length;
    };

    firstLevel.forEach((node) => positionSubtree(node, 1));
  });
}

function applyTransform() {
  stage.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

function render() {
  layoutMap();
  nodesLayer.replaceChildren();

  nodes.forEach((node) => {
    const element = document.createElement("div");
    element.className = `topic-node${node.id === "root" ? " root" : ""}${node.id === selectedId ? " selected" : ""}${node.id === editingId ? " editing" : ""}`;
    element.dataset.id = node.id;
    element.style.left = `${node.x}px`;
    element.style.top = `${node.y}px`;
    element.style.background = node.color;
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", node.text);
    element.setAttribute("aria-selected", node.id === selectedId ? "true" : "false");

    const label = document.createElement("span");
    label.className = "topic-label";
    label.textContent = node.text;
    label.contentEditable = node.id === editingId ? "true" : "false";
    label.spellcheck = false;
    element.append(label);
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
  }
}

function drawConnections() {
  connections.replaceChildren();
  nodes.filter((node) => node.parentId).forEach((node) => {
    const parent = getNode(node.parentId);
    if (!parent) return;
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
  editingId = null;
  hintText.textContent = "双击主题进行编辑";
  render();
  viewport.focus({ preventScroll: true });
}

function beginEditing(id = selectedId, selectAll = false) {
  const node = getNode(id);
  if (!node) return;
  selectedId = id;
  editingId = id;
  editSnapshot = node.text;
  hintText.textContent = "Enter 新建分支 · Esc 完成编辑";
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
  if (node && label) node.text = label.textContent.replace(/\n/g, "").trim() || "未命名主题";
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
  const siblings = childrenOf(parentId);
  const side = chooseSide(parent);
  const id = `n${nodeCounter++}`;
  nodes.push({
    id,
    parentId,
    text: "新分支主题",
    side,
    color: parent.id === "root" ? palette[(siblings.length + (side === -1 ? 2 : 0)) % palette.length] : parent.color,
    x: 0,
    y: 0,
  });
  selectedId = id;
  editingId = null;
  render();
  if (startEditing) beginEditing(id, true);
}

function deleteSelected() {
  if (selectedId === "root") return;
  const node = getNode(selectedId);
  if (!node) return;
  pushHistory();
  const removeIds = new Set([selectedId, ...descendantsOf(selectedId)]);
  selectedId = node.parentId;
  editingId = null;
  nodes = nodes.filter((item) => !removeIds.has(item.id));
  render();
}

function copySelectedSubtree() {
  const root = getNode(selectedId);
  if (!root) return;
  const copiedIds = new Set([root.id, ...descendantsOf(root.id)]);
  internalClipboard = {
    rootId: root.id,
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
  const rootSide = target.id === "root" ? chooseSide(target) : target.side || 1;
  const pastedNodes = internalClipboard.nodes.map((node) => ({
    ...node,
    id: idMap.get(node.id),
    parentId: node.id === internalClipboard.rootId ? target.id : idMap.get(node.parentId),
    side: rootSide,
    x: 0,
    y: 0,
  }));
  nodes.push(...pastedNodes);
  selectedId = idMap.get(internalClipboard.rootId);
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

  const candidates = nodes
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
  if (!history.length) return;
  if (editingId) finishEditing();
  future.push(cloneNodes());
  nodes = history.pop();
  selectedId = getNode(selectedId) ? selectedId : "root";
  updateHistoryButtons();
  render();
}

function redo() {
  if (!future.length) return;
  history.push(cloneNodes());
  nodes = future.pop();
  selectedId = getNode(selectedId) ? selectedId : "root";
  updateHistoryButtons();
  render();
}

function setZoom(nextZoom) {
  zoom = Math.min(1.6, Math.max(0.5, nextZoom));
  applyTransform();
}

function fitCanvas() {
  pan = { x: 0, y: 0 };
  const maxX = Math.max(...nodes.map((node) => Math.abs(node.x))) + 170;
  const maxY = Math.max(...nodes.map((node) => Math.abs(node.y))) + 70;
  const availableWidth = Math.max(320, viewport.clientWidth - 100);
  const availableHeight = Math.max(260, viewport.clientHeight - 100);
  setZoom(Math.min(1, availableWidth / (maxX * 2), availableHeight / (maxY * 2)));
}

function projectData() {
  return {
    format: "mindmap",
    version: 1,
    title: document.querySelector("#document-title").value.trim() || "未命名思维导图",
    savedAt: new Date().toISOString(),
    view: {
      zoom,
      pan: { ...pan },
    },
    nodes: nodes.map(({ id, parentId, text, side, color }) => ({
      id,
      parentId,
      text,
      side,
      color,
    })),
  };
}

function saveProject() {
  if (editingId) finishEditing();
  const json = JSON.stringify(projectData(), null, 2);
  downloadBlob(new Blob([json], { type: "application/json;charset=utf-8" }), exportFilename("mindmap.json"));
  showStatus("工程已保存");
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

async function openProject(file) {
  try {
    const data = normalizeProject(JSON.parse(await file.text()));
    nodes = data.nodes;
    selectedId = "root";
    editingId = null;
    internalClipboard = null;
    history = [];
    future = [];
    nodeCounter = Math.max(
      1,
      ...nodes.map((node) => Number(node.id.match(/^n(\d+)$/)?.[1] || 0))
    ) + 1;
    zoom = data.view.zoom;
    pan = data.view.pan;
    document.querySelector("#document-title").value = data.title;
    updateHistoryButtons();
    render();
    showStatus("工程已打开");
    viewport.focus({ preventScroll: true });
  } catch (error) {
    console.error(error);
    showStatus("无法打开此工程", 2200);
  } finally {
    openFileInput.value = "";
  }
}

nodesLayer.addEventListener("click", (event) => {
  if (suppressNextClick) return;
  const element = event.target.closest(".topic-node");
  if (!element || editingId) return;
  selectNode(element.dataset.id);
});

nodesLayer.addEventListener("dblclick", (event) => {
  const element = event.target.closest(".topic-node");
  if (!element) return;
  event.preventDefault();
  beginEditing(element.dataset.id);
});

nodesLayer.addEventListener("input", (event) => {
  if (!event.target.matches(".topic-label") || !editingId) return;
  getNode(editingId).text = event.target.textContent.replace(/\n/g, "");
  drawConnections();
});

nodesLayer.addEventListener("keydown", (event) => {
  if (!editingId) return;
  if (event.key === "Enter") {
    event.preventDefault();
    syncEditingText();
    const parentId = editingId;
    finishEditing();
    addChild(parentId, true);
  } else if (event.key === "Escape") {
    event.preventDefault();
    finishEditing();
  }
});

function isValidDropTarget(draggedId, targetId) {
  if (!targetId || draggedId === targetId) return false;
  return !descendantsOf(draggedId).includes(targetId);
}

function clearDragVisuals() {
  nodesLayer.querySelectorAll(".dragging, .drop-target").forEach((element) => {
    element.classList.remove("dragging", "drop-target");
  });
  document.querySelector(".drag-ghost")?.remove();
}

nodesLayer.addEventListener("pointerdown", (event) => {
  const element = event.target.closest(".topic-node");
  if (!element || editingId || event.button !== 0 || element.dataset.id === "root") return;
  selectedId = element.dataset.id;
  nodesLayer.querySelectorAll(".topic-node.selected").forEach((nodeElement) => {
    nodeElement.classList.toggle("selected", nodeElement === element);
  });
  nodeDrag = {
    id: element.dataset.id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
    targetId: null,
  };
  nodesLayer.setPointerCapture(event.pointerId);
});

nodesLayer.addEventListener("pointermove", (event) => {
  if (!nodeDrag || nodeDrag.pointerId !== event.pointerId) return;
  const distance = Math.hypot(event.clientX - nodeDrag.startX, event.clientY - nodeDrag.startY);
  if (!nodeDrag.active && distance < 6) return;

  if (!nodeDrag.active) {
    nodeDrag.active = true;
    nodesLayer.querySelector(`[data-id="${nodeDrag.id}"]`)?.classList.add("dragging");
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = getNode(nodeDrag.id)?.text || "";
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
  nodeDrag.targetId = isValidDropTarget(nodeDrag.id, targetId) ? targetId : null;
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

  const draggedNode = getNode(dragState.id);
  const targetNode = getNode(dragState.targetId);
  if (!draggedNode || !targetNode || draggedNode.parentId === targetNode.id) {
    render();
    return;
  }
  pushHistory();
  draggedNode.parentId = targetNode.id;
  draggedNode.side = targetNode.id === "root" ? chooseSide(targetNode) : targetNode.side || 1;
  selectedId = draggedNode.id;
  render();
  showStatus(`已移到“${targetNode.text}”下`);
}

nodesLayer.addEventListener("pointerup", (event) => finishNodeDrag(event));
nodesLayer.addEventListener("pointercancel", (event) => finishNodeDrag(event, true));

viewport.addEventListener("keydown", (event) => {
  if (editingId || event.target.matches("input")) return;
  if (event.key.startsWith("Arrow")) {
    event.preventDefault();
    navigate(event.key);
  } else if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    addChild();
  } else if (event.key === "F2") {
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
openButton.addEventListener("click", () => openFileInput.click());
openFileInput.addEventListener("change", () => {
  const file = openFileInput.files?.[0];
  if (file) openProject(file);
});

document.querySelector("#document-title").addEventListener("input", markSaving);

viewport.addEventListener("wheel", (event) => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  setZoom(zoom + (event.deltaY > 0 ? -0.08 : 0.08));
}, { passive: false });

let dragStart = null;
viewport.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".topic-node") || event.target.closest(".zoom-controls")) return;
  dragStart = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
  viewport.classList.add("panning");
  viewport.setPointerCapture(event.pointerId);
});

viewport.addEventListener("pointermove", (event) => {
  if (!dragStart) return;
  pan.x = dragStart.panX + event.clientX - dragStart.x;
  pan.y = dragStart.panY + event.clientY - dragStart.y;
  applyTransform();
});

viewport.addEventListener("pointerup", (event) => {
  dragStart = null;
  viewport.classList.remove("panning");
  if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
});

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
  const characters = Array.from(text || "未命名主题");
  const lines = [];
  let line = "";
  characters.forEach((character) => {
    const candidate = line + character;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = character;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  return lines;
}

function createExportCanvas() {
  if (editingId) finishEditing();
  layoutMap();

  const boxes = nodes.map((node) => {
    const element = nodesLayer.querySelector(`[data-id="${node.id}"]`);
    return {
      node,
      width: element?.offsetWidth || (node.id === "root" ? 210 : 156),
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
  context.fillStyle = "#ffffff";
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
      context.strokeStyle = "#303846";
      context.stroke();
    }

    const fontSize = node.id === "root" ? 24 : 16;
    const fontWeight = node.id === "root" ? 700 : 600;
    context.font = `${fontWeight} ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    context.fillStyle = "#19202a";
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
    const canvas = createExportCanvas();
    if (format === "png") {
      const blob = await canvasToBlob(canvas, "image/png");
      downloadBlob(blob, exportFilename("png"));
    } else {
      const jpegBlob = await canvasToBlob(canvas, "image/jpeg", 0.95);
      const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
      const pdf = buildPdf(jpegBytes, canvas.width, canvas.height);
      downloadBlob(pdf, exportFilename("pdf"));
    }
    status.textContent = "导出完成";
  } catch (error) {
    console.error(error);
    status.textContent = "导出失败";
  }
  window.setTimeout(() => {
    status.textContent = "已保存";
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
  if (event.key === "Escape" && !exportMenu.hidden && !editingId) closeExportMenu();
});

window.addEventListener("resize", () => {
  drawConnections();
  applyTransform();
});

render();
viewport.focus();
