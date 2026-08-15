"use client";

import { PublicPageBackground } from "@/components/PublicPageBackground";
import { APP_NAME, ORG_FOOTER, ORG_NAME } from "@/lib/constants/branding";
import { supabase } from "@/lib/supabase/client";
import { AlertCircle, Loader2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";

interface LoginBoxProps {
  message?: string;
}

/**
 * Shown while the existing session is being resolved, before we know whether
 * to redirect to /home or render the sign-in card. Same paper ground as the
 * card itself so there is no flash between the two states.
 */
function SessionCheck() {
  return (
    <main className="font-ui relative flex min-h-screen items-center justify-center px-4">
      <PublicPageBackground />
      <div className="relative z-10 flex flex-col items-center gap-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-[var(--rule)] bg-[var(--paper-raised)]">
          <Loader2
            className="h-5 w-5 animate-spin text-[var(--brass)]"
            strokeWidth={1.75}
          />
        </div>
        <p className="label-data text-[var(--ink-3)]">Checking session</p>
      </div>
    </main>
  );
}

export default function LoginBox({ message }: LoginBoxProps) {
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const checkSession = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) console.warn("Auth error:", error.message);
      if (data.user) router.push("/home");
      setCheckingSession(false);
    };

    checkSession();
  }, [router]);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setErrorMessage("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        queryParams: {
          prompt: "select_account",
        },
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setErrorMessage(error.message);
      setIsLoading(false);
    }
  };

  if (checkingSession) {
    return <SessionCheck />;
  }

  return (
    <main className="font-ui relative flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <PublicPageBackground />

      <div className="relative z-10 w-full max-w-[26rem] animate-fade-up">
        {/* Masthead above the card, the way a form is headed */}
        <div className="mb-7 flex items-center gap-3.5">
          <div className="relative h-11 w-11 shrink-0 rounded-sm border border-[var(--rule)] bg-[var(--paper-raised)] p-1.5">
            <Image
              src="/deped-logo.svg"
              alt=""
              fill
              className="object-contain p-1"
              priority
            />
          </div>
          <div>
            <p className="font-display text-lg leading-tight text-[var(--ink)]">
              {APP_NAME}
            </p>
            <p className="label-data mt-0.5 text-[var(--ink-3)]">{ORG_NAME}</p>
          </div>
        </div>

        <div className="border-t-2 border-[var(--ink)] bg-[var(--paper-raised)] shadow-sm shadow-[var(--ink)]/5">
          <div className="border-b border-[var(--rule)] px-7 py-5">
            <p className="label-data text-[var(--brass)]">Staff access</p>
            <h1 className="font-display mt-2 text-2xl leading-tight text-[var(--ink)]">
              Sign in to your account
            </h1>
          </div>

          <div className="space-y-5 px-7 py-7">
            {(errorMessage || message) && (
              <div className="flex items-start gap-3 border-l-2 border-[#a33a2c] bg-[#a33a2c]/[0.06] px-4 py-3.5">
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0 text-[#a33a2c]"
                  strokeWidth={1.75}
                />
                <p className="text-[13px] leading-relaxed text-[#7d2b20]">
                  {errorMessage || message}
                </p>
              </div>
            )}

            <Button
              onClick={handleGoogleLogin}
              disabled={isLoading}
              variant="outline"
              className="h-12 w-full rounded-sm border border-[var(--rule)] bg-[var(--paper)] text-[14px] font-medium tracking-tight text-[var(--ink)] transition-colors hover:border-[var(--ink-3)] hover:bg-[var(--paper)] hover:text-[var(--ink)]"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                  <span>Connecting…</span>
                </>
              ) : (
                <>
                  <Image
                    src="/icons8-google-100.svg"
                    alt=""
                    width={18}
                    height={18}
                    className="shrink-0"
                  />
                  <span>Continue with Google</span>
                </>
              )}
            </Button>

            <p className="text-[12px] leading-relaxed text-[var(--ink-3)]">
              Staff accounts are created by the division office. If your account
              is not yet registered, sign-in will be refused.
            </p>
          </div>

          <div className="flex items-center justify-between border-t border-[var(--rule)] bg-[var(--paper)]/60 px-7 py-3.5">
            <span className="label-data text-[10px] text-[var(--ink-3)]">
              Google OAuth
            </span>
            <Link
              href="/"
              className="text-[12px] text-[var(--ink-3)] transition-colors hover:text-[var(--ink)]"
            >
              ← Back to home
            </Link>
          </div>
        </div>

        <p className="label-data mt-6 text-center text-[10px] text-[var(--ink-3)]">
          {ORG_FOOTER}
        </p>
      </div>
    </main>
  );
}
