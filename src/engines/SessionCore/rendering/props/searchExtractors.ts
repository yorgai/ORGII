/**
 * Search / grep data extractor.
 */
import type {
  ExtractedSearchData,
  UniversalEventProps,
} from "../types/universalProps";

export function extractSearchData(
  props: UniversalEventProps
): ExtractedSearchData {
  if (props.rustExtracted?.kind === "search") {
    const s = props.rustExtracted;
    return {
      query: s.query,
      results: s.results,
      totalMatches: s.totalMatches,
    };
  }

  const { args, result } = props;

  const query =
    (args?.query as string) ||
    (args?.pattern as string) ||
    (args?.search_query as string) ||
    (args?.regex as string) ||
    (args?.search_term as string) ||
    (args?.searchTerm as string) ||
    (args?.text as string) ||
    (args?.input as string) ||
    "";

  const rawResults = result?.matches;
  const resultsArray = Array.isArray(rawResults) ? rawResults : [];

  const results = resultsArray.map((match) => {
    const matchObj = match as Record<string, unknown>;
    return {
      file: (matchObj.file as string) || "",
      line: (matchObj.line as number) || 0,
      content: (matchObj.content as string) || "",
    };
  });

  let totalMatches = (result?.total as number) || results.length;
  if (totalMatches === 0 && typeof result?.content === "string") {
    const countMatch = (result.content as string).match(
      /(?:Found\s+)?(\d+)\s+match/i
    );
    if (countMatch) {
      totalMatches = parseInt(countMatch[1], 10);
    }
  }

  return { query, results, totalMatches };
}
