"use client";

import {
  Controller,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type SelectOption = { value: string; label: string };

// base-ui's Select rejects empty-string item values, but native <select>s use
// value="" for "None"/"All". We map "" ⇄ a sentinel so a nullable select keeps
// working (empty stays empty in the form/state).
const NONE = "__none__";

type AppSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** When set, prepends a "" option with this label (e.g. "— None —", "All"). */
  noneLabel?: string;
  placeholder?: string;
  triggerClassName?: string;
  disabled?: boolean;
};

export function AppSelect({
  value,
  onChange,
  options,
  noneLabel,
  placeholder,
  triggerClassName = "w-full",
  disabled,
}: AppSelectProps) {
  const items = noneLabel ? [{ value: NONE, label: noneLabel }, ...options] : options;
  const current = value === "" ? (noneLabel ? NONE : undefined) : value;

  return (
    <Select
      items={items}
      value={current}
      onValueChange={(v) => onChange(v === NONE || v == null ? "" : v)}
      disabled={disabled}
    >
      <SelectTrigger className={triggerClassName}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// RHF-bound wrapper.
export function FormSelect<T extends FieldValues>({
  control,
  name,
  ...rest
}: Omit<AppSelectProps, "value" | "onChange"> & {
  control: Control<T>;
  name: Path<T>;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <AppSelect
          value={(field.value as string) ?? ""}
          onChange={field.onChange}
          {...rest}
        />
      )}
    />
  );
}
