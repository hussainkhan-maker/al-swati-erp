// Live location for supervisors and engineers: only between 06:00 and 18:00 Riyadh time.
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { TRACK_FROM_HOUR, TRACK_TO_HOUR } from "../config";
import { supabase } from "./supabase";

export const LOCATION_TASK = "alswati-site-location";

export function riyadhHour(d = new Date()) {
  return (d.getUTCHours() + 3) % 24; // Saudi Arabia is UTC+3 all year
}
export const inWorkHours = () => { const h = riyadhHour(); return h >= TRACK_FROM_HOUR && h < TRACK_TO_HOUR; };

// Background tracking exists only in the phone app, never on the laptop (web) version.
if (Platform.OS !== "web") TaskManager.defineTask(LOCATION_TASK, async ({ data, error }: any) => {
  if (error || !data?.locations?.length || !inWorkHours()) return;
  const { data: s } = await supabase.auth.getSession();
  if (!s?.session) return;
  const l = data.locations[data.locations.length - 1];
  await supabase.from("locations").insert({ lat: l.coords.latitude, lng: l.coords.longitude, accuracy: l.coords.accuracy });
});

export async function startTracking(): Promise<"on" | "denied"> {
  if (Platform.OS === "web") return "denied";
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== "granted") return "denied";
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== "granted") return "denied";
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) return "on";
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 10 * 60e3,
    distanceInterval: 150,
    deferredUpdatesInterval: 10 * 60e3,
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: true,
    foregroundService: {
      notificationTitle: "AL-Swati",
      notificationBody: "Site location is shared 06:00–18:00",
      notificationColor: "#0E6B5C",
    },
  });
  return "on";
}
export async function stopTracking() {
  if (Platform.OS === "web") return;
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}
