import type { ButtonHTMLAttributes } from "react";
import "./Button.css";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" };

/** The pressable pill: primary is the red decision (Approve), secondary the paper one (Reject). */
export function Button({ variant = "secondary", className, type = "button", ...rest }: Props) {
  const classes = ["press", variant === "primary" ? "press-primary" : "", className ?? ""].filter(Boolean).join(" ");
  return <button type={type} className={classes} {...rest} />;
}
