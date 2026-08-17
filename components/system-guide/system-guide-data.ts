import {
  Baby,
  BarChart3,
  BookMarked,
  BookOpen,
  BookOpenCheck,
  BookText,
  Building2,
  Calculator,
  Calendar,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Copy,
  FileBarChart,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  Heart,
  IdCard,
  Inbox,
  type LucideIcon,
  NotebookPen,
  NotebookText,
  Pencil,
  RotateCcw,
  ScrollText,
  Send,
  Settings,
  Sprout,
  Tags,
  Telescope,
  TrendingUp,
  User,
  UserPlus,
  Users,
} from "lucide-react";

type UserType =
  | "school_head"
  | "assistant_school_head"
  | "super admin"
  | "admin"
  | "registrar"
  | "librarian"
  | "guidance_counselor"
  | "school_nurse"
  | "teacher"
  | "volunteer_teacher"
  | "tutor"
  | "division_admin"
  | "division_type";
// "accounting" is deliberately absent: that role never signs in, so it never
// opens the guide.

export interface WorkflowStep {
  title: string;
  description: string;
  tip?: string;
}

/**
 * A screen that lives *inside* a module rather than beside it in the sidebar —
 * a tab, a row action, or a page you can only reach by opening a record first
 * (My Sections → open a section → Attendance). These have no sidebar entry of
 * their own, so a guide organised purely by sidebar item leaves them invisible.
 *
 * `allowedRoles` is deliberately absent: a sub-module is only ever shown with
 * its parent, and the parent's roles already decided who gets there.
 */
export interface SubModuleGuide {
  id: string;
  title: string;
  icon: LucideIcon;
  description: string;
  steps: WorkflowStep[];
}

export interface ModuleGuide {
  id: string;
  title: string;
  icon: LucideIcon;
  category: string;
  description: string;
  allowedRoles: UserType[];
  steps: WorkflowStep[];
  subModules?: SubModuleGuide[];
}

export interface GuideCategory {
  id: string;
  label: string;
  modules: ModuleGuide[];
}

const schoolManagementRoles: UserType[] = [
  "school_head",
  "assistant_school_head",
  "super admin",
  "admin",
  "registrar",
  "librarian",
];

const staffAccessRoles: UserType[] = [
  "school_head",
  "assistant_school_head",
  "super admin",
  "admin",
];

const teacherMenuRoles: UserType[] = [
  "school_head",
  "assistant_school_head",
  "super admin",
  "admin",
  "registrar",
  "librarian",
  "teacher",
  // A volunteer teacher works the whole Teacher Menu. The one guide they do not
  // get is Enrollment, which lists its roles explicitly rather than using this.
  "volunteer_teacher",
];

/**
 * The learner-record screens the guidance counselor works in. They advise no
 * section, so they reach these over the whole school roster rather than one
 * advisory class.
 */
const guidanceRoles: UserType[] = [...teacherMenuRoles, "guidance_counselor"];

/** SF8 is the school nurse's whole assignment here, and they encode it. */
const healthRoles: UserType[] = [...schoolManagementRoles, "school_nurse"];

const ALL_GUIDES: ModuleGuide[] = [
  // ── Initial Setup ──
  {
    id: "staff",
    title: "Staff",
    icon: User,
    category: "setup",
    description:
      "Manage staff members who will use the system — add accounts and assign roles.",
    allowedRoles: staffAccessRoles,
    steps: [
      {
        title: "Navigate to Staff",
        description:
          "Open the Staff module from the Settings section in the sidebar.",
      },
      {
        title: "Add Staff Members",
        description:
          "Click the Add button and fill in staff details: name, email, contact information, and position.",
      },
      {
        title: "Assign Roles",
        description:
          "Set each staff member's role: School Head, Admin, Registrar, Teacher, or Librarian. This determines their system access.",
        tip: "Teachers will see the Teacher Menu; Admin and School Head get full module access.",
      },
      {
        title: "Credentials Sent",
        description:
          "Staff members receive their login credentials via email and can begin using the system.",
      },
    ],
  },
  {
    id: "rooms",
    title: "Rooms",
    icon: Building2,
    category: "setup",
    description:
      "Set up classrooms and facilities that will be used for scheduling.",
    allowedRoles: schoolManagementRoles,
    steps: [
      {
        title: "Open Rooms Module",
        description: "Navigate to Rooms under the Settings section.",
      },
      {
        title: "Add Rooms",
        description:
          "Click Add and enter room details: room number/name and seating capacity.",
      },
      {
        title: "Rooms Ready",
        description:
          "Rooms are now available for assignment when creating class schedules.",
        tip: "The system will check for room conflicts when scheduling.",
      },
    ],
  },
  {
    id: "subjects",
    title: "Subjects",
    icon: BookOpen,
    category: "setup",
    description:
      "Define the subjects/courses offered at your school for each grade level.",
    allowedRoles: schoolManagementRoles,
    steps: [
      {
        title: "Open Subjects Module",
        description: "Navigate to Subjects from the Modules section.",
      },
      {
        title: "Add Subjects",
        description:
          "Create subjects with name, subject code, and applicable grade level(s).",
        tip: "Subjects are linked to grade levels, so they automatically appear for matching sections.",
      },
      {
        title: "Subjects Available",
        description:
          "Subjects can now be assigned to sections and used in schedule creation.",
      },
    ],
  },
  {
    id: "sections",
    title: "Sections",
    icon: Users,
    category: "setup",
    description:
      "Create class sections and assign advisers before enrolling students.",
    allowedRoles: schoolManagementRoles,
    steps: [
      {
        title: "Open Sections Module",
        description: "Navigate to Sections from the Modules section.",
      },
      {
        title: "Create Sections",
        description:
          "Add sections with name, grade level, and school year. Each section represents a class group.",
      },
      {
        title: "Assign Adviser",
        description:
          "Select a teacher as the section adviser. The adviser can manage grades and view the section roster.",
      },
      {
        title: "Ready for Enrollment",
        description:
          "Sections are now available for student enrollment and schedule assignments.",
      },
      {
        title: "Use the Row Actions",
        description:
          "Each section row carries a ⋮ menu — the sub-modules below. This is where schedules are built and where a whole section can be copied into a new school year.",
      },
    ],
    subModules: [
      {
        id: "view_students",
        title: "View & Print Students",
        icon: Users,
        description: "The section's roster, on screen or on paper.",
        steps: [
          {
            title: "View Students",
            description:
              "Opens the list of learners enrolled in the section for its school year.",
          },
          {
            title: "Print Students",
            description:
              "Prints the same list as a class list with the school, section, grade level, and adviser in the header.",
          },
        ],
      },
      {
        id: "manage_schedules",
        title: "Manage Schedules",
        icon: Calendar,
        description:
          "Build the section's weekly timetable — subject, teacher, room, days, and time.",
        steps: [
          {
            title: "Open Manage Schedules",
            description:
              "Choose Manage Schedules on the section row. Every subject for the section's grade level is listed.",
          },
          {
            title: "Add a Schedule Entry",
            description:
              "For a subject, set the teacher, room, day(s), and start/end time.",
            tip: "Leave the teacher blank to save a Temporary slot — useful when the room and time are settled but the teacher is not yet hired or assigned.",
          },
          {
            title: "Resolve Conflicts",
            description:
              "The system refuses to double-book a teacher, a room, or the section itself, and warns you before saving.",
          },
          {
            title: "Accept a Shared Slot",
            description:
              "For arrangements schools genuinely run — a multigrade class, a shared MEP/TLE session, a hall used by two classes — tick “Create anyway” on the warning to record the clash deliberately.",
            tip: "An override excuses only that one entry. The next person scheduling against it still sees the conflict and must accept it themselves.",
          },
        ],
      },
      {
        id: "duplicate",
        title: "Duplicate",
        icon: Copy,
        description:
          "Copy a section — and optionally its schedules — into another school year.",
        steps: [
          {
            title: "Choose Duplicate",
            description:
              "Pick Duplicate on the section row, then set the new section name and the target school year.",
          },
          {
            title: "Review the Schedules",
            description:
              "The modal lists the subject schedules that will be copied with their days, time, teacher, and room, so you can see exactly what carries over before you confirm.",
          },
          {
            title: "Confirm",
            description:
              "The new section is created with the same details and a copy of every listed schedule — you do not rebuild the timetable each year.",
            tip: "Enrollments are never copied. Learners are enrolled into the new section fresh through the Enrollment module.",
          },
        ],
      },
      {
        id: "edit_delete",
        title: "Edit & Delete",
        icon: Pencil,
        description: "Correct a section, or remove one created by mistake.",
        steps: [
          {
            title: "Edit",
            description:
              "Change the section name, grade level, school year, or adviser. Changing the adviser moves the section into the new adviser's My Sections.",
          },
          {
            title: "Delete",
            description:
              "Deletes the section. Use it only for sections created in error — a section with enrollments or schedules should be corrected, not deleted.",
          },
        ],
      },
    ],
  },

  // ── Core Modules ──
  {
    id: "enrollment",
    title: "Enrollment",
    icon: ClipboardList,
    category: "core",
    description:
      "Enroll students into sections for the current school year.",
    allowedRoles: [...schoolManagementRoles, "teacher"],
    steps: [
      {
        title: "Open Enrollment",
        description: "Navigate to the Enrollment module from the sidebar.",
      },
      {
        title: "Search or Add Student",
        description:
          "Search for an existing student by name or LRN. If the student is new, create a new student record.",
      },
      {
        title: "Select Section",
        description:
          "Choose the school year, grade level, and section to enroll the student in.",
      },
      {
        title: "Submit Enrollment",
        description:
          "Confirm and submit the enrollment. The student now appears in the section roster.",
      },
      {
        title: "Review & Approve",
        description:
          "Administrators can review pending enrollments and approve or flag them as needed.",
        tip: "Enrolled students automatically appear in attendance, grade entry, and book issuance lists.",
      },
    ],
  },
  {
    id: "students",
    title: "Students",
    icon: GraduationCap,
    category: "core",
    description:
      "View, search, and manage all student records in the school.",
    allowedRoles: schoolManagementRoles,
    steps: [
      {
        title: "Open Students Module",
        description: "Navigate to Students from the Modules section.",
      },
      {
        title: "Filter & Search",
        description:
          "Use filters for grade level, section, and school year. Search by name or LRN to find specific students.",
      },
      {
        title: "View Student Profile",
        description:
          "Click a student to see their full profile: personal info, guardian details, enrollment history.",
      },
      {
        title: "Edit Information",
        description:
          "Update student data as needed — personal details, contact info, and guardian information.",
      },
    ],
  },
  {
    id: "schedules",
    title: "Schedules",
    icon: Calendar,
    category: "core",
    description:
      "Create and manage class schedules per section via Sections → Manage Schedules, assigning teachers, rooms, and time slots.",
    allowedRoles: schoolManagementRoles,
    steps: [
      {
        title: "Open Sections Module",
        description:
          "Navigate to Sections from the Modules section, then click Manage Schedules for the target section.",
      },
      {
        title: "Add Schedule Entries",
        description:
          "For each entry, select the subject, teacher, room, day(s), and time slot.",
      },
      {
        title: "Conflict Validation",
        description:
          "The system automatically checks for conflicts — a teacher, room, or section cannot be double-booked.",
        tip: "Use the Calendar View to visualize the full weekly schedule at a glance.",
      },
      {
        title: "Schedule Published",
        description:
          "Once complete, the schedule appears on teacher dashboards and can be used for attendance tracking.",
      },
    ],
  },
  {
    id: "books",
    title: "Books",
    icon: BookMarked,
    category: "core",
    description:
      "Track textbook allocations from managers to teachers, and issuances from teachers to students.",
    allowedRoles: schoolManagementRoles,
    steps: [
      {
        title: "Open Books Module",
        description:
          "Navigate to Books. You'll see two sub-modules: Allocations and Issuances.",
      },
      {
        title: "Create Allocations",
        description:
          "In Allocations, the book manager assigns books to teachers — specify title and quantity.",
      },
      {
        title: "Teacher Receives Books",
        description:
          "Teachers see their allocated books in their Teacher Menu > Books view.",
      },
      {
        title: "Issue to Students",
        description:
          "In Issuances, teachers issue individual books to students in their sections.",
      },
      {
        title: "Track Returns",
        description:
          "When students return books, record the return with a code: FM (Fully Maintained), TDO (Torn/Damaged/Others), or NEG (Negligence).",
        tip: "Book counts update automatically — you can track how many are issued vs. returned at any time.",
      },
    ],
    subModules: [
      {
        id: "titles",
        title: "Book Titles",
        icon: BookOpen,
        description:
          "The catalogue itself — what titles the school holds, per grade level.",
        steps: [
          {
            title: "Add a Book",
            description:
              "Add Book records the title, subject area, and grade level. Nothing can be allocated until the title exists here.",
          },
          {
            title: "Find a Title",
            description:
              "Search by title or subject area and filter by grade level.",
          },
          {
            title: "Read the Allocated Column",
            description:
              "Each row shows how many copies of that title are already allocated to teachers for the current school year.",
          },
        ],
      },
      {
        id: "allocations",
        title: "Allocations",
        icon: BookMarked,
        description:
          "Book manager → teacher. How many copies of a title a teacher is holding.",
        steps: [
          {
            title: "Open Allocations",
            description:
              "Click Allocations from the Books page, then pick the school year you are allocating for.",
          },
          {
            title: "Add an Allocation",
            description:
              "Add Allocation picks the book, the teacher, and the quantity handed over.",
          },
          {
            title: "Teacher Receives Them",
            description:
              "The allocation appears immediately in that teacher's Teacher Menu → Books as allocated stock they can issue.",
            tip: "Allocations are per school year — last year's allocations do not follow a teacher into the new one.",
          },
        ],
      },
      {
        id: "issuances",
        title: "Issued / Returned",
        icon: ClipboardCheck,
        description:
          "Teacher → learner. Who is holding which copy, and what came back.",
        steps: [
          {
            title: "Open Books Issued / Returned",
            description:
              "Reach it from the Books page, then filter by section and school year.",
          },
          {
            title: "Issue Books",
            description:
              "With a section chosen, Issue Books records copies against individual learners in that section.",
          },
          {
            title: "Record a Return",
            description:
              "Mark the return with its condition code: FM (Fully Maintained), TDO (Torn/Damaged/Others), or NEG (Negligence).",
          },
          {
            title: "Print SF3",
            description:
              "This ledger is what SF3 (Books Issued/Returned) reads — record issuances as they happen and SF3 needs no rework.",
          },
        ],
      },
    ],
  },
  {
    id: "attendance",
    title: "Attendance",
    icon: CheckCircle2,
    category: "core",
    description:
      "Record daily student attendance by section. Reached from My Sections → open a section → Attendance.",
    allowedRoles: schoolManagementRoles,
    steps: [
      {
        title: "Open Attendance",
        description:
          "Attendance has no sidebar entry of its own. Go to Teacher Menu → My Sections, open a section, and click Attendance at the top of the page.",
      },
      {
        title: "Select Section & Date",
        description:
          "Choose the section, school year, and date you want to record attendance for.",
      },
      {
        title: "Mark Attendance",
        description:
          "Mark each student as Present, Absent, Tardy, or Excused for the selected date.",
      },
      {
        title: "View Reports",
        description:
          "Review attendance summaries to identify patterns and generate reports.",
      },
    ],
  },
  {
    id: "health",
    title: "Learner Health",
    icon: Heart,
    category: "core",
    description:
      "Record student health data (height, weight, vision) for DepEd SF8 reporting. Reached from My Sections → open a section → Learners Health.",
    allowedRoles: healthRoles,
    steps: [
      {
        title: "Open Learner Health",
        description:
          "Learner Health has no sidebar entry of its own. Go to Teacher Menu → My Sections, open a section, and click Learners Health at the top of the page.",
      },
      {
        title: "Select Section",
        description:
          "Choose a section and school year to view students for health recording.",
      },
      {
        title: "Record Health Data",
        description:
          "Enter each student's height, weight, vision screening results, and other health metrics.",
      },
      {
        title: "Nutritional Status",
        description:
          "The system automatically calculates BMI and nutritional status based on the recorded data.",
        tip: "This data feeds directly into the DepEd SF8 (Learner Health) report.",
      },
      {
        title: "Generate SF8",
        description:
          "Go to DepEd School Forms > SF8 to generate the official report with the recorded data.",
      },
    ],
  },

  // ── Teacher Menu ──
  {
    id: "teacher_dashboard",
    title: "Teacher Dashboard",
    icon: Settings,
    category: "teacher",
    description:
      "A quick overview of your assigned sections, subjects, and schedule.",
    allowedRoles: teacherMenuRoles,
    steps: [
      {
        title: "Open Dashboard",
        description:
          "Navigate to Dashboard under the Teacher Menu section.",
      },
      {
        title: "View Assignments",
        description:
          "See all sections where you are the adviser and subjects assigned to you at a glance.",
      },
      {
        title: "Quick Navigation",
        description:
          "Click on any section or subject card to jump directly to its details.",
      },
    ],
  },
  {
    id: "teacher_sections",
    title: "My Sections",
    icon: Users,
    category: "teacher",
    description:
      "Your advisory sections — and the hub for everything you do as an adviser. Opening a section is how you reach Attendance, Learner Health, School Forms, and the per-learner actions.",
    allowedRoles: teacherMenuRoles,
    steps: [
      {
        title: "Open My Sections",
        description: "Navigate to My Sections under the Teacher Menu.",
      },
      {
        title: "View Section List",
        description:
          "See all sections where you are the assigned adviser for the current school year.",
      },
      {
        title: "Open a Section",
        description:
          "Click a section to open its page: the student roster, the subject schedules, and buttons for Attendance, Learner Health, School Forms, and (for Kinder) the ECCD Checklist.",
        tip: "Attendance, Learner Health and the ECCD Checklist have no sidebar entry — opening a section here is the only way in.",
      },
      {
        title: "Work Inside the Section",
        description:
          "Use the sub-modules below for each adviser task. Every one of them already knows which section and school year you came from, so you never re-pick them.",
      },
    ],
    subModules: [
      {
        id: "roster",
        title: "Student Roster",
        icon: GraduationCap,
        description:
          "The list of learners enrolled in the section, with printing and export.",
        steps: [
          {
            title: "Review the Roster",
            description:
              "The Students card lists every approved enrollment with LRN, gender, grade, enrollment date, and status (Active, Promoted, Graduated, Retained, NLIS/Dropped, Transferred Out, Pending Transfer).",
          },
          {
            title: "Filter by Gender",
            description:
              "Switch between All / Male / Female. The count in the card title and everything you print or export follows the filter.",
          },
          {
            title: "Print the Class List",
            description:
              "Print produces an A4 class list with your school name, section, grade level, school year, adviser, and total — ready to sign.",
          },
          {
            title: "Export to Excel",
            description:
              "Export downloads the same list as a spreadsheet with the name parts in separate columns.",
          },
        ],
      },
      {
        id: "learner_actions",
        title: "Learner Actions",
        icon: UserPlus,
        description:
          "The ⋮ menu on each learner row — everything you can do to one learner.",
        steps: [
          {
            title: "Edit & Portal Code",
            description:
              "Edit corrects the learner's personal details. Portal Code generates the code the learner uses to sign in to the Student Portal.",
            tip: "Edit is disabled once a learner is promoted, graduated, completed, dropped, or transferred out — those records are closed.",
          },
          {
            title: "View Grades & Core Values",
            description:
              "View Grades shows the learner's grades across all subjects in the section. Core Values Entry records the report-card behaviour marks (not shown for Kinder).",
          },
          {
            title: "Print Card",
            description:
              "Prints the learner's report card. For Kinder (Grade 0) this prints the ECCD card instead, generated from the ECCD checklist.",
          },
          {
            title: "Assessments Shortcut",
            description:
              "Jumps straight to CRLA, Phil-IRI, or RMA for that learner — only the assessments valid for the section's grade level are offered.",
          },
          {
            title: "Promote / Graduate",
            description:
              "Moves an active learner to the next grade, or graduates them at a terminal grade. Blocked once your school's promotion deadline has passed.",
          },
          {
            title: "Retain / NLIS and Transfer Out",
            description:
              "Retain/NLIS marks a learner as retained or no longer in school. Transfer Out starts the transfer and flips the row to Pending Transfer until the receiving school completes it.",
          },
        ],
      },
      {
        id: "attendance",
        title: "Attendance",
        icon: ClipboardCheck,
        description:
          "Daily attendance for this section — the source of SF2.",
        steps: [
          {
            title: "Open Attendance",
            description:
              "Click Attendance at the top of the section page. The section and school year carry over automatically.",
          },
          {
            title: "Pick the Date",
            description:
              "Choose the school day you are recording. Non-school days from the school calendar are not open for marking.",
          },
          {
            title: "Mark Each Learner",
            description:
              "Mark every learner Present, Absent, Tardy, or Excused, then save.",
          },
          {
            title: "Review the Summary",
            description:
              "Use the summary to spot repeated absences early. The saved marks are what SF2 (Daily Attendance) reads.",
          },
        ],
      },
      {
        id: "health",
        title: "Learners Health",
        icon: Heart,
        description:
          "Height, weight and vision per learner — the source of SF8.",
        steps: [
          {
            title: "Open Learners Health",
            description:
              "Click Learners Health at the top of the section page.",
          },
          {
            title: "Record the Measurements",
            description:
              "Enter each learner's height, weight, and vision screening result for the reporting period.",
          },
          {
            title: "Check Nutritional Status",
            description:
              "BMI and nutritional status are computed for you — do not compute them by hand.",
          },
          {
            title: "Generate SF8",
            description:
              "Once complete, print SF8 (Learner Basic Health) from School Forms.",
          },
        ],
      },
      {
        id: "school_forms",
        title: "School Forms",
        icon: FileBarChart,
        description:
          "The DepEd forms an adviser prints for their own section.",
        steps: [
          {
            title: "Open School Forms",
            description:
              "Click School Forms at the top of the section page — it opens already filtered to this section and school year.",
          },
          {
            title: "Choose the Form",
            description:
              "An adviser can print SF1 (School Register), SF2 (Daily Attendance), SF3 (Books Issued/Returned), SF5 and SF6 (Promotion), SF8 (Health), SF9 (Progress Report Card), and SF10 (Permanent Record).",
          },
          {
            title: "Check Before Printing",
            description:
              "Each form reads live data — attendance, grades, health, book issuances. A blank column means the source data is missing, not that the form is broken.",
            tip: "Post your grades from Class Record before printing SF9; unposted grades do not appear.",
          },
          {
            title: "Print or Export",
            description:
              "Generate the form and download it as a PDF for signing and submission.",
          },
        ],
      },
      {
        id: "eccd",
        title: "ECCD Checklist",
        icon: Baby,
        description:
          "Kindergarten only — the developmental checklist behind the ECCD card.",
        steps: [
          {
            title: "Open the Checklist",
            description:
              "The ECCD Checklist button appears on the section page only when the section is Kindergarten (Grade 0).",
          },
          {
            title: "Record Each Domain",
            description:
              "Score every learner across the ECCD developmental domains for the checkpoint period.",
          },
          {
            title: "Print the ECCD Card",
            description:
              "Print Card on a Kinder learner's ⋮ menu generates the ECCD card from this checklist instead of the ordinary report card.",
          },
        ],
      },
      {
        id: "section_schedules",
        title: "Section Schedules",
        icon: Calendar,
        description:
          "The read-only weekly schedule of the section, plus MEP class lists.",
        steps: [
          {
            title: "Review the Schedules",
            description:
              "The Schedules card lists every subject for the grade level with its days, time, teacher, and room.",
            tip: "A slot marked Temporary has no teacher assigned yet — tell whoever manages schedules so it can be filled.",
          },
          {
            title: "Spot Missing Slots",
            description:
              "A subject showing “No schedule assigned” has not been scheduled. Schedules are created in Sections → Manage Schedules, not here.",
          },
          {
            title: "Manage MEP Students",
            description:
              "A subject badged MEP (Madrasah) has a Manage MEP Students button — use it to set which learners of the section actually take that subject.",
          },
        ],
      },
    ],
  },
  {
    id: "teacher_subjects",
    title: "My Subjects",
    icon: BookOpen,
    category: "teacher",
    description:
      "View the subjects you teach and their section assignments.",
    allowedRoles: teacherMenuRoles,
    steps: [
      {
        title: "Open My Subjects",
        description: "Navigate to My Subjects under the Teacher Menu.",
      },
      {
        title: "View Subject Assignments",
        description:
          "See all subjects assigned to you via the schedule, along with which sections you teach them in.",
      },
      {
        title: "Access Grade Entry",
        description:
          "Click a subject-section to view enrolled students and enter grades.",
      },
    ],
  },
  {
    id: "teacher_grades",
    title: "Grade Entry",
    icon: FileText,
    category: "teacher",
    description:
      "Enter and manage student grades for each grading period.",
    allowedRoles: teacherMenuRoles,
    steps: [
      {
        title: "Select Subject & Section",
        description:
          "From My Subjects, select the subject and section you want to enter grades for.",
      },
      {
        title: "Choose Grading Period",
        description:
          "Select the grading period (1st, 2nd, 3rd, or 4th quarter).",
      },
      {
        title: "Enter Grades",
        description:
          "Input grades for each student. The system validates that you are the assigned teacher or section adviser.",
        tip: "You must appear in the subject schedule or be the section adviser to enter grades.",
      },
      {
        title: "Save Grades",
        description:
          "Save the entered grades. They become visible to students in the Student Portal.",
      },
      {
        title: "Review & Finalize",
        description:
          "Review all grades before the period ends. Saved grades feed into DepEd SF reports.",
      },
    ],
  },
  {
    id: "teacher_class_record",
    title: "Class Record",
    icon: BookOpenCheck,
    category: "teacher",
    description:
      "Keep the DepEd class record for each subject you teach, then post the computed grade to the grading sheet.",
    allowedRoles: teacherMenuRoles,
    steps: [
      {
        title: "Open Class Record",
        description:
          "Navigate to Class Record under the Teacher Menu, then choose the school year and the subject–section you are recording for.",
        tip: "Only subject–sections assigned to you in the schedule appear in the list.",
      },
      {
        title: "Select the Period",
        description:
          "Pick the quarter (or term, for term-based school years) and set its start and end dates.",
      },
      {
        title: "Add Assessment Items",
        description:
          "Add Written Works and Performance Task items with their Highest Possible Score. Summative Tests (ST1, ST2) and the Term Exam are fixed columns — you only set their weights and HPS.",
      },
      {
        title: "Set Component Weights",
        description:
          "Enter the weight for Written Works, Performance Tasks, and Summative Tests. The badge must read 100% before grades can be posted.",
      },
      {
        title: "Enter Raw Scores",
        description:
          "Type each learner's raw score per item. Scores save as you type and the Initial Grade is computed automatically.",
        tip: "Tick Transmute if your school converts the initial grade using the DepEd transmutation table.",
      },
      {
        title: "Post Grades",
        description:
          "Click Post Grades to push the final grade into the grading sheet, where it feeds report cards, DepEd forms, and the Student Portal.",
      },
    ],
  },
  {
    id: "teacher_assessments",
    title: "Assessments",
    icon: NotebookPen,
    category: "teacher",
    description:
      "Record the DepEd diagnostic assessments for your advisory class: CRLA, Phil-IRI, RMA, and PABASA.",
    allowedRoles: teacherMenuRoles,
    steps: [
      {
        title: "Open Assessments",
        description:
          "Navigate to Assessments under the Teacher Menu and choose the assessment you are administering.",
      },
      {
        title: "Choose the Phase",
        description:
          "Select the school year and phase — BoSY (Beginning), MoSY (Middle), or EoSY (End of School Year).",
      },
      {
        title: "Print the Material",
        description:
          "Download the learner material and scoresheet attached to the assessment. Materials may be shared division-wide or authored by your own school.",
      },
      {
        title: "Administer & Record",
        description:
          "Assess each learner one-on-one, then encode the results on the scoresheet in the system.",
        tip: "Reading level and mastery band are computed automatically from the scores — you do not compute them yourself.",
      },
      {
        title: "Review Results",
        description:
          "Check the class summary to see which learners fall below grade level. These learners become eligible for ARAL intervention.",
      },
    ],
    subModules: [
      {
        id: "crla",
        title: "CRLA",
        icon: BookOpen,
        description:
          "Comprehensive Rapid Literacy Assessment — Grades 1–3.",
        steps: [
          {
            title: "Print the Materials",
            description:
              "Download the learner sheet and the scoresheet for the phase you are administering.",
          },
          {
            title: "Assess One-on-One",
            description:
              "CRLA is administered individually. Work through the learner sheet with each child and mark the paper scoresheet as you go.",
          },
          {
            title: "Encode the Profile",
            description:
              "Enter each learner's scores. The reading profile and grouping are computed from them — you do not assign the level yourself.",
          },
        ],
      },
      {
        id: "philiri",
        title: "Phil-IRI",
        icon: ScrollText,
        description:
          "Philippine Informal Reading Inventory — Grades 3–10.",
        steps: [
          {
            title: "Administer the Passage",
            description:
              "Use the grade-appropriate passage for the phase (BoSY, MoSY, EoSY).",
          },
          {
            title: "Record Miscues and Comprehension",
            description:
              "Encode the miscue count and the comprehension answers for each learner.",
          },
          {
            title: "Read the Computed Level",
            description:
              "Independent, Instructional, or Frustration is derived from the scores automatically.",
            tip: "A learner at Frustration level is exactly who ARAL Reading is looking for — encode here first, or they will not appear there.",
          },
        ],
      },
      {
        id: "rma",
        title: "RMA",
        icon: Calculator,
        description: "Rapid Mathematics Assessment — Grades 1–10.",
        steps: [
          {
            title: "Print and Administer",
            description:
              "Download the RMA material for the grade level and phase, then administer it to the class.",
          },
          {
            title: "Encode Item Results",
            description:
              "Record each learner's per-item results on the scoresheet.",
          },
          {
            title: "Check the Mastery Band",
            description:
              "The mastery band is computed from the item results and drives ARAL Mathematics eligibility.",
          },
        ],
      },
      {
        id: "pabasa",
        title: "PABASA",
        icon: BookText,
        description:
          "Pabasa Reading Program — Grades 11–12, Filipino & English.",
        steps: [
          {
            title: "Choose the Language",
            description:
              "PABASA is recorded separately for Filipino and English.",
          },
          {
            title: "Mark Reading Readiness",
            description:
              "Mark each learner Average, Fast, or Spontaneous for the phase.",
          },
        ],
      },
    ],
  },
  {
    id: "teacher_aral",
    title: "ARAL",
    icon: Sprout,
    category: "teacher",
    description:
      "Intervention program for learners below grade level, drawn from CRLA, Phil-IRI, RMA, and PABASA results.",
    allowedRoles: teacherMenuRoles,
    steps: [
      {
        title: "Open ARAL",
        description:
          "Navigate to ARAL under the Teacher Menu and pick a program: Reading, Mathematics, Science, or Summer.",
      },
      {
        title: "Review Eligible Learners",
        description:
          "The system lists learners identified as below grade level from their latest assessment results.",
        tip: "Encode the assessment first — a learner with no assessment result cannot be identified for ARAL.",
      },
      {
        title: "Enroll into the Program",
        description:
          "Enroll the identified learners into the program so their sessions and progress can be tracked.",
      },
      {
        title: "Track Progress",
        description:
          "Record attendance and progress per session, and review whether each learner is improving toward grade level.",
      },
    ],
    subModules: [
      {
        id: "programs",
        title: "The Four Programs",
        icon: Sprout,
        description:
          "Reading, Mathematics, Science, and Summer — each its own roster.",
        steps: [
          {
            title: "Pick a Program",
            description:
              "Reading and Mathematics draw their candidates from Phil-IRI/CRLA and RMA respectively. Science and Summer are the other two intervention tracks.",
          },
          {
            title: "Candidates Tab",
            description:
              "Choose the grade level to see learners the assessments flagged as below grade level. Enrol the ones you are taking into the program.",
            tip: "An empty Candidates list almost always means the assessment has not been encoded yet — not that no learner needs help.",
          },
          {
            title: "Enrolled Tab",
            description:
              "The learners already in the program, with their target tier (Priority or Secondary) and current status.",
          },
        ],
      },
      {
        id: "tutors",
        title: "Tutors",
        icon: UserPlus,
        description:
          "Admin and school head only — who tutors whom.",
        steps: [
          {
            title: "Add a Tutor",
            description:
              "Add Tutor creates the tutor account. Only school head, admin, and super admin see this page.",
          },
          {
            title: "Assign Learners",
            description:
              "Assign the tutor to a program and section. What you assign here is exactly what the tutor sees under Tutor Menu → My Learners.",
          },
          {
            title: "Tutor Signs In",
            description:
              "The tutor signs in and gets their own menu: My Learners, Attendance, and Progress Tracker — nothing else.",
            tip: "A teacher or staff member who is also a tutor keeps their normal menus and gains the Tutor Menu on top.",
          },
        ],
      },
      {
        id: "reports",
        title: "ARAL Reports",
        icon: BarChart3,
        description:
          "The school-wide intervention roster across every section.",
        steps: [
          {
            title: "Set the Filters",
            description:
              "Filter by program and school year to scope the roster.",
          },
          {
            title: "Read the Roster",
            description:
              "Every learner in the ARAL program across all sections, by target tier and status — the view a school head needs, not a single adviser's list.",
          },
        ],
      },
    ],
  },
  {
    id: "teacher_examinations",
    title: "Examinations",
    icon: FileSpreadsheet,
    category: "teacher",
    description:
      "Build a Table of Specification, turn it into an exam, then analyze the results item by item.",
    allowedRoles: teacherMenuRoles,
    steps: [
      {
        title: "Open Examinations",
        description:
          "Navigate to Examinations under the Teacher Menu. Three tools are available: Table of Specification, Exam Creator, and Item Analysis.",
      },
      {
        title: "Create a Table of Specification",
        description:
          "Build your own TOS — or start from one shared by the division — distributing exam items across competencies and Bloom's cognitive levels.",
      },
      {
        title: "Build the Exam",
        description:
          "In Exam Creator, turn the TOS item placement into the actual test, item by item.",
        tip: "A TOS you author stays private to you; a division-shared TOS is available to every teacher.",
      },
      {
        title: "Record Results",
        description:
          "In Item Analysis, encode each learner's per-item results after checking the exam.",
      },
      {
        title: "Review Item Analysis & MPS",
        description:
          "The system computes the Mean Percentage Score with mastery level, plus difficulty and discrimination indices per item.",
      },
    ],
    subModules: [
      {
        id: "tos",
        title: "Table of Specification",
        icon: FileSpreadsheet,
        description:
          "Per subject, per term — how the exam items are distributed.",
        steps: [
          {
            title: "Start a TOS",
            description:
              "Create your own for a subject and term, or start from one the division shared.",
          },
          {
            title: "Distribute the Items",
            description:
              "Spread the item count across the competencies and Bloom's cognitive levels the term covered.",
          },
          {
            title: "Know Who Sees It",
            description:
              "A TOS you author stays yours. A division-shared TOS is available to every teacher in the division.",
          },
        ],
      },
      {
        id: "exam_creator",
        title: "Exam Creator",
        icon: FileText,
        description: "Turn a TOS into the actual test.",
        steps: [
          {
            title: "Choose the TOS",
            description:
              "The exam is built from a TOS, so its item placement decides how many items go where.",
          },
          {
            title: "Write the Items",
            description:
              "Fill in each item against its slot until the test is complete.",
          },
        ],
      },
      {
        id: "item_analysis",
        title: "Item Analysis",
        icon: BarChart3,
        description:
          "Per-item results after checking, plus the MPS the school reports.",
        steps: [
          {
            title: "Encode Per-Item Results",
            description:
              "After checking the papers, record for each learner which items were right and which were wrong.",
          },
          {
            title: "Read the Indices",
            description:
              "Difficulty and discrimination are computed per item — they tell you which items were too easy, too hard, or simply bad.",
          },
          {
            title: "Feed the MPS Page",
            description:
              "The Mean Percentage Score with its mastery level comes from here. If Teacher Menu → MPS looks empty, results have not been encoded yet.",
          },
        ],
      },
    ],
  },
  {
    id: "teacher_books",
    title: "Teacher Books",
    icon: BookMarked,
    category: "teacher",
    description:
      "Manage books allocated to you — issue to students and process returns.",
    allowedRoles: teacherMenuRoles,
    steps: [
      {
        title: "View Allocated Books",
        description:
          "Open Books from the Teacher Menu to see books allocated to you by the book manager.",
      },
      {
        title: "Issue to Students",
        description:
          "Select students in your sections and issue books to them individually.",
      },
      {
        title: "Process Returns",
        description:
          "When students return books, record the return with the appropriate code: FM, TDO, or NEG.",
      },
      {
        title: "Return to Manager",
        description:
          "At the end of the period, return remaining books back to the book manager.",
      },
    ],
    subModules: [
      {
        id: "issue",
        title: "Issue to Students",
        icon: UserPlus,
        description: "Hand your allocated copies to learners.",
        steps: [
          {
            title: "Open Issue to Students",
            description:
              "From My Allocated Books, use the Issue to Students card.",
          },
          {
            title: "Pick the Section and Learners",
            description:
              "Choose a section you teach, then issue the title to individual learners.",
          },
          {
            title: "Watch Your Balance",
            description:
              "You can only issue what was allocated to you. The summary cards at the top show allocated, issued, and still held.",
          },
        ],
      },
      {
        id: "student_returns",
        title: "Record Student Returns",
        icon: ClipboardCheck,
        description: "Learners hand books back to you.",
        steps: [
          {
            title: "Open Record Student Returns",
            description:
              "From My Allocated Books, use the Record Student Returns card.",
          },
          {
            title: "Record the Condition",
            description:
              "Mark each returned copy FM (Fully Maintained), TDO (Torn/Damaged/Others), or NEG (Negligence).",
            tip: "Record the condition honestly at the counter — the code follows the copy to the book manager and into SF3.",
          },
        ],
      },
      {
        id: "return_to_manager",
        title: "Return to Book Manager",
        icon: RotateCcw,
        description: "You hand the copies back up the chain.",
        steps: [
          {
            title: "Open Return to Book Manager",
            description:
              "The card shows how many copies you are still holding — the ones learners returned to you plus any never issued.",
          },
          {
            title: "Submit the Return",
            description:
              "Return the copies to the book manager so your allocation closes out for the school year.",
          },
        ],
      },
    ],
  },

  {
    id: "teacher_evaluations",
    title: "Evaluations",
    icon: ClipboardCheck,
    category: "teacher",
    description:
      "Submit your evaluation of the school principal for the current school year.",
    allowedRoles: teacherMenuRoles,
    steps: [
      {
        title: "Open Evaluations",
        description:
          "Navigate to Evaluations under the Teacher Menu to see the evaluations open to you.",
        tip: "Nothing appears here until an administrator activates a teacher-to-principal questionnaire.",
      },
      {
        title: "Answer the Questionnaire",
        description:
          "Rate each statement on the 1–5 scale and add remarks where you want to explain a rating.",
      },
      {
        title: "Submit",
        description:
          "Submit your responses. Each evaluation can only be submitted once, and submitted evaluations are marked as done.",
      },
    ],
  },
  {
    id: "teacher_mps",
    title: "MPS",
    icon: BarChart3,
    category: "teacher",
    description:
      "Review the Mean Percentage Score of your subjects and sections per quarter.",
    allowedRoles: teacherMenuRoles,
    steps: [
      {
        title: "Open MPS",
        description:
          "Navigate to MPS under the Teacher Menu and select the school year.",
      },
      {
        title: "Review by Subject & Section",
        description:
          "The table shows the MPS per subject, section, and quarter, computed from the exam results you recorded.",
        tip: "MPS values come from Examinations → Item Analysis; record exam results there and this page fills in.",
      },
      {
        title: "Check Mastery Level",
        description:
          "Compare each MPS against its mastery level to see which subjects need remediation.",
      },
    ],
  },
  {
    id: "teacher_anecdotal",
    title: "Anecdotal Record",
    icon: NotebookText,
    category: "teacher",
    description:
      "Log observed learner behavior in your advisory class, with your interpretation and the action taken.",
    allowedRoles: guidanceRoles,
    steps: [
      {
        title: "Open Anecdotal Record",
        description:
          "Navigate to Anecdotal Record under the Teacher Menu, then select the school year and a learner from your advisory class.",
      },
      {
        title: "Add an Entry",
        description:
          "Record the date of observation, the setting, and an objective description of the observed behavior.",
        tip: "Describe only what you observed. Keep your judgment in the Interpretation field, not the anecdote.",
      },
      {
        title: "Interpret & Act",
        description:
          "Add your interpretation of the behavior and the action taken or recommendation made.",
      },
      {
        title: "Print the Record",
        description:
          "Print a learner's anecdotal record when it is needed for a conference or referral.",
      },
    ],
  },
  {
    id: "teacher_manifestation",
    title: "Manifestation Tagging",
    icon: Tags,
    category: "teacher",
    description:
      "Tag learners showing LSEN manifestations, secure parent consent, and plan the intervention for SNED identification.",
    allowedRoles: guidanceRoles,
    steps: [
      {
        title: "Open Manifestation Tagging",
        description:
          "Navigate to Manifestation Tagging under the Teacher Menu (also reachable from Anecdotal Record), then select the school year.",
      },
      {
        title: "Tag the Learner",
        description:
          "Record the manifestation or manifestations you observed, along with the LIS class branch and your observation notes. A learner may carry more than one.",
        tip: "Tag first — consent is sought afterwards. Tagging never requires consent.",
      },
      {
        title: "Print the SNED Consent Form",
        description:
          "Print the parent consent form and have the parent or guardian sign it, then record whether consent was granted or refused.",
      },
      {
        title: "Design the Intervention",
        description:
          "As adviser, write the intervention plan for the learner. The School Head renders technical assistance on the plan.",
      },
      {
        title: "Identify for SNED",
        description:
          "A learner who is both tagged and consented is identified for SNED enrollment. Record the enrollment outcome once it is settled.",
        tip: "This record feeds the DepEd LIS — it does not replace it. Tick the LIS flag once the learner is tagged there too.",
      },
    ],
  },
  {
    id: "teacher_cardex",
    title: "Learner Cardex",
    icon: IdCard,
    category: "teacher",
    description:
      "Keep the per-learner cardex: identified needs with interventions, and the log of communication with parents.",
    allowedRoles: guidanceRoles,
    steps: [
      {
        title: "Open Learner Cardex",
        description:
          "Navigate to Learner Cardex under the Teacher Menu, select the school year, then pick a learner from your advisory class.",
      },
      {
        title: "Record Needs & Interventions",
        description:
          "On the Needs tab, log the learner's identified need, the strategy you applied, the progress observed, and your remarks.",
      },
      {
        title: "Log Parent Communication",
        description:
          "On the Communication tab, record each contact: date, mode, person contacted, the concern discussed, and the agreement reached.",
      },
      {
        title: "Print for Conferences",
        description:
          "Print either log when documentation is needed for a parent conference or a referral.",
      },
    ],
  },
  {
    id: "teacher_supervision",
    title: "Supervision",
    icon: Telescope,
    category: "teacher",
    description:
      "Your side of the PMES classroom observation cycle — suggest an observation slot, and file COT forms for teachers you observe.",
    allowedRoles: teacherMenuRoles,
    steps: [
      {
        title: "Open Supervision",
        description:
          "Navigate to Supervision under the Teacher Menu and select the school year. My Observations lists the slots where you are the teacher observed.",
      },
      {
        title: "Suggest a Slot",
        description:
          "Propose an observation date with your position, term, grade and section, pre-conference time, focus KRA and indicator, and attach your ILAW lesson plan.",
      },
      {
        title: "Wait for Approval",
        description:
          "The School Head approves or rejects the suggestion. Editing an approved slot sends it back for approval, because an approval refers to one specific date.",
        tip: "Approved and completed slots offer an Add to Google Calendar link and a downloadable .ics that also carries the pre-conference.",
      },
      {
        title: "Review Your COT Forms",
        description:
          "After the observation, view the Annex E-2 rating sheet, E-4 notes, and — when there was more than one observer — the E-3 inter-observer agreement filed for you.",
      },
      {
        title: "Observations You Conduct",
        description:
          "If you are a designated observer this school year, a second tab lists the slots you observe. File your own Annex E-2 there.",
        tip: "You can only edit your own rating sheet — one observer never edits another's.",
      },
    ],
    subModules: [
      {
        id: "my_observations",
        title: "My Observations",
        icon: Telescope,
        description:
          "The tab where you are the teacher being observed.",
        steps: [
          {
            title: "Suggest a Slot",
            description:
              "Propose a date with your position, term, grade and section, pre-conference time, focus KRA and indicator, and your ILAW lesson plan attached.",
          },
          {
            title: "Track the Status",
            description:
              "The School Head approves or rejects it. Editing an approved slot sends it back for approval — an approval refers to one specific date.",
          },
          {
            title: "Add It to Your Calendar",
            description:
              "Approved and completed slots offer an Add to Google Calendar link and a downloadable .ics that carries the pre-conference too.",
          },
          {
            title: "Read Your COT Forms",
            description:
              "After the observation, view the Annex E-2 rating sheet, the E-4 notes, and — when there was more than one observer — the E-3 inter-observer agreement filed for you.",
          },
        ],
      },
      {
        id: "conduct",
        title: "Observations I Conduct",
        icon: ClipboardCheck,
        description:
          "Only visible when you are a designated observer this school year.",
        steps: [
          {
            title: "Open the Tab",
            description:
              "The second tab lists the slots where you are the observer rather than the observed.",
          },
          {
            title: "File Annex E-2",
            description:
              "Fill in your own rating sheet for the teacher you observed.",
            tip: "You can only edit the sheet you filed. One observer never edits another's — that is what makes the E-3 agreement meaningful.",
          },
        ],
      },
    ],
  },

  // ── Tutor Menu ──
  // A pure tutor logs in with type "tutor"; staff or teachers who also carry an
  // ARAL tutor assignment reach these pages via the `is_tutor` flag, so
  // `getVisibleGuides` admits this whole category on tutor access rather than on
  // `allowedRoles` alone.
  {
    id: "tutor_learners",
    title: "My Learners",
    icon: GraduationCap,
    category: "tutor",
    description:
      "The learners assigned to you in the ARAL intervention program, with your baseline and outcome notes.",
    allowedRoles: ["tutor"],
    steps: [
      {
        title: "Open My Learners",
        description:
          "Navigate to My Learners under the Tutor Menu and select the school year.",
        tip: "Your roster is assigned by the ARAL coordinator. If the list is empty, no learners have been assigned to you for that school year yet.",
      },
      {
        title: "Review Your Roster",
        description:
          "Each row shows the learner's program, section and grade level, target tier (Priority or Secondary), and current status.",
      },
      {
        title: "Record the Baseline Note",
        description:
          "Before the intervention begins, write where the learner stands in the Baseline note column.",
      },
      {
        title: "Record the Outcome Note",
        description:
          "After the intervention, write the result in the Outcome note column.",
        tip: "Notes save on their own a moment after you stop typing — watch for the “Saved” marker above the table.",
      },
    ],
  },
  {
    id: "tutor_attendance",
    title: "Tutor Attendance",
    icon: CalendarCheck,
    category: "tutor",
    description:
      "Mark attendance for your own tutorial sessions, session date by session date.",
    allowedRoles: ["tutor"],
    steps: [
      {
        title: "Open Attendance",
        description:
          "Navigate to Attendance under the Tutor Menu and select the school year.",
      },
      {
        title: "Add Session Dates",
        description:
          "Pick a date and add it. Each date becomes a column in the attendance grid.",
        tip: "These are your tutorial sessions, not the school's class days — add only the dates you actually met your learners.",
      },
      {
        title: "Mark Each Learner",
        description:
          "For every learner and session, mark Present, Absent, or Late. Marks save as you set them.",
      },
      {
        title: "Remove a Date",
        description:
          "Removing a session date deletes every attendance mark recorded under it, so you are asked to confirm first.",
      },
    ],
  },
  {
    id: "tutor_progress",
    title: "Progress Tracker",
    icon: TrendingUp,
    category: "tutor",
    description:
      "Track each tutee's reading level session by session across Weeks 1–8.",
    allowedRoles: ["tutor"],
    steps: [
      {
        title: "Open Progress Tracker",
        description:
          "Navigate to Progress Tracker under the Tutor Menu, select the school year, then pick the week (1–8) you are recording.",
      },
      {
        title: "Add Session Columns",
        description:
          "Click Add session for each session held that week, and label the column with the session focus.",
      },
      {
        title: "Record the Reading Level",
        description:
          "For each learner and session, set the level: IDL (Independent), ISL (Instructional), or FL (Frustration).",
      },
      {
        title: "Add Session Notes",
        description:
          "Note what happened in the session beside the level. Levels and notes save automatically.",
      },
      {
        title: "Compare Across Weeks",
        description:
          "Switch between weeks to see whether the learner is moving from Frustration toward Independent.",
      },
    ],
  },

  // ── Records ──
  {
    id: "requests",
    title: "Form Requests",
    icon: FileText,
    category: "records",
    description:
      "Three separate queues under one page: documents your own learners ask for, and learner records moving between schools in both directions.",
    allowedRoles: schoolManagementRoles,
    steps: [
      {
        title: "Open Requests",
        description: "Navigate to Requests under the Records section.",
      },
      {
        title: "Read the Badges",
        description:
          "Each tab carries a red count of what is still pending. A tab with no badge needs nothing from you today.",
      },
      {
        title: "Work the Right Tab",
        description:
          "Document Requests is your own learners and their guardians. Incoming and Outgoing Requests are transfers between schools — see the sub-modules below.",
        tip: "Incoming vs Outgoing is about where the learner's record is, not where the learner is going: Incoming means another school is asking YOU for a record.",
      },
    ],
    subModules: [
      {
        id: "document_requests",
        title: "Document Requests",
        icon: FileText,
        description:
          "Form 137, SF10 and other documents requested from your school.",
        steps: [
          {
            title: "Review the Request",
            description:
              "Open a pending request to see the learner, the document type, and the stated purpose.",
          },
          {
            title: "Set the Status",
            description:
              "Move it through Pending → Approved → Completed, adding notes where the requester needs to be told something.",
          },
          {
            title: "Release the Document",
            description:
              "Generate the document and release it to the requester. SF10 itself is printed from DepEd School Forms → SF10.",
          },
        ],
      },
      {
        id: "incoming_requests",
        title: "Incoming Requests",
        icon: Inbox,
        description:
          "Another school is asking you for a learner's record — you are the origin school.",
        steps: [
          {
            title: "Verify the Learner",
            description:
              "Check that the learner named really was enrolled with you, and that the requesting school is the one they moved to.",
          },
          {
            title: "Approve or Decline",
            description:
              "Approving hands the learner's record over to the requesting school. Decline anything you cannot verify rather than guessing.",
            tip: "This is the other side of a Transfer Out. If an adviser already marked the learner Transferred Out, expect the matching incoming request here.",
          },
        ],
      },
      {
        id: "outgoing_requests",
        title: "Outgoing Requests",
        icon: Send,
        description:
          "You are asking another school for a learner's record — you are the requesting school.",
        steps: [
          {
            title: "Raise the Request",
            description:
              "When a transferee enrolls with you, request their record from the school they came from.",
          },
          {
            title: "Track It",
            description:
              "The tab shows what is still pending at the other school. Follow up on anything that has sat there too long — the learner's SF10 cannot be completed without it.",
          },
        ],
      },
    ],
  },
  {
    id: "deped_forms",
    title: "DepEd School Forms",
    icon: FileBarChart,
    category: "records",
    description:
      "Generate official DepEd School Forms (SF1 through SF10) for submission.",
    allowedRoles: [...schoolManagementRoles, "division_admin", "division_type"],
    steps: [
      {
        title: "Open DepEd School Forms",
        description:
          "Navigate to DepEd School Forms under Records (or Division Office for division admins).",
      },
      {
        title: "Select Form Type",
        description:
          "Choose the form to generate: SF1 (School Register), SF2 (Daily Attendance), SF4-SF6 (Reports), SF8 (Health), SF9 (Progress Report), SF10 (Learner's Card).",
      },
      {
        title: "Set Filters",
        description:
          "Select school year, grade level, and section to narrow the data.",
      },
      {
        title: "Preview Form",
        description:
          "Review the auto-populated form with data from enrollment, grades, attendance, and health records.",
        tip: "Ensure all source data is complete before generating — missing grades or attendance will show as blank.",
      },
      {
        title: "Export as PDF",
        description:
          "Download the form as a PDF file ready for printing or submission to DepEd.",
      },
    ],
    subModules: [
      {
        id: "section_forms",
        title: "Section Forms — SF1, SF2, SF3, SF5, SF8",
        icon: Users,
        description:
          "The forms that need a section chosen before they will generate.",
        steps: [
          {
            title: "SF1 — School Register",
            description:
              "Master list of class enrollment by section. Reads the approved enrollments, so a learner missing here is missing an approved enrollment.",
          },
          {
            title: "SF2 — Daily Attendance",
            description:
              "Daily attendance by section for a chosen month and year. Reads what advisers marked in My Sections → Attendance.",
            tip: "SF2 asks for a month and year on top of the section — pick them before generating.",
          },
          {
            title: "SF3 — Books Issued/Returned",
            description:
              "Books issued and returned by section, from the Books issuance ledger.",
          },
          {
            title: "SF5 — Report on Promotion",
            description:
              "Promoted and retained learners by section, from the Promote / Retain actions taken on the roster.",
          },
          {
            title: "SF8 — Learner Basic Health",
            description:
              "Health and nutrition by section, from My Sections → Learners Health.",
          },
        ],
      },
      {
        id: "school_forms",
        title: "School-Wide Forms — SF4, SF6, SF7",
        icon: Building2,
        description:
          "The forms that cover the whole school and need no section.",
        steps: [
          {
            title: "SF4 — Monthly Learner Movement",
            description:
              "Enrollment counts and movements by grade level for the school year.",
          },
          {
            title: "SF6 — Summary Report on Promotion",
            description:
              "The grade-level summary of promotion — SF5 rolled up across sections.",
          },
          {
            title: "SF7 — School Personnel Assignment",
            description:
              "Personnel list with teaching load, built from Staff and from the schedules teachers are assigned to.",
            tip: "A teacher showing no load in SF7 has no schedule entries — fix it in Sections → Manage Schedules, not here.",
          },
        ],
      },
      {
        id: "learner_forms",
        title: "Per-Learner Forms — SF9, SF10",
        icon: GraduationCap,
        description:
          "The two forms generated for one named learner at a time.",
        steps: [
          {
            title: "SF9 — Progress Report Card",
            description:
              "Individual grades per quarter. Pick the learner rather than a section, and post grades from Class Record first — unposted grades print blank.",
          },
          {
            title: "SF10 — Permanent Record",
            description:
              "The learner's permanent academic record (ES / JHS / SHS). Use Search & Print SF10 to find the learner and print.",
          },
          {
            title: "Historical Records",
            description:
              "SF10 also covers learners whose earlier records came from another school through a record request — the transferred data prints alongside yours.",
          },
        ],
      },
    ],
  },

  // ── Division Office ──
  {
    id: "division_schools",
    title: "Schools",
    icon: Building2,
    category: "division",
    description:
      "Manage all schools under the division — view, add, and monitor school data.",
    allowedRoles: ["super admin"],
    steps: [
      {
        title: "Open Schools",
        description: "Navigate to Schools under the Division Office section.",
      },
      {
        title: "View All Schools",
        description:
          "Browse the list of all schools in the division with key statistics.",
      },
      {
        title: "Add or Edit Schools",
        description:
          "Add new schools or update existing school information: name, address, type, district.",
      },
      {
        title: "Monitor Status",
        description:
          "Track enrollment numbers and data completion status across schools.",
      },
    ],
  },
  {
    id: "division_users",
    title: "Users",
    icon: Users,
    category: "division",
    description:
      "Manage user accounts across all schools in the division.",
    allowedRoles: ["super admin"],
    steps: [
      {
        title: "Open Users",
        description: "Navigate to Users under the Division Office section.",
      },
      {
        title: "View All Users",
        description:
          "See all system users across schools, filterable by school and role.",
      },
      {
        title: "Create User Accounts",
        description:
          "Add new users, assign them to a school, and set their role.",
      },
      {
        title: "Manage Access",
        description:
          "Update user roles, reassign to different schools, or deactivate accounts.",
      },
    ],
  },
  {
    id: "division_reports",
    title: "Division Reports",
    icon: FileBarChart,
    category: "division",
    description:
      "Generate aggregated reports across all schools in the division.",
    allowedRoles: ["division_admin", "division_type"],
    steps: [
      {
        title: "Open Division Reports",
        description:
          "Navigate to Division Reports under the Division Office section.",
      },
      {
        title: "Select Report Type",
        description:
          "Choose the type of report and set parameters like school year and school filter.",
      },
      {
        title: "View Aggregated Data",
        description:
          "Review division-wide data compiled from all schools.",
      },
      {
        title: "Export Reports",
        description:
          "Download reports for division-level submissions to DepEd regional office.",
      },
    ],
  },
];

const CATEGORIES: { id: string; label: string }[] = [
  { id: "setup", label: "Initial Setup" },
  { id: "core", label: "Core Modules" },
  { id: "teacher", label: "Teacher Menu" },
  { id: "tutor", label: "Tutor Menu" },
  { id: "records", label: "Records" },
  { id: "division", label: "Division Office" },
];

/**
 * The guides a user may see, grouped into the sidebar's own sections.
 *
 * `isTutor` mirrors `AppSidebar`'s `hasTutorAccess`: a pure tutor logs in with
 * type "tutor", but a teacher or staff member who also holds an ARAL tutor
 * assignment keeps their normal type and carries the `is_tutor` flag instead.
 * Both reach the Tutor Menu, so both must reach its guides.
 */
export function getVisibleGuides(
  userType: string,
  isTutor = false
): GuideCategory[] {
  const hasTutorAccess = userType === "tutor" || isTutor;

  const filtered = ALL_GUIDES.filter(
    (guide) =>
      guide.allowedRoles.includes(userType as UserType) ||
      (guide.category === "tutor" && hasTutorAccess)
  );

  return CATEGORIES.map((cat) => ({
    id: cat.id,
    label: cat.label,
    modules: filtered.filter((g) => g.category === cat.id),
  })).filter((cat) => cat.modules.length > 0);
}

/* ── Search ─────────────────────────────────────────────────────────────── */

/**
 * One place in the guide a search term was found. `label` names the step so the
 * reader can see *why* a module matched — "Assign Roles" tells them more than
 * the module title repeated back at them.
 */
export interface GuideSearchMatch {
  label: string;
  snippet: string;
}

/**
 * A module or sub-module that matched. `moduleId` / `subId` are the same pair
 * the dialog navigates with, so a result is clickable without a second lookup.
 */
export interface GuideSearchResult {
  moduleId: string;
  subId?: string;
  title: string;
  /** "Core Modules · Enrollment" — where this sits, for a result read out of context. */
  breadcrumb: string;
  icon: LucideIcon;
  description: string;
  matches: GuideSearchMatch[];
  score: number;
}

/**
 * A term is a whole word the reader typed. Splitting on whitespace and matching
 * every term (in any field) is what makes "teacher grades" find the grade-entry
 * guide, where a naive substring search on the full string finds nothing.
 */
export function splitSearchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Weights are relative only — they decide result order, nothing else. */
const TITLE_WEIGHT = 100;
const DESCRIPTION_WEIGHT = 40;
const STEP_TITLE_WEIGHT = 25;
const STEP_BODY_WEIGHT = 12;

interface SearchField {
  text: string;
  weight: number;
  /** Present on step fields only — these are the ones worth showing as evidence. */
  match?: GuideSearchMatch;
}

function fieldsFor(entry: ModuleGuide | SubModuleGuide): SearchField[] {
  const fields: SearchField[] = [
    { text: entry.title, weight: TITLE_WEIGHT },
    { text: entry.description, weight: DESCRIPTION_WEIGHT },
  ];

  entry.steps.forEach((step, idx) => {
    const label = `Step ${idx + 1} · ${step.title}`;
    fields.push({
      text: step.title,
      weight: STEP_TITLE_WEIGHT,
      match: { label, snippet: step.description },
    });
    fields.push({
      text: `${step.description} ${step.tip ?? ""}`,
      weight: STEP_BODY_WEIGHT,
      match: { label, snippet: step.tip ?? step.description },
    });
  });

  return fields;
}

const MAX_MATCHES_PER_RESULT = 3;

/**
 * Scores one entry, or returns null when a term is missing everywhere. Every
 * term must land *somewhere* (AND across terms, OR across fields) so extra
 * words narrow the result list instead of widening it.
 */
function scoreEntry(
  entry: ModuleGuide | SubModuleGuide,
  terms: string[]
): { score: number; matches: GuideSearchMatch[] } | null {
  const fields = fieldsFor(entry);
  const haystacks = fields.map((f) => f.text.toLowerCase());

  let score = 0;
  const matches: GuideSearchMatch[] = [];
  const seen = new Set<string>();

  for (const term of terms) {
    let best = 0;

    haystacks.forEach((hay, i) => {
      if (!hay.includes(term)) return;
      // A word-start hit ("grade" in "Grade Entry") beats one buried mid-word
      // ("grade" in "upgraded"), so exact-ish matches float to the top.
      const bonus = new RegExp(`\\b${escapeRegExp(term)}`).test(hay) ? 1.5 : 1;
      best = Math.max(best, fields[i].weight * bonus);

      const match = fields[i].match;
      if (match && !seen.has(match.label) && matches.length < MAX_MATCHES_PER_RESULT) {
        seen.add(match.label);
        matches.push(match);
      }
    });

    if (best === 0) return null;
    score += best;
  }

  return { score, matches };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Searches the guides a user can already see. Callers pass the output of
 * `getVisibleGuides`, so search can never surface a module the reader's role
 * would not have shown them in the sidebar.
 */
export function searchGuides(
  categories: GuideCategory[],
  query: string
): GuideSearchResult[] {
  const terms = splitSearchTerms(query);
  if (terms.length === 0) return [];

  const results: GuideSearchResult[] = [];

  for (const category of categories) {
    for (const mod of category.modules) {
      const hit = scoreEntry(mod, terms);
      if (hit) {
        results.push({
          moduleId: mod.id,
          title: mod.title,
          breadcrumb: category.label,
          icon: mod.icon,
          description: mod.description,
          ...hit,
        });
      }

      for (const sub of mod.subModules ?? []) {
        const subHit = scoreEntry(sub, terms);
        if (subHit) {
          results.push({
            moduleId: mod.id,
            subId: sub.id,
            title: sub.title,
            breadcrumb: `${category.label} · ${mod.title}`,
            icon: sub.icon,
            description: sub.description,
            ...subHit,
          });
        }
      }
    }
  }

  // Ties broken by title so the order is stable between renders.
  return results.sort(
    (a, b) => b.score - a.score || a.title.localeCompare(b.title)
  );
}
