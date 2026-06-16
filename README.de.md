# ORG-II

[English](README.md) · [Français](README.fr.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [Español](README.es.md) · [Русский](README.ru.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md) · [Polski](README.pl.md)

ORG-II ist ein open-source agentic Development Framework, gebaut mit Rust und Tauri für local-first Ausführung mit weniger als 100 MB auf der Festplatte.

Es ist nicht nur ein weiteres AI-Coding-Tool; es ist ein Experiment zu Mensch/Agent-Organisationen und org-level Alignment. Agents werden besser, aber Zusammenarbeit, Observability, Struktur und geteilte Verantwortung halten nicht Schritt — und werden in manchen Fällen schlechter. Cursor, Claude Code und ähnliche Tools behandeln Agents oft wie ausgelagerte Assistenten: nützlich für Output, aber schwer zu auditieren, zu koordinieren, auszurichten oder auf Systemebene weiterzuentwickeln.

ORG-II untersucht ein anderes Modell: Agents als persistente, beobachtbare Kollegen innerhalb einer strukturierten Organisation. Statt zustandslosen, schwer überprüfbaren AI IDE Sessions führt es wiederholbare Agent-Ausführung, sitzungsübergreifendes Gedächtnis, AI blame und eine local-first Rust Runtime ein, damit Menschen, Agents und Teams rund um gemeinsamen Kontext und ausgerichtete Ziele zusammenarbeiten können.

## Kernfunktionen

- Lang laufende Sessions mit wiederholbaren Ausführungstraces für Audit, Review und Debugging.
- Rust-basierte Agents, die mit Ihren vorhandenen API keys und Agent-Abonnements funktionieren.
- GUI, CLI, Terminal, Git, Browser, LSP, Timeline und Datenbankwerkzeuge.
- Sitzungsübergreifendes Gedächtnis, Wissensaustausch zwischen Agents und geteilter Workspace-Zustand.
- Ressourcenbewusste Ausführung, die auf CPU, RAM und Verfügbarkeit menschlicher Aufmerksamkeit reagieren kann.
- Agent-powered GUI end-to-end Tests für überwachte Selbstevolution.
- Scheduling und automatisch gestartete Sessions, damit Agents über Nacht laufen oder während Ihrer Abwesenheit weiterarbeiten können.
- Oberflächen für org-level Alignment zur Koordination von Menschen, Agents, Zielen und Verantwortlichkeit (WIP).
- Session-Zusammenarbeit und Gruppen-issue-workflows über selbst gehostetes Supabase (WIP).

## Demo

https://github.com/user-attachments/assets/bd4833d2-4cc4-4971-9805-84529b14d01a

![ORGII GitHub-Browser-Demo](assets/github-browser-demo.png)

![ORGII Agent-Scheduling-Demo](assets/agent-scheduling-demo.png)

## Download

Laden Sie die neueste ORGII desktop app von der [Releases](https://github.com/YORG-AI/ORGII/releases)-Seite herunter. Öffnen Sie die neueste release, laden Sie den Installer oder das app bundle für Ihre Plattform herunter und folgen Sie den Hinweisen Ihres Betriebssystems, um ORGII zu installieren.

## Aus dem Quellcode entwickeln

Zum Bauen oder Beitragen aus dem Quellcode:

```bash
pnpm install
pnpm run download:sidecars
pnpm run tauri:dev
```

Weitere Details zum Beitragen finden Sie in [CONTRIBUTING.md](CONTRIBUTING.md). Wir bitten alle, respektvoll und empathisch zu sein; siehe [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Optionale native sidecars

Browser Use und Computer Use hängen von optionalen nativen helpers für Browser-Automatisierung und macOS-Bildschirmautomatisierung ab:

- `agent-browser` wird aus den `vercel-labs/agent-browser` releases für das aktuelle OS/CPU heruntergeladen.
- `peekaboo` wird unter macOS aus den `steipete/peekaboo` releases heruntergeladen.

Computer Use ist derzeit nur unter macOS verfügbar. Browser Use kann `agent-browser` auf unterstützten Plattformen verwenden.

Wenn ein sidecar fehlt, erstellt der Rust build eine kleine placeholder resource, damit Development-builds fortgesetzt werden können. Die zugehörige Funktion kann auf `PATH` zurückfallen oder nicht verfügbar bleiben, bis Sie `pnpm run download:sidecars` ausführen.

## Lizenz

ORGII ist unter der GNU Affero General Public License v3.0 oder später (`AGPL-3.0-or-later`) lizenziert. Den vollständigen Lizenztext finden Sie in [`LICENSE`](LICENSE).
