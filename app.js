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

nodesLayer.addEventListener("click", (event) => {
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
  if (!command) return;
  if (event.key.toLowerCase() === "z" && event.shiftKey) {
    event.preventDefault();
    redo();
  } else if (event.key.toLowerCase() === "z") {
    event.preventDefault();
    undo();
  } else if (event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
  }
});

document.querySelector("#add-button").addEventListener("click", () => addChild());
document.querySelector("#edit-button").addEventListener("click", () => beginEditing());
document.querySelector("#delete-button").addEventListener("click", deleteSelected);
document.querySelector("#zoom-in").addEventListener("click", () => setZoom(zoom + 0.1));
document.querySelector("#zoom-out").addEventListener("click", () => setZoom(zoom - 0.1));
document.querySelector("#fit-button").addEventListener("click", fitCanvas);
undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);

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
