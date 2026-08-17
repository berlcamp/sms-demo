"use client";

import { ModuleAccessDenied } from "@/components/ModuleAccessDenied";
import { canEnrolLearners } from "@/lib/constants";
import { useAppSelector } from "@/lib/redux/hook";

/**
 * Keeps the roles that may not enrol out of the module, not just out of the
 * sidebar — a volunteer teacher (migration 140) can type the URL, and every
 * other entry point into this page is a link they no longer have.
 *
 * This is the courteous refusal, not the enforcing one: `can_write_enrollment`
 * and `assert_enrollment_staff` refuse the write itself, so a bypass here
 * changes nothing about what reaches the database.
 */
export default function EnrollmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = useAppSelector((state) => state.user.user);

  // Still resolving the profile — AuthGuard is already showing its own state.
  if (!user) return <>{children}</>;

  if (!canEnrolLearners(user.type)) return <ModuleAccessDenied />;

  return <>{children}</>;
}
