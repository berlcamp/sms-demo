import { GRADE_LEVEL_MAX, GRADE_LEVEL_MIN } from "@/lib/constants";
import { z } from "zod";

const SENIOR_HIGH_GRADE_MIN = 11;
const SENIOR_HIGH_GRADE_MAX = 12;

// Step 1: Student record form (only used for new students)
export const StudentFormSchema = z.object({
  lrn: z.string().min(1, "LRN is required"),
  first_name: z.string().min(1, "First name is required"),
  middle_name: z.string().optional(),
  last_name: z.string().min(1, "Last name is required"),
  suffix: z.string().optional(),
  date_of_birth: z.string().min(1, "Date of birth is required"),
  gender: z.enum(["male", "female"]),
  mother_tongue: z.string().optional(),
  ip_ethnic_group: z.string().optional(),
  // Migration 114. Distinct from ip_ethnic_group, which is the Indigenous
  // Peoples group and blank for everyone else.
  ethnicity: z.string().optional(),
  is_4ps: z.boolean().default(false),
  religion: z.string().optional(),
  purok: z.string().optional(),
  barangay: z.string().optional(),
  municipality_city: z.string().optional(),
  province: z.string().optional(),
  contact_number: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  father_last_name: z.string().optional(),
  father_first_name: z.string().optional(),
  father_middle_name: z.string().optional(),
  mother_last_name: z.string().optional(),
  mother_first_name: z.string().optional(),
  mother_middle_name: z.string().optional(),
  guardian_last_name: z.string().optional(),
  guardian_first_name: z.string().optional(),
  guardian_middle_name: z.string().optional(),
  parent_guardian_contact: z.string().optional(),
  previous_school: z.string().optional(),
});

// Minimal validation for existing/transferee (only LRN matters)
export const ExistingStudentSchema = z.object({
  lrn: z.string().min(1, "LRN is required"),
  // All other fields are optional — they won't be used
  first_name: z.string().optional(),
  middle_name: z.string().optional(),
  last_name: z.string().optional(),
  suffix: z.string().optional(),
  date_of_birth: z.string().optional(),
  gender: z.enum(["male", "female"]).optional(),
  mother_tongue: z.string().optional(),
  ip_ethnic_group: z.string().optional(),
  ethnicity: z.string().optional(),
  is_4ps: z.boolean().optional(),
  religion: z.string().optional(),
  purok: z.string().optional(),
  barangay: z.string().optional(),
  municipality_city: z.string().optional(),
  province: z.string().optional(),
  contact_number: z.string().optional(),
  email: z.string().optional(),
  father_last_name: z.string().optional(),
  father_first_name: z.string().optional(),
  father_middle_name: z.string().optional(),
  mother_last_name: z.string().optional(),
  mother_first_name: z.string().optional(),
  mother_middle_name: z.string().optional(),
  guardian_last_name: z.string().optional(),
  guardian_first_name: z.string().optional(),
  guardian_middle_name: z.string().optional(),
  parent_guardian_contact: z.string().optional(),
  previous_school: z.string().optional(),
});

export type StudentFormType = z.infer<typeof StudentFormSchema>;

// Step 2: Enrollment details
export const EnrollmentFormSchema = z
  .object({
    student_id: z.string().optional(),
    section_id: z.string().min(1, "Section is required"),
    school_year: z.string().min(1, "School year is required"),
    grade_level: z.number().min(GRADE_LEVEL_MIN).max(GRADE_LEVEL_MAX),
    semester: z.number().min(1).max(2).optional().nullable(),
    // Per enrolment, not per learner (migration 148): a returning learner is
    // an ordinary enrolment the following year.
    is_balik_aral: z.boolean().default(false),
  })
  .refine(
    (data) => {
      if (
        data.grade_level >= SENIOR_HIGH_GRADE_MIN &&
        data.grade_level <= SENIOR_HIGH_GRADE_MAX
      ) {
        return data.semester === 1 || data.semester === 2;
      }
      return true;
    },
    {
      message: "Semester is required for Grade 11 and 12",
      path: ["semester"],
    }
  );

export type EnrollmentFormType = z.infer<typeof EnrollmentFormSchema>;

export const STUDENT_FORM_DEFAULTS: StudentFormType = {
  lrn: "",
  first_name: "",
  middle_name: "",
  last_name: "",
  suffix: "",
  date_of_birth: "",
  gender: "male",
  mother_tongue: "",
  ip_ethnic_group: "",
  ethnicity: "",
  is_4ps: false,
  religion: "",
  purok: "",
  barangay: "",
  municipality_city: "",
  province: "",
  contact_number: "",
  email: "",
  father_last_name: "",
  father_first_name: "",
  father_middle_name: "",
  mother_last_name: "",
  mother_first_name: "",
  mother_middle_name: "",
  guardian_last_name: "",
  guardian_first_name: "",
  guardian_middle_name: "",
  parent_guardian_contact: "",
  previous_school: "",
};
