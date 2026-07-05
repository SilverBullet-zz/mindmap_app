# Mindmap App

A lightweight, dependency-free mind map editor inspired by XMind.

## Features

- Center topic and automatically arranged branches
- Mouse selection with persistent visual feedback
- Inline topic editing
- Keyboard navigation with arrow keys
- `Enter` to create a child branch
- `Esc` to leave editing mode
- Copy and paste complete topic subtrees
- Drag topics onto another topic to reorganize the hierarchy
- Undo, redo, delete, zoom, and canvas panning
- Native `.mindmap.json` project save and open
- High-resolution PNG and PDF export

## Project files

Use the folder and disk icons in the top toolbar to open or save an editable
`.mindmap.json` project. This native format preserves the document title, topic
hierarchy, branch sides, colors, and viewport state.

Select a topic and press `Ctrl+C`, then select a destination topic and press
`Ctrl+V` to copy the complete subtree. A non-root topic can also be dragged onto
another topic to move it there.

Drag on empty canvas space with the left mouse button to select multiple topics.
Dragging any selected topic moves the selected top-level topics as a group.
Drag with the middle mouse button, or use the mouse wheel, to pan the canvas.
Use `Ctrl` with the mouse wheel to zoom.

## Run locally

The app is built with plain HTML, CSS, and JavaScript. Open `index.html` directly,
or start a local server:

```powershell
python -m http.server 4173
```

Then visit `http://127.0.0.1:4173`.

## Collaboration

Create a branch for each change:

```powershell
git switch -c feature/your-feature
git add .
git commit -m "feat: describe the change"
git push -u origin feature/your-feature
```

Open a pull request on GitHub and merge it after review.
