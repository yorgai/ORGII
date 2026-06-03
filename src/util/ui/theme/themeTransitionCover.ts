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
  const wrapper = document.createElement("div");
  wrapper.className = "liquid-modal-wrapper";
  wrapper.setAttribute(THEME_TRANSITION_COVER_ATTR, "");
  wrapper.setAttribute("aria-hidden", "true");
  wrapper.style.zIndex = "10050";
  wrapper.style.pointerEvents = "auto";
  wrapper.style.transition = `opacity ${THEME_TRANSITION_FADE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;

  const mask = document.createElement("div");
  mask.className = "liquid-modal-mask";
  wrapper.appendChild(mask);

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
