"use client";

import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LrnLookupResult, StudentEntryMode } from "@/types/database";
import { FileUp, Loader2, Search } from "lucide-react";
import { RefObject } from "react";
import { UseFormReturn } from "react-hook-form";
import { LrnBoxInput } from "@/components/LrnBoxInput";
import TransfereeInfoCard from "./TransfereeInfoCard";
import { StudentFormType } from "./enrollmentWizardSchema";
import { EthnicGroupSelect } from "@/components/EthnicGroupSelect";

interface Props {
  form: UseFormReturn<StudentFormType>;
  entryMode: StudentEntryMode;
  lookupResult: LrnLookupResult | null;
  isLookingUp: boolean;
  isCurrentSchool: boolean;
  isSubmitting: boolean;
  birthCertificateFile: File | null;
  goodMoralFile: File | null;
  onBirthCertChange: (file: File | null) => void;
  onGoodMoralChange: (file: File | null) => void;
  birthCertInputRef: RefObject<HTMLInputElement | null>;
  goodMoralInputRef: RefObject<HTMLInputElement | null>;
  onLrnChange: (lrn: string) => void;
}

const ACCEPTED_DOC_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
];

export default function StudentRecordStep({
  form,
  entryMode,
  lookupResult,
  isLookingUp,
  isCurrentSchool,
  isSubmitting,
  birthCertificateFile,
  goodMoralFile,
  onBirthCertChange,
  onGoodMoralChange,
  birthCertInputRef,
  goodMoralInputRef,
  onLrnChange,
}: Props) {
  const disabled = isSubmitting;

  return (
    <div className="space-y-5">
      {/* LRN Field — always shown, drives the flow */}
      <FormField
        control={form.control}
        name="lrn"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-sm font-medium">
              LRN (Learner Reference Number){" "}
              <span className="text-destructive">*</span>
            </FormLabel>
            <div className="flex items-center gap-3">
              <FormControl>
                <LrnBoxInput
                  value={field.value}
                  onChange={(lrn) => {
                    field.onChange(lrn);
                    onLrnChange(lrn);
                  }}
                  disabled={disabled}
                />
              </FormControl>
              {isLookingUp ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : field.value && field.value.length >= 4 ? (
                <Search className="h-5 w-5 text-muted-foreground" />
              ) : null}
            </div>
            <FormMessage />
            {isLookingUp && (
              <p className="text-xs text-muted-foreground">
                Checking LRN across all schools...
              </p>
            )}
          </FormItem>
        )}
      />

      {/* Existing student or transferee card */}
      {lookupResult && (entryMode === "existing" || entryMode === "transferee") && (
        <TransfereeInfoCard
          student={lookupResult}
          isCurrentSchool={isCurrentSchool}
        />
      )}

      {/* New student form — only shown when LRN not found */}
      {entryMode === "new" && form.getValues("lrn")?.trim().length >= 1 && (
        <div className="space-y-5">
          {/* Name fields */}
          <div className="grid grid-cols-3 gap-4">
            <FormField
              control={form.control}
              name="last_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">
                    Last Name <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="Last name" className="h-10" {...field} disabled={disabled} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="first_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">
                    First Name <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="First name" className="h-10" {...field} disabled={disabled} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="middle_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">Middle Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Middle name" className="h-10" {...field} disabled={disabled} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <FormField
              control={form.control}
              name="suffix"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">Suffix</FormLabel>
                  <FormControl>
                    <Input placeholder="Jr., Sr., III" className="h-10" {...field} disabled={disabled} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="date_of_birth"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">
                    Date of Birth <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input type="date" className="h-10" {...field} disabled={disabled} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="gender"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">
                    Gender <span className="text-destructive">*</span>
                  </FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} disabled={disabled}>
                    <FormControl>
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Demographics */}
          <div className="grid grid-cols-3 gap-4">
            <FormField
              control={form.control}
              name="mother_tongue"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">Mother Tongue</FormLabel>
                  <FormControl>
                    <Input placeholder="Mother tongue" className="h-10" {...field} disabled={disabled} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="ip_ethnic_group"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">IP (Ethnic Group)</FormLabel>
                  <FormControl>
                    <EthnicGroupSelect
                      value={field.value}
                      onChange={field.onChange}
                      disabled={disabled}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="religion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">Religion</FormLabel>
                  <FormControl>
                    <Input placeholder="Religion" className="h-10" {...field} disabled={disabled} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="is_4ps"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">
                    4Ps Recipient
                  </FormLabel>
                  <div className="flex h-10 items-center gap-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value ?? false}
                        onChange={(e) => field.onChange(e.target.checked)}
                        disabled={disabled}
                      />
                    </FormControl>
                    <span className="text-sm text-muted-foreground">
                      Household is a 4Ps beneficiary
                    </span>
                  </div>
                </FormItem>
              )}
            />
          </div>

          {/* Address */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-4">Address</h3>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="purok" render={({ field }) => (
                <FormItem><FormLabel className="text-sm font-medium">Purok</FormLabel><FormControl><Input placeholder="Purok" className="h-10" {...field} disabled={disabled} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="barangay" render={({ field }) => (
                <FormItem><FormLabel className="text-sm font-medium">Barangay</FormLabel><FormControl><Input placeholder="Barangay" className="h-10" {...field} disabled={disabled} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="municipality_city" render={({ field }) => (
                <FormItem><FormLabel className="text-sm font-medium">Municipality/City</FormLabel><FormControl><Input placeholder="Municipality/City" className="h-10" {...field} disabled={disabled} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="province" render={({ field }) => (
                <FormItem><FormLabel className="text-sm font-medium">Province</FormLabel><FormControl><Input placeholder="Province" className="h-10" {...field} disabled={disabled} /></FormControl></FormItem>
              )} />
            </div>
          </div>

          {/* Contact */}
          <div className="grid grid-cols-2 gap-4">
            <FormField control={form.control} name="contact_number" render={({ field }) => (
              <FormItem><FormLabel className="text-sm font-medium">Contact Number</FormLabel><FormControl><Input placeholder="Contact number" className="h-10" {...field} disabled={disabled} /></FormControl></FormItem>
            )} />
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem><FormLabel className="text-sm font-medium">Email</FormLabel><FormControl><Input type="email" placeholder="Email address" className="h-10" {...field} disabled={disabled} /></FormControl></FormItem>
            )} />
          </div>

          {/* Father */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-4">Father Information</h3>
            <div className="grid grid-cols-3 gap-4">
              <FormField control={form.control} name="father_last_name" render={({ field }) => (
                <FormItem><FormLabel className="text-sm font-medium">Last Name</FormLabel><FormControl><Input placeholder="Father's last name" className="h-10" {...field} disabled={disabled} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="father_first_name" render={({ field }) => (
                <FormItem><FormLabel className="text-sm font-medium">First Name</FormLabel><FormControl><Input placeholder="Father's first name" className="h-10" {...field} disabled={disabled} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="father_middle_name" render={({ field }) => (
                <FormItem><FormLabel className="text-sm font-medium">Middle Name</FormLabel><FormControl><Input placeholder="Father's middle name" className="h-10" {...field} disabled={disabled} /></FormControl></FormItem>
              )} />
            </div>
          </div>

          {/* Mother */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-4">Mother Information</h3>
            <div className="grid grid-cols-3 gap-4">
              <FormField control={form.control} name="mother_last_name" render={({ field }) => (
                <FormItem><FormLabel className="text-sm font-medium">Last Name</FormLabel><FormControl><Input placeholder="Mother's last name" className="h-10" {...field} disabled={disabled} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="mother_first_name" render={({ field }) => (
                <FormItem><FormLabel className="text-sm font-medium">First Name</FormLabel><FormControl><Input placeholder="Mother's first name" className="h-10" {...field} disabled={disabled} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="mother_middle_name" render={({ field }) => (
                <FormItem><FormLabel className="text-sm font-medium">Middle Name</FormLabel><FormControl><Input placeholder="Mother's middle name" className="h-10" {...field} disabled={disabled} /></FormControl></FormItem>
              )} />
            </div>
          </div>

          {/* Guardian */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-4">Guardian Information</h3>
            <div className="grid grid-cols-3 gap-4">
              <FormField control={form.control} name="guardian_last_name" render={({ field }) => (
                <FormItem><FormLabel className="text-sm font-medium">Last Name</FormLabel><FormControl><Input placeholder="Guardian's last name" className="h-10" {...field} disabled={disabled} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="guardian_first_name" render={({ field }) => (
                <FormItem><FormLabel className="text-sm font-medium">First Name</FormLabel><FormControl><Input placeholder="Guardian's first name" className="h-10" {...field} disabled={disabled} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="guardian_middle_name" render={({ field }) => (
                <FormItem><FormLabel className="text-sm font-medium">Middle Name</FormLabel><FormControl><Input placeholder="Guardian's middle name" className="h-10" {...field} disabled={disabled} /></FormControl></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="parent_guardian_contact" render={({ field }) => (
              <FormItem className="mt-4"><FormLabel className="text-sm font-medium">Contact Number of Parent or Guardian</FormLabel><FormControl><Input placeholder="Contact number" className="h-10" {...field} disabled={disabled} /></FormControl></FormItem>
            )} />
          </div>

          {/* Previous School */}
          <FormField control={form.control} name="previous_school" render={({ field }) => (
            <FormItem><FormLabel className="text-sm font-medium">Previous School</FormLabel><FormControl><Input placeholder="Previous school (if transferred)" className="h-10" {...field} disabled={disabled} /></FormControl></FormItem>
          )} />

          {/* Documents */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-4">Documents</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Birth Certificate</label>
                <input
                  ref={birthCertInputRef}
                  type="file"
                  accept={ACCEPTED_DOC_MIME.join(",")}
                  className="hidden"
                  onChange={(e) => onBirthCertChange(e.target.files?.[0] ?? null)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full h-10 justify-start gap-2"
                  disabled={disabled}
                  onClick={() => birthCertInputRef.current?.click()}
                >
                  <FileUp className="h-4 w-4" />
                  {birthCertificateFile ? birthCertificateFile.name : "Upload PDF or image"}
                </Button>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Good Moral</label>
                <input
                  ref={goodMoralInputRef}
                  type="file"
                  accept={ACCEPTED_DOC_MIME.join(",")}
                  className="hidden"
                  onChange={(e) => onGoodMoralChange(e.target.files?.[0] ?? null)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full h-10 justify-start gap-2"
                  disabled={disabled}
                  onClick={() => goodMoralInputRef.current?.click()}
                >
                  <FileUp className="h-4 w-4" />
                  {goodMoralFile ? goodMoralFile.name : "Upload PDF or image"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
