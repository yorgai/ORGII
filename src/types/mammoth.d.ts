declare module "mammoth" {
  interface ConversionResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }

  interface Options {
    arrayBuffer: ArrayBuffer;
  }

  function convertToHtml(options: Options): Promise<ConversionResult>;
  function extractRawText(options: Options): Promise<ConversionResult>;
}
