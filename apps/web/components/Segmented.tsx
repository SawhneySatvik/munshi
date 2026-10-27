import type { ReactNode } from "react";

export type SegOption = { value: string; label: ReactNode; note?: ReactNode; disabled?: boolean };

/**
 * A choice of a few, drawn as the top bar's language toggle is: radios in one inked pill, the chosen side filled. A
 * disabled option stays in place with its reason under its label ("Coming soon"), so the person sees what exists.
 */
export function Segmented(props: { name: string; legend: ReactNode; value: string; options: SegOption[]; onChange: (value: string) => void }) {
  return (
    <fieldset className="field">
      <legend className="kicker field-label">{props.legend}</legend>
      <div className="seg">
        {props.options.map((o) => {
          const id = `${props.name}-${o.value}`;
          return (
            <span key={o.value} className="seg-opt">
              <input
                type="radio"
                id={id}
                name={props.name}
                value={o.value}
                checked={props.value === o.value}
                disabled={o.disabled}
                onChange={() => props.onChange(o.value)}
              />
              <label htmlFor={id}>
                <span>{o.label}</span>
                {o.note && <small>{o.note}</small>}
              </label>
            </span>
          );
        })}
      </div>
    </fieldset>
  );
}
