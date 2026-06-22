type DialogAsk = typeof import("@tauri-apps/plugin-dialog").ask;
type DialogMessage = typeof import("@tauri-apps/plugin-dialog").message;

export type NativeAskOptions = NonNullable<Parameters<DialogAsk>[1]>;
export type NativeMessageOptions = NonNullable<Parameters<DialogMessage>[1]>;

async function deferNativeDialogPresentation(): Promise<void> {
  if (typeof window === "undefined") return;

  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

  if (typeof window.requestAnimationFrame === "function") {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.setTimeout(resolve, 0);
      });
    });
  }
}

export async function askNativeDialogSafely(
  message: string,
  options: NativeAskOptions
): Promise<boolean> {
  await deferNativeDialogPresentation();
  const dialog = await import("@tauri-apps/plugin-dialog");
  await deferNativeDialogPresentation();
  return dialog.ask(message, options);
}

export async function showNativeMessageSafely(
  message: string,
  options: NativeMessageOptions
): Promise<void> {
  await deferNativeDialogPresentation();
  const dialog = await import("@tauri-apps/plugin-dialog");
  await deferNativeDialogPresentation();
  await dialog.message(message, options);
}
