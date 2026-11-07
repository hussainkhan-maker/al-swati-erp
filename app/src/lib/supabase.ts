import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config";

const url = (process.env.EXPO_PUBLIC_SUPABASE_URL as string) || SUPABASE_URL;
const anon = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string) || SUPABASE_ANON_KEY;

export const supabase = createClient(url, anon, {
  auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

export async function ai<T = any>(task: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("ai", { body: { task, ...body } });
  if (error) {
    let msg = error.message;
    try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}
