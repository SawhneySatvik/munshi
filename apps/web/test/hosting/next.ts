// Next's request class and its config-testing helpers, for the hosting tests under db/test/v2/core/boot: those resolve
// packages from db/, where next is not installed, so they import Next through this file. Next's server modules expect
// the globals its own server sets up first (AsyncLocalStorage among them), so that module loads before any other.
import "next/dist/server/node-environment-baseline.js";

export { unstable_doesMiddlewareMatch, unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
export { NextRequest } from "next/server";
