# ORG-II

[English](README.md) · [Français](README.fr.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [Español](README.es.md) · [Русский](README.ru.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md) · [Polski](README.pl.md)

ORG-II는 Rust와 Tauri로 구축된 open-source agentic development framework이며, 100MB 미만의 디스크 사용량으로 local-first 실행을 지원합니다.

이것은 단순한 AI 코딩 도구가 아니라 human/Agent 조직과 org-level alignment에 대한 실험입니다. Agents는 점점 더 좋아지고 있지만 collaboration, observability, 구조, 공유 accountability는 따라가지 못하고 있으며, 어떤 경우에는 더 나빠지고 있습니다. Cursor, Claude Code 및 유사한 도구들은 Agents를 외부 보조 인력처럼 다루는 경우가 많습니다. 결과물에는 유용하지만 시스템 수준에서 감사, 조정, alignment, 진화를 수행하기 어렵습니다.

ORG-II는 다른 모델을 탐구합니다. 구조화된 조직 안에서 Agents를 지속적이고 관찰 가능한 동료로 다루는 모델입니다. stateless이고 리뷰하기 어려운 AI IDE sessions 대신, 재생 가능한 Agent 실행, 세션 간 메모리, AI blame, local-first Rust runtime을 도입하여 인간, Agents, 팀이 공유 컨텍스트와 aligned goals를 중심으로 협업할 수 있게 합니다.

## 주요 기능

- 감사, 리뷰, 디버깅을 위한 재생 가능한 실행 traces를 갖춘 장기 실행 sessions.
- 기존 API keys와 Agent 구독을 사용할 수 있는 Rust 기반 Agents.
- GUI, CLI, Terminal, Git, 브라우저, LSP, timeline, 데이터베이스 도구.
- 세션 간 메모리, Agents 간 지식 공유, 공유 Workspace 상태.
- CPU, RAM, 인간의 주의 가능성에 반응할 수 있는 리소스 인식 실행.
- 감독된 자기 진화를 위한 Agent-powered GUI end-to-end 테스트.
- Agents가 밤새 실행되거나 사용자가 자리를 비운 동안 계속 작업할 수 있도록 하는 scheduling 및 auto-started sessions.
- 인간, Agents, 목표, accountability를 조정하기 위한 org-level alignment surfaces (WIP).
- self-hosted Supabase를 통한 session collaboration 및 그룹 issue workflows (WIP).

## 데모

https://github.com/user-attachments/assets/bd4833d2-4cc4-4971-9805-84529b14d01a

![ORGII GitHub 브라우저 데모](assets/github-browser-demo.png)

![ORGII Agent scheduling 데모](assets/agent-scheduling-demo.png)

## 다운로드

최신 ORGII desktop app은 [Releases](https://github.com/YORG-AI/ORGII/releases) 페이지에서 받을 수 있습니다. 최신 release를 열고 플랫폼에 맞는 설치 프로그램 또는 app bundle을 다운로드한 뒤 OS 안내에 따라 ORGII를 설치하세요.

## 소스에서 개발

소스에서 빌드하거나 기여하려면:

```bash
pnpm install
pnpm run download:sidecars
pnpm run tauri:dev
```

기여에 대한 자세한 내용은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요. 모든 참여자에게 존중과 공감을 요청합니다. [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)도 참고하세요.

## 선택적 네이티브 sidecars

Browser Use와 Computer Use 기능은 브라우저 자동화 및 macOS 화면 자동화를 위한 선택적 네이티브 helpers에 의존합니다:

- `agent-browser`는 현재 OS/CPU에 맞는 `vercel-labs/agent-browser` releases에서 다운로드됩니다.
- `peekaboo`는 macOS에서 `steipete/peekaboo` releases에서 다운로드됩니다.

Computer Use는 현재 macOS에서만 사용할 수 있습니다. Browser Use는 지원 플랫폼에서 `agent-browser`를 사용할 수 있습니다.

sidecar가 없으면 Rust build는 개발 빌드를 계속할 수 있도록 작은 placeholder resource를 만듭니다. 관련 기능은 `PATH`로 폴백하거나 `pnpm run download:sidecars`를 실행할 때까지 사용할 수 없을 수 있습니다.

## 라이선스

ORGII는 GNU Affero General Public License v3.0 이상(`AGPL-3.0-or-later`)으로 라이선스됩니다. 전체 라이선스 전문은 [`LICENSE`](LICENSE)를 참고하세요.
