# Agpiko Workspace (VS Code / Cursor)

Extension for Agpiko installs: zone map + product integrity.

**Repo:** https://github.com/androot-dev/agpiko-vscode

## Install

```bash
git clone https://github.com/androot-dev/agpiko-vscode.git
cursor --install-extension ./agpiko-vscode
```

Or: **Developer: Install Extension from Location…** → cloned folder → **Reload Window**.

## Explorer badges

Keeps your file icon theme. Zone **roots** get a short mark on the **right** (from `agpiko.workspace.json`):

| Zone | Badge |
|------|--------|
| `src/`, `scripts/`, product paths | ✕ |
| `data/`, `docs/` | ⌀ |
| `public/` (merge) | ~ |
| `site/` | none |

Ignored-by-git files (e.g. under `data/`) may show a separate Git “ignored” icon — that is not Agpiko.

## Commands

- **Agpiko: Reload workspace zones**
- **Agpiko: Show zone for current file**
- **Agpiko: Verify product integrity**
