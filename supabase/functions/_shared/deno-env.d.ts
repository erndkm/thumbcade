/** The slice of the Deno runtime API the functions use, so `tsc` can type-check them outside Deno. */
declare namespace Deno {
  interface Env {
    get(key: string): string | undefined;
  }
  const env: Env;
  function serve(handler: (req: Request) => Response | Promise<Response>): unknown;
}
