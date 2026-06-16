# ORG-II

[English](README.md) · [Français](README.fr.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [Español](README.es.md) · [Русский](README.ru.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md) · [Polski](README.pl.md)

ORG-II は、Rust と Tauri で構築された open-source の agentic development framework です。local-first 実行を前提とし、ディスク上のサイズは 100MB 未満です。

これは単なる AI コーディングツールではありません。人間/Agent 組織と org-level alignment の実験です。Agents は進化していますが、collaboration、observability、構造、共有された accountability は追いついていません。場合によっては悪化しています。Cursor、Claude Code、類似ツールは Agents を外部委託されたアシスタントのように扱うことが多く、出力には役立つ一方で、システムレベルで監査、調整、alignment、進化を行うことが困難です。

ORG-II は別のモデルを探求します。構造化された組織の中で、Agents を永続的で観測可能な同僚として扱うモデルです。stateless でレビューしにくい AI IDE sessions ではなく、再生可能な Agent 実行、セッション横断メモリ、AI blame、local-first の Rust runtime を導入し、人間、Agents、チームが共有コンテキストと aligned goals を中心に協働できるようにします。

## 主な機能

- 監査、レビュー、デバッグのための再生可能な execution traces を備えた長時間実行 sessions。
- 既存の API keys と Agent サブスクリプションで動作する Rust ベースの Agents。
- GUI、CLI、Terminal、Git、ブラウザ、LSP、timeline、データベースツール。
- セッション横断メモリ、Agents 間の知識共有、共有 Workspace 状態。
- CPU、RAM、人間の注意力の可用性に反応できるリソース認識実行。
- 監督付き自己進化のための Agent-powered GUI end-to-end テスト。
- Agents が夜間に実行したり、不在中に作業を継続したりできる scheduling と auto-started sessions。
- 人間、Agents、目標、accountability を調整する org-level alignment surfaces（WIP）。
- self-hosted Supabase による session collaboration とグループ issue workflows（WIP）。

## デモ

https://github.com/user-attachments/assets/bd4833d2-4cc4-4971-9805-84529b14d01a

![ORGII GitHub ブラウザデモ](assets/github-browser-demo.png)

![ORGII Agent scheduling デモ](assets/agent-scheduling-demo.png)

## ダウンロード

最新の ORGII desktop app は [Releases](https://github.com/YORG-AI/ORGII/releases) ページから入手できます。最新 release を開き、利用するプラットフォーム向けのインストーラーまたは app bundle をダウンロードし、OS の案内に従って ORGII をインストールしてください。

## ソースから開発

ソースからビルドまたはコントリビュートするには：

```bash
pnpm install
pnpm run download:sidecars
pnpm run tauri:dev
```

コントリビューションの詳細は [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。すべての参加者に敬意と共感を求めます。[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) も参照してください。

## オプションのネイティブ sidecars

Browser Use と Computer Use は、ブラウザ自動化および macOS 画面自動化のためのオプションのネイティブ helpers に依存します：

- `agent-browser` は現在の OS/CPU 向けに `vercel-labs/agent-browser` releases からダウンロードされます。
- `peekaboo` は macOS で `steipete/peekaboo` releases からダウンロードされます。

Computer Use は現在 macOS のみで利用できます。Browser Use は対応プラットフォームで `agent-browser` を使用できます。

sidecar がない場合、Rust build は開発ビルドを継続できるように小さな placeholder resource を作成します。関連機能は `PATH` にフォールバックするか、`pnpm run download:sidecars` を実行するまで利用できない場合があります。

## ライセンス

ORGII は GNU Affero General Public License v3.0 以降（`AGPL-3.0-or-later`）でライセンスされています。完全なライセンス本文は [`LICENSE`](LICENSE) を参照してください。
