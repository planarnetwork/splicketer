import { useEffect, useId, useRef, useState } from "react";
import type { Stations } from "../data/stations";
import styles from "./StationInput.module.css";

interface StationInputProps {
  title: string;
  value: string;
  placeholder?: string;
  stations: Stations;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

/**
 * A station field with suggestions as you type, from the journey planning comparison site
 */
export function StationInput({title, value, placeholder, stations, onChange, onSubmit}: StationInputProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(blurTimer.current), []);

  const matches = open ? stations.match(value) : [];
  const index = Math.min(active, Math.max(matches.length - 1, 0));

  const pick = (code: string) => {
    onChange(stations.label(code));
    setOpen(false);
    setActive(0);
  };

  return (
    <div className={styles.field}>
      <label htmlFor={id}>{title}</label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={e => {
          onChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={e => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            if (matches.length > 0) {
              setActive(i => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
            }
          }
          else if (e.key === "Enter") {
            const choice = matches[index];

            if (open && choice) {
              e.preventDefault();
              pick(choice.code);
            }
            else {
              onSubmit();
            }
          }
          else if (e.key === "Tab") {
            const choice = matches[index];

            if (open && choice && stations.label(choice.code) !== value) {
              pick(choice.code);
            }
          }
          else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {matches.length > 0 && (
        <div className={styles.autocomplete}>
          {matches.map((station, i) => (
            <button
              type="button"
              key={station.code}
              className={i === index ? `${styles.option} ${styles.optionActive}` : styles.option}
              // mousedown fires before blur, so the click is not lost to the timer
              onMouseDown={e => {
                e.preventDefault();
                pick(station.code);
              }}
            >
              <span>{station.name}</span>
              <em>{station.code}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
