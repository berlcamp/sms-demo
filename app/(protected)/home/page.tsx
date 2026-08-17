"use client";

import { Greeting } from "@/components/Greeting";
import {
  DefaultDashboard,
  DivisionDashboard,
  SchoolDashboard,
  TeacherDashboard,
} from "@/components/dashboards";
import { isTeacherRole } from "@/lib/constants";
import { useAppSelector } from "@/lib/redux/hook";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Page() {
  const user = useAppSelector((state) => state.user.user);
  const router = useRouter();
  const userType = user?.type;
  const isDivisionAdmin =
    userType === "division_admin" || userType === "division_type";

  // Tutors have their own workspace — send them straight to it.
  useEffect(() => {
    if (userType === "tutor") router.replace("/tutor");
  }, [userType, router]);

  const renderDashboard = () => {
    if (isDivisionAdmin) {
      return <DivisionDashboard />;
    }
    if (isTeacherRole(userType)) {
      return <TeacherDashboard />;
    }
    if (userType === "tutor") {
      return null;
    }
    if (
      userType === "school_head" ||
      userType === "assistant_school_head" ||
      userType === "super admin" ||
      userType === "admin" ||
      userType === "registrar"
    ) {
      return <SchoolDashboard />;
    }
    return (
      <DefaultDashboard />
    );
  };

  return (
    <div className="w-full space-y-6">
      {!isDivisionAdmin && <Greeting name={user?.name ?? ""} />}
      {renderDashboard()}
    </div>
  );
}
