"use client";

import type { ReactNode } from "react";

import styles from "./playground.module.css";

/* -------------------------------------------------------------------------- */
/* Small, unopinionated control primitives.                                    */
/*                                                                             */
/* Deliberately plain <input> elements: this is a debug surface, and native     */
/* range/checkbox inputs are keyboard accessible for free.                      */
/* -------------------------------------------------------------------------- */

export function Section({
  title,
  note,
  children,
  defaultOpen = true,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className={styles.section} open={defaultOpen}>
      <summary className={styles.sectionSummary}>
        <span>{title}</span>
        <svg aria-hidden className={styles.chevron} viewBox="0 0 16 16" width="12" height="12">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </summary>
      <div className={styles.sectionBody}>
        {note ? <p className={styles.note}>{note}</p> : null}
        {children}
      </div>
    </details>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className={styles.control}>
      <span className={styles.controlLabel}>
        {label}
        <output className={styles.controlValue}>
          {formatNumber(value)}
          {unit ? <span className={styles.unit}>{unit}</span> : null}
        </output>
      </span>
      <input
        className={styles.range}
        max={max}
        min={min}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
        step={step}
        type="range"
        value={value}
      />
    </label>
  );
}

export function Toggle({
  label,
  checked,
  note,
  onChange,
}: {
  label: string;
  checked: boolean;
  note?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles.toggle}>
      <input
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
      <span>
        {label}
        {note ? <em className={styles.toggleNote}>{note}</em> : null}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.control}>
      {label ? <span className={styles.controlLabel}>{label}</span> : null}
      <div className={styles.segmented} role="group">
        {options.map((option) => (
          <button
            aria-pressed={option.value === value}
            className={styles.segment}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ActionButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button className={styles.action} disabled={disabled} onClick={onClick} type="button">
      {children}
    </button>
  );
}

/** Trim trailing zeros so sliders do not jitter between `1` and `1.000`. */
export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(Math.abs(value) < 1 ? 3 : 2).replace(/\.?0+$/, "");
}
