# Mindmap App

A lightweight, dependency-free mind map editor inspired by XMind.

## Features

- Center topic and automatically arranged branches
- Mouse selection with persistent visual feedback
- Inline topic editing
- Keyboard navigation with arrow keys
- `Enter` to create a child branch
- `Esc` to leave editing mode
- Undo, redo, delete, zoom, and canvas panning
- High-resolution PNG and PDF export

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

