"use client";

import { PublicPageBackground } from "@/components/PublicPageBackground";
import { supabase } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";

export default function ValidateUserPage() {
  useEffect(() => {
    const checkUser = async () => {
      // Get current session
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        console.error("No session found");
        window.location.href = "/auth/unverified";
        return;
      }

      const userEmail = session.user.email;
      if (!userEmail) {
        await supabase.auth.signOut();
        window.location.href = "/auth/unverified";
        return;
      }

      const { data: existingUser, error } = await supabase
        .from("sms_users")
        .select("id")
        .eq("email", userEmail)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("Error checking user:", error);
        await supabase.auth.signOut();
        window.location.href = "/auth/unverified";
        return;
      }

      if (!existingUser) {
        await supabase.auth.signOut();
        window.location.href = "/auth/unverified";
        return;
      }

      // ✅ All good
      window.location.href = "/home";
    };

    checkUser();
  }, []);

  return (
    <main className="font-ui relative flex min-h-screen flex-col items-center justify-center px-4">
      <PublicPageBackground />
      <div className="relative z-10 flex flex-col items-center gap-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-[var(--rule)] bg-[var(--paper-raised)]">
          <Loader2
            className="h-5 w-5 animate-spin text-[var(--brass)]"
            strokeWidth={1.75}
          />
        </div>
        <p className="label-data text-[var(--ink-3)]">Verifying your account</p>
      </div>
    </main>
  );
}
