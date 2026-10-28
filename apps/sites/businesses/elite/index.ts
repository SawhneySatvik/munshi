import "./theme.css";
import type { Business } from "../../lib/business.ts";
import { art } from "./art.tsx";
import { data } from "./data.ts";
import { display, displayHindi } from "./fonts.ts";
import { profile } from "./profile.ts";

const business: Business = { profile, data, art, fontClass: `${display.variable} ${displayHindi.variable}` };
export default business;
