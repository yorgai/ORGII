/**
 * File read data extractor.
 */
import {
  FILE_NAME_PAYLOAD_KEYS,
  extractFilePathFromPayloads,
  readPayloadString,
} from "@src/util/file/filePathPayload";
import { getFileName } from "@src/util/file/pathUtils";

import type {
  ExtractedFileData,
  UniversalEventProps,
} from "../types/universalProps";
import {
  detectLanguage,
  extractSuccessData,
  safeText,
  stripLineNumberPrefixes,
} from "./extractorShared";

export function extractFileData(props: UniversalEventProps): ExtractedFileData {
  if (props.rustExtracted?.kind === "file" && props.rustExtracted.filePath) {
    const { filePath, fileName, content, language, lineCount } =
      props.rustExtracted;
    return { filePath, fileName, content, language, lineCount };
  }

  const { args, result } = props;
  const successData = extractSuccessData(result);

  const filePath =
    extractFilePathFromPayloads([args, successData, result]) ||
    props.filePath ||
    "";
  const directFileName =
    readPayloadString(args, FILE_NAME_PAYLOAD_KEYS) ??
    readPayloadString(successData, FILE_NAME_PAYLOAD_KEYS) ??
    readPayloadString(result, FILE_NAME_PAYLOAD_KEYS);

  const fileName = filePath ? getFileName(filePath) : directFileName || "";

  const rawContent =
    (successData?.content as string) ||
    safeText(result?.output) ||
    safeText(result?.content) ||
    safeText(result?.file_content) ||
    safeText(result?.observation) ||
    undefined;

  const stripped = rawContent ? stripLineNumberPrefixes(rawContent) : undefined;
  const content = stripped?.content;
  const lineCount = stripped?.lineCount;

  const language = detectLanguage(fileName);

  return { filePath, fileName, content, language, lineCount };
}
