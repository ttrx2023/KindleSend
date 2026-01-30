# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
KindleSend is a desktop application built with [Wails](https://wails.io/) (Go + Vite) that allows users to scan local directories for e-books and send them to a Kindle via email.

- **Backend**: Go (Wails)
- **Frontend**: Vite (Node.js/npm)
- **Architecture**: Single-process desktop app where Go handles file system/network operations and frontend handles UI.

## Build & Development Commands

### Prerequisites
- Go
- Node.js + npm
- Wails CLI (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`)

### Common Commands
- **Start Development Server**: `wails dev` (Runs backend and frontend with hot reload)
- **Build Production Binary**: `wails build` (Output: `build/bin/KindleSend.exe`)
- **Install Frontend Dependencies**: `cd frontend && npm install`
- **Build Frontend Only**: `cd frontend && npm run build`

## Code Structure

### Backend (Go)
- **`main.go`**: Application entry point. Configures the Wails application window, assets, and binds the `App` struct to the frontend.
- **`app.go`**: Core business logic.
  - **`App` struct**: The main controller. Methods exported to frontend are bound here.
  - **Configuration**: JSON-based config stored in the user's config directory (`%AppData%/KindleSend/config.json` on Windows).
  - **Email Logic**: Uses `net/smtp` and `github.com/jordan-wright/email` to send files. Currently hardcoded for QQ Mail SMTP (`smtp.qq.com`).
  - **File Scanning**: Scans specific extensions (.epub, .mobi, .pdf, .azw3, .txt) in the configured download path.

### Frontend (`frontend/`)
- Standard Vite project structure.
- Communicates with Go backend via Wails runtime (auto-generated bindings).

## Architecture Notes
- **State Management**: Configuration is loaded from disk on startup and saved explicitly via `SaveSettings`.
- **Security**:
  - Email passwords/auth codes are stored in plain text in the local config file.
  - SMTP connection uses TLS.
- **File Handling**: The app reads files locally and attaches them to emails. It performs basic filename cleaning (e.g., removing "(Z-Library)" suffixes) before sending.
