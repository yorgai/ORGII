declare module "*.png" {
  const value: string;
  export default value;
}
declare module "*.jpg" {
  const value: string;
  export default value;
}
declare module "*.jpeg" {
  const value: string;
  export default value;
}
declare module "*.webp" {
  const value: string;
  export default value;
}
declare module "*.mp4" {
  const value: string;
  export default value;
}
declare module "react-resizable";

declare module "written-number" {
  function writtenNumber(n: number, options?: { lang?: string }): string;
  export = writtenNumber;
}
