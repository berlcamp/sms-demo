"use client";

import { PublicPageBackground } from "@/components/PublicPageBackground";
import { isLoginDisabledUserType } from "@/lib/constants";
import { supabase } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function AuthCallback() {
  const router = useRouter();
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const checkUser = async () => {
      // Wait for session to update properly
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        window.location.href = "/auth/unverified";
        return;
      }

      const userEmail = session.user.email;
      if (!userEmail) {
        await supabase.auth.signOut();
        window.location.href = "/auth/unverified";
        return;
      }

      // ✅ Check if user exists in DB
      const { data: existingUser, error } = await supabase
        .from("sms_users")
        .select("id, type")
        .eq("email", userEmail)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (error) {
        await supabase.auth.signOut();
        // PostgrestError extends Error, so message/name are non-enumerable and
        // a bare console.error(error) prints "{}". Log the fields by hand.
        console.error("Error fetching user:", {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        });
        setAuthError(
          [error.code, error.message, error.details, error.hint]
            .filter(Boolean)
            .join(" — "),
        );
        // window.location.href = '/auth/unverified'
        return;
      }

      if (!existingUser) {
        await supabase.auth.signOut();
        window.location.href = "/auth/unverified";
      } else if (isLoginDisabledUserType(existingUser.type)) {
        // A staff record that is deliberately not an account (Accounting).
        // Refused here, before the session ever reaches a protected page.
        await supabase.auth.signOut();
        window.location.href = "/auth/unverified?reason=no-access";
      } else {
        window.location.href = "/home";
      }
    };

    checkUser();

    // ✅ Ensure session updates correctly
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session) {
          checkUser();
        }
      },
    );

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, [router]);

  return (
    <main className="font-ui relative flex min-h-screen flex-col items-center justify-center px-4">
      <PublicPageBackground />
      <div className="relative z-10 w-full max-w-md">
        {authError ? (
          <div className="border-t-2 border-[#a33a2c] bg-[var(--paper-raised)] shadow-sm shadow-[var(--ink)]/5">
            <div className="px-7 py-6">
              <p className="label-data text-[#a33a2c]">Sign-in failed</p>
              <h1 className="font-display mt-2 text-2xl leading-tight text-[var(--ink)]">
                We could not verify your account
              </h1>
              <p className="font-data mt-5 whitespace-pre-wrap break-words border-l-2 border-[var(--rule)] pl-4 text-[12px] leading-relaxed text-[var(--ink-2)]">
                {authError}
              </p>
            </div>
            <div className="border-t border-[var(--rule)] bg-[var(--paper)]/60 px-7 py-3.5">
              <a
                href="/login"
                className="text-[12px] text-[var(--ink-3)] transition-colors hover:text-[var(--ink)]"
              >
                ← Back to sign in
              </a>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-[var(--rule)] bg-[var(--paper-raised)]">
              <Loader2
                className="h-5 w-5 animate-spin text-[var(--brass)]"
                strokeWidth={1.75}
              />
            </div>
            <p className="label-data text-[var(--ink-3)]">
              Verifying your account
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
