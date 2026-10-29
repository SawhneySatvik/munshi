"use server";

// A judge's sample shop (BLUEPRINT §6.6, a Must): core makes a synthetic sandbox and its 7-day sandbox session, with no
// email and no password; the cookie names that session. Demo deployment only (404 on live, F2). Where the public pool
// is configured, five sample shops a day per IP (§6.3).
import { allowAttempt, CoreError, createSandbox, deploymentKind } from "@munshi/core";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { appPool } from "../../lib/server/db";
import { requestIp, setSessionCookie, signUpLimiter } from "../../lib/server/session";

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

export async function makeSampleShop(form: FormData): Promise<void> {
  const pool = await appPool();
  if ((await deploymentKind(pool)) !== "demo") notFound();
  const limiter = signUpLimiter();
  if (limiter && !(await allowAttempt(limiter.publicPool, "sign-up", limiter.ipHashOf(requestIp(await headers()))))) redirect("/demo?limit=1");
  const input = { businessType: text(form, "businessType"), name: text(form, "name"), slug: text(form, "slug").trim().toLowerCase(), ownerName: text(form, "ownerName") };
  const opened = await createSandbox(pool, input as Parameters<typeof createSandbox>[1]).catch((err) => {
    if (!(err instanceof CoreError)) throw err;
    return err.code === "invalid" ? ("invalid" as const) : ("taken" as const);
  });
  if (opened === "invalid" || opened === "taken") redirect(`/demo?${opened}=1`);
  await setSessionCookie(await cookies(), opened);
  redirect("/");
}
