/**
 * Model info lookup — thin re-export of the registry at
 * `@src/types/model/info` so that consumers in `engines/ChatPanel` keep a
 * stable `@src/util/modelInfo` import path.
 */
export { getModelInfo } from "@src/types/model/info";
export type { ModelInfo } from "@src/types/model/info";
