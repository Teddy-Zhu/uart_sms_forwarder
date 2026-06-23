# Repository Guidelines

## Project Structure & Module Organization

This repository contains a Go backend and a Vite/React frontend for a UART SMS forwarding service.

- `cmd/serv/main.go` is the backend entry point.
- `internal/` contains backend application code: handlers, services, repositories, middleware, models, utilities, and version metadata.
- `config/` contains Go configuration loading; `config.example.yaml` is the runtime configuration template.
- `web/` contains the React frontend. UI components live in `web/src/components`, pages in `web/src/pages`, API clients in `web/src/api`, and shared helpers in `web/src/lib` or `web/src/utils`.
- `main.lua` is the OpenLuat device script flashed to supported Air780 devices.
- `screenshots/` stores README and documentation images.

## Build, Test, and Development Commands

- `make build-web`: installs frontend dependencies with Yarn and builds the frontend.
- `make dev`: builds a local backend binary into `bin/uart_sms_forwarder`.
- `make run`: runs the backend with `go run cmd/serv/main.go`.
- `make build-release`: builds the frontend and Linux amd64 server release.
- `make clean`: removes `bin/` and `web/dist/`.
- `cd web && yarn dev`: starts the Vite frontend dev server.
- `cd web && yarn build`: type-checks and builds the frontend.
- `cd web && yarn lint`: runs ESLint for frontend code.

Use `docker-compose up -d` for a containerized local deployment after creating a real `config.yaml` from `config.example.yaml`.

## Coding Style & Naming Conventions

Format Go code with `gofmt`; keep package names short, lowercase, and aligned with directory purpose. Backend files generally use snake_case names such as `text_message_service.go` and group logic by layer under `internal/`.

Frontend code uses TypeScript, React, Vite, Tailwind CSS, and Radix UI primitives. Use PascalCase for React components and page files, camelCase for functions and variables, and keep API modules grouped by domain under `web/src/api`.

## Testing Guidelines

There are no dedicated test files or frontend test framework configured yet. For backend changes, add Go tests as `*_test.go` next to the package under test and run targeted commands such as `go test ./internal/service`. For frontend changes, rely on `yarn lint` and `yarn build`; add a test framework before introducing frontend test files.

## Commit & Pull Request Guidelines

Recent commits use short, descriptive summaries, often in Chinese, without a strict Conventional Commits format. Keep commit messages focused on the behavior changed, for example `完善飞行模式的控制` or `Update README.md`.

Pull requests should include a concise description, affected backend/frontend/device areas, configuration or migration notes, and screenshots when UI changes are visible. Link related issues when available and mention the exact checks you ran.

## Security & Configuration Tips

Do not commit real `config.yaml`, secrets, database files, logs, or device-specific credentials. Keep serial device mappings and webhook/email/OIDC credentials local. Use `config.example.yaml` to document new configuration fields.
