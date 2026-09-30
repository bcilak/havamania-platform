import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, verifyAdminSession } from "@/lib/session";

/** /admin altındaki her şey oturum ister. Rol kontrolü sayfalarda ve action'larda yapılır. */
export async function proxy(request: NextRequest) {
  const session = await verifyAdminSession(request.cookies.get(ADMIN_COOKIE)?.value);
  if (!session) {
    const url = new URL("/login", request.url);
    if (request.nextUrl.pathname !== "/admin") url.searchParams.set("sonra", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
