// Server address for the app. The anon key is a public key (it ships inside every app); the database rules protect the data.
// Filled in once the Supabase project exists. EXPO_PUBLIC_* environment values override these.
export const SUPABASE_URL = "https://keweaoogdnxietvyerhj.supabase.co";
export const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";

// Company details printed on every PDF. Replace these when the logo and details are ready.
export const COMPANY = {
  name: "Al-Swati Contracting",
  nameAr: "السواتي للمقاولات",
  details: "[CR no. · VAT no. · Address · Phone]",
  // A small PNG logo as a data URI, e.g. "data:image/png;base64,iVBOR..." — leave empty for a placeholder box.
  logoDataUri: "",
};

export const TRACK_FROM_HOUR = 6;   // live location starts 06:00 Riyadh
export const TRACK_TO_HOUR = 18;    // and stops 18:00
export const PRICE_STALE_DAYS = 30; // prices older than this turn amber
