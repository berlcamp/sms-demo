"use client";

import { Button } from "@/components/ui/button";
import { formatLrn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getGradeLevelLabel,
  getSectionTypeLabel,
} from "@/lib/constants";
import {
  ENROLLMENT_STATUS_LABELS,
  ENROLLMENT_STATUS_STYLES,
} from "@/lib/dashboard-utils";
import { supabase } from "@/lib/supabase/client";
import { Section, Student } from "@/types";
import {
  ArrowLeftRight,
  CheckCircle2,
  Clock,
  Loader2,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { isIpLearner } from "@/lib/constants/ethnicGroups";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  student: Student | null;
  onStudentUpdated?: (updates: Partial<Student>) => void;
}

const ACCEPTED_DIPLOMA_TYPES = [".pdf", ".jpg", ".jpeg", ".png"];
const ACCEPTED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
];

function getFileExtension(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "pdf";
  return ACCEPTED_DIPLOMA_TYPES.includes(`.${ext}`) ? ext : "pdf";
}

export const ViewModal = ({
  isOpen,
  onClose,
  student,
  onStudentUpdated,
}: ModalProps) => {
  const [section, setSection] = useState<Section | null>(null);
  const [encoderName, setEncoderName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removingBirthCert, setRemovingBirthCert] = useState(false);
  const [removingGoodMoral, setRemovingGoodMoral] = useState(false);
  const [uploadingBirthCert, setUploadingBirthCert] = useState(false);
  const [uploadingGoodMoral, setUploadingGoodMoral] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const birthCertInputRef = useRef<HTMLInputElement>(null);
  const goodMoralInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (student?.encoded_by) {
      supabase
        .from("sms_users")
        .select("name")
        .eq("id", student.encoded_by)
        .single()
        .then(({ data }) => setEncoderName(data?.name ?? null));
    } else {
      setEncoderName(null);
    }
  }, [student?.encoded_by]);

  useEffect(() => {
    if (student?.current_section_id) {
      const fetchSection = async () => {
        const { data } = await supabase
          .from("sms_sections")
          .select("*")
          .eq("id", student.current_section_id)
          .single();

        if (data) {
          setSection(data);
        }
      };

      fetchSection();
    } else {
      setSection(null);
    }
  }, [student?.current_section_id]);

  // Enrollment history
  const [enrollmentHistory, setEnrollmentHistory] = useState<
    Array<{
      id: string;
      school_year: string;
      grade_level: number;
      semester?: number | null;
      status: string;
      enrollment_status?: string | null;
      enrollment_date?: string | null;
      created_at: string;
      section?: { name: string; section_type?: string | null } | null;
      school?: { name: string } | null;
    }>
  >([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Transfer requests
  const [transferRequests, setTransferRequests] = useState<
    Array<{
      id: string;
      status: string;
      requested_at: string;
      responded_at?: string | null;
      target_grade_level?: number | null;
      target_school_year?: string | null;
      rejection_reason?: string | null;
      requesting_school?: { name: string } | null;
      origin_school?: { name: string } | null;
    }>
  >([]);

  useEffect(() => {
    if (!isOpen || !student) {
      setEnrollmentHistory([]);
      setTransferRequests([]);
      return;
    }

    const fetchHistory = async () => {
      setLoadingHistory(true);

      // Fetch enrollment history
      const { data: enrollments } = await supabase
        .from("sms_enrollments")
        .select(
          "id, school_year, grade_level, semester, status, enrollment_status, enrollment_date, created_at, section:sms_sections(name, section_type), school:sms_schools!sms_enrollments_school_id_fkey(name)"
        )
        .eq("student_id", student.id)
        .order("school_year", { ascending: false })
        .order("created_at", { ascending: false });

      if (enrollments) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setEnrollmentHistory(enrollments as any);
      }

      // Fetch transfer requests
      const { data: requests } = await supabase
        .from("sms_record_requests")
        .select(
          "id, status, requested_at, responded_at, target_grade_level, target_school_year, rejection_reason, requesting_school:sms_schools!sms_record_requests_requesting_school_id_fkey(name), origin_school:sms_schools!sms_record_requests_origin_school_id_fkey(name)"
        )
        .eq("student_id", student.id)
        .order("requested_at", { ascending: false });

      if (requests) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setTransferRequests(requests as any);
      }

      setLoadingHistory(false);
    };

    fetchHistory();
  }, [isOpen, student?.id]);

  if (!student) return null;

  const getFullName = () => {
    return `${student.last_name}, ${student.first_name}${
      student.middle_name ? ` ${student.middle_name}` : ""
    }${student.suffix ? ` ${student.suffix}` : ""}`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            Student Information
          </DialogTitle>
          <DialogDescription>
            View complete student profile and details.
          </DialogDescription>
          {encoderName && (
            <p className="text-xs text-muted-foreground mt-1">
              Encoded by {encoderName}
            </p>
          )}
        </DialogHeader>

        <div className="space-y-6">
          {/* Basic Information */}
          <div>
            <h3 className="text-sm font-semibold mb-3">Basic Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground">LRN</label>
                <p className="text-sm font-medium font-mono">{formatLrn(student.lrn)}</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">
                  Full Name
                </label>
                <p className="text-sm font-medium">{getFullName()}</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">
                  Date of Birth
                </label>
                <p className="text-sm font-medium">
                  {new Date(student.date_of_birth).toLocaleDateString()}
                </p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Gender</label>
                <p className="text-sm font-medium capitalize">
                  {student.gender}
                </p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">
                  IP (Ethnic Group)
                </label>
                <p className="text-sm font-medium">
                  {isIpLearner(student.ip_ethnic_group)
                    ? student.ip_ethnic_group
                    : "Not IP"}
                </p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">
                  4Ps Recipient
                </label>
                <p className="text-sm font-medium">
                  {student.is_4ps ? "Yes" : "No"}
                </p>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">Address</label>
                <p className="text-sm font-medium">
                  {student.purok}, {student.barangay},{" "}
                  {student.municipality_city}, {student.province}
                </p>
              </div>
              {student.contact_number && (
                <div>
                  <label className="text-xs text-muted-foreground">
                    Contact Number
                  </label>
                  <p className="text-sm font-medium">
                    {student.contact_number}
                  </p>
                </div>
              )}
              {student.email && (
                <div>
                  <label className="text-xs text-muted-foreground">Email</label>
                  <p className="text-sm font-medium">{student.email}</p>
                </div>
              )}
            </div>
          </div>

          {/* Parent/Guardian Information */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-3">
              Parent/Guardian Information
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground">Name</label>
                <p className="text-sm font-medium">
                  {student.parent_guardian_name}
                </p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Contact</label>
                <p className="text-sm font-medium">
                  {student.parent_guardian_contact}
                </p>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">
                  Relationship
                </label>
                <p className="text-sm font-medium">
                  {student.parent_guardian_relationship}
                </p>
              </div>
            </div>
          </div>

          {/* Enrollment Information */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-3">
              Enrollment Information
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground">Status</label>
                <p className="text-sm font-medium capitalize">
                  {student.enrollment_status}
                </p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">
                  Current Section
                </label>
                <p className="text-sm font-medium">
                  {section ? section.name : "No section assigned"}
                </p>
              </div>
              {student.enrolled_at && (
                <div>
                  <label className="text-xs text-muted-foreground">
                    Enrolled At
                  </label>
                  <p className="text-sm font-medium">
                    {new Date(student.enrolled_at).toLocaleDateString()}
                  </p>
                </div>
              )}
              {student.previous_school && (
                <div>
                  <label className="text-xs text-muted-foreground">
                    Previous School
                  </label>
                  <p className="text-sm font-medium">
                    {student.previous_school}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Enrollment History Timeline */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-3">Enrollment History</h3>
            {loadingHistory ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : enrollmentHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No enrollment records found.
              </p>
            ) : (
              <div className="relative space-y-0">
                {/* Timeline line */}
                <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-border" />

                {enrollmentHistory.map((enrollment) => {
                  const lifecycleStatus =
                    enrollment.enrollment_status ?? "active";
                  const dotColorMap: Record<string, string> = {
                    active: "border-emerald-400",
                    completed: "border-blue-400",
                    promoted: "border-indigo-400",
                    graduated: "border-purple-400",
                    retained: "border-yellow-400",
                    transferred_out: "border-orange-400",
                    dropped: "border-red-400",
                    pending_transfer: "border-amber-400",
                    pending_review: "border-sky-400",
                  };
                  const iconColorMap: Record<string, string> = {
                    active: "text-emerald-500",
                    completed: "text-blue-500",
                    promoted: "text-indigo-500",
                    graduated: "text-purple-500",
                    retained: "text-yellow-500",
                    transferred_out: "text-orange-500",
                    dropped: "text-red-500",
                    pending_transfer: "text-amber-500",
                    pending_review: "text-sky-500",
                  };
                  const isPending =
                    lifecycleStatus === "pending_transfer" ||
                    lifecycleStatus === "pending_review";
                  const isDropped = lifecycleStatus === "dropped";

                  return (
                    <div
                      key={enrollment.id}
                      className="relative flex gap-3 pb-4 last:pb-0"
                    >
                      {/* Timeline dot */}
                      <div
                        className={`relative z-10 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 bg-background ${
                          dotColorMap[lifecycleStatus] ?? "border-gray-400"
                        }`}
                      >
                        {isPending ? (
                          <Clock
                            className={`h-3 w-3 ${iconColorMap[lifecycleStatus] ?? "text-gray-500"}`}
                          />
                        ) : isDropped ? (
                          <XCircle
                            className={`h-3 w-3 ${iconColorMap[lifecycleStatus] ?? "text-gray-500"}`}
                          />
                        ) : (
                          <CheckCircle2
                            className={`h-3 w-3 ${iconColorMap[lifecycleStatus] ?? "text-gray-500"}`}
                          />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">
                            {getGradeLevelLabel(enrollment.grade_level)}
                          </span>
                          {enrollment.semester && (
                            <span className="text-xs text-muted-foreground">
                              Sem {enrollment.semester}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            — {enrollment.school_year}
                          </span>
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              ENROLLMENT_STATUS_STYLES[lifecycleStatus] ??
                              "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300"
                            }`}
                          >
                            {ENROLLMENT_STATUS_LABELS[lifecycleStatus] ??
                              lifecycleStatus
                                .replace(/_/g, " ")
                                .replace(/\b\w/g, (c) => c.toUpperCase())}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {enrollment.section?.name && (
                            <span>
                              Section: {enrollment.section.name}
                              {enrollment.section.section_type && (
                                <span className="ml-1 text-muted-foreground/70">
                                  (
                                  {getSectionTypeLabel(
                                    enrollment.section.section_type,
                                  )}
                                  )
                                </span>
                              )}
                            </span>
                          )}
                          {enrollment.school?.name && (
                            <span>
                              {enrollment.section?.name ? " • " : ""}
                              {enrollment.school.name}
                            </span>
                          )}
                          {enrollment.enrollment_date && (
                            <span>
                              {" "}
                              •{" "}
                              {new Date(
                                enrollment.enrollment_date
                              ).toLocaleDateString("en-US", {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Transfer Requests History */}
          {transferRequests.length > 0 && (
            <div className="border-t pt-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <ArrowLeftRight className="h-4 w-4" />
                Transfer Requests
              </h3>
              <div className="space-y-3">
                {transferRequests.map((request) => {
                  const isPending = request.status === "pending";
                  const isApproved = request.status === "approved";
                  const isRejected = request.status === "rejected";

                  return (
                    <div
                      key={request.id}
                      className="rounded-lg border bg-card p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">
                              {request.origin_school?.name ?? "Unknown"} →{" "}
                              {request.requesting_school?.name ?? "Unknown"}
                            </span>
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                isApproved
                                  ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                                  : isPending
                                    ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
                                    : isRejected
                                      ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                                      : "bg-gray-100 text-gray-800"
                              }`}
                            >
                              {request.status.charAt(0).toUpperCase() +
                                request.status.slice(1)}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {request.target_grade_level != null && (
                              <span>
                                Target:{" "}
                                {getGradeLevelLabel(
                                  request.target_grade_level
                                )}
                              </span>
                            )}
                            {request.target_school_year && (
                              <span>
                                {request.target_grade_level != null
                                  ? " • "
                                  : ""}
                                {request.target_school_year}
                              </span>
                            )}
                            <span>
                              {" "}
                              • Requested:{" "}
                              {new Date(
                                request.requested_at
                              ).toLocaleDateString("en-US", {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                            {request.responded_at && (
                              <span>
                                {" "}
                                • Responded:{" "}
                                {new Date(
                                  request.responded_at
                                ).toLocaleDateString("en-US", {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                            )}
                          </div>
                          {isRejected && request.rejection_reason && (
                            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                              Reason: {request.rejection_reason}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Documents: Birth Certificate, Good Moral, Diploma */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-3">Documents</h3>
            <div className="space-y-4">
              {/* Birth Certificate */}
              <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                <span className="text-sm font-medium">Birth Certificate</span>
                {student.birth_certificate_file_path ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const { data } = await supabase.storage
                          .from("diplomas")
                          .createSignedUrl(
                            student.birth_certificate_file_path!,
                            3600
                          );
                        if (data?.signedUrl) {
                          window.open(data.signedUrl, "_blank");
                        } else {
                          toast.error("Failed to open file");
                        }
                      }}
                    >
                      View
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={removingBirthCert}
                      onClick={async () => {
                        if (
                          !confirm(
                            "Remove Birth Certificate from this student?"
                          )
                        )
                          return;
                        setRemovingBirthCert(true);
                        try {
                          const { error: delErr } = await supabase.storage
                            .from("diplomas")
                            .remove([student.birth_certificate_file_path!]);
                          if (delErr) throw delErr;
                          const { error: updErr } = await supabase
                            .from("sms_students")
                            .update({ birth_certificate_file_path: null })
                            .eq("id", student.id);
                          if (updErr) throw updErr;
                          toast.success("Birth Certificate removed");
                          onStudentUpdated?.({
                            birth_certificate_file_path: null,
                          });
                        } catch (err) {
                          toast.error("Failed to remove file");
                        } finally {
                          setRemovingBirthCert(false);
                        }
                      }}
                    >
                      {removingBirthCert ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                ) : (
                  <>
                    <input
                      ref={birthCertInputRef}
                      type="file"
                      accept={ACCEPTED_MIME.join(",")}
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !student) return;
                        const ext = getFileExtension(file.name);
                        const path = `${student.school_id ?? "default"}/${student.id}/birth_certificate.${ext}`;
                        setUploadingBirthCert(true);
                        try {
                          const { error: uploadErr } = await supabase.storage
                            .from("diplomas")
                            .upload(path, file, {
                              upsert: true,
                              contentType: file.type,
                            });
                          if (uploadErr) throw uploadErr;
                          const { error: updErr } = await supabase
                            .from("sms_students")
                            .update({
                              birth_certificate_file_path: path,
                            })
                            .eq("id", student.id);
                          if (updErr) throw updErr;
                          toast.success("Birth Certificate uploaded");
                          onStudentUpdated?.({
                            birth_certificate_file_path: path,
                          });
                        } catch (err) {
                          toast.error("Failed to upload");
                        } finally {
                          setUploadingBirthCert(false);
                          e.target.value = "";
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={uploadingBirthCert}
                      onClick={() => birthCertInputRef.current?.click()}
                    >
                      {uploadingBirthCert ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      {uploadingBirthCert
                        ? " Uploading..."
                        : " Upload (PDF or Image)"}
                    </Button>
                  </>
                )}
              </div>

              {/* Good Moral */}
              <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                <span className="text-sm font-medium">Good Moral</span>
                {student.good_moral_file_path ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const { data } = await supabase.storage
                          .from("diplomas")
                          .createSignedUrl(
                            student.good_moral_file_path!,
                            3600
                          );
                        if (data?.signedUrl) {
                          window.open(data.signedUrl, "_blank");
                        } else {
                          toast.error("Failed to open file");
                        }
                      }}
                    >
                      View
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={removingGoodMoral}
                      onClick={async () => {
                        if (
                          !confirm(
                            "Remove Good Moral from this student?"
                          )
                        )
                          return;
                        setRemovingGoodMoral(true);
                        try {
                          const { error: delErr } = await supabase.storage
                            .from("diplomas")
                            .remove([student.good_moral_file_path!]);
                          if (delErr) throw delErr;
                          const { error: updErr } = await supabase
                            .from("sms_students")
                            .update({ good_moral_file_path: null })
                            .eq("id", student.id);
                          if (updErr) throw updErr;
                          toast.success("Good Moral removed");
                          onStudentUpdated?.({ good_moral_file_path: null });
                        } catch (err) {
                          toast.error("Failed to remove file");
                        } finally {
                          setRemovingGoodMoral(false);
                        }
                      }}
                    >
                      {removingGoodMoral ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                ) : (
                  <>
                    <input
                      ref={goodMoralInputRef}
                      type="file"
                      accept={ACCEPTED_MIME.join(",")}
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !student) return;
                        const ext = getFileExtension(file.name);
                        const path = `${student.school_id ?? "default"}/${student.id}/good_moral.${ext}`;
                        setUploadingGoodMoral(true);
                        try {
                          const { error: uploadErr } = await supabase.storage
                            .from("diplomas")
                            .upload(path, file, {
                              upsert: true,
                              contentType: file.type,
                            });
                          if (uploadErr) throw uploadErr;
                          const { error: updErr } = await supabase
                            .from("sms_students")
                            .update({ good_moral_file_path: path })
                            .eq("id", student.id);
                          if (updErr) throw updErr;
                          toast.success("Good Moral uploaded");
                          onStudentUpdated?.({ good_moral_file_path: path });
                        } catch (err) {
                          toast.error("Failed to upload");
                        } finally {
                          setUploadingGoodMoral(false);
                          e.target.value = "";
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={uploadingGoodMoral}
                      onClick={() => goodMoralInputRef.current?.click()}
                    >
                      {uploadingGoodMoral ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      {uploadingGoodMoral
                        ? " Uploading..."
                        : " Upload (PDF or Image)"}
                    </Button>
                  </>
                )}
              </div>

              {/* Diploma */}
              <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                <span className="text-sm font-medium">Diploma</span>
                {student.diploma_file_path ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const { data } = await supabase.storage
                          .from("diplomas")
                          .createSignedUrl(student.diploma_file_path!, 3600);
                        if (data?.signedUrl) {
                          window.open(data.signedUrl, "_blank");
                        } else {
                          toast.error("Failed to open diploma");
                        }
                      }}
                    >
                      View
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={removing}
                      onClick={async () => {
                        if (!confirm("Remove diploma from this student?"))
                          return;
                        setRemoving(true);
                        try {
                          const { error: delErr } = await supabase.storage
                            .from("diplomas")
                            .remove([student.diploma_file_path!]);
                          if (delErr) throw delErr;
                          const { error: updErr } = await supabase
                            .from("sms_students")
                            .update({ diploma_file_path: null })
                            .eq("id", student.id);
                          if (updErr) throw updErr;
                          toast.success("Diploma removed");
                          onStudentUpdated?.({ diploma_file_path: null });
                        } catch (err) {
                          toast.error("Failed to remove diploma");
                        } finally {
                          setRemoving(false);
                        }
                      }}
                    >
                      {removing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ACCEPTED_MIME.join(",")}
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !student) return;
                        const ext = getFileExtension(file.name);
                        const path = `${student.school_id ?? "default"}/${student.id}/diploma.${ext}`;
                        setUploading(true);
                        try {
                          const { error: uploadErr } = await supabase.storage
                            .from("diplomas")
                            .upload(path, file, {
                              upsert: true,
                              contentType: file.type,
                            });
                          if (uploadErr) throw uploadErr;
                          const { error: updErr } = await supabase
                            .from("sms_students")
                            .update({ diploma_file_path: path })
                            .eq("id", student.id);
                          if (updErr) throw updErr;
                          toast.success("Diploma uploaded");
                          onStudentUpdated?.({ diploma_file_path: path });
                        } catch (err) {
                          toast.error("Failed to upload diploma");
                        } finally {
                          setUploading(false);
                          e.target.value = "";
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      {uploading ? " Uploading..." : " Upload (PDF or Image)"}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
