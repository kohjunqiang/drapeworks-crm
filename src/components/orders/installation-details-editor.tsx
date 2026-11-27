"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { toast } from "sonner";

import { DialogActionBar } from "@/components/forms/form-action-bar";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveInstallationDetails } from "@/lib/actions/fulfilment";
import { installationDetailsInputSchema } from "@/lib/validation/fulfilment";
import { cn } from "@/lib/utils";

type StoredOpeningOverride = {
  width_cm?: number | null;
  height_cm?: number | null;
  note?: string | null;
};

export type EditableOpening = {
  id: string;
  roomId: string;
  /** "Window 2" within the room; null when the room has a single opening. */
  subLabel: string | null;
  /** Covering descriptor, e.g. "Double · Double draw" or the mesh category. */
  detail: string | null;
  /** Effective size: stored correction, else frozen PO, else measured. */
  widthCm: number | null;
  heightCm: number | null;
  /** Frozen PO (or measured) size a correction replaced — hint only. */
  originalWidthCm: number | null;
  originalHeightCm: number | null;
  overridden: boolean;
  /** Effective note; "" means the inherited note was explicitly cleared. */
  note: string;
  /** The raw override stored on the booking, if any. Untouched fields inherit. */
  stored: StoredOpeningOverride | undefined;
};

type EditableRoom = {
  id: string;
  label: string;
  note: string;
};

type Props = {
  token: string;
  expectedVersion: number;
  generalInstructions: string;
  rooms: EditableRoom[];
  openings: EditableOpening[];
};

type FormValues = {
  token: string;
  expected_version: number;
  general_instructions: string;
  rooms: { room_id: string; note: string }[];
  openings: {
    opening_id: string;
    width_cm: string;
    height_cm: string;
    note: string;
  }[];
};

// The shared schema coerces "" → null and strings → numbers, so the form
// fields stay strings here and the schema's *input* shape is what the resolver
// checks. The server action re-parses the same schema authoritatively.
const resolver = zodResolver(
  installationDetailsInputSchema,
) as unknown as Resolver<FormValues>;

const LABEL = "text-xs font-medium uppercase tracking-wide text-slate-500";
const FIELD = "mt-1 min-h-11 border-slate-200";

const dim = (value: number | null) => (value == null ? "—" : `${value}`);

export function InstallationDetailsEditor({
  token,
  expectedVersion,
  generalInstructions,
  rooms,
  openings,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const defaults = (): FormValues => ({
    token,
    expected_version: expectedVersion,
    general_instructions: generalInstructions,
    rooms: rooms.map((room) => ({ room_id: room.id, note: room.note })),
    openings: openings.map((opening) => ({
      opening_id: opening.id,
      width_cm: opening.widthCm == null ? "" : `${opening.widthCm}`,
      height_cm: opening.heightCm == null ? "" : `${opening.heightCm}`,
      note: opening.note,
    })),
  });

  const form = useForm<FormValues>({
    resolver,
    defaultValues: defaults(),
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    // Both open and close re-arm the form against the latest stored values,
    // clearing typed input, dirty flags and any previous failure.
    form.reset(defaults());
    setServerError(null);
  }

  function onSubmit(values: FormValues) {
    // Inheritance is positional: a field the operator never touched keeps its
    // stored override, or falls back to the original data — the prefilled
    // effective value must NOT be stamped as an explicit correction. Only
    // dirty fields become (or clear) overrides.
    const dirtyOpenings = form.formState.dirtyFields.openings ?? [];
    const openingsOut = values.openings
      .map((entry, index) => {
        const dirty = dirtyOpenings[index] ?? {};
        const stored = openings[index]?.stored;
        return {
          opening_id: entry.opening_id,
          width_cm: dirty.width_cm
            ? (entry.width_cm ?? null)
            : (stored?.width_cm ?? null),
          height_cm: dirty.height_cm
            ? (entry.height_cm ?? null)
            : (stored?.height_cm ?? null),
          note: dirty.note
            ? (entry.note ?? "")
            : (stored?.note ?? null),
        };
      })
      // An all-null entry carries no override — leave it out of the document.
      .filter(
        (entry) =>
          entry.width_cm != null ||
          entry.height_cm != null ||
          entry.note != null,
      );

    start(async () => {
      try {
        await saveInstallationDetails({
          token: values.token,
          expected_version: values.expected_version,
          general_instructions: values.general_instructions,
          rooms: values.rooms,
          openings: openingsOut,
        });
        toast.success("Installation details saved");
        setOpen(false);
        router.refresh();
      } catch (e) {
        // Inputs stay as typed — the operator can fix and retry.
        setServerError(
          e instanceof Error
            ? e.message
            : "Could not save installation details",
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        type="button"
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "min-h-11 sm:min-h-8",
        )}
      >
        Edit installation details
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl md:scroll-pb-24">
        <DialogHeader>
          <DialogTitle>Edit installation details</DialogTitle>
          <DialogDescription>
            Corrections apply to this installation only — the quoted order,
            site measurements and frozen PO sizes stay unchanged. Clearing a
            size field falls back to the original; clearing a note removes it.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-5"
          >
            <FormField
              control={form.control}
              name="general_instructions"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className={LABEL}>
                    General instructions
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      maxLength={2000}
                      placeholder="E.g. bring a 3m ladder; call before arriving"
                      className="mt-1 min-h-16 border-slate-200"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {rooms.map((room, roomIndex) => {
              const roomOpenings = openings
                .map((opening, index) => ({ opening, index }))
                .filter(({ opening }) => opening.roomId === room.id);
              return (
                <fieldset
                  key={room.id}
                  className="space-y-3 rounded-md border border-slate-200 p-3"
                >
                  <legend className="px-1 text-sm font-semibold text-slate-800">
                    {room.label}
                  </legend>
                  <FormField
                    control={form.control}
                    name={`rooms.${roomIndex}.note`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={LABEL}>Room note</FormLabel>
                        <FormControl>
                          <Input
                            maxLength={1000}
                            placeholder="E.g. false ceiling — use longer screws"
                            className={FIELD}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {roomOpenings.map(({ opening, index }) => (
                    <div
                      key={opening.id}
                      className="space-y-2 rounded-md bg-slate-50 p-3"
                    >
                      <p className="text-xs font-medium text-slate-700">
                        {opening.subLabel ?? "Opening"}
                        {opening.detail ? ` · ${opening.detail}` : ""}
                      </p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <FormField
                          control={form.control}
                          name={`openings.${index}.width_cm`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className={LABEL}>
                                Install width (cm)
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  step="any"
                                  className={FIELD}
                                  {...field}
                                  value={field.value ?? ""}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`openings.${index}.height_cm`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className={LABEL}>
                                Install height (cm)
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  step="any"
                                  className={FIELD}
                                  {...field}
                                  value={field.value ?? ""}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      {opening.overridden ? (
                        <p className="text-[11px] font-medium text-teal-700">
                          Correction in effect — original:{" "}
                          {dim(opening.originalWidthCm)} ×{" "}
                          {dim(opening.originalHeightCm)} cm
                        </p>
                      ) : null}
                      <FormField
                        control={form.control}
                        name={`openings.${index}.note`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className={LABEL}>
                              Installation note
                            </FormLabel>
                            <FormControl>
                              <Input
                                maxLength={1000}
                                placeholder="E.g. drill into concrete beam"
                                className={FIELD}
                                {...field}
                                value={field.value ?? ""}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  ))}
                </fieldset>
              );
            })}

            {serverError ? (
              <p role="alert" className="text-sm text-red-600">
                {serverError}
              </p>
            ) : null}

            <DialogActionBar className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending}
                className="bg-teal-600 text-white hover:bg-teal-700"
              >
                {pending ? "Saving…" : "Save installation details"}
              </Button>
            </DialogActionBar>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
