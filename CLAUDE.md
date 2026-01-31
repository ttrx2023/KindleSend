# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

- **Start Dev Server**: `wails dev` (starts backend + frontend with hot reload)
- **Build Production**: `wails build` (creates `build/bin/KindleSend.exe`)
- **Install Frontend Deps**: `cd frontend && npm install`
- **Build Frontend Only**: `cd frontend && npm run build`
- **Run Tests**: No tests currently exist in the codebase.
- **Lint**: `go vet ./...` (backend), `npm run lint` (frontend - if available)

## Architecture

KindleSend is a desktop application using the **Wails** framework (Go backend + Vite/Web frontend).

### Backend (Go)
- **Entry Point**: `main.go` initializes the Wails application, window settings, and binds the `App` struct.
- **Core Logic (`app.go`)**:
  - **App Struct**: Methods bound here are exposed to the frontend.
  - **Configuration**: JSON-based config (`%AppData%/KindleSend/config.json`). Note: Stores email credentials in plain text.
  - **Email**: Uses `net/smtp` and `jordan-wright/email`. Hardcoded for QQ Mail (`smtp.qq.com`) using TLS (port 465 send, 587 test).
  - **File Scanning**: Scans `downloadPath` for specific e-book formats (`.epub`, `.mobi`, `.pdf`, `.azw3`, `.txt`).

### Frontend (Vite + JS)
- Located in `frontend/`.
- Standard Vite project structure (`src/main.js`, `style.css`).
- Interacts with backend via auto-generated Wails bindings (window.go.main.App).
- Listens for backend events (e.g., "send-progress") via `wailsRuntime.EventsEmit`.

## Key Features & Implementation Details
- **Settings**: Loaded from disk on startup/demand. explicitly saved via `SaveSettings`.
- **Async Operations**: `SendSelectedBooks` runs in a goroutine to prevent UI blocking, emitting progress events back to the UI.
- **File Processing**: Filenames are sanitized (e.g., removing suffixes like "(Z-Library)") before attachment.
- **Event Names**:
  - `send-progress`: Carries status updates during bulk email sending.

## Conventions
- **Search**: The app uses a user-configurable URL template for searching books (replaces `%s` with query).
- **Dependencies**: Managed via `go.mod` (Go) and `frontend/package.json` (Node).
