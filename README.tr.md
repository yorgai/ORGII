# ORG-II

[English](README.md) · [Français](README.fr.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [Español](README.es.md) · [Русский](README.ru.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md) · [Polski](README.pl.md)

ORG-II, Rust ve Tauri ile oluşturulmuş, local-first çalışmaya yönelik ve diskte 100 MB’tan az yer kaplayan open-source bir agentic development framework’tür.

Bu yalnızca başka bir AI kodlama aracı değildir; insan/Agent organizasyonları ve org-level alignment üzerine bir deneydir. Agents daha iyi hale geliyor, ancak collaboration, observability, yapı ve paylaşılan accountability aynı hızda ilerlemiyor — bazı durumlarda daha da kötüleşiyor. Cursor, Claude Code ve benzeri araçlar Agents’ı çoğu zaman dış kaynaklı asistanlar gibi ele alır: çıktı üretmek için yararlı, ancak sistem düzeyinde denetlemesi, koordine etmesi, hizalaması veya geliştirmesi zordur.

ORG-II farklı bir modeli araştırır: yapılandırılmış bir organizasyon içinde kalıcı ve gözlemlenebilir çalışma arkadaşları olarak Agents. Durumsuz ve incelemesi zor AI IDE sessions yerine, tekrar oynatılabilir Agent execution, oturumlar arası bellek, AI blame ve local-first Rust runtime sunar; böylece insanlar, Agents ve ekipler ortak bağlam ve hizalanmış hedefler etrafında işbirliği yapabilir.

## Temel yetenekler

- Denetim, inceleme ve hata ayıklama için tekrar oynatılabilir execution traces içeren uzun süreli sessions.
- Mevcut API keys ve Agent aboneliklerinizle çalışan Rust tabanlı Agents.
- GUI, CLI, Terminal, Git, tarayıcı, LSP, timeline ve veritabanı araçları.
- Oturumlar arası bellek, Agents arası bilgi paylaşımı ve paylaşılan Workspace durumu.
- CPU, RAM ve insan dikkatinin uygunluğuna tepki verebilen kaynak farkındalıklı yürütme.
- Denetimli öz-evrim için Agent-powered GUI end-to-end testleri.
- Agents’ın gece boyunca çalışabilmesi veya siz uzaktayken işi sürdürebilmesi için scheduling ve auto-started sessions.
- İnsanları, Agents’ı, hedefleri ve accountability’yi koordine etmek için org-level alignment surfaces (WIP).
- Self-hosted Supabase üzerinden session collaboration ve grup issue workflows (WIP).

## Demo

https://github.com/user-attachments/assets/bd4833d2-4cc4-4971-9805-84529b14d01a

![ORGII GitHub tarayıcı demosu](assets/github-browser-demo.png)

![ORGII Agent scheduling demosu](assets/agent-scheduling-demo.png)

## İndir

En yeni ORGII desktop app’i [Releases](https://github.com/YORG-AI/ORGII/releases) sayfasından alın. En yeni release’i açın, platformunuza uygun installer veya app bundle’ı indirin ve ORGII’yi kurmak için işletim sistemi yönergelerini izleyin.

## Kaynaktan geliştirme

Kaynaktan derlemek veya katkıda bulunmak için:

```bash
pnpm install
pnpm run download:sidecars
pnpm run tauri:dev
```

Katkı ayrıntıları için [CONTRIBUTING.md](CONTRIBUTING.md) dosyasına bakın. Herkesten saygılı ve empatik olmasını rica ediyoruz; [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) dosyasına bakın.

## İsteğe bağlı native sidecars

Browser Use ve Computer Use özellikleri, tarayıcı otomasyonu ve macOS ekran otomasyonu için isteğe bağlı native helpers’a bağlıdır:

- `agent-browser`, mevcut OS/CPU için `vercel-labs/agent-browser` releases üzerinden indirilir.
- `peekaboo`, macOS’ta `steipete/peekaboo` releases üzerinden indirilir.

Computer Use şu anda yalnızca macOS’ta kullanılabilir. Browser Use, desteklenen platformlarda `agent-browser` kullanabilir.

Bir sidecar eksikse Rust build, geliştirme build’lerinin devam edebilmesi için küçük bir placeholder resource oluşturur. İlgili özellik `PATH`’e geri dönebilir veya `pnpm run download:sidecars` çalıştırılana kadar kullanılamayabilir.

## Lisans

ORGII, GNU Affero General Public License v3.0 veya sonrası (`AGPL-3.0-or-later`) kapsamında lisanslanmıştır. Tam lisans metni için [`LICENSE`](LICENSE) dosyasına bakın.
