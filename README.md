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

Keeps your file icon theme. Zone roots get a codicon on the **right**:

| Zone | Badge |
|------|--------|
| `src/`, `scripts/`, product paths | lock |
| `data/`, `docs/` | gear |
| `public/` (merge) | git-merge |
| `site/` | none |

## Commands

- **Agpiko: Reload workspace zones**
- **Agpiko: Show zone for current file**
- **Agpiko: Verify product integrity**
