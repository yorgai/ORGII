const THEME_TRANSITION_COVER_ATTR = "data-orgii-theme-transition-cover";
const THEME_TRANSITION_FADE_MS = 180;
const THEME_TRANSITION_MIN_VISIBLE_MS = 120;

interface ThemeTransitionCoverHandle {
  hide: () => Promise<void>;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getOpaquePageBackground(): string {
  const bodyBackground = getComputedStyle(document.body).backgroundColor;
  if (bodyBackground && bodyBackground !== "rgba(0, 0, 0, 0)") {
    return bodyBackground;
  }

  const rootBackground = getComputedStyle(
    document.documentElement
  ).backgroundColor;
  if (rootBackground && rootBackground !== "rgba(0, 0, 0, 0)") {
    return rootBackground;
  }

  return "#0f1115";
}

export function showThemeTransitionCover(): ThemeTransitionCoverHandle {
  const existing = document.querySelector<HTMLElement>(
    `[${THEME_TRANSITION_COVER_ATTR}]`
  );

  if (existing) {
    return {
      hide: async () => {
        await hideCover(existing, performance.now());
      },
    };
  }

  const shownAt = performance.now();
  const currentBackground = getOpaquePageBackground();
  const wrapper = document.createElement("div");
  wrapper.setAttribute(THEME_TRANSITION_COVER_ATTR, "");
  wrapper.setAttribute("aria-hidden", "true");
  wrapper.style.position = "fixed";
  wrapper.style.inset = "0";
  wrapper.style.zIndex = "10050";
  wrapper.style.pointerEvents = "auto";
  wrapper.style.opacity = "1";
  wrapper.style.backgroundColor = currentBackground;
  wrapper.style.backdropFilter = "blur(18px) saturate(1.15)";
  wrapper.style.setProperty(
    "-webkit-backdrop-filter",
    "blur(18px) saturate(1.15)"
  );
  wrapper.style.transition = `opacity ${THEME_TRANSITION_FADE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;

  document.body.appendChild(wrapper);

  return {
    hide: async () => {
      await hideCover(wrapper, shownAt);
    },
  };
}

async function hideCover(wrapper: HTMLElement, shownAt: number): Promise<void> {
  const elapsed = performance.now() - shownAt;
  if (elapsed < THEME_TRANSITION_MIN_VISIBLE_MS) {
    await sleep(THEME_TRANSITION_MIN_VISIBLE_MS - elapsed);
  }
  await nextFrame();
  wrapper.style.opacity = "0";
  await sleep(THEME_TRANSITION_FADE_MS);
  wrapper.remove();
}
