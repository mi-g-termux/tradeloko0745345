// The admin sign-in door.
//
// ONE route serves the sign-in form, and its address is decided at runtime by
// ADMIN_LOGIN_PATH. That is what makes the setting real rather than cosmetic:
//
//   ADMIN_LOGIN_PATH unset  -> the form is served at /signin, and only /signin.
//   ADMIN_LOGIN_PATH=abc123 -> the form is served at /abc123, and /signin 404s
//                              exactly like any other unknown URL.
//
// Previously the form lived at a hardcoded src/app/signin/page.tsx. That meant
// the default door could never be closed and a custom door was never opened -
// setting ADMIN_LOGIN_PATH changed nothing at all. This route replaces it.
//
// A root-level dynamic segment only receives paths that match no static route,
// because Next.js always prefers a static match. So /admin, /signals, /token/...
// and every real page are untouched; this only sees would-be 404s, and it keeps
// them as 404s unless the slug is the configured one.
import { notFound } from "next/navigation";
import { adminLoginSegment } from "@/lib/config";
import SignInForm from "@/components/SignInForm";

// Must never be statically prerendered: the correct slug comes from the server
// environment, and a cached HTML page would leak the private door to everyone.
export const dynamic = "force-dynamic";

// Keep the private URL out of search engines and previews.
export const metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default function AdminLoginPage({
  params,
}: {
  params: { loginSlug: string };
}) {
  const slug = decodeURIComponent(params.loginSlug ?? "").toLowerCase();

  // Anything that is not the configured door is a genuine 404. Rendering a
  // "wrong path" message instead would confirm that a private door exists and
  // tell a scanner it is close, so the response is byte-identical to any other
  // missing page.
  if (slug !== adminLoginSegment().toLowerCase()) notFound();

  return <SignInForm />;
}
