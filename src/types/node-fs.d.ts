declare module "fs" {
  export function readFileSync(
    path: string | URL,
    options?: { encoding?: string | null; flag?: string } | string | null
  ): string;
}
